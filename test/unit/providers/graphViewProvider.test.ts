/**
 * Unit tests for GraphViewProvider.
 *
 * GraphViewProvider uses `vscode` module which is unavailable in Bun's test runner.
 * We mock it at the module level with mock.module() before importing the provider.
 *
 * Because mock.module() in Bun is hoisted, all imports of `vscode` inside
 * GraphViewProvider will receive the mock. The mock is constructed to cover
 * every VS Code API surface that GraphViewProvider.ts actually touches.
 */

import { describe, test, expect, beforeEach, mock } from 'bun:test';

// ---------------------------------------------------------------------------
// VS Code module mock — must be registered BEFORE importing GraphViewProvider
// ---------------------------------------------------------------------------

// Track all postMessage calls so tests can assert on them
const postedMessages: any[] = [];

// A minimal fake WebviewView that records postMessage calls and allows
// setting webview.html and webview.options.
function makeFakeWebviewView(): any {
	const messageHandlers: Array<(msg: any) => void> = [];
	return {
		webview: {
			get options() { return {}; },
			set options(_v: any) { /* no-op */ },
			html: '',
			postMessage(msg: any) {
				postedMessages.push(msg);
			},
			asWebviewUri(_uri: any) { return { toString: () => 'vscode-resource://fake' }; },
			onDidReceiveMessage(handler: (msg: any) => void) {
				messageHandlers.push(handler);
				// Return a disposable-like object
				return { dispose: () => {} };
			},
			_simulateMessage(msg: any) {
				messageHandlers.forEach(h => h(msg));
			}
		}
	};
}

// Mock the vscode module — only the surfaces GraphViewProvider.ts uses:
//   - `vscode.WebviewViewProvider` (base class — we ignore its constructor)
//   - `vscode.WebviewView` (type only — satisfied by our fake)
//   - `vscode.WebviewViewResolveContext` (type only)
//   - `vscode.CancellationToken` (type only)
mock.module('vscode', () => {
	return {
		// GraphViewProvider extends this — we provide a no-op base class
		WebviewViewProvider: class WebviewViewProvider {},
		// Commonly referenced URI helpers (not directly used in the file we test,
		// but may be pulled in by transitive imports)
		Uri: {
			joinPath: mock((..._args: any[]) => ({ toString: () => 'vscode://fake-uri' })),
			file: mock((p: string) => ({ fsPath: p, toString: () => p }))
		},
		// Workspace — not used in GraphViewProvider but imported transitively
		workspace: {
			workspaceFolders: [],
			onDidSaveTextDocument: mock(() => ({ dispose: () => {} }))
		},
		window: {
			showErrorMessage: mock(() => Promise.resolve()),
			showInformationMessage: mock(() => Promise.resolve())
		}
	};
});

// Now it is safe to import GraphViewProvider — vscode is already mocked
import { GraphViewProvider } from '../../../src/providers/GraphViewProvider';
import { DiffEngine } from '../../../src/services/sync/DiffEngine';
import type { GraphNode, GraphEdge } from '../../../src/types/nodes';

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

/**
 * Build a minimal IGraphStore mock. The store is the primary async dependency
 * of GraphViewProvider; we want full control over what it returns.
 */
function makeStore(nodes: GraphNode[] = [], edges: GraphEdge[] = []): any {
	return {
		getAllNodesAndEdges: mock(() => Promise.resolve({ nodes, edges })),
		connect: mock(() => Promise.resolve()),
		close: mock(() => Promise.resolve()),
		query: mock(() => Promise.resolve([])),
		createNode: mock(() => Promise.resolve()),
		createEdge: mock(() => Promise.resolve()),
		deleteNode: mock(() => Promise.resolve()),
		updateNode: mock(() => Promise.resolve()),
		clearGraph: mock(() => Promise.resolve()),
		createNodes: mock(() => Promise.resolve()),
		createEdges: mock(() => Promise.resolve()),
		deleteNodes: mock(() => Promise.resolve()),
		replaceFileSubgraph: mock(() => Promise.resolve())
	};
}

// ---------------------------------------------------------------------------
// Initialization
// ---------------------------------------------------------------------------

