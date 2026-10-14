#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { constants, createReadStream, createWriteStream } from 'node:fs';
import { access, lstat, mkdir, open, readdir, realpath, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SOURCE_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const KNOWN_EXTRACTOR_SHA256 = 'b360bc691aa3d89071aa707224155f6eade348d314cf7798ac550e31c11a7bcc';

const USAGE = `Usage:
  node tools/setup_from_pkg.mjs --pkg <own-game.pkg> --extractor <pkg_extractor.AppImage> --work <new-directory> --level <level/filename.bld>
  node tools/setup_from_pkg.mjs --extracted <existing-game-root> --work <new-directory> --level <level/filename.bld>
  node tools/setup_from_pkg.mjs --check-deps [--skip-editor]
Options: --geometry-level <level/companion-mesh.bld>, --skip-editor (build archive extractor only), --jobs <1..32>, --help
No downloads, system package installation, existing-file replacement, or client configuration changes are performed.`;

export function parseOptions(args) {
  const options = { jobs: Math.min(4, os.availableParallelism()), skipEditor: false };
  const values = new Map([
    ['--pkg', 'pkg'],
    ['--extractor', 'extractor'],
    ['--extracted', 'extracted'],
    ['--work', 'work'],
    ['--level', 'level'],
    ['--geometry-level', 'geometryLevel'],
    ['--jobs', 'jobs'],
  ]);
  const seen = new Set();
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (seen.has(arg)) throw new Error(`Duplicate option ${arg}`);
    seen.add(arg);
    if (arg === '--help') options.help = true;
    else if (arg === '--skip-editor') options.skipEditor = true;
    else if (arg === '--check-deps') options.checkDeps = true;
    else if (values.has(arg)) {
      const value = args[++index];
      if (!value || value.startsWith('--')) throw new Error(`Missing value for ${arg}`);
      options[values.get(arg)] = value;
    } else throw new Error(`Unknown option ${arg}`);
  }
  options.jobs = Number(options.jobs);
  if (!Number.isInteger(options.jobs) || options.jobs < 1 || options.jobs > 32) {
    throw new Error('--jobs must be an integer from 1 to 32');
  }
  if (options.help) return options;
  if (options.checkDeps) {
    if (
      options.pkg ||
      options.extracted ||
      options.work ||
      options.level ||
      options.geometryLevel ||
      options.extractor
    ) {
      throw new Error('--check-deps cannot be combined with input or output options');
    }
    return options;
  }
  if (Boolean(options.pkg) === Boolean(options.extracted)) {
    throw new Error('Provide exactly one of --pkg or --extracted');
  }
  if (options.pkg && !options.extractor) throw new Error('--pkg requires an explicitly supplied --extractor');
  if (options.extracted && options.extractor) throw new Error('--extractor applies only to --pkg');
  if (!options.work || !options.level) throw new Error('--work and --level are required');
  validateLevelPath(options.level);
  if (options.geometryLevel) validateLevelPath(options.geometryLevel);
  return options;
}

export function validateLevelPath(value) {
  if (
    typeof value !== 'string' ||
    !value.endsWith('.bld') ||
    value.includes('\\') ||
    value.includes('\0') ||
    path.posix.isAbsolute(value) ||
    value.split('/').some((part) => !part || part === '.' || part === '..')
  ) {
    throw new Error('--level must be a relative .bld path without parent-directory traversal');
  }
  return value;
}

export async function hashFile(filename) {
  const before = await lstat(filename);
  if (!before.isFile()) throw new Error(`Expected a regular file, not a symlink: ${filename}`);
  const digest = async () => {
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(filename)) hash.update(chunk);
    return hash.digest('hex');
  };
  const hash = await digest();
  const after = await lstat(filename);
  if (!after.isFile() || before.size !== after.size || before.ino !== after.ino || before.dev !== after.dev) {
    throw new Error(`Input changed while hashing: ${filename}`);
  }
  if (before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) {
    // Some network filesystems publish a just-closed writer's timestamps late.
    // Confirm the contents again instead of treating metadata lag as corruption.
    const confirmedHash = await digest();
    const confirmed = await lstat(filename);
    if (
      !confirmed.isFile() ||
      confirmed.size !== before.size ||
      confirmed.ino !== before.ino ||
      confirmed.dev !== before.dev ||
      confirmedHash !== hash
    ) {
      throw new Error(`Input changed while hashing: ${filename}`);
    }
  }
  return { size: before.size, sha256: hash };
}

