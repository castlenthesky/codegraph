import type { GraphNode, GraphEdge } from './nodes';

/**
 * Interface for graph storage backends.
 * Implementations: FalkorDBStore (embedded or remote).
 */
export interface IGraphStore {
	connect(): Promise<void>;
	close(): Promise<void>;
	query(cypher: string, params?: Record<string, any>): Promise<any>;
	createNode(node: GraphNode): Promise<void>;
	createEdge(edge: GraphEdge): Promise<void>;
	deleteNode(nodeId: string): Promise<void>;
	updateNode(nodeId: string, updates: Partial<GraphNode>): Promise<void>;
	getAllNodesAndEdges(): Promise<{ nodes: GraphNode[]; edges: GraphEdge[] }>;
	clearGraph(): Promise<void>;
}
