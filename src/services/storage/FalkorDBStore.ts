import * as fs from 'fs';
import * as vscode from 'vscode';
import type { GraphNode, GraphEdge } from '../../types/nodes';
import type { CpgNode, CpgEdge } from '../../types/cpg';
import type { IGraphStore } from '../../types/storage';
import { serializeProperties, serializeValue, buildBatchNodeCypher, buildBatchEdgeCypher } from './cypher/queries';

type FalkorDBClient = any;
type Graph = any;

/**
 * FalkorDB-backed implementation of IGraphStore.
 *
 * Supports two connection modes:
 * - embedded: falkordblite with local file persistence
 * - remote: falkordb connecting to a Redis-protocol server
 *
 * Instantiate once in bootstrap.ts and inject into all consumers.
 */
export class FalkorDBStore implements IGraphStore {
	private db: FalkorDBClient | null = null;
	private graph: Graph | null = null;

	public async connect(): Promise<void> {
		if (this.db) {
			return;
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

		if (dataPath && !fs.existsSync(dataPath)) {
			fs.mkdirSync(dataPath, { recursive: true });
		}

		const { FalkorDB } = await import('falkordblite');
		this.db = await FalkorDB.open({
			path: dataPath || undefined,
		});
		this.graph = this.db.selectGraph(graphName);
		await this.createIndexes();
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
		await this.createIndexes();
	}

	public async query(cypherQuery: string, params?: Record<string, any>): Promise<any> {
		if (!this.graph) {
			await this.connect();
		}
		const options = params ? { params } : undefined;
		return await this.graph!.query(cypherQuery, options);
	}

	public async createNode(node: GraphNode): Promise<void> {
		const checkQuery = `MATCH (n {id: $id}) RETURN n.id LIMIT 1`;
		const res = await this.query(checkQuery, { id: node.id });
		if (res.data && res.data.length > 0) { return; }

		const props = serializeProperties(node as unknown as Record<string, unknown>);
		const query = `CREATE (n:${node.label} ${props})`;
		await this.query(query);
	}

	public async createEdge(edge: GraphEdge): Promise<void> {
		const query = `
			MATCH (source {id: $sourceId})
			MATCH (target {id: $targetId})
			MERGE (source)-[:${edge.type}]->(target)
		`;
		await this.query(query, { sourceId: edge.source, targetId: edge.target });
	}

	public async deleteNode(nodeId: string): Promise<void> {
		const query = `MATCH (n {id: $id}) DETACH DELETE n`;
		await this.query(query, { id: nodeId });
	}

	public async updateNode(nodeId: string, updates: Partial<GraphNode>): Promise<void> {
		const setClause = Object.entries(updates)
			.filter(([key]) => key !== 'id' && key !== 'label')
			.map(([key, value]) => `n.${key} = ${serializeValue(value)}`)
			.join(', ');

		if (setClause) {
			const query = `MATCH (n {id: $id}) SET ${setClause}`;
			await this.query(query, { id: nodeId });
		}
	}

	public async getAllNodesAndEdges(): Promise<{ nodes: GraphNode[]; edges: GraphEdge[] }> {
		const nodesResult = await this.query(`MATCH (n) RETURN n`);
		const nodes: GraphNode[] = nodesResult.data.map((row: any) => row.n.properties);

		const edgesResult = await this.query(
			`MATCH (source)-[r]->(target) RETURN source.id AS sourceId, target.id AS targetId, type(r) AS type`
		);
		const edges: GraphEdge[] = edgesResult.data.map((row: any) => ({
			source: row['sourceId'],
			target: row['targetId'],
			type: row['type']
		}));

		return { nodes, edges };
	}

	public async clearGraph(): Promise<void> {
		await this.query('MATCH (n) DETACH DELETE n');
	}

	public async createNodes(nodes: CpgNode[]): Promise<void> {
		const queries = buildBatchNodeCypher(nodes);
		const BATCH_SIZE = 50;
		for (let i = 0; i < queries.length; i += BATCH_SIZE) {
			await Promise.all(queries.slice(i, i + BATCH_SIZE).map(q => this.query(q)));
		}
	}

	public async createEdges(edges: CpgEdge[]): Promise<void> {
		const queries = buildBatchEdgeCypher(edges);
		const BATCH_SIZE = 50;
		for (let i = 0; i < queries.length; i += BATCH_SIZE) {
			await Promise.all(queries.slice(i, i + BATCH_SIZE).map(q => this.query(q)));
		}
	}

	public async deleteNodes(nodeIds: string[]): Promise<void> {
		if (nodeIds.length === 0) { return; }
		const BATCH_SIZE = 100;
		for (let i = 0; i < nodeIds.length; i += BATCH_SIZE) {
			const batch = nodeIds.slice(i, i + BATCH_SIZE);
			const idList = batch.map(id => `"${id.replace(/"/g, '\\"')}"`).join(', ');
			await this.query(`MATCH (n) WHERE n.id IN [${idList}] DETACH DELETE n`);
		}
	}

	public async replaceFileSubgraph(filePath: string, nodes: CpgNode[], edges: CpgEdge[]): Promise<void> {
		const escapedPath = filePath.replace(/"/g, '\\"');
		await this.query(
			`MATCH (n) WHERE n.filename = "${escapedPath}" AND NOT n.label = "FILE" AND NOT (n:DIRECTORY) DETACH DELETE n`
		);
		if (nodes.length > 0) { await this.createNodes(nodes); }
		if (edges.length > 0) { await this.createEdges(edges); }
	}

	private async createIndexes(): Promise<void> {
		const indexes = [
			'CREATE INDEX FOR (n:METHOD) ON (n.fullName)',
			'CREATE INDEX FOR (n:FILE) ON (n.name)',
			'CREATE INDEX FOR (n:CALL) ON (n.methodFullName)',
			'CREATE INDEX FOR (n:TYPE_DECL) ON (n.fullName)',
			'CREATE INDEX FOR (n:IDENTIFIER) ON (n.name)',
		];
		for (const idx of indexes) {
			try { await this.query(idx); } catch { /* ignore if already exists */ }
		}
	}

	public async close(): Promise<void> {
		if (this.db) {
			await this.db.close();
			this.db = null;
			this.graph = null;
		}
	}
}
