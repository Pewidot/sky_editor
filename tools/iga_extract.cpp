#include <lzma.h>

#include <algorithm>
#include <array>
#include <cerrno>
#include <cstdint>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <limits>
#include <stdexcept>
#include <string>
#include <vector>

#include <fcntl.h>
#include <sys/stat.h>
#include <unistd.h>

namespace fs = std::filesystem;
constexpr std::uint64_t max_output_bytes = 1024ULL * 1024 * 1024;
constexpr std::uint64_t max_name_bytes = 64ULL * 1024 * 1024;
constexpr std::uint32_t max_entries = 1000000;

static void check_range(std::uint64_t start, std::uint64_t length, std::uint64_t limit,
                        const std::string &label) {
    if (start > limit || length > limit - start) {
        throw std::runtime_error(label + " exceeds archive/member bounds");
    }
}

static void read_at(std::istream &input, std::uint64_t offset, char *bytes, std::size_t length) {
    input.clear();
    input.seekg(static_cast<std::streamoff>(offset));
    if (!input)
        throw std::runtime_error("Cannot seek in archive");
    if (length == 0)
        return;
    input.read(bytes, static_cast<std::streamsize>(length));
    if (input.gcount() != static_cast<std::streamsize>(length)) {
        throw std::runtime_error("Unexpected end of archive");
    }
}

static std::uint32_t u32(const char *bytes) {
    const auto *p = reinterpret_cast<const unsigned char *>(bytes);
    return std::uint32_t(p[0]) | (std::uint32_t(p[1]) << 8) | (std::uint32_t(p[2]) << 16) |
           (std::uint32_t(p[3]) << 24);
}

static std::uint64_t align_up(std::uint64_t value, std::uint32_t alignment) {
    return (value + alignment - 1) / alignment * alignment;
}

// Linux setup supports C++17; ofstream has no exclusive-create mode in C++17.
// O_EXCL rejects existing regular files, hard links and even dangling symlinks.
class ExclusiveOutput {
  public:
    explicit ExclusiveOutput(const fs::path &path) : path_(path) {
        fd_ = ::open(path.c_str(), O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC, 0644);
        if (fd_ < 0)
            throw std::runtime_error("Cannot exclusively create output: " +
                                     std::string(std::strerror(errno)));
        if (::fstat(fd_, &identity_) != 0) {
            // The descriptor exists, but without its identity we cannot safely
            // unlink a pathname that another process could have replaced.
            ::close(fd_);
            fd_ = -1;
            throw std::runtime_error("Cannot identify newly created output");
        }
    }
    ExclusiveOutput(const ExclusiveOutput &) = delete;
    ExclusiveOutput &operator=(const ExclusiveOutput &) = delete;
    ~ExclusiveOutput() {
        if (fd_ >= 0)
            ::close(fd_);
        if (!committed_) {
            struct stat current{};
            if (::lstat(path_.c_str(), &current) == 0 && S_ISREG(current.st_mode) &&
                current.st_dev == identity_.st_dev && current.st_ino == identity_.st_ino) {
                ::unlink(path_.c_str()); // Only remove the inode created by this invocation.
            }
        }
    }
    void write(const char *bytes, std::size_t length) {
        std::size_t done = 0;
        while (done < length) {
            const auto written = ::write(fd_, bytes + done, length - done);
            if (written < 0 && errno == EINTR)
                continue;
            if (written <= 0)
                throw std::runtime_error("Cannot write output member");
            done += static_cast<std::size_t>(written);
        }
    }
    void commit() {
        if (::fsync(fd_) != 0)
            throw std::runtime_error("Cannot flush output member");
        const int result = ::close(fd_);
        fd_ = -1;
        if (result != 0)
            throw std::runtime_error("Cannot close output member");
        committed_ = true;
    }

  private:
    fs::path path_;
    int fd_ = -1;
    struct stat identity_{};
    bool committed_ = false;
};

struct Chunk {
    std::uint64_t start{};
    std::uint32_t output_size{};
    std::uint16_t compressed_size{};
    bool compressed{};
    std::array<std::uint8_t, 5> properties{};
};

