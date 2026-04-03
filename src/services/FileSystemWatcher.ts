import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { FalkorDBService } from './FalkorDBService';
import type { DirectoryNode, FileNode, GraphEdge } from '../models/GraphNodes';

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

export class FileSystemWatcher {
	private dbService: FalkorDBService;
	private workspaceRoot: string;
	private watchers: vscode.Disposable[] = [];
	private graphViewProvider: any; // Will be set to trigger refreshes

	// Debouncing support for batched updates
	private pendingChanges: Map<string, PendingChange> = new Map();
	private debounceTimer: NodeJS.Timeout | null = null;
	private readonly DEBOUNCE_DELAY_MS = 500;

	// Directory move tracking (to handle reconnection of orphaned children)
	private recentlyDeletedDirs: Map<string, DeletedDirectoryInfo> = new Map();
	private readonly DIR_CACHE_TTL_MS = 5000; // 5 seconds

	constructor() {
		this.dbService = FalkorDBService.getInstance();
		this.workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';
	}

	/**
	 * Set the graph view provider to notify on changes
	 */
	public setGraphViewProvider(provider: any): void {
		this.graphViewProvider = provider;
	}

	/**
	 * Start watching configured folders
	 */
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

	/**
	 * Queue a file system change for batched processing
	 */
	private queueChange(type: 'create' | 'delete' | 'change' | 'rename', uri: vscode.Uri, newUri?: vscode.Uri): void {
		const key = uri.fsPath;

		if (type === 'rename' && newUri) {
			// Clear any pending independent creates/deletes for these paths
			this.pendingChanges.delete(uri.fsPath);
			this.pendingChanges.delete(newUri.fsPath);
			this.pendingChanges.set(`rename:${key}`, { type, uri, newUri, timestamp: Date.now() });
		} else {
			const existing = this.pendingChanges.get(key);
			// Prevent overriding a rename if delete/create fires subsequently
			if (existing && existing.type === 'rename') return;

			if (existing) {
				if (type === 'delete') {
					this.pendingChanges.set(key, { type, uri, timestamp: Date.now() });
				} else if (type === 'create' && existing.type === 'change') {
					this.pendingChanges.set(key, { type, uri, timestamp: Date.now() });
				}
			} else {
				this.pendingChanges.set(key, { type, uri, timestamp: Date.now() });
			}
		}

		// Reset debounce timer
		if (this.debounceTimer) {
			clearTimeout(this.debounceTimer);
		}

		// Schedule batch processing
		this.debounceTimer = setTimeout(() => {
			this.processBatch();
		}, this.DEBOUNCE_DELAY_MS);
	}

	/**
	 * Process all queued changes as a batch
	 */
	private async processBatch(): Promise<void> {
		if (this.pendingChanges.size === 0) {
			return;
		}

		// Sort changes to securely construct topological parent hierarchies first
		const changes = Array.from(this.pendingChanges.values());
		changes.sort((a, b) => {
			const typeRank = { 'rename': 0, 'delete': 1, 'change': 2, 'create': 3 };
			if (typeRank[a.type] !== typeRank[b.type]) {
				return typeRank[a.type] - typeRank[b.type];
			}
			// For ties (e.g. rapid multiple creations), process shortest paths first (parents before children)
			return a.uri.fsPath.length - b.uri.fsPath.length;
		});

		this.pendingChanges.clear();
		this.debounceTimer = null;

		// Process each change
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

		// Sweep any expired soft-deleted orphans
		await this.hardDeleteExpiredNodes();

		// Notify graph view once for the entire batch
		this.notifyGraphRefresh();
	}

	/**
	 * Permanently delete any nodes that were soft-deleted more than TTL ms ago
	 */
	private async hardDeleteExpiredNodes(): Promise<void> {
		const threshold = Date.now() - this.DIR_CACHE_TTL_MS;
		try {
			await this.dbService.query(
				`MATCH (n) WHERE n.isSoftDeleted IS NOT NULL AND n.isSoftDeleted < $threshold DETACH DELETE n`,
				{ threshold }
			);
		} catch (error) {
			console.error('Error sweeping soft-deleted nodes:', error);
		}
	}