export async function inventoryTree(root) {
  const files = [];
  async function walk(relative) {
    const current = path.join(root, relative);
    const stat = await lstat(current);
    if (stat.isSymbolicLink()) throw new Error(`Symlinks are not accepted in a game input tree: ${current}`);
    if (stat.isDirectory()) {
      for (const name of (await readdir(current)).sort()) await walk(path.join(relative, name));
    } else if (stat.isFile()) {
      files.push({ path: relative.split(path.sep).join('/'), ...(await hashFile(current)) });
    } else throw new Error(`Unsupported input-tree entry: ${current}`);
  }
  await walk('');
  return { fileCount: files.length, totalBytes: files.reduce((sum, entry) => sum + entry.size, 0), files };
}

async function run(command, args, options = {}) {
  const log = options.log ? createWriteStream(options.log, { flags: 'wx' }) : null;
  return await new Promise((resolve, reject) => {
    let tail = '';
    let failed = false;
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: false,
    });
    const receive = (bytes) => {
      tail = (tail + bytes.toString('utf8')).slice(-32768);
      if (log) log.write(bytes);
    };
    child.stdout.on('data', receive);
    child.stderr.on('data', receive);
    log?.on('error', (error) => {
      failed = true;
      child.kill();
      reject(error);
    });
    child.on('error', (error) => {
      failed = true;
      log?.end();
      reject(new Error(`${command}: ${error.message}`));
    });
    child.on('close', (code, signal) => {
      const finish = () => {
        if (failed) return;
        if (!(options.acceptCodes ?? [0]).includes(code)) {
          reject(
            new Error(
              `${command} failed (${signal ?? code}). ${options.log ? `Log: ${options.log}\n` : ''}${tail}`,
            ),
          );
        } else resolve({ code, output: tail.trim() });
      };
      if (log) log.end(finish);
      else finish();
    });
  });
}

export async function checkDependencies(skipEditor = false) {
  if (process.platform !== 'linux') throw new Error('This setup helper currently supports Linux only');
  if (Number(process.versions.node.split('.')[0]) < 20) throw new Error('Node.js 20 or newer is required');
  const result = { node: process.version, platform: `${process.platform}/${process.arch}` };
  result.compiler = (await run('c++', ['--version'])).output.split('\n')[0];
  result.liblzma = (await run('pkg-config', ['--modversion', 'liblzma'])).output;
  await run('pkg-config', ['--exists', 'liblzma >= 5.2']);
  if (!skipEditor) {
    result.cmake = (await run('cmake', ['--version'])).output.split('\n')[0];
    result.ctest = (await run('ctest', ['--version'])).output.split('\n')[0];
    const cmakeVersion = result.cmake.match(/(\d+)\.(\d+)/);
    if (
      !cmakeVersion ||
      Number(cmakeVersion[1]) < 3 ||
      (Number(cmakeVersion[1]) === 3 && Number(cmakeVersion[2]) < 21)
    ) {
      throw new Error('CMake 3.21 or newer is required');
    }
    result.qt = (
      await run('pkg-config', ['--modversion', 'Qt6Core', 'Qt6Widgets', 'Qt6OpenGL'])
    ).output.split('\n');
    await run('pkg-config', ['--exists', 'Qt6Core >= 6.2', 'Qt6Widgets >= 6.2', 'Qt6OpenGL >= 6.2']);
    result.make = (await run('make', ['--version'])).output.split('\n')[0];
  }
  return result;
}

