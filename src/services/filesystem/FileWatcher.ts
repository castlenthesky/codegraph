import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import type { IGraphStore } from '../../types/storage';
import type { IGraphViewProvider } from '../../types/visualization';
import type { IFileWatcher } from '../../types/filesystem';
import type { FileNode, GraphEdge } from '../../types/nodes';
import type { CpgPipeline } from '../../graph/cpg/CpgPipeline';
import {
	createDirectoryNode,
	createFileNode,
	generateId,
	shouldIgnorePath
} from '../../graph/nodes/nodeFactory';

interface PendingChange {
	type: 'create' | 'delete' | 'change' | 'rename';
	uri: vscode.Uri;
	newUri?: vscode.Uri;
	timestamp: number;
}

interface DeletedDirectoryInfo {
	id: string;
	path: string;
	descendants: Array<{ id: string; relativePath: string; isDirectory: boolean }>;
	timestamp: number;
}

/**
 * Watches configured workspace folders for file system changes and keeps
 * the graph store in sync. Handles debouncing, soft-delete, directory move
 * detection, and lazy parent directory chain creation.
 */
export class FileWatcher implements IFileWatcher {
	private workspaceRoot: string;
	private watchers: vscode.Disposable[] = [];

	// Debouncing support for batched updates
	private pendingChanges: Map<string, PendingChange> = new Map();
	private debounceTimer: NodeJS.Timeout | null = null;
	private readonly DEBOUNCE_DELAY_MS = 500;

	// Directory move tracking (to handle reconnection of orphaned children)
	private recentlyDeletedDirs: Map<string, DeletedDirectoryInfo> = new Map();
	private readonly DIR_CACHE_TTL_MS = 5000;

	// [HI-003] Allowlist for labels used in Cypher queries (FalkorDB doesn't support parameterized labels)
	private static readonly VALID_LABELS = new Set(['DIRECTORY', 'FILE']);

	constructor(
		private readonly store: IGraphStore,
		private readonly graphView: IGraphViewProvider,
		private readonly cpgPipeline?: CpgPipeline
	) {
		const folders = vscode.workspace.workspaceFolders;
		// [MD-005] Warn on multi-root workspaces — only the first folder is watched
		if (folders && folders.length > 1) {
			vscode.window.showWarningMessage(
				'CodeGraph: Multi-root workspaces are not fully supported. Only the first workspace folder will be watched.'
			);
		}
		this.workspaceRoot = folders?.[0]?.uri.fsPath || '';
	}

	public startWatching(): vscode.Disposable[] {
		const config = vscode.workspace.getConfiguration('falkordb');
		const watchFoldersStr = config.get<string>('watchFolders', 'src');
		const watchFolders = watchFoldersStr.split(',').map(f => f.trim()).filter(f => f.length > 0);

		for (const folder of watchFolders) {
			const pattern = new vscode.RelativePattern(this.workspaceRoot, `${folder}/**/*`);
			const watcher = vscode.workspace.createFileSystemWatcher(pattern);

			watcher.onDidCreate(uri => this.queueChange('create', uri));
			watcher.onDidDelete(uri => this.queueChange('delete', uri));
			watcher.onDidChange(uri => this.queueChange('change', uri));

			this.watchers.push(watcher);
		}

		const renameDisposable = vscode.workspace.onDidRenameFiles(e => {
			for (const file of e.files) {
				this.queueChange('rename', file.oldUri, file.newUri);
			}
		});
		this.watchers.push(renameDisposable);

		return this.watchers;
	}

	private queueChange(type: 'create' | 'delete' | 'change' | 'rename', uri: vscode.Uri, newUri?: vscode.Uri): void {
		// [LO-001] Consistently exclude hidden files and node_modules at the entry point
		if (type !== 'rename' && shouldIgnorePath(uri.fsPath)) {
			return;
		}

		const key = uri.fsPath;

		if (type === 'rename' && newUri) {
			this.pendingChanges.delete(uri.fsPath);
			this.pendingChanges.delete(newUri.fsPath);
			this.pendingChanges.set(`rename:${key}`, { type, uri, newUri, timestamp: Date.now() });
		} else {
			const existing = this.pendingChanges.get(key);
			if (existing && existing.type === 'rename') { return; }

			if (existing) {
				if (type === 'delete') {
					this.pendingChanges.set(key, { type, uri, timestamp: Date.now() });
				} else if (type === 'create' && existing.type === 'change') {
					this.pendingChanges.set(key, { type, uri, timestamp: Date.now() });
				} else if (type === 'change' && existing.type === 'create') {
					// [MD-003] Keep 'create' type but refresh timestamp so metadata is fresh at processing time
					existing.timestamp = Date.now();
				}
			} else {
				this.pendingChanges.set(key, { type, uri, timestamp: Date.now() });
			}
		}

		if (this.debounceTimer) {
			clearTimeout(this.debounceTimer);
		}

		this.debounceTimer = setTimeout(() => {
			this.processBatch();
		}, this.DEBOUNCE_DELAY_MS);
	}

