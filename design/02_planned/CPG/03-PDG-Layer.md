# PDG Layer - Program Dependence Graph

## Overview

The Program Dependence Graph (PDG) layer captures semantic dependencies between program elements. It combines data dependencies (what values flow where) with control dependencies (what controls whether code executes) to provide a complete picture of program behavior.

## Purpose

The PDG enables:
- **Program slicing**: Extracting relevant code for a specific computation
- **Impact analysis**: Understanding what code is affected by a change
- **Change propagation**: Tracing how modifications ripple through the codebase
- **Dependency tracking**: Identifying what must be re-parsed after file save
- **Refactoring support**: Safe code transformations
- **Dead code elimination**: Finding truly unused code

## Joern PDG Specification

### PDG Edge Types

Joern defines these dependency edge types:

| Edge Type | Description | Example |
|-----------|-------------|---------|
| `REACHING_DEF` | Variable definition reaches use | `x = 5` → `y = x + 1` |
| `CDG` (Control Dependence) | Statement controlled by condition | `if (x > 0)` → `return x` |
| `DDG` (Data Dependence) | Data flows from source to sink | Assignment → Usage |
| `CALL` | Function invocation | `foo()` → `function foo()` |
| `ARGUMENT` | Argument passed to parameter | Call site → Parameter |
| `PARAMETER_LINK` | Parameter to corresponding argument | Parameter → Argument at call site |

### PDG Properties

```typescript
interface PDGEdge {
  source: string;        // Source node ID
  target: string;        // Target node ID
  type: 'REACHING_DEF' | 'CDG' | 'DDG' | 'CALL' | 'ARGUMENT';
  variable?: string;     // Variable name (for data deps)
  order?: number;        // Edge ordering
}
```

## Data Dependency Analysis

### Reaching Definitions

A definition of variable `x` **reaches** a use of `x` if there exists a CFG path from the definition to the use with no intervening definition of `x`.

#### Algorithm: Reaching Definitions Data Flow

```typescript
class ReachingDefinitionsAnalyzer {
  computeReachingDefinitions(method: UASTNode): Map<string, Set<string>> {
    const cfg = this.getCFG(method);
    const blocks = cfg.basicBlocks;

    // Initialize GEN and KILL sets for each block
    const gen = new Map<string, Set<string>>();
    const kill = new Map<string, Set<string>>();

    for (const block of blocks) {
      gen.set(block.id, this.computeGEN(block));
      kill.set(block.id, this.computeKILL(block));
    }

    // Initialize IN and OUT sets
    const inSets = new Map<string, Set<string>>();
    const outSets = new Map<string, Set<string>>();

    for (const block of blocks) {
      inSets.set(block.id, new Set());
      outSets.set(block.id, new Set());
    }

    // Iterative data flow analysis (forward)
    let changed = true;
    while (changed) {
      changed = false;

      for (const block of blocks) {
        // IN[B] = ∪ OUT[P] for all predecessors P
        const newIn = new Set<string>();
        for (const pred of cfg.getPredecessors(block)) {
          const predOut = outSets.get(pred.id)!;
          predOut.forEach(def => newIn.add(def));
        }

        // OUT[B] = GEN[B] ∪ (IN[B] - KILL[B])
        const newOut = new Set(gen.get(block.id));
        const inSet = inSets.get(block.id)!;
        const killSet = kill.get(block.id)!;

        inSet.forEach(def => {
          if (!killSet.has(def)) {
            newOut.add(def);
          }
        });

        // Check for changes
        if (!this.setsEqual(newIn, inSets.get(block.id)!) ||
            !this.setsEqual(newOut, outSets.get(block.id)!)) {
          changed = true;
          inSets.set(block.id, newIn);
          outSets.set(block.id, newOut);
        }
      }
    }

    return outSets;
  }

  private computeGEN(block: BasicBlock): Set<string> {
    // GEN[B] = definitions generated in block B
    const gen = new Set<string>();

    for (const stmt of block.statements) {
      if (this.isDefinition(stmt)) {
        const variable = this.getDefinedVariable(stmt);
        gen.add(`${stmt.id}:${variable}`);
      }
    }

    return gen;
  }

  private computeKILL(block: BasicBlock): Set<string> {
    // KILL[B] = definitions killed by block B
    const kill = new Set<string>();
    const allDefs = this.getAllDefinitions(); // From entire method

    for (const stmt of block.statements) {
      if (this.isDefinition(stmt)) {
        const variable = this.getDefinedVariable(stmt);

        // Kill all other definitions of the same variable
        for (const def of allDefs) {
          if (def.variable === variable && def.id !== stmt.id) {
            kill.add(`${def.id}:${variable}`);
          }
        }
      }
    }

    return kill;
  }

  private isDefinition(node: UASTNode): boolean {
    // Assignments, declarations, parameters
    return (
      node.label === 'LOCAL' ||  // Variable declaration
      (node.label === 'CALL' && this.isAssignment(node)) ||
      node.label === 'METHOD' && this.isParameter(node)
    );
  }
}
```

