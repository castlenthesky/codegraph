# Visualization Layer - VS Code Extension UI

## Overview

The Visualization Layer provides an interactive, real-time graph visualization of the Code Property Graph directly within VS Code. It synchronizes with the editor, adapts to the user's color theme, and enables intuitive navigation between code and graph representations.

## Goals

1. **Real-time Visualization**: Display CPG updates immediately after file saves
2. **Theme Integration**: Node colors match VS Code syntax highlighting
3. **Active File Highlighting**: Current file's nodes shown in VERY visible color
4. **Bidirectional Navigation**: Click graph → jump to code, select code → highlight graph
5. **Interactive Exploration**: Zoom, pan, filter, and query the graph
6. **Performance**: Smooth rendering even for large codebases (1000+ nodes)

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                   VS Code UI Layer                      │
│                                                         │
│  ┌───────────────────────────────────────────────────┐ │
│  │         Activity Bar Icon (CPG Viewer)            │ │
│  └───────────────────────────────────────────────────┘ │
│                       │                                 │
│                       ▼                                 │
│  ┌───────────────────────────────────────────────────┐ │
│  │              Sidebar Webview Panel                │ │
│  │  - File tree with graph statistics                │ │
│  │  - Layer toggles (UAST/CFG/PDG)                   │ │
│  │  - Filter controls                                │ │
│  │  - Search interface                               │ │
│  └───────────────────────────────────────────────────┘ │
│                                                         │
│  ┌───────────────────────────────────────────────────┐ │
│  │           Main Webview Panel (Graph)              │ │
│  │  ┌─────────────────────────────────────────────┐  │ │
│  │  │  Canvas: Force-Directed Graph Visualization │  │ │
│  │  │  - D3.js / vis.js / Cytoscape.js            │  │ │
│  │  │  - Zoom/Pan controls                         │  │ │
│  │  │  - Node/edge interaction                     │  │ │
│  │  └─────────────────────────────────────────────┘  │ │
│  │                                                    │ │
│  │  ┌─────────────────────────────────────────────┐  │ │
│  │  │  Toolbar                                     │  │ │
│  │  │  [Layout] [Layers] [Filter] [Export] [Help] │  │ │
│  │  └─────────────────────────────────────────────┘  │ │
│  └───────────────────────────────────────────────────┘ │
│                                                         │
│  ┌───────────────────────────────────────────────────┐ │
│  │            Text Editor (synchronized)             │ │
│  │  - Active file highlighted in graph               │ │
│  │  - Cursor position → node selection               │ │
│  └───────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────┘
                       ▲  │
          Query Results│  │Messages (state updates)
                       │  ▼
┌─────────────────────────────────────────────────────────┐
│              Extension Host (TypeScript)                │
│  - Event handlers (file save, selection change)        │
│  - FalkorDB client                                      │
│  - Theme color extraction                               │
│  - Message passing (extension ↔ webview)                │
└─────────────────────────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────┐
│                  FalkorDB Storage                       │
└─────────────────────────────────────────────────────────┘
```

## VS Code Extension Setup

### Extension Activation

```typescript
// src/extension.ts
import * as vscode from 'vscode';
import { CPGGraphPanel } from './webview/CPGGraphPanel';
import { CPGSidebarProvider } from './webview/CPGSidebarProvider';
import { FalkorDBClient } from './db/FalkorDBClient';
import { ThemeColorExtractor } from './theme/ThemeColorExtractor';