	private async processBatch(): Promise<void> {
		if (this.pendingChanges.size === 0) {
			return;
		}

		// Sort: renames first, then deletes, changes, creates; shorter paths first within type [LO-003]
		const changes = Array.from(this.pendingChanges.values());
		changes.sort((a, b) => {
			const typeRank = { 'rename': 0, 'delete': 1, 'change': 2, 'create': 3 };
			if (typeRank[a.type] !== typeRank[b.type]) {
				return typeRank[a.type] - typeRank[b.type];
			}
			return a.uri.fsPath.length - b.uri.fsPath.length;
		});

		this.pendingChanges.clear();
		this.debounceTimer = null;

		for (const change of changes) {
			try {
				switch (change.type) {
					case 'create':
						await this.handleFileCreated(change.uri);
						break;
					case 'delete':
						await this.handleFileDeleted(change.uri);
						break;
					case 'change':
						await this.handleFileChanged(change.uri);
						break;
					case 'rename':
						if (change.newUri) {
							await this.handleFileRenamed(change.uri, change.newUri);
						}
						break;
				}
			} catch (error: any) {
				console.error(`Error processing ${change.type} for ${change.uri.fsPath}:`, error);
			}
		}

		// [LO-002] Run cache cleanup on every batch, not just on delete events
		this.cleanupDeletedDirsCache();

		// Sweep any expired soft-deleted orphans
		await this.hardDeleteExpiredNodes();

		// Notify graph view once for the entire batch
		this.graphView.refresh();
	}

	private async hardDeleteExpiredNodes(): Promise<void> {
		const threshold = Date.now() - this.DIR_CACHE_TTL_MS;
		try {
			await this.store.query(
				`MATCH (n) WHERE n.isSoftDeleted IS NOT NULL AND n.isSoftDeleted < $threshold DETACH DELETE n`,
				{ threshold }
			);
		} catch (error) {
			console.error('Error sweeping soft-deleted nodes:', error);
		}
	}

	private async handleFileRenamed(oldUri: vscode.Uri, newUri: vscode.Uri): Promise<void> {
		try {
			const oldRelativePath = path.relative(this.workspaceRoot, oldUri.fsPath);
			const newRelativePath = path.relative(this.workspaceRoot, newUri.fsPath);
			const oldId = generateId(oldRelativePath);
			const newId = generateId(newRelativePath);

			const isDirectory = await this.isDirectoryNode(oldId);

			await this.updateNodePath(oldId, newId, newRelativePath, newUri.fsPath);

			await this.store.query(`MATCH ()-[r:CONTAINS]->(n {id: $newId}) DELETE r`, { newId });
			await this.createParentEdge(newRelativePath, newId);

			if (isDirectory) {
				await this.updateDescendantPaths(newId, oldRelativePath, newRelativePath);
			}
		} catch (error: any) {
			console.error(`Error handling file rename from ${oldUri.fsPath} to ${newUri.fsPath}:`, error);
		}
	}

