import * as vscode from 'vscode';
import type { IGraphStore } from '../types/storage';
import type { IGraphViewProvider } from '../types/visualization';
import { DiffEngine } from '../services/sync/DiffEngine';
import type { GraphData, IncrementalPatch } from '../services/sync/DiffEngine';

/**
 * VS Code Webview Provider for the force-directed Code Property Graph visualization.
 *
 * Supports incremental updates via DiffEngine to avoid full graph redraws.
 * Implements IGraphViewProvider so it can be injected into FileWatcher and Reconciler.
 */
export class GraphViewProvider implements vscode.WebviewViewProvider, IGraphViewProvider {
	private _view?: vscode.WebviewView;
	private currentGraphData: GraphData | null = null;

	constructor(
		private readonly store: IGraphStore,
		private readonly diffEngine: DiffEngine
	) {}

	public resolveWebviewView(webviewView: vscode.WebviewView, context: vscode.WebviewViewResolveContext, _token: vscode.CancellationToken) {
		this._view = webviewView;
		webviewView.webview.options = { enableScripts: true };
		this._view.webview.html = this.getHtml();

		this.updateView();

		webviewView.webview.onDidReceiveMessage(async (message) => {
			if (message.command === 'refresh') {
				await this.refresh();
			}
		});
	}

	public async refresh(): Promise<void> {
		await this.updateViewIncremental();
	}

	private async updateView(): Promise<void> {
		if (!this._view) {
			return;
		}

		try {
			const { nodes: dbNodes, edges: dbEdges } = await this.store.getAllNodesAndEdges();

			this.currentGraphData = { nodes: dbNodes, edges: dbEdges };

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

			this._view.webview.postMessage({ command: 'updateGraph', data: { nodes, links } });

		} catch (error: any) {
			console.error('Error updating graph view:', error);
			this.currentGraphData = { nodes: [], edges: [] };
			this._view.webview.postMessage({ command: 'updateGraph', data: { nodes: [], links: [] } });
		}
	}

	private async updateViewIncremental(): Promise<void> {
		if (!this._view) {
			return;
		}

		try {
			const { nodes: dbNodes, edges: dbEdges } = await this.store.getAllNodesAndEdges();
			const newGraphData: GraphData = { nodes: dbNodes, edges: dbEdges };

			if (!this.currentGraphData) {
				this.currentGraphData = newGraphData;
				await this.updateView();
				return;
			}

			const diff = this.diffEngine.computeDiff(this.currentGraphData, newGraphData);

			if (!this.diffEngine.hasChanges(diff)) {
				return;
			}

			this.currentGraphData = newGraphData;

			const patch = this.diffEngine.createIncrementalPatch(diff);

			this._view.webview.postMessage({ command: 'incrementalUpdate', patch });

		} catch (error: any) {
			console.error('Error updating graph view incrementally:', error);
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
                Graph.graphData(message.data);
            }
            else if (message.command === 'incrementalUpdate') {
                const patch = message.patch;
                const { nodes, links } = Graph.graphData();
                let newNodes = [...nodes];
                let newLinks = [...links];

                if (patch.removeNodes && patch.removeNodes.length > 0) {
                    const nodeIdsToRemove = new Set(patch.removeNodes);
                    newNodes = newNodes.filter(n => !nodeIdsToRemove.has(n.id));
                }

                if (patch.removeLinks && patch.removeLinks.length > 0) {
                    const linksToRemove = new Set(
                        patch.removeLinks.map(l => \`\${l.source}|\${l.target}\`)
                    );
                    newLinks = newLinks.filter(l => {
                        const key = \`\${l.source.id || l.source}|\${l.target.id || l.target}\`;
                        return !linksToRemove.has(key);
                    });
                }

                if (patch.addNodes && patch.addNodes.length > 0) {
                    newNodes = [...newNodes, ...patch.addNodes];
                }

                if (patch.addLinks && patch.addLinks.length > 0) {
                    newLinks = [...newLinks, ...patch.addLinks];
                }

                if (patch.updateLinks && patch.updateLinks.length > 0) {
                    const updateMap = new Map(
                        patch.updateLinks.map(l => [\`\${l.source}|\${l.target}\`, l])
                    );
                    newLinks = newLinks.map(link => {
                        const key = \`\${link.source.id || link.source}|\${link.target.id || link.target}\`;
                        const update = updateMap.get(key);
                        return update ? { ...link, ...update } : link;
                    });
                }

                if (patch.updateNodes && patch.updateNodes.length > 0) {
                    const updateMap = new Map(patch.updateNodes.map(n => [n.id, n]));
                    newNodes = newNodes.map(node => {
                        const update = updateMap.get(node.id);
                        return update ? { ...node, ...update } : node;
                    });
                }

                Graph.graphData({ nodes: newNodes, links: newLinks });
            }
        });
    </script>
</body>
</html>`;
	}
}
