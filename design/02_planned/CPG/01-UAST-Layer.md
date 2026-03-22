# UAST Layer - Universal Abstract Syntax Tree

## Overview

The UAST (Universal Abstract Syntax Tree) layer provides a language-agnostic representation of source code structure based on the **Joern CPG specification**. This layer forms the foundation of the Code Property Graph, ensuring consistent node types and relationships across all supported programming languages.

## File System Layer

### Foundation: Project Structure Graph

**Before** parsing code into abstract syntax trees, the UAST layer first indexes the project's file system structure. This creates a foundational graph of directories and files that provides context for all subsequent code analysis.

### File System Indexing Process

```
Project Root
     ↓
File System Watcher (VS Code API)
     ↓
Directory/File Events (create, delete, rename)
     ↓
File System Graph Nodes (Directory, File)
     ↓
FalkorDB Storage
     ↓
Code Parsing (UAST nodes link to File nodes)
```

### File System Node Types

#### Directory Node

Represents a folder in the project structure.

```typescript
interface DirectoryNode {
  id: string;                    // Unique identifier
  label: 'DIRECTORY';            // Node type
  name: string;                  // Directory name (e.g., "src")
  path: string;                  // Absolute path
  relativePath: string;          // Path relative to workspace root
  createdAt: number;             // Unix timestamp
  modifiedAt: number;            // Unix timestamp
}
```

#### File Node

Represents a source file or resource in the project.

```typescript
interface FileNode {
  id: string;                    // Unique identifier
  label: 'FILE';                 // Node type
  name: string;                  // File name with extension (e.g., "app.ts")
  path: string;                  // Absolute path
  relativePath: string;          // Path relative to workspace root
  extension: string;             // File extension (e.g., ".ts", ".py")
  language: string;              // Detected language (e.g., "typescript", "python")
  size: number;                  // File size in bytes
  createdAt: number;             // Unix timestamp
  modifiedAt: number;            // Unix timestamp
  isParsed: boolean;             // Whether UAST has been generated
}
```

### File System Edge Types

| Edge Type | Description | Example |
|-----------|-------------|---------|
| `CONTAINS` | Directory contains file/subdirectory | `src/` → `main.ts` |
| `PARENT` | Child to parent directory relationship | `utils/` → `src/` |

### File System Events

The extension monitors these VS Code file system events:

1. **File Created** (`workspace.onDidCreateFiles`)
   - Create `FILE` node
   - Create `CONTAINS` edge from parent directory
   - Queue file for parsing if it's a supported language

2. **File Deleted** (`workspace.onDidDeleteFiles`)
   - Remove `FILE` node and all UAST nodes within it
   - Remove all edges connected to the file
   - Remove from parsing queue

3. **File Renamed** (`workspace.onDidRenameFiles`)
   - Update `FILE` node path properties
   - Update all UAST nodes' file references
   - Re-detect language if extension changed

4. **Directory Created**
   - Create `DIRECTORY` node
   - Create `CONTAINS` edge from parent directory
   - Recursively index child files/directories

5. **Directory Deleted**
   - Recursively remove all child nodes
   - Remove all edges

### Example File System Graph

```cypher
// Project structure:
// project-root/
//   src/
//     services/
//       auth.ts
//     app.ts
//   tests/
//     app.test.ts

// Graph representation:
(root:DIRECTORY {name: "project-root", relativePath: "/"})
(src:DIRECTORY {name: "src", relativePath: "/src"})
(services:DIRECTORY {name: "services", relativePath: "/src/services"})
(tests:DIRECTORY {name: "tests", relativePath: "/tests"})
(authFile:FILE {name: "auth.ts", language: "typescript"})
(appFile:FILE {name: "app.ts", language: "typescript"})
(testFile:FILE {name: "app.test.ts", language: "typescript"})

// Relationships:
(root)-[:CONTAINS]->(src)
(root)-[:CONTAINS]->(tests)
(src)-[:CONTAINS]->(services)
(src)-[:CONTAINS]->(appFile)
(services)-[:CONTAINS]->(authFile)
(tests)-[:CONTAINS]->(testFile)
```

## Joern CPG Specification

### Reference: [cpg.joern.io](https://cpg.joern.io/)

Joern defines a comprehensive set of universal node types that represent programming constructs independent of the source language. Our UAST layer implements this specification to ensure:

1. **Cross-language consistency**: Same node types for equivalent constructs
2. **Standard query interface**: Uniform queries work across all languages
3. **Proven architecture**: Based on academic research and production usage
4. **Extensibility**: Clear guidelines for adding new languages

