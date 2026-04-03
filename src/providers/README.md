# Extension Webview Providers

This directory contains the implementations for the three primary Visual Studio Code Webview panels used in the **codegraph** extension. Together, these panels form the foundational user interface for interacting with the underlying Code Property Graph (CPG) stored in FalkorDB, and they play a critical role in facilitating an Agentic Coding pipeline.

## 1. ConfigViewProvider (Configuration & Connection Management)
**File**: `ConfigViewProvider.ts`

The Config View is the administrative control center for the extension. It manages the connection between the VS Code extension and the FalkorDB database instance, which serves as the storage layer for the Code Property Graph.

### Role in the Extension & CPG:
- **Connection Management:** Users can toggle between an `embedded` (local) FalkorDB Lite instance or a `remote` FalkorDB server, inputting host, port, and credentials.
- **Indexing Control:** Defines execution parameters via `watchFolders` (what parts of the workspace to monitor) and triggers full workspace graph re-indexing through the "Full Refresh" action.
- **Status Monitoring:** Continuously polls and displays the status of the FalkorDB connection to ensure the graph database is available for the extension host and AI agents.

### Role in Agentic Coding:
For an AI coding agent, the codebase is represented as a queryable memory structure (the CPG). The `ConfigViewProvider` ensures the agent has an active, correctly-targeted database to traverse. By specifying the `graphName` and `watchFolders`, developers can isolate the exact subset of the project they want the local or remote AI agent to reason over.

---

## 2. GraphViewProvider (Real-time CPG Visualization)
**File**: `GraphViewProvider.ts`

The Graph View provides a real-time, interactive visual representation of the Code Property Graph using a force-directed layout mechanism (`force-graph`).

### Role in the Extension & CPG:
- **Visual Exploration:** Transforms FalkorDB nodes (Files, Directories, Functions, etc.) and edges (Control Flow, Data Flow, Imports) into spatial representations.
- **Incremental Rendering:** Plugs into the extension's file watcher and `GraphDiffService`. When a file is modified, only the exact nodes and links that changed are recalculated and patched visually, preventing disruptive full-screen redraws. 
- **Theme Awareness:** Adheres to VS Code theme colors and syntax highlighting paradigms for seamless native integration.

### Role in Agentic Coding:
When an AI agent makes changes to the codebase, the developer needs a way to visually verify the structural impact of those changes. The `GraphViewProvider` acts as the "eyes" for the developer, showing the exact architectural shifts—like newly injected dependencies or decoupled modules—in real-time as the agent's code is saved.

---

## 3. DetailsViewProvider (Contextual Insights & Agentic Feedback)
**File**: `DetailsViewProvider.ts`

The Details View acts as a dedicated inspector panel that brings contextual data into focus whenever a user interacts with elements in the Graph View or Editor.

### Role in the Extension & CPG:
- **Granular Inspection:** Displays rich metadata, properties, and the underlying text mapping of the selected node (e.g., viewing exactly what a Universal AST node or Program Dependence Graph edge means in the source code).
- **Rule Evaluation:** Used to render architectural violations, issues, or specific querying results (e.g., "Database layer importing from services layer").

### Role in Agentic Coding:
This panel is designed to be the primary conversational output mechanism for intelligent features. As the AI agent issues Cypher queries against the CPG (e.g., vulnerability detection, circular dependency tracing, or impact analysis), the results and recommendations are surfaced here. For instance, if the agent detects "Dead code in src/services", the `DetailsViewProvider` surfaces this explicitly to the developer along with suggested actions, effectively bridging the raw graphical data with actionable, AI-driven insights.