	/**
	 * Handle file/directory creation.
	 * [CR-001] VS Code's createFileSystemWatcher does not fire for directory creation.
	 * We use lazy directory chain creation: when any file event arrives, we walk up
	 * path.dirname() and create any missing directory nodes before processing the file.
	 */
	private async handleFileCreated(uri: vscode.Uri): Promise<void> {
		try {
			const absolutePath = uri.fsPath;
			const relativePath = path.relative(this.workspaceRoot, absolutePath);

			let stats: fs.Stats;
			try {
				stats = await fs.promises.stat(absolutePath);
			} catch {
				return;
			}

			if (stats.isDirectory()) {
				const dirNode = await createDirectoryNode(absolutePath, relativePath);
				await this.store.createNode(dirNode);

				await this.store.query(`MATCH (n {id: $id}) REMOVE n.isSoftDeleted`, { id: dirNode.id });

				await this.createParentEdge(relativePath, dirNode.id);
				await this.reconnectOrphanedChildren(dirNode.id, relativePath, absolutePath);
			} else if (stats.isFile()) {
				// [CR-001] Lazily ensure all ancestor directory nodes exist in the graph
				await this.ensureParentDirectoryChain(relativePath);

				const fileNode = await createFileNode(absolutePath, relativePath);
				await this.store.createNode(fileNode);

				await this.store.query(`MATCH (n {id: $id}) REMOVE n.isSoftDeleted`, { id: fileNode.id });

				await this.createParentEdge(relativePath, fileNode.id);

				// Trigger CPG parse for supported file types
				if (this.cpgPipeline) {
					try {
						const source = await fs.promises.readFile(absolutePath, 'utf8');
						await this.cpgPipeline.processFile(absolutePath, source);
					} catch { /* non-fatal */ }
				}
			}

		} catch (error: any) {
			console.error('Error handling file creation:', error);
			vscode.window.showErrorMessage(`Failed to create node: ${error.message}`);
		}
	}

	/**
	 * [CR-001] Walk up the directory chain and create any missing directory nodes.
	 * This compensates for VS Code's FileSystemWatcher not firing create events for directories.
	 */
	private async ensureParentDirectoryChain(childRelativePath: string): Promise<void> {
		const segments = childRelativePath.split(path.sep);
		const ancestorRelPaths: string[] = [];
		for (let i = 1; i < segments.length; i++) {
			ancestorRelPaths.push(segments.slice(0, i).join(path.sep));
		}

		if (ancestorRelPaths.length === 0) {
			return;
		}

		const ancestorIds = ancestorRelPaths.map(p => generateId(p));
		let existingIds: Set<string>;
		try {
			const result = await this.store.query(
				'MATCH (n) WHERE n.id IN $ids RETURN n.id as id',
				{ ids: ancestorIds }
			);
			existingIds = new Set((result.data || []).map((row: any) => row.id as string));
		} catch {
			existingIds = new Set();
		}

		for (let i = 0; i < ancestorRelPaths.length; i++) {
			const dirRelPath = ancestorRelPaths[i];
			const dirId = ancestorIds[i];
			if (existingIds.has(dirId)) {
				continue;
			}
			const dirAbsPath = path.join(this.workspaceRoot, dirRelPath);
			try {
				const dirNode = await createDirectoryNode(dirAbsPath, dirRelPath);
				await this.store.createNode(dirNode);
				await this.store.query(`MATCH (n {id: $id}) REMOVE n.isSoftDeleted`, { id: dirNode.id });
				await this.createParentEdge(dirRelPath, dirNode.id);
			} catch {
				// Directory may not exist on disk (race); skip
			}
		}
	}

	private async handleFileDeleted(uri: vscode.Uri): Promise<void> {
		try {
			const relativePath = path.relative(this.workspaceRoot, uri.fsPath);
			const nodeId = generateId(relativePath);

			const isDirectory = await this.isDirectoryNode(nodeId);
			if (isDirectory) {
				const descendants = await this.getDescendantNodes(nodeId, relativePath);

				this.recentlyDeletedDirs.set(nodeId, {
					id: nodeId,
					path: uri.fsPath,
					descendants,
					timestamp: Date.now()
				});

				this.cleanupDeletedDirsCache();

				for (const descendant of descendants) {
					console.log(`Soft-deleting descendant: ${descendant.id}`);
					await this.store.query(
						`MATCH (n {id: $id}) SET n.isSoftDeleted = $time`,
						{ id: descendant.id, time: Date.now() }
					);
				}
			}

			await this.store.query(
				`MATCH (n {id: $id}) SET n.isSoftDeleted = $time`,
				{ id: nodeId, time: Date.now() }
			);

			// Invalidate parser cache for deleted file
			if (this.cpgPipeline) {
				this.cpgPipeline.invalidate(uri.fsPath);
			}

		} catch (error: any) {
			console.error('Error handling file deletion:', error);
			vscode.window.showErrorMessage(`Failed to delete node: ${error.message}`);
		}
	}

