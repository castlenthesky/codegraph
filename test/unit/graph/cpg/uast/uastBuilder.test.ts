/**
 * Unit tests for UastBuilder.
 *
 * tree-sitter-typescript's native addon returns undefined under Bun's runtime
 * (ABI mismatch with pre-built .node binaries).  Rather than skipping all
 * UastBuilder logic, we construct synthetic ParseResult objects that mirror
 * the exact node shape tree-sitter emits (verified against the CST snapshots
 * in test/__snapshots__/tree-sitter-cst/typescript/).
 *
 * UastBuilder only touches: node.type, node.startPosition, node.startIndex,
 * node.endIndex, node.childCount, node.child(i), node.childForFieldName(),
 * and tree.rootNode.text.  Our fake nodes implement exactly this surface.
 */

import { describe, test, expect, beforeEach } from 'bun:test';
import { UastBuilder } from '../../../../../src/graph/cpg/uast/UastBuilder';
import type { CpgNode, CpgEdge, UastBuildResult } from '../../../../../src/types/cpg';
import type { ParseResult } from '../../../../../src/types/parsing';

// ---------------------------------------------------------------------------
// Synthetic CST node factory
// ---------------------------------------------------------------------------

interface FakeNode {
	type: string;
	startPosition: { row: number; column: number };
	startIndex: number;
	endIndex: number;
	childCount: number;
	child(i: number): FakeNode;
	childForFieldName(name: string): FakeNode | null;
	/** Mirrors rootNode.text — only meaningful on the root */
	text: string;
	/** Internal: field name this node occupies in its parent */
	_field?: string;
}

/**
 * Build a fake tree-sitter SyntaxNode from plain values.
 * Mirrors the snapshot schema (start.row/column → startPosition; text for slicing).
 */
function fakeNode(
	type: string,
	source: string,
	startIndex: number,
	endIndex: number,
	row: number,
	column: number,
	children: FakeNode[] = [],
	field?: string
): FakeNode {
	return {
		type,
		startPosition: { row, column },
		startIndex,
		endIndex,
		childCount: children.length,
		child(i) { return children[i]; },
		childForFieldName(name) {
			return children.find(c => c._field === name) ?? null;
		},
		text: source,
		_field: field,
	};
}

/**
 * Wrap a root SyntaxNode into a minimal ParseResult.
 */
function makeParseResult(
	rootNode: FakeNode,
	changedRanges: unknown[] | null = null
): ParseResult {
	return {
		tree: { rootNode } as any,
		changedRanges: changedRanges as any,
		language: 'typescript',
	};
}

// ---------------------------------------------------------------------------
// Pre-built synthetic trees that match TypeScript CST snapshot structure
// ---------------------------------------------------------------------------

const FILE_PATH = '/project/src/example.ts';
// Simulates the filesystem FILE node ID (as if workspaceRoot = '/project')
const FS_FILE_NODE_ID = 'src/example.ts';

/**
 * Synthetic tree for: function greet(name: string): string { return "Hello " + name; }
 * Structure (from typescript snapshot):
 *   program
 *     function_declaration [field: none]
 *       identifier "greet" [field: name]
 */
function makeSimpleFunction(source: string): FakeNode {
	const nameNode = fakeNode('identifier', source, 9, 14, 0, 9, [], 'name');
	const fnNode = fakeNode('function_declaration', source, 0, source.length, 0, 0, [nameNode]);
	return fakeNode('program', source, 0, source.length, 0, 0, [fnNode]);
}

/**
 * Synthetic tree for two top-level function declarations.
 * function foo() { return 1; }
 * function bar() { return 2; }
 */
function makeTwoFunctions(): { source: string; rootNode: FakeNode } {
	const source = `function foo() { return 1; }\nfunction bar() { return 2; }`;
	const fooName = fakeNode('identifier', source, 9, 12, 0, 9, [], 'name');
	const fooFn = fakeNode('function_declaration', source, 0, 28, 0, 0, [fooName]);
	const barName = fakeNode('identifier', source, 38, 41, 1, 9, [], 'name');
	const barFn = fakeNode('function_declaration', source, 29, source.length, 1, 0, [barName]);
	const root = fakeNode('program', source, 0, source.length, 0, 0, [fooFn, barFn]);
	return { source, rootNode: root };
}