### Use-Def Chains

From reaching definitions, construct **use-def chains**:

```typescript
class UseDefChainBuilder {
  buildUseDefChains(
    method: UASTNode,
    reachingDefs: Map<string, Set<string>>
  ): Map<string, string[]> {
    const useDefChains = new Map<string, string[]>();

    this.traverseUses(method, (use, block) => {
      const variable = this.getUsedVariable(use);
      const reachingDefsAtBlock = reachingDefs.get(block.id)!;

      // Find definitions of this variable that reach this use
      const defs = Array.from(reachingDefsAtBlock)
        .filter(def => def.endsWith(`:${variable}`))
        .map(def => def.split(':')[0]); // Extract def node ID

      useDefChains.set(use.id, defs);
    });

    return useDefChains;
  }

  private traverseUses(
    method: UASTNode,
    callback: (use: UASTNode, block: BasicBlock) => void
  ): void {
    const cfg = this.getCFG(method);

    for (const block of cfg.basicBlocks) {
      for (const stmt of block.statements) {
        if (this.isUse(stmt)) {
          callback(stmt, block);
        }
      }
    }
  }

  private isUse(node: UASTNode): boolean {
    // References to variables (not definitions)
    return (
      node.label === 'IDENTIFIER' &&
      !this.isLHS(node)  // Not on left-hand side of assignment
    );
  }
}
```

### Data Dependency Edges

```typescript
class DataDependencyBuilder {
  buildDataDependencies(
    useDefChains: Map<string, string[]>
  ): PDGEdge[] {
    const edges: PDGEdge[] = [];

    for (const [useId, defIds] of useDefChains) {
      for (const defId of defIds) {
        edges.push({
          source: defId,
          target: useId,
          type: 'DDG',
          variable: this.getVariableName(useId)
        });

        // Also create REACHING_DEF edge (Joern spec)
        edges.push({
          source: defId,
          target: useId,
          type: 'REACHING_DEF',
          variable: this.getVariableName(useId)
        });
      }
    }

    return edges;
  }
}
```

### Example: Data Dependencies

```typescript
function example() {
  let x = 5;        // Def1: x
  let y = x + 1;    // Use1: x, Def2: y
  let z = y * 2;    // Use2: y, Def3: z
  return z;         // Use3: z
}
```

**Data Dependency Edges:**

```
Def1 (x = 5) --[DDG, var: x]--> Use1 (x + 1)
Def2 (y = x + 1) --[DDG, var: y]--> Use2 (y * 2)
Def3 (z = y * 2) --[DDG, var: z]--> Use3 (return z)
```

## Control Dependency Analysis

### Definition

Statement `B` is **control dependent** on statement `A` if:
1. There exists a path from `A` to `B` such that `B` appears on the path
2. `B` does not post-dominate `A` (there's an alternative path from `A` that doesn't go through `B`)

Intuitively: `A` determines whether `B` executes.

### Post-Dominance

Node `B` **post-dominates** node `A` if every path from `A` to the exit node passes through `B`.

#### Algorithm: Post-Dominance