	/**
	 * Handle file change: update metadata and signal re-parse [HI-004]
	 */
	private async handleFileChanged(uri: vscode.Uri): Promise<void> {
		try {
			const absolutePath = uri.fsPath;
			const relativePath = path.relative(this.workspaceRoot, absolutePath);

			// [CR-002] Use async stat; if file is gone, bail silently
			let stats: fs.Stats;
			try {
				stats = await fs.promises.stat(absolutePath);
			} catch {
				return;
			}

			if (!stats.isFile()) {
				return;
			}

			const nodeId = generateId(relativePath);

			await this.store.updateNode(nodeId, {
				size: stats.size,
				modifiedAt: stats.mtimeMs,
				isParsed: false
			} as Partial<FileNode>);

			// Re-parse CPG for changed file
			if (this.cpgPipeline) {
				try {
					const source = await fs.promises.readFile(absolutePath, 'utf8');
					await this.cpgPipeline.processFile(absolutePath, source);
				} catch { /* non-fatal */ }
			}

		} catch (error: any) {
			console.error('Error handling file change:', error);
		}
	}

	private async createParentEdge(childRelativePath: string, childId: string): Promise<void> {
		const parentRelPath = path.dirname(childRelativePath);

		// If parent is the workspace root (.), skip (no parent node exists)
		// Watch folder roots (e.g., 'src') ARE valid directories and should exist as nodes
		if (parentRelPath === '.' || parentRelPath === '') {
			return;
		}

		const parentId = generateId(parentRelPath);

		const edge: GraphEdge = {
			source: parentId,
			target: childId,
			type: 'CONTAINS'
		};

		await this.store.createEdge(edge);
	}

	private async isDirectoryNode(nodeId: string): Promise<boolean> {
		try {
			const result = await this.store.query(
				'MATCH (n {id: $id}) RETURN n.label as label',
				{ id: nodeId }
			);
			return result.data?.[0]?.label === 'DIRECTORY';
		} catch {
			return false;
		}
	}

	private async getDescendantNodes(dirId: string, dirRelativePath: string): Promise<Array<{ id: string; relativePath: string; isDirectory: boolean }>> {
		try {
			const result = await this.store.query(
				`MATCH (parent {id: $id})-[:CONTAINS*]->(descendant)
				 RETURN descendant.id as id, descendant.relativePath as relativePath, descendant.label as label`,
				{ id: dirId }
			);

			return (result.data || []).map((row: any) => ({
				id: row.id,
				relativePath: row.relativePath,
				isDirectory: row.label === 'DIRECTORY'
			}));
		} catch (error) {
			console.error('Error getting descendant nodes:', error);
			return [];
		}
	}