### File System to Code Linking

All Joern UAST nodes (METHOD, TYPE_DECL, etc.) are linked to their containing `FILE` node:

```cypher
// Example: Method belongs to a file
(method:METHOD {name: "authenticate", fullName: "auth.authenticate"})
(file:FILE {name: "auth.ts"})

(method)-[:DEFINED_IN]->(file)
```

### Core Joern Node Types

The UAST implements these primary node categories from Joern:

#### 1. Declaration Nodes

| Joern Type | Description | Example |
|------------|-------------|---------|
| `METHOD` | Function/method declarations | `function foo() {}` (JS), `def foo():` (Python) |
| `TYPE_DECL` | Class/struct/interface declarations | `class User {}` (TS), `struct Point` (Go) |
| `MEMBER` | Class fields/properties | `private name: string` (TS) |
| `LOCAL` | Local variable declarations | `const x = 5` (JS), `x := 5` (Go) |
| `NAMESPACE_BLOCK` | Module/package/namespace | `namespace App {}` (TS), `package main` (Go) |
| `TYPE_PARAMETER` | Generic type parameters | `<T>` (TS), `<T: Trait>` (Rust) |

#### 2. Statement Nodes

| Joern Type | Description | Example |
|------------|-------------|---------|
| `BLOCK` | Code block/scope | `{ ... }` |
| `CONTROL_STRUCTURE` | If/while/for/switch | `if (x > 0) {}`, `for item in list:` |
| `JUMP_TARGET` | Labels for goto/break | `case 1:`, `default:` |
| `RETURN` | Return statement | `return result` |
| `UNKNOWN` | Unparseable/error nodes | Syntax error recovery |

#### 3. Expression Nodes

| Joern Type | Description | Example |
|------------|-------------|---------|
| `CALL` | Method/function invocation | `console.log()`, `print()` |
| `IDENTIFIER` | Variable/function reference | `userName`, `calculateTotal` |
| `LITERAL` | Constant values | `42`, `"hello"`, `true` |
| `FIELD_IDENTIFIER` | Member access | `user.name`, `obj.method` |
| `METHOD_REF` | Method reference | `::toString` (Java), lambda refs |
| `TYPE_REF` | Type reference | `: string` (TS), `int` (C) |

#### 4. Modifier Nodes

| Joern Type | Description | Example |
|------------|-------------|---------|
| `MODIFIER` | Access/storage modifiers | `private`, `static`, `async` |
| `ANNOTATION` | Decorators/attributes | `@Override` (Java), `@decorator` (Python) |

### Joern Node Properties

Each UAST node includes these standard properties (from Joern spec):

```typescript
interface UASTNode {
  // Core identification
  id: string;                    // Unique node identifier
  label: JoernNodeType;          // Node type from Joern spec

  // Source location
  code: string;                  // Source code snippet
  name: string;                  // Symbol name (if applicable)
  fullName: string;              // Fully qualified name
  signature: string;             // Type signature (for methods/types)

  lineNumber: number;            // Start line
  lineNumberEnd: number;         // End line
  columnNumber: number;          // Start column
  columnNumberEnd: number;       // End column

  // Language metadata
  language: string;              // Source language (typescript, python, etc.)

  // Type information
  typeFullName: string;          // Fully qualified type
  dynamicTypeHintFullName: string[]; // Runtime type hints

  // Additional properties
  order: number;                 // Child order in parent
  argumentIndex: number;         // Parameter position (for arguments)
  isExternal: boolean;           // External library symbol
}
```

### Joern Edge Types (AST Layer)

#### File System Edges

| Edge Type | Description | Example |
|-----------|-------------|---------|
| `CONTAINS` | Directory contains file/subdirectory | Directory → File/Directory |
| `PARENT` | Child to parent directory relationship | Directory → Parent Directory |
| `DEFINED_IN` | Code node defined in file | METHOD/TYPE_DECL → File |

#### Code Structure Edges

| Edge Type | Description | Example |
|-----------|-------------|---------|
| `AST` | Parent-child relationship | Function → Block → Statement |
| `REF` | Reference to declaration | Identifier → Local/Member |
| `EVAL_TYPE` | Expression type | Expression → Type |
| `INHERITS_FROM` | Inheritance relationship | Class → Superclass |
| `BINDS_TO` | Generic type binding | TypeParam → ConcreteType |

## Tree-sitter Integration

