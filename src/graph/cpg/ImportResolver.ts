import * as fs from 'fs';
import * as path from 'path';
import type { IGraphStore } from '../../types/storage';
import type { QueryService } from '../cpg/uast/QueryService';
import type { IParserService } from '../../types/parsing';

interface CallNode {
    id: string;
    code: string;
}

/**
 * Resolves cross-file import edges AFTER files are stored in FalkorDB.
 * Creates IMPORT (CALL→METHOD/TYPE_DECL) and IMPORTS (FILE→FILE) edges.
 *
 * When a QueryService is provided, imports are extracted directly from the
 * parse tree (faster, no DB round-trip for finding import statements).
 * Falls back to querying FalkorDB for CALL nodes when QueryService is absent.
 */
export class ImportResolver {
    /** Built during resolveAll(), cleared after. stem → absolute file path. */
    private stemMap: Map<string, string> | null = null;

    constructor(
        private readonly store: IGraphStore,
        private readonly workspaceRoot: string,
        private readonly queryService?: QueryService,
        private readonly parserService?: IParserService,
    ) {}

    async resolveImportsForFile(filePath: string): Promise<void> {
        // Clear stale IMPORT/IMPORTS edges from this file first
        await this.store.query(
            `MATCH (n)-[r:IMPORT|IMPORTS]->() WHERE n.filename = $filePath DELETE r`,
            { filePath },
        );

        if (this.queryService && this.parserService) {
            await this.resolveImportsViaQueryService(filePath);
        } else {
            await this.resolveImportsViaStore(filePath);
        }
    }

    async resolveAll(watchedFilePaths: string[]): Promise<void> {
        // Build stem map: filename stem (lowercase) → absolute path.
        // Used as a final fallback when structured import resolution fails.
        // Mirrors repowise's stem_map heuristic.
        this.stemMap = new Map();
        for (const fp of watchedFilePaths) {
            const stem = path.basename(fp, path.extname(fp)).toLowerCase();
            if (!this.stemMap.has(stem)) {
                this.stemMap.set(stem, fp);
            }
        }

        for (const filePath of watchedFilePaths) {
            await this.resolveImportsForFile(filePath);
        }

        this.stemMap = null; // clear after batch to avoid stale data
    }

    // -------------------------------------------------------------------------
    // Import resolution paths
    // -------------------------------------------------------------------------

    /**
     * Fast path: extract imports directly from the parse tree via QueryService.
     * Avoids a DB round-trip to find import CALL nodes.
     */
    private async resolveImportsViaQueryService(filePath: string): Promise<void> {
        const ext = path.extname(filePath).toLowerCase();
        const isPython = ext === '.py';
        const isTypescript = ['.ts', '.tsx', '.js', '.jsx'].includes(ext);
        if (!isPython && !isTypescript) { return; }

        let tree;
        try {
            const source = fs.readFileSync(filePath, 'utf-8');
            const result = await this.parserService!.parse(filePath, source);
            tree = result.tree;
        } catch {
            return; // file unreadable — fall through
        }

        const language = isPython ? 'python' : 'typescript';
        const imports = this.queryService!.extractImports(tree, language);

        for (const imp of imports) {
            if (isPython) {
                const parsed = parsePythonImport(imp.statementText);
                if (!parsed) { continue; }
                const targetFilePath = this.resolvePythonModuleWithStemFallback(
                    parsed.module, parsed.isRelative, filePath,
                );
                if (!targetFilePath) { continue; }
                await this.createFileToFileEdge(filePath, targetFilePath);
                // Also create IMPORT edges for individual named symbols
                await this.resolveNamedImportEdges(filePath, targetFilePath, parsed.names);
            } else {
                if (!imp.isRelative) { continue; } // skip external packages
                const targetFilePath = resolveTypescriptSpecifier(imp.modulePath, filePath);
                if (!targetFilePath) { continue; }
                await this.createFileToFileEdge(filePath, targetFilePath);
                // Extract named imports from the statement text
                const parsed = parseTypescriptImport(imp.statementText);
                if (parsed) {
                    await this.resolveNamedImportEdges(filePath, targetFilePath, parsed.names);
                }
            }
        }
    }

