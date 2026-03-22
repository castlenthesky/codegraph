import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { FalkorDBService } from './FalkorDBService';
import type { DirectoryNode, FileNode, GraphEdge } from '../models/GraphNodes';

/**
 * Service responsible for scanning the physical disk and transforming directory
 * layouts into foundational Universal Abstract Syntax Tree (UAST) nodes.
 * 
 * Interactions:
 * - `FalkorDBService`: Persists parsed directories and files.
 * - `GraphSynchronizer`: Utilizes this service to ingest or refresh newly discovered
 *   files identified during the "Stale-While-Revalidate" background sweep.
 */
export class FileSystemIndexer {
	private dbService: FalkorDBService;
	private workspaceRoot: string;

	constructor() {
		this.dbService = FalkorDBService.getInstance();
		this.workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';
	}

	/**
	 * Index the workspace based on configured watch folders
	 */
	public async indexWorkspace(): Promise<void> {
		if (!this.workspaceRoot) {
			vscode.window.showWarningMessage('No workspace folder found. Please open a folder to index.');
			return;
		}

		const config = vscode.workspace.getConfiguration('falkordb');
		const watchFoldersStr = config.get<string>('watchFolders', 'src');
		const watchFolders = watchFoldersStr.split(',').map(f => f.trim()).filter(f => f.length > 0);

		vscode.window.withProgress({
			location: vscode.ProgressLocation.Notification,
			title: 'Indexing workspace files...',
			cancellable: false
		}, async (progress) => {
			try {
				// Connect to database
				await this.dbService.connect();

				// Clear existing graph (for fresh indexing)
				await this.dbService.clearGraph();

				// Create workspace root node
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
			await this.dbService.createNode(workspaceRootNode);

			let totalFiles = 0;

				// Index each watched folder
				for (const folder of watchFolders) {
					const folderPath = path.join(this.workspaceRoot, folder);

					if (!fs.existsSync(folderPath)) {
						vscode.window.showWarningMessage(`Watch folder not found: ${folder}`);
						continue;
					}

					progress.report({ message: `Indexing ${folder}...` });
					const count = await this.indexDirectory(folderPath, folder);
					totalFiles += count;
				// Connect watch folder to workspace root
				const watchFolderId = this.generateId(folder);
				const edge: GraphEdge = {
					source: 'workspace-root',
					target: watchFolderId,
					type: 'CONTAINS'
				};
				await this.dbService.createEdge(edge);
				}

				vscode.window.showInformationMessage(`Successfully indexed ${totalFiles} files!`);
			} catch (error: any) {
				vscode.window.showErrorMessage(`Failed to index workspace: ${error.message}`);
			}
		});
	}

	/**
	 * Recursively index a directory
	 */
	private async indexDirectory(absolutePath: string, relativePath: string): Promise<number> {
		let fileCount = 0;

		// Create directory node
		const dirNode = this.createDirectoryNode(absolutePath, relativePath);
		await this.dbService.createNode(dirNode);

		// Read directory contents
		const entries = fs.readdirSync(absolutePath, { withFileTypes: true });

		for (const entry of entries) {
			// Skip hidden files and node_modules
			if (entry.name.startsWith('.') || entry.name === 'node_modules') {
				continue;
			}

			const entryAbsPath = path.join(absolutePath, entry.name);
			const entryRelPath = path.join(relativePath, entry.name);

			if (entry.isDirectory()) {
				// Recursively index subdirectory
				fileCount += await this.indexDirectory(entryAbsPath, entryRelPath);

				// Create CONTAINS edge from parent to child directory
				const childDirId = this.generateId(entryRelPath);
				const edge: GraphEdge = {
					source: dirNode.id,
					target: childDirId,
					type: 'CONTAINS'
				};
				await this.dbService.createEdge(edge);
			} else if (entry.isFile()) {
				// Create file node
				const fileNode = this.createFileNode(entryAbsPath, entryRelPath);
				await this.dbService.createNode(fileNode);
				fileCount++;

				// Create CONTAINS edge from directory to file
				const edge: GraphEdge = {
					source: dirNode.id,
					target: fileNode.id,
					type: 'CONTAINS'
				};
				await this.dbService.createEdge(edge);
			}
		}

		return fileCount;
	}

	/**
	 * Create a DirectoryNode from path
	 */
	private createDirectoryNode(absolutePath: string, relativePath: string): DirectoryNode {
		const stats = fs.statSync(absolutePath);

		return {
			id: this.generateId(relativePath),
			label: 'DIRECTORY',
			name: path.basename(absolutePath),
			path: absolutePath,
			relativePath: relativePath,
			createdAt: stats.birthtimeMs,
			modifiedAt: stats.mtimeMs
		};
	}

	/**
	 * Create a FileNode from path
	 */
	private createFileNode(absolutePath: string, relativePath: string): FileNode {
		const stats = fs.statSync(absolutePath);
		const ext = path.extname(absolutePath);

		return {
			id: this.generateId(relativePath),
			label: 'FILE',
			name: path.basename(absolutePath),
			path: absolutePath,
			relativePath: relativePath,
			extension: ext,
			language: this.detectLanguage(ext),
			size: stats.size,
			createdAt: stats.birthtimeMs,
			modifiedAt: stats.mtimeMs,
			isParsed: false
		};
	}

	/**
	 * Detect language from file extension
	 */
	private detectLanguage(extension: string): string {
		const langMap: Record<string, string> = {
			'.ts': 'typescript',
			'.tsx': 'typescript',
			'.js': 'javascript',
			'.jsx': 'javascript',
			'.py': 'python',
			'.go': 'go',
			'.rs': 'rust',
			'.java': 'java',
			'.c': 'c',
			'.cpp': 'cpp',
			'.h': 'c',
			'.hpp': 'cpp',
			'.cs': 'csharp',
			'.rb': 'ruby',
			'.php': 'php',
			'.swift': 'swift',
			'.kt': 'kotlin',
			'.scala': 'scala'
		};

		return langMap[extension.toLowerCase()] || 'unknown';
	}

	/**
	 * Generate a unique ID from relative path
	 */
	private generateId(relativePath: string): string {
		// Normalize path separators and use as ID
		return relativePath.replace(/\\/g, '/');
	}
}