```typescript
class PostDominanceAnalyzer {
  computePostDominators(cfg: CFGGraph): Map<string, Set<string>> {
    const blocks = cfg.basicBlocks;
    const exitBlock = cfg.exitBlock;

    // Initialize
    const postDom = new Map<string, Set<string>>();

    for (const block of blocks) {
      if (block.id === exitBlock.id) {
        postDom.set(block.id, new Set([block.id]));
      } else {
        postDom.set(block.id, new Set(blocks.map(b => b.id))); // All blocks
      }
    }

    // Iterative refinement (backward)
    let changed = true;
    while (changed) {
      changed = false;

      for (const block of blocks) {
        if (block.id === exitBlock.id) continue;

        // PostDom[B] = {B} ∪ (∩ PostDom[S] for all successors S)
        const successors = cfg.getSuccessors(block);

        if (successors.length === 0) {
          continue;
        }

        const newPostDom = new Set([block.id]);
        const intersection = new Set(postDom.get(successors[0].id));

        for (let i = 1; i < successors.length; i++) {
          const succPostDom = postDom.get(successors[i].id)!;
          intersection.forEach(node => {
            if (!succPostDom.has(node)) {
              intersection.delete(node);
            }
          });
        }

        intersection.forEach(node => newPostDom.add(node));

        if (!this.setsEqual(newPostDom, postDom.get(block.id)!)) {
          changed = true;
          postDom.set(block.id, newPostDom);
        }
      }
    }

    return postDom;
  }
}
```

### Control Dependence Computation

```typescript
class ControlDependenceAnalyzer {
  computeControlDependencies(cfg: CFGGraph): PDGEdge[] {
    const edges: PDGEdge[] = [];
    const postDom = this.computePostDominators(cfg);

    for (const block of cfg.basicBlocks) {
      const successors = cfg.getSuccessors(block);

      for (const succ of successors) {
        // B is control dependent on A if:
        // - A has an edge to B
        // - B does not post-dominate A
        if (!postDom.get(block.id)!.has(succ.id)) {
          // Find all nodes reachable from succ that don't post-dominate block
          const dependent = this.findControlDependentNodes(
            block,
            succ,
            postDom
          );

          for (const depNode of dependent) {
            edges.push({
              source: block.id,
              target: depNode.id,
              type: 'CDG'
            });
          }
        }
      }
    }

    return edges;
  }

  private findControlDependentNodes(
    controlNode: BasicBlock,
    startNode: BasicBlock,
    postDom: Map<string, Set<string>>
  ): UASTNode[] {
    const dependent: UASTNode[] = [];
    const visited = new Set<string>();
    const queue = [startNode];

    while (queue.length > 0) {
      const node = queue.shift()!;

      if (visited.has(node.id)) continue;
      visited.add(node.id);

      // Node is control dependent on controlNode
      dependent.push(...node.statements);

      // Continue along successors that don't post-dominate controlNode
      for (const succ of this.cfg.getSuccessors(node)) {
        if (!postDom.get(controlNode.id)!.has(succ.id)) {
          queue.push(succ);
        }
      }
    }

    return dependent;
  }
}
```

### Example: Control Dependencies

```typescript
function example(x: number) {
  if (x > 0) {       // Control1
    console.log(x);  // Stmt1 (control dependent on Control1)
    return x;        // Stmt2 (control dependent on Control1)
  } else {
    return 0;        // Stmt3 (control dependent on Control1)
  }
}
```

**Control Dependency Edges:**

```
Control1 (if x > 0) --[CDG]--> Stmt1 (console.log)
Control1 (if x > 0) --[CDG]--> Stmt2 (return x)
Control1 (if x > 0) --[CDG]--> Stmt3 (return 0)
```

## Integration with UAST and CFG Layers

### Complete PDG Construction Pipeline

```typescript
class PDGConstructor {
  async buildPDG(method: UASTNode): Promise<PDGGraph> {
    // 1. Get UAST nodes
    const uastNodes = await this.getUASTNodes(method);

    // 2. Get CFG
    const cfg = await this.getCFG(method);

    // 3. Compute reaching definitions
    const reachingDefs = this.reachingDefsAnalyzer
      .computeReachingDefinitions(method);

    // 4. Build use-def chains
    const useDefChains = this.useDefChainBuilder
      .buildUseDefChains(method, reachingDefs);

    // 5. Create data dependency edges
    const dataEdges = this.dataDependencyBuilder
      .buildDataDependencies(useDefChains);

    // 6. Compute control dependencies
    const controlEdges = this.controlDependenceAnalyzer
      .computeControlDependencies(cfg);

    // 7. Combine into PDG
    return new PDGGraph({
      nodes: uastNodes,
      dataEdges: dataEdges,
      controlEdges: controlEdges
    });
  }
}
```

