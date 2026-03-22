# CodeGraph

A VS Code extension that provides real-time code property graph (CPG) visualization and analysis for multi-language codebases. CodeGraph builds a comprehensive graph representation combining syntactic structure, control flow, and program dependencies based on the [Joern CPG specification](https://cpg.joern.io/).

## Features

- **Multi-Language Support**: Analyze TypeScript, JavaScript, Python, Go, Rust, Java, and C/C++ codebases
- **Real-Time Analysis**: Incremental graph updates triggered on file save
- **Interactive Visualization**: Explore code dependencies and relationships through graph rendering
- **Flexible Storage**: Embedded database or remote FalkorDB connection
- **Cypher Queries**: Query your codebase using the Cypher graph query language

## Prerequisites

Before installing the extension, ensure your system has the following packages:

### Linux (Debian/Ubuntu)
```bash
sudo apt-get install redis-server libgomp1
```

### Linux (RHEL/Fedora)
```bash
sudo dnf install redis libgomp
```

### macOS
```bash
brew install redis
```

### Windows
Install Redis using one of these methods:
- [Redis for Windows](https://github.com/microsoftarchive/redis/releases)
- [Memurai](https://www.memurai.com/) (Redis-compatible)
- WSL2 with Linux installation

## Configuration

Access the CodeGraph configuration panel from the VS Code sidebar. The extension supports two connection modes:

### Embedded Mode
Uses an embedded FalkorDB instance (falkordblite) that runs locally:

- **Data Path**: Local directory where graph data is stored (default: `${workspaceFolder}/.codegraph`)

### Remote Mode
Connects to an external FalkorDB/Redis server:

- **Host**: FalkorDB server hostname (default: `localhost`)
- **Port**: Server port (default: `6379`)
- **Password**: Optional authentication password
- **Graph Name**: Name of the graph database to use (default: `default`)

## Getting Started

1. Install the extension
2. Open a workspace/folder in VS Code
3. Open the CodeGraph configuration panel
4. Choose your connection mode and configure settings
5. Click "Apply Configuration"
6. Save a file in your workspace to trigger initial graph construction

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

1. **UAST Layer**: Universal Abstract Syntax Tree using Tree-sitter parsers
2. **CFG Layer**: Control Flow Graph construction
3. **PDG Layer**: Program Dependence Graph with data and control dependencies
4. **Storage Layer**: FalkorDB graph database
5. **Visualization Layer**: Interactive webview with force-directed graph rendering

For detailed architecture documentation, see the [design documentation](design/02_planned/CPG/).

## Known Issues

- Large codebases (>10k files) may experience initial parse delays
- Embedded mode requires write permissions in the workspace directory

## Contributing

See the [design documentation](design/02_planned/CPG/) for implementation details and architectural decisions.

## License

See LICENSE file for details.