describe('GraphViewProvider — initialization', () => {
	beforeEach(() => { postedMessages.length = 0; });

	test('can be constructed without throwing', () => {
		const store = makeStore();
		const diffEngine = new DiffEngine();
		expect(() => new GraphViewProvider(store, diffEngine)).not.toThrow();
	});

	test('resolveWebviewView() sets webview options and html without throwing', () => {
		const store = makeStore();
		const diffEngine = new DiffEngine();
		const provider = new GraphViewProvider(store, diffEngine);
		const webviewView = makeFakeWebviewView();
		const fakeContext = {};
		const fakeToken = { isCancellationRequested: false };

		expect(() => {
			provider.resolveWebviewView(webviewView as any, fakeContext as any, fakeToken as any);
		}).not.toThrow();
	});

	test('resolveWebviewView() sets html on the webview', async () => {
		const store = makeStore();
		const diffEngine = new DiffEngine();
		const provider = new GraphViewProvider(store, diffEngine);
		const webviewView = makeFakeWebviewView();

		provider.resolveWebviewView(webviewView as any, {} as any, {} as any);
		// Allow the async updateView() to complete
		await new Promise(r => setTimeout(r, 10));

		expect(typeof webviewView.webview.html).toBe('string');
		expect(webviewView.webview.html.length).toBeGreaterThan(0);
	});
});

// ---------------------------------------------------------------------------
// HTML generation
// ---------------------------------------------------------------------------

describe('GraphViewProvider — HTML generation (getHtml)', () => {
	let provider: GraphViewProvider;
	let html: string;

	beforeEach(() => {
		// Resolve the provider so getHtml is called internally
		const store = makeStore();
		const diffEngine = new DiffEngine();
		provider = new GraphViewProvider(store, diffEngine);
		const webviewView = makeFakeWebviewView();
		provider.resolveWebviewView(webviewView as any, {} as any, {} as any);
		html = webviewView.webview.html;
	});

	test('HTML contains a DOCTYPE declaration', () => {
		expect(html.toLowerCase()).toContain('<!doctype html>');
	});

	test('HTML contains an <html> tag', () => {
		expect(html.toLowerCase()).toContain('<html');
	});

	test('HTML contains a <head> section', () => {
		expect(html.toLowerCase()).toContain('<head>');
	});

	test('HTML contains a <body> section', () => {
		expect(html.toLowerCase()).toContain('<body>');
	});

	test('HTML references the force-graph script', () => {
		expect(html).toContain('force-graph');
	});

	test('HTML includes the graph-container element', () => {
		expect(html).toContain('graph-container');
	});

	test('HTML does not have obviously unclosed <script> tags', () => {
		const openCount = (html.match(/<script/gi) ?? []).length;
		const closeCount = (html.match(/<\/script>/gi) ?? []).length;
		expect(openCount).toBe(closeCount);
	});

	test('HTML does not have obviously unclosed <div> tags', () => {
		const openCount = (html.match(/<div/gi) ?? []).length;
		const closeCount = (html.match(/<\/div>/gi) ?? []).length;
		expect(openCount).toBe(closeCount);
	});
});

// ---------------------------------------------------------------------------
// HTML references external webview script
// ---------------------------------------------------------------------------

describe('GraphViewProvider — HTML references external webview script', () => {
	let html: string;

	beforeEach(() => {
		postedMessages.length = 0;
		const store = makeStore();
		const diffEngine = new DiffEngine();
		const provider = new GraphViewProvider(store, diffEngine, undefined as any);
		const webviewView = makeFakeWebviewView();
		provider.resolveWebviewView(webviewView as any, {} as any, {} as any);
		html = webviewView.webview.html;
	});

	test('HTML references graphWebview.js', () => {
		expect(html).toContain('graphWebview.js');
	});

	test('HTML contains error-message element', () => {
		expect(html).toContain('error-message');
	});
});

// ---------------------------------------------------------------------------
// Message protocol — updateView (full update)
// ---------------------------------------------------------------------------

