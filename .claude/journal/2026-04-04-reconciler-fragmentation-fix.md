# 2026-04-04: Reconciler Fragmentation Fix + Diagnostic Logging

## Problem

After the initial fast-load from FalkorDB (which rendered a cohesive graph), the background Phase 2 startup task caused the graph to fragment ~2-5 seconds after launch.

## Root Cause

There are two distinct node types that both receive the FalkorDB structural label `:FILE`:

| Type | Creator | `id` format | Has `path`? | Has `filename`? |
|---|---|---|---|---|
| Filesystem FILE | `createFileNode()` / Reconciler / FileWatcher | `"src/api/server.py"` (relative, forward-slash) | ✅ | ❌ |
| CPG FILE | UastBuilder (from `module` / `program` tree-sitter node) | `"/abs/path/server.py:FILE:0:0"` | ❌ | ✅ |

The Reconciler's `findOrphanNodes()` and `findMissingFiles()` both queried:
```cypher
MATCH (n) WHERE n:FILE OR n:DIRECTORY RETURN n.id, n.path
```

For CPG FILE nodes, `n.path` is `null`. This caused:
- `findOrphanNodes()`: `fs.existsSync(null)` → TypeError thrown → entire reconciliation aborted (or CPG nodes treated as orphans → DETACH DELETE'd)
- `findMissingFiles()`: `null` values in `dbPaths` → every real file path appeared "missing" → new filesystem FILE nodes created for every watched file → massive incremental graph update → force simulation reheated completely → fragmentation

Additionally, `reconcileInBackground()` unconditionally called `this.graphView.refresh()` even when zero changes were made — every startup triggered a force simulation reheat for no reason.

The Phase 2 delay was only 2000ms — too short for Phase 1 painting and the force simulation to settle before a potential refresh reheated it.

## DB Inspection

A diagnostic script queried the live FalkorDB at `/Users/brianhenson/projects/temp/example_python/.falkordb`. The current snapshot showed all FILE nodes had `path` set (filesystem nodes), confirming the reconciler was already running cleanly for this snapshot — but the code-level bug was real and would trigger whenever only CPG FILE nodes existed (e.g., after a `clearGraph()` + `reindexAllFiles()`).

## Fixes Applied

### `src/services/sync/Reconciler.ts`

1. **`findOrphanNodes()`** — Added `AND n.path IS NOT NULL` to query; added `if (row.path && ...)` null guard before `fs.existsSync()`.
2. **`findMissingFiles()`** — Added `AND n.path IS NOT NULL` to query so null paths never enter `dbPaths`.
3. **`verifyFileMetadata()`** — Added `WHERE f.path IS NOT NULL`; added null guard before `fs.existsSync()`.
4. **`smartReconciliation()`** — Changed return type from `void` to `boolean`; returns `true` only when orphans were cleaned or files were indexed.
5. **`reconcileInBackground()`** — Now only calls `this.graphView.refresh()` when `hadChanges === true`. Unconditional refresh was reheating the simulation every startup.

### `src/bootstrap.ts`

Phase 2 delay increased from 2000ms → 5000ms to let Phase 1 painting and force simulation settle before any potential reconciliation refresh.

## Diagnostic Logging Added

All logs use `[ComponentName]` prefixes for VS Code Output panel filtering.

- **`GraphViewProvider`**: logs node/link counts + type-bucketed snapshot on full load; logs diff counts on incremental updates; logs "No changes detected" on early returns.
- **`Reconciler`**: logs at each reconciliation phase (start, orphan count, missing files count, complete); warns if CPG nodes leak into the filesystem query.
- **`CpgPipeline`**: logs file name at processing start; logs final node/edge counts per file.
- **`graphWebview.js`**: logs structured JSON snapshots (before/after node counts, type distribution, removed IDs) on each `updateGraph` and `incrementalUpdate` — visible in webview DevTools (Ctrl+Shift+I).

## New Files

- `src/utils/graphSnapshot.ts` — `snapshotGraph(nodes, edges)` utility returning type-bucketed counts for logging.
- `test/unit/services/sync/reconciler.test.ts` — 14 new tests covering: CPG node null-path guarding, missing file detection, `smartReconciliation` boolean return, metadata null guards.

## Test Results

392 pass, 1 pre-existing fail (`graphViewProvider.test.ts` — cannot mock `vscode` in Bun, unchanged).
