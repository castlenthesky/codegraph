---
name: CPG Architecture Details
description: Detailed architecture of the UastBuilder, adapter pattern, node/edge types, and data flow
type: project
---

## UastBuilder (src/graph/cpg/uast/UastBuilder.ts)

Takes a `ParseResult { tree, changedRanges, language }` and a `filePath`. Returns `UastBuildResult { nodes: CpgNode[], edges: CpgEdge[], removedNodeIds: [] }`.

**Walk algorithm:** Recursive DFS over tree-sitter CST. If a CST node type is in the adapter's `nodeMap`, emit a `CpgNode`. If not, skip the node but continue walking its children with the parent's CPG ID (transparent pass-through). This is the pruning mechanism.

**Node ID format:** `${filePath}:${cpgType}:${startRow}:${startCol}` — position-based and deterministic.

**File node:** Every file gets a virtual `file:${filePath}` ID for `SOURCE_FILE` edges. This is separate from the `FILE` UAST node (which comes from parsing the `module`/`program` CST root).

**Edges emitted per mapped node:**
- `SOURCE_FILE`: every non-FILE node → `file:${filePath}`
- `AST`: parent CPG node → child CPG node
- `IS_CALL_FOR_IMPORT`: on `import_statement` or `import_from_statement` → file node

## Adapter Pattern

Each language has an adapter in `src/graph/cpg/uast/adapters/`:
- `TypeScriptAdapter.ts` — exports `TS_NODE_MAP`, `extractNodeProps()`
- `PythonAdapter.ts` — exports `PY_NODE_MAP`, `extractNodeProps()`

`UastBuilder.getAdapter(language)` dispatches to the right adapter. Default: TypeScript.

`extractNodeProps()` signature (shared across adapters):
```typescript
(tsNode: { type, startIndex, endIndex, startPosition, childForFieldName }, source: string, filePath: string): Record<string, unknown>
```
Always returns: `{ code, lineNumber, columnNumber, offset, offsetEnd, filename }` + language-specific fields (`name`, `canonicalName`, etc.)

## Key CpgNodeType values (Joern spec)
FILE, METHOD, TYPE_DECL, MEMBER, LOCAL, NAMESPACE_BLOCK, TYPE_PARAMETER,
BLOCK, CONTROL_STRUCTURE, JUMP_TARGET, RETURN, UNKNOWN,
CALL, IDENTIFIER, LITERAL, FIELD_IDENTIFIER, METHOD_REF, TYPE_REF,
MODIFIER, ANNOTATION

## Key CpgEdgeType values
AST, CFG, REACHING_DEF, CDG, SOURCE_FILE, IS_CALL_FOR_IMPORT,
REF, EVAL_TYPE, CONTAINS, BINDS_TO, INHERITS_FROM, ARGUMENT, RECEIVER

## Known UAST Output Quirks (Python)
- `assignment` (LOCAL) emits a child `IDENTIFIER` at the same position for the left-hand variable. This means the LHS name appears twice: as `LOCAL.name` and as a child `IDENTIFIER`. May want to filter this later.
- `import_from_statement` emits `IDENTIFIER` children for each segment of the module path (`services`, `greeting`, `greet_user`). Only the imported name is semantically needed for taint.
