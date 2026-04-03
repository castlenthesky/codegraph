# Code Review Report

**File**: `src/services/FileSystemWatcher.ts`
**Language/Framework**: TypeScript / VS Code Extension API / FalkorDB (Cypher)
**Review Date**: 2026-04-02
**Reviewed Dimensions**: Security · Architecture · Maintainability · Error Handling · Performance · Readability · Testing · Observability · Concurrency

---

## Executive Summary

The FileSystemWatcher is an ambitious piece of infrastructure that tackles one of the hardest problems in file-watching: distinguishing moves from delete+create pairs and keeping a graph database in sync with the filesystem. The soft-delete/reconnect pattern is a thoughtful design choice. However, the module has **critical correctness issues** around directory-level events (VS Code's `FileSystemWatcher` does not emit events for directories), **synchronous filesystem calls on the extension host thread** that will cause UI jank on large workspaces, and **an N+1 query pattern** during orphan reconnection that could saturate the database. The debouncing and batch-processing infrastructure is solid but the event coalescing logic has edge cases that silently drop changes.

---

## Issue Summary

| Severity | Count |
|----------|-------|
| 🔴 Critical | 3 |
| 🟠 High | 4 |
| 🟡 Moderate | 5 |
| 🟢 Low | 3 |
| **Total** | **15** |

---

## 🔴 Critical Issues

### [CR-001] · VS Code FileSystemWatcher does not fire events for directories

**Lines**: L56–L65
**Dimension**: Architecture / Correctness
**Summary**: `vscode.workspace.createFileSystemWatcher` only fires `onDidCreate`, `onDidDelete`, and `onDidChange` for **files**, not directories. Directory creation/deletion events are never received, so the entire directory-handling path in `handleFileCreated` (L219–L231) and `handleFileDeleted` (L266–L289) is dead code in practice.

**Impact**:
When a user creates a new directory (e.g., `src/components/`), no `create` event fires. The directory node is never added to the graph. When files are subsequently created inside it, `createParentEdge` (L344–L363) attempts to link to a parent that doesn't exist, silently creating a broken graph. Similarly, deleting a directory does not trigger `handleFileDeleted`, so the soft-delete/orphan-reconnection path for directory moves (the most complex part of this file) is never exercised for its primary use case.

The user's requirement that "if the change is related to a directory, the changes in subdirectories and files should be recursively detected" cannot be met with the current approach.

**Proposed Fix**:
Use `vscode.workspace.onDidCreateFiles` and `vscode.workspace.onDidDeleteFiles` (which do report directories) **in addition to** the glob watcher. Alternatively, when a file event arrives and the parent directory node doesn't exist in the graph, create the missing directory chain lazily (walk up `path.dirname()` until you hit a known node). For directory deletions, the `onDidDeleteFiles` event or a periodic reconciliation sweep (which `GraphSynchronizer` already supports) is necessary. The rename handler via `onDidRenameFiles` (L67–L71) does handle directories, so that path is fine.

---

### [CR-002] · Synchronous `fs.statSync` / `fs.readdirSync` on the extension host thread

**Lines**: L217, L319, L378, L395, L497
**Dimension**: Performance
**Summary**: Every file creation, change, and orphan reconnection calls `fs.statSync()` or `fs.readdirSync()` synchronously. The VS Code extension host is single-threaded; these calls block the entire extension host process (including all other extensions) while waiting on disk I/O.

**Impact**:
For a single file save this is negligible. But during a `git checkout` that touches hundreds of files, the debounce timer fires and `processBatch` runs: each of the hundreds of queued changes calls `fs.statSync()` synchronously in series. On a networked filesystem (common in enterprise environments) or a large monorepo, this can cause multi-second UI freezes. `readdirSync` in `reconnectOrphanedChildren` (L497) is especially dangerous because it can recursively walk large directory trees.

**Proposed Fix**:
Replace all `fs.statSync` with `fs.promises.stat` (async) and `fs.readdirSync` with `fs.promises.readdir`. These are already inside async methods, so the refactor is straightforward. Use `vscode.workspace.fs.stat()` for even better integration (respects VS Code's virtual filesystem layer and remote development).

---

### [CR-003] · `String.replace` in `updateDescendantPaths` uses first-match-only replacement

**Lines**: L679
**Dimension**: Correctness
**Summary**: `oldRelPath.replace(oldParentRelPath, newParentRelPath)` uses `String.prototype.replace` with a string argument, which only replaces the **first occurrence**. If a directory name is repeated in the path (e.g., renaming `src/utils` when a descendant is `src/utils/utils/helper.ts`), the second `utils` segment is left unchanged, producing a corrupted path like `src/newname/utils/helper.ts` instead of correctly only replacing the prefix.

**Impact**:
Silent data corruption in the graph. The descendant node's `relativePath`, `path`, and `id` will be incorrect. Subsequent operations on that node (updates, deletes, edge creation) will fail silently because the ID no longer matches reality. This is a correctness bug that would be very hard to diagnose in production.

**Proposed Fix**:
Replace the string `replace` with an explicit prefix check and slice:

```typescript
if (!oldRelPath.startsWith(oldParentRelPath)) {
    console.warn(`Descendant path ${oldRelPath} does not start with expected prefix ${oldParentRelPath}`);
    continue;
}
const suffix = oldRelPath.slice(oldParentRelPath.length);
const newRelPath = newParentRelPath + suffix;
```

This ensures only the prefix is replaced, regardless of path segment repetition.

---

## 🟠 High Issues

### [HI-001] · N+1 query pattern in `reconnectOrphanedChildren`

**Lines**: L557–L607
**Dimension**: Performance
**Summary**: The fallback loop on L557–L607 issues **three separate database queries per filesystem entry**: one to check if the child exists (L567–L569), one to find an orphaned node by name (L578), and then one or more to update/create the node. For a directory with 100 files, this is 300+ round-trips to FalkorDB.

**Impact**:
This runs after every directory creation event (if CR-001 is fixed) or directory move. In a large project with deep directory trees, this will cause noticeable latency and database contention. Combined with the recursive nature of `reconnectOrphanedChildren` calling itself (L601), the query count grows multiplicatively with tree depth.

**Proposed Fix**:
Batch the existence check into a single query: collect all expected child IDs, then issue one `MATCH (n) WHERE n.id IN $ids RETURN n.id` query. For orphan discovery, query all orphaned nodes of the relevant type at once rather than per-name. This reduces the query count from O(n * depth) to O(depth).

---

### [HI-002] · `findOrphanedNode` matches by name only — ambiguous in multi-directory workspaces

**Lines**: L617–L639
**Dimension**: Correctness
**Summary**: `findOrphanedNode` searches for any node with a matching `name` and no parent edge, returning `LIMIT 1`. If two directories each contained a file named `utils.ts` and both were deleted, this query returns an arbitrary one — potentially reconnecting the wrong node to the wrong parent.

**Impact**:
Silent graph corruption: a node from `src/auth/utils.ts` could be reconnected as `src/api/utils.ts`, carrying the wrong metadata (size, timestamps, language) and potentially wrong edges to code symbols parsed from the original file.

**Proposed Fix**:
Add additional matching criteria: file extension, approximate size, or use the `recentlyDeletedDirs` cache more aggressively. Alternatively, when the cache miss occurs, skip orphan reconnection entirely and create a fresh node — the stale orphan will be cleaned up by `hardDeleteExpiredNodes`.

---

### [HI-003] · Cypher injection via label interpolation in `findOrphanedNode`

**Lines**: L620–L621
**Dimension**: Security
**Summary**: The query `MATCH (n:${label} {name: $name})` interpolates the `label` variable directly into the Cypher query string. While `label` is currently derived from a boolean (`isDirectory ? 'DIRECTORY' : 'FILE'`), making it safe today, this pattern is fragile. If the label derivation changes or if this method is called from a different context, it becomes a Cypher injection vector.

**Impact**:
Currently low risk because the input is controlled. However, this is the only query in the file that uses string interpolation for structural elements — all others correctly use `$param` parameterization. Inconsistency increases the chance of a future contributor copy-pasting this pattern with user-controlled input.

**Proposed Fix**:
Use a parameterized label approach or validate the label against an allowlist:

```typescript
const validLabels = new Set(['DIRECTORY', 'FILE']);
if (!validLabels.has(label)) {
    throw new Error(`Invalid label: ${label}`);
}
```

Note: FalkorDB/Cypher does not support parameterized labels, so allowlist validation is the correct approach.

---

### [HI-004] · `handleFileChanged` skips graph refresh — content changes are invisible

**Lines**: L309–L338
**Dimension**: Architecture
**Summary**: The comment on L332–L333 says "We don't refresh the graph view for simple metadata changes to avoid too many updates." But `handleFileChanged` fires for **any** file save, including content changes that would require re-parsing for the CPG (new functions, deleted classes, changed imports). By not triggering a refresh or re-parse, the Code Property Graph becomes stale after every edit.

**Impact**:
The core value proposition of this extension — a live, up-to-date Code Property Graph — is undermined. After editing a file, the graph continues showing the pre-edit structure until the user restarts the extension or triggers a manual reindex.

**Proposed Fix**:
At minimum, mark the file node as `isParsed: false` when a content change is detected, so that the next graph view refresh knows to re-parse it. Ideally, trigger a debounced re-parse for the changed file (not a full graph refresh) to keep the CPG current. The metadata-only update (size, mtime) is correct as a first step, but it should be followed by a parse invalidation.

---

## 🟡 Moderate Issues

### [MD-001] · `graphViewProvider` typed as `any`

**Lines**: L25
**Dimension**: Maintainability
**Summary**: `private graphViewProvider: any` bypasses all type checking. Any call to `this.graphViewProvider.refresh()` is unchecked.

**Impact**:
If the `GraphViewProvider` interface changes (method renamed, signature updated), no compile-time error surfaces — only a silent runtime failure where `typeof provider.refresh === 'function'` returns false and the UI silently stops updating.

**Proposed Fix**:
Import `GraphViewProvider` (already used by `GraphSynchronizer`) and type the field as `GraphViewProvider | undefined`. This also eliminates the need for the runtime `typeof` check on L369.

---

### [MD-002] · Duplicated code between `FileSystemWatcher` and `FileSystemIndexer`

**Lines**: L377–L438 (watcher) vs. FileSystemIndexer L150–L220
**Dimension**: Maintainability / DRY
**Summary**: `createDirectoryNode`, `createFileNode`, `detectLanguage`, and `generateId` are **identically duplicated** between `FileSystemWatcher` and `FileSystemIndexer`. Same logic, same language map, same ID generation.

**Impact**:
Any change to the ID generation scheme, language map, or node shape must be made in two places. If they drift, the watcher creates nodes with different IDs or properties than the indexer, causing phantom duplicates or failed lookups in the graph.

**Proposed Fix**:
Extract these four methods into a shared utility (e.g., `src/services/NodeFactory.ts` or `src/utils/graphHelpers.ts`) and import from both services.

---

### [MD-003] · Event coalescing drops legitimate `change` events

**Lines**: L88–L101
**Dimension**: Correctness
**Summary**: The `queueChange` method's coalescing logic has a gap: if a `create` event is queued first and then a `change` event arrives for the same path, the `change` is silently dropped (falls through to the `else` block at L100 which only sets if `!existing`). This means if a file is created and immediately modified (common in editor "save new file" flows), the modification metadata is lost.

**Impact**:
The initial file node is created with the stats from creation time, missing the subsequent modification. For the CPG use case, this means the first content change after file creation could be missed.

**Proposed Fix**:
Update the coalescing logic to allow `change` to override `create`:

```typescript
if (type === 'delete') {
    this.pendingChanges.set(key, { type, uri, timestamp: Date.now() });
} else if (type === 'create' || (type === 'change' && existing.type !== 'delete')) {
    this.pendingChanges.set(key, { type: existing.type === 'create' ? 'create' : type, uri, timestamp: Date.now() });
}
```

Or simpler: always update the timestamp for non-delete overwrites so the batch processor uses fresh metadata.

---

### [MD-004] · `dispose()` doesn't flush pending changes

**Lines**: L714–L732
**Dimension**: Correctness
**Summary**: `dispose()` clears the debounce timer and pending changes without processing them. If the extension is deactivated while changes are queued, those changes are silently lost.

**Impact**:
During extension deactivation (e.g., window close, extension disable), any file changes that occurred in the last 500ms debounce window are dropped. The graph will be stale on next activation.

**Proposed Fix**:
Add a synchronous `processBatch` flush before clearing state, or at minimum persist the pending change paths so `GraphSynchronizer`'s reconciliation sweep can pick them up on next activation.

---

### [MD-005] · `workspaceRoot` is set once in constructor — no multi-root workspace support

**Lines**: L37–L38
**Dimension**: Architecture
**Summary**: `this.workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || ''` takes only the first workspace folder. VS Code supports multi-root workspaces where multiple folders are open simultaneously.

**Impact**:
Files in the second, third, etc. workspace folders are never watched. `path.relative()` calls against the wrong root produce paths starting with `../`, generating invalid node IDs. This is a known limitation but worth flagging since it affects correctness silently rather than with an explicit error.

**Proposed Fix**:
Either: (a) document this as a known limitation and add a guard that warns users in multi-root workspaces, or (b) iterate over all workspace folders and create a watcher per folder. Option (a) is pragmatic for now.

---

## 🟢 Low Issues

### [LO-001] · Hidden file / `node_modules` exclusion is inconsistent

**Lines**: L233–L235 vs. L558–L559
**Dimension**: Maintainability
**Summary**: The `handleFileCreated` method skips files starting with `.` or containing `node_modules` (L233–L235), but only for files, not directories. The `reconnectOrphanedChildren` fallback loop (L558) checks for both. The `handleFileDeleted` and `handleFileRenamed` methods have no such exclusion — they'll process hidden files and `node_modules` if events arrive.

**Proposed Fix**:
Extract the exclusion logic into a shared `shouldIgnorePath(absolutePath: string): boolean` predicate and apply it consistently at the `queueChange` entry point, before any path enters the pending changes map.

---

### [LO-002] · `recentlyDeletedDirs` cache cleanup only runs on delete events

**Lines**: L281, L696–L709
**Dimension**: Maintainability
**Summary**: `cleanupDeletedDirsCache()` is only called inside `handleFileDeleted`. If no delete events occur for a long time, stale entries persist in memory indefinitely (though bounded by the number of past deletes).

**Proposed Fix**:
Also run `cleanupDeletedDirsCache()` at the start of `processBatch`, which is guaranteed to run for any type of event.

---

### [LO-003] · Magic numbers without named constants

**Lines**: L34, L30
**Dimension**: Readability
**Summary**: `DEBOUNCE_DELAY_MS = 500` and `DIR_CACHE_TTL_MS = 5000` are named, which is good. But the constant on L126 (`typeRank = { 'rename': 0, 'delete': 1, 'change': 2, 'create': 3 }`) defines processing order without explaining why this ordering matters.

**Proposed Fix**:
Add a brief comment explaining the topological rationale: renames must be processed first to update IDs before other operations reference them, deletes before creates to handle move-as-delete+create, etc.

---

## What's Working Well

- **Soft-delete with TTL-based hard-delete** (L170–L181, L283–L289): This is a clever pattern for handling the ambiguity between "real delete" and "first half of a move." The 5-second grace period with `isSoftDeleted` timestamp is a pragmatic solution to a genuinely hard problem.
- **Batch processing with debounce** (L104–L166): The debounce + sort-by-type-then-path-length approach correctly handles the common case of rapid filesystem events (e.g., git operations) without hammering the database. The topological sort ensures parents are processed before children.
- **Idempotent node creation** (L224–L225, L242–L243): Stripping `isSoftDeleted` on create handles the case where a soft-deleted node is "resurrected" by a re-creation at the same path — good defensive programming.
- **Clean disposal** (L714–L732): The `dispose()` method properly clears all timers, maps, and watchers. The ordering is correct (timer first, then state, then watchers).

---

## Systemic Observations

**Error handling is inconsistent across the module.** Some methods show user-facing `vscode.window.showErrorMessage` (L253, L303, L610), others only log to console (L157, L179, L459), and some swallow errors and return defaults (L458–L460). There's no clear principle governing which errors are user-visible vs. silent. For a background service like this, a consistent approach would be: log everything with context, surface only errors that require user action.

**The file lacks a clear boundary between "event routing" and "graph mutation" responsibilities.** The class handles event debouncing, filesystem inspection, graph node/edge creation, orphan reconnection, and cache management. This is a lot of responsibility for one class. The event routing (queueChange, processBatch, debouncing) could be separated from the graph mutation logic (handle*, reconnect*, update*) to improve testability and reduce cognitive load.

**Test coverage is minimal.** The existing test file (`watcher.test.ts`) only tests two trivial private methods (`generateId` and `detectLanguage`) via `any` casting. None of the core logic — event coalescing, batch processing, soft-delete, orphan reconnection, rename handling — is tested. Given the complexity of the state machine in this module, this is a significant risk.

---

## Assumptions and Context Gaps

- **I assumed FalkorDB's Cypher dialect behaves like standard openCypher** for features like `[:CONTAINS*]` variable-length path traversal. If FalkorDB has different semantics for recursive path queries, the severity of the descendant-related issues could change.
- **I could not determine whether `GraphSynchronizer`'s reconciliation sweep compensates for CR-001** (missing directory events). If it does a full filesystem diff on activation, directory tracking may work on restart even though live events are missed. This would downgrade CR-001 from Critical to High for the "live" use case.
- **I assumed the extension targets local workspaces.** If remote development (SSH, WSL, containers) is a target, the `fs.statSync` / `fs.readdirSync` calls become even more critical to fix, as remote filesystem calls have significantly higher latency.
- **The `FalkorDBService.createNode` method is idempotent** (checks for existing node before creating). This means some of the "double-creation" scenarios I considered are handled at the DB layer. However, the ID must match exactly for this protection to work, which ties back to CR-003's path corruption concern.
