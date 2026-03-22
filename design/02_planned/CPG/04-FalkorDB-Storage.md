# FalkorDB Storage Layer

## Overview

FalkorDB serves as the persistent storage layer for the Code Property Graph, storing UAST nodes, CFG edges, PDG edges, and all related metadata. FalkorDB is a high-performance graph database (formerly RedisGraph) that provides native graph storage with Cypher query support.

## Why FalkorDB?

### Advantages

1. **Native Graph Storage**: Purpose-built for graph data structures
2. **Cypher Query Language**: Industry-standard graph query language (from Neo4j)
3. **Redis-Compatible**: Can leverage Redis ecosystem and tooling
4. **High Performance**: In-memory operations with optional persistence
5. **ACID Transactions**: Ensures data consistency during incremental updates
6. **Open Source**: Apache 2.0 license, active development

### Alternatives Considered

- **Neo4j**: More mature but heavier, requires separate server
- **DGraph**: Good performance but uses GraphQL+- instead of Cypher
- **SQLite + Graph Extension**: Lacks native graph traversal optimization
- **In-Memory Only**: Would lose graph state between sessions

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                VS Code Extension                        │
└─────────────────────────────────────────────────────────┘
                       ▲  │
            Query Results │  │ Updates
                       │  ▼
┌─────────────────────────────────────────────────────────┐
│              FalkorDB Client (Node.js)                  │
│  - Connection pooling                                   │
│  - Transaction management                               │
│  - Query batching                                       │
└─────────────────────────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────┐
│                FalkorDB Server                          │
│  ┌─────────────────────────────────────────────────┐   │
│  │              Graph Storage Engine                │   │
│  │  - Nodes (UAST elements)                         │   │
│  │  - Edges (AST, CFG, PDG relationships)           │   │
│  │  - Indexes (node labels, properties)             │   │
│  └─────────────────────────────────────────────────┘   │
│  ┌─────────────────────────────────────────────────┐   │
│  │            Cypher Query Engine                   │   │
│  │  - Pattern matching                              │   │
│  │  - Graph traversal optimization                  │   │
│  │  - Aggregation and filtering                     │   │
│  └─────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────┐
│           Persistent Storage (Optional)                 │
│  - RDB snapshots                                        │
│  - AOF (Append-Only File) logs                          │
└─────────────────────────────────────────────────────────┘
```

## Schema Design

### Node Labels (Joern-Aligned)

All nodes follow the Joern CPG specification:

#### Core Node Types

```cypher
// Method/Function nodes
(:METHOD {
  id: string,
  name: string,
  fullName: string,
  signature: string,
  lineNumber: int,
  lineNumberEnd: int,
  columnNumber: int,
  columnNumberEnd: int,
  code: string,
  language: string,
  filePath: string,
  isExternal: boolean
})

// Type Declaration (Class/Struct/Interface)
(:TYPE_DECL {
  id: string,
  name: string,
  fullName: string,
  lineNumber: int,
  lineNumberEnd: int,
  code: string,
  language: string,
  filePath: string,
  isExternal: boolean
})

// Local Variable
(:LOCAL {
  id: string,
  name: string,
  typeFullName: string,
  lineNumber: int,
  code: string,
  closureBindingId: string?
})

// Method Parameter
(:METHOD_PARAMETER_IN {
  id: string,
  name: string,
  typeFullName: string,
  order: int,
  code: string
})

// Control Structure (if/while/for/switch)
(:CONTROL_STRUCTURE {
  id: string,
  controlStructureType: string,  // IF, WHILE, FOR, SWITCH
  lineNumber: int,
  code: string
})

// Function Call
(:CALL {
  id: string,
  name: string,
  methodFullName: string,
  signature: string,
  lineNumber: int,
  code: string,
  dispatchType: string  // STATIC, DYNAMIC
})

// Identifier (variable/function reference)
(:IDENTIFIER {
  id: string,
  name: string,
  typeFullName: string,
  lineNumber: int,
  code: string
})

// Literal values
(:LITERAL {
  id: string,
  code: string,
  typeFullName: string,
  lineNumber: int
})

// Return statement
(:RETURN {
  id: string,
  lineNumber: int,
  code: string
})

// Code block
(:BLOCK {
  id: string,
  lineNumber: int,
  lineNumberEnd: int
})

// File/Module
(:FILE {
  id: string,
  name: string,
  path: string,
  language: string,
  hash: string  // For change detection
})

// Namespace/Package
(:NAMESPACE_BLOCK {
  id: string,
  name: string,
  fullName: string
})
```

### Edge Types (Joern-Aligned)

```cypher
// AST Layer Edges
-[:AST {order: int}]->          // Parent-child in syntax tree
-[:REF]->                        // Reference to declaration
-[:EVAL_TYPE]->                  // Expression type
-[:INHERITS_FROM]->              // Class inheritance
-[:BINDS_TO]->                   // Generic type binding