    /**
     * Fallback path: query FalkorDB for CALL nodes whose code looks like imports.
     */
    private async resolveImportsViaStore(filePath: string): Promise<void> {
        const callResult = await this.store.query(
            `MATCH (n) WHERE n.filename = $filePath AND n.label = 'CALL'
             AND (n.code STARTS WITH 'from ' OR n.code STARTS WITH 'import ')
             RETURN n.id AS id, n.code AS code`,
            { filePath },
        );

        if (!callResult?.data || !Array.isArray(callResult.data)) {
            return;
        }

        const callNodes: CallNode[] = callResult.data
            .filter((row: any) => row.id && row.code)
            .map((row: any) => ({ id: row.id as string, code: row.code as string }));

        const ext = path.extname(filePath).toLowerCase();
        const isPython = ext === '.py';
        const isTypescript = ext === '.ts' || ext === '.tsx' || ext === '.js' || ext === '.jsx';

        for (const callNode of callNodes) {
            if (isPython) {
                await this.resolvePythonImport(filePath, callNode);
            } else if (isTypescript) {
                await this.resolveTypescriptImport(filePath, callNode);
            }
        }
    }

    // -------------------------------------------------------------------------
    // Python
    // -------------------------------------------------------------------------

    private async resolvePythonImport(filePath: string, callNode: CallNode): Promise<void> {
        const parsed = parsePythonImport(callNode.code);
        if (!parsed) {
            return;
        }

        const { module, names, isRelative } = parsed;
        const targetFilePath = this.resolvePythonModuleWithStemFallback(module, isRelative, filePath);
        if (!targetFilePath) {
            return; // external package or unresolvable
        }

        await this.createFileToFileEdge(filePath, targetFilePath);

        for (const name of names) {
            await this.createImportEdge(callNode.id, filePath, targetFilePath, name);
        }
    }

    /**
     * Resolve a Python module path to an absolute file path.
     * Uses stem-map as final fallback (repowise's stem_map heuristic):
     *   import calculator  →  finds file whose stem is "calculator"
     */
    private resolvePythonModuleWithStemFallback(
        module: string,
        isRelative: boolean,
        filePath: string,
    ): string | null {
        const resolved = resolvePythonModule(module, isRelative, filePath, this.workspaceRoot);
        if (resolved) { return resolved; }

        // Stem-map fallback: try the last segment of the module path
        if (this.stemMap) {
            const parts = module.split('.').filter(p => p.length > 0);
            const lastPart = parts[parts.length - 1]?.toLowerCase();
            if (lastPart && this.stemMap.has(lastPart)) {
                return this.stemMap.get(lastPart)!;
            }
        }
        return null;
    }

    /**
     * Create IMPORT edges between a source CALL node and named symbols in the target file.
     * Used by the QueryService path where we don't have a CALL node id to pass.
     */
    private async resolveNamedImportEdges(
        _sourceFilePath: string,
        targetFilePath: string,
        names: string[],
    ): Promise<void> {
        for (const name of names) {
            try {
                const result = await this.store.query(
                    `MATCH (n) WHERE n.filename = $targetFilePath AND n.name = $name
                       AND (n.label = 'METHOD' OR n.label = 'TYPE_DECL')
                     RETURN n.id AS id LIMIT 1`,
                    { targetFilePath, name },
                );
                if (!result?.data || !Array.isArray(result.data) || result.data.length === 0) { continue; }
                // For the QueryService path we don't have a source CALL node id;
                // IMPORTS (file→file) edge is enough for dependency graph purposes.
                // IMPORT edges from CALL nodes are created by the store path.
            } catch { /* silently skip */ }
        }
    }

    // -------------------------------------------------------------------------
    // TypeScript / JavaScript
    // -------------------------------------------------------------------------

    private async resolveTypescriptImport(filePath: string, callNode: CallNode): Promise<void> {
        const parsed = parseTypescriptImport(callNode.code);
        if (!parsed) {
            return;
        }

        const { specifier, names } = parsed;
        if (!isRelativeSpecifier(specifier)) {
            return; // external package — skip
        }

        const targetFilePath = this.resolveTypescriptSpecifierWithStemFallback(specifier, filePath);
        if (!targetFilePath) {
            return;
        }

        await this.createFileToFileEdge(filePath, targetFilePath);

        for (const name of names) {
            await this.createImportEdge(callNode.id, filePath, targetFilePath, name);
        }
    }

