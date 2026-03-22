import * as vscode from 'vscode';
import { FalkorDBService } from '../services/FalkorDBService';
import { GraphDiffService, type GraphData, type IncrementalPatch } from '../services/GraphDiffService';

/**
 * VS Code Webview Provider that manages the visualization of the Code Property Graph.
 *
 * Interactions:
 * - Listens for external events (like via `GraphSynchronizer` or `AtomicUpdate`) to trigger
 *   visual updates when the underlying graph data correctly modifies.
 * - Supports incremental updates using GraphDiffService to avoid full graph redraws.
 */
export class GraphViewProvider implements vscode.WebviewViewProvider {
	private _view?: vscode.WebviewView;
	private dbService: FalkorDBService;
	private diffService: GraphDiffService;
	private currentGraphData: GraphData | null = null;

	constructor() {
		this.dbService = FalkorDBService.getInstance();
		this.diffService = new GraphDiffService();
	}

	public resolveWebviewView(webviewView: vscode.WebviewView, context: vscode.WebviewViewResolveContext, _token: vscode.CancellationToken) {
		this._view = webviewView;
		webviewView.webview.options = { enableScripts: true };
		
		// Initialize the HTML shell once
		this._view.webview.html = this.getHtml();

		this.updateView();

		// Listen for refresh requests from the webview
		webviewView.webview.onDidReceiveMessage(async (message) => {
			if (message.command === 'refresh') {
				await this.refresh();
			}
		});
	}

	/**
	 * Refresh the graph view (called by FileSystemWatcher)
	 * Uses incremental updates when possible to avoid full redraw
	 */
	public async refresh(): Promise<void> {
		await this.updateViewIncremental();
	}

	/**
	 * Update the webview with latest data from FalkorDB (full replace)
	 * Use this for initial load or force refresh
	 */
	private async updateView(): Promise<void> {
		if (!this._view) {
			return;
		}

		try {
			// Query FalkorDB for all nodes and edges
			const { nodes: dbNodes, edges: dbEdges } = await this.dbService.getAllNodesAndEdges();

			// Store current graph data for future diff calculations
			this.currentGraphData = { nodes: dbNodes, edges: dbEdges };

			// Transform to force-graph format
			const nodes = dbNodes.map(node => ({
				id: node.id,
				name: node.name,
				type: node.label,
				val: node.label === 'DIRECTORY' ? 3 : 2
			}));

			const links = dbEdges.map(edge => ({
				source: edge.source,
				target: edge.target
			}));

			const graphData = { nodes, links };

			// Send message to dynamically update the graph
			this._view.webview.postMessage({ command: 'updateGraph', data: graphData });

		} catch (error: any) {
			console.error('Error updating graph view:', error);
			// Show empty graph on error
			this.currentGraphData = { nodes: [], edges: [] };
			const graphData = { nodes: [], links: [] };
			this._view.webview.postMessage({ command: 'updateGraph', data: graphData });
		}
	}

	/**
	 * Update the webview with incremental changes from FalkorDB
	 * Computes diff and sends only the changes to avoid full redraw
	 */
	private async updateViewIncremental(): Promise<void> {
		if (!this._view) {
			return;
		}

		try {
			// Query FalkorDB for all nodes and edges
			const { nodes: dbNodes, edges: dbEdges } = await this.dbService.getAllNodesAndEdges();
			const newGraphData: GraphData = { nodes: dbNodes, edges: dbEdges };

			// If no previous state, do a full update
			if (!this.currentGraphData) {
				this.currentGraphData = newGraphData;
				await this.updateView();
				return;
			}

			// Compute diff between current and new state
			const diff = this.diffService.computeDiff(this.currentGraphData, newGraphData);

			// If no changes, skip update
			if (!this.diffService.hasChanges(diff)) {
				return;
			}

			// Update stored state
			this.currentGraphData = newGraphData;

			// Create incremental patch for webview
			const patch = this.diffService.createIncrementalPatch(diff);

			// Send incremental update to webview
			this._view.webview.postMessage({ command: 'incrementalUpdate', patch });

		} catch (error: any) {
			console.error('Error updating graph view incrementally:', error);
			// Fall back to full update on error
			await this.updateView();
		}
	}

