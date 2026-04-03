import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import type { IGraphStore } from '../../types/storage';
import type { IGraphViewProvider } from '../../types/visualization';
import type { IReconciler } from '../../types/sync';
import { detectLanguage, generateId } from '../../graph/nodes/nodeFactory';

/**
 * Orchestrates synchronization between the FalkorDB graph and the workspace file system.
 *
 * Implements the Stale-While-Revalidate pattern:
 * 1. Fast Load   – serves cached graph immediately on startup.
 * 2. Reconcile   – background sweep for orphans, missing files, stale metadata.
 * 3. Periodic    – 1-minute heartbeat that triggers reconciliation if >5 min stale.
 */
export class Reconciler implements IReconciler {
	private isReconciling = false;
	private lastReconciliation = 0;
	private reconciliationTimer?: NodeJS.Timeout;
	private workspaceRoot: string;

	constructor(
		private readonly store: IGraphStore,
		private readonly graphView: IGraphViewProvider
	) {
		this.workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';
	}

	/**
	 * Ensures the workspace-root DIRECTORY node exists and that watch-folder nodes
	 * are connected to it.
	 */
	public async ensureWorkspaceRoot(): Promise<void> {
		await this.store.connect();

		const result = await this.store.query(
			`MATCH (n) WHERE n.id = 'workspace-root' RETURN n LIMIT 1`
		);

		if (result.data && result.data.length > 0) {
			return;
		}

		const workspaceName = path.basename(this.workspaceRoot);
		await this.store.createNode({
			id: 'workspace-root',
			label: 'DIRECTORY',
			name: workspaceName,
			path: this.workspaceRoot,
			relativePath: '',
			createdAt: Date.now(),
			modifiedAt: Date.now()
		});

		const config = vscode.workspace.getConfiguration('falkordb');
		const watchFoldersStr = config.get<string>('watchFolders', 'src');
		const watchFolders = watchFoldersStr.split(',').map(f => f.trim()).filter(f => f.length > 0);

		for (const folder of watchFolders) {
			const watchFolderId = folder.replace(/\\/g, '/');

			const folderResult = await this.store.query(
				`MATCH (n) WHERE n.id = $id RETURN n LIMIT 1`,
				{ id: watchFolderId }
			);

			if (folderResult.data && folderResult.data.length > 0) {
				await this.store.createEdge({
					source: 'workspace-root',
					target: watchFolderId,
					type: 'CONTAINS'
				});
			}
		}
	}

	/**
	 * One-time migration to remove legacy nodes (Metadata, DemoNode, etc.)
	 * left over from earlier extension versions.
	 */
	public async cleanupLegacyNodes(): Promise<void> {
		await this.store.connect();

		const metadataResult = await this.store.query(`MATCH (n:Metadata) RETURN count(n) as count`);
		const metadataCount = metadataResult.data?.[0]?.count || 0;
		if (metadataCount > 0) {
			await this.store.query(`MATCH (n:Metadata) DETACH DELETE n`);
			console.log(`Removed ${metadataCount} Metadata nodes`);
		}

		const demoResult = await this.store.query(`MATCH (n:DemoNode) RETURN count(n) as count`);
		const demoCount = demoResult.data?.[0]?.count || 0;
		if (demoCount > 0) {
			await this.store.query(`MATCH (n:DemoNode) DETACH DELETE n`);
			console.log(`Removed ${demoCount} DemoNode nodes`);
		}

		const otherResult = await this.store.query(
			`MATCH (n) WHERE NOT (n:FILE OR n:DIRECTORY) RETURN count(n) as count`
		);
		const otherCount = otherResult.data?.[0]?.count || 0;
		if (otherCount > 0) {
			await this.store.query(`MATCH (n) WHERE NOT (n:FILE OR n:DIRECTORY) DETACH DELETE n`);
			console.log(`Removed ${otherCount} other legacy nodes`);
		}
	}

	/**
	 * Phase 1: Fast Load – show stale cached data immediately.
	 */
	public async loadGraphFromDatabase(): Promise<void> {
		try {
			await this.store.connect();
			const { nodes, edges } = await this.store.getAllNodesAndEdges();
			await this.graphView.refresh();
			console.log(`Loaded ${nodes.length} nodes, ${edges.length} edges from database.`);
		} catch (error: any) {
			console.error('Failed to load graph from database:', error);
			vscode.window.showWarningMessage('Could not load code graph. Will rebuild.');
		}
	}

