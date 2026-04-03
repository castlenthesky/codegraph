import * as assert from 'assert';
import { generateId, detectLanguage } from '../utils/nodeFactory';

suite('FileSystemWatcher Logic Test Suite', () => {
	test('generateId correctly normalizes paths cross-platform', () => {
		const winPath = 'src\\\\controllers\\\\App.ts';
		const id = generateId(winPath);
		assert.strictEqual(id, 'src/controllers/App.ts', 'Should convert backslashes to forward slashes');
	});

	test('detectLanguage maps extensions properly', () => {
		assert.strictEqual(detectLanguage('.ts'), 'typescript');
		assert.strictEqual(detectLanguage('.py'), 'python');
		assert.strictEqual(detectLanguage('.unknown'), 'unknown');
	});
});