export async function activate(context: vscode.ExtensionContext) {
  console.log('CodeGraph extension activated');

  // Initialize database connection
  const dbClient = new FalkorDBClient();
  await dbClient.connect({
    host: 'localhost',
    port: 6379,
    graphName: `cpg_${vscode.workspace.name}`
  });

  // Register sidebar provider
  const sidebarProvider = new CPGSidebarProvider(
    context.extensionUri,
    dbClient
  );
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      'codegraph-sidebar',
      sidebarProvider
    )
  );

  // Register command to open graph panel
  context.subscriptions.push(
    vscode.commands.registerCommand('codegraph.showGraph', () => {
      CPGGraphPanel.createOrShow(context.extensionUri, dbClient);
    })
  );

  // Listen for file saves
  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument(async (document) => {
      await handleFileSave(document, dbClient);
      CPGGraphPanel.currentPanel?.refresh();
    })
  );

  // Listen for editor selection changes
  context.subscriptions.push(
    vscode.window.onDidChangeTextEditorSelection((event) => {
      handleSelectionChange(event, dbClient);
    })
  );

  // Listen for theme changes
  context.subscriptions.push(
    vscode.window.onDidChangeActiveColorTheme((theme) => {
      handleThemeChange(theme, dbClient);
    })
  );
}
```

### File Save Handler

```typescript
async function handleFileSave(
  document: vscode.TextDocument,
  dbClient: FalkorDBClient
): Promise<void> {
  const filePath = document.uri.fsPath;

  // Trigger incremental parsing and CPG update
  const updater = new IncrementalCPGUpdater(dbClient);
  await updater.onFileSave(filePath);

  // Notify webview to refresh
  CPGGraphPanel.currentPanel?.postMessage({
    command: 'fileUpdated',
    filePath: filePath
  });
}
```

### Selection Change Handler

```typescript
function handleSelectionChange(
  event: vscode.TextEditorSelectionChangeEvent,
  dbClient: FalkorDBClient
): void {
  const editor = event.textEditor;
  const selection = event.selections[0];
  const filePath = editor.document.uri.fsPath;
  const lineNumber = selection.active.line + 1;

  // Find node at current position
  const nodeId = findNodeAtPosition(dbClient, filePath, lineNumber);

  if (nodeId) {
    CPGGraphPanel.currentPanel?.postMessage({
      command: 'highlightNode',
      nodeId: nodeId
    });
  }
}
```

### Theme Change Handler

```typescript
function handleThemeChange(
  theme: vscode.ColorTheme,
  dbClient: FalkorDBClient
): void {
  const extractor = new ThemeColorExtractor();
  const colors = extractor.extractColors(theme);

  CPGGraphPanel.currentPanel?.postMessage({
    command: 'updateTheme',
    colors: colors
  });
}
```

## Webview Panel Implementation

### Main Graph Panel

```typescript
// src/webview/CPGGraphPanel.ts
import * as vscode from 'vscode';

export class CPGGraphPanel {
  public static currentPanel: CPGGraphPanel | undefined;
  private readonly _panel: vscode.WebviewPanel;
  private readonly _extensionUri: vscode.Uri;
  private _disposables: vscode.Disposable[] = [];

