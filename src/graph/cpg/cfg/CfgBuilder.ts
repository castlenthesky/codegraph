import type { CpgNode, CpgEdge, UastBuildResult } from '../../../types/cpg';

// Node labels that participate in control flow
const CFG_NODE_LABELS = new Set([
	'CALL', 'RETURN', 'CONTROL_STRUCTURE', 'IDENTIFIER',
	'LITERAL', 'BLOCK', 'LOCAL'
]);

/**
 * Represents the exits from a CFG sub-graph — the set of node IDs
 * whose outgoing CFG edge has not yet been connected.
 */
type CfgExits = string[];

export class CfgBuilder {
	/**
	 * Build CFG edges from UAST nodes + AST edges.
	 * Returns cfgEdges, plus synthetic newNodes and newEdges that should be
	 * merged into the graph by the caller (does NOT mutate uastResult).
	 */
	build(uastResult: UastBuildResult): { cfgEdges: CpgEdge[]; newNodes: CpgNode[]; newEdges: CpgEdge[] } {
		const cfgEdges: CpgEdge[] = [];
		const newNodes: CpgNode[] = [];
		const newEdges: CpgEdge[] = [];
		const { nodes, edges } = uastResult;

		// Build lookup structures
		const nodeMap = new Map<string, CpgNode>(nodes.map(n => [n.id, n]));

		// Build AST adjacency: parentId -> [childId in ORDER order]
		const astChildren = new Map<string, string[]>();
		for (const edge of edges) {
			if (edge.type !== 'AST') { continue; }
			if (!astChildren.has(edge.source)) { astChildren.set(edge.source, []); }
			astChildren.get(edge.source)!.push(edge.target);
		}

		// Sort children by ORDER property
		for (const [, children] of astChildren) {
			children.sort((a, b) => {
				const nodeA = nodeMap.get(a);
				const nodeB = nodeMap.get(b);
				return (nodeA?.order ?? 0) - (nodeB?.order ?? 0);
			});
		}

		// Find all METHOD nodes — each gets its own CFG
		const methodNodes = nodes.filter(n => n.label === 'METHOD');

		for (const method of methodNodes) {
			this.buildMethodCfg(method, nodeMap, astChildren, cfgEdges, newNodes, newEdges);
		}

		return { cfgEdges, newNodes, newEdges };
	}

	private buildMethodCfg(
		method: CpgNode,
		nodeMap: Map<string, CpgNode>,
		astChildren: Map<string, string[]>,
		cfgEdges: CpgEdge[],
		newNodes: CpgNode[],
		newEdges: CpgEdge[]
	): void {
		// Synthesize a METHOD_RETURN node for this method
		const methodReturnId = `${method.id}:METHOD_RETURN`;
		const methodReturnNode: CpgNode = {
			id: methodReturnId,
			label: 'METHOD_RETURN',
			name: '<return>',
			filename: method.filename,
			lineNumber: method.lineNumber,
			order: 9999,
		};
		newNodes.push(methodReturnNode);
		nodeMap.set(methodReturnId, methodReturnNode);
		// AST edge from METHOD to METHOD_RETURN
		newEdges.push({ source: method.id, target: methodReturnId, type: 'AST' });

		// Get method body children (the direct AST children of the method)
		const bodyChildren = astChildren.get(method.id) || [];
		// Find the BLOCK child (statement_block) which contains the method body
		const blockChild = bodyChildren.find(id => nodeMap.get(id)?.label === 'BLOCK');
		const stmtIds = blockChild
			? (astChildren.get(blockChild) || [])
			: bodyChildren.filter(id => {
				const n = nodeMap.get(id);
				return n && n.label !== 'METHOD_PARAMETER_IN' && n.label !== 'METHOD_RETURN';
			});

		if (stmtIds.length === 0) {
			// Empty method: METHOD -> METHOD_RETURN
			cfgEdges.push({ source: method.id, target: methodReturnId, type: 'CFG' });
			return;
		}

		// Process statements sequentially; thread CFG exits through
		let currentExits: CfgExits = [method.id];

		for (const stmtId of stmtIds) {
			const exits = this.processNode(
				stmtId, nodeMap, astChildren, cfgEdges, currentExits, methodReturnId
			);
			currentExits = exits;
		}

		// Any remaining exits flow to METHOD_RETURN
		for (const exitId of currentExits) {
			cfgEdges.push({ source: exitId, target: methodReturnId, type: 'CFG' });
		}
	}