### Architecture

```
Source Code (Language-Specific)
        ↓
Tree-sitter Parser (CST)
        ↓
Language Adapter (Mapping Layer)
        ↓
Joern UAST Nodes (Universal)
        ↓
FalkorDB Storage
```

### Language Adapters

Each supported language has an adapter that maps tree-sitter CST nodes to Joern UAST nodes:

#### TypeScript/JavaScript Adapter

```typescript
class TypeScriptUASTAdapter {
  mapNode(tsNode: TSNode): UASTNode {
    switch (tsNode.type) {
      case 'function_declaration':
        return this.createMethodNode(tsNode);

      case 'class_declaration':
        return this.createTypeDeclNode(tsNode);

      case 'variable_declarator':
        return this.createLocalNode(tsNode);

      case 'call_expression':
        return this.createCallNode(tsNode);

      case 'if_statement':
        return this.createControlStructureNode(tsNode, 'IF');

      case 'identifier':
        return this.createIdentifierNode(tsNode);

      case 'string':
      case 'number':
      case 'true':
      case 'false':
        return this.createLiteralNode(tsNode);

      default:
        return this.createUnknownNode(tsNode);
    }
  }

  private createMethodNode(tsNode: TSNode): UASTNode {
    const name = this.extractName(tsNode);
    const params = this.extractParameters(tsNode);
    const returnType = this.extractReturnType(tsNode);

    return {
      id: this.generateId(tsNode),
      label: 'METHOD',
      name: name,
      fullName: this.getFullyQualifiedName(name),
      signature: this.buildSignature(name, params, returnType),
      code: tsNode.text,
      lineNumber: tsNode.startPosition.row + 1,
      lineNumberEnd: tsNode.endPosition.row + 1,
      columnNumber: tsNode.startPosition.column + 1,
      columnNumberEnd: tsNode.endPosition.column + 1,
      language: 'javascript',
      order: tsNode.childIndex,
      isExternal: false,
    };
  }

  private createCallNode(tsNode: TSNode): UASTNode {
    const functionNode = tsNode.childForFieldName('function');
    const argsNode = tsNode.childForFieldName('arguments');

    return {
      id: this.generateId(tsNode),
      label: 'CALL',
      name: functionNode?.text || '<unknown>',
      code: tsNode.text,
      // ... other properties
    };
  }
}
```

#### Python Adapter

```typescript
class PythonUASTAdapter {
  mapNode(pyNode: TSNode): UASTNode {
    switch (pyNode.type) {
      case 'function_definition':
        return this.createMethodNode(pyNode);

      case 'class_definition':
        return this.createTypeDeclNode(pyNode);

      case 'assignment':
        return this.createLocalNode(pyNode);

      case 'call':
        return this.createCallNode(pyNode);

      case 'if_statement':
      case 'while_statement':
      case 'for_statement':
        return this.createControlStructureNode(pyNode);

      // ... similar mappings
    }
  }
}
```

#### Go Adapter

```typescript
class GoUASTAdapter {
  mapNode(goNode: TSNode): UASTNode {
    switch (goNode.type) {
      case 'function_declaration':
      case 'method_declaration':
        return this.createMethodNode(goNode);

      case 'type_declaration':
        return this.createTypeDeclNode(goNode);

      case 'var_spec':
      case 'short_var_declaration':
        return this.createLocalNode(goNode);

      // ... Go-specific mappings
    }
  }
}
```

### Tree-sitter Query Patterns

Each adapter uses tree-sitter query patterns to extract constructs:

#### Universal Function Query

```scheme
;; TypeScript/JavaScript
(function_declaration
  name: (identifier) @func.name
  parameters: (formal_parameters) @func.params
  body: (statement_block) @func.body)

;; Python
(function_definition
  name: (identifier) @func.name
  parameters: (parameters) @func.params
  body: (block) @func.body)

;; Go
(function_declaration
  name: (identifier) @func.name
  parameters: (parameter_list) @func.params
  body: (block) @func.body)
```

## Incremental Parsing Strategy

### Initial Workspace Indexing

When the extension first activates:

1. **Discover workspace files**: Use `workspace.findFiles()` to locate all source files
2. **Build file system graph**: Create `DIRECTORY` and `FILE` nodes for entire project structure
3. **Queue files for parsing**: Add all discovered source files to parsing queue
4. **Background parsing**: Process queue asynchronously to avoid blocking VS Code
5. **Progress reporting**: Show progress notification to user