  public static createOrShow(
    extensionUri: vscode.Uri,
    dbClient: FalkorDBClient
  ): void {
    const column = vscode.ViewColumn.Two;

    // If panel already exists, show it
    if (CPGGraphPanel.currentPanel) {
      CPGGraphPanel.currentPanel._panel.reveal(column);
      return;
    }

    // Create new panel
    const panel = vscode.window.createWebviewPanel(
      'cpgGraph',
      'Code Property Graph',
      column,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.joinPath(extensionUri, 'media'),
          vscode.Uri.joinPath(extensionUri, 'out')
        ]
      }
    );

    CPGGraphPanel.currentPanel = new CPGGraphPanel(
      panel,
      extensionUri,
      dbClient
    );
  }

  private constructor(
    panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
    private dbClient: FalkorDBClient
  ) {
    this._panel = panel;
    this._extensionUri = extensionUri;

    // Set HTML content
    this._update();

    // Handle messages from webview
    this._panel.webview.onDidReceiveMessage(
      async (message) => {
        await this.handleMessage(message);
      },
      null,
      this._disposables
    );

    // Cleanup
    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
  }

  private async handleMessage(message: any): Promise<void> {
    switch (message.command) {
      case 'getGraphData':
        await this.sendGraphData(message.filePath);
        break;

      case 'nodeClicked':
        await this.navigateToNode(message.nodeId);
        break;

      case 'requestThemeColors':
        this.sendThemeColors();
        break;
    }
  }

  private async sendGraphData(filePath?: string): Promise<void> {
    const query = filePath
      ? `MATCH (f:FILE {path: $filePath})-[:CONTAINS*]->(n)
         MATCH (n)-[e]->(m)
         RETURN n, e, m`
      : `MATCH (n)-[e]->(m)
         RETURN n, e, m
         LIMIT 500`;

    const result = await this.dbClient.query(query, { filePath });

    this.postMessage({
      command: 'graphData',
      nodes: result.nodes,
      edges: result.edges
    });
  }

  private async navigateToNode(nodeId: string): Promise<void> {
    // Query node location
    const result = await this.dbClient.query(`
      MATCH (n {id: $nodeId})
      RETURN n.filePath, n.lineNumber, n.columnNumber
    `, { nodeId });

    if (result.length > 0) {
      const { filePath, lineNumber, columnNumber } = result[0];

      // Open file and navigate to position
      const document = await vscode.workspace.openTextDocument(filePath);
      const editor = await vscode.window.showTextDocument(document);

      const position = new vscode.Position(
        lineNumber - 1,
        columnNumber - 1
      );
      editor.selection = new vscode.Selection(position, position);
      editor.revealRange(
        new vscode.Range(position, position),
        vscode.TextEditorRevealType.InCenter
      );
    }
  }

  public postMessage(message: any): void {
    this._panel.webview.postMessage(message);
  }

  public refresh(): void {
    this.sendGraphData();
  }

  private _update(): void {
    this._panel.webview.html = this._getHtmlForWebview();
  }

  private _getHtmlForWebview(): string {
    const webview = this._panel.webview;

    // URIs for scripts and styles
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, 'media', 'graph.js')
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, 'media', 'graph.css')
    );
    const d3Uri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, 'media', 'd3.min.js')
    );

    const nonce = getNonce();

    return `<!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <meta http-equiv="Content-Security-Policy"
              content="default-src 'none';
                       style-src ${webview.cspSource} 'unsafe-inline';
                       script-src 'nonce-${nonce}';">
        <link href="${styleUri}" rel="stylesheet">
        <title>Code Property Graph</title>
      </head>
      <body>
        <div id="toolbar">
          <button id="layoutBtn">Re-layout</button>
          <select id="layerSelect">
            <option value="all">All Layers</option>
            <option value="ast">AST Only</option>
            <option value="cfg">CFG Only</option>
            <option value="pdg">PDG Only</option>
          </select>
          <input type="text" id="searchBox" placeholder="Search nodes...">
          <button id="zoomInBtn">+</button>
          <button id="zoomOutBtn">-</button>
          <button id="resetBtn">Reset View</button>
        </div>
        <div id="graph-container"></div>
        <div id="info-panel"></div>

        <script nonce="${nonce}" src="${d3Uri}"></script>
        <script nonce="${nonce}" src="${scriptUri}"></script>
      </body>
      </html>`;
  }

  public dispose(): void {
    CPGGraphPanel.currentPanel = undefined;

    this._panel.dispose();

    while (this._disposables.length) {
      const disposable = this._disposables.pop();
      if (disposable) {
        disposable.dispose();
      }
    }
  }
}

function getNonce(): string {
  let text = '';
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}
```

## Theme Color Synchronization

### Color Extraction

```typescript
// src/theme/ThemeColorExtractor.ts
import * as vscode from 'vscode';

export interface ThemeColors {
  background: string;
  foreground: string;
  accent: string;

  // Node colors by type
  methodColor: string;
  classColor: string;
  variableColor: string;
  literalColor: string;
  keywordColor: string;

  // Edge colors
  astEdgeColor: string;
  cfgEdgeColor: string;
  ddgEdgeColor: string;
  cdgEdgeColor: string;

  // Special
  activeFileColor: string;  // VERY visible color
  highlightColor: string;
}