struct Entry {
    std::uint32_t index{}, start{}, size{}, mode{};
    std::uint64_t stored_end{};
    std::string path;
    std::vector<Chunk> chunks;
};

static void validate_chunks(std::istream &input, Entry &entry, std::uint64_t limit, std::uint32_t alignment,
                            std::uint64_t &total_chunks) {
    std::uint64_t cursor = entry.start;
    for (std::uint64_t produced = 0; produced < entry.size; produced += 0x8000) {
        if (++total_chunks > 1000000)
            throw std::runtime_error("Archive exceeds one-million-chunk validation limit");
        const auto expected =
            static_cast<std::uint32_t>(std::min<std::uint64_t>(0x8000, entry.size - produced));
        check_range(cursor, 0, limit, "Chunk start");
        const auto available = static_cast<std::size_t>(std::min<std::uint64_t>(7, limit - cursor));
        std::array<char, 7> prefix{};
        read_at(input, cursor, prefix.data(), available);
        Chunk chunk{cursor, expected};
        // A final raw chunk may contain fewer than seven bytes. Do not demand a
        // compression header before determining that those bytes are raw.
        if (available == 7 && static_cast<unsigned char>(prefix[2]) == 0x5d &&
            u32(prefix.data() + 3) <= 0x8000) {
            chunk.compressed = true;
            chunk.compressed_size = static_cast<unsigned char>(prefix[0]) |
                                    (static_cast<std::uint16_t>(static_cast<unsigned char>(prefix[1])) << 8);
            if (chunk.compressed_size == 0)
                throw std::runtime_error("Empty LZMA chunk");
            std::copy_n(reinterpret_cast<const std::uint8_t *>(prefix.data() + 2), 5,
                        chunk.properties.begin());
            check_range(cursor, 7ULL + chunk.compressed_size, limit, "Compressed chunk");
            cursor += 7ULL + chunk.compressed_size;
        } else {
            check_range(cursor, expected, limit, "Raw chunk");
            cursor += expected;
        }
        entry.chunks.push_back(chunk);
        if (produced + expected < entry.size)
            cursor = align_up(cursor, alignment);
    }
    entry.stored_end = cursor;
}

static void copy_exact(std::istream &input, ExclusiveOutput &output, std::uint64_t position,
                       std::uint32_t length) {
    std::vector<char> buffer(std::min<std::uint32_t>(1 << 20, length));
    std::uint32_t done = 0;
    while (done < length) {
        const auto amount = std::min<std::uint32_t>(length - done, buffer.size());
        read_at(input, position + done, buffer.data(), amount);
        output.write(buffer.data(), amount);
        done += amount;
    }
}

static void extract_lzma_chunks(std::istream &input, ExclusiveOutput &output, const Entry &entry) {
    for (const auto &chunk : entry.chunks) {
        if (!chunk.compressed) {
            copy_exact(input, output, chunk.start, chunk.output_size);
            continue;
        }
        std::vector<std::uint8_t> compressed(chunk.compressed_size), decoded(chunk.output_size);
        read_at(input, chunk.start + 7, reinterpret_cast<char *>(compressed.data()), compressed.size());
        lzma_filter filters[2] = {{LZMA_FILTER_LZMA1, nullptr}, {LZMA_VLI_UNKNOWN, nullptr}};
        if (lzma_properties_decode(&filters[0], nullptr, chunk.properties.data(), chunk.properties.size()) !=
            LZMA_OK) {
            throw std::runtime_error("Invalid LZMA properties");
        }
        lzma_stream stream = LZMA_STREAM_INIT;
        const auto init = lzma_raw_decoder(&stream, filters);
        if (init != LZMA_OK) {
            lzma_filters_free(filters, nullptr);
            throw std::runtime_error("Cannot initialize LZMA decoder");
        }
        stream.next_in = compressed.data();
        stream.avail_in = compressed.size();
        stream.next_out = decoded.data();
        stream.avail_out = decoded.size();
        lzma_ret status = LZMA_OK;
        bool no_progress = false;
        while (stream.avail_out > 0 && status == LZMA_OK && stream.avail_in > 0) {
            const auto previous_in = stream.avail_in, previous_out = stream.avail_out;
            status = lzma_code(&stream, LZMA_RUN);
            if (previous_in == stream.avail_in && previous_out == stream.avail_out) {
                no_progress = true;
                break;
            }
        }
        const auto produced = decoded.size() - stream.avail_out;
        lzma_end(&stream);
        lzma_filters_free(filters, nullptr);
        // Valid game chunks may omit an LZMA end marker. Exact output length is
        // required, but an explicit decoder error is never treated as success.
        if (no_progress || produced != decoded.size() || (status != LZMA_OK && status != LZMA_STREAM_END)) {
            throw std::runtime_error("LZMA decode failed at offset " + std::to_string(chunk.start) +
                                     " (status " + std::to_string(status) + ", produced " +
                                     std::to_string(produced) + ")");
        }
        output.write(reinterpret_cast<const char *>(decoded.data()), decoded.size());
    }
}

