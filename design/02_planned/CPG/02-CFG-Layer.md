# CFG Layer - Control Flow Graph

## Overview

The Control Flow Graph (CFG) layer represents the possible execution paths through a program. It complements the UAST by capturing procedural semantics: which statements execute in which order, and under what conditions.

## Purpose

The CFG enables:
- **Reachability analysis**: Determining which code can be executed
- **Dead code detection**: Identifying unreachable statements
- **Loop analysis**: Finding back-edges and loop structures
- **Path analysis**: Enumerating possible execution sequences
- **Foundation for PDG**: Data flow requires control flow information

## Joern CFG Specification

### CFG Node Types

Joern extends UAST nodes with CFG-specific nodes:

| Node Type | Description | Example |
|-----------|-------------|---------|
| `METHOD` | Entry/exit points for functions | Function boundaries |
| `BLOCK` | Basic blocks (sequences without branches) | `{ stmt1; stmt2; stmt3; }` |
| `CONTROL_STRUCTURE` | Branch points | `if`, `while`, `for`, `switch` |
| `RETURN` | Method exit points | `return value;` |
| `JUMP_TARGET` | Branch targets | `case 1:`, labels |
| `CALL` | Function call sites | `foo()` (may not return) |

### CFG Edge Types

| Edge Type | Description | Properties |
|-----------|-------------|------------|
| `CFG` | Sequential control flow | Basic ordering |
| `CONDITION` | Conditional branch | `{ value: true/false }` |
| `REACHING_DEF` | Variable definition reaches use | Used in data flow |

### CFG Properties

```typescript
interface CFGEdge {
  source: string;        // Source node ID
  target: string;        // Target node ID
  type: 'CFG';
  label?: string;        // 'TRUE', 'FALSE', 'CASE n', 'DEFAULT'
  order: number;         // Edge ordering (for prioritization)
}
```

## Basic Block Construction

### Definition

A **basic block** is a maximal sequence of statements with:
1. **Single entry point**: Only the first statement can be entered
2. **Single exit point**: Control only leaves at the last statement
3. **No internal branches**: All statements execute sequentially

### Algorithm: Basic Block Identification

```typescript
class BasicBlockBuilder {
  buildBasicBlocks(method: UASTNode): BasicBlock[] {
    const blocks: BasicBlock[] = [];
    const leaders = this.identifyLeaders(method);

    let currentBlock: Statement[] = [];

    for (const stmt of this.getAllStatements(method)) {
      if (leaders.has(stmt.id)) {
        // Start new block
        if (currentBlock.length > 0) {
          blocks.push(new BasicBlock(currentBlock));
        }
        currentBlock = [stmt];
      } else {
        currentBlock.push(stmt);
      }
    }

    if (currentBlock.length > 0) {
      blocks.push(new BasicBlock(currentBlock));
    }

    return blocks;
  }

  private identifyLeaders(method: UASTNode): Set<string> {
    const leaders = new Set<string>();

    this.traverseStatements(method, (stmt, index, all) => {
      // Rule 1: First statement is a leader
      if (index === 0) {
        leaders.add(stmt.id);
      }

      // Rule 2: Target of any jump is a leader
      if (this.isJumpTarget(stmt)) {
        leaders.add(stmt.id);
      }

      // Rule 3: Statement following a jump is a leader
      if (index > 0 && this.isJump(all[index - 1])) {
        leaders.add(stmt.id);
      }

      // Rule 4: Statement following a conditional is a leader
      if (index > 0 && this.isConditional(all[index - 1])) {
        leaders.add(stmt.id);
      }
    });

    return leaders;
  }

  private isJumpTarget(stmt: UASTNode): boolean {
    return stmt.label === 'JUMP_TARGET' ||
           stmt.label === 'CONTROL_STRUCTURE';
  }

  private isJump(stmt: UASTNode): boolean {
    return stmt.label === 'RETURN' ||
           stmt.label === 'JUMP_LABEL' ||
           (stmt.label === 'CONTROL_STRUCTURE' &&
            ['BREAK', 'CONTINUE', 'THROW'].includes(stmt.name));
  }

  private isConditional(stmt: UASTNode): boolean {
    return stmt.label === 'CONTROL_STRUCTURE' &&
           ['IF', 'WHILE', 'FOR', 'SWITCH'].includes(stmt.name);
  }
}
```

### Example: TypeScript Function

```typescript
function analyze(x: number): number {
  let result = 0;              // Block 1 (entry)

  if (x > 0) {                 // Block 1 (exit) - conditional
    result = x * 2;            // Block 2 (true branch)
  } else {
    result = x * -1;           // Block 3 (false branch)
  }

  return result;               // Block 4 (exit)
}
```

