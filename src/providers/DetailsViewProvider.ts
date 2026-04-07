import * as vscode from 'vscode';

export class DetailsViewProvider implements vscode.WebviewViewProvider {
	private _view?: vscode.WebviewView;

	public resolveWebviewView(webviewView: vscode.WebviewView, _context: vscode.WebviewViewResolveContext, _token: vscode.CancellationToken) {
		this._view = webviewView;
		webviewView.webview.options = { enableScripts: true };
		webviewView.webview.html = this.getHtml();
	}

	public showNodeDetails(node: { id: string; name: string; type: string; code?: string }): void {
		if (!this._view) { return; }
		this._view.webview.postMessage({ command: 'showNode', node });
	}

	private getHtml(): string {
		return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Details</title>
    <style>
        body { font-family: var(--vscode-font-family); padding: 12px; color: var(--vscode-foreground); line-height: 1.5; margin: 0; }
        .placeholder { color: var(--vscode-descriptionForeground); font-style: italic; }
        .field { margin-bottom: 8px; }
        .label { font-size: 0.8em; color: var(--vscode-descriptionForeground); text-transform: uppercase; letter-spacing: 0.05em; }
        .value { margin-top: 2px; word-break: break-all; }
        code { background: var(--vscode-textCodeBlock-background); padding: 2px 4px; border-radius: 3px; font-family: var(--vscode-editor-font-family); font-size: 0.9em; }
        #type-badge { display: inline-block; padding: 2px 8px; border-radius: 3px; font-size: 0.8em; font-weight: bold; background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); margin-bottom: 10px; }
    </style>
</head>
<body>
    <div id="content">
        <p class="placeholder">Click a node in the graph to see its details.</p>
    </div>
    <script>
        const content = document.getElementById('content');
        window.addEventListener('message', event => {
            const msg = event.data;
            if (msg.command !== 'showNode') { return; }
            const n = msg.node;
            content.innerHTML = \`
                <div id="type-badge">\${n.type}</div>
                <div class="field"><div class="label">Name</div><div class="value">\${n.name || '<em>unnamed</em>'}</div></div>
                <div class="field"><div class="label">ID</div><div class="value" style="font-size:0.85em;opacity:0.7">\${n.id}</div></div>
                \${n.code ? \`<div class="field"><div class="label">Code</div><div class="value"><code>\${n.code}</code></div></div>\` : ''}
            \`;
        });
    </script>
</body>
</html>`;
	}
}