	/**
	 * Handle atomic file/directory rename
	 */
	private async handleFileRenamed(oldUri: vscode.Uri, newUri: vscode.Uri): Promise<void> {
		try {
			const oldRelativePath = path.relative(this.workspaceRoot, oldUri.fsPath);
			const newRelativePath = path.relative(this.workspaceRoot, newUri.fsPath);
			const oldId = this.generateId(oldRelativePath);
			const newId = this.generateId(newRelativePath);

			const isDirectory = await this.isDirectoryNode(oldId);

			await this.updateNodePath(oldId, newId, newRelativePath, newUri.fsPath);

			await this.dbService.query(`MATCH ()-[r:CONTAINS]->(n {id: $newId}) DELETE r`, { newId });
			await this.createParentEdge(newRelativePath, newId);

			if (isDirectory) {
				await this.updateDescendantPaths(newId, oldRelativePath, newRelativePath);
			}
		} catch (error: any) {
			console.error(`Error handling file rename from ${oldUri.fsPath} to ${newUri.fsPath}:`, error);
		}
	}

	/**
	 * Handle file/directory creation
	 */
	private async handleFileCreated(uri: vscode.Uri): Promise<void> {
		try {
			const absolutePath = uri.fsPath;
			const relativePath = path.relative(this.workspaceRoot, absolutePath);

			// Check if it's a directory or file
			const stats = fs.statSync(absolutePath);

			if (stats.isDirectory()) {
				// Create directory node
				const dirNode = this.createDirectoryNode(absolutePath, relativePath);
				await this.dbService.createNode(dirNode);

				// Strip any soft delete ghosts if it was resiliently recreated via idempotency
				await this.dbService.query(`MATCH (n {id: $id}) REMOVE n.isSoftDeleted`, { id: dirNode.id });

				// Create CONTAINS edge from parent
				await this.createParentEdge(relativePath, dirNode.id);

				// Check if this directory has orphaned children from a recent move operation
				await this.reconnectOrphanedChildren(dirNode.id, relativePath, absolutePath);
			} else if (stats.isFile()) {
				// Skip hidden files and files in node_modules
				if (path.basename(absolutePath).startsWith('.') || absolutePath.includes('node_modules')) {
					return;
				}

				// Create file node
				const fileNode = this.createFileNode(absolutePath, relativePath);
				await this.dbService.createNode(fileNode);

				// Strip any soft delete ghosts
				await this.dbService.query(`MATCH (n {id: $id}) REMOVE n.isSoftDeleted`, { id: fileNode.id });

				// Create CONTAINS edge from parent directory
				await this.createParentEdge(relativePath, fileNode.id);
			}

			// Note: Graph refresh is handled by processBatch() to batch multiple changes

		} catch (error: any) {
			console.error('Error handling file creation:', error);
			vscode.window.showErrorMessage(`Failed to create node: ${error.message}`);
		}
	}

	/**
	 * Handle file/directory deletion
	 */
	private async handleFileDeleted(uri: vscode.Uri): Promise<void> {
		try {
			const relativePath = path.relative(this.workspaceRoot, uri.fsPath);
			const nodeId = this.generateId(relativePath);

			// Check if this is a directory deletion
			const isDirectory = await this.isDirectoryNode(nodeId);
			if (isDirectory) {
				// Get all descendants before deletion
				const descendants = await this.getDescendantNodes(nodeId, relativePath);

				// Cache the directory info for potential move reconnection
				// (in case this is a move operation, not a real delete)
				this.recentlyDeletedDirs.set(nodeId, {
					id: nodeId,
					path: uri.fsPath,
					descendants,
					timestamp: Date.now()
				});

				// Clean up old cache entries
				this.cleanupDeletedDirsCache();

				for (const descendant of descendants) {
					console.log(`Soft-deleting descendant: ${descendant.id}`);
					await this.dbService.query(
						`MATCH (n {id: $id}) SET n.isSoftDeleted = $time`,
						{ id: descendant.id, time: Date.now() }
					);
				}
			}

			// Soft delete the node itself
			await this.dbService.query(
				`MATCH (n {id: $id}) SET n.isSoftDeleted = $time`,
				{ id: nodeId, time: Date.now() }
			);

			// Note: Graph refresh is handled by processBatch() to batch multiple changes

		} catch (error: any) {
			console.error('Error handling file deletion:', error);
			vscode.window.showErrorMessage(`Failed to delete node: ${error.message}`);
		}
	}

	/**
	 * Handle file change (update metadata)
	 */
	private async handleFileChanged(uri: vscode.Uri): Promise<void> {
		try {
			const absolutePath = uri.fsPath;
			const relativePath = path.relative(this.workspaceRoot, absolutePath);

			// Only update files, not directories
			if (!fs.existsSync(absolutePath)) {
				return;
			}

			const stats = fs.statSync(absolutePath);
			if (!stats.isFile()) {
				return;
			}

			const nodeId = this.generateId(relativePath);

			// Update file metadata
			await this.dbService.updateNode(nodeId, {
				size: stats.size,
				modifiedAt: stats.mtimeMs
			} as Partial<FileNode>);

			// Note: We don't refresh the graph view for simple metadata changes
			// to avoid too many updates

		} catch (error: any) {
			console.error('Error handling file change:', error);
			// Note: File changes are frequent, so we only log to console to avoid spam
		}
	}

