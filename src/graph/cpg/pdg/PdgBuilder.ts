import type { CpgNode, CpgEdge } from '../../../types/cpg';

export class PdgBuilder {
	/**
	 * Build PDG edges (REACHING_DEF + CDG) from the combined UAST+CFG result.
	 * Returns additional CpgEdge[].
	 */
	build(nodes: CpgNode[], edges: CpgEdge[]): CpgEdge[] {
		const pdgEdges: CpgEdge[] = [];

		// Build AST parent map: childId -> parentId
		const astParent = new Map<string, string>();
		for (const edge of edges) {
			if (edge.type === 'AST') {
				astParent.set(edge.target, edge.source);
			}
		}

		// Build AST children map: parentId -> childId[]
		const astChildren = new Map<string, string[]>();
		for (const edge of edges) {
			if (edge.type === 'AST') {
				if (!astChildren.has(edge.source)) { astChildren.set(edge.source, []); }
				astChildren.get(edge.source)!.push(edge.target);
			}
		}

		const nodeMap = new Map<string, CpgNode>(nodes.map(n => [n.id, n]));

		// --- REACHING_DEF edges ---
		// For each LOCAL or METHOD_PARAMETER_IN node (definitions), find all IDENTIFIER
		// nodes in the same method scope with the same name, and create REACHING_DEF edges.
		const definitions = nodes.filter(n =>
			n.label === 'LOCAL' || n.label === 'METHOD_PARAMETER_IN'
		);

		for (const def of definitions) {
			if (!def.name) { continue; }

			// Find the METHOD ancestor of this definition
			const methodId = this.findMethodAncestor(def.id, astParent, nodeMap);
			if (!methodId) { continue; }

			// Collect all IDENTIFIER nodes in this method's subtree with the same name
			const uses: CpgNode[] = [];
			this.collectIdentifierUses(methodId, def.name, nodeMap, astChildren, def.id, uses);

			for (const use of uses) {
				pdgEdges.push({
					source: def.id,
					target: use.id,
					type: 'REACHING_DEF',
					variable: def.name
				});
			}
		}

		// --- CDG edges ---
		// For each CONTROL_STRUCTURE node, find all direct AST children that are
		// statements/expressions (not the condition itself) and create CDG edges.
		const controlStructures = nodes.filter(n => n.label === 'CONTROL_STRUCTURE');

		for (const cs of controlStructures) {
			const children = astChildren.get(cs.id) || [];
			for (const childId of children) {
				const child = nodeMap.get(childId);
				if (!child) { continue; }
				// Skip IDENTIFIER/LITERAL nodes that are just the condition expression
				if (child.label === 'IDENTIFIER' || child.label === 'LITERAL') { continue; }
				pdgEdges.push({ source: cs.id, target: childId, type: 'CDG' });
			}
		}

		return pdgEdges;
	}

	private findMethodAncestor(
		nodeId: string,
		astParent: Map<string, string>,
		nodeMap: Map<string, CpgNode>
	): string | null {
		let current = astParent.get(nodeId);
		while (current) {
			const node = nodeMap.get(current);
			if (node?.label === 'METHOD') { return current; }
			current = astParent.get(current);
		}
		return null;
	}

	private collectIdentifierUses(
		rootId: string,
		name: string,
		nodeMap: Map<string, CpgNode>,
		astChildren: Map<string, string[]>,
		defId: string,
		result: CpgNode[]
	): void {
		const children = astChildren.get(rootId) || [];
		for (const childId of children) {
			const child = nodeMap.get(childId);
			if (!child) { continue; }
			// Don't recurse into nested methods
			if (child.label === 'METHOD') { continue; }
			if (child.label === 'IDENTIFIER' && child.name === name && childId !== defId) {
				result.push(child);
			}
			this.collectIdentifierUses(childId, name, nodeMap, astChildren, defId, result);
		}
	}
}
