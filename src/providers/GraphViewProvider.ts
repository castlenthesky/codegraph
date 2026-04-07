import * as vscode from 'vscode';
import * as crypto from 'crypto';
import type { IGraphStore } from '../types/storage';
import type { IGraphViewProvider } from '../types/visualization';
import { DiffEngine } from '../services/sync/DiffEngine';
import type { GraphData } from '../services/sync/DiffEngine';
import { cpgNodeVal } from '../utils/cpgNodeUtils';
import { snapshotGraph } from '../utils/graphSnapshot';

function getNonce(): string {
	return crypto.randomBytes(16).toString('base64');
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
	private _disposables: vscode.Disposable[] = [];

	constructor(
		private readonly store: IGraphStore,
		private readonly diffEngine: DiffEngine,
		private readonly extensionUri: vscode.Uri,
		private readonly detailsProvider?: { showNodeDetails(node: any): void }
	) {}

	public async resolveWebviewView(webviewView: vscode.WebviewView, _context: vscode.WebviewViewResolveContext, _token: vscode.CancellationToken) {
		this._view = webviewView;
		webviewView.webview.options = {
			enableScripts: true,
			localResourceRoots: [
				vscode.Uri.joinPath(this.extensionUri, 'node_modules'),
				vscode.Uri.joinPath(this.extensionUri, 'media'),
			]
		};
		this._view.webview.html = this.getHtml(webviewView.webview);

		// Send initial data only after the webview signals it is ready.
		// This prevents postMessage from firing before the JS message listener is registered.
		this._disposables.push(
			webviewView.webview.onDidReceiveMessage(async (message) => {
				if (message.command === 'ready') {
					await this.updateView();
				} else if (message.command === 'refresh') {
					await this.refresh();
				} else if (message.command === 'nodeClick') {
					this.detailsProvider?.showNodeDetails(message.node);
				}
			})
		);
	}

	public dispose(): void {
		this._disposables.forEach(d => d.dispose());
		this._disposables = [];
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
				name: node.name ?? node.id,
				type: node.label,
				code: ('code' in node ? node.code : undefined)?.substring(0, 40),
				val: cpgNodeVal(node.label)
			}));

			const links = dbEdges.map(edge => ({
				source: edge.source,
				target: edge.target,
				type: edge.type
			}));

			console.log(`[CodeGraph] Full graph load: ${nodes.length} nodes, ${links.length} links`);
			console.log('[CodeGraph] Graph snapshot:', JSON.stringify(snapshotGraph(dbNodes, dbEdges)));
			this._view.webview.postMessage({ command: 'updateGraph', data: { nodes, links } });

		} catch (error: any) {
			console.error('Error updating graph view:', error);
			this.currentGraphData = { nodes: [], edges: [] };
			this._view.webview.postMessage({ command: 'error', text: 'Failed to load graph data. Check the Output panel for details.' });
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
				console.log('[CodeGraph] No changes detected, skipping update');
				return;
			}

			const { nodesToAdd, nodesToRemove, nodesToUpdate, edgesToAdd, edgesToRemove } = diff;
			console.log(`[CodeGraph] Incremental update: +${nodesToAdd.length} nodes, -${nodesToRemove.length} nodes, +${edgesToAdd.length} edges, -${edgesToRemove.length} edges`);
			if (nodesToRemove.length > 0) {
				console.log(`[CodeGraph] Removing nodes:`, nodesToRemove.slice(0, 10));
			}
			if (nodesToAdd.length > 5) {
				console.log(`[CodeGraph] Adding ${nodesToAdd.length} nodes (first 5):`, nodesToAdd.slice(0, 5).map(n => n.id));
			}

			this.currentGraphData = newGraphData;

			const patch = this.diffEngine.createIncrementalPatch(diff);

			this._view.webview.postMessage({ command: 'incrementalUpdate', patch });

		} catch (error: any) {
			console.error('Error updating graph view incrementally:', error);
			try {
				await this.updateView();
			} catch (fallbackError) {
				console.error('[GraphViewProvider] Fallback full-refresh also failed:', fallbackError);
				this._view?.webview.postMessage({ command: 'error', message: 'Failed to refresh graph view' });
			}
		}
	}

	private getHtml(webview: vscode.Webview): string {
		const nonce = getNonce();
		const forceGraphUri = webview.asWebviewUri(
			vscode.Uri.joinPath(this.extensionUri, 'node_modules', 'force-graph', 'dist', 'force-graph.min.js')
		);
		const webviewScriptUri = webview.asWebviewUri(
			vscode.Uri.joinPath(this.extensionUri, 'media', 'graphWebview.js')
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
        #error-message { display: none; position: absolute; top: 10px; left: 50%; transform: translateX(-50%); background: var(--vscode-inputValidation-errorBackground); color: var(--vscode-inputValidation-errorForeground); border: 1px solid var(--vscode-inputValidation-errorBorder); padding: 8px 16px; border-radius: 4px; z-index: 10; }
    </style>
    <script nonce="${nonce}" src="${forceGraphUri}"></script>
</head>
<body>
    <div id="graph-container"></div>
    <div id="error-message"></div>
    <script nonce="${nonce}" src="${webviewScriptUri}"></script>
</body>
</html>`;
	}
}