// CFG Layer Edges
-[:CFG {
  label: string?,                // TRUE, FALSE, CASE n, DEFAULT, LOOP_BACK
  order: int,
  isBackEdge: boolean?
}]->

// PDG Layer Edges
-[:DDG {variable: string}]->     // Data dependency
-[:CDG]->                        // Control dependency
-[:REACHING_DEF {variable: string}]->  // Reaching definition

// Call Graph Edges
-[:CALL {
  lineNumber: int,
  order: int
}]->

// Parameter Binding
-[:ARGUMENT {
  argumentIndex: int
}]->

// File Organization
-[:CONTAINS {order: int}]->      // File contains declarations
-[:IMPORTS {
  importedEntity: string,
  lineNumber: int
}]->
```

### Multi-Label Nodes

Some nodes have multiple labels for efficient querying:

```cypher
// A method that's also an entry point
(:METHOD:ENTRY_POINT {
  id: "main_123",
  name: "main",
  ...
})

// A control structure that's also a basic block leader
(:CONTROL_STRUCTURE:BASIC_BLOCK {
  id: "if_456",
  controlStructureType: "IF",
  ...
})
```

## Database Initialization

### Connection Setup

```typescript
import { FalkorDB } from 'falkordb';

class FalkorDBClient {
  private client: FalkorDB;
  private graph: any;

  async connect(config: DBConfig): Promise<void> {
    this.client = await FalkorDB.connect({
      host: config.host || 'localhost',
      port: config.port || 6379,
      password: config.password
    });

    // Get or create graph for this workspace
    this.graph = this.client.selectGraph(config.graphName || 'codegraph');
  }

  async disconnect(): Promise<void> {
    await this.client.close();
  }
}
```

### Index Creation

Create indexes for frequently queried properties:

```typescript
class SchemaInitializer {
  async createIndexes(): Promise<void> {
    // Index on node IDs (primary lookup)
    await this.graph.query(`
      CREATE INDEX FOR (n:METHOD) ON (n.id)
    `);

    await this.graph.query(`
      CREATE INDEX FOR (n:TYPE_DECL) ON (n.id)
    `);

    await this.graph.query(`
      CREATE INDEX FOR (n:LOCAL) ON (n.id)
    `);

    await this.graph.query(`
      CREATE INDEX FOR (n:CALL) ON (n.id)
    `);

    await this.graph.query(`
      CREATE INDEX FOR (n:IDENTIFIER) ON (n.id)
    `);

    await this.graph.query(`
      CREATE INDEX FOR (n:FILE) ON (n.id)
    `);

    // Index on file paths (for file-based queries)
    await this.graph.query(`
      CREATE INDEX FOR (n:METHOD) ON (n.filePath)
    `);

    await this.graph.query(`
      CREATE INDEX FOR (n:TYPE_DECL) ON (n.filePath)
    `);

    await this.graph.query(`
      CREATE INDEX FOR (f:FILE) ON (f.path)
    `);

    // Index on names (for symbol lookup)
    await this.graph.query(`
      CREATE INDEX FOR (n:METHOD) ON (n.name)
    `);

    await this.graph.query(`
      CREATE INDEX FOR (n:TYPE_DECL) ON (n.name)
    `);

    await this.graph.query(`
      CREATE INDEX FOR (n:LOCAL) ON (n.name)
    `);
  }
}
```

## Incremental Update Transactions

### Transaction Pattern

All incremental updates use ACID transactions:

```typescript
class IncrementalUpdater {
  async updateFile(
    filePath: string,
    diff: UASTDiff
  ): Promise<UpdateResult> {
    const tx = await this.graph.beginTransaction();

    try {
      // 1. Delete removed nodes and their edges
      await this.deleteNodes(tx, diff.removed);

      // 2. Update modified nodes
      await this.updateNodes(tx, diff.modified);

      // 3. Create new nodes
      await this.createNodes(tx, diff.added);

      // 4. Rebuild edges for affected nodes
      await this.rebuildEdges(tx, filePath);

      await tx.commit();

      return { success: true, nodeCount: diff.added.length };
    } catch (error) {
      await tx.rollback();
      throw error;
    }
  }
}
```

### Delete Operations

```typescript
private async deleteNodes(
  tx: Transaction,
  nodes: UASTNode[]
): Promise<void> {
  for (const node of nodes) {
    // Delete node and all its edges (automatic cascade)
    await tx.run(`
      MATCH (n {id: $nodeId})
      DETACH DELETE n
    `, { nodeId: node.id });
  }
}
```

### Update Operations

```typescript
private async updateNodes(
  tx: Transaction,
  nodes: UASTNode[]
): Promise<void> {
  for (const node of nodes) {
    // Update node properties
    await tx.run(`
      MATCH (n {id: $nodeId})
      SET n += $properties
    `, {
      nodeId: node.id,
      properties: this.nodeToProperties(node)
    });

    // Delete old edges (will be recreated)
    await tx.run(`
      MATCH (n {id: $nodeId})-[e:AST|CFG|DDG|CDG]->()
      DELETE e
    `, { nodeId: node.id });

    await tx.run(`
      MATCH ()-[e:AST|CFG|DDG|CDG]->(n {id: $nodeId})
      DELETE e
    `, { nodeId: node.id });
  }
}
```

### Create Operations

```typescript
private async createNodes(
  tx: Transaction,
  nodes: UASTNode[]
): Promise<void> {
  for (const node of nodes) {
    const label = node.label;
    const properties = this.nodeToProperties(node);

    await tx.run(`
      CREATE (n:${label} $properties)
    `, { properties });
  }
}

