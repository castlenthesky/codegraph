import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import type { GraphNode, GraphEdge } from '../models/GraphNodes';

type FalkorDBClient = any;
type Graph = any;

/**
 * Core Database Service wrapping the FalkorDB graph database.
 * 
 * Responsibilities:
 * - Manages connection lifecycles (embedded or remote modes).
 * - Executes Cypher queries against the active graph structure.
 * - Used heavily by the `GraphSynchronizer` and `AtomicUpdate` services 
 *   to ensure consistent atomic and background operations.
 */
export class FalkorDBService {
	private static instance: FalkorDBService;
	private db: FalkorDBClient | null = null;
	private graph: Graph | null = null;

	private constructor() {}

	public static getInstance(): FalkorDBService {
		if (!FalkorDBService.instance) {
			FalkorDBService.instance = new FalkorDBService();
		}
		return FalkorDBService.instance;
	}

	/**
	 * Connect to FalkorDB (embedded or remote) based on configuration
	 */
	public async connect(): Promise<void> {
		if (this.db) {
			return; // Already connected
		}

		const config = vscode.workspace.getConfiguration('falkordb');
		const mode = config.get<string>('connectionMode', 'embedded');
		const graphName = config.get<string>('graphName', 'default');

		try {
			if (mode === 'embedded') {
				await this.connectEmbedded(graphName);
			} else {
				await this.connectRemote(graphName);
			}
		} catch (error: any) {
			throw new Error(`Failed to connect to FalkorDB: ${error.message}`);
		}
	}

	private async connectEmbedded(graphName: string): Promise<void> {
		const config = vscode.workspace.getConfiguration('falkordb');
		const dataPath = config.get<string>('dataPath', '').replace(
			'${workspaceFolder}',
			vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || ''
		);

		// Ensure directory exists
		if (dataPath && !fs.existsSync(dataPath)) {
			fs.mkdirSync(dataPath, { recursive: true });
		}

		// Resolve binary paths
		let redisServerPath: string | undefined;
		let modulePath: string | undefined;
		try {
			const pkg = require.resolve('@falkordblite/linux-x64/package.json');
			const binDir = path.join(path.dirname(pkg), 'bin');
			const _r = path.join(binDir, 'redis-server');
			const _m = path.join(binDir, 'falkordb.so');
			if (fs.existsSync(_r)) redisServerPath = _r;
			if (fs.existsSync(_m)) modulePath = _m;
		} catch (e) {
			// Fallback gracefully
		}

		const { FalkorDB } = await import('falkordblite');
		this.db = await FalkorDB.open({
			path: dataPath || undefined,
			redisServerPath,
			modulePath
		});
		this.graph = this.db.selectGraph(graphName);
	}

	private async connectRemote(graphName: string): Promise<void> {
		const config = vscode.workspace.getConfiguration('falkordb');
		const host = config.get<string>('host', 'localhost');
		const port = config.get<number>('port', 6379);
		const password = config.get<string>('password', '');

		const { FalkorDB } = await import('falkordb');
		this.db = await FalkorDB.connect({
			socket: { host, port },
			password: password || undefined
		});
		this.graph = this.db.selectGraph(graphName);
	}

	/**
	 * Execute a Cypher query
	 */
	public async query(cypherQuery: string, params?: Record<string, any>): Promise<any> {
		if (!this.graph) {
			await this.connect();
		}
		const options = params ? { params: params } : undefined;
		return await this.graph!.query(cypherQuery, options);
	}

	/**
	 * Create a node in the graph
	 */
	public async createNode(node: GraphNode): Promise<void> {
		const props = this.serializeProperties(node);
		const query = `CREATE (n:${node.label} ${props})`;
		await this.query(query);
	}

	/**
	 * Create an edge in the graph
	 */
	public async createEdge(edge: GraphEdge): Promise<void> {
		const query = `
			MATCH (source {id: $sourceId})
			MATCH (target {id: $targetId})
			CREATE (source)-[:${edge.type}]->(target)
		`;
		await this.query(query, { sourceId: edge.source, targetId: edge.target });
	}

	/**
	 * Delete a node and all its edges
	 */
	public async deleteNode(nodeId: string): Promise<void> {
		const query = `MATCH (n {id: $id}) DETACH DELETE n`;
		await this.query(query, { id: nodeId });
	}

	/**
	 * Update node properties
	 */
	public async updateNode(nodeId: string, updates: Partial<GraphNode>): Promise<void> {
		const setClause = Object.entries(updates)
			.filter(([key]) => key !== 'id' && key !== 'label')
			.map(([key, value]) => `n.${key} = ${this.serializeValue(value)}`)
			.join(', ');

		if (setClause) {
			const query = `MATCH (n {id: $id}) SET ${setClause}`;
			await this.query(query, { id: nodeId });
		}
	}

	/**
	 * Get all nodes and edges
	 */
	public async getAllNodesAndEdges(): Promise<{ nodes: GraphNode[], edges: GraphEdge[] }> {
		// Query for nodes
		const nodesResult = await this.query(`MATCH (n) RETURN n`);
		const nodes: GraphNode[] = nodesResult.data.map((row: any) => row.n.properties);

		// Query for edges
		const edgesResult = await this.query(`MATCH (source)-[r]->(target) RETURN source.id AS sourceId, target.id AS targetId, type(r) AS type`);
		const edges: GraphEdge[] = edgesResult.data.map((row: any) => ({
			source: row['sourceId'],
			target: row['targetId'],
			type: row['type']
		}));

		return { nodes, edges };
	}

	/**
	 * Clear all nodes and edges (for testing/reset)
	 */
	public async clearGraph(): Promise<void> {
		await this.query('MATCH (n) DETACH DELETE n');
	}

	/**
	 * Close the database connection
	 */
	public async close(): Promise<void> {
		if (this.db) {
			await this.db.close();
			this.db = null;
			this.graph = null;
		}
	}

	/**
	 * Serialize object properties to Cypher format
	 */
	private serializeProperties(obj: Record<string, any>): string {
		const props = Object.entries(obj)
			.map(([key, value]) => `${key}: ${this.serializeValue(value)}`)
			.join(', ');
		return `{${props}}`;
	}

	/**
	 * Serialize a value to Cypher format
	 */
	private serializeValue(value: any): string {
		if (typeof value === 'string') {
			return `"${value.replace(/"/g, '\\"')}"`;
		} else if (typeof value === 'number' || typeof value === 'boolean') {
			return String(value);
		} else if (value === null || value === undefined) {
			return 'null';
		}
		return `"${String(value)}"`;
	}
}
