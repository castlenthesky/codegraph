import { describe, test, expect, beforeEach } from 'bun:test';
import { TreeCache } from '../../../../../src/graph/cpg/uast/TreeCache';
import type Parser from 'tree-sitter';

// Minimal stub that satisfies Parser.Tree's structural type for the cache.
// The cache stores and returns whatever is put in — it never calls methods on
// the tree, so a plain object is sufficient.
function makeTree(id: string): Parser.Tree {
	return { _id: id } as unknown as Parser.Tree;
}

describe('TreeCache', () => {
	let cache: TreeCache;

	beforeEach(() => {
		cache = new TreeCache();
	});

	// ── smoke test ──────────────────────────────────────────────────────────────
	test('smoke: set and get round-trip returns the stored tree', () => {
		const tree = makeTree('smoke');
		cache.set('/smoke.ts', tree);
		expect(cache.get('/smoke.ts')).toBe(tree);
	});

	// ── get ──────────────────────────────────────────────────────────────────────
	test('get returns undefined for an unknown key', () => {
		expect(cache.get('/does-not-exist.ts')).toBeUndefined();
	});

	test('get returns undefined on a freshly created cache', () => {
		expect(cache.get('/any/path.ts')).toBeUndefined();
	});

	// ── set ──────────────────────────────────────────────────────────────────────
	test('set overwrites an existing entry with the same key', () => {
		const first = makeTree('first');
		const second = makeTree('second');

		cache.set('/file.ts', first);
		cache.set('/file.ts', second);

		expect(cache.get('/file.ts')).toBe(second);
		expect(cache.get('/file.ts')).not.toBe(first);
	});

	test('set stores distinct entries for distinct paths', () => {
		const treeA = makeTree('A');
		const treeB = makeTree('B');

		cache.set('/a.ts', treeA);
		cache.set('/b.ts', treeB);

		expect(cache.get('/a.ts')).toBe(treeA);
		expect(cache.get('/b.ts')).toBe(treeB);
	});

	// ── delete ───────────────────────────────────────────────────────────────────
	test('delete removes the entry so get returns undefined afterwards', () => {
		const tree = makeTree('to-delete');
		cache.set('/to-delete.ts', tree);

		cache.delete('/to-delete.ts');

		expect(cache.get('/to-delete.ts')).toBeUndefined();
	});

	test('delete on a non-existent key does not throw', () => {
		expect(() => cache.delete('/ghost.ts')).not.toThrow();
	});

	test('delete only removes the targeted entry, leaving others intact', () => {
		const treeA = makeTree('A');
		const treeB = makeTree('B');
		cache.set('/a.ts', treeA);
		cache.set('/b.ts', treeB);

		cache.delete('/a.ts');

		expect(cache.get('/a.ts')).toBeUndefined();
		expect(cache.get('/b.ts')).toBe(treeB);
	});

	// ── clear ────────────────────────────────────────────────────────────────────
	test('clear removes all entries', () => {
		cache.set('/a.ts', makeTree('A'));
		cache.set('/b.ts', makeTree('B'));
		cache.set('/c.ts', makeTree('C'));

		cache.clear();

		expect(cache.get('/a.ts')).toBeUndefined();
		expect(cache.get('/b.ts')).toBeUndefined();
		expect(cache.get('/c.ts')).toBeUndefined();
	});

	test('clear on an already-empty cache does not throw', () => {
		expect(() => cache.clear()).not.toThrow();
	});

	test('entries can be added again after clear', () => {
		cache.set('/file.ts', makeTree('before-clear'));
		cache.clear();

		const fresh = makeTree('after-clear');
		cache.set('/file.ts', fresh);

		expect(cache.get('/file.ts')).toBe(fresh);
	});

	// ── multiple files ────────────────────────────────────────────────────────────
	test('handles many files in the cache simultaneously', () => {
		const count = 50;
		const trees: Parser.Tree[] = [];

		for (let i = 0; i < count; i++) {
			const tree = makeTree(`file-${i}`);
			trees.push(tree);
			cache.set(`/src/file-${i}.ts`, tree);
		}

		for (let i = 0; i < count; i++) {
			expect(cache.get(`/src/file-${i}.ts`)).toBe(trees[i]);
		}
	});

	// ── path edge cases ───────────────────────────────────────────────────────────
	test('distinguishes paths that differ only by case', () => {
		const lower = makeTree('lower');
		const upper = makeTree('upper');
		cache.set('/src/file.ts', lower);
		cache.set('/src/FILE.ts', upper);

		// Both should be independently retrievable (map keys are case-sensitive)
		expect(cache.get('/src/file.ts')).toBe(lower);
		expect(cache.get('/src/FILE.ts')).toBe(upper);
	});

	test('treats paths with Unicode characters as valid keys', () => {
		const tree = makeTree('unicode');
		const unicodePath = '/src/こんにちは/file.ts';
		cache.set(unicodePath, tree);
		expect(cache.get(unicodePath)).toBe(tree);
	});
});
