import type { GraphNode, GraphEdge } from '../../types/nodes';

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
 * Computes differences between graph states and produces incremental patches
 * for efficient webview updates.
 */
export class DiffEngine {
	public computeDiff(oldGraph: GraphData, newGraph: GraphData): GraphDiff {
		const diff: GraphDiff = {
			nodesToAdd: [],
			nodesToUpdate: [],
			nodesToRemove: [],
			edgesToAdd: [],
			edgesToUpdate: [],
			edgesToRemove: []
		};

		const oldNodesMap = new Map(oldGraph.nodes.map(n => [n.id, n]));
		const newNodesMap = new Map(newGraph.nodes.map(n => [n.id, n]));

		for (const newNode of newGraph.nodes) {
			const oldNode = oldNodesMap.get(newNode.id);
			if (!oldNode) {
				diff.nodesToAdd.push(newNode);
			} else if (this.hasNodeChanged(oldNode, newNode)) {
				diff.nodesToUpdate.push(newNode);
			}
		}

		for (const oldNode of oldGraph.nodes) {
			if (!newNodesMap.has(oldNode.id)) {
				diff.nodesToRemove.push(oldNode.id);
			}
		}

		const createEdgeKey = (edge: GraphEdge) => `${edge.source}|${edge.target}|${edge.type}`;
		const oldEdgesSet = new Set(oldGraph.edges.map(createEdgeKey));
		const newEdgesSet = new Set(newGraph.edges.map(createEdgeKey));
		const oldEdgesMap = new Map(oldGraph.edges.map(e => [createEdgeKey(e), e]));
		const newEdgesMap = new Map(newGraph.edges.map(e => [createEdgeKey(e), e]));

		for (const [key, edge] of newEdgesMap) {
			if (!oldEdgesSet.has(key)) {
				diff.edgesToAdd.push(edge);
			}
		}

		for (const [key, edge] of oldEdgesMap) {
			if (!newEdgesSet.has(key)) {
				diff.edgesToRemove.push(edge);
			}
		}

		return diff;
	}

	private hasNodeChanged(oldNode: GraphNode, newNode: GraphNode): boolean {
		if (oldNode.label !== newNode.label) { return true; }
		if (oldNode.name !== newNode.name) { return true; }

		if (oldNode.label === 'FILE' && newNode.label === 'FILE') {
			if (oldNode.size !== newNode.size) { return true; }
			if (oldNode.modifiedAt !== newNode.modifiedAt) { return true; }
		}

		if (oldNode.label === 'DIRECTORY' && newNode.label === 'DIRECTORY') {
			if (oldNode.modifiedAt !== newNode.modifiedAt) { return true; }
		}

		return false;
	}

	public createIncrementalPatch(diff: GraphDiff): IncrementalPatch {
		const patch: IncrementalPatch = {};

		if (diff.nodesToAdd.length > 0) {
			patch.addNodes = diff.nodesToAdd.map(node => ({
				id: node.id,
				name: node.name,
				type: node.label,
				val: node.label === 'DIRECTORY' ? 3 : 2
			}));
		}

		if (diff.nodesToRemove.length > 0) {
			patch.removeNodes = diff.nodesToRemove;
		}

		if (diff.nodesToUpdate.length > 0) {
			patch.updateNodes = diff.nodesToUpdate.map(node => ({
				id: node.id,
				name: node.name,
				type: node.label,
				val: node.label === 'DIRECTORY' ? 3 : 2
			}));
		}

		if (diff.edgesToAdd.length > 0) {
			patch.addLinks = diff.edgesToAdd.map(edge => ({
				source: edge.source,
				target: edge.target
			}));
		}

		if (diff.edgesToUpdate.length > 0) {
			patch.updateLinks = diff.edgesToUpdate.map(edge => ({
				source: edge.source,
				target: edge.target,
				type: edge.type
			}));
		}

		if (diff.edgesToRemove.length > 0) {
			patch.removeLinks = diff.edgesToRemove.map(edge => ({
				source: edge.source,
				target: edge.target
			}));
		}

		return patch;
	}

	public hasChanges(diff: GraphDiff): boolean {
		return diff.nodesToAdd.length > 0 ||
			diff.nodesToUpdate.length > 0 ||
			diff.nodesToRemove.length > 0 ||
			diff.edgesToAdd.length > 0 ||
			diff.edgesToUpdate.length > 0 ||
			diff.edgesToRemove.length > 0;
	}
}