```typescript
async function indexWorkspace(workspaceRoot: string): Promise<void> {
  // Find all source files (exclude node_modules, .git, etc.)
  const files = await vscode.workspace.findFiles(
    '**/*.{ts,js,py,go,rs,java}',
    '**/node_modules/**'
  );

  // Build directory structure
  const directories = extractDirectories(files);
  await createDirectoryNodes(directories);

  // Create file nodes
  for (const file of files) {
    await createFileNode(file);
  }

  // Queue for parsing
  parsingQueue.enqueue(files);
}
```

### Trigger: File Save Events

**Why Save, Not Keystroke?**
- Reduces CPU overhead (no constant reparsing)
- Ensures only complete, intentional changes are processed
- Developer can make multiple edits before triggering update
- Predictable performance characteristics

**File System Events as Triggers:**
- File save events trigger UAST re-parsing for that file
- File creation events add new `FILE` node and queue for initial parsing
- File deletion events remove all associated UAST nodes
- Directory events propagate to contained files

### Update Pipeline

```
┌─────────────────────────────────────────────────────────┐
│  1. File Save Event Detected                            │
│     - VS Code onDidSaveTextDocument                     │
└─────────────────────────────────────────────────────────┘
                       ↓
┌─────────────────────────────────────────────────────────┐
│  2. Parse Changed File                                  │
│     - Tree-sitter incremental parse                     │
│     - Generate new CST                                  │
└─────────────────────────────────────────────────────────┘
                       ↓
┌─────────────────────────────────────────────────────────┐
│  3. Extract UAST Nodes                                  │
│     - Apply language adapter                            │
│     - Map CST → Joern nodes                             │
└─────────────────────────────────────────────────────────┘
                       ↓
┌─────────────────────────────────────────────────────────┐
│  4. Diff Analysis                                       │
│     - Compare new UAST with cached version              │
│     - Identify: Added, Removed, Modified nodes          │
└─────────────────────────────────────────────────────────┘
                       ↓
┌─────────────────────────────────────────────────────────┐
│  5. Dependency Impact Analysis                          │
│     - Query FalkorDB for dependent files:               │
│       • Files importing removed symbols                 │
│       • Files referencing modified types                │
│       • Transitive dependencies                         │
└─────────────────────────────────────────────────────────┘
                       ↓
┌─────────────────────────────────────────────────────────┐
│  6. Surgical Re-parsing (if needed)                     │
│     - Parse only impacted files                         │
│     - Update their UAST nodes                           │
└─────────────────────────────────────────────────────────┘
                       ↓
┌─────────────────────────────────────────────────────────┐
│  7. Database Transaction                                │
│     - BEGIN transaction                                 │
│     - DELETE removed nodes/edges                        │
│     - CREATE new nodes/edges                            │
│     - UPDATE modified nodes                             │
│     - COMMIT                                            │
└─────────────────────────────────────────────────────────┘
```

### Implementation Example

```typescript
class IncrementalUASTBuilder {
  private cache: Map<string, UASTNode[]> = new Map();
  private db: FalkorDBClient;

  async onFileSave(filePath: string): Promise<void> {
    // 1. Parse the saved file
    const newAST = await this.parseFile(filePath);

    // 2. Get cached version
    const oldAST = this.cache.get(filePath) || [];

    // 3. Compute diff
    const diff = this.computeDiff(oldAST, newAST);

    // 4. Find dependent files
    const dependentFiles = await this.findDependentFiles(
      filePath,
      diff.removed,
      diff.modified
    );

    // 5. Parse dependent files (surgical)
    const dependentUpdates = await this.parseDependentFiles(dependentFiles);

    // 6. Apply all updates to database
    await this.applyUpdates(filePath, diff, dependentUpdates);

    // 7. Update cache
    this.cache.set(filePath, newAST);
  }

  private async findDependentFiles(
    changedFile: string,
    removedNodes: UASTNode[],
    modifiedNodes: UASTNode[]
  ): Promise<string[]> {
    const exportedSymbols = this.extractExportedSymbols(
      removedNodes.concat(modifiedNodes)
    );

    if (exportedSymbols.length === 0) {
      return []; // No external impact
    }

    // Query database for files importing these symbols
    const query = `
      MATCH (file:File)-[:IMPORTS]->(symbol:Symbol)
      WHERE symbol.name IN $symbols
        AND file.path <> $changedFile
      RETURN DISTINCT file.path
    `;

    const result = await this.db.query(query, {
      symbols: exportedSymbols.map(s => s.name),
      changedFile: changedFile
    });

    return result.map(r => r['file.path']);
  }

  private computeDiff(
    oldNodes: UASTNode[],
    newNodes: UASTNode[]
  ): UASTDiff {
    const oldMap = new Map(oldNodes.map(n => [n.fullName, n]));
    const newMap = new Map(newNodes.map(n => [n.fullName, n]));

    const added: UASTNode[] = [];
    const removed: UASTNode[] = [];
    const modified: UASTNode[] = [];

    // Find added and modified
    for (const [name, newNode] of newMap) {
      const oldNode = oldMap.get(name);
      if (!oldNode) {
        added.push(newNode);
      } else if (!this.nodesEqual(oldNode, newNode)) {
        modified.push(newNode);
      }
    }

    // Find removed
    for (const [name, oldNode] of oldMap) {
      if (!newMap.has(name)) {
        removed.push(oldNode);
      }
    }

    return { added, removed, modified };
  }
}
```

