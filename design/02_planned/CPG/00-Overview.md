# Code Property Graph - Design Documentation

## Project Overview

**codegraph** is a VS Code extension that provides real-time code property graph (CPG) visualization and analysis for multi-language codebases. The extension builds a comprehensive graph representation of source code that combines syntactic structure, control flow, and program dependencies into a unified, queryable model.

### Vision

Enable developers to:
- Visualize code dependencies and relationships in real-time
- Navigate complex codebases through interactive graph exploration
- Understand code impact and propagation of changes
- Perform advanced code analysis queries across multiple languages

### Architecture Foundation

This project is based on the **Joern CPG specification** ([cpg.joern.io](https://cpg.joern.io/)), which provides a proven, language-agnostic approach to code property graph construction.

## Core Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      VS Code Extension                      │
│  ┌───────────────────────────────────────────────────────┐  │
│  │         Webview: Force-Directed Graph Visualization   │  │
│  │  (Theme-aware, active file highlighting, navigation)  │  │
│  └───────────────────────────────────────────────────────┘  │
│                            ▲                                 │
│                            │                                 │
│  ┌───────────────────────────────────────────────────────┐  │
│  │              Extension Host Logic                      │  │
│  │  - File watching (save events)                         │  │
│  │  - Editor synchronization                              │  │
│  │  - Graph query interface                               │  │
│  └───────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                            ▲
                            │
┌─────────────────────────────────────────────────────────────┐
│                  FalkorDB Graph Database                     │
│  - CPG nodes and edges storage                               │
│  - Cypher query engine                                       │
│  - Incremental update transactions                           │
└─────────────────────────────────────────────────────────────┘
                            ▲
                            │
┌─────────────────────────────────────────────────────────────┐
│              Code Property Graph Construction                │
│                                                              │
│  ┌──────────────────┐  ┌──────────────────┐                │
│  │  Layer 1: UAST   │  │  Layer 2: CFG    │                │
│  │  (Universal AST) │  │  (Control Flow)  │                │
│  │  - Joern-based   │  │  - Basic blocks  │                │
│  │  - Multi-lang    │  │  - Execution     │                │
│  └──────────────────┘  └──────────────────┘                │
│                                                              │
│  ┌──────────────────────────────────────────┐              │
│  │         Layer 3: PDG                      │              │
│  │  (Program Dependence Graph)               │              │
│  │  - Data dependencies                      │              │
│  │  - Control dependencies                   │              │
│  └──────────────────────────────────────────┘              │
└─────────────────────────────────────────────────────────────┘
                            ▲
                            │
┌─────────────────────────────────────────────────────────────┐
│                    Tree-sitter Parsers                       │
│  TypeScript/JavaScript | Python | Go | Rust | Java | C/C++  │
│  - Incremental parsing (on file save)                        │
│  - Error-tolerant                                            │
│  - Language-agnostic queries                                 │
└─────────────────────────────────────────────────────────────┘
```

## Technology Stack

- **Parsing**: Tree-sitter (multi-language support)
- **Graph Storage**: FalkorDB (Redis-compatible graph database)
- **Query Language**: Cypher
- **Visualization**: D3.js / vis.js / Cytoscape.js (TBD)
- **Extension Framework**: VS Code Extension API
- **Languages**: TypeScript (extension), TypeScript/JavaScript, Python, Go, Rust, Java, C/C++ (analysis targets)

## Design Documents

### Layer Documentation

1. **[UAST Layer](01-UAST-Layer.md)** - Universal Abstract Syntax Tree
   - Joern CPG node type specification
   - Tree-sitter integration and language adapters
   - Incremental parsing strategy (save-triggered, dependency-aware)
   - Symbol extraction and universal representation

2. **[CFG Layer](02-CFG-Layer.md)** - Control Flow Graph
   - Basic block construction
   - Control flow edge types
   - Integration with UAST
   - Incremental CFG updates

3. **[PDG Layer](03-PDG-Layer.md)** - Program Dependence Graph
   - Data and control dependency analysis
   - Program slicing
   - Impact analysis for change propagation
   - Dependency tracking for surgical updates

### Storage and Presentation

4. **[FalkorDB Storage](04-FalkorDB-Storage.md)** - Graph Database Layer
   - Joern-aligned schema design
   - Cypher query patterns
   - Incremental update transactions
   - Performance optimization

5. **[Visualization Layer](05-Visualization-Layer.md)** - VS Code Extension UI
   - Webview architecture
   - Force-directed graph rendering
   - Theme synchronization (node colors match syntax highlighting)
   - Active file highlighting
   - Editor-graph navigation

## Key Design Principles

### 1. Incremental and Surgical Updates

**Update Strategy:**
- **Trigger**: File save events (not keystroke changes)
- **Initial Parse**: Only the saved file is re-parsed
- **Dependency Propagation**: Re-parse only files affected by the change
  - Files importing modified/removed symbols
  - Files with dependencies on changed types/functions
  - Transitive dependency analysis

**Benefits:**
- Minimal computational overhead
- Fast response times even for large codebases
- Predictable resource usage

### 2. Language Universality

**Joern CPG as Foundation:**
- Consistent node types across all languages
- Universal query patterns
- Language-specific adapters translate to common schema

**Supported Languages (Initial):**
- TypeScript/JavaScript
- Python
- Go
- Rust
- Java
- C/C++

### 3. Visual Integration

**Theme Awareness:**
- Node colors derived from VS Code syntax theme
- Functions colored like function keywords in editor
- Classes colored like class keywords in editor
- Automatic adaptation to light/dark/high-contrast themes

**Active Context:**
- Current file's nodes highlighted in VERY visible color
- Smooth navigation between editor and graph
- Bidirectional synchronization (editor ↔ graph)

### 4. Performance at Scale

**Optimization Strategies:**
- Graph partitioning by module boundaries
- Lazy loading of graph sections
- Viewport-based rendering (only visible nodes)
- Pre-computed indexes on frequent queries
- Caching of transitive dependencies

## Development Workflow

### Phase 1: Foundation (UAST + Storage)
1. Implement tree-sitter integration for TypeScript
2. Define Joern-based UAST schema
3. Set up FalkorDB connection and schema
4. Build incremental parsing pipeline

### Phase 2: Graph Layers (CFG + PDG)
1. Implement CFG construction from UAST
2. Compute data dependencies
3. Compute control dependencies
4. Integrate all layers in database

### Phase 3: Visualization
1. Create webview panel infrastructure
2. Implement force-directed graph layout
3. Add theme synchronization
4. Build editor-graph navigation

### Phase 4: Multi-Language Support
1. Add language adapters for Python, Go, Rust, Java, C/C++
2. Test universal node mapping
3. Validate cross-language queries

### Phase 5: Advanced Features
1. Program slicing
2. Impact analysis
3. Custom query interface
4. Graph export/sharing

## References

- [Joern CPG Specification](https://cpg.joern.io/)
- [Tree-sitter Documentation](https://tree-sitter.github.io/tree-sitter/)
- [FalkorDB Documentation](https://www.falkordb.com/)
- [VS Code Extension API](https://code.visualstudio.com/api)
- [Code Property Graph (Wikipedia)](https://en.wikipedia.org/wiki/Code_property_graph)

## Contributing

See individual layer documentation for implementation details and architectural decisions.
