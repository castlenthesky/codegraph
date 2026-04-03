import * as assert from 'assert';
import * as vscode from 'vscode';
import { FalkorDBStore } from '../services/storage/FalkorDBStore';
import type { GraphNode, GraphEdge } from '../types/nodes';

suite('FalkorDBStore Integration Test Suite', () => {
	let store: FalkorDBStore;

	setup(async () => {
		store = new FalkorDBStore();
		await store.connect();
		await store.clearGraph();
	});

	teardown(async () => {
		await store.clearGraph();
	});

	test('Create nodes and retrieve them', async () => {
		const nodeA: GraphNode = {
			id: 'test_node_A',
			label: 'FILE',
			name: 'fileA.ts',
			path: '/path/to/fileA.ts',
			relativePath: 'fileA.ts',
			extension: '.ts',
			language: 'typescript',
			size: 100,
			createdAt: Date.now(),
			modifiedAt: Date.now(),
			isParsed: false
		};

		await store.createNode(nodeA);

		const { nodes, edges } = await store.getAllNodesAndEdges();

		assert.strictEqual(nodes.length, 1, 'Should retrieve exactly 1 node');
		assert.strictEqual(nodes[0].id, 'test_node_A', 'Node ID should match');
		assert.strictEqual(nodes[0].label, 'FILE', 'Node label should match');
		assert.strictEqual(nodes[0].name, 'fileA.ts', 'Node name should match');
		assert.strictEqual(edges.length, 0, 'Should have 0 edges');
	});

	test('Create edges and retrieve accurate mapping', async () => {
		const nodeA: GraphNode = { id: 'dir_A', label: 'DIRECTORY', name: 'src', path: '/src', relativePath: 'src', createdAt: 0, modifiedAt: 0 };
		const nodeB: GraphNode = { id: 'file_B', label: 'FILE', name: 'app.ts', path: '/src/app.ts', relativePath: 'src/app.ts', extension: '.ts', language: 'typescript', size: 0, createdAt: 0, modifiedAt: 0, isParsed: false };

		await store.createNode(nodeA);
		await store.createNode(nodeB);

		const edge: GraphEdge = {
			source: 'dir_A',
			target: 'file_B',
			type: 'CONTAINS'
		};
		await store.createEdge(edge);

		const { nodes, edges } = await store.getAllNodesAndEdges();

		assert.strictEqual(nodes.length, 2, 'Should retrieve exactly 2 nodes');
		assert.strictEqual(edges.length, 1, 'Should retrieve exactly 1 edge');

		assert.strictEqual(edges[0].source, 'dir_A', 'Edge source ID should map correctly');
		assert.strictEqual(edges[0].target, 'file_B', 'Edge target ID should map correctly');
		assert.strictEqual(edges[0].type, 'CONTAINS', 'Edge type should map correctly');
	});
});
