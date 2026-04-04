import Parser from 'tree-sitter';
import { TreeCache } from './TreeCache';
import type { IParserService, ParseResult } from '../../../types/parsing';
import { detectLanguage } from '../../nodes/nodeFactory';
import * as path from 'path';

// Grammar module mapping: language string → npm package and optional sub-export
const GRAMMAR_MAP: Record<string, { module: string; subExport?: string }> = {
	'typescript': { module: 'tree-sitter-typescript', subExport: 'typescript' },
	'javascript': { module: 'tree-sitter-typescript', subExport: 'typescript' },
	'python': { module: 'tree-sitter-python' },
};

export class ParserService implements IParserService {
	private cache = new TreeCache();
	private parsers = new Map<string, Parser>();

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
	}

	private async getParserForLanguage(language: string): Promise<Parser> {
		if (this.parsers.has(language)) {
			return this.parsers.get(language)!;
		}

		const grammarInfo = GRAMMAR_MAP[language];
		if (!grammarInfo) {
			throw new Error(`No grammar for language: ${language}`);
		}

		try {
			// eslint-disable-next-line @typescript-eslint/no-require-imports
			const mod = require(grammarInfo.module);
			const grammarLang = grammarInfo.subExport ? mod[grammarInfo.subExport] : mod;

			const parser = new Parser();
			parser.setLanguage(grammarLang);
			this.parsers.set(language, parser);
			return parser;
		} catch (err) {
			throw new Error(`Failed to load grammar for language '${language}': ${err instanceof Error ? err.message : String(err)}`);
		}
	}
}
