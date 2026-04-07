import * as fs from 'fs';
import * as path from 'path';
import type { IParserService } from '../../types/parsing';
import type { IGraphStore } from '../../types/storage';
import type { IGraphViewProvider } from '../../types/visualization';
import { UastBuilder } from './uast/UastBuilder';
import { CfgBuilder } from './cfg/CfgBuilder';
import { PdgBuilder } from './pdg/PdgBuilder';
import { ImportResolver } from './ImportResolver';
import { CallResolver } from './CallResolver';
import { QueryService } from './uast/QueryService';
import { SymbolExtractor } from './uast/SymbolExtractor';
import type { WorkspaceSymbolIndex } from './uast/SymbolExtractor';
import { detectLanguage, generateId } from '../nodes/nodeFactory';

// Languages we can currently parse
const SUPPORTED_LANGUAGES = new Set(['typescript', 'javascript', 'python']);

export class CpgPipeline {
	constructor(
		private readonly parserService: IParserService,
		private readonly uastBuilder: UastBuilder,
		private readonly store: IGraphStore,
		private readonly graphView?: IGraphViewProvider,
		private readonly cfgBuilder: CfgBuilder = new CfgBuilder(),
		private readonly pdgBuilder: PdgBuilder = new PdgBuilder(),
		private readonly importResolver?: ImportResolver,
		private readonly workspaceRoot: string = '',
		private readonly callResolver?: CallResolver,
		private readonly queryService?: QueryService,
	) {}

	/**
	 * Process a file: parse → build UAST → surgical DB update → refresh view.
	 * Called by FileWatcher on create/change events for supported file types.
	 */
	async processFile(filePath: string, source: string): Promise<void> {
		const ext = path.extname(filePath);
		const language = detectLanguage(ext);
		if (!SUPPORTED_LANGUAGES.has(language)) {
			console.log(`[CpgPipeline] Skipping ${filePath}: language '${language}' not yet supported`);
			return;
		}

		console.log(`[CpgPipeline] Processing: ${path.basename(filePath)}`);
		try {
			const parseResult = await this.parserService.parse(filePath, source);
			await this.processFileFromParsed(filePath, source, parseResult);
		} catch (error: unknown) {
			const message = error instanceof Error ? error.message : String(error);
			console.error(`CpgPipeline: error processing ${filePath}:`, message);
		}
	}

	/**
	 * Core pipeline logic: UAST → CFG → PDG → store → resolve edges → refresh view.
	 * Separated from processFile so reindexAllFiles can parse in parallel
	 * while calling this method sequentially for safe store writes.
	 */
	private async processFileFromParsed(
		filePath: string,
		_source: string,
		parseResult: import('../../types/parsing').ParseResult,
	): Promise<void> {
		// Runtime guard: if workspaceRoot wasn't provided, fall back to the file's directory
		let effectiveRoot = this.workspaceRoot;
		if (!effectiveRoot) {
			effectiveRoot = path.dirname(filePath);
			console.warn(`[CpgPipeline] workspaceRoot is empty — falling back to ${effectiveRoot} for ${path.basename(filePath)}`);
		}

		const fileNodeId = generateId(path.relative(effectiveRoot, filePath));

		// Mark file as not-yet-parsed (crash-safe: stays false if processing fails)
		await this.store.updateNode(fileNodeId, { isParsed: false });

		// Incremental scope detection: use .scm queries scoped to changedRanges
		// to identify which symbols were affected. Foundation for future surgical
		// subtree re-walk (currently logs for observability).
		if (parseResult.changedRanges && parseResult.changedRanges.length > 0 && this.queryService) {
			const affectedSymbols = this.queryService.extractSymbols(
				parseResult.tree,
				parseResult.language,
				parseResult.changedRanges,
			);
			if (affectedSymbols.length > 0) {
				console.log(
					`[CpgPipeline] Changed scopes in ${path.basename(filePath)}: ` +
					affectedSymbols.map(s => `${s.kind}:${s.name}(L${s.startLine})`).join(', ')
				);
			}
		}

		const uastResult = this.uastBuilder.build(parseResult, filePath, fileNodeId);
		const { cfgEdges, newNodes, newEdges } = this.cfgBuilder.build(uastResult);
		// Merge layers: UAST + CFG synthetic nodes/edges + CFG flow edges
		// PDG builder receives the full merged graph so it can traverse all nodes
		const mergedEdges = [...uastResult.edges, ...newEdges, ...cfgEdges];
		const mergedNodes = [...uastResult.nodes, ...newNodes];
		const pdgEdges = this.pdgBuilder.build(mergedNodes, mergedEdges);
		const finalEdges = [...mergedEdges, ...pdgEdges];
		await this.store.replaceFileSubgraph(filePath, mergedNodes, finalEdges);
		await this.store.updateNode(fileNodeId, { isParsed: true });
		console.log(`[CpgPipeline] Stored ${mergedNodes.length} nodes, ${finalEdges.length} edges for ${path.basename(filePath)}`);
		await this.importResolver?.resolveImportsForFile(filePath);
		// Resolve cross-module function CALL edges for this file
		await this.callResolver?.resolveCallsForFile(filePath);

		// Re-resolve CALL edges in files that import from this file,
		// since DETACH DELETE destroyed their incoming CALL edges too
		if (this.callResolver) {
			const depResult = await this.store.query(
				`MATCH (sf:FILE)-[:IMPORTS]->(tf:FILE {path: $filePath}) RETURN sf.path AS path`,
				{ filePath }
			);
			for (const dep of depResult?.data || []) {
				if (dep.path) { await this.callResolver.resolveCallsForFile(dep.path); }
			}
		}

		await this.graphView?.refresh();
	}

