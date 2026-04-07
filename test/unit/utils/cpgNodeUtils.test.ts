import { describe, test, expect } from 'bun:test';
import { cpgNodeVal } from '../../../src/utils/cpgNodeUtils';

describe('cpgNodeVal', () => {
	test('METHOD returns 4', () => expect(cpgNodeVal('METHOD')).toBe(4));
	test('TYPE_DECL returns 3', () => expect(cpgNodeVal('TYPE_DECL')).toBe(3));
	test('DIRECTORY returns 3', () => expect(cpgNodeVal('DIRECTORY')).toBe(3));
	test('CALL returns 2', () => expect(cpgNodeVal('CALL')).toBe(2));
	test('IDENTIFIER returns 1.5', () => expect(cpgNodeVal('IDENTIFIER')).toBe(1.5));
	test('BLOCK returns 1', () => expect(cpgNodeVal('BLOCK')).toBe(1));
	test('unknown label returns 2', () => expect(cpgNodeVal('UNKNOWN')).toBe(2));
});
