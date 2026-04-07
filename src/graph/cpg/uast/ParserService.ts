import Parser from 'tree-sitter';
import { TreeCache } from './TreeCache';
import type { IParserService, ParseResult } from '../../../types/parsing';
import { LANGUAGE_CONFIGS } from './LanguageConfig';
import { detectLanguage } from '../../nodes/nodeFactory';
import * as path from 'path';

export class ParserService implements IParserService {
	private cache = new TreeCache();
	private parsers = new Map<string, Parser>();
	private languages = new Map<string, unknown>(); // tree-sitter Language objects, needed for Query construction

	async parse(filePath: string, source: string): Promise<ParseResult> {
		const ext = path.extname(filePath);
		const language = detectLanguage(ext);
		const parser = await this.getParserForLanguage(language);

		const oldTree = this.cache.get(filePath);
		const newTree = oldTree
			? parser.parse(source, oldTree)
			: parser.parse(source);
		const changedRanges = oldTree ? newTree.getChangedRanges(oldTree) : null;
		this.cache.set(filePath, newTree);
		return { tree: newTree, changedRanges, language };
	}

	invalidate(filePath: string): void {
		this.cache.delete(filePath);
	}

	dispose(): void {
		this.cache.clear();
		this.parsers.clear();
		this.languages.clear();
	}

	/**
	 * Returns the raw tree-sitter Language object for the given language string.
	 * Required by QueryService to compile .scm query files.
	 * Returns undefined if the language has not been loaded yet.
	 */
	getLanguage(language: string): unknown {
		return this.languages.get(language);
	}

	/**
	 * Eagerly load the parser (and cache the Language object) for the given language.
	 * QueryService calls this to ensure the Language object is available before
	 * compiling queries.
	 */
	async ensureLanguageLoaded(language: string): Promise<void> {
		await this.getParserForLanguage(language);
	}

	private async getParserForLanguage(language: string): Promise<Parser> {
		if (this.parsers.has(language)) {
			return this.parsers.get(language)!;
		}

		const config = LANGUAGE_CONFIGS[language];
		if (!config) {
			throw new Error(`No grammar config for language: ${language}`);
		}

		try {
			// eslint-disable-next-line @typescript-eslint/no-require-imports
			const mod = require(config.grammar.module);
			const grammarLang = config.grammar.subExport ? mod[config.grammar.subExport] : mod;

			const parser = new Parser();
			parser.setLanguage(grammarLang);
			this.parsers.set(language, parser);
			this.languages.set(language, grammarLang);
			return parser;
		} catch (err) {
			throw new Error(`Failed to load grammar for language '${language}': ${err instanceof Error ? err.message : String(err)}`);
		}
	}
}