### Dependency-Aware Propagation

**Scenario 1: Constant Removed**

```typescript
// fileA.ts (modified)
export const API_URL = "http://api.example.com"; // REMOVED

// fileB.ts (dependent - must re-parse)
import { API_URL } from './fileA';
console.log(API_URL); // Reference now broken
```

**Update Flow:**
1. `fileA.ts` saved → parsed
2. Diff detects `API_URL` export removed
3. Query finds `fileB.ts` imports `API_URL`
4. `fileB.ts` re-parsed
5. `API_URL` reference marked as unresolved
6. Both updates committed to database

**Scenario 2: Function Signature Changed**

```typescript
// utils.ts (modified)
export function calculate(a: number): number { // was: (a: number, b: number)
  return a;
}

// app.ts (dependent - must re-parse)
import { calculate } from './utils';
calculate(5, 10); // Now a type error
```

**Update Flow:**
1. `utils.ts` saved → parsed
2. Diff detects `calculate` signature changed
3. Query finds `app.ts` calls `calculate`
4. `app.ts` re-parsed
5. `CALL` node updated with error annotation
6. Both updates committed

## Symbol Extraction

### Exported Symbols Tracking

Each file maintains a list of exported symbols:

```typescript
interface FileExports {
  filePath: string;
  exports: ExportedSymbol[];
}

interface ExportedSymbol {
  name: string;
  fullName: string;
  type: 'METHOD' | 'TYPE_DECL' | 'LOCAL' | 'NAMESPACE_BLOCK';
  signature?: string;
  nodeId: string;
}
```

### Import Resolution

Track import relationships for dependency analysis:

```cypher
// Store import edge
MATCH (importer:File {path: '/src/app.ts'})
MATCH (symbol:Symbol {fullName: 'utils.calculate'})
CREATE (importer)-[:IMPORTS {line: 1}]->(symbol)
```

## Performance Considerations

### Caching Strategy

- **In-memory cache**: UAST for recently accessed files
- **Cache invalidation**: On file save and dependent file updates
- **Cache size**: LRU eviction when limit reached (e.g., 100 files)

### Parallel Processing

- Parse independent files concurrently
- Use worker threads for CPU-intensive parsing
- Batch database updates in single transaction

### Optimization Techniques

1. **Incremental tree-sitter parsing**: Reuse unchanged subtrees
2. **Lazy dependency resolution**: Only compute when exports change
3. **Debouncing**: Wait brief period after save for multiple rapid saves
4. **Background processing**: Queue updates for async processing

## Error Handling

### Syntax Errors

Tree-sitter is error-tolerant:

```typescript
// Even with syntax errors, tree-sitter produces partial CST
const source = `
function foo() {
  const x = 5
  // missing semicolon, incomplete code
`;

// UAST still created with UNKNOWN nodes for unparseable sections
```

### Missing Dependencies

```typescript
// If imported file doesn't exist
import { missing } from './nonexistent';

// UAST includes CALL node with isExternal: true
// Database query returns empty for dependency lookup
```

## Testing Strategy

### Unit Tests

- Test each language adapter independently
- Verify Joern node property mappings
- Test incremental diff computation

### Integration Tests

- End-to-end file save → database update
- Multi-file dependency propagation
- Cross-language consistency

### Performance Tests

- Benchmark large file parsing (10k+ lines)
- Test incremental update speed
- Measure dependency resolution time

## Next Steps

See [CFG Layer](02-CFG-Layer.md) for control flow graph construction from UAST nodes.
