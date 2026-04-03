# CodeGraph

**CodeGraph** is a VS Code extension that provides real-time code property graph (CPG) visualization and analysis for multi-language codebases. The extension builds a comprehensive graph representation of source code that combines syntactic structure, control flow, and program dependencies into a unified, queryable model based on the [Joern CPG specification](https://cpg.joern.io/).

## Vision

Our goal is to enable developers to:
- Visualize code dependencies and relationships in real-time
- Navigate complex codebases through interactive graph exploration
- Understand code impact and propagation of changes
- Perform advanced code analysis queries across multiple languages

## Features

- **Multi-Language Support**: Analyze TypeScript/JavaScript, Python, Go, Rust, Java, and C/C++ codebases.
- **Real-Time Analysis**: Incremental and surgical graph updates triggered automatically on file save.
- **Interactive Visualization**: Explore code dependencies with a dynamic, theme-aware, force-directed graph rendering.
- **Flexible Storage**: Use an embedded graph database or connect to a remote FalkorDB instance.
- **Cypher Queries**: Query your codebase natively using the Cypher graph query language.

## Prerequisites

Before installing the extension, ensure your system has the following packages. These dependencies (such as OpenMP) are strictly required for the local fallback graph database (FalkorDB) to function correctly:

### macOS

```bash
brew install redis libomp
```

### Linux (Debian/Ubuntu)

```bash
sudo apt-get install redis-server libgomp1
```

### Linux (RHEL/Fedora)

```bash
sudo dnf install redis libgomp
```

### Windows

Install Redis using one of these methods:
- [Redis for Windows](https://github.com/microsoftarchive/redis/releases)
- [Memurai](https://www.memurai.com/) (Redis-compatible)
- WSL2 with Linux installation

*Note: Windows users may need additional configuration for OpenMP support depending on their compilation environment.*

## Configuration

Access the CodeGraph configuration panel from the VS Code sidebar. The extension supports two connection modes:

### Embedded Mode (Default)
Uses an embedded FalkorDB instance (`falkordblite`) that runs locally:

- **Data Path**: Local directory where graph data is stored (default: `${workspaceFolder}/.codegraph`)

### Remote Mode
Connects to an external FalkorDB or Redis server:

- **Host**: FalkorDB server hostname (default: `localhost`)
- **Port**: Server port (default: `6379`)
- **Password**: Optional authentication password
- **Graph Name**: Name of the graph database to use (default: `default`)

## Getting Started

1. Install the system prerequisites (`redis` and `libomp` for macOS).
2. Install the CodeGraph extension.
3. Open a workspace or folder in VS Code.
4. Open the CodeGraph configuration panel in the sidebar.
5. Choose your connection mode and configure settings.
6. Click "Apply Configuration".
7. Save a file in your workspace to trigger the initial graph construction.

## Extension Settings

This extension contributes the following settings:

- `falkordb.connectionMode`: Connection mode (`embedded` or `remote`)
- `falkordb.host`: FalkorDB server host (remote mode)
- `falkordb.port`: FalkorDB server port (remote mode)
- `falkordb.password`: Authentication password (remote mode)
- `falkordb.graphName`: Name of the graph database
- `falkordb.dataPath`: Local data directory (embedded mode)

## Architecture

CodeGraph uses a multi-layered architecture:

1. **UAST Layer**: Universal Abstract Syntax Tree utilizing Tree-sitter parsers
2. **CFG Layer**: Control Flow Graph construction
3. **PDG Layer**: Program Dependence Graph with data and control dependencies
4. **Storage Layer**: FalkorDB graph database integration
5. **Visualization Layer**: Interactive webview with force-directed graph rendering

For detailed architecture documentation and design goals, see the [Overview Documentation](design/02_planned/CPG/00-Overview.md).

## Known Issues

- Large codebases (>10k files) may experience initial parse delays during the first run.
- Embedded mode requires write permissions in the workspace directory.

## Contributing

See the [Design Documentation](design/02_planned/CPG/) for deeper implementation details, layer separation, and architectural decisions.

## License

See LICENSE file for details.