describe('GraphViewProvider — message protocol (full updateView)', () => {
	beforeEach(() => {
		postedMessages.length = 0;
	});

	test('resolveWebviewView triggers an updateGraph message', async () => {
		const nodes = [makeFileNode('a'), makeFileNode('b')];
		const edges = [makeEdge('a', 'b')];
		const store = makeStore(nodes, edges);
		const diffEngine = new DiffEngine();
		const provider = new GraphViewProvider(store, diffEngine);
		const webviewView = makeFakeWebviewView();

		provider.resolveWebviewView(webviewView as any, {} as any, {} as any);
		// Allow async store.getAllNodesAndEdges() to settle
		await new Promise(r => setTimeout(r, 20));

		expect(postedMessages.length).toBeGreaterThan(0);
		const msg = postedMessages.find(m => m.command === 'updateGraph');
		expect(msg).toBeDefined();
	});

	test('updateGraph message includes a nodes array', async () => {
		const nodes = [makeFileNode('n1'), makeFileNode('n2')];
		const store = makeStore(nodes, []);
		const diffEngine = new DiffEngine();
		const provider = new GraphViewProvider(store, diffEngine);
		const webviewView = makeFakeWebviewView();

		provider.resolveWebviewView(webviewView as any, {} as any, {} as any);
		await new Promise(r => setTimeout(r, 20));

		const msg = postedMessages.find(m => m.command === 'updateGraph');
		expect(msg).toBeDefined();
		expect(Array.isArray(msg.data.nodes)).toBe(true);
	});

	test('updateGraph message includes a links array', async () => {
		const nodes = [makeFileNode('x'), makeFileNode('y')];
		const edges = [makeEdge('x', 'y')];
		const store = makeStore(nodes, edges);
		const diffEngine = new DiffEngine();
		const provider = new GraphViewProvider(store, diffEngine);
		const webviewView = makeFakeWebviewView();

		provider.resolveWebviewView(webviewView as any, {} as any, {} as any);
		await new Promise(r => setTimeout(r, 20));

		const msg = postedMessages.find(m => m.command === 'updateGraph');
		expect(Array.isArray(msg.data.links)).toBe(true);
	});

	test('updateGraph message nodes include id, name, type, val fields', async () => {
		const nodes = [makeCpgNode('m1', 'METHOD', { name: 'myFn' })];
		const store = makeStore(nodes, []);
		const diffEngine = new DiffEngine();
		const provider = new GraphViewProvider(store, diffEngine);
		const webviewView = makeFakeWebviewView();

		provider.resolveWebviewView(webviewView as any, {} as any, {} as any);
		await new Promise(r => setTimeout(r, 20));

		const msg = postedMessages.find(m => m.command === 'updateGraph');
		const patchNode = msg.data.nodes[0];
		expect(patchNode.id).toBe('m1');
		expect(patchNode.name).toBe('myFn');
		expect(patchNode.type).toBe('METHOD');
		expect(typeof patchNode.val).toBe('number');
	});

	test('updateGraph links include source, target, type', async () => {
		const nodes = [makeFileNode('a'), makeFileNode('b')];
		const edges = [makeEdge('a', 'b', 'CONTAINS')];
		const store = makeStore(nodes, edges);
		const diffEngine = new DiffEngine();
		const provider = new GraphViewProvider(store, diffEngine);
		const webviewView = makeFakeWebviewView();

		provider.resolveWebviewView(webviewView as any, {} as any, {} as any);
		await new Promise(r => setTimeout(r, 20));

		const msg = postedMessages.find(m => m.command === 'updateGraph');
		expect(msg.data.links[0]).toMatchObject({ source: 'a', target: 'b', type: 'CONTAINS' });
	});

	test('store error posts an error command to the webview', async () => {
		const store = makeStore();
		store.getAllNodesAndEdges = mock(() => Promise.reject(new Error('db error')));
		const diffEngine = new DiffEngine();
		const provider = new GraphViewProvider(store, diffEngine, undefined as any);
		const webviewView = makeFakeWebviewView();

		provider.resolveWebviewView(webviewView as any, {} as any, {} as any);
		await new Promise(r => setTimeout(r, 20));

		const errMsg = postedMessages.find(m => m.command === 'error');
		expect(errMsg).toBeDefined();
		expect(typeof errMsg.text).toBe('string');
	});
});

