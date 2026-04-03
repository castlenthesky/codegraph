import * as vscode from 'vscode';
import { FalkorDBStore } from './services/storage/FalkorDBStore';
import { DiffEngine } from './services/sync/DiffEngine';
import { Reconciler } from './services/sync/Reconciler';
import { FileWatcher } from './services/filesystem/FileWatcher';
import { GraphViewProvider } from './providers/GraphViewProvider';
import { ConfigViewProvider } from './providers/ConfigViewProvider';
import { DetailsViewProvider } from './providers/DetailsViewProvider';
import { registerAllCommands } from './commands';

export interface ServiceContainer {
	store: FalkorDBStore;
	reconciler: Reconciler;
	fileWatcher: FileWatcher;
}

/**
 * Composition root for the codegraph extension.
 *
 * Creates all services with constructor injection, registers webview providers
 * and commands on the VS Code extension context, and runs the Stale-While-Revalidate
 * startup sequence.
 */
export function bootstrap(context: vscode.ExtensionContext): ServiceContainer {
	// Storage
	const store = new FalkorDBStore();
	const diffEngine = new DiffEngine();

	// Providers
	const graphProvider = new GraphViewProvider(store, diffEngine);
	const configProvider = new ConfigViewProvider();
	const detailsProvider = new DetailsViewProvider();

	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider('falkordb.graph', graphProvider),
		vscode.window.registerWebviewViewProvider('falkordb.config', configProvider),
		vscode.window.registerWebviewViewProvider('falkordb.details', detailsProvider)
	);

	// File system watcher
	const fileWatcher = new FileWatcher(store, graphProvider);
	fileWatcher.startWatching().forEach(d => context.subscriptions.push(d));
	context.subscriptions.push({ dispose: () => fileWatcher.dispose() });

	// Reconciler (Stale-While-Revalidate)
	const reconciler = new Reconciler(store, graphProvider);

	// Phase 1: Fast Load — show stale cached data immediately
	reconciler.loadGraphFromDatabase();

	// Phase 2: Ensure workspace root exists, clean legacy nodes, then reconcile
	setTimeout(async () => {
		await reconciler.ensureWorkspaceRoot();
		await reconciler.cleanupLegacyNodes();
		await reconciler.reconcileInBackground();
	}, 2000);

	// Phase 3: Continuous Keep-Alive Validation
	reconciler.startPeriodicReconciliation();
	context.subscriptions.push({ dispose: () => reconciler.dispose() });

	// Commands
	registerAllCommands(context, { reconciler });

	return { store, reconciler, fileWatcher };
}
