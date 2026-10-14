# Contributing

Keep changes focused and state the tested game build. For format changes, explain
the source of the layout, the invariants it preserves and what remains unknown.
Prefer small synthetic fixtures over copied game bytes. Do not submit packages,
executables, extracted assets, saves, figure dumps, raw decompilation bundles or
third-party vehicle models.

## Checks

Use Node.js 24+, Qt 6.2+, CMake 3.21+ and a C++17 compiler. liblzma development
headers are needed by archive tests. npm installs development tooling only:

```bash
npm ci
npm test
cmake -S editor -B editor/build -DCMAKE_BUILD_TYPE=Release
cmake --build editor/build --parallel 4
ctest --test-dir editor/build --output-on-failure
npm run format:check
```

Asset-dependent tests skip unless explicitly enabled. For the optional OpenGL
test, configure with `-DSKYLANDERS_GPU_TESTS=ON` and use a working desktop display
and driver. A software/offscreen pass is not hardware-renderer validation.

On a network filesystem that cannot create symlinks, use `npm ci --no-bin-links`.
The formatting scripts also work without npm's executable symlinks.

## Style and safety

Run `npm run format` for JavaScript and `clang-format -i` on changed C++ files.
The repository contains both formatter configurations. Use descriptive names and
comments that explain constraints or evidence; keep transient experiment logs out
of production code.

Writers must preserve their input, refuse existing output paths, validate sizes
and offsets, and report hashes. Version-specific edits must retain their source
guards. A failing hash check calls for investigating the other build, not removing
the guard. Cover rejection paths as well as successful edits.

Keep public documentation portable. Private evidence filenames can identify an
experiment, but setup instructions must not depend on one research machine.
Review the source allowlist in `tools/package_source.mjs` when adding files.