	/**
	 * Create CONTAINS edge from parent directory to child
	 */
	private async createParentEdge(childRelativePath: string, childId: string): Promise<void> {
		const parentRelPath = path.dirname(childRelativePath);

		// If parent is the workspace root (.), skip (no parent node exists)
		// Watch folder roots (e.g., 'src') ARE valid directories and should exist as nodes
		if (parentRelPath === '.' || parentRelPath === '') {
			return;
		}

		const parentId = this.generateId(parentRelPath);

		// Verify parent exists before creating edge (it should have been created during indexing)
		const edge: GraphEdge = {
			source: parentId,
			target: childId,
			type: 'CONTAINS'
		};

		await this.dbService.createEdge(edge);
	}

	/**
	 * Notify graph view to refresh
	 */
	private notifyGraphRefresh(): void {
		if (this.graphViewProvider && typeof this.graphViewProvider.refresh === 'function') {
			this.graphViewProvider.refresh();
		}
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
		return relativePath.replace(/\\/g, '/');
	}

	/**
	 * Check if a node in the database is a directory
	 */
	private async isDirectoryNode(nodeId: string): Promise<boolean> {
		try {
			const result = await this.dbService.query(
				'MATCH (n {id: $id}) RETURN n.label as label',
				{ id: nodeId }
			);
			return result.data?.[0]?.label === 'DIRECTORY';
		} catch {
			return false;
		}
	}