int main(int argc, char **argv) {
    try {
        if (argc != 4) {
            std::cerr << "Usage: iga_extract <archive> <entry-index|exact-member-path> <new-output-file>\n";
            return 2;
        }
        const fs::path archive_path = fs::absolute(argv[1]), output_path = fs::absolute(argv[3]);
        const std::string selector = argv[2];
        if (!fs::is_regular_file(archive_path))
            throw std::runtime_error("Input must be a regular archive file");
        // Early convenience check; exclusive creation below supplies the actual guarantee.
        if (fs::symlink_status(output_path).type() != fs::file_type::not_found) {
            throw std::runtime_error("Refusing to overwrite existing output path");
        }
        const auto archive_size = fs::file_size(archive_path);
        if (archive_size > std::numeric_limits<std::uint32_t>::max()) {
            throw std::runtime_error("Archive exceeds supported 32-bit size limit");
        }
        check_range(0, 0x38, archive_size, "IGA header");
        std::ifstream input(archive_path, std::ios::binary);
        if (!input)
            throw std::runtime_error("Cannot open archive");
        std::array<char, 0x38> header{};
        read_at(input, 0, header.data(), header.size());
        if (u32(header.data()) != 0x1a414749 || u32(header.data() + 4) != 0x0b) {
            throw std::runtime_error("Only little-endian IGA version 0x0B is supported");
        }
        const auto count = u32(header.data() + 0x0c), alignment = u32(header.data() + 0x10);
        const auto table_length = u32(header.data() + 8);
        const auto name_start = u32(header.data() + 0x28), name_length = u32(header.data() + 0x30);
        if (count == 0 || count > max_entries)
            throw std::runtime_error("Invalid or excessive member count");
        if (alignment == 0 || alignment > 0x100000 || (alignment & (alignment - 1)) != 0) {
            throw std::runtime_error("Invalid chunk alignment");
        }
        if (table_length < count * 20ULL)
            throw std::runtime_error("Descriptor table exceeds declared table extent");
        check_range(0x38, table_length, archive_size, "Lookup/chunk-property tables");
        const std::uint64_t tables_end = 0x38ULL + table_length;
        check_range(name_start, name_length, archive_size, "Name table");
        if (name_start < tables_end || name_length < count * 4ULL || name_length > max_name_bytes) {
            throw std::runtime_error("Invalid or excessive name table");
        }
        const bool numeric = !selector.empty() &&
                             std::all_of(selector.begin(), selector.end(),
                                         [](unsigned char value) { return value >= '0' && value <= '9'; });
        std::uint64_t wanted_index = 0;
        if (numeric) {
            try {
                wanted_index = std::stoull(selector);
            } catch (const std::exception &) {
                throw std::runtime_error("Member index is out of range");
            }
            if (wanted_index >= count)
                throw std::runtime_error("Member index is out of range");
        }
        std::vector<char> tables(count * 20ULL), names(name_length);
        read_at(input, 0x38, tables.data(), tables.size());
        read_at(input, name_start, names.data(), names.size());
        std::vector<Entry> entries;
        entries.reserve(count);
        std::uint64_t total_name_bytes = 0;
        std::size_t selected_index = 0, matches = 0;
        for (std::uint32_t index = 0; index < count; ++index) {
            const auto name_offset = u32(names.data() + index * 4ULL);
            if (name_offset < count * 4ULL || name_offset >= name_length) {
                throw std::runtime_error("Member name offset is outside string storage");
            }
            const auto maximum = std::min<std::size_t>(4097, name_length - name_offset);
            const auto *end = static_cast<const char *>(std::memchr(names.data() + name_offset, 0, maximum));
            if (!end || end == names.data() + name_offset)
                throw std::runtime_error("Invalid, empty or excessive member name");
            Entry entry;
            entry.index = index;
            entry.path.assign(names.data() + name_offset,
                              static_cast<std::size_t>(end - (names.data() + name_offset)));
            total_name_bytes += entry.path.size();
            if (total_name_bytes > max_name_bytes)
                throw std::runtime_error("Decoded member names exceed safety limit");
            const char *descriptor = tables.data() + count * 4ULL + index * 16ULL;
            entry.start = u32(descriptor);
            entry.size = u32(descriptor + 8);
            entry.mode = u32(descriptor + 12);
            if (entry.start < tables_end || entry.start > archive_size || entry.start % alignment != 0 ||
                (entry.start >= name_start && entry.start < std::uint64_t(name_start) + name_length)) {
                throw std::runtime_error("Invalid member start or metadata overlap");
            }
            if ((entry.mode >> 24) != 0xff && (entry.mode >> 24) != 0x20) {
                throw std::runtime_error("Unsupported member compression mode");
            }
            if ((numeric && wanted_index == index) || (!numeric && entry.path == selector)) {
                selected_index = index;
                ++matches;
            }
            entries.push_back(std::move(entry));
        }
        if (matches != 1)
            throw std::runtime_error("Selector must identify exactly one archive member");
        if (entries[selected_index].size > max_output_bytes) {
            throw std::runtime_error("Selected output exceeds one-GiB safety limit");
        }
        std::vector<std::uint32_t> starts;
        starts.reserve(entries.size());
        for (const auto &entry : entries)
            starts.push_back(entry.start);
        std::sort(starts.begin(), starts.end());
        std::uint64_t total_chunks = 0;
        for (auto &entry : entries) {
            std::uint64_t limit = archive_size;
            const auto next = std::upper_bound(starts.begin(), starts.end(), entry.start);
            if (next != starts.end())
                limit = *next;
            if (name_start > entry.start)
                limit = std::min<std::uint64_t>(limit, name_start);
            if ((entry.mode >> 24) == 0xff) {
                check_range(entry.start, entry.size, limit, "Raw member");
                entry.stored_end = std::uint64_t(entry.start) + entry.size;
            } else
                validate_chunks(input, entry, limit, alignment, total_chunks);
        }
        std::vector<const Entry *> ordered;
        for (const auto &entry : entries)
            if (entry.size != 0)
                ordered.push_back(&entry);
        std::sort(ordered.begin(), ordered.end(),
                  [](const Entry *a, const Entry *b) { return a->start < b->start; });
        for (std::size_t index = 1; index < ordered.size(); ++index) {
            if (ordered[index]->start < ordered[index - 1]->stored_end) {
                throw std::runtime_error("Archive members overlap");
            }
        }
        fs::create_directories(output_path.parent_path());
        ExclusiveOutput output(output_path);
        const auto &selected = entries[selected_index];
        if ((selected.mode >> 24) == 0xff)
            copy_exact(input, output, selected.start, selected.size);
        else
            extract_lzma_chunks(input, output, selected);
        output.commit();
        std::cout << "Extracted entry " << selected.index << " (" << selected.path << ") to " << output_path
                  << " (" << selected.size << " bytes)\n";
        return 0;
    } catch (const std::exception &error) {
        std::cerr << "iga_extract: " << error.what() << '\n';
        return 1;
    }
}