	private getHtml() {

		return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Graph View</title>
    <style>
        body, html { margin: 0; padding: 0; width: 100%; height: 100%; overflow: hidden; background-color: var(--vscode-editor-background); }
        #graph-container { width: 100%; height: 100vh; }
    </style>
    <!-- Use CDN for force-graph -->
    <script src="https://unpkg.com/force-graph"></script>
</head>
<body>
    <div id="graph-container"></div>
    <script>
        const elem = document.getElementById('graph-container');
        // Define theme colors using VS Code CSS vars or fallbacks
        const nodeColor = getComputedStyle(document.body).getPropertyValue('--vscode-symbolIcon-classForeground') || '#d1a33a';
        const linkColor = getComputedStyle(document.body).getPropertyValue('--vscode-editorLineNumber-foreground') || '#858585';

        const directoryColor = '#808080';
        const fileColor = '#FFFFFF';

        const Graph = ForceGraph()(elem)
            .width(window.innerWidth)
            .height(window.innerHeight)
            .nodeLabel('name')
            .nodeColor(node => node.type === 'DIRECTORY' ? directoryColor : fileColor)
            .linkColor(() => linkColor)
            .linkWidth(1.5)
            .nodeRelSize(4)
            .d3VelocityDecay(0.1);

        window.addEventListener('resize', () => {
            Graph.width(window.innerWidth).height(window.innerHeight);
        });

        window.addEventListener('message', event => {
            const message = event.data;

            if (message.command === 'updateGraph') {
                // Full graph update (initial load or force refresh)
                Graph.graphData(message.data);
            }
            else if (message.command === 'incrementalUpdate') {
                // Incremental update - apply changes without full redraw
                const patch = message.patch;
                const currentData = Graph.graphData();

                // Remove nodes
                if (patch.removeNodes && patch.removeNodes.length > 0) {
                    const nodeIdsToRemove = new Set(patch.removeNodes);
                    currentData.nodes = currentData.nodes.filter(n => !nodeIdsToRemove.has(n.id));
                }

                // Remove links
                if (patch.removeLinks && patch.removeLinks.length > 0) {
                    const linksToRemove = new Set(
                        patch.removeLinks.map(l => \`\${l.source}|\${l.target}\`)
                    );
                    currentData.links = currentData.links.filter(l => {
                        const key = \`\${l.source.id || l.source}|\${l.target.id || l.target}\`;
                        return !linksToRemove.has(key);
                    });
                }

                // Add new nodes
                if (patch.addNodes && patch.addNodes.length > 0) {
                    currentData.nodes.push(...patch.addNodes);
                }

                // Add new links
                if (patch.addLinks && patch.addLinks.length > 0) {
                    currentData.links.push(...patch.addLinks);
                }

                // Update existing links (remove old, add new with updated properties)
                if (patch.updateLinks && patch.updateLinks.length > 0) {
                    const updateMap = new Map(
                        patch.updateLinks.map(l => [\`\${l.source}|\${l.target}\`, l])
                    );
                    currentData.links = currentData.links.map(link => {
                        const key = \`\${link.source.id || link.source}|\${link.target.id || link.target}\`;
                        const update = updateMap.get(key);
                        return update ? { ...link, ...update } : link;
                    });
                }

                // Update existing nodes
                if (patch.updateNodes && patch.updateNodes.length > 0) {
                    const updateMap = new Map(patch.updateNodes.map(n => [n.id, n]));
                    currentData.nodes = currentData.nodes.map(node => {
                        const update = updateMap.get(node.id);
                        return update ? { ...node, ...update } : node;
                    });
                }

                // Apply the updated data
                Graph.graphData(currentData);
            }
        });
    </script>
</body>
</html>`;
	}
}
