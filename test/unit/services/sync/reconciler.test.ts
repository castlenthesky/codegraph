/**
 * Unit tests for Reconciler.
 *
 * Verifies that findOrphanNodes, findMissingFiles, and verifyFileMetadata
 * only operate on filesystem nodes (those with `path IS NOT NULL`) and that
 * reconcileInBackground only refreshes the graph view when changes occurred.
 *
 * vscode is unavailable in Bun's test runner, so we mock it before importing.
 */

import { describe, test, expect, beforeEach, mock, spyOn } from 'bun:test';

// ---------------------------------------------------------------------------
// VS Code mock — must be registered before importing Reconciler
// ---------------------------------------------------------------------------

mock.module('vscode', () => ({
	workspace: {
		workspaceFolders: [{ uri: { fsPath: '/workspace' } }],
		getConfiguration: () => ({
			get: (_key: string, defaultVal: string) => defaultVal
		})
	},
	window: {
		withProgress: async (_opts: unknown, fn: (p: { report: () => void }) => Promise<void>) => {
			await fn({ report: () => {} });
		},
		showInformationMessage: mock(() => {}),
		showErrorMessage: mock(() => {}),
		showWarningMessage: mock(() => {})
	},
	ProgressLocation: { Notification: 15 }
}));

// ---------------------------------------------------------------------------
// fs mock — intercept existsSync and statSync for all tests
// ---------------------------------------------------------------------------

// Default implementations that tests override per-scenario.
let _existsSyncImpl: (p: any) => boolean = () => true;
let _statSyncImpl: (p: any) => any = () => ({ size: 100, mtimeMs: 1000, isDirectory: () => false, isFile: () => true });
let _readdirSyncImpl: (p: any, _opts?: any) => any[] = () => [];

mock.module('fs', () => ({
	existsSync: (p: any) => _existsSyncImpl(p),
	statSync: (p: any) => _statSyncImpl(p),
	readdirSync: (p: any, opts?: any) => _readdirSyncImpl(p, opts)
}));

// Now it is safe to import — vscode and fs are already mocked
import { Reconciler } from '../../../../src/services/sync/Reconciler';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeStore(queryResults: Record<string, { data: any[] }> = {}) {
	return {
		connect: async () => {},
		query: async (cypher: string) => {
			for (const [key, result] of Object.entries(queryResults)) {
				if (cypher.includes(key)) {
					return result;
				}
			}
			return { data: [] };
		},
		getAllNodesAndEdges: async () => ({ nodes: [], edges: [] }),
		createNode: async () => {},
		createEdge: async () => {},
		updateNode: async () => {},
		deleteNode: async () => {}
	};
}

function makeGraphView() {
	return { refresh: mock(async () => {}) };
}

// ---------------------------------------------------------------------------
// findOrphanNodes — only filesystem FILE/DIRECTORY nodes (path IS NOT NULL)
// ---------------------------------------------------------------------------

