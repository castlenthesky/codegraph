import * as assert from 'assert';
import * as vscode from 'vscode';
import { Reconciler } from '../services/sync/Reconciler';
import { FalkorDBStore } from '../services/storage/FalkorDBStore';

suite('Reconciler Integration Test Suite', () => {
	let reconciler: Reconciler;
	let store: FalkorDBStore;

	setup(async () => {
		store = new FalkorDBStore();
		// Provide a no-op IGraphViewProvider for testing
		const mockView = { refresh: async () => {} };
		reconciler = new Reconciler(store, mockView);
		await store.connect();
		await store.clearGraph();
	});

	teardown(async () => {
		await store.clearGraph();
	});

	test('findOrphanNodes accurately detects missing FILE and DIRECTORY nodes', async () => {
		await store.createNode({
			id: 'mock_fake_file', label: 'FILE', name: 'missing.ts',
			path: '/var/tmp/non_existent.ts', relativePath: 'non_existent.ts', extension: '.ts',
			language: 'typescript', size: 0, createdAt: 0, modifiedAt: 0, isParsed: false
		});

		await store.createNode({
			id: 'mock_fake_dir', label: 'DIRECTORY', name: 'ghost_dir',
			path: '/var/tmp/ghost_dir', relativePath: 'ghost_dir', createdAt: 0, modifiedAt: 0
		});

		const syncTools = reconciler as any;
		const orphans = await syncTools.findOrphanNodes();

		assert.strictEqual(orphans.length, 2, 'Should have flagged exactly 2 nodes as orphaned');
		assert.ok(orphans.includes('mock_fake_file'), 'Orphaned FILE missing');
		assert.ok(orphans.includes('mock_fake_dir'), 'Orphaned DIRECTORY missing');
	});
});
