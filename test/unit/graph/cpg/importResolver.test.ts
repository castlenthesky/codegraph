import { describe, it, expect, beforeEach, mock } from 'bun:test';
import * as path from 'path';
import * as fs from 'fs';
import {
    ImportResolver,
    parsePythonImport,
    resolvePythonModule,
    parseTypescriptImport,
    resolveTypescriptSpecifier,
} from '../../../../src/graph/cpg/ImportResolver';
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
            // Wrap in { data: ... } to match real FalkorDB response shape
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
// parsePythonImport — unit tests (pure, no I/O)
// ---------------------------------------------------------------------------

describe('parsePythonImport', () => {
    it('parses "from api.server import app"', () => {
        const result = parsePythonImport('from api.server import app');
        expect(result).not.toBeNull();
        expect(result!.module).toBe('api.server');
        expect(result!.names).toEqual(['app']);
        expect(result!.isRelative).toBe(false);
    });

    it('parses multiple names: "from src.database.engine import get_db, engine, Base"', () => {
        const result = parsePythonImport('from src.database.engine import get_db, engine, Base');
        expect(result).not.toBeNull();
        expect(result!.module).toBe('src.database.engine');
        expect(result!.names).toEqual(['get_db', 'engine', 'Base']);
        expect(result!.isRelative).toBe(false);
    });

    it('parses relative import: "from .engine import Base"', () => {
        const result = parsePythonImport('from .engine import Base');
        expect(result).not.toBeNull();
        expect(result!.module).toBe('engine');
        expect(result!.names).toEqual(['Base']);
        expect(result!.isRelative).toBe(true);
    });

    it('parses parent-relative import: "from ..utils import helper"', () => {
        const result = parsePythonImport('from ..utils import helper');
        expect(result).not.toBeNull();
        expect(result!.module).toBe('utils');
        expect(result!.isRelative).toBe(true);
        expect(result!.names).toEqual(['helper']);
    });

    it('parses plain import: "import uvicorn"', () => {
        const result = parsePythonImport('import uvicorn');
        expect(result).not.toBeNull();
        expect(result!.module).toBe('uvicorn');
        expect(result!.names).toContain('uvicorn');
        expect(result!.isRelative).toBe(false);
    });

    it('parses aliased import: "from api.server import app as application"', () => {
        const result = parsePythonImport('from api.server import app as application');
        expect(result).not.toBeNull();
        expect(result!.names).toEqual(['app']);
    });

    it('returns null for unrecognised code', () => {
        expect(parsePythonImport('x = 1 + 2')).toBeNull();
    });
});

// ---------------------------------------------------------------------------
// parseTypescriptImport — unit tests (pure, no I/O)
// ---------------------------------------------------------------------------

describe('parseTypescriptImport', () => {
    it('parses named imports: import { Foo, Bar } from \'./bar\'', () => {
        const result = parseTypescriptImport("import { Foo, Bar } from './bar'");
        expect(result).not.toBeNull();
        expect(result!.specifier).toBe('./bar');
        expect(result!.names).toContain('Foo');
        expect(result!.names).toContain('Bar');
    });

    it('parses default import: import Foo from \'./foo\'', () => {
        const result = parseTypescriptImport("import Foo from './foo'");
        expect(result).not.toBeNull();
        expect(result!.specifier).toBe('./foo');
        expect(result!.names).toContain('Foo');
    });

    it('parses external package import: import { map } from \'lodash\'', () => {
        const result = parseTypescriptImport("import { map } from 'lodash'");
        expect(result).not.toBeNull();
        expect(result!.specifier).toBe('lodash');
    });

    it('parses aliased named import and strips alias', () => {
        const result = parseTypescriptImport("import { Foo as F } from './bar'");
        expect(result).not.toBeNull();
        expect(result!.names).toContain('Foo');
        expect(result!.names).not.toContain('F');
    });

    it('returns null for non-import lines', () => {
        expect(parseTypescriptImport('const x = 42;')).toBeNull();
    });
});