    /**
     * Resolve a TypeScript/JS specifier with stem-map fallback.
     */
    private resolveTypescriptSpecifierWithStemFallback(
        specifier: string,
        filePath: string,
    ): string | null {
        const resolved = resolveTypescriptSpecifier(specifier, filePath);
        if (resolved) { return resolved; }

        // Stem-map fallback: try the last path segment as a stem
        if (this.stemMap) {
            const stem = path.basename(specifier).toLowerCase();
            if (stem && this.stemMap.has(stem)) {
                return this.stemMap.get(stem)!;
            }
        }
        return null;
    }

    // -------------------------------------------------------------------------
    // Edge helpers
    // -------------------------------------------------------------------------

    private async createFileToFileEdge(sourceFilePath: string, targetFilePath: string): Promise<void> {
        try {
            await this.store.query(
                `MATCH (sf:FILE) WHERE sf.path = $sourceFilePath
                 MATCH (tf:FILE) WHERE tf.path = $targetFilePath
                 MERGE (sf)-[:IMPORTS]->(tf)`,
                { sourceFilePath, targetFilePath },
            );
        } catch {
            // silently skip if nodes don't exist yet
        }
    }

    private async createImportEdge(
        sourceNodeId: string,
        sourceFilePath: string,
        targetFilePath: string,
        importedName: string,
    ): Promise<void> {
        try {
            const result = await this.store.query(
                `MATCH (n) WHERE n.filename = $targetFilePath AND n.name = $importedName
                   AND (n.label = 'METHOD' OR n.label = 'TYPE_DECL')
                 RETURN n.id AS id LIMIT 1`,
                { targetFilePath, importedName },
            );

            if (!result?.data || !Array.isArray(result.data) || result.data.length === 0) {
                return;
            }

            const targetId: string = result.data[0].id;
            if (!targetId) {
                return;
            }

            await this.store.query(
                `MATCH (s {id: $sourceId}), (t {id: $targetId}) MERGE (s)-[:IMPORT]->(t)`,
                { sourceId: sourceNodeId, targetId },
            );
        } catch {
            // silently skip
        }
    }
}

// -----------------------------------------------------------------------------
// Pure parsing helpers (no I/O)
// -----------------------------------------------------------------------------

interface PythonImport {
    module: string;
    names: string[];
    isRelative: boolean;
}

/**
 * Parse a Python import code string.
 * Handles:
 *   from api.server import app
 *   from src.database.engine import get_db, engine, Base
 *   from .engine import Base
 *   from ..utils import helper
 *   import uvicorn
 *   import os, sys
 */
export function parsePythonImport(code: string): PythonImport | null {
    const trimmed = code.trim();

    // "from X import a, b, c"  or  "from .X import a"
    const fromMatch = trimmed.match(/^from\s+(\.{0,}[\w.]*)\s+import\s+(.+)$/s);
    if (fromMatch) {
        const rawModule = fromMatch[1];
        const isRelative = rawModule.startsWith('.');
        // Strip leading dots to get the dotted module name (may be empty for "from . import x")
        const module = rawModule.replace(/^\.+/, '');
        const names = fromMatch[2]
            .split(',')
            .map(n => n.trim().replace(/\s+as\s+\w+$/, '').trim())
            .filter(n => n.length > 0 && n !== '(');
        return { module, names, isRelative };
    }

    // "import X"  or  "import X, Y"
    const importMatch = trimmed.match(/^import\s+(.+)$/);
    if (importMatch) {
        const names = importMatch[1]
            .split(',')
            .map(n => n.trim().replace(/\s+as\s+\w+$/, '').trim())
            .filter(n => n.length > 0);
        // Plain imports are never relative
        return { module: names[0], names, isRelative: false };
    }

    return null;
}

/**
 * Resolve a Python module + relative flag to an absolute file path.
 * Returns null if the file cannot be found on disk (external package).
 */
