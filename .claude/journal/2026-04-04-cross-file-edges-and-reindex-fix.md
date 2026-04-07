# 2026-04-04: Cross-File CPG Edges, Reindex Fix, and Force Graph Stability

## Summary

Three-agent fix session targeting the broken force graph visualization: disconnected file clusters, a non-functional Reindex button, and an unstable physics simulation.

---

## Root Causes Diagnosed

### 1. No inter-file edges (primary)
Each file's CPG was processed in complete isolation by `CpgPipeline.processFile()`. When `from api.server import app` was parsed, it created a CALL node but zero edges to `app`'s METHOD node in `server.py`. The force graph had no cross-cluster links, so each file's nodes formed an isolated constellation. The force simulation had nothing pulling them together.

### 2. Reindex was a no-op
The "Full Refresh (Re-index Workspace)" button called `codegraph.fullRefresh` → `executeFullRefresh()` → `reconciler.reconcileInBackground()`. That method only creates FILE/DIRECTORY stubs for missing files — it never calls `CpgPipeline.processFile()`. So clicking Reindex could add empty FILE nodes without CPG content, causing the force simulation to reheat and scatter nodes, making things worse.

### 3. Force physics too warm
`d3VelocityDecay(0.1)` (vs. D3 default 0.4) meant nodes kept churning indefinitely. Every incremental update (even a single file save) reheated the full simulation to alpha=1, causing all previously-settled nodes to scatter.

---

## Fixes

### `src/graph/cpg/ImportResolver.ts` (new file)

A standalone class (no `vscode` dependency) that resolves cross-file import edges after CPG nodes are stored:

- On each file save: clears stale `IMPORT`/`IMPORTS` edges, then queries CALL nodes whose `code` starts with `from`/`import`, resolves module path to disk, creates edges.
- **`IMPORT`** edges: CALL node → METHOD/TYPE_DECL in target file
- **`IMPORTS`** edges: FILE → FILE (file-level import relationship)
- Python: handles absolute (`from api.server import app`), relative (`from .engine import Base`), and multi-name (`from X import a, b, c`) — parses full `code` property since `name` only captures the first token.
- TypeScript: handles relative imports (`import { Foo } from './bar'`), skips bare specifiers.
- External packages silently skipped if file not found on disk.
- `resolveAll(filePaths)` for batch resolution after full reindex.
- 23 unit tests in `test/unit/graph/cpg/importResolver.test.ts`.

**Bug caught during integration**: The agent wrote `if (!Array.isArray(callResult))` but FalkorDB always returns `{ data: [...] }`, never a raw array. Fixed to `callResult?.data`. Test mock also updated to wrap results in `{ data: [...] }`.

### `src/graph/cpg/CpgPipeline.ts` (modified)

- Added `importResolver?: ImportResolver` as optional 7th constructor parameter.
- `processFile()` now calls `importResolver.resolveImportsForFile(filePath)` after `replaceFileSubgraph`.
- New `reindexAllFiles(workspaceRoot, watchFolders)` method: scans watched folders, processes each supported file (`.py`, `.ts`, `.js`), then runs `importResolver.resolveAll()` in a second pass so all nodes exist before cross-file edges are created.

### `src/commands/fullRefresh.ts` (modified)

New sequence: `store.clearGraph()` → `reconciler.ensureWorkspaceRoot()` → `cpgPipeline.reindexAllFiles()` → `reconciler.loadGraphFromDatabase()`. Wrapped in `vscode.window.withProgress` with step messages.

### `src/commands/index.ts` + `src/bootstrap.ts` (modified)

- `CommandDeps` now includes `cpgPipeline: CpgPipeline` and `store: IGraphStore`.
- `bootstrap.ts` creates `ImportResolver(store, workspaceRoot)` and passes it to `CpgPipeline` as the 7th arg (`new CpgPipeline(parserService, uastBuilder, store, graphProvider, undefined, undefined, importResolver)`).

### `media/graphWebview.js` (modified)

- `d3VelocityDecay` 0.1 → 0.3 (nodes settle 3× faster)
- Added `.d3AlphaDecay(0.03)` and `.cooldownTicks(200)`
- `Graph.d3Force('charge').strength(-80)` — stronger repulsion prevents node overlap/collapse
- `Graph.d3Force('link').strength(0.6).distance(40)` — linked nodes pulled to 40px apart
- Small incremental updates (< 10 total node/link changes) immediately set `d3AlphaTarget(0.01)` and reset to 0 after 1.5s — previously-settled nodes barely move on single-file saves
- Added `IMPORT: '#569CD6'` and `IMPORTS: '#569CD6'` to `LINK_COLORS`, `IMPORT: 2` and `IMPORTS: 1.5` to `LINK_WIDTHS`

---

## Test Results

- 378 pre-existing tests: all passing (unchanged)
- 23 new ImportResolver tests: all passing
- 1 pre-existing failure in `graphViewProvider.test.ts` (cannot mock `vscode` in Bun — pre-existing, not introduced here)

---

## Known Limitations

- Python `import X` (bare, non-from) creates a CALL node whose `name` is the module name, not a function. The resolver creates no METHOD-level edge for these — only a FILE→FILE edge if a matching `.py` exists.
- `from . import x` (package-relative with no module name) resolves to `__init__.py` in the current directory; if that file isn't indexed, no edge is created.
- Cross-file edges are only as accurate as the module resolver — complex Python package structures (`sys.path` manipulation, namespace packages) are not handled.