	/**
	 * Scan all watched folders and call processFile on every supported file.
	 * Called during a full reindex after the graph has been cleared.
	 */
	async reindexAllFiles(workspaceRoot: string, watchFolders: string[]): Promise<void> {
		const filesToProcess: string[] = [];

		const scanDir = (dirPath: string): void => {
			let entries: fs.Dirent[];
			try {
				entries = fs.readdirSync(dirPath, { withFileTypes: true });
			} catch (err) {
				console.warn(`[CpgPipeline] Cannot read directory ${dirPath}:`, err);
				return;
			}
			for (const entry of entries) {
				if (entry.name.startsWith('.') || entry.name === 'node_modules') { continue; }
				const fullPath = path.join(dirPath, entry.name);
				if (entry.isDirectory()) {
					scanDir(fullPath);
				} else if (entry.isFile()) {
					const ext = path.extname(entry.name);
					const lang = detectLanguage(ext);
					if (SUPPORTED_LANGUAGES.has(lang)) {
						filesToProcess.push(fullPath);
					}
				}
			}
		};

		for (const folder of watchFolders) {
			const folderPath = path.join(workspaceRoot, folder);
			if (!fs.existsSync(folderPath)) { continue; }
			scanDir(folderPath);
		}

		const CONCURRENCY = 4; // parse 4 files concurrently; store writes remain sequential
		console.log(`[CpgPipeline] Reindexing ${filesToProcess.length} files (concurrency: ${CONCURRENCY})...`);

		// Build workspace symbol index in parallel with parsing.
		// Used by CallResolver to resolve cross-file CALL edges without per-call DB queries.
		const symbolExtractor = this.queryService ? new SymbolExtractor(this.queryService) : null;
		const symbolIndex: WorkspaceSymbolIndex = new Map();

		for (let i = 0; i < filesToProcess.length; i += CONCURRENCY) {
			const batch = filesToProcess.slice(i, i + CONCURRENCY);

			// Read + parse in parallel
			const parsed = await Promise.all(
				batch.map(async (filePath, batchIdx) => {
					console.log(`[CpgPipeline] Parsing (${i + batchIdx + 1}/${filesToProcess.length}): ${path.basename(filePath)}`);
					try {
						const source = await fs.promises.readFile(filePath, 'utf8');
						const parseResult = await this.parserService.parse(filePath, source);
						return { filePath, source, parseResult };
					} catch (err) {
						console.error(`[CpgPipeline] Failed to read/parse ${filePath}:`, err);
						return null;
					}
				})
			);

			// Store writes are sequential — embedded FalkorDB doesn't support concurrent writes
			for (const result of parsed) {
				if (!result) { continue; }
				const { filePath, source, parseResult } = result;
				try {
					await this.processFileFromParsed(filePath, source, parseResult);
					// Populate symbol index alongside store writes
					if (symbolExtractor) {
						const fileIndex = symbolExtractor.extractFile(
							parseResult.tree,
							parseResult.language,
							filePath,
						);
						symbolIndex.set(filePath, fileIndex);
					}
				} catch (err) {
					console.error(`[CpgPipeline] Failed to store ${filePath}:`, err);
				}
			}
		}

		if (symbolExtractor) {
			console.log(`[CpgPipeline] Symbol index built: ${symbolIndex.size} files indexed.`);
		}

		if (this.importResolver && filesToProcess.length > 0) {
			console.log(`[CpgPipeline] Resolving cross-file imports...`);
			await this.importResolver.resolveAll(filesToProcess);
			console.log(`[CpgPipeline] Import resolution complete.`);
		}
		if (this.callResolver && filesToProcess.length > 0) {
			console.log('[CpgPipeline] Resolving cross-module function calls...');
			await this.callResolver.resolveAll(filesToProcess, symbolIndex.size > 0 ? symbolIndex : undefined);
			console.log('[CpgPipeline] Call resolution complete.');
		}
		console.log(`[CpgPipeline] Reindex complete.`);
	}

	/**
	 * Invalidate the parser cache for a deleted file.
	 */
	async invalidate(filePath: string): Promise<void> {
		this.parserService.invalidate(filePath);
		await this.store.replaceFileSubgraph(filePath, [], []);
		this.graphView?.refresh();
	}

	dispose(): void {
		// store and graphView lifecycle is managed by the extension host, not the pipeline
		this.parserService.dispose();
	}
}