**Basic Blocks:**

```
Block 1 (Entry):
  let result = 0;
  if (x > 0)

Block 2 (True Branch):
  result = x * 2;

Block 3 (False Branch):
  result = x * -1;

Block 4 (Exit):
  return result;
```

**CFG Edges:**

```
Block 1 --[TRUE]--> Block 2
Block 1 --[FALSE]--> Block 3
Block 2 --[CFG]--> Block 4
Block 3 --[CFG]--> Block 4
```

## Control Flow Edge Construction

### Sequential Flow

```typescript
class CFGBuilder {
  addSequentialEdges(blocks: BasicBlock[]): CFGEdge[] {
    const edges: CFGEdge[] = [];

    for (let i = 0; i < blocks.length - 1; i++) {
      const current = blocks[i];
      const next = blocks[i + 1];

      // Add edge if no branch at end of current block
      if (!this.endsWithBranch(current)) {
        edges.push({
          source: current.exitNode.id,
          target: next.entryNode.id,
          type: 'CFG',
          order: 0
        });
      }
    }

    return edges;
  }
}
```

### Conditional Branches (If/Else)

```typescript
class CFGBuilder {
  addConditionalEdges(ifStmt: UASTNode, blocks: BasicBlock[]): CFGEdge[] {
    const condition = ifStmt; // The if statement itself
    const thenBlock = this.findBlockStartingWith(ifStmt.thenBranch, blocks);
    const elseBlock = ifStmt.elseBranch
      ? this.findBlockStartingWith(ifStmt.elseBranch, blocks)
      : this.findNextBlock(ifStmt, blocks);

    return [
      {
        source: condition.id,
        target: thenBlock.entryNode.id,
        type: 'CFG',
        label: 'TRUE',
        order: 1
      },
      {
        source: condition.id,
        target: elseBlock.entryNode.id,
        type: 'CFG',
        label: 'FALSE',
        order: 2
      }
    ];
  }
}
```

### Loop Edges (While/For)

```typescript
class CFGBuilder {
  addLoopEdges(loopStmt: UASTNode, blocks: BasicBlock[]): CFGEdge[] {
    const conditionBlock = this.findBlockContaining(loopStmt, blocks);
    const bodyBlock = this.findBlockStartingWith(loopStmt.body, blocks);
    const exitBlock = this.findNextBlock(loopStmt, blocks);

    return [
      // Entry to loop condition
      {
        source: conditionBlock.id,
        target: bodyBlock.entryNode.id,
        type: 'CFG',
        label: 'TRUE',
        order: 1
      },
      // Loop back-edge (body -> condition)
      {
        source: bodyBlock.exitNode.id,
        target: conditionBlock.entryNode.id,
        type: 'CFG',
        label: 'LOOP_BACK',
        order: 2,
        isBackEdge: true  // Important for cycle detection
      },
      // Exit condition
      {
        source: conditionBlock.id,
        target: exitBlock.entryNode.id,
        type: 'CFG',
        label: 'FALSE',
        order: 3
      }
    ];
  }
}
```

### Switch Statements

```typescript
class CFGBuilder {
  addSwitchEdges(switchStmt: UASTNode, blocks: BasicBlock[]): CFGEdge[] {
    const edges: CFGEdge[] = [];
    const cases = switchStmt.cases; // Array of case clauses
    const switchExitBlock = this.findNextBlock(switchStmt, blocks);

    for (const caseClause of cases) {
      const caseBlock = this.findBlockStartingWith(caseClause, blocks);

      edges.push({
        source: switchStmt.id,
        target: caseBlock.entryNode.id,
        type: 'CFG',
        label: caseClause.value ? `CASE ${caseClause.value}` : 'DEFAULT',
        order: cases.indexOf(caseClause)
      });

      // Fall-through edges between cases
      if (!this.endsWithBreak(caseBlock)) {
        const nextCase = cases[cases.indexOf(caseClause) + 1];
        if (nextCase) {
          const nextBlock = this.findBlockStartingWith(nextCase, blocks);
          edges.push({
            source: caseBlock.exitNode.id,
            target: nextBlock.entryNode.id,
            type: 'CFG',
            label: 'FALL_THROUGH',
            order: 100
          });
        }
      }

      // Break edges to exit
      if (this.endsWithBreak(caseBlock)) {
        edges.push({
          source: caseBlock.exitNode.id,
          target: switchExitBlock.entryNode.id,
          type: 'CFG',
          order: 100
        });
      }
    }

    return edges;
  }
}
```

