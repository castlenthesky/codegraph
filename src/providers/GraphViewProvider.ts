import * as vscode from 'vscode';
import * as crypto from 'crypto';
import type { IGraphStore } from '../types/storage';
import type { IGraphViewProvider } from '../types/visualization';
import { DiffEngine } from '../services/sync/DiffEngine';
import type { GraphData, IncrementalPatch } from '../services/sync/DiffEngine';

function getNonce(): string {
	return crypto.randomBytes(16).toString('base64');
}

function cpgNodeVal(label: string): number {
	switch (label) {
		case 'METHOD': return 4;
		case 'TYPE_DECL': return 3;
		case 'DIRECTORY': return 3;
		case 'CALL': return 2;
		case 'CONTROL_STRUCTURE': return 2;
		case 'IDENTIFIER': return 1.5;
		case 'LITERAL': return 1.5;
		case 'BLOCK': return 1;
		default: return 2;
	}
}

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
		private readonly diffEngine: DiffEngine,
		private readonly extensionUri: vscode.Uri
	) {}

	public resolveWebviewView(webviewView: vscode.WebviewView, context: vscode.WebviewViewResolveContext, _token: vscode.CancellationToken) {
		this._view = webviewView;
		webviewView.webview.options = {
			enableScripts: true,
			localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'node_modules')]
		};
		this._view.webview.html = this.getHtml(webviewView.webview);

		// Send initial data only after the webview signals it is ready.
		// This prevents postMessage from firing before the JS message listener is registered.
		webviewView.webview.onDidReceiveMessage(async (message) => {
			if (message.command === 'ready') {
				await this.updateView();
			} else if (message.command === 'refresh') {
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
				name: (node as any).name ?? node.id,
				type: node.label,
				code: (node as any).code?.substring(0, 40),
				val: cpgNodeVal(node.label)
			}));

			const links = dbEdges.map(edge => ({
				source: edge.source,
				target: edge.target,
				type: edge.type
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

	private getHtml(webview: vscode.Webview): string {
		const nonce = getNonce();
		const forceGraphUri = webview.asWebviewUri(
			vscode.Uri.joinPath(this.extensionUri, 'node_modules', 'force-graph', 'dist', 'force-graph.min.js')
		);
		const csp = [
			`default-src 'none'`,
			`script-src 'nonce-${nonce}'`,
			`style-src 'unsafe-inline'`,
		].join('; ');

		return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="${csp}">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Graph View</title>
    <style>
        body, html { margin: 0; padding: 0; width: 100%; height: 100%; overflow: hidden; background-color: var(--vscode-editor-background); }
        #graph-container { width: 100%; height: 100vh; }
    </style>
    <script nonce="${nonce}" src="${forceGraphUri}"></script>
</head>
<body>
    <div id="graph-container"></div>
    <script nonce="${nonce}">
        const vscodeApi = acquireVsCodeApi();
        const elem = document.getElementById('graph-container');
        const linkColor = getComputedStyle(document.body).getPropertyValue('--vscode-editorLineNumber-foreground') || '#858585';

        function nodeColor(node) {
            switch (node.type) {
                case 'METHOD': return '#4FC1FF';
                case 'TYPE_DECL': return '#4EC9B0';
                case 'CALL': return '#CE9178';
                case 'CONTROL_STRUCTURE': return '#C586C0';
                case 'IDENTIFIER': return '#DCDCAA';
                case 'LITERAL': return '#B5CEA8';
                case 'BLOCK': return '#555555';
                case 'RETURN': return '#C586C0';
                case 'LOCAL': return '#9CDCFE';
                case 'DIRECTORY': return '#808080';
                case 'FILE': return '#FFFFFF';
                default: return '#858585';
            }
        }

        const Graph = ForceGraph()(elem)
            .width(window.innerWidth)
            .height(window.innerHeight)
            .nodeLabel(node => \`\${node.type}: \${node.name || (node.code ? node.code.substring(0, 40) : node.id)}\`)
            .nodeColor(node => nodeColor(node))
            .linkColor(link => {
                switch (link.type) {
                    case 'AST': return '#444444';
                    case 'CFG': return '#4FC1FF';
                    case 'REACHING_DEF': return '#F44747';
                    case 'CDG': return '#C586C0';
                    case 'CALL': return '#CE9178';
                    case 'SOURCE_FILE': return '#333333';
                    default: return linkColor;
                }
            })
            .linkWidth(link => {
                switch (link.type) {
                    case 'CFG': return 2;
                    case 'REACHING_DEF': return 2;
                    case 'CDG': return 1.5;
                    case 'CALL': return 2;
                    default: return 1;
                }
            })
            .nodeRelSize(4)
            .d3VelocityDecay(0.1);

        window.addEventListener('resize', () => {
            Graph.width(window.innerWidth).height(window.innerHeight);
        });

        // Signal the extension that the webview JS is ready to receive data
        vscodeApi.postMessage({ command: 'ready' });

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