	/**
	 * Phase 2: Background Reconciliation – compare DB against disk and fix discrepancies.
	 */
	public async reconcileInBackground(): Promise<void> {
		if (this.isReconciling) {
			console.log('Reconciliation already in progress, skipping');
			return;
		}

		this.isReconciling = true;

		await vscode.window.withProgress({
			location: vscode.ProgressLocation.Notification,
			title: 'Validating code graph...',
			cancellable: false
		}, async (progress) => {
			try {
				await this.smartReconciliation(progress);

				await this.graphView.refresh();

			} catch (error: any) {
				console.error('Reconciliation failed:', error);
				vscode.window.showErrorMessage(`Failed to validate code graph: ${error.message}`);
			} finally {
				this.isReconciling = false;
			}
		});
	}

	/**
	 * Phase 3: Continuous Sync – periodic heartbeat to catch any missed events.
	 */
	public startPeriodicReconciliation(): void {
		this.reconciliationTimer = setInterval(() => {
			const timeSinceLastRecon = Date.now() - this.lastReconciliation;
			const FIVE_MINUTES = 5 * 60 * 1000;

			if (timeSinceLastRecon > FIVE_MINUTES) {
				console.log('Triggering periodic reconciliation');
				this.reconcileInBackground();
			}
		}, 60 * 1000);
	}

	private async smartReconciliation(progress: vscode.Progress<{ message?: string }>): Promise<void> {
		progress.report({ message: 'Checking for deleted files...' });
		const orphans = await this.findOrphanNodes();
		if (orphans.length > 0) {
			progress.report({ message: `Cleaning up ${orphans.length} deleted files...` });
			await this.cleanupOrphans(orphans);
		}

		progress.report({ message: 'Checking for new files...' });
		const missingFiles = await this.findMissingFiles();
		if (missingFiles.length > 0) {
			progress.report({ message: `Indexing ${missingFiles.length} new files...` });
			await this.indexMissingFiles(missingFiles);
		}

		progress.report({ message: 'Verifying file metadata...' });
		await this.verifyFileMetadata();

		this.lastReconciliation = Date.now();

		if (orphans.length > 0 || missingFiles.length > 0) {
			vscode.window.showInformationMessage(
				`Code graph updated: ${orphans.length} deleted, ${missingFiles.length} added`
			);
		}
	}

	private async findOrphanNodes(): Promise<string[]> {
		const orphans: string[] = [];

		const result = await this.store.query('MATCH (n) WHERE n:FILE OR n:DIRECTORY RETURN n.id as id, n.path as path');
		for (const row of result.data || []) {
			if (!fs.existsSync(row.path)) {
				orphans.push(row.id);
			}
		}

		const isolatedResult = await this.store.query(
			`MATCH (n)
			 WHERE (n:FILE OR n:DIRECTORY) AND NOT (n)--()
			 RETURN n.id as id`
		);
		for (const row of isolatedResult.data || []) {
			if (!orphans.includes(row.id)) {
				orphans.push(row.id);
			}
		}

		const legacyResult = await this.store.query(
			`MATCH (n)
			 WHERE NOT (n:FILE OR n:DIRECTORY)
			 RETURN n.id as id`
		);
		for (const row of legacyResult.data || []) {
			if (!orphans.includes(row.id)) {
				orphans.push(row.id);
			}
		}

		return orphans;
	}

	private async findMissingFiles(): Promise<string[]> {
		const missingFiles: string[] = [];
		const dbResult = await this.store.query('MATCH (n) WHERE n:FILE OR n:DIRECTORY RETURN n.path as path');
		const dbPaths = new Set(dbResult.data?.map((row: any) => row.path) || []);

		const config = vscode.workspace.getConfiguration('falkordb');
		const watchFoldersStr = config.get<string>('watchFolders', 'src');
		const watchFolders = watchFoldersStr.split(',').map(f => f.trim());

		for (const folder of watchFolders) {
			const folderPath = path.join(this.workspaceRoot, folder);
			if (!fs.existsSync(folderPath)) { continue; }

			const filesOnDisk = this.scanDirectory(folderPath);
			for (const filePath of filesOnDisk) {
				if (!dbPaths.has(filePath)) {
					missingFiles.push(filePath);
				}
			}
		}
		return missingFiles;
	}

