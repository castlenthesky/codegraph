/**
 * SymbolExtractor — builds a structured in-memory symbol index from .scm queries.
 *
 * Inspired by repowise's _extract_symbols() / _extract_imports() methods.
 * During a full reindex, CpgPipeline populates a Map<filePath, FileSymbolIndex>
 * which ImportResolver and CallResolver can use to resolve cross-file edges
 * without per-symbol DB round-trips.
 */
import type { Tree } from 'tree-sitter';
import type { QueryService, ExtractedSymbol, ExtractedImport } from './QueryService';

export interface FileSymbolIndex {
	/** All symbols defined in this file (functions, classes, etc.). */
	symbols: ExtractedSymbol[];
	/** All imports declared in this file. */
	imports: ExtractedImport[];
}

/** Workspace-wide index: file path → symbol/import data extracted by .scm queries. */
export type WorkspaceSymbolIndex = Map<string, FileSymbolIndex>;

export class SymbolExtractor {
	constructor(private readonly queryService: QueryService) {}

	/**
	 * Extract symbols and imports from a single parsed file.
	 */
	extractFile(tree: Tree, language: string, _filePath: string): FileSymbolIndex {
		return {
			symbols: this.queryService.extractSymbols(tree, language),
			imports: this.queryService.extractImports(tree, language),
		};
	}

	/**
	 * Look up a symbol by name in the given file's index.
	 * Returns the first match (most codebases don't have overloads at the module level).
	 */
	findSymbol(
		index: WorkspaceSymbolIndex,
		filePath: string,
		symbolName: string,
	): ExtractedSymbol | undefined {
		return index.get(filePath)?.symbols.find(s => s.name === symbolName);
	}

	/**
	 * Find all files that export a symbol with the given name.
	 * Used by CallResolver to resolve method full names to source files without DB queries.
	 */
	findSymbolInWorkspace(
		index: WorkspaceSymbolIndex,
		symbolName: string,
	): Array<{ filePath: string; symbol: ExtractedSymbol }> {
		const results: Array<{ filePath: string; symbol: ExtractedSymbol }> = [];
		for (const [filePath, fileIndex] of index) {
			const match = fileIndex.symbols.find(s => s.name === symbolName);
			if (match) {
				results.push({ filePath, symbol: match });
			}
		}
		return results;
	}
}
