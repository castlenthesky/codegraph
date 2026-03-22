import * as fs from 'fs';
import * as net from 'net';
import * as path from 'path';
import * as vscode from 'vscode';

export class ConfigViewProvider implements vscode.WebviewViewProvider {
	private _view?: vscode.WebviewView;
	private _interval?: NodeJS.Timeout;

	public resolveWebviewView(webviewView: vscode.WebviewView, context: vscode.WebviewViewResolveContext, _token: vscode.CancellationToken) {
		this._view = webviewView;
		webviewView.webview.options = { enableScripts: true };
		webviewView.webview.html = this.getHtml();

		webviewView.webview.onDidReceiveMessage(async (message) => {
			if (message.command === 'saveConfig') {
				const config = vscode.workspace.getConfiguration('falkordb');
				await config.update('connectionMode', message.data.connectionMode, vscode.ConfigurationTarget.Global);
				await config.update('host', message.data.host, vscode.ConfigurationTarget.Global);
				await config.update('port', Number(message.data.port), vscode.ConfigurationTarget.Global);
				await config.update('password', message.data.password, vscode.ConfigurationTarget.Global);
				await config.update('graphName', message.data.graphName, vscode.ConfigurationTarget.Global);
				await config.update('dataPath', message.data.dataPath, vscode.ConfigurationTarget.Global);
				await config.update('watchFolders', message.data.watchFolders, vscode.ConfigurationTarget.Global);

				vscode.window.showInformationMessage('FalkorDB configuration updated successfully!');
				this.checkAndSendStatus();
			} else if (message.command === 'populateDemo_REMOVED') {
		// REMOVED: Demo node population no longer needed
				try {
					const config = vscode.workspace.getConfiguration('falkordb');
					const mode = config.get<string>('connectionMode', 'embedded');
					const graphName = config.get<string>('graphName', 'default');
					
					if (mode === 'embedded') {
						const dataPath = config.get<string>('dataPath', '').replace('${workspaceFolder}', vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '');
						
						// Ensure directory exists for falkordblite
						if (dataPath && !fs.existsSync(dataPath)) {
							fs.mkdirSync(dataPath, { recursive: true });
						}

						// Resolve binary paths explicitly
						let redisServerPath: string | undefined;
						let modulePath: string | undefined;
						try {
							const pkg = require.resolve('@falkordblite/linux-x64/package.json');
							const binDir = path.join(path.dirname(pkg), 'bin');
							const _r = path.join(binDir, 'redis-server');
							const _m = path.join(binDir, 'falkordb.so');
							if (fs.existsSync(_r)) redisServerPath = _r;
							if (fs.existsSync(_m)) modulePath = _m;
						} catch (e) {
							// Fallback gracefully to let falkordblite handle resolving
						}

						const { FalkorDB } = await import('falkordblite');
						const db = await FalkorDB.open({ 
							path: dataPath || undefined,
							redisServerPath,
							modulePath
						});
						const graph = db.selectGraph(graphName);
						await graph.query("CREATE (:DemoNode {name: 'Test Node'})");
						await db.close();
					} else {
						const host = config.get<string>('host', 'localhost');
						const port = config.get<number>('port', 6379);
						let password = config.get<string>('password', '');
						
						const { FalkorDB } = await import('falkordb');
						const db = await FalkorDB.connect({
							socket: { host, port },
							password: password || undefined
						});
						const graph = db.selectGraph(graphName);
						await graph.query("CREATE (:DemoNode {name: 'Test Node'})");
						await db.close();
					}
					vscode.window.showInformationMessage('Successfully populated demo graph with a test node!');
				} catch (err: any) {
					vscode.window.showErrorMessage('Failed to populate demo graph: ' + err.message);
				}
			} else if (message.command === 'fullRefresh') {
				// Execute the full refresh command
				vscode.commands.executeCommand('codegraph.fullRefresh');
			}
		});

		// Check connection status every 30 seconds
		this.checkAndSendStatus();
		this._interval = setInterval(() => {
			this.checkAndSendStatus();
		}, 30000);

		webviewView.onDidDispose(() => {
			if (this._interval) {
				clearInterval(this._interval);
			}
		});
	}

	private async checkAndSendStatus() {
		if (!this._view) return;
		
		const config = vscode.workspace.getConfiguration('falkordb');
		const mode = config.get<string>('connectionMode', 'embedded');
		let isConnected = false;

		if (mode === 'embedded') {
			// For embedded, we assume connected if we can read the workspace or just return true as mock
			isConnected = true; 
		} else {
			const host = config.get<string>('host', 'localhost');
			const port = config.get<number>('port', 6379);
			isConnected = await new Promise<boolean>((resolve) => {
				const socket = new net.Socket();
				socket.setTimeout(2000);
				socket.on('connect', () => {
					socket.destroy();
					resolve(true);
				});
				socket.on('timeout', () => {
					socket.destroy();
					resolve(false);
				});
				socket.on('error', () => {
					resolve(false);
				});
				socket.connect(port, host);
			});
		}

		this._view.webview.postMessage({
			command: 'updateStatus',
			status: isConnected ? 'Connected' : 'Disconnected',
			color: isConnected ? 'var(--vscode-testing-iconPassed)' : 'var(--vscode-testing-iconFailed)'
		});
	}