	private async reconnectOrphanedChildren(newDirId: string, newRelativePath: string, newAbsolutePath: string): Promise<void> {
		try {
			let entries: fs.Dirent[];
			try {
				entries = await fs.promises.readdir(newAbsolutePath, { withFileTypes: true });
			} catch {
				return;
			}

			const relevantEntries = entries.filter(e => !shouldIgnorePath(path.join(newAbsolutePath, e.name)));

			// First, try cache-based reconnection (more accurate than name-only matching)
			for (const [deletedDirId, deletedInfo] of this.recentlyDeletedDirs.entries()) {
				for (const descendant of deletedInfo.descendants) {
					const descendantName = path.basename(descendant.relativePath);
					const matchingEntry = relevantEntries.find(e => e.name === descendantName);
					if (!matchingEntry || matchingEntry.isDirectory() !== descendant.isDirectory) {
						continue;
					}

					const childRelativePath = path.join(newRelativePath, descendantName);
					const childId = generateId(childRelativePath);
					const childAbsPath = path.join(newAbsolutePath, descendantName);

					console.log(`Reconnecting orphaned child: ${descendant.id} -> ${childId}`);

					const updated = await this.updateNodePath(descendant.id, childId, childRelativePath, childAbsPath);
					if (!updated) {
						if (descendant.isDirectory) {
							await this.store.createNode(await createDirectoryNode(childAbsPath, childRelativePath));
						} else {
							await this.store.createNode(await createFileNode(childAbsPath, childRelativePath));
						}
					}

					await this.createParentEdge(childRelativePath, childId);

					if (descendant.isDirectory) {
						if (updated) {
							await this.updateDescendantPaths(childId, descendant.relativePath, childRelativePath);
						} else {
							await this.reconnectOrphanedChildren(childId, childRelativePath, childAbsPath);
						}
					}
				}
				this.recentlyDeletedDirs.delete(deletedDirId);
			}

			// [HI-001] Fallback: batch queries instead of N+1 per entry
			const allChildIds = relevantEntries.map(e => generateId(path.join(newRelativePath, e.name)));

			let existingIds: Set<string>;
			try {
				const existResult = await this.store.query(
					'MATCH (n) WHERE n.id IN $ids RETURN n.id as id',
					{ ids: allChildIds }
				);
				existingIds = new Set((existResult.data || []).map((row: any) => row.id as string));
			} catch {
				existingIds = new Set();
			}

			const missingEntries = relevantEntries.filter(
				e => !existingIds.has(generateId(path.join(newRelativePath, e.name)))
			);

			if (missingEntries.length === 0) {
				return;
			}

			const missingNames = missingEntries.map(e => e.name);
			let orphanRows: Array<{ id: string; name: string; relativePath: string; label: string }> = [];
			try {
				const orphanResult = await this.store.query(
					`MATCH (n)
					 WHERE n.isSoftDeleted IS NOT NULL
					   AND n.name IN $names
					   AND NOT ()-[:CONTAINS]->(n)
					 RETURN n.id as id, n.name as name, n.relativePath as relativePath, n.label as label`,
					{ names: missingNames }
				);
				orphanRows = orphanResult.data || [];
			} catch {
				orphanRows = [];
			}

			const orphanByName = new Map<string, { id: string; name: string; relativePath: string; label: string }>();
			for (const row of orphanRows) {
				if (!orphanByName.has(row.name)) {
					orphanByName.set(row.name, row);
				}
			}

			for (const entry of missingEntries) {
				const childRelativePath = path.join(newRelativePath, entry.name);
				const childId = generateId(childRelativePath);
				const childAbsPath = path.join(newAbsolutePath, entry.name);

				const orphan = orphanByName.get(entry.name);
				const expectedLabel = entry.isDirectory() ? 'DIRECTORY' : 'FILE';

				if (orphan && orphan.label === expectedLabel) {
					console.log(`Reconnecting orphan via name search: ${orphan.id} -> ${childId}`);
					const updated = await this.updateNodePath(orphan.id, childId, childRelativePath, childAbsPath);
					if (!updated) {
						if (entry.isDirectory()) {
							await this.store.createNode(await createDirectoryNode(childAbsPath, childRelativePath));
						} else {
							await this.store.createNode(await createFileNode(childAbsPath, childRelativePath));
						}
					}
					await this.createParentEdge(childRelativePath, childId);
					if (entry.isDirectory()) {
						if (updated) {
							await this.updateDescendantPaths(childId, orphan.relativePath, childRelativePath);
						} else {
							await this.reconnectOrphanedChildren(childId, childRelativePath, childAbsPath);
						}
					}
				} else {
					if (entry.isDirectory()) {
						await this.store.createNode(await createDirectoryNode(childAbsPath, childRelativePath));
						await this.createParentEdge(childRelativePath, childId);
						await this.reconnectOrphanedChildren(childId, childRelativePath, childAbsPath);
					} else if (entry.isFile()) {
						await this.store.createNode(await createFileNode(childAbsPath, childRelativePath));
						await this.createParentEdge(childRelativePath, childId);
					}
				}
			}
		} catch (error) {
			console.error('Error reconnecting orphaned children:', error);
			vscode.window.showErrorMessage(`Failed to reconnect orphaned children: ${error}`);
		}
	}