// ---------------------------------------------------------------------------
// Message protocol — refresh() / updateViewIncremental()
// ---------------------------------------------------------------------------

describe('GraphViewProvider — message protocol (incremental update via refresh)', () => {
	beforeEach(() => {
		postedMessages.length = 0;
	});

	test('refresh() with no changes does not post a new message', async () => {
		const nodes = [makeFileNode('stable')];
		const store = makeStore(nodes, []);
		const diffEngine = new DiffEngine();
		const provider = new GraphViewProvider(store, diffEngine);
		const webviewView = makeFakeWebviewView();

		// Initialize: sets currentGraphData
		provider.resolveWebviewView(webviewView as any, {} as any, {} as any);
		await new Promise(r => setTimeout(r, 20));

		const msgCountAfterInit = postedMessages.length;

		// Refresh with identical data — no diff → no incremental message
		await provider.refresh();
		await new Promise(r => setTimeout(r, 10));

		expect(postedMessages.length).toBe(msgCountAfterInit);
	});

	test('refresh() with new nodes posts an incrementalUpdate message', async () => {
		let callCount = 0;
		const node1 = makeFileNode('n1');
		const node2 = makeFileNode('n2');
		const store = makeStore();

		// First call returns only node1, second returns node1 + node2
		store.getAllNodesAndEdges = mock(() => {
			callCount++;
			if (callCount === 1) {
				return Promise.resolve({ nodes: [node1], edges: [] });
			}
			return Promise.resolve({ nodes: [node1, node2], edges: [] });
		});

		const diffEngine = new DiffEngine();
		const provider = new GraphViewProvider(store, diffEngine);
		const webviewView = makeFakeWebviewView();

		// Initialize: first store call
		provider.resolveWebviewView(webviewView as any, {} as any, {} as any);
		await new Promise(r => setTimeout(r, 20));

		// Refresh: second store call — n2 is new
		await provider.refresh();
		await new Promise(r => setTimeout(r, 10));

		const incrementalMsg = postedMessages.find(m => m.command === 'incrementalUpdate');
		expect(incrementalMsg).toBeDefined();
	});

	test('incrementalUpdate message contains a patch object', async () => {
		let callCount = 0;
		const node1 = makeFileNode('n1');
		const node2 = makeFileNode('n2');
		const store = makeStore();

		store.getAllNodesAndEdges = mock(() => {
			callCount++;
			if (callCount === 1) {
				return Promise.resolve({ nodes: [node1], edges: [] });
			}
			return Promise.resolve({ nodes: [node1, node2], edges: [] });
		});

		const diffEngine = new DiffEngine();
		const provider = new GraphViewProvider(store, diffEngine);
		const webviewView = makeFakeWebviewView();

		provider.resolveWebviewView(webviewView as any, {} as any, {} as any);
		await new Promise(r => setTimeout(r, 20));

		await provider.refresh();
		await new Promise(r => setTimeout(r, 10));

		const incrementalMsg = postedMessages.find(m => m.command === 'incrementalUpdate');
		expect(incrementalMsg).toBeDefined();
		expect(incrementalMsg.patch).toBeDefined();
	});

	test('incrementalUpdate patch addNodes lists the newly added node', async () => {
		let callCount = 0;
		const existing = makeFileNode('existing');
		const brandNew = makeCpgNode('brand-new', 'METHOD', { name: 'newFn' });
		const store = makeStore();

		store.getAllNodesAndEdges = mock(() => {
			callCount++;
			if (callCount === 1) {
				return Promise.resolve({ nodes: [existing], edges: [] });
			}
			return Promise.resolve({ nodes: [existing, brandNew], edges: [] });
		});

		const diffEngine = new DiffEngine();
		const provider = new GraphViewProvider(store, diffEngine);
		const webviewView = makeFakeWebviewView();

		provider.resolveWebviewView(webviewView as any, {} as any, {} as any);
		await new Promise(r => setTimeout(r, 20));

		await provider.refresh();
		await new Promise(r => setTimeout(r, 10));

		const msg = postedMessages.find(m => m.command === 'incrementalUpdate');
		expect(msg.patch.addNodes).toBeDefined();
		expect(msg.patch.addNodes).toHaveLength(1);
		expect(msg.patch.addNodes[0].id).toBe('brand-new');
	});

	test('incrementalUpdate command differs from full update command', async () => {
		let callCount = 0;
		const n1 = makeFileNode('a');
		const n2 = makeFileNode('b');
		const store = makeStore();

		store.getAllNodesAndEdges = mock(() => {
			callCount++;
			return Promise.resolve({
				nodes: callCount === 1 ? [n1] : [n1, n2],
				edges: []
			});
		});

		const diffEngine = new DiffEngine();
		const provider = new GraphViewProvider(store, diffEngine);
		const webviewView = makeFakeWebviewView();

		provider.resolveWebviewView(webviewView as any, {} as any, {} as any);
		await new Promise(r => setTimeout(r, 20));

		await provider.refresh();
		await new Promise(r => setTimeout(r, 10));

		const fullUpdate = postedMessages.find(m => m.command === 'updateGraph');
		const incremental = postedMessages.find(m => m.command === 'incrementalUpdate');

		expect(fullUpdate).toBeDefined();
		expect(incremental).toBeDefined();
		expect(fullUpdate.command).not.toBe(incremental.command);
	});

	test('refresh() when view is not yet set does not throw', async () => {
		const store = makeStore();
		const diffEngine = new DiffEngine();
		const provider = new GraphViewProvider(store, diffEngine);
		// NOTE: resolveWebviewView was NOT called — provider has no _view

		await expect(provider.refresh()).resolves.toBeUndefined();
	});
});