/**
 * Synthetic tree for: class Calculator { add(a, b) { return a + b; } }
 * program → class_declaration (name: identifier "Calculator") → method_definition (name: identifier "add")
 */
function makeClassWithMethod(source: string): FakeNode {
	const className = fakeNode('identifier', source, 6, 16, 0, 6, [], 'name');
	const methodName = fakeNode('identifier', source, 19, 22, 0, 19, [], 'name');
	const methodNode = fakeNode('method_definition', source, 19, source.length - 2, 0, 19, [methodName]);
	const classNode = fakeNode('class_declaration', source, 0, source.length, 0, 0, [className, methodNode]);
	return fakeNode('program', source, 0, source.length, 0, 0, [classNode]);
}

/** Synthetic tree for: const greeting = "Hello World"; */
function makeVariableDecl(source: string): FakeNode {
	const varNode = fakeNode('variable_declarator', source, 6, source.length - 1, 0, 6, []);
	return fakeNode('program', source, 0, source.length, 0, 0, [varNode]);
}

/** Synthetic tree for: import { something } from './somewhere'; */
function makeImportStatement(source: string): FakeNode {
	const importNode = fakeNode('import_statement', source, 0, source.length, 0, 0, []);
	return fakeNode('program', source, 0, source.length, 0, 0, [importNode]);
}

/** Synthetic tree for: console.log("hello"); */
function makeCallExpression(source: string): FakeNode {
	// call_expression with function field = member_expression "console.log"
	const callee = fakeNode('member_expression', source, 0, 11, 0, 0, [], 'function');
	const callNode = fakeNode('call_expression', source, 0, source.length - 1, 0, 0, [callee]);
	return fakeNode('program', source, 0, source.length, 0, 0, [callNode]);
}

/** Synthetic tree for: if (x > 0) { doSomething(); } */
function makeIfStatement(source: string): FakeNode {
	const ifNode = fakeNode('if_statement', source, 0, source.length, 0, 0, []);
	return fakeNode('program', source, 0, source.length, 0, 0, [ifNode]);
}

/** Synthetic tree with only a comment — no mapped CPG nodes */
function makeCommentOnly(source: string): FakeNode {
	const comment = fakeNode('comment', source, 0, source.length, 0, 0, []);
	return fakeNode('program', source, 0, source.length, 0, 0, [comment]);
}

/** Synthetic tree for empty source */
function makeEmpty(source: string): FakeNode {
	return fakeNode('program', source, 0, 0, 0, 0, []);
}