	private getHtml() {
		const config = vscode.workspace.getConfiguration('falkordb');
		const mode = config.get<string>('connectionMode', 'embedded');
		const host = config.get<string>('host', 'localhost');
		const port = config.get<number>('port', 6379);
		const password = config.get<string>('password', '');
		const graphName = config.get<string>('graphName', 'default');
		const dataPath = config.get<string>('dataPath', '${workspaceFolder}/.codegraph');
		const watchFolders = config.get<string>('watchFolders', 'src');

		return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Config</title>
    <style>
        body { font-family: var(--vscode-font-family); padding: 15px; color: var(--vscode-foreground); }
        .form-group { margin-bottom: 15px; }
        label { display: block; margin-bottom: 5px; font-weight: 500; font-size: 13px; }
        input, select { 
            width: 100%; 
            padding: 6px; 
            box-sizing: border-box; 
            background: var(--vscode-input-background); 
            color: var(--vscode-input-foreground);
            border: 1px solid var(--vscode-input-border);
            border-radius: 2px;
            outline: none;
        }
        input:focus, select:focus {
            border-color: var(--vscode-focusBorder);
        }
        .hidden { display: none; }
		button {
			background-color: var(--vscode-button-background);
			color: var(--vscode-button-foreground);
			border: none;
			padding: 8px 12px;
			cursor: pointer;
			width: 100%;
			margin-top: 10px;
			border-radius: 2px;
		}
		button:hover { background-color: var(--vscode-button-hoverBackground); }
		#status-indicator {
			display: inline-block;
			width: 10px;
			height: 10px;
			border-radius: 50%;
			background-color: gray;
			margin-right: 5px;
		}
		.status-container {
			display: flex;
			align-items: center;
			margin-bottom: 15px;
			padding: 10px;
			background: var(--vscode-editor-inactiveSelectionBackground);
			border-radius: 4px;
		}
    </style>
</head>
<body>
	<div class="status-container">
		<span id="status-indicator"></span>
		<span id="status-text">Checking connection...</span>
	</div>

    <div class="form-group">
        <label>Connection Mode</label>
        <select id="connectionMode">
            <option value="embedded" ${mode === 'embedded' ? 'selected' : ''}>embedded</option>
            <option value="remote" ${mode === 'remote' ? 'selected' : ''}>remote</option>
        </select>
    </div>
    
	<div id="embeddedOptions" class="${mode === 'embedded' ? '' : 'hidden'}">
		<div class="form-group">
			<label>Data Path (File to be saved)</label>
			<input type="text" id="dataPath" value="${dataPath}" />
		</div>
	</div>

    <div id="remoteOptions" class="${mode === 'remote' ? '' : 'hidden'}">
		<div class="form-group">
			<label>Host</label>
			<input type="text" id="host" value="${host}" />
		</div>
		<div class="form-group">
			<label>Port</label>
			<input type="number" id="port" value="${port}" />
		</div>
		<div class="form-group">
			<label>Username</label>
			<input type="text" id="username" placeholder="default" />
		</div>
		<div class="form-group">
			<label>Password</label>
			<input type="password" id="password" value="${password}" placeholder="Enter password..." />
		</div>
	</div>

    <div class="form-group">
        <label>Graph Name</label>
        <input type="text" id="graphName" value="${graphName}" />
    </div>

    <div class="form-group">
        <label>Watch Folders (comma-separated, relative to workspace)</label>
        <input type="text" id="watchFolders" value="${watchFolders}" placeholder="e.g., src, test, lib" />
    </div>

	<button id="applyBtn">Apply Configuration</button>
	<button id="fullRefreshBtn" style="margin-top: 10px; background-color: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground);">Full Refresh (Re-index Workspace)</button>

	<script>
		const vscode = acquireVsCodeApi();

		// Handle UI toggling
		const modeSelect = document.getElementById('connectionMode');
		const embeddedConfig = document.getElementById('embeddedOptions');
		const remoteConfig = document.getElementById('remoteOptions');

		modeSelect.addEventListener('change', (e) => {
			if (e.target.value === 'embedded') {
				embeddedConfig.classList.remove('hidden');
				remoteConfig.classList.add('hidden');
			} else {
				embeddedConfig.classList.add('hidden');
				remoteConfig.classList.remove('hidden');
			}
		});

		// Handle Apply
		document.getElementById('applyBtn').addEventListener('click', () => {
			const data = {
				connectionMode: modeSelect.value,
				host: document.getElementById('host').value,
				port: document.getElementById('port').value,
				password: document.getElementById('password').value,
				graphName: document.getElementById('graphName').value,
				dataPath: document.getElementById('dataPath').value,
				watchFolders: document.getElementById('watchFolders').value
			};
			
			// Show temporary syncing state
			document.getElementById('status-indicator').style.backgroundColor = 'gray';
			document.getElementById('status-text').innerText = 'Syncing...';

			vscode.postMessage({
				command: 'saveConfig',
				data: data
			});
		});


		document.getElementById('fullRefreshBtn').addEventListener('click', () => {
			vscode.postMessage({
				command: 'fullRefresh'
			});
		});

		// Handle incoming messages
		window.addEventListener('message', event => {
			const message = event.data;
			if (message.command === 'updateStatus') {
				document.getElementById('status-indicator').style.backgroundColor = message.color;
				document.getElementById('status-text').innerText = message.status;
			}
		});
	</script>
</body>
</html>`;
	}
}