### Storage in FalkorDB

```cypher
// Store data dependency edge
MATCH (def:Statement {id: $defId})
MATCH (use:Statement {id: $useId})
CREATE (def)-[:DDG {variable: $varName}]->(use)
CREATE (def)-[:REACHING_DEF {variable: $varName}]->(use)

// Store control dependency edge
MATCH (control:ControlStructure {id: $controlId})
MATCH (dependent:Statement {id: $dependentId})
CREATE (control)-[:CDG]->(dependent)
```

## Program Slicing

### Definition

A **program slice** with respect to a slicing criterion `(statement, variable)` is the set of all statements that could affect the value of `variable` at `statement`.

### Backward Slicing

```typescript
class ProgramSlicer {
  backwardSlice(
    criterion: { statement: UASTNode; variable: string }
  ): Set<UASTNode> {
    const slice = new Set<UASTNode>();
    const worklist = [criterion.statement];

    while (worklist.length > 0) {
      const node = worklist.shift()!;

      if (slice.has(node)) continue;
      slice.add(node);

      // Follow data dependencies backward
      const dataDeps = this.getDataDependencies(node, criterion.variable);
      worklist.push(...dataDeps);

      // Follow control dependencies backward
      const controlDeps = this.getControlDependencies(node);
      worklist.push(...controlDeps);
    }

    return slice;
  }

  private getDataDependencies(
    node: UASTNode,
    variable?: string
  ): UASTNode[] {
    // Query FalkorDB for incoming DDG edges
    const query = variable
      ? `MATCH (def)-[:DDG {variable: $variable}]->(use {id: $nodeId})
         RETURN def`
      : `MATCH (def)-[:DDG]->(use {id: $nodeId})
         RETURN def`;

    const result = this.db.query(query, {
      nodeId: node.id,
      variable: variable
    });

    return result.map(r => r.def);
  }

  private getControlDependencies(node: UASTNode): UASTNode[] {
    // Query FalkorDB for incoming CDG edges
    const result = this.db.query(`
      MATCH (control)-[:CDG]->(dependent {id: $nodeId})
      RETURN control
    `, { nodeId: node.id });

    return result.map(r => r.control);
  }
}
```

### Example: Backward Slice

```typescript
function calculate(a: number, b: number): number {
  let x = a + b;      // S1
  let y = a * 2;      // S2
  let z = x + y;      // S3
  let w = b - 1;      // S4
  return z;           // S5
}

// Slicing criterion: (S5, z)
// Backward slice: {S1, S2, S3, S5}
// (S4 is NOT in slice - doesn't affect z)
```

## Impact Analysis for Change Propagation

### Finding Affected Code

When a symbol is modified, find all code affected by the change:

```typescript
class ImpactAnalyzer {
  async findImpact(
    modifiedNode: UASTNode
  ): Promise<ImpactResult> {
    const impact: ImpactResult = {
      affectedStatements: new Set(),
      affectedFiles: new Set()
    };

    // 1. Find all uses of the modified definition
    const uses = await this.findUses(modifiedNode);

    for (const use of uses) {
      // 2. Compute forward slice from each use
      const forwardSlice = this.forwardSlice(use);
      impact.affectedStatements = new Set([
        ...impact.affectedStatements,
        ...forwardSlice
      ]);

      // 3. Collect affected files
      for (const stmt of forwardSlice) {
        impact.affectedFiles.add(this.getFileForNode(stmt));
      }
    }

    return impact;
  }

  private forwardSlice(node: UASTNode): Set<UASTNode> {
    const slice = new Set<UASTNode>();
    const worklist = [node];

    while (worklist.length > 0) {
      const current = worklist.shift()!;

      if (slice.has(current)) continue;
      slice.add(current);

      // Follow data dependencies forward
      const dataSucc = this.getDataSuccessors(current);
      worklist.push(...dataSucc);

      // Follow control dependencies forward
      const controlSucc = this.getControlSuccessors(current);
      worklist.push(...controlSucc);
    }

    return slice;
  }

  private getDataSuccessors(node: UASTNode): UASTNode[] {
    // Query FalkorDB for outgoing DDG edges
    const result = this.db.query(`
      MATCH (def {id: $nodeId})-[:DDG]->(use)
      RETURN use
    `, { nodeId: node.id });

    return result.map(r => r.use);
  }
}
```