async function freshWorkPath(requested, inputRoot) {
  const target = path.resolve(requested);
  try {
    await lstat(target);
    throw new Error(`Refusing existing --work path: ${target}`);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  // Resolve the nearest existing ancestor so a symlink cannot hide nesting in
  // the original extracted tree. New outputs must be outside that input tree.
  let parent = path.dirname(target);
  const suffix = [path.basename(target)];
  while (true) {
    try {
      parent = await realpath(parent);
      break;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      suffix.unshift(path.basename(parent));
      parent = path.dirname(parent);
    }
  }
  const canonical = path.join(parent, ...suffix);
  if (inputRoot && (canonical === inputRoot || canonical.startsWith(`${inputRoot}${path.sep}`))) {
    throw new Error('--work must be outside the existing extracted input tree');
  }
  return canonical;
}

async function readHeader(filename, count) {
  const handle = await open(filename, 'r');
  try {
    const bytes = Buffer.alloc(count);
    const { bytesRead } = await handle.read(bytes, 0, count, 0);
    if (bytesRead !== count) throw new Error(`Truncated input header: ${filename}`);
    return bytes;
  } finally {
    await handle.close();
  }
}

export async function setup(options) {
  validateLevelPath(options.level);
  if (options.geometryLevel) validateLevelPath(options.geometryLevel);
  const sourceRoot = await realpath(SOURCE_ROOT);
  const inputRoot = options.extracted ? await realpath(options.extracted) : null;
  const work = await freshWorkPath(options.work, inputRoot);
  const pkg = options.pkg ? await realpath(options.pkg) : null;
  const extractor = options.extractor ? await realpath(options.extractor) : null;
  let pkgHeader;
  if (pkg) {
    pkgHeader = await readHeader(pkg, 0x80);
    if (pkgHeader.subarray(0, 4).toString('hex') !== '7f434e54') throw new Error('Input is not a PS4 PKG');
    const titleId = pkgHeader.subarray(0x47, 0x50).toString('ascii');
    if (!/^CUSA\d{5}$/.test(titleId)) throw new Error('PKG title ID is not a safe CUSA identifier');
    await access(extractor, constants.X_OK);
  }
  process.stderr.write('[setup] Checking local build dependencies...\n');
  const dependencies = await checkDependencies(options.skipEditor);
  if (!options.skipEditor) await access(path.join(sourceRoot, 'tools/level_builder.mjs'), constants.R_OK);
  await mkdir(path.dirname(work), { recursive: true });
  await mkdir(work); // Non-recursive: a racing existing directory is rejected.
  const manifest = {
    schema: 'skylanders-local-setup-v1',
    status: 'in-progress',
    work,
    sourceRoot,
    dependencies,
    gameRuntimeTested: false,
  };
  try {
    for (const folder of ['logs', 'build', 'payload']) await mkdir(path.join(work, folder));
    let gameRoot = inputRoot;
    if (pkg) {
      process.stderr.write(
        '[setup] Hashing your PKG and extractor; large inputs may take several minutes...\n',
      );
      manifest.pkg = {
        path: pkg,
        ...(await hashFile(pkg)),
        titleId: pkgHeader.subarray(0x47, 0x50).toString('ascii'),
      };
      manifest.extractor = { path: extractor, ...(await hashFile(extractor)) };
      manifest.extractor.matchesTested11 = manifest.extractor.sha256 === KNOWN_EXTRACTOR_SHA256;
      const state = path.join(work, 'extractor-state');
      await mkdir(path.join(state, 'user'), { recursive: true });
      const environment = {
        ...process.env,
        XDG_DATA_HOME: state,
        XDG_CONFIG_HOME: state,
        XDG_CACHE_HOME: state,
      };
      process.stderr.write('[setup] Checking package type using the supplied extractor...\n');
      await run(extractor, [pkg, '--check-type'], {
        cwd: state,
        env: environment,
        acceptCodes: [101],
        log: path.join(work, 'logs/pkg-type.log'),
      });
      const destination = path.join(work, 'extracted');
      await mkdir(destination);
      process.stderr.write('[setup] Extracting into the new local workspace...\n');
      const extraction = await run(extractor, [pkg, destination], {
        cwd: state,
        env: environment,
        log: path.join(work, 'logs/pkg-extraction.log'),
      });
      if (
        /Cannot (?:open|extract) PKG file|Could not read SFO|doesn't appear to be a valid PKG/i.test(
          extraction.output,
        )
      ) {
        throw new Error('Extractor reported a failure; inspect logs/pkg-extraction.log');
      }
      gameRoot = path.join(destination, manifest.pkg.titleId);
    }
    if (!(await lstat(gameRoot)).isDirectory()) throw new Error('Game root is not a directory');
    await access(path.join(gameRoot, 'eboot.bin'), constants.R_OK);
    await access(path.join(gameRoot, 'sce_sys/param.sfo'), constants.R_OK);
    const archive = await realpath(path.join(gameRoot, options.level));
    if (!archive.startsWith(`${gameRoot}${path.sep}`)) throw new Error('Level path escapes game root');
    const geometryArchive = options.geometryLevel
      ? await realpath(path.join(gameRoot, options.geometryLevel))
      : null;
    if (geometryArchive && !geometryArchive.startsWith(`${gameRoot}${path.sep}`))
      throw new Error('Geometry path escapes game root');
    manifest.gameRoot = gameRoot;
    process.stderr.write('[setup] Hashing extracted files for the local inventory...\n');
    const inventory = await inventoryTree(gameRoot);
    await writeFile(path.join(work, 'inventory.json'), `${JSON.stringify(inventory, null, 2)}\n`, {
      flag: 'wx',
    });
    manifest.inventory = {
      path: path.join(work, 'inventory.json'),
      fileCount: inventory.fileCount,
      totalBytes: inventory.totalBytes,
      ...(await hashFile(path.join(work, 'inventory.json'))),
    };
    const igaExtract = path.join(work, 'build/iga_extract');
    process.stderr.write('[setup] Building the local archive extractor...\n');
    const lzmaFlags = (await run('pkg-config', ['--cflags', '--libs', 'liblzma'])).output
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    await run(
      'c++',
      ['-std=c++17', '-O2', path.join(sourceRoot, 'tools/iga_extract.cpp'), '-o', igaExtract, ...lzmaFlags],
      { log: path.join(work, 'logs/build-iga.log') },
    );
    manifest.igaExtractor = { path: igaExtract, ...(await hashFile(igaExtract)) };
    const inner = path.join(work, 'payload/level.bld');
    process.stderr.write('[setup] Extracting the selected inner IGZ level payload...\n');
    await run(igaExtract, [archive, 'level.bld', inner], { log: path.join(work, 'logs/extract-level.log') });
    const innerHeader = await readHeader(inner, 16);
    if (
      innerHeader.readUInt32LE(0) !== 0x49475a01 ||
      innerHeader.readUInt32LE(4) !== 8 ||
      innerHeader.readUInt32LE(12) !== 14
    ) {
      throw new Error('Selected member is not the supported Trap Team PS4 IGZ v8/platform 14');
    }
    manifest.level = {
      archive: { path: archive, ...(await hashFile(archive)) },
      member: 'level.bld',
      payload: { path: inner, ...(await hashFile(inner)) },
      igzVersion: 8,
      igzPlatform: 14,
    };
    if (geometryArchive) {
      const geometryInner = path.join(work, 'payload/geometry.bld');
      process.stderr.write('[setup] Extracting the optional static-map geometry payload...\n');
      await run(igaExtract, [geometryArchive, 'level.bld', geometryInner], {
        log: path.join(work, 'logs/extract-geometry.log'),
      });
      const gh = await readHeader(geometryInner, 16);
      if (gh.readUInt32LE(0) !== 0x49475a01 || gh.readUInt32LE(4) !== 8 || gh.readUInt32LE(12) !== 14) {
        throw new Error('Companion geometry is not IGZ v8/platform 14');
      }
      manifest.geometry = {
        archive: { path: geometryArchive, ...(await hashFile(geometryArchive)) },
        member: 'level.bld',
        payload: { path: geometryInner, ...(await hashFile(geometryInner)) },
      };
    }
    if (!options.skipEditor) {
      process.stderr.write('[setup] Building the Qt editor and running its synthetic checks...\n');
      const build = path.join(work, 'build/editor');
      await run(
        'cmake',
        [
          '-S',
          path.join(sourceRoot, 'editor'),
          '-B',
          build,
          '-G',
          'Unix Makefiles',
          '-DCMAKE_BUILD_TYPE=Release',
          '-DBUILD_TESTING=ON',
        ],
        { log: path.join(work, 'logs/cmake-configure.log') },
      );
      await run('cmake', ['--build', build, '--parallel', String(options.jobs)], {
        log: path.join(work, 'logs/build-editor.log'),
      });
      await run('ctest', ['--test-dir', build, '--output-on-failure'], {
        log: path.join(work, 'logs/test-editor.log'),
      });
      manifest.editor = {
        path: path.join(build, 'skylanders-level-editor'),
        ...(await hashFile(path.join(build, 'skylanders-level-editor'))),
        backend: path.join(sourceRoot, 'tools/level_builder.mjs'),
        launchArguments: [
          inner,
          '--backend',
          path.join(sourceRoot, 'tools/level_builder.mjs'),
          '--node',
          process.execPath,
        ],
      };
      if (manifest.geometry)
        manifest.editor.launchArguments.push('--geometry', manifest.geometry.payload.path);
      const shellQuote = (value) => "'" + value.replaceAll("'", "'\"'\"'") + "'";
      manifest.editor.launchCommand = [manifest.editor.path, ...manifest.editor.launchArguments]
        .map(shellQuote)
        .join(' ');
    }
    manifest.status = 'complete';
    await writeFile(path.join(work, 'setup-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, {
      flag: 'wx',
    });
    return manifest;
  } catch (error) {
    manifest.status = 'failed';
    manifest.error = error.message;
    await writeFile(path.join(work, 'setup-failed.json'), `${JSON.stringify(manifest, null, 2)}\n`, {
      flag: 'wx',
    });
    throw new Error(`${error.message}\nPartial workspace retained for inspection: ${work}`);
  }
}

async function main() {
  const options = parseOptions(process.argv.slice(2));
  if (options.help) {
    console.log(USAGE);
    return;
  }
  const result = options.checkDeps ? await checkDependencies(options.skipEditor) : await setup(options);
  console.log(JSON.stringify(result, null, 2));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`setup_from_pkg: ${error.message}`);
    process.exitCode = 1;
  });
}
