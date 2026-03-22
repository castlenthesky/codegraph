import * as vscode from 'vscode';

export class DetailsViewProvider implements vscode.WebviewViewProvider {
	public resolveWebviewView(webviewView: vscode.WebviewView, context: vscode.WebviewViewResolveContext, _token: vscode.CancellationToken) {
		webviewView.webview.options = { enableScripts: true };
		webviewView.webview.html = this.getHtml();
	}

	private getHtml() {
		return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Details</title>
    <style>
        body { font-family: var(--vscode-font-family); padding: 15px; color: var(--vscode-foreground); line-height: 1.5; }
        ul { padding-left: 20px; }
        li { margin-bottom: 8px; }
        code { background-color: var(--vscode-textCodeBlock-background); padding: 2px 4px; border-radius: 3px; font-family: var(--vscode-editor-font-family); font-size: 0.9em; }
    </style>
</head>
<body>
    <h2>Node / Edge Details</h2>
    <ul>
        <li>Dead code in <code>src/services/abandoned_service</code></li>
        <li>Database layer importing from services layer</li>
        <li>Imports not coming from module root, consider reorganizing import structure</li>
    </ul>
</body>
</html>`;
	}
}