	/**
	 * Get all descendant nodes of a directory (recursively)
	 */
	private async getDescendantNodes(dirId: string, dirRelativePath: string): Promise<Array<{ id: string; relativePath: string; isDirectory: boolean }>> {
		try {
			// Query for all nodes that are descendants (children at any depth)
			const result = await this.dbService.query(
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

	/**
	 * Reconnect orphaned children when a directory is created
	 * This handles the case where a directory was moved
	 */
	private async reconnectOrphanedChildren(newDirId: string, newRelativePath: string, newAbsolutePath: string): Promise<void> {
		try {
			// Check filesystem for actual children
			if (!fs.existsSync(newAbsolutePath)) {
				return;
			}

			const entries = fs.readdirSync(newAbsolutePath, { withFileTypes: true });

			// First, try to find matching children from recently deleted directories cache
			// This is more reliable than name-only matching
			for (const [deletedDirId, deletedInfo] of this.recentlyDeletedDirs.entries()) {
				// Check if any of the deleted directory's descendants match our new children
				for (const descendant of deletedInfo.descendants) {
					// Extract the child name from the descendant's old path
					const descendantName = path.basename(descendant.relativePath);

					// Check if this descendant exists as a child in our new directory
					const matchingEntry = entries.find(e => e.name === descendantName);
					if (!matchingEntry) {
						continue;
					}

					// Check if the node type matches (directory vs file)
					const expectedIsDir = descendant.isDirectory;
					if (matchingEntry.isDirectory() !== expectedIsDir) {
						continue;
					}

					// Found a match! Reconnect this orphaned child
					const childRelativePath = path.join(newRelativePath, descendantName);
					const childId = this.generateId(childRelativePath);
					const childAbsPath = path.join(newAbsolutePath, descendantName);

					console.log(`Reconnecting orphaned child: ${descendant.id} -> ${childId}`);

					// Update the orphaned node's ID and path to reflect new location
					const updated = await this.updateNodePath(descendant.id, childId, childRelativePath, childAbsPath);

					if (!updated) {
						// Missing from DB entirely, we must recreate it
						if (expectedIsDir) {
							await this.dbService.createNode(this.createDirectoryNode(childAbsPath, childRelativePath));
						} else {
							await this.dbService.createNode(this.createFileNode(childAbsPath, childRelativePath));
						}
					}

					// Create new CONTAINS edge from new parent
					await this.createParentEdge(childRelativePath, childId);

					// If it's a directory, recursively update its descendants
					if (expectedIsDir) {
						if (updated) {
							await this.updateDescendantPaths(childId, descendant.relativePath, childRelativePath);
						} else {
							// Need to recursively reconstruct since it was fully missing
							await this.reconnectOrphanedChildren(childId, childRelativePath, childAbsPath);
						}
					}
				}

				// Remove this deleted directory from cache as we've processed its children
				this.recentlyDeletedDirs.delete(deletedDirId);
			}

			// Fallback: For any children not found in cache, try name-based orphan search
			for (const entry of entries) {
				if (entry.name.startsWith('.') || entry.name === 'node_modules') {
					continue;
				}

				const childRelativePath = path.join(newRelativePath, entry.name);
				const childId = this.generateId(childRelativePath);
				const childAbsPath = path.join(newAbsolutePath, entry.name);

				// Check if this child already exists (was reconnected above or already in DB)
				const existsResult = await this.dbService.query(
					'MATCH (n {id: $id}) RETURN n.id as id',
					{ id: childId }
				);

				if (existsResult.data && existsResult.data.length > 0) {
					// Child already exists with correct ID, skip
					continue;
				}

				// Check if this child exists in database with a different path (orphaned)
				const orphanedChild = await this.findOrphanedNode(entry.name, entry.isDirectory());

				if (orphanedChild) {
					console.log(`Reconnecting orphan via name search: ${orphanedChild.id} -> ${childId}`);

					const updated = await this.updateNodePath(orphanedChild.id, childId, childRelativePath, childAbsPath);

					if (!updated) {
						if (entry.isDirectory()) await this.dbService.createNode(this.createDirectoryNode(childAbsPath, childRelativePath));
						else await this.dbService.createNode(this.createFileNode(childAbsPath, childRelativePath));
					}

					await this.createParentEdge(childRelativePath, childId);

					if (entry.isDirectory()) {
						if (updated) await this.updateDescendantPaths(childId, orphanedChild.relativePath, childRelativePath);
						else await this.reconnectOrphanedChildren(childId, childRelativePath, childAbsPath);
					}
				} else {
					// Discovered a completely new untracked file/folder! Register it.
					if (entry.isDirectory()) {
						await this.dbService.createNode(this.createDirectoryNode(childAbsPath, childRelativePath));
						await this.createParentEdge(childRelativePath, childId);
						await this.reconnectOrphanedChildren(childId, childRelativePath, childAbsPath);
					} else if (entry.isFile()) {
						await this.dbService.createNode(this.createFileNode(childAbsPath, childRelativePath));
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
	 * Find an orphaned node by name that has no parent edge
	 */
	private async findOrphanedNode(name: string, isDirectory: boolean): Promise<{ id: string; relativePath: string } | null> {
		try {
			const label = isDirectory ? 'DIRECTORY' : 'FILE';
			const result = await this.dbService.query(
				`MATCH (n:${label} {name: $name})
				 WHERE NOT ()-[:CONTAINS]->(n)
				 RETURN n.id as id, n.relativePath as relativePath
				 LIMIT 1`,
				{ name }
			);

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

	/**
	 * Update a node's ID and path properties
	 */
	private async updateNodePath(oldId: string, newId: string, newRelativePath: string, newAbsolutePath: string): Promise<boolean> {
		try {
			const result = await this.dbService.query(
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

	/**
	 * Recursively update paths for all descendants of a moved directory
	 */
	private async updateDescendantPaths(oldParentId: string, oldParentRelPath: string, newParentRelPath: string): Promise<void> {
		try {
			// Get all descendants
			const result = await this.dbService.query(
				`MATCH (parent {id: $id})-[:CONTAINS*]->(descendant)
				 RETURN descendant`,
				{ id: oldParentId }
			);

			for (const row of result.data || []) {
				const descendant = row.descendant.properties;
				const oldRelPath = descendant.relativePath;

				// Calculate new relative path by replacing old parent path prefix
				const newRelPath = oldRelPath.replace(oldParentRelPath, newParentRelPath);
				const newAbsPath = path.join(this.workspaceRoot, newRelPath);
				const newId = this.generateId(newRelPath);

				// Update this descendant's path
				await this.updateNodePath(descendant.id, newId, newRelPath, newAbsPath);
			}
		} catch (error: any) {
			console.error('Error updating descendant paths:', error);
			vscode.window.showErrorMessage(`Failed to update descendant paths: ${error.message}`);
			throw error; // Re-throw to propagate failure
		}
	}

	/**
	 * Clean up old deleted directory cache entries
	 */
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
	 * Stop watching and dispose resources
	 */
	public dispose(): void {
		// Clear any pending debounce timer
		if (this.debounceTimer) {
			clearTimeout(this.debounceTimer);
			this.debounceTimer = null;
		}

		// Clear pending changes
		this.pendingChanges.clear();

		// Clear deleted directories cache
		this.recentlyDeletedDirs.clear();

		// Dispose all watchers
		for (const watcher of this.watchers) {
			watcher.dispose();
		}
		this.watchers = [];
	}
}
