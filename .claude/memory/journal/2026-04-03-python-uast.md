# Journal: Python UAST Pipeline — 2026-04-03

## Task
Add Python support to the UAST layer so the Python `hello_world.py` fixture can be processed from CST → UAST and output to an auditable snapshot file.

## What We Did

### 1. Explored the design
Read `design/02_planned/CPG/01-UAST-Layer.md` and the Python CST snapshot (`test/__snapshots__/tree-sitter-cst/python/python_hello_world.json`). Understood that the CST is 441 lines of syntactic noise for a 6-line file, and the UAST goal is a terse, semantically meaningful representation using Joern node types with full source location metadata on every node.

### 2. Mapped the transformation
For `hello_world.py`, the key CST → UAST mappings:
- `module` → `FILE` (root)
- `import_from_statement` → `CALL` + `IS_CALL_FOR_IMPORT` edge
- `if_statement` → `CONTROL_STRUCTURE`
- `block` → `BLOCK`
- `assignment` → `LOCAL` (with `name` from left-hand side)
- `call` → `CALL` (with `name` from `function` field)
- `identifier` → `IDENTIFIER`
- `string` → `LITERAL` (collapses the 3-node CST subtree: `string_start` + `string_content` + `string_end`)
- Noise nodes (`dotted_name`, `relative_import`, `comparison_operator`, `argument_list`, `string_start/end`) → transparent pass-through (not emitted, children still walked)

### 3. Files changed
| File | Action |
|------|--------|
| `src/graph/cpg/uast/adapters/PythonAdapter.ts` | Created — `PY_NODE_MAP` (24 mappings) + `extractNodeProps()` |
| `src/graph/cpg/uast/UastBuilder.ts` | Modified — added `getAdapter(language)` dispatch, extended `IS_CALL_FOR_IMPORT` check to cover `import_from_statement` |
| `scripts/generate-uast-snapshot.ts` | Created — CLI script that parses a language fixture with tree-sitter and writes UAST JSON |

### 4. Result
```
[python] 20 nodes, 39 edges → test/__snapshots__/uast/python/python_hello_world.json
```
All 392 existing unit tests pass.

## Key Learnings

### CST → UAST reduction
The UAST is not as terse in raw line count as expected (435 lines of JSON vs 441 CST). The node count reduction is the real signal: 20 UAST nodes vs ~80+ CST nodes. The JSON is verbose because of the edge array and repeated metadata. The actual node information density is much higher per node.

### Transparent pass-through is the pruning mechanism
`UastBuilder`'s walk loop already handles unmapped nodes correctly: if `nodeMap[tsNode.type]` is undefined, it skips the node but recurses into its children with the *parent's* CPG ID. This means unmapped nodes are transparent — their children get attached directly to the nearest mapped ancestor. No special "skip" logic needed in adapters.

### Two known UAST output quirks to revisit
1. **Duplicate LHS identifier**: Python `assignment` (→ `LOCAL`) also walks into its `identifier` child (→ `IDENTIFIER`) at the same position. The variable name appears as `LOCAL.name` AND as a child `IDENTIFIER` node. For taint purposes this is probably fine but slightly redundant.
2. **Module path identifiers in imports**: `from .services.greeting import greet_user` emits `IDENTIFIER` nodes for `services`, `greeting`, and `greet_user`. For taint analysis, only `greet_user` (the imported symbol) matters.

### Script vs test pattern
Scripts in `scripts/` can use real tree-sitter native bindings directly (like `parse.ts` does). Tests cannot — they must mock tree-sitter entirely because bun's ABI breaks native add-ons. This distinction matters when deciding where to put new code: scripts for dev tooling, mocked fakes for unit tests.

### Adapter is 3 things
Each language adapter needs exactly three things: (1) a node map (`Record<string, CpgNodeType>`), (2) an `extractNodeProps()` function with the same signature, (3) a case in `UastBuilder.getAdapter()`. That's the full contract.

## Next Steps (not committed to, just observed)
- Filter redundant `IDENTIFIER` children of `LOCAL` (assignment LHS)
- Filter module-path `IDENTIFIER` nodes inside `import_from_statement` — only keep the imported name
- Add adapters for Go, Rust, Java, JavaScript (CST snapshots already exist)
- Consider adding `argumentIndex` to `IDENTIFIER` children of `CALL` nodes (needed for precise taint tracking of which argument position is tainted)
