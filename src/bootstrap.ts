import * as vscode from 'vscode';
import { FalkorDBStore } from './services/storage/FalkorDBStore';
import { DiffEngine } from './services/sync/DiffEngine';
import { Reconciler } from './services/sync/Reconciler';
import { FileWatcher } from './services/filesystem/FileWatcher';
import { GraphViewProvider } from './providers/GraphViewProvider';
import { ConfigViewProvider } from './providers/ConfigViewProvider';
import { DetailsViewProvider } from './providers/DetailsViewProvider';
import { registerAllCommands } from './commands';
import { ParserService } from './graph/cpg/uast/ParserService';
import { UastBuilder } from './graph/cpg/uast/UastBuilder';
import { CpgPipeline } from './graph/cpg/CpgPipeline';
import { ImportResolver } from './graph/cpg/ImportResolver';
import { CallResolver } from './graph/cpg/CallResolver';
import { QueryService } from './graph/cpg/uast/QueryService';

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
	const detailsProvider = new DetailsViewProvider();
	const graphProvider = new GraphViewProvider(store, diffEngine, context.extensionUri, detailsProvider);
	const configProvider = new ConfigViewProvider();

	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider('falkordb.graph', graphProvider),
		vscode.window.registerWebviewViewProvider('falkordb.config', configProvider),
		vscode.window.registerWebviewViewProvider('falkordb.details', detailsProvider)
	);

	// CPG pipeline
	const parserService = new ParserService();
	const uastBuilder = new UastBuilder();
	const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';
	const queryService = new QueryService(parserService, context.extensionPath);
	const importResolver = new ImportResolver(store, workspaceRoot, queryService, parserService);
	const callResolver = new CallResolver(store, workspaceRoot);
	const cpgPipeline = new CpgPipeline(parserService, uastBuilder, store, graphProvider, undefined, undefined, importResolver, workspaceRoot, callResolver, queryService);

	// File system watcher
	const fileWatcher = new FileWatcher(store, graphProvider, cpgPipeline);
	fileWatcher.startWatching().forEach(d => context.subscriptions.push(d));
	context.subscriptions.push({ dispose: () => fileWatcher.dispose() });

	// Reconciler (Stale-While-Revalidate)
	const reconciler = new Reconciler(store, graphProvider);

	// Phase 1: Fast Load — show stale cached data immediately (intentionally async)
	reconciler.loadGraphFromDatabase().catch((err: Error) =>
		console.error('[bootstrap] Phase 1 load failed:', err.message)
	);

	// Phase 2: Ensure workspace root exists, clean legacy nodes, then reconcile.
	// 5 000ms gives Phase 1 time to finish painting and the force simulation time
	// to settle before any reconciliation refresh can reheat it.
	setTimeout(async () => {
		await reconciler.ensureWorkspaceRoot();
		await reconciler.cleanupOrphanCpgFileNodes();
		await reconciler.cleanupLegacyNodes();
		await reconciler.reconcileInBackground();
	}, 5000);

	// Phase 3: Continuous Keep-Alive Validation
	reconciler.startPeriodicReconciliation();
	context.subscriptions.push({ dispose: () => reconciler.dispose() });

	// Commands
	registerAllCommands(context, { reconciler, cpgPipeline, store });

	return { store, reconciler, fileWatcher };
}
