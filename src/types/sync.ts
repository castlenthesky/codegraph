/**
 * Interfaces for graph synchronization and reconciliation.
 */

import type { GraphNode, GraphEdge } from './nodes';

export interface IReconciler {
	loadGraphFromDatabase(): Promise<void>;
	reconcileInBackground(): Promise<void>;
	startPeriodicReconciliation(): void;
	dispose(): void;
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