describe('Reconciler.findOrphanNodes — filesystem nodes only', () => {
	beforeEach(() => {
		_existsSyncImpl = () => true;
		_statSyncImpl = () => ({ size: 100, mtimeMs: 1000, isDirectory: () => false, isFile: () => true });
		_readdirSyncImpl = () => [];
	});

	test('CPG FILE nodes with null path are never treated as orphans', async () => {
		// The fixed query adds WHERE n.path IS NOT NULL so the store won't return
		// null-path rows, but even if it does the null guard in the loop stops a crash.
		const store = makeStore({
			'n.path IS NOT NULL': {
				data: [
					{ id: '/workspace/src/main.py:FILE:0:0', path: null },
					{ id: 'src/main.py', path: '/workspace/src/main.py' }
				]
			}
		});

		_existsSyncImpl = (p: any) => p === '/workspace/src/main.py';

		const reconciler = new Reconciler(store as any, makeGraphView() as any);
		const orphans: string[] = await (reconciler as any).findOrphanNodes();

		// CPG node (null path) must be skipped
		expect(orphans).not.toContain('/workspace/src/main.py:FILE:0:0');
		// Real filesystem node that exists on disk must not be an orphan
		expect(orphans).not.toContain('src/main.py');
	});

	test('a real filesystem node whose file was deleted is flagged as an orphan', async () => {
		const store = makeStore({
			'n.path IS NOT NULL': {
				data: [{ id: 'src/deleted.py', path: '/workspace/src/deleted.py' }]
			}
		});

		_existsSyncImpl = () => false;

		const reconciler = new Reconciler(store as any, makeGraphView() as any);
		const orphans: string[] = await (reconciler as any).findOrphanNodes();

		expect(orphans).toContain('src/deleted.py');
	});

	test('empty-string path does not reach existsSync and is not listed as an orphan', async () => {
		const store = makeStore({
			'n.path IS NOT NULL': {
				data: [{ id: 'empty-path-node', path: '' }]
			}
		});

		const existsCalls: any[] = [];
		_existsSyncImpl = (p: any) => { existsCalls.push(p); return false; };

		const reconciler = new Reconciler(store as any, makeGraphView() as any);
		const orphans: string[] = await (reconciler as any).findOrphanNodes();

		// The null guard `if (row.path && ...)` blocks the empty string
		expect(existsCalls).not.toContain('');
		expect(orphans).toHaveLength(0);
	});

	test('only orphaned nodes (deleted from disk) are returned, existing nodes are excluded', async () => {
		const store = makeStore({
			'n.path IS NOT NULL': {
				data: [
					{ id: 'src/exists.py', path: '/workspace/src/exists.py' },
					{ id: 'src/gone.py', path: '/workspace/src/gone.py' }
				]
			}
		});

		_existsSyncImpl = (p: any) => p === '/workspace/src/exists.py';

		const reconciler = new Reconciler(store as any, makeGraphView() as any);
		const orphans: string[] = await (reconciler as any).findOrphanNodes();

		expect(orphans).toHaveLength(1);
		expect(orphans[0]).toBe('src/gone.py');
	});
});

// ---------------------------------------------------------------------------
// findMissingFiles — null paths must not pollute dbPaths
// ---------------------------------------------------------------------------

describe('Reconciler.findMissingFiles — filesystem nodes only', () => {
	beforeEach(() => {
		_existsSyncImpl = () => true;
		_readdirSyncImpl = () => [];
	});

	test('a file already tracked in the DB is not reported as missing', async () => {
		const store = makeStore({
			'n.path IS NOT NULL': {
				data: [{ path: '/workspace/src/main.py' }]
			}
		});

		_readdirSyncImpl = (_p: any, _opts?: any) => [
			{ name: 'main.py', isDirectory: () => false, isFile: () => true }
		];

		const reconciler = new Reconciler(store as any, makeGraphView() as any);
		const missing: string[] = await (reconciler as any).findMissingFiles();

		expect(missing).not.toContain('/workspace/src/main.py');
	});

	test('a file on disk that has no DB record is reported as missing', async () => {
		// DB has no records for the src folder
		const store = makeStore({
			'n.path IS NOT NULL': { data: [] }
		});

		_readdirSyncImpl = (_p: any, _opts?: any) => [
			{ name: 'new_file.py', isDirectory: () => false, isFile: () => true }
		];

		const reconciler = new Reconciler(store as any, makeGraphView() as any);
		const missing: string[] = await (reconciler as any).findMissingFiles();

		expect(missing).toContain('/workspace/src/new_file.py');
	});

	test('null paths from CPG nodes do not cause real files to appear missing', async () => {
		// If null were in dbPaths, Set.has('/workspace/src/main.py') would still work,
		// but if undefined were also present it would cause incorrect non-matches.
		// The WHERE n.path IS NOT NULL clause prevents both.
		const store = makeStore({
			'n.path IS NOT NULL': {
				// After fix: only real paths returned, no null/undefined
				data: [{ path: '/workspace/src/main.py' }]
			}
		});

		_readdirSyncImpl = (_p: any, _opts?: any) => [
			{ name: 'main.py', isDirectory: () => false, isFile: () => true }
		];

		const reconciler = new Reconciler(store as any, makeGraphView() as any);
		const missing: string[] = await (reconciler as any).findMissingFiles();

		// main.py is tracked → should NOT appear as missing
		expect(missing).toHaveLength(0);
	});
});

