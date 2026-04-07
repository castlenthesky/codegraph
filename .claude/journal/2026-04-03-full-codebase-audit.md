# 2026-04-03: Full Codebase Audit — Review + Refactor + QA Pipeline

## What happened

Ran a full CPG pipeline audit using an iterative multi-agent workflow: ephemeral Review teams (using the `code-review` skill) → Refactor teams → QA teams. Eight modules audited total, two in parallel for most rounds.

Final test count: **355 pass** (up from 161 at session start) across 10 test files.

---

## Modules audited and key fixes

### UAST Layer (UastBuilder, ParserService, adapters, index)
- `SOURCE_FILE` edge was pointing to a dangling sentinel string (`file:<path>`) instead of the real FILE node id
- `IS_CALL_FOR_IMPORT` edge was semantically inverted (pointed back at the containing file) — removed entirely
- Null guard added on `tsNode.child(i)!` non-null assertion (crash on sparse CST trees)
- Unknown language now throws instead of silently falling back to TypeScript adapter
- Grammar load errors now propagate with root cause (was `catch { return null }`)
- Python `assignment` → `LOCAL` was overclaiming; changed to `UNKNOWN`
- `UastAdapter` interface exported; constructor injection added
- `index.ts` promoted from comment stub to real barrel export

### CFG Layer (CfgBuilder)
- `build()` was mutating its `uastResult` input as undocumented side effect; now returns `{ cfgEdges, newNodes, newEdges }` — **breaking change to return type**
- `processReturn` was emitting orphaned `RETURN → METHOD_RETURN` edge for unreachable returns
- `processSwitch` default-case detection was structurally wrong (substring check on wrong node level)
- Control structure dispatch changed from `node.code.startsWith(...)` to `node.controlStructureType` (canonical Joern field)
- `index.ts` promoted to real barrel export

### PDG Layer (PdgBuilder)
- CDG edges only reached direct AST children (the BLOCK wrapper) — now recursively reaches controlled statements
- CDG condition-exclusion filter was too narrow (missed CALL nodes); replaced with a `BODY_LABELS` allowlist
- Cycle guards added to `findMethodAncestor` and `collectIdentifierUses` (infinite loop on malformed AST)
- Re-definition sites (IDENTIFIER whose parent is LOCAL) excluded from REACHING_DEF targets
- `index.ts` promoted to real barrel export

### Storage/Sync Layer (FalkorDBStore, Reconciler, DiffEngine, queries)
**Two independent data-loss bugs:**
1. `Reconciler.findOrphanNodes` had a third query block that selected ALL non-FILE/non-DIRECTORY nodes and deleted them → wiped all CPG data every background reconciliation cycle
2. `Reconciler.cleanupLegacyNodes` had the identical wildcard delete as a separate code path

Other fixes:
- Cypher injection via string-interpolated file paths in `deleteNodes`/`replaceFileSubgraph` → parameterized queries
- `serializeValue` wasn't escaping `\`, `\n`, `\r` → Cypher parse errors on real code snippets
- Workspace-root orphan false-positive (isolated-node heuristic) — removed
- `safeCpgLabel` fallback from `'CPG'` (not a valid Joern label) → `'UNKNOWN'`
- `edgesToUpdate` in `GraphDiff` was structurally wired but never populated — removed across 4 files
- `GraphData`/`GraphDiff`/`IncrementalPatch` types moved from `DiffEngine.ts` to `src/types/sync.ts`

### Filesystem Layer (FileWatcher, FileScanner)
- `indexWorkspace` was missing `return` before `vscode.window.withProgress(...)` — callers that awaited it resolved immediately before any indexing occurred
- `createParentEdge` wasn't emitting `CONTAINS` edge from `workspace-root` to top-level watch folders in watcher-only path
- `findOrphanedNode` was dead code (superseded by batch orphan query) — deleted
- `reconnectOrphanedChildren` catch was showing user-facing error dialog for non-fatal failure
- `typeRank` moved from per-call local object to module-level const

### CpgPipeline
- `invalidate()` was only clearing the parser cache; stale CPG data remained in FalkorDB indefinitely → now calls `store.replaceFileSubgraph(filePath, [], [])`
- `allNodes`/`allEdges` renamed to `mergedNodes`/`mergedEdges` to prevent future argument-confusion bugs
- `CfgBuilder` and `PdgBuilder` now injectable via optional constructor params (with defaults)
- `catch (error: any)` → `catch (error: unknown)` with proper narrowing

### GraphViewProvider
- `updateView()` was using `(node as any).name` / `(node as any).code` casts — removed; direct property access with safe fallbacks
- Incremental update fallback (`updateView()` in catch block) had no protection if the store was also down — nested try/catch added
- `onDidReceiveMessage` listener not stored as disposable — added `_disposables` array with cleanup

### nodeFactory
- `createFileNode`/`createDirectoryNode` now accept optional pre-fetched `stats?: fs.Stats` to close TOCTOU window
- `node_modules` check changed from substring (`includes`) to exact path segment (`split(path.sep).includes(...)`)
- `extension` field now lowercased before storage (was inconsistent with `detectLanguage`'s normalization)
- `Reconciler.indexMissingFiles` was constructing node objects inline — now uses factory functions
- `Reconciler` was reimplementing `generateId` in two places inline — replaced with canonical import

---

## Workflow notes

The Review → Refactor → QA agent loop worked well. Key things to remember:
- Review agents MUST be explicitly told to use the `code-review` Skill tool — they won't do it automatically
- QA failures after refactor are almost always test alignment issues (tests asserting old behavior), not implementation regressions
- Two or three modules in parallel is fine; context stays clean because each agent is ephemeral
- `graphViewProvider.test.ts` always fails in bun (no `vscode` module) — pre-existing, ignore