	/**
	 * Process a single AST node for CFG construction.
	 * Connects all `entries` to this node, then returns the exit node IDs.
	 */
	private processNode(
		nodeId: string,
		nodeMap: Map<string, CpgNode>,
		astChildren: Map<string, string[]>,
		cfgEdges: CpgEdge[],
		entries: CfgExits,
		methodReturnId: string
	): CfgExits {
		const node = nodeMap.get(nodeId);
		if (!node) {
			console.warn(`[CfgBuilder] Node not found in map: ${nodeId}`);
			return entries;
		}

		// Skip nested methods — they have their own CFG
		if (node.label === 'METHOD') { return entries; }

		if (node.label === 'CONTROL_STRUCTURE') {
			return this.processControlStructure(
				node, nodeMap, astChildren, cfgEdges, entries, methodReturnId
			);
		}

		if (node.label === 'RETURN') {
			return this.processReturn(
				node, nodeMap, astChildren, cfgEdges, entries, methodReturnId
			);
		}

		if (node.label === 'BLOCK') {
			return this.processBlock(
				nodeId, nodeMap, astChildren, cfgEdges, entries, methodReturnId
			);
		}

		if (CFG_NODE_LABELS.has(node.label)) {
			// Simple CFG node: connect entries -> this node, exit is this node
			for (const entryId of entries) {
				cfgEdges.push({ source: entryId, target: nodeId, type: 'CFG' });
			}
			return [nodeId];
		}

		// Non-CFG node: recurse into children, threading exits through
		const children = astChildren.get(nodeId) || [];
		let currentExits = entries;
		for (const childId of children) {
			const child = nodeMap.get(childId);
			if (!child || child.label === 'METHOD') { continue; }
			currentExits = this.processNode(
				childId, nodeMap, astChildren, cfgEdges, currentExits, methodReturnId
			);
		}
		return currentExits;
	}

	private processReturn(
		node: CpgNode,
		nodeMap: Map<string, CpgNode>,
		astChildren: Map<string, string[]>,
		cfgEdges: CpgEdge[],
		entries: CfgExits,
		methodReturnId: string
	): CfgExits {
		// Connect entries to the RETURN node
		for (const entryId of entries) {
			cfgEdges.push({ source: entryId, target: node.id, type: 'CFG' });
		}
		// RETURN flows to METHOD_RETURN only if it is reachable
		if (entries.length > 0) {
			cfgEdges.push({ source: node.id, target: methodReturnId, type: 'CFG' });
		}
		// No exits — code after return is unreachable
		return [];
	}

	private processBlock(
		blockId: string,
		nodeMap: Map<string, CpgNode>,
		astChildren: Map<string, string[]>,
		cfgEdges: CpgEdge[],
		entries: CfgExits,
		methodReturnId: string
	): CfgExits {
		const children = astChildren.get(blockId) || [];
		let currentExits = entries;
		for (const childId of children) {
			const child = nodeMap.get(childId);
			if (!child || child.label === 'METHOD') { continue; }
			currentExits = this.processNode(
				childId, nodeMap, astChildren, cfgEdges, currentExits, methodReturnId
			);
		}
		return currentExits;
	}

