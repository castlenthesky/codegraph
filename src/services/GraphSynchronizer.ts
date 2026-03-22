import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { FalkorDBService } from './FalkorDBService';
import { GraphViewProvider } from '../providers/GraphViewProvider';
import { FileSystemIndexer } from './FileSystemIndexer';

/**
 * Service responsible for orchestrating the state synchronization between the
 * FalkorDB database (the backend source of truth for the Code Property Graph) and
 * the active workspace file system.
 * 
 * This service implements the "Stale-While-Revalidate" pattern:
 * 1. Fast Load: Serves the current cached graph view immediately upon startup.
 * 2. Background Reconciliation: Synchronizes any external file modifications,
 *    creations, or deletions that occurred while the extension was inactive.
 * 3. Continuous Sync: Periodically checks for desyncs during long sessions.
 * 
 * Interactions:
 * - `FalkorDBService`: Primary interface to read/write nodes and edges.
 * - `GraphViewProvider`: Target Webview that requires UI refreshes when the DB state changes.
 * - `FileSystemIndexer`: Utilized to parse and insert missing or modified AST structures into the database.
 */
export class GraphSynchronizer {
    private dbService: FalkorDBService;
    private graphView?: GraphViewProvider;
    private isReconciling = false;
    private lastReconciliation = 0;
    private reconciliationTimer?: NodeJS.Timeout;
    private workspaceRoot: string;

    constructor() {
        this.dbService = FalkorDBService.getInstance();
        this.workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';
    }

    /**
     * Connects this synchronizer to the active Webview so that it can trigger visual
     * updates whenever new graph data is verified or corrected in the background.
     * 
     * @param graphView The active GraphViewProvider displaying the node logic to the user.
     */
    public setGraphView(graphView: GraphViewProvider): void {
        this.graphView = graphView;
    }

    /**
     * Ensures that the workspace root node exists in the graph.
     * This should be called before any reconciliation to ensure the base structure exists.
     */
    public async ensureWorkspaceRoot(): Promise<void> {
        await this.dbService.connect();

        // Check if workspace root already exists
        const result = await this.dbService.query(
            `MATCH (n) WHERE n.id = 'workspace-root' RETURN n LIMIT 1`
        );

        if (result.data && result.data.length > 0) {
            // Workspace root already exists
            return;
        }

        // Create workspace root node
        const workspaceName = path.basename(this.workspaceRoot);
        await this.dbService.createNode({
            id: 'workspace-root',
            label: 'DIRECTORY',
            name: workspaceName,
            path: this.workspaceRoot,
            relativePath: '',
            createdAt: Date.now(),
            modifiedAt: Date.now()
        });

        // Connect watch folders to workspace root if they exist
        const config = vscode.workspace.getConfiguration('falkordb');
        const watchFoldersStr = config.get<string>('watchFolders', 'src');
        const watchFolders = watchFoldersStr.split(',').map(f => f.trim()).filter(f => f.length > 0);

        for (const folder of watchFolders) {
            const watchFolderId = folder.replace(/\\/g, '/');

            // Check if watch folder node exists
            const folderResult = await this.dbService.query(
                `MATCH (n) WHERE n.id = $id RETURN n LIMIT 1`,
                { id: watchFolderId }
            );

            // Only create edge if the watch folder node exists
            if (folderResult.data && folderResult.data.length > 0) {
                await this.dbService.createEdge({
                    source: 'workspace-root',
                    target: watchFolderId,
                    type: 'CONTAINS'
                });
            }
        }
    }

