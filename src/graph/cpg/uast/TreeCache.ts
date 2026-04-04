import type Parser from 'tree-sitter';

export class TreeCache {
	private cache = new Map<string, Parser.Tree>();

	get(filePath: string): Parser.Tree | undefined {
		return this.cache.get(filePath);
	}

	set(filePath: string, tree: Parser.Tree): void {
		this.cache.set(filePath, tree);
	}

	delete(filePath: string): void {
		this.cache.delete(filePath);
	}

	clear(): void {
		this.cache.clear();
	}
}