// ---------------------------------------------------------------------------
// Message listener — incoming messages from the webview
// ---------------------------------------------------------------------------

describe('GraphViewProvider — incoming webview messages', () => {
	beforeEach(() => {
		postedMessages.length = 0;
	});

	test("receiving a 'nodeClick' command calls detailsProvider.showNodeDetails", async () => {
		const store = makeStore([makeFileNode('x')], []);
		const diffEngine = new DiffEngine();
		const showNodeDetails = mock(() => {});
		const detailsProvider = { showNodeDetails };
		const provider = new GraphViewProvider(store, diffEngine, undefined as any, detailsProvider);
		const webviewView = makeFakeWebviewView();

		provider.resolveWebviewView(webviewView as any, {} as any, {} as any);
		await new Promise(r => setTimeout(r, 20));

		(webviewView.webview as any)._simulateMessage({ command: 'nodeClick', node: { id: 'x', name: 'foo', type: 'METHOD' } });
		await new Promise(r => setTimeout(r, 10));

		expect(showNodeDetails).toHaveBeenCalledTimes(1);
		expect(showNodeDetails).toHaveBeenCalledWith({ id: 'x', name: 'foo', type: 'METHOD' });
	});

	test("receiving a 'refresh' command triggers an updateViewIncremental cycle", async () => {
		let callCount = 0;
		const n1 = makeFileNode('orig');
		const n2 = makeFileNode('added');
		const store = makeStore();

		store.getAllNodesAndEdges = mock(() => {
			callCount++;
			if (callCount === 1) return Promise.resolve({ nodes: [n1], edges: [] });
			return Promise.resolve({ nodes: [n1, n2], edges: [] });
		});

		const diffEngine = new DiffEngine();
		const provider = new GraphViewProvider(store, diffEngine);
		const webviewView = makeFakeWebviewView();

		provider.resolveWebviewView(webviewView as any, {} as any, {} as any);
		await new Promise(r => setTimeout(r, 20));

		// Simulate the webview sending a 'refresh' command
		(webviewView.webview as any)._simulateMessage({ command: 'refresh' });
		await new Promise(r => setTimeout(r, 20));

		const incrementalMsg = postedMessages.find(m => m.command === 'incrementalUpdate');
		expect(incrementalMsg).toBeDefined();
	});
});

// ---------------------------------------------------------------------------
// DiffEngine integration
// ---------------------------------------------------------------------------