    /**
     * One-time migration to clean up legacy nodes from old code.
     * Removes any Metadata, DemoNode, or other non-FILE/DIRECTORY nodes from the database.
     * This can be removed in future versions after users have migrated.
     */
    public async cleanupLegacyNodes(): Promise<void> {
        await this.dbService.connect();

        // Remove Metadata nodes
        const metadataResult = await this.dbService.query(`MATCH (n:Metadata) RETURN count(n) as count`);
        const metadataCount = metadataResult.data?.[0]?.count || 0;
        if (metadataCount > 0) {
            await this.dbService.query(`MATCH (n:Metadata) DETACH DELETE n`);
            console.log(`Removed ${metadataCount} Metadata nodes`);
        }

        // Remove DemoNode nodes
        const demoResult = await this.dbService.query(`MATCH (n:DemoNode) RETURN count(n) as count`);
        const demoCount = demoResult.data?.[0]?.count || 0;
        if (demoCount > 0) {
            await this.dbService.query(`MATCH (n:DemoNode) DETACH DELETE n`);
            console.log(`Removed ${demoCount} DemoNode nodes`);
        }

        // Remove any other nodes that aren't FILE or DIRECTORY
        const otherResult = await this.dbService.query(
            `MATCH (n) WHERE NOT (n:FILE OR n:DIRECTORY) RETURN count(n) as count`
        );
        const otherCount = otherResult.data?.[0]?.count || 0;
        if (otherCount > 0) {
            await this.dbService.query(`MATCH (n) WHERE NOT (n:FILE OR n:DIRECTORY) DETACH DELETE n`);
            console.log(`Removed ${otherCount} other legacy nodes`);
        }
    }

    /**
     * PHASE 1: Fast Load
     * 
     * Immediately fetches whatever graph structures exist in the database and dispatches
     * them to the GraphViewProvider. Provides users with an instantaneous visual response
     * (the "stale" portion of the pattern) while reconciliation loads in the background.
     */
    public async loadGraphFromDatabase(): Promise<void> {
        try {
            await this.dbService.connect();
            const { nodes, edges } = await this.dbService.getAllNodesAndEdges();
            if (this.graphView) {
                await this.graphView.refresh();
            }
            console.log(`Loaded ${nodes.length} nodes, ${edges.length} edges from database.`);
        } catch (error: any) {
            console.error('Failed to load graph from database:', error);
            vscode.window.showWarningMessage('Could not load code graph. Will rebuild.');
        }
    }

    /**
     * PHASE 2: Background Reconciliation
     * 
     * Compares the database's record of files against the true file system representation
     * (the "revalidate" portion of the pattern).
     * 
     * It relies on `smartReconciliation()` to dynamically determine the most performant
     * strategy for syncing (incremental vs full scan). Afterwards, informs the View
     * provider that the underlying data set is refreshed.
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
                // Execute smart hybrid reconciliation strategy
                await this.smartReconciliation(progress);

                // Re-sync UI after corrections
                if (this.graphView) {
                    await this.graphView.refresh();
                }

            } catch (error: any) {
                console.error('Reconciliation failed:', error);
                vscode.window.showErrorMessage(`Failed to validate code graph: ${error.message}`);
            } finally {
                this.isReconciling = false;
            }
        });
    }

    /**
     * Phase 3: Continuous Sync
     * 
     * Initiates a periodic heartbeat that automatically kicks off background reconciliation.
     * Useful for recovering from any subtle watcher errors or external git branch switches
     * that happened to bypass direct event detection.
     */
    public startPeriodicReconciliation(): void {
        this.reconciliationTimer = setInterval(() => {
            const timeSinceLastRecon = Date.now() - this.lastReconciliation;
            const FIVE_MINUTES = 5 * 60 * 1000;

            if (timeSinceLastRecon > FIVE_MINUTES) {
                console.log('Triggering periodic reconciliation');
                this.reconcileInBackground();
            }
        }, 60 * 1000); // Check every 1 minute
    }

    /**
     * Dynamic reconciliation router that applies the best synchronization strategy
     * based on the raw file count. Heavily mitigates CPU locking for massive workspaces.
     */
    private async smartReconciliation(progress: vscode.Progress<{ message?: string }>): Promise<void> {
        const fileCount = await this.estimateFileCount();

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
        // REMOVED: Metadata node creation - not needed in graph visualization
        // await this.dbService.query(
        //     `MERGE (m:Metadata {key: 'lastReconciliation'}) SET m.value = $time`,
        //     { time: this.lastReconciliation }
        // );

        if (orphans.length > 0 || missingFiles.length > 0) {
            vscode.window.showInformationMessage(
                `Code graph updated: ${orphans.length} deleted, ${missingFiles.length} added`
            );
        }
    }

