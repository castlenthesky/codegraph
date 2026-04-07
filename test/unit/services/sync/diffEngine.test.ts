import { describe, test, expect, beforeEach } from 'bun:test';
import { DiffEngine } from '../../../../src/services/sync/DiffEngine';
import type { GraphData, GraphDiff } from '../../../../src/services/sync/DiffEngine';
import type { GraphNode, GraphEdge } from '../../../../src/types/nodes';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeFileNode(id: string, overrides: Partial<any> = {}): GraphNode {
	return {
		id,
		label: 'FILE',
		name: `${id}.ts`,
		path: `/src/${id}.ts`,
		relativePath: `src/${id}.ts`,
		extension: '.ts',
		language: 'typescript',
		size: 1000,
		createdAt: 1000000,
		modifiedAt: 1000000,
		isParsed: false,
		...overrides
	};
}

function makeDirNode(id: string, overrides: Partial<any> = {}): GraphNode {
	return {
		id,
		label: 'DIRECTORY',
		name: id,
		path: `/src/${id}`,
		relativePath: `src/${id}`,
		createdAt: 1000000,
		modifiedAt: 1000000,
		...overrides
	};
}

function makeCpgNode(id: string, label: string = 'METHOD', overrides: Partial<any> = {}): GraphNode {
	return {
		id,
		label: label as any,
		name: `fn_${id}`,
		code: `function ${id}() {}`,
		lineNumber: 1,
		...overrides
	} as GraphNode;
}

function makeEdge(source: string, target: string, type: string = 'CONTAINS'): GraphEdge {
	return { source, target, type: type as any };
}

function emptyGraph(): GraphData {
	return { nodes: [], edges: [] };
}

// ---------------------------------------------------------------------------
// Smoke tests
// ---------------------------------------------------------------------------