// ---------------------------------------------------------------------------
// resolvePythonModule — unit tests using real fs (temp files)
// ---------------------------------------------------------------------------

describe('resolvePythonModule', () => {
    const tmpDir = path.join('/tmp', `import-resolver-test-${Date.now()}`);
    const srcDir = path.join(tmpDir, 'src');
    const apiDir = path.join(srcDir, 'api');

    beforeEach(() => {
        fs.mkdirSync(apiDir, { recursive: true });
        fs.writeFileSync(path.join(apiDir, 'server.py'), '');
        fs.writeFileSync(path.join(srcDir, 'engine.py'), '');
    });

    it('resolves "api.server" relative to workspaceRoot/src', () => {
        const currentFile = path.join(srcDir, 'main.py');
        const result = resolvePythonModule('api.server', false, currentFile, tmpDir);
        expect(result).toBe(path.join(apiDir, 'server.py'));
    });

    it('resolves ".engine" relative import from current directory', () => {
        const currentFile = path.join(srcDir, 'database', 'models.py');
        fs.mkdirSync(path.join(srcDir, 'database'), { recursive: true });
        fs.writeFileSync(path.join(srcDir, 'database', 'engine.py'), '');

        const result = resolvePythonModule('engine', true, currentFile, tmpDir);
        expect(result).toBe(path.join(srcDir, 'database', 'engine.py'));
    });

    it('returns null for external packages that do not exist on disk', () => {
        const currentFile = path.join(srcDir, 'main.py');
        const result = resolvePythonModule('uvicorn', false, currentFile, tmpDir);
        expect(result).toBeNull();
    });
});

// ---------------------------------------------------------------------------
// resolveTypescriptSpecifier — unit tests using real fs (temp files)
// ---------------------------------------------------------------------------

describe('resolveTypescriptSpecifier', () => {
    const tmpDir = path.join('/tmp', `ts-resolver-test-${Date.now()}`);

    beforeEach(() => {
        fs.mkdirSync(path.join(tmpDir, 'utils'), { recursive: true });
        fs.writeFileSync(path.join(tmpDir, 'bar.ts'), '');
        fs.writeFileSync(path.join(tmpDir, 'utils', 'index.ts'), '');
    });

    it('resolves "./bar" to bar.ts', () => {
        const currentFile = path.join(tmpDir, 'main.ts');
        const result = resolveTypescriptSpecifier('./bar', currentFile);
        expect(result).toBe(path.join(tmpDir, 'bar.ts'));
    });

    it('resolves "./utils" to utils/index.ts', () => {
        const currentFile = path.join(tmpDir, 'main.ts');
        const result = resolveTypescriptSpecifier('./utils', currentFile);
        expect(result).toBe(path.join(tmpDir, 'utils', 'index.ts'));
    });

    it('returns null for non-existent paths', () => {
        const currentFile = path.join(tmpDir, 'main.ts');
        const result = resolveTypescriptSpecifier('./nonexistent', currentFile);
        expect(result).toBeNull();
    });
});

// ---------------------------------------------------------------------------
// ImportResolver.resolveImportsForFile — integration with mock store
// ---------------------------------------------------------------------------

