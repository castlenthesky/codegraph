import { describe, test, expect } from 'bun:test';
import {
	TS_NODE_MAP,
	extractNodeProps,
} from '../../../../../../src/graph/cpg/uast/adapters/TypeScriptAdapter';
import type { CpgNodeType } from '../../../../../../src/types/cpg';

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Build a minimal tree-sitter-shaped node object for use with extractNodeProps.
 * `childForFieldName` returns null by default; override per test as needed.
 */
function makeNode(opts: {
	type: string;
	startIndex: number;
	endIndex: number;
	startPosition: { row: number; column: number };
	childForFieldName?: (name: string) => { startIndex: number; endIndex: number } | null;
}) {
	return {
		type: opts.type,
		startIndex: opts.startIndex,
		endIndex: opts.endIndex,
		startPosition: opts.startPosition,
		childForFieldName: opts.childForFieldName ?? (() => null),
	};
}

/** Source fixture: a simple TypeScript module with several constructs. */
const FIXTURE_SOURCE = [
	'function greet(name: string): string {', // line 1 (row 0)
	'  return "Hello, " + name;',             // line 2 (row 1)
	'}',                                      // line 3 (row 2)
	'',                                       // line 4
	'class Greeter {',                        // line 5 (row 4)
	'  greet() { return greet("world"); }',   // line 6 (row 5)
	'}',                                      // line 7 (row 6)
	'',                                       // line 8
	'const handler = (x: number) => x * 2;', // line 9 (row 8)
	'const count = 42;',                      // line 10 (row 9)
	'import { foo } from "./foo";',           // line 11 (row 10)
	'if (count > 0) { greet("hi"); }',       // line 12 (row 11)
	'for (let i = 0; i < 10; i++) {}',       // line 13 (row 12)
	'while (false) {}',                       // line 14 (row 13)
	'return count;',                          // line 15 (row 14)
].join('\n');

const FILE_PATH = '/src/example.ts';

// ── TS_NODE_MAP ───────────────────────────────────────────────────────────────

describe('TS_NODE_MAP', () => {
	test('smoke: map is a non-empty object', () => {
		expect(typeof TS_NODE_MAP).toBe('object');
		expect(Object.keys(TS_NODE_MAP).length).toBeGreaterThan(0);
	});

	const expectedMappings: Array<[string, CpgNodeType]> = [
		['function_declaration', 'METHOD'],
		['method_definition', 'METHOD'],
		['arrow_function', 'METHOD'],
		['function_expression', 'METHOD'],
		['generator_function_declaration', 'METHOD'],
		['class_declaration', 'TYPE_DECL'],
		['class_expression', 'TYPE_DECL'],
		['interface_declaration', 'TYPE_DECL'],
		['type_alias_declaration', 'TYPE_DECL'],
		['enum_declaration', 'TYPE_DECL'],
		['statement_block', 'BLOCK'],
		['call_expression', 'CALL'],
		['new_expression', 'CALL'],
		['if_statement', 'CONTROL_STRUCTURE'],
		['for_statement', 'CONTROL_STRUCTURE'],
		['for_in_statement', 'CONTROL_STRUCTURE'],
		['while_statement', 'CONTROL_STRUCTURE'],
		['do_statement', 'CONTROL_STRUCTURE'],
		['switch_statement', 'CONTROL_STRUCTURE'],
		['try_statement', 'CONTROL_STRUCTURE'],
		['identifier', 'IDENTIFIER'],
		['property_identifier', 'FIELD_IDENTIFIER'],
		['shorthand_property_identifier', 'FIELD_IDENTIFIER'],
		['private_property_identifier', 'FIELD_IDENTIFIER'],
		['string', 'LITERAL'],
		['template_string', 'LITERAL'],
		['number', 'LITERAL'],
		['true', 'LITERAL'],
		['false', 'LITERAL'],
		['null', 'LITERAL'],
		['undefined', 'LITERAL'],
		['variable_declarator', 'LOCAL'],
		['required_parameter', 'METHOD_PARAMETER_IN'],
		['optional_parameter', 'METHOD_PARAMETER_IN'],
		['return_statement', 'RETURN'],
		['type_identifier', 'TYPE_REF'],
		['predefined_type', 'TYPE_REF'],
		['comment', 'COMMENT'],
		['decorator', 'ANNOTATION'],
		['import_statement', 'CALL'],
		['export_statement', 'MODIFIER'],
		['namespace_import', 'NAMESPACE_BLOCK'],
		['member_expression', 'FIELD_IDENTIFIER'],
	];

	for (const [tsType, cpgType] of expectedMappings) {
		test(`maps '${tsType}' → '${cpgType}'`, () => {
			expect(TS_NODE_MAP[tsType]).toBe(cpgType);
		});
	}

	test('unmapped node types return undefined (not throw)', () => {
		expect(TS_NODE_MAP['nonexistent_ts_node']).toBeUndefined();
		expect(TS_NODE_MAP['']).toBeUndefined();
	});
});