	/**
	 * Find an orphaned node by name that has no parent edge.
	 * [HI-002] Added isSoftDeleted guard so we only match actual orphans, not watch-root nodes.
	 * [HI-003] Label validated against allowlist before interpolation (FalkorDB doesn't support parameterized labels).
	 */
	private async findOrphanedNode(name: string, isDirectory: boolean): Promise<{ id: string; relativePath: string } | null> {
		try {
			const label = isDirectory ? 'DIRECTORY' : 'FILE';
			if (!FileWatcher.VALID_LABELS.has(label)) {
				throw new Error(`Invalid label: ${label}`);
			}

			let query: string;
			let params: Record<string, unknown>;

			if (!isDirectory) {
				// [HI-002] Match on name + extension for files to reduce ambiguity
				const ext = path.extname(name);
				query = `MATCH (n:${label} {name: $name, extension: $ext})
						 WHERE NOT ()-[:CONTAINS]->(n)
						   AND n.isSoftDeleted IS NOT NULL
						 RETURN n.id as id, n.relativePath as relativePath
						 LIMIT 1`;
				params = { name, ext };
			} else {
				query = `MATCH (n:${label} {name: $name})
						 WHERE NOT ()-[:CONTAINS]->(n)
						   AND n.isSoftDeleted IS NOT NULL
						 RETURN n.id as id, n.relativePath as relativePath
						 LIMIT 1`;
				params = { name };
			}

			const result = await this.store.query(query, params);
			if (result.data && result.data.length > 0) {
				return {
					id: result.data[0].id,
					relativePath: result.data[0].relativePath
				};
			}
			return null;
		} catch (error) {
			console.error('Error finding orphaned node:', error);
			return null;
		}
	}

	private async updateNodePath(oldId: string, newId: string, newRelativePath: string, newAbsolutePath: string): Promise<boolean> {
		try {
			const result = await this.store.query(
				`MATCH (n {id: $oldId})
				 SET n.id = $newId, n.relativePath = $newRelativePath, n.path = $newAbsolutePath
				 REMOVE n.isSoftDeleted
				 RETURN n`,
				{ oldId, newId, newRelativePath, newAbsolutePath }
			);

			return result.data && result.data.length > 0;
		} catch (error: any) {
			console.error('Error updating node path:', error);
			vscode.window.showErrorMessage(`Failed to update node path from ${oldId} to ${newId}: ${error.message}`);
			return false;
		}
	}

	private async updateDescendantPaths(oldParentId: string, oldParentRelPath: string, newParentRelPath: string): Promise<void> {
		try {
			const result = await this.store.query(
				`MATCH (parent {id: $id})-[:CONTAINS*]->(descendant)
				 RETURN descendant`,
				{ id: oldParentId }
			);

			for (const row of result.data || []) {
				const descendant = row.descendant.properties;
				const oldRelPath = descendant.relativePath;

				// [CR-003] Use explicit prefix check+slice instead of String.replace (first-match-only bug)
				if (!oldRelPath.startsWith(oldParentRelPath)) {
					console.warn(`Descendant path ${oldRelPath} does not start with expected prefix ${oldParentRelPath}`);
					continue;
				}
				const suffix = oldRelPath.slice(oldParentRelPath.length);
				const newRelPath = newParentRelPath + suffix;

				const newAbsPath = path.join(this.workspaceRoot, newRelPath);
				const newId = generateId(newRelPath);

				await this.updateNodePath(descendant.id, newId, newRelPath, newAbsPath);
			}
		} catch (error: any) {
			console.error('Error updating descendant paths:', error);
			vscode.window.showErrorMessage(`Failed to update descendant paths: ${error.message}`);
			throw error;
		}
	}

	private cleanupDeletedDirsCache(): void {
		const now = Date.now();
		const keysToDelete: string[] = [];

		for (const [key, info] of this.recentlyDeletedDirs.entries()) {
			if (now - info.timestamp > this.DIR_CACHE_TTL_MS) {
				keysToDelete.push(key);
			}
		}

		for (const key of keysToDelete) {
			this.recentlyDeletedDirs.delete(key);
		}
	}

	/**
	 * Stop watching and dispose resources.
	 * [MD-004] Fire-and-forget flush of pending changes before disposal.
	 */
	public dispose(): void {
		if (this.debounceTimer) {
			clearTimeout(this.debounceTimer);
			this.debounceTimer = null;
		}

		if (this.pendingChanges.size > 0) {
			this.processBatch().catch(err => console.error('Error flushing pending changes on dispose:', err));
		}

		this.recentlyDeletedDirs.clear();
		this.cpgPipeline?.dispose();

		for (const watcher of this.watchers) {
			watcher.dispose();
		}
		this.watchers = [];
	}
}