describe('ImportResolver.resolveImportsForFile', () => {
    const workspaceRoot = '/tmp/workspace-import-test';
    const srcDir = path.join(workspaceRoot, 'src');
    const serverPy = path.join(srcDir, 'api', 'server.py');
    const mainPy = path.join(srcDir, 'main.py');

    beforeEach(() => {
        fs.mkdirSync(path.join(srcDir, 'api'), { recursive: true });
        // Create a fake server.py so the resolver finds it on disk
        if (!fs.existsSync(serverPy)) {
            fs.writeFileSync(serverPy, '');
        }
    });

    it('clears stale IMPORT/IMPORTS edges before resolving', async () => {
        // query(0) = stale edge delete (no return needed)
        // query(1) = fetch CALL nodes (return empty so nothing further happens)
        const store = makeStore([null, []]);
        const resolver = new ImportResolver(store, workspaceRoot);
        await resolver.resolveImportsForFile(mainPy);

        expect(store.queryCalls.length).toBeGreaterThanOrEqual(2);
        const [firstCypher, firstParams] = store.queryCalls[0];
        expect(firstCypher).toContain('DELETE r');
        expect(firstParams.filePath).toBe(mainPy);
    });

    it('skips external package imports (no target file on disk)', async () => {
        const callNodes = [{ id: 'main.py:CALL:1:0', code: 'import uvicorn' }];
        // query(0) = stale delete, query(1) = CALL nodes fetch
        const store = makeStore([null, callNodes]);
        const resolver = new ImportResolver(store, workspaceRoot);
        await resolver.resolveImportsForFile(mainPy);

        // Should only have the 2 initial queries — no edge creation queries
        expect(store.queryCalls).toHaveLength(2);
    });

    it('creates FILE→FILE IMPORTS edge and CALL→METHOD IMPORT edge for resolvable import', async () => {
        // Set up real files so fs.existsSync passes
        const targetId = `${serverPy}:METHOD:5:0`;
        const callNodes = [{ id: `${mainPy}:CALL:1:0`, code: 'from api.server import app' }];

        // query sequence: stale-delete, fetch-calls, file→file merge, lookup METHOD, create IMPORT edge
        const store = makeStore([null, callNodes, null, [{ id: targetId }], null]);
        const resolver = new ImportResolver(store, workspaceRoot);
        await resolver.resolveImportsForFile(mainPy);

        // Verify FILE→FILE IMPORTS edge query (MERGE (sf)-[:IMPORTS]-> pattern)
        const fileToFileQuery = store.queryCalls.find(([cypher]) => cypher.includes('MERGE (sf)-[:IMPORTS]->'));
        expect(fileToFileQuery).toBeDefined();
        expect(fileToFileQuery![1].targetFilePath).toBe(serverPy);

        // Verify CALL→METHOD IMPORT edge query
        const importEdgeQuery = store.queryCalls.find(([cypher]) => cypher.includes('MERGE (s)-[:IMPORT]->'));
        expect(importEdgeQuery).toBeDefined();
        expect(importEdgeQuery![1].targetId).toBe(targetId);
    });

    it('does not create IMPORT edge when no matching METHOD/TYPE_DECL found in target file', async () => {
        const callNodes = [{ id: `${mainPy}:CALL:1:0`, code: 'from api.server import app' }];

        // Method lookup returns empty array
        const store = makeStore([null, callNodes, null, []]);
        const resolver = new ImportResolver(store, workspaceRoot);
        await resolver.resolveImportsForFile(mainPy);

        const importEdgeQuery = store.queryCalls.find(([cypher]) => cypher.includes('MERGE (s)-[:IMPORT]->'));
        expect(importEdgeQuery).toBeUndefined();
    });
});

// ---------------------------------------------------------------------------
// ImportResolver.resolveAll
// ---------------------------------------------------------------------------

describe('ImportResolver.resolveAll', () => {
    it('calls resolveImportsForFile for each file in the list', async () => {
        const workspaceRoot = '/tmp/resolve-all-test';
        const store = makeStore(
            // Each file: stale-delete + call-node-fetch (returns empty)
            [null, [], null, [], null, []]
        );
        const resolver = new ImportResolver(store, workspaceRoot);

        const files = ['/tmp/a.py', '/tmp/b.py', '/tmp/c.py'];
        await resolver.resolveAll(files);

        // Each file gets at least 2 queries (stale-delete + CALL-node-fetch)
        expect(store.queryCalls.length).toBeGreaterThanOrEqual(files.length * 2);
    });
});