	private processControlStructure(
		node: CpgNode,
		nodeMap: Map<string, CpgNode>,
		astChildren: Map<string, string[]>,
		cfgEdges: CpgEdge[],
		entries: CfgExits,
		methodReturnId: string
	): CfgExits {
		const structureType = node.controlStructureType ?? (node.code ?? '');
		const children = astChildren.get(node.id) || [];

		// Connect entries to the CONTROL_STRUCTURE node itself
		for (const entryId of entries) {
			cfgEdges.push({ source: entryId, target: node.id, type: 'CFG' });
		}

		if (structureType.startsWith('if') || structureType === 'IF') {
			return this.processIf(node, children, nodeMap, astChildren, cfgEdges, methodReturnId);
		} else if (structureType.startsWith('while') || structureType.startsWith('for') || structureType === 'WHILE' || structureType === 'FOR') {
			return this.processLoop(node, children, nodeMap, astChildren, cfgEdges, methodReturnId);
		} else if (structureType.startsWith('do') || structureType === 'DO') {
			return this.processDoWhile(node, children, nodeMap, astChildren, cfgEdges, methodReturnId);
		} else if (structureType.startsWith('switch') || structureType === 'SWITCH') {
			return this.processSwitch(node, children, nodeMap, astChildren, cfgEdges, methodReturnId);
		} else if (structureType.startsWith('try') || structureType === 'TRY') {
			return this.processTry(node, children, nodeMap, astChildren, cfgEdges, methodReturnId);
		}

		console.warn(`[CfgBuilder] Unrecognized control structure type: '${structureType}', falling through to sequential`);
		// Fallback: treat as sequential through children
		let currentExits: CfgExits = [node.id];
		for (const childId of children) {
			const child = nodeMap.get(childId);
			if (!child || child.label === 'METHOD') { continue; }
			currentExits = this.processNode(
				childId, nodeMap, astChildren, cfgEdges, currentExits, methodReturnId
			);
		}
		return currentExits;
	}

	private processIf(
		node: CpgNode,
		children: string[],
		nodeMap: Map<string, CpgNode>,
		astChildren: Map<string, string[]>,
		cfgEdges: CpgEdge[],
		methodReturnId: string
	): CfgExits {
		// if_statement children: condition expressions, consequent BLOCK, optional alternate BLOCK/CONTROL_STRUCTURE
		// Find the condition (first CFG-eligible child that isn't a BLOCK or CONTROL_STRUCTURE)
		const conditionIds: string[] = [];
		const branchIds: string[] = [];

		for (const childId of children) {
			const child = nodeMap.get(childId);
			if (!child) { continue; }
			if (child.label === 'BLOCK' || child.label === 'CONTROL_STRUCTURE') {
				branchIds.push(childId);
			} else {
				conditionIds.push(childId);
			}
		}

		// Process condition from the CONTROL_STRUCTURE node
		let conditionExits: CfgExits = [node.id];
		for (const condId of conditionIds) {
			conditionExits = this.processNode(
				condId, nodeMap, astChildren, cfgEdges, conditionExits, methodReturnId
			);
		}

		// Process each branch (consequent and alternate)
		const allExits: CfgExits = [];
		for (const branchId of branchIds) {
			const branchExits = this.processNode(
				branchId, nodeMap, astChildren, cfgEdges, conditionExits, methodReturnId
			);
			allExits.push(...branchExits);
		}

		// If there's no else branch, the condition itself can fall through
		if (branchIds.length < 2) {
			allExits.push(...conditionExits);
		}

		return allExits;
	}

