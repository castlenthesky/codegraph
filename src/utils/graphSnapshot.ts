import type { GraphNode, GraphEdge } from '../types/nodes';

/**
 * Produces a compact diagnostic snapshot of graph state for logging.
 */
export function snapshotGraph(nodes: GraphNode[], edges: GraphEdge[]): object {
    const typeCounts: Record<string, number> = {};
    for (const n of nodes) {
        typeCounts[n.label] = (typeCounts[n.label] || 0) + 1;
    }

    const edgeTypeCounts: Record<string, number> = {};
    for (const e of edges) {
        edgeTypeCounts[e.type] = (edgeTypeCounts[e.type] || 0) + 1;
    }

    return {
        totalNodes: nodes.length,
        totalEdges: edges.length,
        nodesByType: typeCounts,
        edgesByType: edgeTypeCounts,
    };
}
