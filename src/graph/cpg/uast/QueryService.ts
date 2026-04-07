/**
 * QueryService — tree-sitter .scm query integration.
 *
 * Inspired by repowise's _query_cache pattern: compile each language's .scm
 * query file once and cache the resulting Query object. Subsequent calls are
 * pure C-native pattern matching against the AST, with no repeated disk I/O.
 *
 * The QueryService provides two complementary extraction paths:
 *   1. extractSymbols()  — structured symbol definitions (name, kind, line)
 *   2. extractImports()  — structured import statements (module, names, relative)
 *
 * Both can be scoped to a set of changed ranges (from ParserService.changedRanges)
 * for incremental execution, touching only the affected parts of the tree.
 */
import * as fs from 'fs';
import * as path from 'path';
import Parser from 'tree-sitter';
import type { Tree, SyntaxNode, Range, QueryCapture } from 'tree-sitter';
import { LANGUAGE_CONFIGS } from './LanguageConfig';
import type { IParserService } from '../../../types/parsing';

// ---------------------------------------------------------------------------
// Public output types
// ---------------------------------------------------------------------------

export type SymbolKind = 'function' | 'class' | 'interface' | 'type' | 'enum' | 'method' | 'unknown';

export interface ExtractedSymbol {
	name: string;
	kind: SymbolKind;
	startLine: number;
	endLine: number;
	startIndex: number;
	endIndex: number;
	/** Decorator or modifier text, if any */
	modifiers: string[];
	/** Parameter list text, if available */
	paramText?: string;
}

export interface ExtractedImport {
	/** Raw text of the full import statement */
	statementText: string;
	/** The module path or name being imported */
	modulePath: string;
	/** true for relative imports (./, ../) in TS or from . in Python */
	isRelative: boolean;
	startLine: number;
	startIndex: number;
}

// ---------------------------------------------------------------------------
// QueryService
// ---------------------------------------------------------------------------

export class QueryService {
	private queryCache = new Map<string, Parser.Query>();
	private queriesDir: string;

	constructor(
		private readonly parserService: IParserService,
		extensionPath: string,
	) {
		this.queriesDir = path.join(extensionPath, 'resources', 'queries');
	}

	// -------------------------------------------------------------------------
	// Public API
	// -------------------------------------------------------------------------

	/**
	 * Extract structured symbol definitions from a parsed tree.
	 * Optionally scoped to `changedRanges` for incremental updates.
	 */
	extractSymbols(
		tree: Tree,
		language: string,
		changedRanges?: Range[] | null,
	): ExtractedSymbol[] {
		const query = this.getQuery(language);
		if (!query) { return []; }

		const captures = this.runCaptures(query, tree.rootNode, changedRanges);
		return this.buildSymbols(captures, tree.rootNode.text);
	}

	/**
	 * Extract structured import statements from a parsed tree.
	 * Always runs against the full tree (imports don't change incrementally
	 * in a way that's safe to scope — a file's imports affect cross-file edges).
	 */
	extractImports(tree: Tree, language: string): ExtractedImport[] {
		const query = this.getQuery(language);
		if (!query) { return []; }

		const captures = query.captures(tree.rootNode);
		return this.buildImports(captures, tree.rootNode.text, language);
	}

	/**
	 * Returns the compiled Query for a language, or null if no .scm file exists.
	 * Queries are compiled once and cached for the lifetime of the service.
	 */
	getQuery(language: string): Parser.Query | null {
		if (this.queryCache.has(language)) {
			return this.queryCache.get(language) ?? null;
		}

		const config = LANGUAGE_CONFIGS[language];
		if (!config) { return null; }

		const scmPath = path.join(this.queriesDir, `${language}.scm`);
		if (!fs.existsSync(scmPath)) {
			console.warn(`[QueryService] No .scm file found for language '${language}' at ${scmPath}`);
			this.queryCache.set(language, null as unknown as Parser.Query);
			return null;
		}

		const tsLanguage = this.parserService.getLanguage(language);
		if (!tsLanguage) {
			// Language not yet loaded by ParserService — skip caching so it can retry
			console.warn(`[QueryService] Language '${language}' not yet loaded in ParserService`);
			return null;
		}

		try {
			const scmText = fs.readFileSync(scmPath, 'utf-8');
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const query = new Parser.Query(tsLanguage as any, scmText);
			this.queryCache.set(language, query);
			return query;
		} catch (err) {
			console.error(`[QueryService] Failed to compile query for '${language}':`, err);
			this.queryCache.set(language, null as unknown as Parser.Query);
			return null;
		}
	}

	dispose(): void {
		this.queryCache.clear();
	}

	// -------------------------------------------------------------------------
	// Private helpers
	// -------------------------------------------------------------------------