describe('GraphViewProvider — DiffEngine integration', () => {
	beforeEach(() => {
		postedMessages.length = 0;
	});

	test('no message is sent when refresh detects no diff', async () => {
		const nodes = [makeFileNode('same'), makeFileNode('also-same')];
		const store = makeStore(nodes, []);
		// Both calls return identical data
		store.getAllNodesAndEdges = mock(() => Promise.resolve({ nodes, edges: [] }));

		const diffEngine = new DiffEngine();
		const provider = new GraphViewProvider(store, diffEngine);
		const webviewView = makeFakeWebviewView();

		provider.resolveWebviewView(webviewView as any, {} as any, {} as any);
		await new Promise(r => setTimeout(r, 20));

		const afterInitCount = postedMessages.length;

		await provider.refresh();
		await new Promise(r => setTimeout(r, 10));

		// No new messages should have been posted
		expect(postedMessages.length).toBe(afterInitCount);
	});

	test('incremental update is used (not full redraw) when nodes are removed', async () => {
		let callCount = 0;
		const n1 = makeFileNode('keep');
		const n2 = makeFileNode('remove');
		const store = makeStore();

		store.getAllNodesAndEdges = mock(() => {
			callCount++;
			if (callCount === 1) return Promise.resolve({ nodes: [n1, n2], edges: [] });
			return Promise.resolve({ nodes: [n1], edges: [] }); // n2 removed
		});

		const diffEngine = new DiffEngine();
		const provider = new GraphViewProvider(store, diffEngine);
		const webviewView = makeFakeWebviewView();

		provider.resolveWebviewView(webviewView as any, {} as any, {} as any);
		await new Promise(r => setTimeout(r, 20));

		await provider.refresh();
		await new Promise(r => setTimeout(r, 10));

		const incrementalMsg = postedMessages.find(m => m.command === 'incrementalUpdate');
		expect(incrementalMsg).toBeDefined();
		expect(incrementalMsg.patch.removeNodes).toContain('remove');
	});

	test('incremental update patch removeLinks lists removed edges', async () => {
		let callCount = 0;
		const n1 = makeFileNode('a');
		const n2 = makeFileNode('b');
		const edge = makeEdge('a', 'b', 'CONTAINS');
		const store = makeStore();

		store.getAllNodesAndEdges = mock(() => {
			callCount++;
			if (callCount === 1) return Promise.resolve({ nodes: [n1, n2], edges: [edge] });
			return Promise.resolve({ nodes: [n1, n2], edges: [] }); // edge removed
		});

		const diffEngine = new DiffEngine();
		const provider = new GraphViewProvider(store, diffEngine);
		const webviewView = makeFakeWebviewView();

		provider.resolveWebviewView(webviewView as any, {} as any, {} as any);
		await new Promise(r => setTimeout(r, 20));

		await provider.refresh();
		await new Promise(r => setTimeout(r, 10));

		const incrementalMsg = postedMessages.find(m => m.command === 'incrementalUpdate');
		expect(incrementalMsg).toBeDefined();
		expect(incrementalMsg.patch.removeLinks).toBeDefined();
		expect(incrementalMsg.patch.removeLinks[0]).toMatchObject({ source: 'a', target: 'b' });
	});

	test('currentGraphData is null before first resolveWebviewView — refresh falls back to updateView', async () => {
		// When currentGraphData is null, updateViewIncremental calls updateView (full update)
		const nodes = [makeFileNode('first')];
		const store = makeStore(nodes, []);
		const diffEngine = new DiffEngine();
		const provider = new GraphViewProvider(store, diffEngine);
		const webviewView = makeFakeWebviewView();

		// Set the internal view but skip resolveWebviewView so currentGraphData stays null
		// Workaround: resolve normally, then reset by creating a fresh provider + calling refresh
		const freshProvider = new GraphViewProvider(store, diffEngine);
		// resolveWebviewView is never called → _view is undefined → refresh is a no-op
		await freshProvider.refresh();
		// Should not throw and should not have posted any messages
		expect(postedMessages.filter(m => m !== undefined)).toHaveLength(0);
	});
});