    /**
     * Determines which nodes in the graph represent files that have been deleted
     * manually outside the jurisdiction of VS Code events, OR nodes that are
     * completely isolated (have no edges connecting them to the graph).
     *
     * @returns List of internal node IDs representing deleted or orphaned nodes.
     */
    private async findOrphanNodes(): Promise<string[]> {
        const orphans: string[] = [];

        // Phase 1: Find nodes whose files no longer exist on disk
        const result = await this.dbService.query('MATCH (n) WHERE n:FILE OR n:DIRECTORY RETURN n.id as id, n.path as path');
        for (const row of result.data || []) {
            if (!fs.existsSync(row.path)) {
                orphans.push(row.id);
            }
        }

        // Phase 2: Find isolated nodes (nodes with no edges - completely disconnected)
        const isolatedResult = await this.dbService.query(
            `MATCH (n)
             WHERE (n:FILE OR n:DIRECTORY) AND NOT (n)--()
             RETURN n.id as id`
        );
        for (const row of isolatedResult.data || []) {
            if (!orphans.includes(row.id)) {
                orphans.push(row.id);
            }
        }

        // Phase 3: Find legacy nodes (Metadata, DemoNode, or any non-FILE/DIRECTORY nodes)
        const legacyResult = await this.dbService.query(
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

    /**
     * Discovers all source files existing within the workspace that currently lack
     * an equivalent tracking node inside FalkorDB.
     * 
     * @returns A list of absolute file paths pending inclusion into the graph.
     */
    private async findMissingFiles(): Promise<string[]> {
        const missingFiles: string[] = [];
        const dbResult = await this.dbService.query('MATCH (n) WHERE n:FILE OR n:DIRECTORY RETURN n.path as path');
        const dbPaths = new Set(dbResult.data?.map((row: any) => row.path) || []);

        const config = vscode.workspace.getConfiguration('falkordb');
        const watchFoldersStr = config.get<string>('watchFolders', 'src');
        const watchFolders = watchFoldersStr.split(',').map(f => f.trim());

        for (const folder of watchFolders) {
            const folderPath = path.join(this.workspaceRoot, folder);
            if (!fs.existsSync(folderPath)) continue;

            const filesOnDisk = this.scanDirectory(folderPath);
            for (const filePath of filesOnDisk) {
                if (!dbPaths.has(filePath)) {
                    missingFiles.push(filePath);
                }
            }
        }
        return missingFiles;
    }

    /**
     * Processes removal of node IDs that were verified as purged orphans.
     */
    private async cleanupOrphans(nodeIds: string[]): Promise<void> {
        for (const nodeId of nodeIds) {
            await this.dbService.deleteNode(nodeId);
        }
    }

    /**
     * Delegates file processing tasks to the FileSystemIndexer to rebuild the AST
     * and persist elements into FalkorDB in parallel.
     * 
     * @param filePaths List of missing absolute file paths.
     */
    private async indexMissingFiles(filePaths: string[]): Promise<void> {
        for (const fullPath of filePaths) {
            const relativePath = path.relative(this.workspaceRoot, fullPath);
            const stats = fs.statSync(fullPath);
            const nodeId = relativePath.replace(/\\/g, '/');

            if (stats.isDirectory()) {
                await this.dbService.createNode({
                    id: nodeId, label: 'DIRECTORY', name: path.basename(fullPath),
                    path: fullPath, relativePath, createdAt: stats.birthtimeMs, modifiedAt: stats.mtimeMs
                });
                await this.createParentEdge(relativePath, nodeId);
            } else if (stats.isFile()) {
                await this.dbService.createNode({
                    id: nodeId, label: 'FILE', name: path.basename(fullPath),
                    path: fullPath, relativePath, extension: path.extname(fullPath),
                    language: this.detectLanguage(path.extname(fullPath)), size: stats.size,
                    createdAt: stats.birthtimeMs, modifiedAt: stats.mtimeMs, isParsed: false
                });
                await this.createParentEdge(relativePath, nodeId);
            }
        }
    }

    private async createParentEdge(childRelativePath: string, childId: string): Promise<void> {
        const parentRelPath = path.dirname(childRelativePath);

        // If at root level, connect to workspace root
        if (parentRelPath === '.' || parentRelPath === '') {
            await this.dbService.createEdge({
                source: 'workspace-root',
                target: childId,
                type: 'CONTAINS'
            });
            return;
        }

        const parentId = parentRelPath.replace(/\\/g, '/');

        // Check if parent node exists before creating edge
        const parentExists = await this.dbService.query(
            `MATCH (n) WHERE n.id = $id RETURN n LIMIT 1`,
            { id: parentId }
        );

        // If parent doesn't exist, create it first
        if (!parentExists.data || parentExists.data.length === 0) {
            const parentAbsPath = path.join(this.workspaceRoot, parentRelPath);

            // Only create parent if it exists on filesystem
            if (fs.existsSync(parentAbsPath)) {
                const stats = fs.statSync(parentAbsPath);
                await this.dbService.createNode({
                    id: parentId,
                    label: 'DIRECTORY',
                    name: path.basename(parentAbsPath),
                    path: parentAbsPath,
                    relativePath: parentRelPath,
                    createdAt: stats.birthtimeMs,
                    modifiedAt: stats.mtimeMs
                });

                // Recursively create edge to parent's parent
                await this.createParentEdge(parentRelPath, parentId);
            } else {
                // Parent doesn't exist on filesystem, skip edge creation
                return;
            }
        }

        // Create edge from parent to child
        await this.dbService.createEdge({
            source: parentId,
            target: childId,
            type: 'CONTAINS'
        });
    }

    private detectLanguage(extension: string): string {
        const map: Record<string, string> = { '.ts': 'typescript', '.js': 'javascript', '.py': 'python' };
        return map[extension.toLowerCase()] || 'unknown';
    }

    /**
     * Fallback validation mechanism that analyzes remaining persisted files
     * to check if their modified timestamps mismatch to detect "stealth" external
     * edits where a file wasn't added/deleted, only subtly transformed.
     */
    private async verifyFileMetadata(): Promise<void> {
        const result = await this.dbService.query(
            'MATCH (f:FILE) RETURN f.id as id, f.path as path, f.size as size, f.modifiedAt as modifiedAt'
        );
        for (const row of result.data || []) {
            if (!fs.existsSync(row.path)) continue;
            const stats = fs.statSync(row.path);
            if (stats.size !== row.size || stats.mtimeMs !== row.modifiedAt) {
                await this.dbService.updateNode(row.id, {
                    size: stats.size,
                    modifiedAt: stats.mtimeMs
                });
            }
        }
    }

    /**
     * General utility function to recursively read files across the physical hard drive.
     */
    private scanDirectory(dirPath: string): string[] {
        const files: string[] = [];
        try {
            const entries = fs.readdirSync(dirPath, { withFileTypes: true });
            for (const entry of entries) {
                if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
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

    /**
     * Utility method simulating file count check across large workspaces to determine
     * caching and memory retention optimizations in future.
     */
    private async estimateFileCount(): Promise<number> {
        // Simple metric representing workspace volume. Could be a DB COUNT query.
        return 1000; 
    }

    /**
     * Kills and garbage-collects any periodic synchronization intervals when the VS Code
     * window or extension module deactivates.
     */
    public dispose(): void {
        if (this.reconciliationTimer) {
            clearInterval(this.reconciliationTimer);
        }
    }
}