	/**
	 * Run captures, optionally restricted to changed ranges.
	 * For each range, uses QueryOptions.startPosition/endPosition (tree-sitter v0.21+).
	 * Deduplicates by node id so overlap between ranges doesn't produce duplicates.
	 */
	private runCaptures(
		query: Parser.Query,
		rootNode: SyntaxNode,
		ranges?: Range[] | null,
	): QueryCapture[] {
		if (!ranges || ranges.length === 0) {
			return query.captures(rootNode);
		}

		const seen = new Set<number>();
		const result: QueryCapture[] = [];

		for (const range of ranges) {
			const opts = {
				startPosition: range.startPosition,
				endPosition: range.endPosition,
			};
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const captures = (query as any).captures(rootNode, opts) as QueryCapture[];
			for (const c of captures) {
				if (!seen.has(c.node.id)) {
					seen.add(c.node.id);
					result.push(c);
				}
			}
		}

		return result;
	}

	/**
	 * Group captures by their @symbol.def node and build ExtractedSymbol objects.
	 * Match structure: one @symbol.def + associated @symbol.name, @symbol.params, @symbol.modifiers.
	 */
	private buildSymbols(captures: QueryCapture[], source: string): ExtractedSymbol[] {
		// Collect per capture-name
		const defNodes: SyntaxNode[] = [];
		const nameByDef = new Map<number, SyntaxNode>();
		const paramByDef = new Map<number, SyntaxNode>();
		const modifiersByDef = new Map<number, string[]>();

		for (const { name, node } of captures) {
			if (name === 'symbol.def') {
				defNodes.push(node);
			} else if (name === 'symbol.name') {
				// Find the nearest enclosing @symbol.def for this name node
				nameByDef.set(node.parent?.id ?? node.id, node);
			} else if (name === 'symbol.params') {
				paramByDef.set(node.parent?.id ?? node.id, node);
			} else if (name === 'symbol.modifiers') {
				const defId = node.parent?.id ?? node.id;
				const existing = modifiersByDef.get(defId) ?? [];
				existing.push(source.slice(node.startIndex, node.endIndex).substring(0, 128));
				modifiersByDef.set(defId, existing);
			}
		}

		const symbols: ExtractedSymbol[] = [];
		for (const defNode of defNodes) {
			const nameNode = nameByDef.get(defNode.id);
			if (!nameNode) { continue; }

			const name = source.slice(nameNode.startIndex, nameNode.endIndex);
			const paramNode = paramByDef.get(defNode.id);

			symbols.push({
				name,
				kind: nodeTypeToKind(defNode.type),
				startLine: defNode.startPosition.row + 1,
				endLine: defNode.endPosition.row + 1,
				startIndex: defNode.startIndex,
				endIndex: defNode.endIndex,
				modifiers: modifiersByDef.get(defNode.id) ?? [],
				paramText: paramNode
					? source.slice(paramNode.startIndex, paramNode.endIndex).substring(0, 256)
					: undefined,
			});
		}

		return symbols;
	}

	/**
	 * Build ExtractedImport objects from @import.statement / @import.module captures.
	 */
	private buildImports(
		captures: QueryCapture[],
		source: string,
		language: string,
	): ExtractedImport[] {
		const statementNodes = new Map<number, SyntaxNode>();
		const moduleByStatement = new Map<number, SyntaxNode>();

		for (const { name, node } of captures) {
			if (name === 'import.statement') {
				statementNodes.set(node.id, node);
			} else if (name === 'import.module') {
				// Map module node → its parent statement node
				const stmtId = node.parent?.id ?? node.id;
				moduleByStatement.set(stmtId, node);
			}
		}

		const imports: ExtractedImport[] = [];
		for (const [stmtId, stmtNode] of statementNodes) {
			const moduleNode = moduleByStatement.get(stmtId);
			if (!moduleNode) { continue; }

			// Strip surrounding quotes from string literals (TS import sources are strings)
			let modulePath = source.slice(moduleNode.startIndex, moduleNode.endIndex);
			if ((modulePath.startsWith('"') && modulePath.endsWith('"')) ||
				(modulePath.startsWith("'") && modulePath.endsWith("'"))) {
				modulePath = modulePath.slice(1, -1);
			}

			imports.push({
				statementText: source.slice(stmtNode.startIndex, stmtNode.endIndex).substring(0, 256),
				modulePath,
				isRelative: isRelativePath(modulePath, language),
				startLine: stmtNode.startPosition.row + 1,
				startIndex: stmtNode.startIndex,
			});
		}

		return imports;
	}
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function nodeTypeToKind(nodeType: string): SymbolKind {
	switch (nodeType) {
		case 'function_definition':
		case 'function_declaration':
		case 'generator_function_declaration':
		case 'arrow_function':
		case 'function_expression':
		case 'lambda':
			return 'function';
		case 'class_definition':
		case 'class_declaration':
		case 'class_expression':
			return 'class';
		case 'interface_declaration':
			return 'interface';
		case 'type_alias_declaration':
			return 'type';
		case 'enum_declaration':
			return 'enum';
		case 'method_definition':
		case 'method_declaration':
			return 'method';
		case 'lexical_declaration':
			return 'function'; // arrow/fn expression assigned to const
		default:
			return 'unknown';
	}
}

function isRelativePath(modulePath: string, language: string): boolean {
	if (language === 'python') {
		// Python relative imports start with a dot
		return modulePath.startsWith('.');
	}
	// TypeScript/JavaScript
	return modulePath.startsWith('./') || modulePath.startsWith('../')
		|| modulePath === '.' || modulePath === '..';
}
