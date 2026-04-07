import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import type { IGraphStore } from '../../types/storage';
import type { IFileScanner } from '../../types/filesystem';
import type { DirectoryNode, GraphEdge } from '../../types/nodes';
import { createDirectoryNode, createFileNode, generateId, shouldIgnorePath } from '../../graph/nodes/nodeFactory';

/**
 * Scans the physical workspace disk and ingests directory/file nodes into the graph store.
 *
 * Used for initial full workspace indexing. For live change tracking, see FileWatcher.
 */
export class FileScanner implements IFileScanner {
	private workspaceRoot: string;

	constructor(private readonly store: IGraphStore) {
		this.workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';
	}

	public async indexWorkspace(): Promise<void> {
		if (!this.workspaceRoot) {
			vscode.window.showWarningMessage('No workspace folder found. Please open a folder to index.');
			return;
		}

		const config = vscode.workspace.getConfiguration('falkordb');
		const watchFoldersStr = config.get<string>('watchFolders', 'src');
		const watchFolders = watchFoldersStr.split(',').map(f => f.trim()).filter(f => f.length > 0);

		return vscode.window.withProgress({
			location: vscode.ProgressLocation.Notification,
			title: 'Indexing workspace files...',
			cancellable: false
		}, async (progress) => {
			try {
				await this.store.connect();
				await this.store.clearGraph();

				const workspaceName = path.basename(this.workspaceRoot);
				const workspaceRootNode: DirectoryNode = {
					id: 'workspace-root',
					label: 'DIRECTORY',
					name: workspaceName,
					path: this.workspaceRoot,
					relativePath: '',
					createdAt: Date.now(),
					modifiedAt: Date.now()
				};
				await this.store.createNode(workspaceRootNode);

				let totalFiles = 0;

				for (const folder of watchFolders) {
					const folderPath = path.join(this.workspaceRoot, folder);

					try {
						await fs.promises.access(folderPath);
					} catch {
						vscode.window.showWarningMessage(`Watch folder not found: ${folder}`);
						continue;
					}

					progress.report({ message: `Indexing ${folder}...` });
					const count = await this.indexDirectory(folderPath, folder);
					totalFiles += count;

					const watchFolderId = generateId(folder);
					const edge: GraphEdge = {
						source: 'workspace-root',
						target: watchFolderId,
						type: 'CONTAINS'
					};
					await this.store.createEdge(edge);
				}

				vscode.window.showInformationMessage(`Successfully indexed ${totalFiles} files!`);
			} catch (error: any) {
				vscode.window.showErrorMessage(`Failed to index workspace: ${error.message}`);
			}
		});
	}

	private async indexDirectory(absolutePath: string, relativePath: string): Promise<number> {
		let fileCount = 0;

		const dirNode = await createDirectoryNode(absolutePath, relativePath);
		await this.store.createNode(dirNode);

		const entries = await fs.promises.readdir(absolutePath, { withFileTypes: true });

		for (const entry of entries) {
			if (shouldIgnorePath(path.join(absolutePath, entry.name))) {
				continue;
			}

			const entryAbsPath = path.join(absolutePath, entry.name);
			const entryRelPath = path.join(relativePath, entry.name);

			if (entry.isDirectory()) {
				fileCount += await this.indexDirectory(entryAbsPath, entryRelPath);

				const childDirId = generateId(entryRelPath);
				const edge: GraphEdge = {
					source: dirNode.id,
					target: childDirId,
					type: 'CONTAINS'
				};
				await this.store.createEdge(edge);
			} else if (entry.isFile()) {
				const fileNode = await createFileNode(entryAbsPath, entryRelPath);
				await this.store.createNode(fileNode);
				fileCount++;

				const edge: GraphEdge = {
					source: dirNode.id,
					target: fileNode.id,
					type: 'CONTAINS'
				};
				await this.store.createEdge(edge);
			}
		}

		return fileCount;
	}
}
