import { describe, it, expect, beforeEach, mock } from 'bun:test';
import * as path from 'path';
import * as fs from 'fs';
import { CallResolver } from '../../../../src/graph/cpg/CallResolver';
import type { IGraphStore } from '../../../../src/types/storage';

// ---------------------------------------------------------------------------
// Mock IGraphStore
// ---------------------------------------------------------------------------

function makeStore(queryResults: any[] = []): IGraphStore & { queryCalls: Array<[string, any]> } {
    let callIndex = 0;
    const queryCalls: Array<[string, any]> = [];

    return {
        queryCalls,
        query: mock(async (cypher: string, params?: Record<string, any>) => {
            queryCalls.push([cypher, params ?? {}]);
            const raw = queryResults[callIndex] ?? [];
            callIndex++;
            return Array.isArray(raw) ? { data: raw } : raw;
        }),
        connect: mock(async () => {}),
        close: mock(async () => {}),
        createNode: mock(async () => {}),
        createEdge: mock(async () => {}),
        deleteNode: mock(async () => {}),
        updateNode: mock(async () => {}),
        getAllNodesAndEdges: mock(async () => ({ nodes: [], edges: [] })),
        clearGraph: mock(async () => {}),
        createNodes: mock(async () => {}),
        createEdges: mock(async () => {}),
        deleteNodes: mock(async () => {}),
        replaceFileSubgraph: mock(async () => {}),
    } as any;
}

// ---------------------------------------------------------------------------
// Helpers: set up a temp directory with real .py files on disk
// ---------------------------------------------------------------------------

function setupPythonProject(tmpDir: string): {
    workspaceRoot: string;
    serverPy: string;
    servicePy: string;
    enginePy: string;
} {
    const workspaceRoot = tmpDir;
    const srcDir = path.join(workspaceRoot, 'src');
    const apiDir = path.join(srcDir, 'api');
    const servicesDir = path.join(srcDir, 'services');
    const dbDir = path.join(srcDir, 'database');

    fs.mkdirSync(apiDir, { recursive: true });
    fs.mkdirSync(servicesDir, { recursive: true });
    fs.mkdirSync(dbDir, { recursive: true });

    const serverPy = path.join(apiDir, 'server.py');
    const servicePy = path.join(servicesDir, 'service.py');
    const enginePy = path.join(dbDir, 'engine.py');

    fs.writeFileSync(serverPy, '');
    fs.writeFileSync(servicePy, '');
    fs.writeFileSync(enginePy, '');

    return { workspaceRoot, serverPy, servicePy, enginePy };
}

// ---------------------------------------------------------------------------
// Test: stale CALL edges are deleted first
// ---------------------------------------------------------------------------

describe('CallResolver.resolveCallsForFile — stale edge deletion', () => {
    const tmpDir = path.join('/tmp', `call-resolver-stale-${Date.now()}`);
    let workspaceRoot: string;
    let serverPy: string;

    beforeEach(() => {
        const proj = setupPythonProject(tmpDir);
        workspaceRoot = proj.workspaceRoot;
        serverPy = proj.serverPy;
    });

    it('first query deletes stale CALL edges for the file', async () => {
        // query(0)=stale DELETE, query(1)=import CALL nodes (empty), query(2)=non-import CALL nodes (empty)
        const store = makeStore([null, [], []]);
        const resolver = new CallResolver(store, workspaceRoot);
        await resolver.resolveCallsForFile(serverPy);

        expect(store.queryCalls.length).toBeGreaterThanOrEqual(3);
        const [firstCypher, firstParams] = store.queryCalls[0];
        expect(firstCypher).toContain('DELETE r');
        expect(firstParams.filePath).toBe(serverPy);
    });
});

// ---------------------------------------------------------------------------
// Test: dotted module call resolves (service.get_hello_message → METHOD)
// ---------------------------------------------------------------------------

describe('CallResolver.resolveCallsForFile — dotted module call', () => {
    const tmpDir = path.join('/tmp', `call-resolver-dotted-${Date.now()}`);
    let workspaceRoot: string;
    let serverPy: string;
    let servicePy: string;

    beforeEach(() => {
        const proj = setupPythonProject(tmpDir);
        workspaceRoot = proj.workspaceRoot;
        serverPy = proj.serverPy;
        servicePy = proj.servicePy;
    });

    it('creates CALL edge from service.get_hello_message to METHOD node in service.py', async () => {
        const callNodeId = `${serverPy}:CALL:10:4`;
        const methodNodeId = `${servicePy}:METHOD:5:0`;

        // Import CALL node that establishes the alias
        const importNodes = [{ code: 'from src.services import service' }];
        // Non-import CALL node for service.get_hello_message
        const callNodes = [{ id: callNodeId, name: 'service.get_hello_message' }];

        // query sequence:
        //   (0) stale CALL edge DELETE
        //   (1) fetch import CALL nodes  → importNodes
        //   (2) fetch non-import CALL nodes → callNodes
        //   (3) lookup METHOD m.name='get_hello_message' in servicePy → [{ id: methodNodeId }]
        //   (4) MERGE CALL edge
        const store = makeStore([null, importNodes, callNodes, [{ id: methodNodeId }], null]);
        const resolver = new CallResolver(store, workspaceRoot);
        await resolver.resolveCallsForFile(serverPy);

        // Verify METHOD lookup was issued for the correct file and method name
        const methodLookup = store.queryCalls.find(
            ([cypher, params]) =>
                cypher.includes("m.label = 'METHOD'") &&
                params.targetFilePath === servicePy &&
                params.methodName === 'get_hello_message',
        );
        expect(methodLookup).toBeDefined();

        // Verify CALL edge MERGE was issued
        const mergeCall = store.queryCalls.find(
            ([cypher, params]) =>
                cypher.includes('MERGE (s)-[:CALL]->') &&
                params.callId === callNodeId &&
                params.targetId === methodNodeId,
        );
        expect(mergeCall).toBeDefined();
    });
});