### Exception Handling (Try/Catch)

```typescript
class CFGBuilder {
  addExceptionEdges(tryStmt: UASTNode, blocks: BasicBlock[]): CFGEdge[] {
    const edges: CFGEdge[] = [];
    const tryBlock = this.findBlockStartingWith(tryStmt.body, blocks);
    const catchBlock = this.findBlockStartingWith(tryStmt.handler, blocks);
    const finallyBlock = tryStmt.finalizer
      ? this.findBlockStartingWith(tryStmt.finalizer, blocks)
      : null;
    const exitBlock = this.findNextBlock(tryStmt, blocks);

    // Normal flow: try -> finally (or exit)
    edges.push({
      source: tryBlock.exitNode.id,
      target: finallyBlock?.entryNode.id || exitBlock.entryNode.id,
      type: 'CFG',
      order: 1
    });

    // Exception flow: try -> catch (any statement in try can throw)
    for (const stmt of tryBlock.statements) {
      if (this.canThrow(stmt)) {
        edges.push({
          source: stmt.id,
          target: catchBlock.entryNode.id,
          type: 'CFG',
          label: 'EXCEPTION',
          order: 100
        });
      }
    }

    // Catch -> finally (or exit)
    edges.push({
      source: catchBlock.exitNode.id,
      target: finallyBlock?.entryNode.id || exitBlock.entryNode.id,
      type: 'CFG',
      order: 2
    });

    // Finally -> exit
    if (finallyBlock) {
      edges.push({
        source: finallyBlock.exitNode.id,
        target: exitBlock.entryNode.id,
        type: 'CFG',
        order: 3
      });
    }

    return edges;
  }
}
```

## Integration with UAST Layer

### Deriving CFG from UAST

```typescript
class CFGConstructor {
  async buildCFG(uastNodes: UASTNode[]): Promise<CFGGraph> {
    const cfg = new CFGGraph();

    // Process each METHOD node
    const methods = uastNodes.filter(n => n.label === 'METHOD');

    for (const method of methods) {
      // 1. Extract statements from method body
      const statements = this.extractStatements(method);

      // 2. Build basic blocks
      const blocks = this.basicBlockBuilder.buildBasicBlocks(method);

      // 3. Add CFG edges
      const edges = this.buildEdges(blocks, statements);

      // 4. Add to graph
      cfg.addMethod(method.id, blocks, edges);
    }

    return cfg;
  }

  private extractStatements(method: UASTNode): UASTNode[] {
    const statements: UASTNode[] = [];

    const traverse = (node: UASTNode) => {
      if (this.isStatement(node)) {
        statements.push(node);
      }

      // Recursively traverse children (via AST edges)
      for (const child of node.children) {
        traverse(child);
      }
    };

    traverse(method);
    return statements;
  }

  private isStatement(node: UASTNode): boolean {
    const stmtLabels = [
      'CONTROL_STRUCTURE',
      'RETURN',
      'CALL',
      'LOCAL',
      'JUMP_TARGET',
      'BLOCK'
    ];
    return stmtLabels.includes(node.label);
  }
}
```

### Storage in FalkorDB

```cypher
// Store CFG edges alongside AST edges
MATCH (source:Statement {id: $sourceId})
MATCH (target:Statement {id: $targetId})
CREATE (source)-[:CFG {
  label: $label,
  order: $order,
  isBackEdge: $isBackEdge
}]->(target)
```

## Incremental CFG Updates

### Update Triggers

CFG updates are triggered when UAST changes affect control flow:

1. **Control structure added/removed**: New `if`/`while`/`for` statement
2. **Method body changed**: Any statement modification
3. **Return statement added/removed**: Changes exit points

### Update Strategy

```typescript
class IncrementalCFGUpdater {
  async updateCFG(
    method: UASTNode,
    uastDiff: UASTDiff
  ): Promise<CFGUpdateResult> {

    // Check if CFG needs updating
    if (!this.affectsCFG(uastDiff)) {
      return { updated: false };
    }

    // Full CFG recomputation for the method
    // (CFG is method-scoped, so this is efficient)
    const newCFG = await this.cfgConstructor.buildCFGForMethod(method);

    // Update database
    await this.db.transaction(async (tx) => {
      // Delete old CFG edges for this method
      await tx.run(`
        MATCH (m:METHOD {id: $methodId})-[:CONTAINS*]->(n)
        MATCH (n)-[e:CFG]->()
        DELETE e
      `, { methodId: method.id });

      // Insert new CFG edges
      for (const edge of newCFG.edges) {
        await tx.run(`
          MATCH (source {id: $sourceId})
          MATCH (target {id: $targetId})
          CREATE (source)-[:CFG {
            label: $label,
            order: $order,
            isBackEdge: $isBackEdge
          }]->(target)
        `, edge);
      }
    });

    return { updated: true, edgeCount: newCFG.edges.length };
  }

  private affectsCFG(diff: UASTDiff): boolean {
    const cfgAffectingLabels = [
      'CONTROL_STRUCTURE',
      'RETURN',
      'JUMP_TARGET',
      'CALL'  // May not return
    ];

    return (
      diff.added.some(n => cfgAffectingLabels.includes(n.label)) ||
      diff.removed.some(n => cfgAffectingLabels.includes(n.label)) ||
      diff.modified.some(n => cfgAffectingLabels.includes(n.label))
    );
  }
}
```

