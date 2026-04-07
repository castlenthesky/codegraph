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
			const visited = new Set<string>();
			this.collectIdentifierUses(methodId, def.name, nodeMap, astChildren, astParent, def.id, uses, visited);

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
		// For each CONTROL_STRUCTURE node, emit CDG edges to direct statement children
		// (not the condition), and also to all descendants inside BLOCK children
		// (stopping at METHOD and nested CONTROL_STRUCTURE boundaries).
		const BODY_LABELS = new Set<string>([
			'BLOCK', 'RETURN', 'LOCAL', 'METHOD_PARAMETER_IN',
			'CALL', 'FIELD_IDENTIFIER', 'JUMP_TARGET'
		]);

		const controlStructures = nodes.filter(n => n.label === 'CONTROL_STRUCTURE');

		for (const cs of controlStructures) {
			const children = astChildren.get(cs.id) || [];
			for (const childId of children) {
				const child = nodeMap.get(childId);
				if (!child) {
					console.warn(`[PdgBuilder] CDG: child node ${childId} not found in nodeMap`);
					continue;
				}
				// Only emit CDG to body/statement children, not condition expressions
				if (!BODY_LABELS.has(child.label)) { continue; }
				pdgEdges.push({ source: cs.id, target: childId, type: 'CDG' });

				// FIX-1: For BLOCK children, recursively emit CDG to all descendant statements,
				// stopping at METHOD and nested CONTROL_STRUCTURE boundaries.
				if (child.label === 'BLOCK') {
					this.collectBlockDescendants(childId, cs.id, nodeMap, astChildren, pdgEdges);
				}
			}
		}

		return pdgEdges;
	}

	/**
	 * Recursively emit CDG edges from `csId` (the controlling CONTROL_STRUCTURE) to all
	 * descendant statement-level nodes inside a BLOCK, stopping at METHOD and nested
	 * CONTROL_STRUCTURE boundaries (they will generate their own CDG edges).
	 */
	private collectBlockDescendants(
		blockId: string,
		csId: string,
		nodeMap: Map<string, CpgNode>,
		astChildren: Map<string, string[]>,
		pdgEdges: CpgEdge[]
	): void {
		const children = astChildren.get(blockId) || [];
		for (const childId of children) {
			const child = nodeMap.get(childId);
			if (!child) { continue; }
			// Stop at function boundaries
			if (child.label === 'METHOD') { continue; }
			// Stop at nested control structures (they handle their own CDG)
			if (child.label === 'CONTROL_STRUCTURE') { continue; }
			pdgEdges.push({ source: csId, target: childId, type: 'CDG' });
			// Recurse into nested blocks (e.g., nested BLOCKs that aren't under a CS)
			if (child.label === 'BLOCK') {
				this.collectBlockDescendants(childId, csId, nodeMap, astChildren, pdgEdges);
			}
		}
	}

	private findMethodAncestor(
		nodeId: string,
		astParent: Map<string, string>,
		nodeMap: Map<string, CpgNode>
	): string | null {
		const visited = new Set<string>(); // FIX-3: guard against cycles
		let current = astParent.get(nodeId);
		while (current) {
			if (visited.has(current)) { break; } // FIX-3: cycle detected
			visited.add(current);
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
		astParent: Map<string, string>,
		defId: string,
		result: CpgNode[],
		visited: Set<string> // FIX-3: guard against cycles
	): void {
		if (visited.has(rootId)) { return; } // FIX-3: cycle guard
		visited.add(rootId);

		const children = astChildren.get(rootId) || [];
		for (const childId of children) {
			const child = nodeMap.get(childId);
			if (!child) { continue; }
			// Don't recurse into nested methods
			if (child.label === 'METHOD') { continue; }
			if (child.label === 'IDENTIFIER' && child.name === name && childId !== defId) {
				// FIX-4: skip re-definition sites (IDENTIFIER whose parent is a LOCAL node)
				const parentId = astParent.get(childId);
				const parentNode = parentId ? nodeMap.get(parentId) : undefined;
				if (parentNode?.label === 'LOCAL') { continue; }
				result.push(child);
			}
			this.collectIdentifierUses(childId, name, nodeMap, astChildren, astParent, defId, result, visited);
		}
	}
}