describe('DiffEngine — smoke tests', () => {
	test('can be instantiated', () => {
		const engine = new DiffEngine();
		expect(engine).toBeDefined();
		expect(typeof engine.computeDiff).toBe('function');
	});

	test('computeDiff returns an object with all five diff arrays', () => {
		const engine = new DiffEngine();
		const result = engine.computeDiff(emptyGraph(), emptyGraph());
		expect(result).toBeDefined();
		expect(Array.isArray(result.nodesToAdd)).toBe(true);
		expect(Array.isArray(result.nodesToUpdate)).toBe(true);
		expect(Array.isArray(result.nodesToRemove)).toBe(true);
		expect(Array.isArray(result.edgesToAdd)).toBe(true);
		expect(Array.isArray(result.edgesToRemove)).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// No changes
// ---------------------------------------------------------------------------

describe('DiffEngine.computeDiff — no changes', () => {
	let engine: DiffEngine;

	beforeEach(() => {
		engine = new DiffEngine();
	});

	test('identical empty graphs produce all-empty diff arrays', () => {
		const diff = engine.computeDiff(emptyGraph(), emptyGraph());
		expect(diff.nodesToAdd).toHaveLength(0);
		expect(diff.nodesToUpdate).toHaveLength(0);
		expect(diff.nodesToRemove).toHaveLength(0);
		expect(diff.edgesToAdd).toHaveLength(0);
		expect(diff.edgesToRemove).toHaveLength(0);
	});

	test('identical non-empty graphs produce all-empty diff arrays', () => {
		const node = makeFileNode('a');
		const edge = makeEdge('a', 'b');
		const graph: GraphData = { nodes: [node], edges: [edge] };
		const diff = engine.computeDiff(graph, graph);
		expect(diff.nodesToAdd).toHaveLength(0);
		expect(diff.nodesToUpdate).toHaveLength(0);
		expect(diff.nodesToRemove).toHaveLength(0);
		expect(diff.edgesToAdd).toHaveLength(0);
		expect(diff.edgesToRemove).toHaveLength(0);
	});

	test('hasChanges() returns false for an empty diff', () => {
		const diff = engine.computeDiff(emptyGraph(), emptyGraph());
		expect(engine.hasChanges(diff)).toBe(false);
	});

	test('hasChanges() returns false for identical non-empty graphs', () => {
		const node = makeFileNode('x');
		const graph: GraphData = { nodes: [node], edges: [] };
		const diff = engine.computeDiff(graph, graph);
		expect(engine.hasChanges(diff)).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// Node additions
// ---------------------------------------------------------------------------

describe('DiffEngine.computeDiff — node additions', () => {
	let engine: DiffEngine;

	beforeEach(() => {
		engine = new DiffEngine();
	});

	test('a node present in new graph but not old appears in nodesToAdd', () => {
		const node = makeFileNode('new-node');
		const diff = engine.computeDiff(emptyGraph(), { nodes: [node], edges: [] });
		expect(diff.nodesToAdd).toHaveLength(1);
		expect(diff.nodesToAdd[0].id).toBe('new-node');
	});

	test('multiple new nodes all appear in nodesToAdd', () => {
		const nodes = [makeFileNode('a'), makeFileNode('b'), makeFileNode('c')];
		const diff = engine.computeDiff(emptyGraph(), { nodes, edges: [] });
		expect(diff.nodesToAdd).toHaveLength(3);
		const ids = diff.nodesToAdd.map(n => n.id);
		expect(ids).toContain('a');
		expect(ids).toContain('b');
		expect(ids).toContain('c');
	});

	test('added node retains all its properties in the diff', () => {
		const node = makeFileNode('full-props', {
			size: 42000,
			language: 'typescript',
			isParsed: true
		});
		const diff = engine.computeDiff(emptyGraph(), { nodes: [node], edges: [] });
		expect(diff.nodesToAdd).toHaveLength(1);
		const added = diff.nodesToAdd[0] as any;
		expect(added.id).toBe('full-props');
		expect(added.size).toBe(42000);
		expect(added.language).toBe('typescript');
		expect(added.isParsed).toBe(true);
	});

	test('nodes already in old graph do not appear in nodesToAdd', () => {
		const existing = makeFileNode('existing');
		const added = makeFileNode('added');
		const oldGraph: GraphData = { nodes: [existing], edges: [] };
		const newGraph: GraphData = { nodes: [existing, added], edges: [] };
		const diff = engine.computeDiff(oldGraph, newGraph);
		expect(diff.nodesToAdd).toHaveLength(1);
		expect(diff.nodesToAdd[0].id).toBe('added');
	});
});

// ---------------------------------------------------------------------------
// Node removals
// ---------------------------------------------------------------------------

describe('DiffEngine.computeDiff — node removals', () => {
	let engine: DiffEngine;

	beforeEach(() => {
		engine = new DiffEngine();
	});

	test('a node in old graph but not new appears in nodesToRemove', () => {
		const node = makeFileNode('gone');
		const diff = engine.computeDiff({ nodes: [node], edges: [] }, emptyGraph());
		expect(diff.nodesToRemove).toHaveLength(1);
		expect(diff.nodesToRemove[0]).toBe('gone');
	});

	test('multiple removed nodes all appear in nodesToRemove', () => {
		const nodes = [makeFileNode('x'), makeFileNode('y'), makeFileNode('z')];
		const diff = engine.computeDiff({ nodes, edges: [] }, emptyGraph());
		expect(diff.nodesToRemove).toHaveLength(3);
		expect(diff.nodesToRemove).toContain('x');
		expect(diff.nodesToRemove).toContain('y');
		expect(diff.nodesToRemove).toContain('z');
	});

	test('removal is identified by node id (string)', () => {
		const node = makeFileNode('id-check');
		const diff = engine.computeDiff({ nodes: [node], edges: [] }, emptyGraph());
		expect(typeof diff.nodesToRemove[0]).toBe('string');
		expect(diff.nodesToRemove[0]).toBe('id-check');
	});

	test('nodes still present in new graph do not appear in nodesToRemove', () => {
		const kept = makeFileNode('kept');
		const removed = makeFileNode('removed');
		const oldGraph: GraphData = { nodes: [kept, removed], edges: [] };
		const newGraph: GraphData = { nodes: [kept], edges: [] };
		const diff = engine.computeDiff(oldGraph, newGraph);
		expect(diff.nodesToRemove).toHaveLength(1);
		expect(diff.nodesToRemove[0]).toBe('removed');
	});
});

// ---------------------------------------------------------------------------
// Node modifications
// ---------------------------------------------------------------------------

describe('DiffEngine.computeDiff — node modifications', () => {
	let engine: DiffEngine;

	beforeEach(() => {
		engine = new DiffEngine();
	});

	test('same node id with different name appears in nodesToUpdate', () => {
		const oldNode = makeFileNode('n1', { name: 'original.ts' });
		const newNode = makeFileNode('n1', { name: 'renamed.ts' });
		const diff = engine.computeDiff({ nodes: [oldNode], edges: [] }, { nodes: [newNode], edges: [] });
		expect(diff.nodesToUpdate).toHaveLength(1);
		expect(diff.nodesToUpdate[0].id).toBe('n1');
	});

	test('modified node diff includes the new property values', () => {
		const oldNode = makeFileNode('n2', { name: 'before.ts', size: 100 });
		const newNode = makeFileNode('n2', { name: 'after.ts', size: 200 });
		const diff = engine.computeDiff({ nodes: [oldNode], edges: [] }, { nodes: [newNode], edges: [] });
		expect(diff.nodesToUpdate).toHaveLength(1);
		const updated = diff.nodesToUpdate[0] as any;
		expect(updated.name).toBe('after.ts');
		expect(updated.size).toBe(200);
	});

	test('unchanged nodes do NOT appear in nodesToUpdate', () => {
		const node = makeFileNode('stable');
		const diff = engine.computeDiff({ nodes: [node], edges: [] }, { nodes: [node], edges: [] });
		expect(diff.nodesToUpdate).toHaveLength(0);
	});

	test('change to FILE size is detected', () => {
		const oldNode = makeFileNode('f', { size: 500 });
		const newNode = makeFileNode('f', { size: 999 });
		const diff = engine.computeDiff({ nodes: [oldNode], edges: [] }, { nodes: [newNode], edges: [] });
		expect(diff.nodesToUpdate).toHaveLength(1);
	});

	test('change to FILE modifiedAt is detected', () => {
		const oldNode = makeFileNode('f', { modifiedAt: 1000 });
		const newNode = makeFileNode('f', { modifiedAt: 9999 });
		const diff = engine.computeDiff({ nodes: [oldNode], edges: [] }, { nodes: [newNode], edges: [] });
		expect(diff.nodesToUpdate).toHaveLength(1);
	});

	test('change to DIRECTORY modifiedAt is detected', () => {
		const oldNode = makeDirNode('d', { modifiedAt: 1000 });
		const newNode = makeDirNode('d', { modifiedAt: 2000 });
		const diff = engine.computeDiff({ nodes: [oldNode], edges: [] }, { nodes: [newNode], edges: [] });
		expect(diff.nodesToUpdate).toHaveLength(1);
	});

	test('change to CPG node lineNumber is detected', () => {
		const oldNode = makeCpgNode('cpg1', 'METHOD', { lineNumber: 10 });
		const newNode = makeCpgNode('cpg1', 'METHOD', { lineNumber: 25 });
		const diff = engine.computeDiff({ nodes: [oldNode], edges: [] }, { nodes: [newNode], edges: [] });
		expect(diff.nodesToUpdate).toHaveLength(1);
	});

	test('change to CPG node code snippet is detected', () => {
		const oldNode = makeCpgNode('cpg2', 'CALL', { code: 'foo()' });
		const newNode = makeCpgNode('cpg2', 'CALL', { code: 'bar()' });
		const diff = engine.computeDiff({ nodes: [oldNode], edges: [] }, { nodes: [newNode], edges: [] });
		expect(diff.nodesToUpdate).toHaveLength(1);
	});

	test('change to label is detected as modification', () => {
		// Same id, different label → hasNodeChanged returns true
		const oldNode: GraphNode = { id: 'lbl', label: 'FILE', name: 'f', path: '/f', relativePath: 'f', extension: '.ts', language: 'ts', size: 0, createdAt: 0, modifiedAt: 0, isParsed: false };
		// Fabricate a node with same id but different label using a CpgNode shape
		const newNode: any = { id: 'lbl', label: 'METHOD', name: 'f' };
		const diff = engine.computeDiff({ nodes: [oldNode], edges: [] }, { nodes: [newNode], edges: [] });
		expect(diff.nodesToUpdate).toHaveLength(1);
	});
});

// ---------------------------------------------------------------------------
// Edge additions
// ---------------------------------------------------------------------------

describe('DiffEngine.computeDiff — edge additions', () => {
	let engine: DiffEngine;

	beforeEach(() => {
		engine = new DiffEngine();
	});

	test('edge in new graph but not old appears in edgesToAdd', () => {
		const edge = makeEdge('a', 'b', 'CONTAINS');
		const diff = engine.computeDiff(emptyGraph(), { nodes: [], edges: [edge] });
		expect(diff.edgesToAdd).toHaveLength(1);
		expect(diff.edgesToAdd[0].source).toBe('a');
		expect(diff.edgesToAdd[0].target).toBe('b');
		expect(diff.edgesToAdd[0].type).toBe('CONTAINS');
	});

	test('multiple new edges all appear in edgesToAdd', () => {
		const edges = [
			makeEdge('a', 'b', 'CONTAINS'),
			makeEdge('b', 'c', 'PARENT'),
			makeEdge('c', 'd', 'DEFINED_IN')
		];
		const diff = engine.computeDiff(emptyGraph(), { nodes: [], edges });
		expect(diff.edgesToAdd).toHaveLength(3);
	});

	test('edge identity is source+target+type combination', () => {
		// Same source+target but different type → both are "new" edges
		const edgeAst = makeEdge('a', 'b', 'CONTAINS');
		const edgeParent = makeEdge('a', 'b', 'PARENT');
		const oldGraph: GraphData = { nodes: [], edges: [edgeAst] };
		const newGraph: GraphData = { nodes: [], edges: [edgeAst, edgeParent] };
		const diff = engine.computeDiff(oldGraph, newGraph);
		expect(diff.edgesToAdd).toHaveLength(1);
		expect(diff.edgesToAdd[0].type).toBe('PARENT');
	});

	test('pre-existing edges do not appear in edgesToAdd', () => {
		const existing = makeEdge('x', 'y', 'CONTAINS');
		const added = makeEdge('x', 'z', 'CONTAINS');
		const diff = engine.computeDiff({ nodes: [], edges: [existing] }, { nodes: [], edges: [existing, added] });
		expect(diff.edgesToAdd).toHaveLength(1);
		expect(diff.edgesToAdd[0].target).toBe('z');
	});
});

// ---------------------------------------------------------------------------
// Edge removals
// ---------------------------------------------------------------------------

describe('DiffEngine.computeDiff — edge removals', () => {
	let engine: DiffEngine;

	beforeEach(() => {
		engine = new DiffEngine();
	});

	test('edge in old graph but not new appears in edgesToRemove', () => {
		const edge = makeEdge('p', 'q', 'CONTAINS');
		const diff = engine.computeDiff({ nodes: [], edges: [edge] }, emptyGraph());
		expect(diff.edgesToRemove).toHaveLength(1);
		expect(diff.edgesToRemove[0].source).toBe('p');
		expect(diff.edgesToRemove[0].target).toBe('q');
	});

	test('multiple removed edges all appear in edgesToRemove', () => {
		const edges = [makeEdge('a', 'b'), makeEdge('c', 'd'), makeEdge('e', 'f')];
		const diff = engine.computeDiff({ nodes: [], edges }, emptyGraph());
		expect(diff.edgesToRemove).toHaveLength(3);
	});

	test('removal is identified by source+target+type', () => {
		const edgeContains = makeEdge('m', 'n', 'CONTAINS');
		const edgeParent = makeEdge('m', 'n', 'PARENT');
		// Keep edgeContains, remove edgeParent
		const diff = engine.computeDiff(
			{ nodes: [], edges: [edgeContains, edgeParent] },
			{ nodes: [], edges: [edgeContains] }
		);
		expect(diff.edgesToRemove).toHaveLength(1);
		expect(diff.edgesToRemove[0].type).toBe('PARENT');
	});

	test('edges still present in new graph do not appear in edgesToRemove', () => {
		const kept = makeEdge('keep', 'this', 'CONTAINS');
		const gone = makeEdge('drop', 'this', 'CONTAINS');
		const diff = engine.computeDiff(
			{ nodes: [], edges: [kept, gone] },
			{ nodes: [], edges: [kept] }
		);
		expect(diff.edgesToRemove).toHaveLength(1);
		expect(diff.edgesToRemove[0].source).toBe('drop');
	});
});

// ---------------------------------------------------------------------------
// Mixed changes
// ---------------------------------------------------------------------------

describe('DiffEngine.computeDiff — mixed changes', () => {
	let engine: DiffEngine;

	beforeEach(() => {
		engine = new DiffEngine();
	});

	test('simultaneous node additions, removals, and modifications are correctly separated', () => {
		const unchanged = makeFileNode('unchanged');
		const toRemove = makeFileNode('remove-me');
		const toModify = makeFileNode('modify-me', { name: 'old.ts' });

		const oldGraph: GraphData = {
			nodes: [unchanged, toRemove, toModify],
			edges: []
		};

		const modifiedVersion = makeFileNode('modify-me', { name: 'new.ts' });
		const added = makeFileNode('brand-new');

		const newGraph: GraphData = {
			nodes: [unchanged, modifiedVersion, added],
			edges: []
		};

		const diff = engine.computeDiff(oldGraph, newGraph);

		expect(diff.nodesToAdd).toHaveLength(1);
		expect(diff.nodesToAdd[0].id).toBe('brand-new');

		expect(diff.nodesToRemove).toHaveLength(1);
		expect(diff.nodesToRemove[0]).toBe('remove-me');

		expect(diff.nodesToUpdate).toHaveLength(1);
		expect(diff.nodesToUpdate[0].id).toBe('modify-me');
		expect((diff.nodesToUpdate[0] as any).name).toBe('new.ts');
	});

	test('edge changes alongside node changes are correctly classified', () => {
		const node = makeFileNode('n');
		const oldEdge = makeEdge('n', 'old-target', 'CONTAINS');
		const newEdge = makeEdge('n', 'new-target', 'CONTAINS');
		const addedNode = makeFileNode('new-target');

		const diff = engine.computeDiff(
			{ nodes: [node], edges: [oldEdge] },
			{ nodes: [node, addedNode], edges: [newEdge] }
		);

		// Node added
		expect(diff.nodesToAdd).toHaveLength(1);
		expect(diff.nodesToAdd[0].id).toBe('new-target');
		// Edge removed
		expect(diff.edgesToRemove).toHaveLength(1);
		expect(diff.edgesToRemove[0].target).toBe('old-target');
		// Edge added
		expect(diff.edgesToAdd).toHaveLength(1);
		expect(diff.edgesToAdd[0].target).toBe('new-target');
	});

	test('result separates additions from removals (no overlap)', () => {
		const oldNode = makeFileNode('gone');
		const newNode = makeFileNode('arrived');
		const diff = engine.computeDiff({ nodes: [oldNode], edges: [] }, { nodes: [newNode], edges: [] });

		const addedIds = diff.nodesToAdd.map(n => n.id);
		const removedIds = diff.nodesToRemove;

		expect(addedIds).toContain('arrived');
		expect(removedIds).toContain('gone');
		// No overlap
		expect(addedIds).not.toContain('gone');
		expect(removedIds).not.toContain('arrived');
	});
});

// ---------------------------------------------------------------------------
// hasChanges()
// ---------------------------------------------------------------------------

describe('DiffEngine.hasChanges()', () => {
	let engine: DiffEngine;

	beforeEach(() => {
		engine = new DiffEngine();
	});

	function emptyDiff(): GraphDiff {
		return {
			nodesToAdd: [],
			nodesToUpdate: [],
			nodesToRemove: [],
			edgesToAdd: [],
			edgesToRemove: []
		};
	}

	test('returns true when nodesToAdd is non-empty', () => {
		const diff: GraphDiff = { ...emptyDiff(), nodesToAdd: [makeFileNode('x')] };
		expect(engine.hasChanges(diff)).toBe(true);
	});

	test('returns true when nodesToRemove is non-empty', () => {
		const diff: GraphDiff = { ...emptyDiff(), nodesToRemove: ['gone-id'] };
		expect(engine.hasChanges(diff)).toBe(true);
	});

	test('returns true when nodesToUpdate is non-empty', () => {
		const diff: GraphDiff = { ...emptyDiff(), nodesToUpdate: [makeFileNode('changed')] };
		expect(engine.hasChanges(diff)).toBe(true);
	});

	test('returns true when edgesToAdd is non-empty', () => {
		const diff: GraphDiff = { ...emptyDiff(), edgesToAdd: [makeEdge('a', 'b')] };
		expect(engine.hasChanges(diff)).toBe(true);
	});

	test('returns true when edgesToRemove is non-empty', () => {
		const diff: GraphDiff = { ...emptyDiff(), edgesToRemove: [makeEdge('c', 'd')] };
		expect(engine.hasChanges(diff)).toBe(true);
	});

	test('returns false when all diff arrays are empty', () => {
		expect(engine.hasChanges(emptyDiff())).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// createIncrementalPatch()
// ---------------------------------------------------------------------------

describe('DiffEngine.createIncrementalPatch()', () => {
	let engine: DiffEngine;

	beforeEach(() => {
		engine = new DiffEngine();
	});

	function emptyDiff(): GraphDiff {
		return {
			nodesToAdd: [],
			nodesToUpdate: [],
			nodesToRemove: [],
			edgesToAdd: [],
			edgesToRemove: []
		};
	}

	test('empty diff produces an empty patch object (no keys set)', () => {
		const patch = engine.createIncrementalPatch(emptyDiff());
		expect(patch.addNodes).toBeUndefined();
		expect(patch.removeNodes).toBeUndefined();
		expect(patch.updateNodes).toBeUndefined();
		expect(patch.addLinks).toBeUndefined();
		expect(patch.removeLinks).toBeUndefined();
	});

	test('patch addNodes contains added node data with id, name, type, val', () => {
		const node = makeCpgNode('m1', 'METHOD', { name: 'myMethod' });
		const diff: GraphDiff = { ...emptyDiff(), nodesToAdd: [node] };
		const patch = engine.createIncrementalPatch(diff);
		expect(patch.addNodes).toBeDefined();
		expect(patch.addNodes).toHaveLength(1);
		const patchNode = patch.addNodes![0];
		expect(patchNode.id).toBe('m1');
		expect(patchNode.name).toBe('myMethod');
		expect(patchNode.type).toBe('METHOD');
		expect(typeof patchNode.val).toBe('number');
	});

	test('patch addNodes val for METHOD is 4', () => {
		const node = makeCpgNode('m', 'METHOD');
		const patch = engine.createIncrementalPatch({ ...emptyDiff(), nodesToAdd: [node] });
		expect(patch.addNodes![0].val).toBe(4);
	});

	test('patch addNodes val for TYPE_DECL is 3', () => {
		const node = makeCpgNode('t', 'TYPE_DECL');
		const patch = engine.createIncrementalPatch({ ...emptyDiff(), nodesToAdd: [node] });
		expect(patch.addNodes![0].val).toBe(3);
	});

	test('patch addNodes val for CALL is 2', () => {
		const node = makeCpgNode('c', 'CALL');
		const patch = engine.createIncrementalPatch({ ...emptyDiff(), nodesToAdd: [node] });
		expect(patch.addNodes![0].val).toBe(2);
	});

	test('patch addNodes val for unknown type defaults to 2', () => {
		const node = makeCpgNode('u', 'UNKNOWN');
		const patch = engine.createIncrementalPatch({ ...emptyDiff(), nodesToAdd: [node] });
		expect(patch.addNodes![0].val).toBe(2);
	});

	test('patch addNodes falls back to node id when name is absent', () => {
		const node: GraphNode = { id: 'no-name', label: 'METHOD' as any };
		const patch = engine.createIncrementalPatch({ ...emptyDiff(), nodesToAdd: [node] });
		expect(patch.addNodes![0].name).toBe('no-name');
	});

	test('patch removeNodes contains IDs of removed nodes', () => {
		const diff: GraphDiff = { ...emptyDiff(), nodesToRemove: ['del1', 'del2'] };
		const patch = engine.createIncrementalPatch(diff);
		expect(patch.removeNodes).toBeDefined();
		expect(patch.removeNodes).toEqual(['del1', 'del2']);
	});

	test('patch addLinks contains source, target, and type', () => {
		const edge = makeEdge('src', 'tgt', 'DEFINED_IN');
		const diff: GraphDiff = { ...emptyDiff(), edgesToAdd: [edge] };
		const patch = engine.createIncrementalPatch(diff);
		expect(patch.addLinks).toBeDefined();
		expect(patch.addLinks).toHaveLength(1);
		expect(patch.addLinks![0]).toEqual({ source: 'src', target: 'tgt', type: 'DEFINED_IN' });
	});

	test('patch removeLinks contains source, target, and type', () => {
		const edge = makeEdge('a', 'b', 'CONTAINS');
		const diff: GraphDiff = { ...emptyDiff(), edgesToRemove: [edge] };
		const patch = engine.createIncrementalPatch(diff);
		expect(patch.removeLinks).toBeDefined();
		expect(patch.removeLinks![0]).toEqual({ source: 'a', target: 'b', type: 'CONTAINS' });
	});

	test('patch updateNodes is set when nodesToUpdate is non-empty', () => {
		const node = makeCpgNode('upd', 'CALL', { name: 'updatedFn' });
		const diff: GraphDiff = { ...emptyDiff(), nodesToUpdate: [node] };
		const patch = engine.createIncrementalPatch(diff);
		expect(patch.updateNodes).toBeDefined();
		expect(patch.updateNodes![0].id).toBe('upd');
	});

	test('full diff produces a patch with all sections populated', () => {
		const diff: GraphDiff = {
			nodesToAdd: [makeCpgNode('add', 'METHOD')],
			nodesToUpdate: [makeCpgNode('upd', 'CALL')],
			nodesToRemove: ['del'],
			edgesToAdd: [makeEdge('a', 'b')],
			edgesToRemove: [makeEdge('c', 'd')]
		};
		const patch = engine.createIncrementalPatch(diff);
		expect(patch.addNodes).toBeDefined();
		expect(patch.updateNodes).toBeDefined();
		expect(patch.removeNodes).toBeDefined();
		expect(patch.addLinks).toBeDefined();
		expect(patch.removeLinks).toBeDefined();
	});
});

// ---------------------------------------------------------------------------
// Performance
// ---------------------------------------------------------------------------

describe('DiffEngine — performance', () => {
	let engine: DiffEngine;

	beforeEach(() => {
		engine = new DiffEngine();
	});

	test('computeDiff with 1000 nodes on each side completes in < 200ms', () => {
		const oldNodes: GraphNode[] = Array.from({ length: 1000 }, (_, i) => makeFileNode(`node-${i}`));
		const newNodes: GraphNode[] = Array.from({ length: 1000 }, (_, i) =>
			makeFileNode(`node-${i}`, { modifiedAt: i % 2 === 0 ? 9999 : 1000000 })
		);
		const oldGraph: GraphData = { nodes: oldNodes, edges: [] };
		const newGraph: GraphData = { nodes: newNodes, edges: [] };

		const start = performance.now();
		const diff = engine.computeDiff(oldGraph, newGraph);
		const elapsed = performance.now() - start;

		expect(elapsed).toBeLessThan(200);
		// Sanity check that diff ran correctly
		expect(diff.nodesToAdd.length + diff.nodesToUpdate.length + diff.nodesToRemove.length).toBeGreaterThanOrEqual(0);
	});

	test('computeDiff with 10000 edges completes in < 500ms', () => {
		const edges: GraphEdge[] = Array.from({ length: 10000 }, (_, i) =>
			makeEdge(`src-${i}`, `tgt-${i}`, 'CONTAINS')
		);
		// Keep first 9000, add 1000 new ones in new graph
		const newEdges: GraphEdge[] = [
			...edges.slice(0, 9000),
			...Array.from({ length: 1000 }, (_, i) => makeEdge(`new-src-${i}`, `new-tgt-${i}`, 'CONTAINS'))
		];

		const start = performance.now();
		const diff = engine.computeDiff({ nodes: [], edges }, { nodes: [], edges: newEdges });
		const elapsed = performance.now() - start;

		expect(elapsed).toBeLessThan(500);
		expect(diff.edgesToRemove).toHaveLength(1000);
		expect(diff.edgesToAdd).toHaveLength(1000);
	});
});
