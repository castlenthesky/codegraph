import * as path from 'path';
import type { IGraphStore } from '../../types/storage';
import type { WorkspaceSymbolIndex } from './uast/SymbolExtractor';
import {
    parsePythonImport,
    resolvePythonModule,
    parseTypescriptImport,
    resolveTypescriptSpecifier,
} from './ImportResolver';

/**
 * Resolves cross-module function CALL edges AFTER files are stored in FalkorDB.
 * For each CALL node in a file, locates the target METHOD node in the imported
 * module and creates a CALL edge between them.
 *
 * When a WorkspaceSymbolIndex is provided (populated during full reindex),
 * target METHOD nodes are resolved in-memory without per-call DB queries.
 */
export class CallResolver {
    /** Set during resolveAll() for batch resolution; cleared after. */
    private symbolIndex: WorkspaceSymbolIndex | null = null;

    constructor(
        private readonly store: IGraphStore,
        private readonly workspaceRoot: string,
    ) {}

    async resolveCallsForFile(filePath: string): Promise<void> {
        // Step 1: Clear stale CALL edges from nodes in this file
        await this.store.query(
            `MATCH (n)-[r:CALL]->() WHERE n.filename = $filePath DELETE r`,
            { filePath },
        );

        // Step 2: Build import map from this file's import CALL nodes
        const importResult = await this.store.query(
            `MATCH (n) WHERE n.filename = $filePath AND n.label = 'CALL'
               AND (n.code STARTS WITH 'from ' OR n.code STARTS WITH 'import ')
             RETURN n.code AS code`,
            { filePath },
        );

        const moduleAliases = new Map<string, string>(); // alias → absolute file path
        const directImports = new Map<string, string>(); // function name → absolute file path

        if (importResult?.data && Array.isArray(importResult.data)) {
            const ext = path.extname(filePath).toLowerCase();
            const isPython = ext === '.py';
            const isTypescript = ext === '.ts' || ext === '.tsx' || ext === '.js' || ext === '.jsx';

            for (const row of importResult.data) {
                const code: string = row.code;
                if (!code) { continue; }

                if (isPython) {
                    this.buildPythonImportMap(code, filePath, moduleAliases, directImports);
                } else if (isTypescript) {
                    this.buildTypescriptImportMap(code, filePath, moduleAliases, directImports);
                }
            }
        }

        // Step 3: Query non-import CALL nodes
        const callResult = await this.store.query(
            `MATCH (n) WHERE n.filename = $filePath AND n.label = 'CALL'
               AND NOT (n.code STARTS WITH 'from ' OR n.code STARTS WITH 'import ')
             RETURN n.id AS id, n.name AS name`,
            { filePath },
        );

        if (!callResult?.data || !Array.isArray(callResult.data)) {
            return;
        }

        // Step 4: Resolve each call and create CALL edges
        for (const row of callResult.data) {
            const callId: string = row.id;
            const callName: string = row.name;
            if (!callId || !callName) { continue; }

            await this.resolveCall(callId, callName, moduleAliases, directImports);
        }
    }

    /**
     * Resolve cross-file CALL edges for all files.
     * Pass a WorkspaceSymbolIndex (built by SymbolExtractor during reindex)
     * to use in-memory lookups instead of per-call DB queries.
     */
    async resolveAll(filePaths: string[], symbolIndex?: WorkspaceSymbolIndex): Promise<void> {
        this.symbolIndex = symbolIndex ?? null;
        for (const fp of filePaths) {
            await this.resolveCallsForFile(fp);
        }
        this.symbolIndex = null;
    }

    // -------------------------------------------------------------------------
    // Import map builders
    // -------------------------------------------------------------------------