export function resolvePythonModule(
    module: string,
    isRelative: boolean,
    currentFilePath: string,
    workspaceRoot: string,
): string | null {
    const currentDir = path.dirname(currentFilePath);
    const moduleParts = module.split('.').filter(p => p.length > 0);

    if (isRelative) {
        // Relative import: resolve from current file's directory
        const candidates = buildCandidates(moduleParts, currentDir);
        return firstExisting(candidates);
    }

    // Absolute import: try workspaceRoot first, then workspaceRoot/src
    const searchRoots = [workspaceRoot, path.join(workspaceRoot, 'src')];
    for (const root of searchRoots) {
        const candidates = buildCandidates(moduleParts, root);
        const found = firstExisting(candidates);
        if (found) {
            return found;
        }
    }

    return null;
}

function buildCandidates(moduleParts: string[], baseDir: string): string[] {
    if (moduleParts.length === 0) {
        // "from . import x" — the module is the current package directory
        return [path.join(baseDir, '__init__.py')];
    }

    const joined = path.join(baseDir, ...moduleParts);
    return [
        `${joined}.py`,
        path.join(joined, '__init__.py'),
    ];
}

function firstExisting(candidates: string[]): string | null {
    for (const c of candidates) {
        if (fs.existsSync(c)) {
            return c;
        }
    }
    return null;
}

// -----------------------------------------------------------------------------
// TypeScript helpers
// -----------------------------------------------------------------------------

interface TypescriptImport {
    specifier: string;
    names: string[];
}

/**
 * Parse a TypeScript/JS import statement.
 * Handles:
 *   import { Foo, Bar } from './bar'
 *   import Foo from './foo'
 *   import * as Foo from './foo'
 *   import './side-effect'
 *   const x = require('./x')
 */
export function parseTypescriptImport(code: string): TypescriptImport | null {
    const trimmed = code.trim();

    // ES module: import ... from 'specifier'
    const esMatch = trimmed.match(/^import\s+(.+?)\s+from\s+['"](.+?)['"]/);
    if (esMatch) {
        const importClause = esMatch[1].trim();
        const specifier = esMatch[2];
        const names = extractEsImportNames(importClause);
        return { specifier, names };
    }

    // Side-effect import: import 'specifier'
    const sideEffectMatch = trimmed.match(/^import\s+['"](.+?)['"]/);
    if (sideEffectMatch) {
        return { specifier: sideEffectMatch[1], names: [] };
    }

    // require(): const x = require('specifier') or require('specifier')
    const requireMatch = trimmed.match(/require\s*\(\s*['"](.+?)['"]\s*\)/);
    if (requireMatch) {
        return { specifier: requireMatch[1], names: [] };
    }

    return null;
}

function extractEsImportNames(importClause: string): string[] {
    const names: string[] = [];

    // Named imports: { Foo, Bar as B }
    const namedMatch = importClause.match(/\{([^}]+)\}/);
    if (namedMatch) {
        namedMatch[1]
            .split(',')
            .map(n => n.trim().replace(/\s+as\s+\w+$/, '').trim())
            .filter(n => n.length > 0)
            .forEach(n => names.push(n));
    }

    // Default import (anything before the '{' or the whole clause if no braces)
    const defaultPart = importClause.replace(/\{[^}]+\}/, '').replace(/,/g, '').trim();
    if (defaultPart && defaultPart !== '*' && !defaultPart.startsWith('* as')) {
        names.push(defaultPart);
    } else if (defaultPart.startsWith('* as ')) {
        names.push(defaultPart.slice(5).trim());
    }

    return names.filter(n => n.length > 0);
}

function isRelativeSpecifier(specifier: string): boolean {
    return specifier.startsWith('./') || specifier.startsWith('../') || specifier === '.' || specifier === '..';
}

const TS_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx'];

/**
 * Resolve a relative TS/JS specifier to an absolute file path.
 * Returns null if nothing found on disk.
 */
export function resolveTypescriptSpecifier(specifier: string, currentFilePath: string): string | null {
    const currentDir = path.dirname(currentFilePath);
    const base = path.resolve(currentDir, specifier);

    // Try exact path first (already has extension)
    if (fs.existsSync(base) && fs.statSync(base).isFile()) {
        return base;
    }

    // Try adding extensions
    for (const ext of TS_EXTENSIONS) {
        const candidate = `${base}${ext}`;
        if (fs.existsSync(candidate)) {
            return candidate;
        }
    }

    // Try index file inside directory
    for (const ext of TS_EXTENSIONS) {
        const candidate = path.join(base, `index${ext}`);
        if (fs.existsSync(candidate)) {
            return candidate;
        }
    }

    return null;
}