private nodeToProperties(node: UASTNode): object {
  return {
    id: node.id,
    name: node.name,
    fullName: node.fullName,
    signature: node.signature,
    lineNumber: node.lineNumber,
    lineNumberEnd: node.lineNumberEnd,
    columnNumber: node.columnNumber,
    columnNumberEnd: node.columnNumberEnd,
    code: node.code,
    language: node.language,
    filePath: node.filePath,
    isExternal: node.isExternal,
    typeFullName: node.typeFullName,
    order: node.order
  };
}
```

### Edge Rebuilding

```typescript
private async rebuildEdges(
  tx: Transaction,
  filePath: string
): Promise<void> {
  // Rebuild AST edges
  await this.rebuildASTEdges(tx, filePath);

  // Rebuild CFG edges
  await this.rebuildCFGEdges(tx, filePath);

  // Rebuild PDG edges (lazily)
  this.schedulePDGRebuild(filePath);
}

private async rebuildASTEdges(
  tx: Transaction,
  filePath: string
): Promise<void> {
  const nodes = await this.getNodesInFile(filePath);

  for (const node of nodes) {
    for (const child of node.children) {
      await tx.run(`
        MATCH (parent {id: $parentId})
        MATCH (child {id: $childId})
        CREATE (parent)-[:AST {order: $order}]->(child)
      `, {
        parentId: node.id,
        childId: child.id,
        order: child.order
      });
    }
  }
}
```

## Cypher Query Patterns

### Common Queries

#### Find All Methods in a File

```cypher
MATCH (f:FILE {path: $filePath})-[:CONTAINS]->(m:METHOD)
RETURN m.name, m.lineNumber, m.signature
ORDER BY m.lineNumber
```

#### Find All Calls to a Specific Function

```cypher
MATCH (caller:METHOD)-[:CONTAINS*]->(call:CALL {name: $functionName})
RETURN caller.name, call.lineNumber
```

#### Find Dependencies of a Variable

```cypher
MATCH (def:LOCAL {name: $varName})-[:DDG*]->(use)
RETURN use.code, use.lineNumber
```

#### Find Control Flow Paths

```cypher
MATCH path = (entry:METHOD {name: $methodName})-[:CFG*]->(exit:RETURN)
RETURN path
```

#### Find All Imports in a File

```cypher
MATCH (f:FILE {path: $filePath})-[i:IMPORTS]->(symbol)
RETURN i.importedEntity, i.lineNumber
```

#### Find Files Importing a Symbol

```cypher
MATCH (f:FILE)-[i:IMPORTS]->(s:METHOD|TYPE_DECL {fullName: $symbolName})
RETURN DISTINCT f.path
```

#### Get Subgraph for Active File

```cypher
// Get all nodes in active file
MATCH (f:FILE {path: $activeFile})-[:CONTAINS*]->(n)
RETURN n

// Get all edges within active file
MATCH (f:FILE {path: $activeFile})-[:CONTAINS*]->(n1)
MATCH (n1)-[e:AST|CFG|DDG|CDG]->(n2)
MATCH (f)-[:CONTAINS*]->(n2)
RETURN e
```

#### Find Transitive Dependencies

```cypher
// Find all files transitively depending on a file
MATCH (f1:FILE {path: $filePath})-[:CONTAINS*]->(exported:METHOD|TYPE_DECL)
MATCH (f2:FILE)-[:IMPORTS]->(exported)
MATCH path = (f2)-[:IMPORTS*]->(other)
RETURN DISTINCT other.filePath
```

### Performance-Optimized Queries

#### Use LIMIT for Large Result Sets

```cypher
MATCH (m:METHOD)
WHERE m.filePath = $filePath
RETURN m
LIMIT 100
```

#### Use Indexes for Lookups

```cypher
// Good: Uses index on METHOD.id
MATCH (m:METHOD {id: $methodId})
RETURN m