// ---------------------------------------------------------------------------
// Test: direct function import (get_db) resolves
// ---------------------------------------------------------------------------

describe('CallResolver.resolveCallsForFile — direct function import', () => {
    const tmpDir = path.join('/tmp', `call-resolver-direct-${Date.now()}`);
    let workspaceRoot: string;
    let serverPy: string;
    let enginePy: string;

    beforeEach(() => {
        const proj = setupPythonProject(tmpDir);
        workspaceRoot = proj.workspaceRoot;
        serverPy = proj.serverPy;
        enginePy = proj.enginePy;
    });

    it('creates CALL edge for directly imported function get_db', async () => {
        const callNodeId = `${serverPy}:CALL:15:4`;
        const methodNodeId = `${enginePy}:METHOD:3:0`;

        const importNodes = [{ code: 'from src.database.engine import get_db' }];
        const callNodes = [{ id: callNodeId, name: 'get_db' }];

        // query sequence:
        //   (0) stale DELETE
        //   (1) import CALL nodes → importNodes
        //   (2) non-import CALL nodes → callNodes
        //   (3) METHOD lookup for 'get_db' in enginePy → [{ id: methodNodeId }]
        //   (4) MERGE CALL edge
        const store = makeStore([null, importNodes, callNodes, [{ id: methodNodeId }], null]);
        const resolver = new CallResolver(store, workspaceRoot);
        await resolver.resolveCallsForFile(serverPy);

        const methodLookup = store.queryCalls.find(
            ([cypher, params]) =>
                cypher.includes("m.label = 'METHOD'") &&
                params.targetFilePath === enginePy &&
                params.methodName === 'get_db',
        );
        expect(methodLookup).toBeDefined();

        const mergeCall = store.queryCalls.find(
            ([cypher, params]) =>
                cypher.includes('MERGE (s)-[:CALL]->') &&
                params.targetId === methodNodeId,
        );
        expect(mergeCall).toBeDefined();
    });
});

// ---------------------------------------------------------------------------
// Test: external/unresolvable call creates no CALL edge
// ---------------------------------------------------------------------------

describe('CallResolver.resolveCallsForFile — external unresolvable call', () => {
    const tmpDir = path.join('/tmp', `call-resolver-external-${Date.now()}`);
    let workspaceRoot: string;
    let serverPy: string;

    beforeEach(() => {
        const proj = setupPythonProject(tmpDir);
        workspaceRoot = proj.workspaceRoot;
        serverPy = proj.serverPy;
    });

    it('skips uvicorn.run — no matching METHOD found', async () => {
        const callNodeId = `${serverPy}:CALL:20:4`;

        // No import node for uvicorn (no alias registered)
        const importNodes: any[] = [];
        const callNodes = [{ id: callNodeId, name: 'uvicorn.run' }];

        // query sequence:
        //   (0) stale DELETE
        //   (1) import CALL nodes → empty
        //   (2) non-import CALL nodes → callNodes
        // 'uvicorn' is not in moduleAliases, so no further queries should be issued
        const store = makeStore([null, importNodes, callNodes]);
        const resolver = new CallResolver(store, workspaceRoot);
        await resolver.resolveCallsForFile(serverPy);

        // No METHOD lookup or MERGE should be issued for uvicorn.run
        const mergeCall = store.queryCalls.find(([cypher]) => cypher.includes('MERGE (s)-[:CALL]->'));
        expect(mergeCall).toBeUndefined();
    });

    it('skips call when METHOD lookup returns empty result', async () => {
        const callNodeId = `${serverPy}:CALL:10:4`;

        const importNodes = [{ code: 'from src.services import service' }];
        const callNodes = [{ id: callNodeId, name: 'service.nonexistent_fn' }];

        // METHOD lookup returns empty — no METHOD node exists for this name
        const store = makeStore([null, importNodes, callNodes, []]);
        const resolver = new CallResolver(store, workspaceRoot);
        await resolver.resolveCallsForFile(serverPy);

        const mergeCall = store.queryCalls.find(([cypher]) => cypher.includes('MERGE (s)-[:CALL]->'));
        expect(mergeCall).toBeUndefined();
    });
});

// ---------------------------------------------------------------------------
// Test: resolveAll iterates multiple files
// ---------------------------------------------------------------------------

describe('CallResolver.resolveAll', () => {
    it('calls resolveCallsForFile for each file in the list', async () => {
        const workspaceRoot = '/tmp/call-resolver-all-test';
        // Each file: stale-delete + import-nodes-fetch (empty) + call-nodes-fetch (empty)
        const store = makeStore([null, [], [], null, [], [], null, [], []]);
        const resolver = new CallResolver(store, workspaceRoot);

        const files = ['/tmp/a.py', '/tmp/b.py', '/tmp/c.py'];
        await resolver.resolveAll(files);

        // Each file generates at least 3 queries
        expect(store.queryCalls.length).toBeGreaterThanOrEqual(files.length * 3);

        // Each file's first query should be the stale DELETE
        const deleteQueries = store.queryCalls.filter(([cypher]) => cypher.includes('DELETE r'));
        expect(deleteQueries.length).toBeGreaterThanOrEqual(files.length);
    });
});