### Dependency Tracking for Surgical Updates

This integrates with the UAST layer's incremental update strategy:

```typescript
class SurgicalUpdateCoordinator {
  async onFileSave(filePath: string, uastDiff: UASTDiff): Promise<void> {
    // 1. Find impact of modifications
    const impact = await this.impactAnalyzer.findImpact(
      uastDiff.modified.concat(uastDiff.removed)
    );

    // 2. Identify files to re-parse (from UAST layer)
    const filesToReparse = Array.from(impact.affectedFiles);

    // 3. Re-parse affected files
    for (const file of filesToReparse) {
      await this.uastBuilder.parseFile(file);
    }

    // 4. Update PDG for all affected methods
    const affectedMethods = this.getMethodsContaining(impact.affectedStatements);
    for (const method of affectedMethods) {
      await this.pdgConstructor.buildPDG(method);
    }
  }
}
```

## Incremental PDG Updates

### Update Strategy

PDG updates are more expensive than CFG updates due to data flow analysis. Strategy:

1. **Lazy recomputation**: Only compute PDG when queried
2. **Method-scoped**: PDG is intra-procedural (within methods)
3. **Invalidation**: Mark PDG as stale when UAST/CFG changes
4. **Background computation**: Compute PDG asynchronously

```typescript
class IncrementalPDGUpdater {
  private pdgCache = new Map<string, { pdg: PDGGraph; valid: boolean }>();

  async getPDG(method: UASTNode): Promise<PDGGraph> {
    const cached = this.pdgCache.get(method.id);

    if (cached && cached.valid) {
      return cached.pdg;
    }

    // Recompute PDG
    const pdg = await this.pdgConstructor.buildPDG(method);

    this.pdgCache.set(method.id, { pdg, valid: true });

    return pdg;
  }

  invalidatePDG(method: UASTNode): void {
    const cached = this.pdgCache.get(method.id);
    if (cached) {
      cached.valid = false;
    }
  }

  onUASTChange(method: UASTNode, diff: UASTDiff): void {
    // Invalidate PDG for changed method
    this.invalidatePDG(method);

    // Optionally: trigger background recomputation
    this.scheduleRecomputation(method);
  }

  private scheduleRecomputation(method: UASTNode): void {
    // Queue for background processing
    this.backgroundQueue.add(async () => {
      await this.getPDG(method);
    });
  }
}
```

## Performance Considerations

### Complexity

- **Reaching definitions**: O(n³) worst case, O(n²) typical (n = statements)
- **Post-dominance**: O(n³) worst case, O(n²) typical
- **Control dependencies**: O(n²)
- **Overall PDG construction**: O(n²) to O(n³) per method

### Optimization Strategies

1. **Sparse data flow**: Track only variables with uses
2. **SSA form**: Convert to Static Single Assignment for faster analysis
3. **Incremental updates**: Reuse analysis results when possible
4. **Parallel processing**: Analyze methods concurrently
5. **Caching**: Store analysis results in database

## Testing Strategy

### Unit Tests

- Test reaching definitions algorithm
- Verify post-dominance computation
- Test control dependency detection
- Validate program slicing correctness

### Integration Tests

- End-to-end PDG construction
- Impact analysis correctness
- Incremental update behavior

## Next Steps

See:
- [FalkorDB Storage](04-FalkorDB-Storage.md) for database schema and query optimization
- [Visualization Layer](05-Visualization-Layer.md) for rendering PDG in the UI