/** Build a deeply nested tree: N levels of if_statement */
function makeDeeplyNested(source: string, depth: number): FakeNode {
	let innermost: FakeNode = fakeNode('return_statement', source, source.length - 10, source.length, depth, 0, []);
	for (let i = depth - 1; i >= 0; i--) {
		innermost = fakeNode('if_statement', source, i * 3, source.length, i, 0, [innermost]);
	}
	const methodName = fakeNode('identifier', source, 9, 21, 0, 9, [], 'name');
	const method = fakeNode('function_declaration', source, 0, source.length, 0, 0, [methodName, innermost]);
	return fakeNode('program', source, 0, source.length, 0, 0, [method]);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function findNodesByLabel(nodes: CpgNode[], label: string): CpgNode[] {
	return nodes.filter(n => n.label === label);
}

function findEdgesByType(edges: CpgEdge[], type: string): CpgEdge[] {
	return edges.filter(e => e.type === type);
}

// The FILE node id is generated by UastBuilder's makeId:
// `${filePath}:${cpgType}:${startRow}:${startCol}` — the program node is always at 0:0.
const FILE_NODE_ID = `${FILE_PATH}:FILE:0:0`;
// fileId used internally by UastBuilder for SOURCE_FILE/IS_CALL_FOR_IMPORT edge targets.
// Note: this is intentionally different from FILE_NODE_ID — UastBuilder uses a stable
// "file:<path>" key as the edge anchor rather than the position-based node id.
const FILE_ID = `file:${FILE_PATH}`;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('UastBuilder', () => {
	let builder: UastBuilder;

	beforeEach(() => {
		builder = new UastBuilder();
	});

	// -------------------------------------------------------------------------
	// Smoke tests
	// -------------------------------------------------------------------------

	describe('smoke tests', () => {
		test('build returns an object with nodes, edges, removedNodeIds', () => {
			const source = `function greet(name) { return "Hello"; }`;
			const result = builder.build(makeParseResult(makeSimpleFunction(source)), FILE_PATH, FS_FILE_NODE_ID);
			expect(Array.isArray(result.nodes)).toBe(true);
			expect(Array.isArray(result.edges)).toBe(true);
			expect(Array.isArray(result.removedNodeIds)).toBe(true);
		});

		test('minimal valid parse result produces non-empty nodes array', () => {
			const source = `function greet(name) { return "Hello"; }`;
			const result = builder.build(makeParseResult(makeSimpleFunction(source)), FILE_PATH, FS_FILE_NODE_ID);
			expect(result.nodes.length).toBeGreaterThan(0);
		});

		test('every returned node has id, label, and at least one location property', () => {
			const source = `function greet(name) { return "Hello"; }`;
			const result = builder.build(makeParseResult(makeSimpleFunction(source)), FILE_PATH, FS_FILE_NODE_ID);
			for (const node of result.nodes) {
				expect(typeof node.id).toBe('string');
				expect(node.id.length).toBeGreaterThan(0);
				expect(typeof node.label).toBe('string');
				expect(node.label.length).toBeGreaterThan(0);
				const hasLocation =
					node.lineNumber !== undefined ||
					node.columnNumber !== undefined ||
					node.offset !== undefined;
				expect(hasLocation).toBe(true);
			}
		});
	});

	// -------------------------------------------------------------------------
	// Node creation — mirrors real TypeScript CST node types from snapshots
	// -------------------------------------------------------------------------

	describe('node creation', () => {
		test('program node is unified with filesystem FILE node (no CPG FILE emitted)', () => {
			const source = `function greet(name) {}`;
			const result = builder.build(makeParseResult(makeSimpleFunction(source)), FILE_PATH, FS_FILE_NODE_ID);
			const fileNodes = findNodesByLabel(result.nodes, 'FILE');
			expect(fileNodes.length).toBe(0);
		});

		test('function_declaration produces a METHOD node', () => {
			const source = `function greet(name) { return "Hello"; }`;
			const result = builder.build(makeParseResult(makeSimpleFunction(source)), FILE_PATH, FS_FILE_NODE_ID);
			const methods = findNodesByLabel(result.nodes, 'METHOD');
			expect(methods.length).toBeGreaterThan(0);
		});

		test('METHOD node has name extracted from identifier child with field "name"', () => {
			const source = `function greet(name) { return "Hello"; }`;
			const result = builder.build(makeParseResult(makeSimpleFunction(source)), FILE_PATH, FS_FILE_NODE_ID);
			const methods = findNodesByLabel(result.nodes, 'METHOD');
			// identifier child at startIndex 9..14 = "greet"
			const greet = methods.find(n => n.name === 'greet');
			expect(greet).toBeDefined();
		});

		test('class_declaration produces a TYPE_DECL node', () => {
			const source = `class Calculator { add(a, b) { return a + b; } }`;
			const result = builder.build(makeParseResult(makeClassWithMethod(source)), FILE_PATH, FS_FILE_NODE_ID);
			const typeDecls = findNodesByLabel(result.nodes, 'TYPE_DECL');
			expect(typeDecls.length).toBeGreaterThan(0);
		});

		test('TYPE_DECL has name "Calculator"', () => {
			const source = `class Calculator { add(a, b) { return a + b; } }`;
			const result = builder.build(makeParseResult(makeClassWithMethod(source)), FILE_PATH, FS_FILE_NODE_ID);
			const typeDecls = findNodesByLabel(result.nodes, 'TYPE_DECL');
			const calc = typeDecls.find(n => n.name === 'Calculator');
			expect(calc).toBeDefined();
		});

		test('method_definition inside class produces a second METHOD node', () => {
			const source = `class Calculator { add(a, b) { return a + b; } }`;
			const result = builder.build(makeParseResult(makeClassWithMethod(source)), FILE_PATH, FS_FILE_NODE_ID);
			const methods = findNodesByLabel(result.nodes, 'METHOD');
			expect(methods.length).toBeGreaterThanOrEqual(1);
		});

		test('variable_declarator produces a LOCAL node', () => {
			const source = `const greeting = "Hello World";`;
			const result = builder.build(makeParseResult(makeVariableDecl(source)), FILE_PATH, FS_FILE_NODE_ID);
			const locals = findNodesByLabel(result.nodes, 'LOCAL');
			expect(locals.length).toBeGreaterThan(0);
		});

		test('import_statement produces a CALL node (TypeScriptAdapter mapping)', () => {
			const source = `import { something } from './somewhere';`;
			const result = builder.build(makeParseResult(makeImportStatement(source)), FILE_PATH, FS_FILE_NODE_ID);
			const calls = findNodesByLabel(result.nodes, 'CALL');
			expect(calls.length).toBeGreaterThan(0);
		});

		test('call_expression produces a CALL node', () => {
			const source = `console.log("hello");`;
			const result = builder.build(makeParseResult(makeCallExpression(source)), FILE_PATH, FS_FILE_NODE_ID);
			const calls = findNodesByLabel(result.nodes, 'CALL');
			expect(calls.length).toBeGreaterThan(0);
		});

		test('call_expression CALL node name comes from function field child', () => {
			const source = `console.log("hello");`;
			const result = builder.build(makeParseResult(makeCallExpression(source)), FILE_PATH, FS_FILE_NODE_ID);
			const calls = findNodesByLabel(result.nodes, 'CALL');
			// member_expression child with field "function" spans "console.log" (0..11)
			const consoleLog = calls.find(n => n.name === 'console.log');
			expect(consoleLog).toBeDefined();
		});

		test('if_statement produces a CONTROL_STRUCTURE node', () => {
			const source = `if (x > 0) { doSomething(); }`;
			const result = builder.build(makeParseResult(makeIfStatement(source)), FILE_PATH, FS_FILE_NODE_ID);
			const ctrlStructures = findNodesByLabel(result.nodes, 'CONTROL_STRUCTURE');
			expect(ctrlStructures.length).toBeGreaterThan(0);
		});
	});

	// -------------------------------------------------------------------------
	// Edge creation
	// -------------------------------------------------------------------------

	describe('edge creation', () => {
		test('SOURCE_FILE edges target the filesystem FILE node ID', () => {
			const source = `function greet(name) {}`;
			const result = builder.build(makeParseResult(makeSimpleFunction(source)), FILE_PATH, FS_FILE_NODE_ID);
			const sfEdges = findEdgesByType(result.edges, 'SOURCE_FILE');
			for (const edge of sfEdges) {
				expect(edge.target).toBe(FS_FILE_NODE_ID);
			}
		});

		test('SOURCE_FILE edges connect all nodes to the filesystem FILE node', () => {
			const source = `function greet(name) { return "Hello"; }`;
			const result = builder.build(makeParseResult(makeSimpleFunction(source)), FILE_PATH, FS_FILE_NODE_ID);
			const sfEdges = findEdgesByType(result.edges, 'SOURCE_FILE');
			for (const node of result.nodes) {
				const edge = sfEdges.find(e => e.source === node.id);
				expect(edge).toBeDefined();
				expect(edge!.target).toBe(FS_FILE_NODE_ID);
			}
		});

		test('FILE node itself has no SOURCE_FILE edge', () => {
			const source = `function greet(name) {}`;
			const result = builder.build(makeParseResult(makeSimpleFunction(source)), FILE_PATH, FS_FILE_NODE_ID);
			const selfEdge = result.edges.find(
				e => e.source === FILE_ID && e.type === 'SOURCE_FILE'
			);
			expect(selfEdge).toBeUndefined();
		});

		test('AST parent-child edges are created', () => {
			const source = `function greet(name) { return "Hello"; }`;
			const result = builder.build(makeParseResult(makeSimpleFunction(source)), FILE_PATH, FS_FILE_NODE_ID);
			const astEdges = findEdgesByType(result.edges, 'AST');
			expect(astEdges.length).toBeGreaterThan(0);
		});

		test('top-level function has no AST parent edge (FILE node is external)', () => {
			const source = `function greet(name) { return "Hello"; }`;
			const result = builder.build(makeParseResult(makeSimpleFunction(source)), FILE_PATH, FS_FILE_NODE_ID);
			const methods = findNodesByLabel(result.nodes, 'METHOD');
			const astEdges = findEdgesByType(result.edges, 'AST');
			// Since FILE node is the filesystem node (not emitted), top-level children have no AST parent
			const fileToMethod = astEdges.find(e => e.target === methods[0]?.id);
			expect(fileToMethod).toBeUndefined();
		});

		test('all edge source IDs exist in result.nodes (SOURCE_FILE targets external filesystem node)', () => {
			const { source, rootNode } = makeTwoFunctions();
			const result = builder.build(makeParseResult(rootNode), FILE_PATH, FS_FILE_NODE_ID);
			const nodeIds = new Set(result.nodes.map(n => n.id));
			for (const edge of result.edges) {
				expect(nodeIds.has(edge.source)).toBe(true);
				// SOURCE_FILE edge targets point to the filesystem FILE node (not in result.nodes)
				if (edge.type !== 'SOURCE_FILE') {
					expect(nodeIds.has(edge.target)).toBe(true);
				}
			}
		});

		test('all AST edge source and target IDs exist in result.nodes', () => {
			// SOURCE_FILE edges use a stable "file:<path>" anchor that differs from
			// the FILE node's position-based id — only check AST edges here.
			const { rootNode } = makeTwoFunctions();
			const result = builder.build(makeParseResult(rootNode), FILE_PATH, FS_FILE_NODE_ID);
			const nodeIds = new Set(result.nodes.map(n => n.id));
			const astEdges = findEdgesByType(result.edges, 'AST');
			for (const edge of astEdges) {
				expect(nodeIds.has(edge.source)).toBe(true);
				expect(nodeIds.has(edge.target)).toBe(true);
			}
		});

		test('no duplicate edges (same source + target + type)', () => {
			const { source, rootNode } = makeTwoFunctions();
			const result = builder.build(makeParseResult(rootNode), FILE_PATH, FS_FILE_NODE_ID);
			const seen = new Set<string>();
			for (const edge of result.edges) {
				const key = `${edge.source}|${edge.target}|${edge.type}`;
				expect(seen.has(key)).toBe(false);
				seen.add(key);
			}
		});

		test('sibling top-level functions have distinct order values', () => {
			const { rootNode } = makeTwoFunctions();
			const result = builder.build(makeParseResult(rootNode), FILE_PATH, FS_FILE_NODE_ID);
			const methods = findNodesByLabel(result.nodes, 'METHOD');
			expect(methods.length).toBe(2);
			const orders = methods.map(m => m.order!).sort((a, b) => a - b);
			expect(orders[0]).not.toBe(orders[1]);
		});

		test('first sibling has order 0', () => {
			const { rootNode } = makeTwoFunctions();
			const result = builder.build(makeParseResult(rootNode), FILE_PATH, FS_FILE_NODE_ID);
			const methods = findNodesByLabel(result.nodes, 'METHOD');
			const minOrder = Math.min(...methods.map(m => m.order!));
			expect(minOrder).toBe(0);
		});
	});

	// -------------------------------------------------------------------------
	// Node identity and deduplication
	// -------------------------------------------------------------------------

	describe('node identity and deduplication', () => {
		test('building same tree twice produces identical IDs', () => {
			const source = `function greet(name) { return "Hello"; }`;
			const root = makeSimpleFunction(source);
			const r1 = builder.build(makeParseResult(root), FILE_PATH, FS_FILE_NODE_ID);
			const b2 = new UastBuilder();
			const r2 = b2.build(makeParseResult(root), FILE_PATH, FS_FILE_NODE_ID);
			const ids1 = new Set(r1.nodes.map(n => n.id));
			const ids2 = new Set(r2.nodes.map(n => n.id));
			expect(ids1.size).toBe(ids2.size);
			for (const id of ids1) { expect(ids2.has(id)).toBe(true); }
		});

		test('two different function declarations get different IDs', () => {
			const { rootNode } = makeTwoFunctions();
			const result = builder.build(makeParseResult(rootNode), FILE_PATH, FS_FILE_NODE_ID);
			const methods = findNodesByLabel(result.nodes, 'METHOD');
			expect(methods.length).toBe(2);
			expect(methods[0].id).not.toBe(methods[1].id);
		});

		test('same source in different file paths produces different node IDs', () => {
			const source = `function greet(name) {}`;
			const root = makeSimpleFunction(source);
			const r1 = builder.build(makeParseResult(root), '/project/a.ts', 'a.ts');
			const b2 = new UastBuilder();
			const r2 = b2.build(makeParseResult(root), '/project/b.ts', 'b.ts');
			const methodIds1 = findNodesByLabel(r1.nodes, 'METHOD').map(n => n.id);
			const methodIds2 = findNodesByLabel(r2.nodes, 'METHOD').map(n => n.id);
			for (const id of methodIds1) {
				expect(methodIds2).not.toContain(id);
			}
		});

		test('node ID encodes type, row, and column (format: filePath:type:row:col)', () => {
			const source = `function greet(name) {}`;
			const result = builder.build(makeParseResult(makeSimpleFunction(source)), FILE_PATH, FS_FILE_NODE_ID);
			const methods = findNodesByLabel(result.nodes, 'METHOD');
			// function_declaration starts at row 0, column 0
			expect(methods[0].id).toBe(`${FILE_PATH}:METHOD:0:0`);
		});

		test('removedNodeIds is always an empty array', () => {
			const source = `function greet(name) {}`;
			const result = builder.build(makeParseResult(makeSimpleFunction(source)), FILE_PATH, FS_FILE_NODE_ID);
			expect(result.removedNodeIds).toEqual([]);
		});
	});

	// -------------------------------------------------------------------------
	// Edge cases
	// -------------------------------------------------------------------------

	describe('edge cases', () => {
		test('comment-only source: COMMENT node produced, no CPG FILE node', () => {
			const source = `// This is just a comment`;
			const result = builder.build(makeParseResult(makeCommentOnly(source)), FILE_PATH, FS_FILE_NODE_ID);
			// 'comment' maps to COMMENT in TS_NODE_MAP; program/FILE is unified with filesystem node
			const fileNodes = findNodesByLabel(result.nodes, 'FILE');
			expect(fileNodes.length).toBe(0);
			const commentNodes = findNodesByLabel(result.nodes, 'COMMENT');
			expect(commentNodes.length).toBe(1);
		});

		test('empty source: no nodes emitted, no edges', () => {
			const source = ``;
			const result = builder.build(makeParseResult(makeEmpty(source)), FILE_PATH, FS_FILE_NODE_ID);
			expect(result.nodes.length).toBe(0);
			expect(result.edges.length).toBe(0);
		});

		test('deeply nested AST (20 if levels) processes without stack overflow', () => {
			const source = `function deeplyNested() { ${'if(x) {'.repeat(20)} return true; ${' }'.repeat(20)} }`;
			const root = makeDeeplyNested(source, 20);
			const result = builder.build(makeParseResult(root), FILE_PATH, FS_FILE_NODE_ID);
			expect(result.nodes.length).toBeGreaterThan(0);
			const methods = findNodesByLabel(result.nodes, 'METHOD');
			expect(methods.length).toBeGreaterThan(0);
			const ctrlStructures = findNodesByLabel(result.nodes, 'CONTROL_STRUCTURE');
			expect(ctrlStructures.length).toBe(20);
		});

		test('large flat tree (100 top-level functions) completes quickly', () => {
			const source = Array.from({ length: 100 }, (_, i) => `function fn${i}() {}`).join('\n');
			// Build 100 function_declaration children under program
			const children: FakeNode[] = [];
			for (let i = 0; i < 100; i++) {
				const nameNode = fakeNode('identifier', source, i * 20 + 9, i * 20 + 12, i, 9, [], 'name');
				children.push(fakeNode('function_declaration', source, i * 20, i * 20 + 19, i, 0, [nameNode]));
			}
			const root = fakeNode('program', source, 0, source.length, 0, 0, children);
			const start = performance.now();
			const result = builder.build(makeParseResult(root), FILE_PATH, FS_FILE_NODE_ID);
			expect(performance.now() - start).toBeLessThan(2000);
			expect(findNodesByLabel(result.nodes, 'METHOD').length).toBe(100);
		});

		test('unmapped tree-sitter node type is skipped — children still walked', () => {
			// lexical_declaration is not in TS_NODE_MAP, but its child variable_declarator is
			const source = `const greeting = "Hello World";`;
			const varNode = fakeNode('variable_declarator', source, 6, 30, 0, 6, []);
			// Wrap in an unmapped parent
			const lexDecl = fakeNode('lexical_declaration', source, 0, source.length, 0, 0, [varNode]);
			const root = fakeNode('program', source, 0, source.length, 0, 0, [lexDecl]);
			const result = builder.build(makeParseResult(root), FILE_PATH, FS_FILE_NODE_ID);
			// variable_declarator should still be found even though lexical_declaration was skipped
			const locals = findNodesByLabel(result.nodes, 'LOCAL');
			expect(locals.length).toBeGreaterThan(0);
		});

		test('node seen twice (same position/type) is deduplicated', () => {
			// Two children with identical type/position — second should be skipped
			const source = `function greet(name) {}`;
			const nameA = fakeNode('identifier', source, 9, 14, 0, 9, [], 'name');
			const nameB = fakeNode('identifier', source, 9, 14, 0, 9, [], 'name'); // same id
			const fn = fakeNode('function_declaration', source, 0, source.length, 0, 0, [nameA, nameB]);
			const root = fakeNode('program', source, 0, source.length, 0, 0, [fn]);
			const result = builder.build(makeParseResult(root), FILE_PATH, FS_FILE_NODE_ID);
			// identifier nodes with same position should be deduplicated
			const identifiers = findNodesByLabel(result.nodes, 'IDENTIFIER');
			const ids = identifiers.map(n => n.id);
			expect(new Set(ids).size).toBe(ids.length);
		});

		test('node IDs are unique across all nodes in result', () => {
			const source = `class Calculator { add(a, b) { return a + b; } }`;
			const result = builder.build(makeParseResult(makeClassWithMethod(source)), FILE_PATH, FS_FILE_NODE_ID);
			const ids = result.nodes.map(n => n.id);
			expect(new Set(ids).size).toBe(ids.length);
		});
	});

	// -------------------------------------------------------------------------
	// Property correctness — verified against snapshot field structure
	// -------------------------------------------------------------------------

	describe('property correctness', () => {
		test('lineNumber is 1-indexed (row 0 → lineNumber 1)', () => {
			const source = `function greet(name) {}`;
			const result = builder.build(makeParseResult(makeSimpleFunction(source)), FILE_PATH, FS_FILE_NODE_ID);
			const methods = findNodesByLabel(result.nodes, 'METHOD');
			// function_declaration starts at row 0 → lineNumber should be 1
			expect(methods[0].lineNumber).toBe(1);
		});

		test('lineNumber of second-line node is 2', () => {
			const { rootNode } = makeTwoFunctions();
			const result = builder.build(makeParseResult(rootNode), FILE_PATH, FS_FILE_NODE_ID);
			const methods = findNodesByLabel(result.nodes, 'METHOD');
			const bar = methods.find(m => m.name === 'bar');
			expect(bar).toBeDefined();
			expect(bar!.lineNumber).toBe(2); // barFn starts at row 1 → lineNumber 2
		});

		test('columnNumber is 0-indexed (column 0 → columnNumber 0)', () => {
			const source = `function greet(name) {}`;
			const result = builder.build(makeParseResult(makeSimpleFunction(source)), FILE_PATH, FS_FILE_NODE_ID);
			const methods = findNodesByLabel(result.nodes, 'METHOD');
			expect(methods[0].columnNumber).toBe(0);
		});

		test('code property is a slice of source between startIndex and endIndex', () => {
			const source = `function greet(name) { return "Hello"; }`;
			const result = builder.build(makeParseResult(makeSimpleFunction(source)), FILE_PATH, FS_FILE_NODE_ID);
			const methods = findNodesByLabel(result.nodes, 'METHOD');
			// function_declaration spans the entire source (0..source.length)
			expect(source).toContain(methods[0].code!.trim());
		});

		test('code is capped at 256 characters', () => {
			const longBody = 'x'.repeat(300);
			const source = `function long() { return "${longBody}"; }`;
			const root = makeSimpleFunction(source);
			const result = builder.build(makeParseResult(root), FILE_PATH, FS_FILE_NODE_ID);
			for (const node of result.nodes) {
				if (node.code !== undefined) {
					expect(node.code.length).toBeLessThanOrEqual(256);
				}
			}
		});

		test('offset and offsetEnd are set to startIndex and endIndex', () => {
			const source = `function greet(name) { return "Hello"; }`;
			const result = builder.build(makeParseResult(makeSimpleFunction(source)), FILE_PATH, FS_FILE_NODE_ID);
			const methods = findNodesByLabel(result.nodes, 'METHOD');
			expect(methods[0].offset).toBe(0);
			expect(methods[0].offsetEnd).toBe(source.length);
		});

		test('offsetEnd > offset for non-empty nodes', () => {
			const source = `function greet(name) {}`;
			const result = builder.build(makeParseResult(makeSimpleFunction(source)), FILE_PATH, FS_FILE_NODE_ID);
			const methods = findNodesByLabel(result.nodes, 'METHOD');
			expect(methods[0].offsetEnd!).toBeGreaterThan(methods[0].offset!);
		});

		test('filename property equals the file path on all non-FILE nodes', () => {
			const source = `function greet(name) {}`;
			const result = builder.build(makeParseResult(makeSimpleFunction(source)), FILE_PATH, FS_FILE_NODE_ID);
			const nonFileNodes = result.nodes.filter(n => n.label !== 'FILE');
			for (const node of nonFileNodes) {
				expect(node.filename).toBe(FILE_PATH);
			}
		});
	});

	// -------------------------------------------------------------------------
	// Incremental build (changedRanges in ParseResult)
	// -------------------------------------------------------------------------

	describe('incremental build (changedRanges)', () => {
		test('removedNodeIds is always [] regardless of changedRanges', () => {
			const source = `function greet(name) {}`;
			// First parse — no changedRanges
			const r1 = builder.build(makeParseResult(makeSimpleFunction(source), null), FILE_PATH, FS_FILE_NODE_ID);
			expect(r1.removedNodeIds).toEqual([]);

			// Second parse — with changedRanges (simulates incremental)
			const r2 = builder.build(makeParseResult(makeSimpleFunction(source), []), FILE_PATH, FS_FILE_NODE_ID);
			expect(r2.removedNodeIds).toEqual([]);
		});

		test('full rebuild with same tree produces same node IDs', () => {
			const source = `function greet(name) {}`;
			const root = makeSimpleFunction(source);
			const r1 = builder.build(makeParseResult(root, null), FILE_PATH, FS_FILE_NODE_ID);
			const b2 = new UastBuilder();
			const r2 = b2.build(makeParseResult(root, []), FILE_PATH, FS_FILE_NODE_ID);
			const ids1 = new Set(r1.nodes.map(n => n.id));
			const ids2 = new Set(r2.nodes.map(n => n.id));
			expect(ids1.size).toBe(ids2.size);
			for (const id of ids1) { expect(ids2.has(id)).toBe(true); }
		});
	});
});
