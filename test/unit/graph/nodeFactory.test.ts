import * as assert from 'assert';
import { generateId, detectLanguage } from '../../../src/graph/nodes/nodeFactory';

describe('nodeFactory', () => {
	test('generateId normalizes Windows backslashes to forward slashes', () => {
		const winPath = 'src\\controllers\\App.ts';
		const id = generateId(winPath);
		assert.strictEqual(id, 'src/controllers/App.ts', 'Should convert backslashes to forward slashes');
	});

	test('detectLanguage maps known extensions', () => {
		assert.strictEqual(detectLanguage('.ts'), 'typescript');
		assert.strictEqual(detectLanguage('.py'), 'python');
		assert.strictEqual(detectLanguage('.unknown'), 'unknown');
	});
});
