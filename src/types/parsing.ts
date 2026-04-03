/**
 * Placeholder interfaces for the future tree-sitter parsing layer (UAST/CFG/PDG).
 * Implementations will live in src/graph/cpg/.
 */

export interface ILanguageAdapter {
	readonly language: string;
	readonly fileExtensions: string[];
}

export interface IParser {
	readonly adapter: ILanguageAdapter;
	parse(content: string, filePath: string): Promise<unknown>;
}
