# 2026-04-03: Fix FalkorDB `spawn ENOEXEC` on macOS

## Problem

On macOS (darwin-arm64), launching the extension in the Extension Development Host produced
repeated errors:

```
Error: Failed to connect to FalkorDB: spawn ENOEXEC
  at FalkorDBStore.connect (…/out/services/storage/FalkorDBStore.js:69:19)
```

The extension was completely unable to connect to FalkorDB — no graph data loaded, periodic
reconciliation looped with the same failure.

## Root Cause

`FalkorDBStore.connectEmbedded()` had a hardcoded binary resolution block that looked for
`@falkordblite/linux-x64/package.json` and passed those binary paths to `FalkorDB.open()`:

```typescript
const pkg = require.resolve('@falkordblite/linux-x64/package.json');
const binDir = path.join(path.dirname(pkg), 'bin');
redisServerPath = path.join(binDir, 'redis-server');  // linux ELF
modulePath = path.join(binDir, 'falkordb.so');
// ...
this.db = await FalkorDB.open({ path, redisServerPath, modulePath });
```

The `@falkordblite/linux-x64` package was installed as a dependency, so `require.resolve`
succeeded on macOS — but attempting to spawn a linux ELF binary on macOS produces `ENOEXEC`.

## Fix

Removed the manual binary path resolution entirely. `falkordblite`'s `BinaryManager` already
handles cross-platform detection (`linux-x64` and `darwin-arm64` are both supported) and will
auto-download the correct platform binaries on first run when no paths are passed.

```typescript
// Before: hardcoded linux-x64 paths passed explicitly
this.db = await FalkorDB.open({ path, redisServerPath, modulePath });

// After: let BinaryManager detect darwin-arm64 automatically
this.db = await FalkorDB.open({ path: dataPath || undefined });
```

Also removed the now-unused `import * as path from 'path'`.

## Files Changed

- `src/services/storage/FalkorDBStore.ts` — removed linux-x64 binary lookup block and `path` import

## Lesson

When using `falkordblite`, never pass `redisServerPath`/`modulePath` unless you have a specific
reason to override. The library's `BinaryManager.detectPlatform()` reads `os.platform()` +
`os.arch()` and selects the right binary. Passing platform-specific paths directly breaks
cross-platform portability.

On first run after the fix, `falkordblite` may download the darwin-arm64 binaries from GitHub
(~seconds). Subsequent runs use the cached binaries.
