import * as vscode from 'vscode';

export class GraphViewProvider implements vscode.WebviewViewProvider {
	public resolveWebviewView(webviewView: vscode.WebviewView, context: vscode.WebviewViewResolveContext, _token: vscode.CancellationToken) {
		webviewView.webview.options = { enableScripts: true };
		webviewView.webview.html = this.getHtml();
	}

	private getHtml() {
        // Generate mock data containing 30 nodes and 40 links
        const nodes = Array.from({ length: 30 }).map((_, i) => ({ id: `node${i}`, name: `Module ${i}`, val: Math.random() * 5 + 1 }));
        const links = Array.from({ length: 40 }).map(() => ({
            source: `node${Math.floor(Math.random() * 30)}`,
            target: `node${Math.floor(Math.random() * 30)}`,
        }));

        const graphData = { nodes, links };

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
        // Data generated from TypeScript
        const gData = ${JSON.stringify(graphData)};
        
        const elem = document.getElementById('graph-container');
        // Define theme colors using VS Code CSS vars or fallbacks
        const nodeColor = getComputedStyle(document.body).getPropertyValue('--vscode-symbolIcon-classForeground') || '#d1a33a';
        const linkColor = getComputedStyle(document.body).getPropertyValue('--vscode-editorLineNumber-foreground') || '#858585';

        const Graph = ForceGraph()(elem)
            .graphData(gData)
            .width(window.innerWidth)
            .height(window.innerHeight)
            .nodeLabel('name')
            .nodeColor(() => nodeColor)
            .linkColor(() => linkColor)
            .linkWidth(1.5)
            .nodeRelSize(4)
            .d3VelocityDecay(0.1);

        window.addEventListener('resize', () => {
            Graph.width(window.innerWidth).height(window.innerHeight);
        });
    </script>
</body>
</html>`;
	}
}