    private buildPythonImportMap(
        code: string,
        filePath: string,
        moduleAliases: Map<string, string>,
        directImports: Map<string, string>,
    ): void {
        const parsed = parsePythonImport(code);
        if (!parsed) { return; }

        const { module, names, isRelative } = parsed;

        for (const name of names) {
            // Try if name is itself a sub-module: resolve `module.name`
            const subModuleDotted = isRelative ? name : `${module}.${name}`;
            const subModulePath = resolvePythonModule(
                subModuleDotted,
                isRelative,
                isRelative ? filePath : filePath, // relative base stays the same
                this.workspaceRoot,
            );

            if (subModulePath) {
                // name refers to a whole module file
                moduleAliases.set(name, subModulePath);
            } else {
                // name is a direct function/class import — find its containing file
                const moduleFile = resolvePythonModule(module, isRelative, filePath, this.workspaceRoot);
                if (moduleFile) {
                    directImports.set(name, moduleFile);
                }
            }
        }
    }

    private buildTypescriptImportMap(
        code: string,
        filePath: string,
        moduleAliases: Map<string, string>,
        directImports: Map<string, string>,
    ): void {
        const parsed = parseTypescriptImport(code);
        if (!parsed) { return; }

        const { specifier, names } = parsed;
        const targetFile = resolveTypescriptSpecifier(specifier, filePath);
        if (!targetFile) { return; }

        for (const name of names) {
            // For TS, all named imports are direct function/class imports
            directImports.set(name, targetFile);
        }
    }

    // -------------------------------------------------------------------------
    // Call edge creation
    // -------------------------------------------------------------------------

    private async resolveCall(
        callId: string,
        callName: string,
        moduleAliases: Map<string, string>,
        directImports: Map<string, string>,
    ): Promise<void> {
        try {
            if (callName.includes('.')) {
                const dotIndex = callName.indexOf('.');
                const prefix = callName.slice(0, dotIndex);
                const methodName = callName.slice(dotIndex + 1);

                if (moduleAliases.has(prefix)) {
                    const targetFile = moduleAliases.get(prefix)!;
                    await this.createCallEdge(callId, targetFile, methodName);
                }
            } else {
                if (directImports.has(callName)) {
                    const targetFile = directImports.get(callName)!;
                    await this.createCallEdge(callId, targetFile, callName);
                }
            }
        } catch {
            // silently skip unresolvable calls
        }
    }

    private async createCallEdge(
        callId: string,
        targetFilePath: string,
        methodName: string,
    ): Promise<void> {
        // Fast path: use in-memory symbol index to resolve the target node ID
        // without a DB round-trip (available during full reindex via resolveAll).
        if (this.symbolIndex) {
            const fileIndex = this.symbolIndex.get(targetFilePath);
            const symbol = fileIndex?.symbols.find(
                s => s.name === methodName && (s.kind === 'function' || s.kind === 'method')
            );
            if (symbol) {
                // Reconstruct the node ID using the same formula as UastBuilder.makeId
                // format: `${filePath}:${cpgType}:${row}:${col}`
                const targetId = `${targetFilePath}:METHOD:${symbol.startLine - 1}:0`;
                await this.store.query(
                    `MATCH (s {id: $callId}), (t {id: $targetId}) MERGE (s)-[:CALL]->(t)`,
                    { callId, targetId },
                );
                return;
            }
            // Symbol not in index — fall through to DB lookup
        }

        // Fallback: query FalkorDB for the target METHOD node
        const result = await this.store.query(
            `MATCH (m) WHERE m.filename = $targetFilePath AND m.name = $methodName
               AND m.label = 'METHOD'
             RETURN m.id AS id LIMIT 1`,
            { targetFilePath, methodName },
        );

        if (!result?.data || !Array.isArray(result.data) || result.data.length === 0) {
            return;
        }

        const targetId: string = result.data[0].id;
        if (!targetId) { return; }

        await this.store.query(
            `MATCH (s {id: $callId}), (t {id: $targetId}) MERGE (s)-[:CALL]->(t)`,
            { callId, targetId },
        );
    }
}