// Bad: Full scan
MATCH (m:METHOD)
WHERE m.code CONTAINS 'function'
RETURN m
```

#### Avoid Unbounded Traversals

```cypher
// Good: Limited depth
MATCH (n)-[:CFG*1..5]->(m)
RETURN m

// Bad: Unbounded (can be very slow)
MATCH (n)-[:CFG*]->(m)
RETURN m
```

## Query Optimization Strategies

### 1. Index Usage

- Always query indexed properties first
- Use `id` for primary lookups
- Use `filePath` for file-scoped queries
- Use `name` for symbol lookups

### 2. Query Hints

```cypher
// Use USING INDEX hint for complex queries
MATCH (m:METHOD)
USING INDEX m:METHOD(id)
WHERE m.id = $methodId
RETURN m
```

### 3. Batching

```typescript
class QueryBatcher {
  async batchInsert(nodes: UASTNode[], batchSize = 100): Promise<void> {
    for (let i = 0; i < nodes.length; i += batchSize) {
      const batch = nodes.slice(i, i + batchSize);

      await this.graph.query(`
        UNWIND $nodes AS nodeData
        CREATE (n:${batch[0].label})
        SET n = nodeData
      `, { nodes: batch.map(n => this.nodeToProperties(n)) });
    }
  }
}
```

### 4. Caching

```typescript
class QueryCache {
  private cache = new Map<string, { result: any; timestamp: number }>();
  private ttl = 60000; // 1 minute

  async query(cypherQuery: string, params: any): Promise<any> {
    const key = this.getCacheKey(cypherQuery, params);
    const cached = this.cache.get(key);

    if (cached && Date.now() - cached.timestamp < this.ttl) {
      return cached.result;
    }

    const result = await this.graph.query(cypherQuery, params);

    this.cache.set(key, {
      result,
      timestamp: Date.now()
    });

    return result;
  }

  invalidate(pattern: RegExp): void {
    for (const key of this.cache.keys()) {
      if (pattern.test(key)) {
        this.cache.delete(key);
      }
    }
  }
}
```

## Persistence and Backup

### RDB Snapshots

```typescript
class BackupManager {
  async createSnapshot(): Promise<void> {
    // Trigger Redis BGSAVE
    await this.client.bgsave();
  }

  async restoreSnapshot(snapshotPath: string): Promise<void> {
    // Copy RDB file to Redis data directory
    // Restart Redis to load snapshot
  }
}
```

### Export to GraphML

```typescript
class GraphExporter {
  async exportToGraphML(filePath: string): Promise<void> {
    // Get all nodes
    const nodesResult = await this.graph.query(`
      MATCH (n)
      RETURN n
    `);

    // Get all edges
    const edgesResult = await this.graph.query(`
      MATCH ()-[e]->()
      RETURN e
    `);

    // Convert to GraphML format
    const graphML = this.toGraphML(nodesResult, edgesResult);

    await fs.writeFile(filePath, graphML);
  }
}
```

## Error Handling

### Connection Errors

```typescript
class FalkorDBClient {
  async withRetry<T>(
    operation: () => Promise<T>,
    maxRetries = 3
  ): Promise<T> {
    let lastError: Error;

    for (let i = 0; i < maxRetries; i++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error;

        if (this.isConnectionError(error)) {
          await this.reconnect();
          continue;
        }

        throw error;
      }
    }

    throw lastError!;
  }

  private async reconnect(): Promise<void> {
    await this.disconnect();
    await this.connect(this.config);
  }
}
```

### Transaction Rollback

```typescript
class TransactionManager {
  async executeInTransaction<T>(
    operation: (tx: Transaction) => Promise<T>
  ): Promise<T> {
    const tx = await this.graph.beginTransaction();

    try {
      const result = await operation(tx);
      await tx.commit();
      return result;
    } catch (error) {
      await tx.rollback();
      console.error('Transaction rolled back:', error);
      throw error;
    }
  }
}
```

## Performance Metrics

Expected performance characteristics:

- **Node insertion**: 1000-10000 nodes/sec (batched)
- **Edge insertion**: 1000-5000 edges/sec (batched)
- **Simple lookup (indexed)**: < 1ms
- **Graph traversal (depth 3)**: 1-10ms
- **Complex pattern match**: 10-100ms
- **Full file subgraph query**: 10-50ms

## Testing Strategy

### Unit Tests

- Test connection and disconnection
- Verify index creation
- Test transaction commit/rollback
- Validate query correctness

### Integration Tests

- End-to-end CRUD operations
- Concurrent transaction handling
- Performance benchmarks

### Load Tests

- Insert 100k+ nodes
- Create 500k+ edges
- Query under load

## Next Steps

See [Visualization Layer](05-Visualization-Layer.md) for querying the graph database to render interactive visualizations.
