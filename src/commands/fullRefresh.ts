import * as vscode from 'vscode';
import type { Reconciler } from '../services/sync/Reconciler';
import type { CpgPipeline } from '../graph/cpg/CpgPipeline';
import type { IGraphStore } from '../types/storage';

export async function executeFullRefresh(
	reconciler: Reconciler,
	cpgPipeline: CpgPipeline,
	store: IGraphStore
): Promise<void> {
	await vscode.window.withProgress({
		location: vscode.ProgressLocation.Notification,
		title: 'Re-indexing workspace...',
		cancellable: false
	}, async (progress) => {
		progress.report({ message: 'Clearing graph...' });
		await store.clearGraph();

		progress.report({ message: 'Rebuilding workspace structure...' });
		await reconciler.ensureWorkspaceRoot();

		progress.report({ message: 'Re-indexing all files...' });
		const config = vscode.workspace.getConfiguration('falkordb');
		const watchFoldersStr = config.get<string>('watchFolders', 'src');
		const watchFolders = watchFoldersStr.split(',').map((f: string) => f.trim()).filter((f: string) => f.length > 0);
		const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';

		await cpgPipeline.reindexAllFiles(workspaceRoot, watchFolders);

		progress.report({ message: 'Refreshing view...' });
		await reconciler.loadGraphFromDatabase();
	});
}
