import { GraphNode, GraphEdge } from '../models/GraphNodes';

export interface GraphData {
	nodes: GraphNode[];
	edges: GraphEdge[];
}

export interface GraphDiff {
	nodesToAdd: GraphNode[];
	nodesToUpdate: GraphNode[];
	nodesToRemove: string[]; // Just IDs
	edgesToAdd: GraphEdge[];
	edgesToUpdate: GraphEdge[];
	edgesToRemove: GraphEdge[];
}

export interface IncrementalPatch {
	addNodes?: Array<{ id: string; name: string; type: string; val: number }>;
	removeNodes?: string[]; // Node IDs
	updateNodes?: Array<{ id: string; name?: string; type?: string; val?: number }>;
	addLinks?: Array<{ source: string; target: string }>;
	updateLinks?: Array<{ source: string; target: string; type?: string }>;
	removeLinks?: Array<{ source: string; target: string }>;
}

/**
 * Service responsible for computing differences between graph states
 * and creating incremental update patches for the visualization.
 */
export class GraphDiffService {
	/**
	 * Compute the difference between two graph states
	 */
	public computeDiff(oldGraph: GraphData, newGraph: GraphData): GraphDiff {
		const diff: GraphDiff = {
			nodesToAdd: [],
			nodesToUpdate: [],
			nodesToRemove: [],
			edgesToAdd: [],
			edgesToUpdate: [],
			edgesToRemove: []
		};

		// Create lookup maps for efficient comparison
		const oldNodesMap = new Map(oldGraph.nodes.map(n => [n.id, n]));
		const newNodesMap = new Map(newGraph.nodes.map(n => [n.id, n]));

		// Find nodes to add and update
		for (const newNode of newGraph.nodes) {
			const oldNode = oldNodesMap.get(newNode.id);

			if (!oldNode) {
				// Node doesn't exist in old graph - add it
				diff.nodesToAdd.push(newNode);
			} else if (this.hasNodeChanged(oldNode, newNode)) {
				// Node exists but properties changed - update it
				diff.nodesToUpdate.push(newNode);
			}
		}

		// Find nodes to remove
		for (const oldNode of oldGraph.nodes) {
			if (!newNodesMap.has(oldNode.id)) {
				diff.nodesToRemove.push(oldNode.id);
			}
		}

		// Create edge lookup using source-target-type composite key
		const createEdgeKey = (edge: GraphEdge) => `${edge.source}|${edge.target}|${edge.type}`;
		const oldEdgesSet = new Set(oldGraph.edges.map(createEdgeKey));
		const newEdgesSet = new Set(newGraph.edges.map(createEdgeKey));
		const oldEdgesMap = new Map(oldGraph.edges.map(e => [createEdgeKey(e), e]));
		const newEdgesMap = new Map(newGraph.edges.map(e => [createEdgeKey(e), e]));

		// Find edges to add
		for (const [key, edge] of newEdgesMap) {
			if (!oldEdgesSet.has(key)) {
				diff.edgesToAdd.push(edge);
			}
		}

		// Find edges to remove
		for (const [key, edge] of oldEdgesMap) {
			if (!newEdgesSet.has(key)) {
				diff.edgesToRemove.push(edge);
			}
		}

		return diff;
	}

	/**
	 * Check if a node's properties have changed
	 */
	private hasNodeChanged(oldNode: GraphNode, newNode: GraphNode): boolean {
		// Compare key properties that would affect visualization or be meaningful
		if (oldNode.label !== newNode.label) return true;
		if (oldNode.name !== newNode.name) return true;

		// For file nodes, check size and modification time
		if (oldNode.label === 'FILE' && newNode.label === 'FILE') {
			if (oldNode.size !== newNode.size) return true;
			if (oldNode.modifiedAt !== newNode.modifiedAt) return true;
		}

		// For directory nodes, check modification time
		if (oldNode.label === 'DIRECTORY' && newNode.label === 'DIRECTORY') {
			if (oldNode.modifiedAt !== newNode.modifiedAt) return true;
		}

		return false;
	}

	/**
	 * Create an incremental patch formatted for the webview
	 */
	public createIncrementalPatch(diff: GraphDiff): IncrementalPatch {
		const patch: IncrementalPatch = {};

		// Transform nodes to add into visualization format
		if (diff.nodesToAdd.length > 0) {
			patch.addNodes = diff.nodesToAdd.map(node => ({
				id: node.id,
				name: node.name,
				type: node.label,
				val: node.label === 'DIRECTORY' ? 3 : 2
			}));
		}

		// Nodes to remove (just IDs)
		if (diff.nodesToRemove.length > 0) {
			patch.removeNodes = diff.nodesToRemove;
		}

		// Transform nodes to update
		if (diff.nodesToUpdate.length > 0) {
			patch.updateNodes = diff.nodesToUpdate.map(node => ({
				id: node.id,
				name: node.name,
				type: node.label,
				val: node.label === 'DIRECTORY' ? 3 : 2
			}));
		}

		// Transform edges to add
		if (diff.edgesToAdd.length > 0) {
			patch.addLinks = diff.edgesToAdd.map(edge => ({
				source: edge.source,
				target: edge.target
			}));
		}

		// Transform edges to update
		if (diff.edgesToUpdate.length > 0) {
			patch.updateLinks = diff.edgesToUpdate.map(edge => ({
				source: edge.source,
				target: edge.target,
				type: edge.type
			}));
		}

		// Transform edges to remove
		if (diff.edgesToRemove.length > 0) {
			patch.removeLinks = diff.edgesToRemove.map(edge => ({
				source: edge.source,
				target: edge.target
			}));
		}

		return patch;
	}

	/**
	 * Check if a diff contains any changes
	 */
	public hasChanges(diff: GraphDiff): boolean {
		return diff.nodesToAdd.length > 0 ||
		       diff.nodesToUpdate.length > 0 ||
		       diff.nodesToRemove.length > 0 ||
		       diff.edgesToAdd.length > 0 ||
		       diff.edgesToUpdate.length > 0 ||
		       diff.edgesToRemove.length > 0;
	}
}