// ── extractNodeProps ──────────────────────────────────────────────────────────

describe('extractNodeProps', () => {
	const source = FIXTURE_SOURCE;

	// ── smoke ─────────────────────────────────────────────────────────────────
	test('smoke: returns an object with at minimum the base fields', () => {
		const node = makeNode({
			type: 'identifier',
			startIndex: 9,
			endIndex: 14,
			startPosition: { row: 0, column: 9 },
		});

		const props = extractNodeProps(node, source, FILE_PATH);

		expect(typeof props).toBe('object');
		expect(props).toHaveProperty('code');
		expect(props).toHaveProperty('lineNumber');
		expect(props).toHaveProperty('columnNumber');
		expect(props).toHaveProperty('offset');
		expect(props).toHaveProperty('offsetEnd');
		expect(props).toHaveProperty('filename');
	});

	// ── base fields ───────────────────────────────────────────────────────────
	test('lineNumber is 1-based (row + 1)', () => {
		const node = makeNode({
			type: 'identifier',
			startIndex: 0,
			endIndex: 5,
			startPosition: { row: 0, column: 0 }, // first line → row 0
		});
		const props = extractNodeProps(node, source, FILE_PATH);
		expect(props.lineNumber).toBe(1);
	});

	test('columnNumber is 0-based (matches tree-sitter column directly)', () => {
		const node = makeNode({
			type: 'identifier',
			startIndex: 9,
			endIndex: 14,
			startPosition: { row: 0, column: 9 },
		});
		const props = extractNodeProps(node, source, FILE_PATH);
		expect(props.columnNumber).toBe(9);
	});

	test('offset and offsetEnd match startIndex/endIndex from the node', () => {
		const node = makeNode({
			type: 'number',
			startIndex: 100,
			endIndex: 102,
			startPosition: { row: 9, column: 15 },
		});
		const props = extractNodeProps(node, source, FILE_PATH);
		expect(props.offset).toBe(100);
		expect(props.offsetEnd).toBe(102);
	});

	test('filename is the filePath passed in', () => {
		const node = makeNode({
			type: 'identifier',
			startIndex: 0,
			endIndex: 8,
			startPosition: { row: 0, column: 0 },
		});
		const props = extractNodeProps(node, source, FILE_PATH);
		expect(props.filename).toBe(FILE_PATH);
	});

	test('code is the sliced source substring for the node range', () => {
		// "greet" is at column 9 in line 1 — characters 9–14
		const node = makeNode({
			type: 'identifier',
			startIndex: 9,
			endIndex: 14,
			startPosition: { row: 0, column: 9 },
		});
		const props = extractNodeProps(node, source, FILE_PATH);
		expect(props.code).toBe(source.slice(9, 14));
	});

	test('code is truncated to 256 characters for very long nodes', () => {
		const longSource = 'x'.repeat(512);
		const node = makeNode({
			type: 'string',
			startIndex: 0,
			endIndex: 512,
			startPosition: { row: 0, column: 0 },
		});
		const props = extractNodeProps(node, longSource, FILE_PATH);
		expect((props.code as string).length).toBe(256);
	});

	// ── function_declaration ─────────────────────────────────────────────────
	test('function_declaration: extracts name from the name child node', () => {
		// "function greet(...)" — name child covers "greet" at indices 9–14
		const nameChildStart = 9;
		const nameChildEnd = 14;
		const node = makeNode({
			type: 'function_declaration',
			startIndex: 0,
			endIndex: 41,
			startPosition: { row: 0, column: 0 },
			childForFieldName: (field) =>
				field === 'name'
					? { startIndex: nameChildStart, endIndex: nameChildEnd }
					: null,
		});

		const props = extractNodeProps(node, source, FILE_PATH);
		expect(props.name).toBe('greet');
	});

	test('function_declaration: name is undefined when there is no name child', () => {
		const node = makeNode({
			type: 'function_declaration',
			startIndex: 0,
			endIndex: 41,
			startPosition: { row: 0, column: 0 },
			childForFieldName: () => null, // anonymous / no name child
		});

		const props = extractNodeProps(node, source, FILE_PATH);
		expect(props.name).toBeUndefined();
	});

	// ── class_declaration ─────────────────────────────────────────────────────
	test('class_declaration: extracts class name', () => {
		// "class Greeter {" — "Greeter" starts at col 6 on row 4
		const classStart = source.indexOf('class Greeter');
		const nameStart = classStart + 6; // "Greeter"
		const nameEnd = nameStart + 7;

		const node = makeNode({
			type: 'class_declaration',
			startIndex: classStart,
			endIndex: classStart + 30,
			startPosition: { row: 4, column: 0 },
			childForFieldName: (field) =>
				field === 'name' ? { startIndex: nameStart, endIndex: nameEnd } : null,
		});

		const props = extractNodeProps(node, source, FILE_PATH);
		expect(props.name).toBe('Greeter');
	});

	// ── identifier ────────────────────────────────────────────────────────────
	test('identifier: name equals the node text', () => {
		const node = makeNode({
			type: 'identifier',
			startIndex: 9,
			endIndex: 14, // "greet"
			startPosition: { row: 0, column: 9 },
		});
		const props = extractNodeProps(node, source, FILE_PATH);
		expect(props.name).toBe('greet');
		expect(props.name).toBe(props.code);
	});

	// ── type_identifier ───────────────────────────────────────────────────────
	test('type_identifier: name equals the node text', () => {
		// use a minimal source snippet for clarity
		const typeSource = 'string';
		const node = makeNode({
			type: 'type_identifier',
			startIndex: 0,
			endIndex: 6,
			startPosition: { row: 0, column: 0 },
		});
		const props = extractNodeProps(node, typeSource, FILE_PATH);
		expect(props.name).toBe('string');
	});

	// ── property_identifier ───────────────────────────────────────────────────
	test('property_identifier: sets canonicalName to the node text', () => {
		const propSource = 'length';
		const node = makeNode({
			type: 'property_identifier',
			startIndex: 0,
			endIndex: 6,
			startPosition: { row: 0, column: 0 },
		});
		const props = extractNodeProps(node, propSource, FILE_PATH);
		expect(props.canonicalName).toBe('length');
		expect(props).not.toHaveProperty('name');
	});

	test('private_property_identifier: sets canonicalName', () => {
		const privSource = '#secret';
		const node = makeNode({
			type: 'private_property_identifier',
			startIndex: 0,
			endIndex: 7,
			startPosition: { row: 0, column: 0 },
		});
		const props = extractNodeProps(node, privSource, FILE_PATH);
		expect(props.canonicalName).toBe('#secret');
	});

	// ── call_expression ───────────────────────────────────────────────────────
	test('call_expression: name is extracted from the function child', () => {
		// Simulate: `greet("hi")` — function child covers "greet"
		const callSource = 'greet("hi")';
		const node = makeNode({
			type: 'call_expression',
			startIndex: 0,
			endIndex: callSource.length,
			startPosition: { row: 0, column: 0 },
			childForFieldName: (field) =>
				field === 'function' ? { startIndex: 0, endIndex: 5 } : null,
		});
		const props = extractNodeProps(node, callSource, FILE_PATH);
		expect(props.name).toBe('greet');
	});

	test('call_expression: name is empty string when no function child', () => {
		const callSource = '()';
		const node = makeNode({
			type: 'call_expression',
			startIndex: 0,
			endIndex: 2,
			startPosition: { row: 0, column: 0 },
			childForFieldName: () => null,
		});
		const props = extractNodeProps(node, callSource, FILE_PATH);
		expect(props.name).toBe('');
	});

	test('call_expression: function name is capped at 64 characters', () => {
		const longName = 'a'.repeat(100);
		const callSource = longName + '()';
		const node = makeNode({
			type: 'call_expression',
			startIndex: 0,
			endIndex: callSource.length,
			startPosition: { row: 0, column: 0 },
			childForFieldName: (field) =>
				field === 'function'
					? { startIndex: 0, endIndex: longName.length }
					: null,
		});
		const props = extractNodeProps(node, callSource, FILE_PATH);
		expect((props.name as string).length).toBe(64);
	});

	// ── default / unhandled types ─────────────────────────────────────────────
	test('default case: returns base fields only, no name property', () => {
		const node = makeNode({
			type: 'if_statement',
			startIndex: 0,
			endIndex: 10,
			startPosition: { row: 11, column: 0 },
		});
		const props = extractNodeProps(node, source, FILE_PATH);
		expect(props.lineNumber).toBe(12);
		// name should not be added by the default case
		expect(props.name).toBeUndefined();
		expect(props.canonicalName).toBeUndefined();
	});

	test('unmapped/unknown type does not throw', () => {
		const node = makeNode({
			type: 'completely_unknown_node_type',
			startIndex: 0,
			endIndex: 5,
			startPosition: { row: 0, column: 0 },
		});
		expect(() => extractNodeProps(node, source, FILE_PATH)).not.toThrow();
	});

	// ── deeply nested / edge cases ────────────────────────────────────────────
	test('handles a node at the very end of the source string', () => {
		const miniSource = 'abc';
		const node = makeNode({
			type: 'identifier',
			startIndex: 0,
			endIndex: 3,
			startPosition: { row: 0, column: 0 },
		});
		const props = extractNodeProps(node, miniSource, FILE_PATH);
		expect(props.code).toBe('abc');
		expect(props.name).toBe('abc');
	});

	test('handles a zero-width node (startIndex === endIndex)', () => {
		const node = makeNode({
			type: 'identifier',
			startIndex: 5,
			endIndex: 5,
			startPosition: { row: 0, column: 5 },
		});
		const props = extractNodeProps(node, source, FILE_PATH);
		expect(props.code).toBe('');
		expect(props.name).toBe('');
	});

	test('handles Unicode characters in source correctly', () => {
		const unicodeSource = 'const 变量 = 42;'; // Chinese identifier (if valid)
		const node = makeNode({
			type: 'identifier',
			startIndex: 6,
			endIndex: 8, // bytes may differ; slice by char index
			startPosition: { row: 0, column: 6 },
		});
		// Should not throw regardless of content
		expect(() => extractNodeProps(node, unicodeSource, FILE_PATH)).not.toThrow();
		const props = extractNodeProps(node, unicodeSource, FILE_PATH);
		expect(typeof props.code).toBe('string');
	});

	test('handles large source without error', () => {
		const bigSource = 'x'.repeat(100_000);
		const node = makeNode({
			type: 'identifier',
			startIndex: 0,
			endIndex: 100,
			startPosition: { row: 0, column: 0 },
		});
		expect(() => extractNodeProps(node, bigSource, FILE_PATH)).not.toThrow();
	});

	test('interface_declaration: extracts name via name child', () => {
		const iSource = 'interface IFoo {}';
		const node = makeNode({
			type: 'interface_declaration',
			startIndex: 0,
			endIndex: iSource.length,
			startPosition: { row: 0, column: 0 },
			childForFieldName: (field) =>
				field === 'name' ? { startIndex: 10, endIndex: 14 } : null,
		});
		const props = extractNodeProps(node, iSource, FILE_PATH);
		expect(props.name).toBe('IFoo');
	});

	test('type_alias_declaration: extracts name via name child', () => {
		const tSource = 'type Alias = string;';
		const node = makeNode({
			type: 'type_alias_declaration',
			startIndex: 0,
			endIndex: tSource.length,
			startPosition: { row: 0, column: 0 },
			childForFieldName: (field) =>
				field === 'name' ? { startIndex: 5, endIndex: 10 } : null,
		});
		const props = extractNodeProps(node, tSource, FILE_PATH);
		expect(props.name).toBe('Alias');
	});

	test('enum_declaration: extracts name via name child', () => {
		const eSource = 'enum Color { Red }';
		const node = makeNode({
			type: 'enum_declaration',
			startIndex: 0,
			endIndex: eSource.length,
			startPosition: { row: 0, column: 0 },
			childForFieldName: (field) =>
				field === 'name' ? { startIndex: 5, endIndex: 10 } : null,
		});
		const props = extractNodeProps(node, eSource, FILE_PATH);
		expect(props.name).toBe('Color');
	});
});