// ---------------------------------------------------------------------------
// smartReconciliation — only refresh when changes occurred
//
// Tests call the private smartReconciliation() directly to avoid going through
// vscode.window.withProgress, whose mock varies across the test suite.
// ---------------------------------------------------------------------------

describe('Reconciler.smartReconciliation — conditional refresh', () => {
	beforeEach(() => {
		_existsSyncImpl = () => true;
		_readdirSyncImpl = () => [];
		_statSyncImpl = () => ({ size: 100, mtimeMs: 1000, isDirectory: () => false, isFile: () => true });
	});

	test('returns false and does NOT call graphView.refresh when graph is already clean', async () => {
		const store = makeStore({
			'n.path IS NOT NULL': { data: [] },
			'f.path IS NOT NULL': { data: [] }
		});

		const graphView = makeGraphView();
		const fakeProgress = { report: () => {} };

		const reconciler = new Reconciler(store as any, graphView as any);
		const hadChanges: boolean = await (reconciler as any).smartReconciliation(fakeProgress);

		expect(hadChanges).toBe(false);
		// smartReconciliation does not call refresh — reconcileInBackground does conditionally
		expect(graphView.refresh).not.toHaveBeenCalled();
	});

	test('returns true when orphan nodes are cleaned up', async () => {
		const store = {
			connect: async () => {},
			query: async (cypher: string) => {
				if (cypher.includes('n.path IS NOT NULL')) {
					return { data: [{ id: 'src/gone.py', path: '/workspace/src/gone.py' }] };
				}
				if (cypher.includes('f.path IS NOT NULL')) {
					return { data: [] };
				}
				return { data: [] };
			},
			getAllNodesAndEdges: async () => ({ nodes: [], edges: [] }),
			createNode: async () => {},
			createEdge: async () => {},
			updateNode: async () => {},
			deleteNode: async () => {}
		};

		_existsSyncImpl = () => false; // file is gone → orphan

		const fakeProgress = { report: () => {} };
		const reconciler = new Reconciler(store as any, makeGraphView() as any);
		const hadChanges: boolean = await (reconciler as any).smartReconciliation(fakeProgress);

		expect(hadChanges).toBe(true);
	});

	test('returns true when new files are found on disk', async () => {
		// No nodes in DB
		const store = makeStore({
			'n.path IS NOT NULL': { data: [] },
			'f.path IS NOT NULL': { data: [] },
			"n.id = $id": { data: [] }
		});

		_existsSyncImpl = () => true;
		_readdirSyncImpl = (_p: any, _opts?: any) => [
			{ name: 'new.py', isDirectory: () => false, isFile: () => true }
		];
		_statSyncImpl = () => ({ size: 500, mtimeMs: 2000, isDirectory: () => false, isFile: () => true, birthtimeMs: 1000, mtimeMs: 2000 });

		const fakeProgress = { report: () => {} };
		const reconciler = new Reconciler(store as any, makeGraphView() as any);
		const hadChanges: boolean = await (reconciler as any).smartReconciliation(fakeProgress);

		expect(hadChanges).toBe(true);
	});

	test('returns false when orphans = 0 and missing = 0', async () => {
		// One file tracked in DB and present on disk
		const store = makeStore({
			'n.path IS NOT NULL': { data: [{ id: 'src/stable.py', path: '/workspace/src/stable.py' }] },
			'f.path IS NOT NULL': { data: [{ id: 'src/stable.py', path: '/workspace/src/stable.py', size: 100, modifiedAt: 1000 }] }
		});

		_existsSyncImpl = () => true;
		_readdirSyncImpl = (_p: any, _opts?: any) => [
			{ name: 'stable.py', isDirectory: () => false, isFile: () => true }
		];
		_statSyncImpl = () => ({ size: 100, mtimeMs: 1000 });

		const fakeProgress = { report: () => {} };
		const reconciler = new Reconciler(store as any, makeGraphView() as any);
		const hadChanges: boolean = await (reconciler as any).smartReconciliation(fakeProgress);

		expect(hadChanges).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// verifyFileMetadata — null path guard
// ---------------------------------------------------------------------------

describe('Reconciler.verifyFileMetadata — null path guard', () => {
	beforeEach(() => {
		_existsSyncImpl = () => false;
		_statSyncImpl = () => ({ size: 100, mtimeMs: 1000 });
	});

	test('does not throw and skips existsSync when path is null', async () => {
		const store = makeStore({
			'f.path IS NOT NULL': {
				data: [{ id: 'cpg-file', path: null, size: 0, modifiedAt: 0 }]
			}
		});

		const existsCalls: any[] = [];
		_existsSyncImpl = (p: any) => { existsCalls.push(p); return false; };

		const reconciler = new Reconciler(store as any, makeGraphView() as any);
		await expect((reconciler as any).verifyFileMetadata()).resolves.toBeUndefined();

		// null must not have reached existsSync
		expect(existsCalls).not.toContain(null);
	});

	test('updates metadata when file size differs for a real filesystem node', async () => {
		const updateCalls: Array<{ id: string; data: any }> = [];
		const store = {
			connect: async () => {},
			query: async (cypher: string) => {
				if (cypher.includes('f.path IS NOT NULL')) {
					return { data: [{ id: 'src/main.py', path: '/workspace/src/main.py', size: 100, modifiedAt: 1000 }] };
				}
				return { data: [] };
			},
			getAllNodesAndEdges: async () => ({ nodes: [], edges: [] }),
			createNode: async () => {},
			createEdge: async () => {},
			updateNode: async (id: string, data: any) => { updateCalls.push({ id, data }); },
			deleteNode: async () => {}
		};

		_existsSyncImpl = () => true;
		_statSyncImpl = () => ({ size: 999, mtimeMs: 2000 });

		const reconciler = new Reconciler(store as any, makeGraphView() as any);
		await (reconciler as any).verifyFileMetadata();

		expect(updateCalls).toHaveLength(1);
		expect(updateCalls[0].id).toBe('src/main.py');
		expect(updateCalls[0].data).toEqual({ size: 999, modifiedAt: 2000 });
	});

	test('does not update metadata when size and mtime are unchanged', async () => {
		const updateCalls: any[] = [];
		const store = {
			connect: async () => {},
			query: async (cypher: string) => {
				if (cypher.includes('f.path IS NOT NULL')) {
					return { data: [{ id: 'src/stable.py', path: '/workspace/src/stable.py', size: 100, modifiedAt: 1000 }] };
				}
				return { data: [] };
			},
			getAllNodesAndEdges: async () => ({ nodes: [], edges: [] }),
			createNode: async () => {},
			createEdge: async () => {},
			updateNode: async (id: string, data: any) => { updateCalls.push({ id, data }); },
			deleteNode: async () => {}
		};

		_existsSyncImpl = () => true;
		_statSyncImpl = () => ({ size: 100, mtimeMs: 1000 }); // identical to DB record

		const reconciler = new Reconciler(store as any, makeGraphView() as any);
		await (reconciler as any).verifyFileMetadata();

		expect(updateCalls).toHaveLength(0);
	});
});