	private async cleanupOrphans(nodeIds: string[]): Promise<void> {
		for (const nodeId of nodeIds) {
			await this.store.deleteNode(nodeId);
		}
	}

	private async indexMissingFiles(filePaths: string[]): Promise<void> {
		for (const fullPath of filePaths) {
			const relativePath = path.relative(this.workspaceRoot, fullPath);
			const stats = fs.statSync(fullPath);
			const nodeId = generateId(relativePath);

			if (stats.isDirectory()) {
				await this.store.createNode({
					id: nodeId, label: 'DIRECTORY', name: path.basename(fullPath),
					path: fullPath, relativePath, createdAt: stats.birthtimeMs, modifiedAt: stats.mtimeMs
				});
				await this.createParentEdge(relativePath, nodeId);
			} else if (stats.isFile()) {
				await this.store.createNode({
					id: nodeId, label: 'FILE', name: path.basename(fullPath),
					path: fullPath, relativePath, extension: path.extname(fullPath),
					language: detectLanguage(path.extname(fullPath)), size: stats.size,
					createdAt: stats.birthtimeMs, modifiedAt: stats.mtimeMs, isParsed: false
				});
				await this.createParentEdge(relativePath, nodeId);
			}
		}
	}

	private async createParentEdge(childRelativePath: string, childId: string): Promise<void> {
		const parentRelPath = path.dirname(childRelativePath);

		if (parentRelPath === '.' || parentRelPath === '') {
			await this.store.createEdge({
				source: 'workspace-root',
				target: childId,
				type: 'CONTAINS'
			});
			return;
		}

		const parentId = parentRelPath.replace(/\\/g, '/');

		const parentExists = await this.store.query(
			`MATCH (n) WHERE n.id = $id RETURN n LIMIT 1`,
			{ id: parentId }
		);

		if (!parentExists.data || parentExists.data.length === 0) {
			const parentAbsPath = path.join(this.workspaceRoot, parentRelPath);

			if (fs.existsSync(parentAbsPath)) {
				const stats = fs.statSync(parentAbsPath);
				await this.store.createNode({
					id: parentId,
					label: 'DIRECTORY',
					name: path.basename(parentAbsPath),
					path: parentAbsPath,
					relativePath: parentRelPath,
					createdAt: stats.birthtimeMs,
					modifiedAt: stats.mtimeMs
				});
				await this.createParentEdge(parentRelPath, parentId);
			} else {
				return;
			}
		}

		await this.store.createEdge({
			source: parentId,
			target: childId,
			type: 'CONTAINS'
		});
	}

	private async verifyFileMetadata(): Promise<void> {
		const result = await this.store.query(
			'MATCH (f:FILE) RETURN f.id as id, f.path as path, f.size as size, f.modifiedAt as modifiedAt'
		);
		for (const row of result.data || []) {
			if (!fs.existsSync(row.path)) { continue; }
			const stats = fs.statSync(row.path);
			if (stats.size !== row.size || stats.mtimeMs !== row.modifiedAt) {
				await this.store.updateNode(row.id, {
					size: stats.size,
					modifiedAt: stats.mtimeMs
				});
			}
		}
	}

	private scanDirectory(dirPath: string): string[] {
		const files: string[] = [];
		try {
			const entries = fs.readdirSync(dirPath, { withFileTypes: true });
			for (const entry of entries) {
				if (entry.name.startsWith('.') || entry.name === 'node_modules') { continue; }
				const fullPath = path.join(dirPath, entry.name);
				if (entry.isDirectory()) {
					files.push(fullPath);
					files.push(...this.scanDirectory(fullPath));
				} else if (entry.isFile()) {
					files.push(fullPath);
				}
			}
		} catch (error) {
			console.error(`Error scanning directory ${dirPath}:`, error);
		}
		return files;
	}

	public dispose(): void {
		if (this.reconciliationTimer) {
			clearInterval(this.reconciliationTimer);
		}
	}
}