export class ThemeColorExtractor {
  extractColors(theme: vscode.ColorTheme): ThemeColors {
    const isDark = theme.kind === vscode.ColorThemeKind.Dark ||
                   theme.kind === vscode.ColorThemeKind.HighContrast;

    // Get semantic colors from theme
    const background = this.getColor('editor.background', '#1e1e1e', '#ffffff');
    const foreground = this.getColor('editor.foreground', '#d4d4d4', '#000000');

    // Extract syntax token colors
    const tokenColors = this.extractTokenColors();

    return {
      background: background,
      foreground: foreground,
      accent: this.getColor('focusBorder', '#007acc', '#0066bf'),

      // Map syntax colors to node types
      methodColor: tokenColors.function || '#dcdcaa',
      classColor: tokenColors.class || '#4ec9b0',
      variableColor: tokenColors.variable || '#9cdcfe',
      literalColor: tokenColors.string || '#ce9178',
      keywordColor: tokenColors.keyword || '#569cd6',

      // Edge colors (lighter/darker based on theme)
      astEdgeColor: isDark ? '#555555' : '#bbbbbb',
      cfgEdgeColor: isDark ? '#6a9955' : '#008000',
      ddgEdgeColor: isDark ? '#d7ba7d' : '#a07000',
      cdgEdgeColor: isDark ? '#c586c0' : '#a000a0',

      // Active file: VERY visible - bright orange/yellow
      activeFileColor: '#ff6600',  // Bright orange (visible in both themes)

      // Highlight color
      highlightColor: this.getColor(
        'editor.selectionBackground',
        '#264f78',
        '#add6ff'
      )
    };
  }

  private getColor(
    tokenName: string,
    darkDefault: string,
    lightDefault: string
  ): string {
    // Try to get from VS Code theme
    try {
      const color = new vscode.ThemeColor(tokenName);
      // Note: Can't directly get RGB value in extension host
      // Will use defaults for now
      const isDark = vscode.window.activeColorTheme.kind ===
                     vscode.ColorThemeKind.Dark;
      return isDark ? darkDefault : lightDefault;
    } catch {
      const isDark = vscode.window.activeColorTheme.kind ===
                     vscode.ColorThemeKind.Dark;
      return isDark ? darkDefault : lightDefault;
    }
  }

