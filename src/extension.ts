/**
 * The codegraph VS Code Extension entry point.
 * 
 * Responsibilities:
 * - Bootstraps all Graph Providers and core Graph Services (`GraphSynchronizer`, `FalkorDBService`, `FileSystemIndexer`).
 * - Orchestrates the Stale-While-Revalidate integration pattern allowing the UI to present the database 
 *   views immediately while catching missing or orphaned external file deletions in the background.
 */
// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import { ConfigViewProvider } from './providers/ConfigViewProvider';
import { GraphViewProvider } from './providers/GraphViewProvider';
import { DetailsViewProvider } from './providers/DetailsViewProvider';
import { FileSystemWatcher } from './services/FileSystemWatcher';
import { GraphSynchronizer } from './services/GraphSynchronizer';
import { FileSystemIndexer } from './services/FileSystemIndexer';

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {

	// Use the console to output diagnostic information (console.log) and errors (console.error)
	// This line of code will only be executed once when your extension is activated
	console.log('Congratulations, your extension "codegraph" is now active!');

	// FalkorDB persistence ensures that manual index clearing is no longer triggered on startup.

	const configProvider = new ConfigViewProvider();
	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider('falkordb.config', configProvider)
	);

	const graphProvider = new GraphViewProvider();
	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider('falkordb.graph', graphProvider)
	);

	// Initialize file system watcher and connect to graph provider
	const fileWatcher = new FileSystemWatcher();
	fileWatcher.setGraphViewProvider(graphProvider);
	const watcherDisposables = fileWatcher.startWatching();
	watcherDisposables.forEach(d => context.subscriptions.push(d));

	const detailsProvider = new DetailsViewProvider();
	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider('falkordb.details', detailsProvider)
	);

	// Synchronize Graph Database and Visualizer (Stale-While-Revalidate)
	const synchronizer = new GraphSynchronizer();
	synchronizer.setGraphView(graphProvider);

	// Phase 1: Fast Load (show stale data immediately)
	synchronizer.loadGraphFromDatabase();

	// Phase 2: Ensure workspace root exists, clean legacy nodes, then reconcile in background
	setTimeout(async () => {
		await synchronizer.ensureWorkspaceRoot();
		await synchronizer.cleanupLegacyNodes();
		await synchronizer.reconcileInBackground();
	}, 2000);

	// Phase 3: Continuous Keep-Alive Validation
	synchronizer.startPeriodicReconciliation();

	context.subscriptions.push({
		dispose: () => synchronizer.dispose()
	});

	// The command has been defined in the package.json file
	// Now provide the implementation of the command with registerCommand
	// The commandId parameter must match the command field in package.json
	const disposable = vscode.commands.registerCommand('falkordb.helloWorld', () => {
		// The code you place here will be executed every time your command is executed
		// Display a message box to the user
		vscode.window.showInformationMessage('Hello World from codegraph!');
	});

	// Register the Full Refresh command
	const fullRefreshCommand = vscode.commands.registerCommand('codegraph.fullRefresh', async () => {
		// Use incremental differential approach instead of clearing entire graph
		// First ensure workspace root exists, then reconcile
		await synchronizer.ensureWorkspaceRoot();

		// Reconciliation will add missing files and remove orphaned nodes
		await synchronizer.reconcileInBackground();

		// Refresh the graph view after reconciliation
		await synchronizer.loadGraphFromDatabase();
	});

	context.subscriptions.push(disposable);
	context.subscriptions.push(fullRefreshCommand);
}

// This method is called when your extension is deactivated
export function deactivate() {}