	private processLoop(
		node: CpgNode,
		children: string[],
		nodeMap: Map<string, CpgNode>,
		astChildren: Map<string, string[]>,
		cfgEdges: CpgEdge[],
		methodReturnId: string
	): CfgExits {
		// while/for: condition -> body -> back-edge to condition node
		// The CONTROL_STRUCTURE node represents the loop header (condition check)
		const bodyIds: string[] = [];
		const conditionIds: string[] = [];

		for (const childId of children) {
			const child = nodeMap.get(childId);
			if (!child) { continue; }
			if (child.label === 'BLOCK') {
				bodyIds.push(childId);
			} else {
				conditionIds.push(childId);
			}
		}

		// Process condition children from the loop header
		let conditionExits: CfgExits = [node.id];
		for (const condId of conditionIds) {
			conditionExits = this.processNode(
				condId, nodeMap, astChildren, cfgEdges, conditionExits, methodReturnId
			);
		}

		// Process body
		let bodyExits: CfgExits = conditionExits;
		for (const bodyId of bodyIds) {
			bodyExits = this.processNode(
				bodyId, nodeMap, astChildren, cfgEdges, bodyExits, methodReturnId
			);
		}

		// Back-edge: body exits loop back to the CONTROL_STRUCTURE (loop header)
		for (const exitId of bodyExits) {
			cfgEdges.push({ source: exitId, target: node.id, type: 'CFG' });
		}

		// Loop can also be skipped (condition false) — condition exits fall through
		return conditionExits;
	}

	private processDoWhile(
		node: CpgNode,
		children: string[],
		nodeMap: Map<string, CpgNode>,
		astChildren: Map<string, string[]>,
		cfgEdges: CpgEdge[],
		methodReturnId: string
	): CfgExits {
		// do-while: body executes first, then condition, back-edge to body
		const bodyIds: string[] = [];
		const conditionIds: string[] = [];

		for (const childId of children) {
			const child = nodeMap.get(childId);
			if (!child) { continue; }
			if (child.label === 'BLOCK') {
				bodyIds.push(childId);
			} else {
				conditionIds.push(childId);
			}
		}

		// Process body first (always executes once)
		let bodyExits: CfgExits = [node.id];
		for (const bodyId of bodyIds) {
			bodyExits = this.processNode(
				bodyId, nodeMap, astChildren, cfgEdges, bodyExits, methodReturnId
			);
		}

		// Process condition
		let conditionExits = bodyExits;
		for (const condId of conditionIds) {
			conditionExits = this.processNode(
				condId, nodeMap, astChildren, cfgEdges, conditionExits, methodReturnId
			);
		}

		// Back-edge: condition true -> back to CONTROL_STRUCTURE node
		for (const exitId of conditionExits) {
			cfgEdges.push({ source: exitId, target: node.id, type: 'CFG' });
		}

		// Condition false -> exits the loop
		return conditionExits;
	}

	private processSwitch(
		node: CpgNode,
		children: string[],
		nodeMap: Map<string, CpgNode>,
		astChildren: Map<string, string[]>,
		cfgEdges: CpgEdge[],
		methodReturnId: string
	): CfgExits {
		// switch: process each case/default block as a branch from the switch node
		const allExits: CfgExits = [];
		let hasDefault = false;

		for (const childId of children) {
			const child = nodeMap.get(childId);
			if (!child) { continue; }
			const branchExits = this.processNode(
				childId, nodeMap, astChildren, cfgEdges, [node.id], methodReturnId
			);
			allExits.push(...branchExits);
			if (
				child.code?.startsWith('default') ||
				child.code?.includes('default') ||
				child.controlStructureType === 'DEFAULT'
			) {
				hasDefault = true;
			}
		}

		// If no default case, the switch itself can fall through
		if (!hasDefault) {
			allExits.push(node.id);
		}

		return allExits;
	}

	private processTry(
		node: CpgNode,
		children: string[],
		nodeMap: Map<string, CpgNode>,
		astChildren: Map<string, string[]>,
		cfgEdges: CpgEdge[],
		methodReturnId: string
	): CfgExits {
		// try: process all children (try block, catch block, finally block) sequentially
		// Simplified: treat try body exits + catch body exits as all merging
		const allExits: CfgExits = [];
		for (const childId of children) {
			const child = nodeMap.get(childId);
			if (!child || child.label === 'METHOD') { continue; }
			const branchExits = this.processNode(
				childId, nodeMap, astChildren, cfgEdges, [node.id], methodReturnId
			);
			allExits.push(...branchExits);
		}
		return allExits.length > 0 ? allExits : [node.id];
	}
}