  private extractTokenColors(): Record<string, string> {
    // This is a simplified version
    // In practice, would parse .vscode/settings.json or theme files
    return {
      function: '#dcdcaa',
      class: '#4ec9b0',
      variable: '#9cdcfe',
      string: '#ce9178',
      keyword: '#569cd6',
      comment: '#6a9955'
    };
  }
}
```

### Active File Highlighting

```typescript
// When active editor changes
vscode.window.onDidChangeActiveTextEditor((editor) => {
  if (editor) {
    const activeFilePath = editor.document.uri.fsPath;

    CPGGraphPanel.currentPanel?.postMessage({
      command: 'setActiveFile',
      filePath: activeFilePath
    });
  }
});
```

## Graph Visualization (D3.js Implementation)

### Webview Script

```javascript
// media/graph.js
(function() {
  const vscode = acquireVsCodeApi();

  let graphData = { nodes: [], edges: [] };
  let themeColors = {};
  let activeFilePath = null;

  // D3.js force simulation
  let simulation;
  let svg;
  let g;  // Main group for zoom/pan
  let nodeElements;
  let edgeElements;
  let labelElements;

  // Initialize visualization
  function init() {
    const container = document.getElementById('graph-container');
    const width = container.clientWidth;
    const height = container.clientHeight;

    // Create SVG
    svg = d3.select('#graph-container')
      .append('svg')
      .attr('width', width)
      .attr('height', height);

    // Add zoom behavior
    const zoom = d3.zoom()
      .scaleExtent([0.1, 10])
      .on('zoom', (event) => {
        g.attr('transform', event.transform);
      });

    svg.call(zoom);

    // Main group for graph elements
    g = svg.append('g');

    // Create arrow markers for edges
    svg.append('defs').selectAll('marker')
      .data(['ast', 'cfg', 'ddg', 'cdg'])
      .join('marker')
      .attr('id', d => `arrow-${d}`)
      .attr('viewBox', '0 -5 10 10')
      .attr('refX', 20)
      .attr('refY', 0)
      .attr('markerWidth', 6)
      .attr('markerHeight', 6)
      .attr('orient', 'auto')
      .append('path')
      .attr('d', 'M0,-5L10,0L0,5')
      .attr('fill', d => getEdgeColor(d));

    // Request initial data
    vscode.postMessage({ command: 'getGraphData' });
    vscode.postMessage({ command: 'requestThemeColors' });

    // Set up toolbar
    setupToolbar();
  }

  // Render graph
  function renderGraph() {
    if (!graphData.nodes || graphData.nodes.length === 0) {
      return;
    }

    // Create force simulation
    simulation = d3.forceSimulation(graphData.nodes)
      .force('link', d3.forceLink(graphData.edges)
        .id(d => d.id)
        .distance(100))
      .force('charge', d3.forceManyBody()
        .strength(-300))
      .force('center', d3.forceCenter(
        svg.attr('width') / 2,
        svg.attr('height') / 2
      ))
      .force('collision', d3.forceCollide().radius(30));

    // Render edges
    edgeElements = g.append('g')
      .selectAll('line')
      .data(graphData.edges)
      .join('line')
      .attr('class', d => `edge edge-${d.type}`)
      .attr('stroke', d => getEdgeColor(d.type))
      .attr('stroke-width', 2)
      .attr('marker-end', d => `url(#arrow-${d.type})`);

    // Render nodes
    nodeElements = g.append('g')
      .selectAll('circle')
      .data(graphData.nodes)
      .join('circle')
      .attr('class', d => `node node-${d.label}`)
      .attr('r', d => getNodeRadius(d))
      .attr('fill', d => getNodeColor(d))
      .attr('stroke', d => isActiveFile(d) ? themeColors.activeFileColor : '#000')
      .attr('stroke-width', d => isActiveFile(d) ? 4 : 1)
      .call(drag(simulation))
      .on('click', (event, d) => {
        vscode.postMessage({
          command: 'nodeClicked',
          nodeId: d.id
        });
      })
      .on('mouseover', (event, d) => {
        showNodeInfo(d);
      });

    // Render labels
    labelElements = g.append('g')
      .selectAll('text')
      .data(graphData.nodes)
      .join('text')
      .attr('class', 'node-label')
      .attr('text-anchor', 'middle')
      .attr('dy', 4)
      .attr('fill', themeColors.foreground)
      .text(d => d.name || d.label);

    // Update positions on tick
    simulation.on('tick', () => {
      edgeElements
        .attr('x1', d => d.source.x)
        .attr('y1', d => d.source.y)
        .attr('x2', d => d.target.x)
        .attr('y2', d => d.target.y);

      nodeElements
        .attr('cx', d => d.x)
        .attr('cy', d => d.y);

      labelElements
        .attr('x', d => d.x)
        .attr('y', d => d.y);
    });
  }

  // Get node color based on type and theme
  function getNodeColor(node) {
    // Active file nodes get special color
    if (isActiveFile(node)) {
      return themeColors.activeFileColor;
    }

    switch (node.label) {
      case 'METHOD':
        return themeColors.methodColor;
      case 'TYPE_DECL':
        return themeColors.classColor;
      case 'LOCAL':
      case 'IDENTIFIER':
        return themeColors.variableColor;
      case 'LITERAL':
        return themeColors.literalColor;
      case 'CONTROL_STRUCTURE':
        return themeColors.keywordColor;
      default:
        return themeColors.foreground;
    }
  }

  // Get edge color based on type
  function getEdgeColor(edgeType) {
    switch (edgeType) {
      case 'AST':
        return themeColors.astEdgeColor;
      case 'CFG':
        return themeColors.cfgEdgeColor;
      case 'DDG':
      case 'REACHING_DEF':
        return themeColors.ddgEdgeColor;
      case 'CDG':
        return themeColors.cdgEdgeColor;
      default:
        return themeColors.foreground;
    }
  }

  // Check if node belongs to active file
  function isActiveFile(node) {
    return activeFilePath && node.filePath === activeFilePath;
  }

  // Get node radius based on type
  function getNodeRadius(node) {
    switch (node.label) {
      case 'METHOD':
      case 'TYPE_DECL':
        return 12;
      case 'CONTROL_STRUCTURE':
        return 10;
      case 'CALL':
        return 8;
      default:
        return 6;
    }
  }

  // Drag behavior
  function drag(simulation) {
    function dragstarted(event) {
      if (!event.active) simulation.alphaTarget(0.3).restart();
      event.subject.fx = event.subject.x;
      event.subject.fy = event.subject.y;
    }

    function dragged(event) {
      event.subject.fx = event.x;
      event.subject.fy = event.y;
    }

    function dragended(event) {
      if (!event.active) simulation.alphaTarget(0);
      event.subject.fx = null;
      event.subject.fy = null;
    }

    return d3.drag()
      .on('start', dragstarted)
      .on('drag', dragged)
      .on('end', dragended);
  }

  // Show node info panel
  function showNodeInfo(node) {
    const infoPanel = document.getElementById('info-panel');
    infoPanel.innerHTML = `
      <h3>${node.name || node.label}</h3>
      <p><strong>Type:</strong> ${node.label}</p>
      <p><strong>File:</strong> ${node.filePath}</p>
      <p><strong>Line:</strong> ${node.lineNumber}</p>
      <pre><code>${node.code}</code></pre>
    `;
    infoPanel.style.display = 'block';
  }

  // Handle messages from extension
  window.addEventListener('message', (event) => {
    const message = event.data;

    switch (message.command) {
      case 'graphData':
        graphData = {
          nodes: message.nodes,
          edges: message.edges
        };
        renderGraph();
        break;

      case 'updateTheme':
        themeColors = message.colors;
        if (nodeElements) {
          nodeElements.attr('fill', d => getNodeColor(d));
        }
        if (edgeElements) {
          edgeElements.attr('stroke', d => getEdgeColor(d.type));
        }
        break;

      case 'setActiveFile':
        activeFilePath = message.filePath;
        if (nodeElements) {
          nodeElements
            .attr('fill', d => getNodeColor(d))
            .attr('stroke', d => isActiveFile(d) ? themeColors.activeFileColor : '#000')
            .attr('stroke-width', d => isActiveFile(d) ? 4 : 1);
        }
        break;

      case 'highlightNode':
        highlightNode(message.nodeId);
        break;
    }
  });

  // Highlight specific node
  function highlightNode(nodeId) {
    if (nodeElements) {
      nodeElements
        .attr('stroke', d => d.id === nodeId ? themeColors.highlightColor :
                              isActiveFile(d) ? themeColors.activeFileColor : '#000')
        .attr('stroke-width', d => d.id === nodeId ? 6 :
                                    isActiveFile(d) ? 4 : 1);

      // Center on highlighted node
      const node = graphData.nodes.find(n => n.id === nodeId);
      if (node && simulation) {
        // Zoom to node
        const scale = 2;
        const translate = [
          svg.attr('width') / 2 - scale * node.x,
          svg.attr('height') / 2 - scale * node.y
        ];

        svg.transition()
          .duration(750)
          .call(
            d3.zoom().transform,
            d3.zoomIdentity.translate(translate[0], translate[1]).scale(scale)
          );
      }
    }
  }

  // Toolbar setup
  function setupToolbar() {
    document.getElementById('layoutBtn').addEventListener('click', () => {
      if (simulation) {
        simulation.alpha(1).restart();
      }
    });

    document.getElementById('layerSelect').addEventListener('change', (e) => {
      filterByLayer(e.target.value);
    });

    document.getElementById('searchBox').addEventListener('input', (e) => {
      searchNodes(e.target.value);
    });

    document.getElementById('zoomInBtn').addEventListener('click', () => {
      svg.transition().call(d3.zoom().scaleBy, 1.3);
    });

    document.getElementById('zoomOutBtn').addEventListener('click', () => {
      svg.transition().call(d3.zoom().scaleBy, 0.7);
    });

    document.getElementById('resetBtn').addEventListener('click', () => {
      svg.transition().call(
        d3.zoom().transform,
        d3.zoomIdentity
      );
    });
  }

  // Filter by layer
  function filterByLayer(layer) {
    if (!edgeElements) return;

    edgeElements.style('display', d => {
      if (layer === 'all') return 'block';
      if (layer === 'ast') return d.type === 'AST' ? 'block' : 'none';
      if (layer === 'cfg') return d.type === 'CFG' ? 'block' : 'none';
      if (layer === 'pdg') return ['DDG', 'CDG', 'REACHING_DEF'].includes(d.type) ? 'block' : 'none';
      return 'block';
    });
  }

  // Search nodes
  function searchNodes(query) {
    if (!nodeElements) return;

    const lowerQuery = query.toLowerCase();

    nodeElements
      .attr('opacity', d => {
        if (!query) return 1;
        const matches = (d.name && d.name.toLowerCase().includes(lowerQuery)) ||
                       (d.code && d.code.toLowerCase().includes(lowerQuery));
        return matches ? 1 : 0.2;
      });

    labelElements
      .attr('opacity', d => {
        if (!query) return 1;
        const matches = (d.name && d.name.toLowerCase().includes(lowerQuery)) ||
                       (d.code && d.code.toLowerCase().includes(lowerQuery));
        return matches ? 1 : 0.2;
      });
  }

  // Initialize on load
  init();
})();
```

## Performance Optimization

### Viewport Culling

For large graphs (1000+ nodes), only render visible nodes:

```javascript
function updateVisibleNodes() {
  const transform = d3.zoomTransform(svg.node());
  const viewport = {
    x: -transform.x / transform.k,
    y: -transform.y / transform.k,
    width: svg.attr('width') / transform.k,
    height: svg.attr('height') / transform.k
  };

  nodeElements.style('display', d => {
    const isVisible = d.x >= viewport.x &&
                     d.x <= viewport.x + viewport.width &&
                     d.y >= viewport.y &&
                     d.y <= viewport.y + viewport.height;
    return isVisible ? 'block' : 'none';
  });
}
```

### WebGL Rendering

For very large graphs (5000+ nodes), consider using WebGL with libraries like:
- **Sigma.js**: WebGL-based graph visualization
- **Graphology**: High-performance graph data structure

### Progressive Loading

```typescript
async function loadGraphProgressively(filePath: string): Promise<void> {
  // Load in batches
  const batchSize = 100;
  let offset = 0;

  while (true) {
    const batch = await dbClient.query(`
      MATCH (f:FILE {path: $filePath})-[:CONTAINS*]->(n)
      RETURN n
      SKIP $offset
      LIMIT $batchSize
    `, { filePath, offset, batchSize });

    if (batch.length === 0) break;

    // Send batch to webview
    CPGGraphPanel.currentPanel?.postMessage({
      command: 'addNodes',
      nodes: batch
    });

    offset += batchSize;
  }
}
```

## Testing Strategy

### Unit Tests

- Test theme color extraction
- Verify message passing
- Test node/edge filtering

### Integration Tests

- End-to-end navigation (code → graph)
- Theme synchronization
- File save → graph update

### UI Tests

- Test with large graphs
- Verify performance metrics
- Test on different themes

## Future Enhancements

1. **Mini-map**: Overview + detail visualization
2. **Timeline**: Show graph evolution over commits
3. **Export**: Save graph as image/GraphML/DOT
4. **Custom layouts**: Tree, hierarchical, circular
5. **Collaborative**: Share graph views with team
6. **Query builder**: Visual Cypher query construction

## Summary

The Visualization Layer provides:
- Real-time, interactive CPG visualization
- Theme-aware node coloring
- Active file highlighting (VERY visible)
- Bidirectional code-graph navigation
- Performance optimization for large graphs
- Extensible architecture for future features
