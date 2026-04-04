import type { GraphNode, GraphEdge } from '../../types/nodes';

function cpgNodeVal(label: string): number {
	switch (label) {
		case 'METHOD': return 4;
		case 'TYPE_DECL': return 3;
		case 'DIRECTORY': return 3;
		case 'CALL': return 2;
		case 'CONTROL_STRUCTURE': return 2;
		case 'IDENTIFIER': return 1.5;
		case 'LITERAL': return 1.5;
		case 'BLOCK': return 1;
		default: return 2;
	}
}

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
	addLinks?: Array<{ source: string; target: string; type?: string }>;
	updateLinks?: Array<{ source: string; target: string; type?: string }>;
	removeLinks?: Array<{ source: string; target: string; type?: string }>;
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

		if (oldNode.label === 'FILE' && newNode.label === 'FILE' && 'size' in oldNode && 'size' in newNode) {
			if (oldNode.size !== newNode.size) { return true; }
			if (oldNode.modifiedAt !== newNode.modifiedAt) { return true; }
		}

		if (oldNode.label === 'DIRECTORY' && newNode.label === 'DIRECTORY') {
			if (oldNode.modifiedAt !== newNode.modifiedAt) { return true; }
		}

		// For CPG nodes, compare by lineNumber + code snippet
		if (oldNode.label === newNode.label && 'lineNumber' in oldNode && 'lineNumber' in newNode) {
			if ((oldNode as any).lineNumber !== (newNode as any).lineNumber) { return true; }
			if ((oldNode as any).code !== (newNode as any).code) { return true; }
		}

		return false;
	}

	public createIncrementalPatch(diff: GraphDiff): IncrementalPatch {
		const patch: IncrementalPatch = {};

		if (diff.nodesToAdd.length > 0) {
			patch.addNodes = diff.nodesToAdd.map(node => ({
				id: node.id,
				name: node.name ?? node.id,
				type: node.label,
				val: cpgNodeVal(node.label)
			}));
		}

		if (diff.nodesToRemove.length > 0) {
			patch.removeNodes = diff.nodesToRemove;
		}

		if (diff.nodesToUpdate.length > 0) {
			patch.updateNodes = diff.nodesToUpdate.map(node => ({
				id: node.id,
				name: node.name ?? node.id,
				type: node.label,
				val: cpgNodeVal(node.label)
			}));
		}

		if (diff.edgesToAdd.length > 0) {
			patch.addLinks = diff.edgesToAdd.map(edge => ({
				source: edge.source,
				target: edge.target,
				type: edge.type
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
				target: edge.target,
				type: edge.type
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
