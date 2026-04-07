/**
 * Interfaces for the tree-sitter parsing layer (UAST/CFG/PDG).
 * Implementations will live in src/graph/cpg/.
 */

import type { Tree, Range } from 'tree-sitter';

export interface ParseResult {
	tree: Tree;
	changedRanges: Range[] | null;
	language: string;
}

export interface IParserService {
	parse(filePath: string, source: string): Promise<ParseResult>;
	invalidate(filePath: string): void;
	dispose(): void;
	/** Returns the raw tree-sitter Language object; undefined if not yet loaded. */
	getLanguage(language: string): unknown;
	/** Eagerly loads the parser so getLanguage() returns the Language object. */
	ensureLanguageLoaded(language: string): Promise<void>;
}