### Optimization: Method-Scoped Updates

Since CFG is primarily intra-procedural (within methods), updates are isolated to the changed method:

```typescript
// Only recompute CFG for the modified method
const affectedMethod = this.findContainingMethod(changedNode);
await this.updateCFG(affectedMethod, uastDiff);

// No need to update CFG in other methods
// (unless call graph changes - handled separately)
```

## CFG Analysis Algorithms

### Reachability Analysis

```typescript
class CFGAnalyzer {
  findReachableNodes(entryNode: UASTNode): Set<string> {
    const reachable = new Set<string>();
    const queue = [entryNode.id];

    while (queue.length > 0) {
      const nodeId = queue.shift()!;

      if (reachable.has(nodeId)) {
        continue;
      }

      reachable.add(nodeId);

      // Follow CFG edges
      const successors = this.getCFGSuccessors(nodeId);
      queue.push(...successors);
    }

    return reachable;
  }

  private getCFGSuccessors(nodeId: string): string[] {
    // Query FalkorDB
    const result = this.db.query(`
      MATCH (n {id: $nodeId})-[:CFG]->(successor)
      RETURN successor.id
    `, { nodeId });

    return result.map(r => r['successor.id']);
  }
}
```

### Dead Code Detection

```typescript
class CFGAnalyzer {
  findDeadCode(method: UASTNode): UASTNode[] {
    const allNodes = this.getAllNodesInMethod(method);
    const reachable = this.findReachableNodes(method);

    return allNodes.filter(n => !reachable.has(n.id));
  }
}
```

### Loop Detection

```typescript
class CFGAnalyzer {
  findLoops(method: UASTNode): Loop[] {
    const loops: Loop[] = [];
    const backEdges = this.findBackEdges(method);

    for (const backEdge of backEdges) {
      const loop = this.extractLoop(backEdge);
      loops.push(loop);
    }

    return loops;
  }

  private findBackEdges(method: UASTNode): CFGEdge[] {
    // Query for edges marked as back edges
    const result = this.db.query(`
      MATCH (m:METHOD {id: $methodId})-[:CONTAINS*]->(n)
      MATCH (n)-[e:CFG {isBackEdge: true}]->(target)
      RETURN e
    `, { methodId: method.id });

    return result.map(r => r.e);
  }
}
```

## Language-Specific CFG Considerations

### JavaScript/TypeScript: Async/Await

```typescript
async function fetchData() {
  const data = await fetch(url);  // CFG: Suspension point
  return data;
}

// CFG includes implicit continuation edges
```

### Python: Generators

```python
def generator():
    yield 1  # CFG: Multiple exit/re-entry points
    yield 2
    yield 3
```

### Go: Defer

```go
func example() {
    defer cleanup()  // CFG: Executed at function exit
    process()
}
```

### Rust: Match Expressions

```rust
match value {
    Some(x) => { ... },  // CFG: Pattern matching branches
    None => { ... }
}
```

## Visualization in Graph

CFG edges can be visualized with different styles:

- **Sequential flow**: Solid arrows
- **Conditional (true)**: Green arrows
- **Conditional (false)**: Red arrows
- **Loop back-edges**: Dashed arrows
- **Exception flow**: Orange arrows

## Performance Metrics

Expected CFG construction performance:

- Small method (< 20 statements): < 10ms
- Medium method (20-100 statements): 10-50ms
- Large method (100-500 statements): 50-200ms
- Very large method (> 500 statements): 200ms-1s

## Testing Strategy

### Unit Tests

- Test basic block identification
- Verify edge construction for each control structure
- Test incremental update logic

### Integration Tests

- End-to-end CFG construction from source code
- Validate CFG correctness with known programs
- Test reachability and dead code detection

## Next Steps

See [PDG Layer](03-PDG-Layer.md) for program dependence graph construction using CFG and data flow analysis.
