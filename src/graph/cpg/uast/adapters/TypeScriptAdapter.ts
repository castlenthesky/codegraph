import type { CpgNodeType } from '../../../../types/cpg';

export const TS_NODE_MAP: Record<string, CpgNodeType> = {
	'program': 'FILE',
	'function_declaration': 'METHOD',
	'method_definition': 'METHOD',
	'arrow_function': 'METHOD',
	'function_expression': 'METHOD',
	'generator_function_declaration': 'METHOD',
	'class_declaration': 'TYPE_DECL',
	'class_expression': 'TYPE_DECL',
	'interface_declaration': 'TYPE_DECL',
	'type_alias_declaration': 'TYPE_DECL',
	'enum_declaration': 'TYPE_DECL',
	'statement_block': 'BLOCK',
	'call_expression': 'CALL',
	'new_expression': 'CALL',
	'if_statement': 'CONTROL_STRUCTURE',
	'for_statement': 'CONTROL_STRUCTURE',
	'for_in_statement': 'CONTROL_STRUCTURE',
	'while_statement': 'CONTROL_STRUCTURE',
	'do_statement': 'CONTROL_STRUCTURE',
	'switch_statement': 'CONTROL_STRUCTURE',
	'try_statement': 'CONTROL_STRUCTURE',
	'identifier': 'IDENTIFIER',
	'property_identifier': 'FIELD_IDENTIFIER',
	'shorthand_property_identifier': 'FIELD_IDENTIFIER',
	'private_property_identifier': 'FIELD_IDENTIFIER',
	'string': 'LITERAL',
	'template_string': 'LITERAL',
	'number': 'LITERAL',
	'true': 'LITERAL',
	'false': 'LITERAL',
	'null': 'LITERAL',
	'undefined': 'LITERAL',
	'variable_declarator': 'LOCAL',
	'required_parameter': 'METHOD_PARAMETER_IN',
	'optional_parameter': 'METHOD_PARAMETER_IN',
	'return_statement': 'RETURN',
	'type_identifier': 'TYPE_REF',
	'predefined_type': 'TYPE_REF',
	'comment': 'COMMENT',
	'decorator': 'ANNOTATION',
	'import_statement': 'CALL',
	'export_statement': 'MODIFIER',
	'namespace_import': 'NAMESPACE_BLOCK',
	'member_expression': 'FIELD_IDENTIFIER',
};

export function extractNodeProps(
	tsNode: { type: string; startIndex: number; endIndex: number; startPosition: { row: number; column: number }; childForFieldName(name: string): { startIndex: number; endIndex: number } | null; parent?: { type: string; childForFieldName(name: string): { startIndex: number; endIndex: number } | null } | null },
	source: string,
	filePath: string
): Record<string, unknown> {
	const nodeText = source.slice(tsNode.startIndex, tsNode.endIndex).substring(0, 256);
	const base: Record<string, unknown> = {
		code: nodeText,
		lineNumber: tsNode.startPosition.row + 1,
		columnNumber: tsNode.startPosition.column,
		offset: tsNode.startIndex,
		offsetEnd: tsNode.endIndex,
		filename: filePath,
	};

	switch (tsNode.type) {
		case 'function_declaration':
		case 'method_definition':
		case 'class_declaration':
		case 'interface_declaration':
		case 'type_alias_declaration':
		case 'enum_declaration': {
			const nameNode = tsNode.childForFieldName('name');
			return { ...base, name: nameNode ? source.slice(nameNode.startIndex, nameNode.endIndex) : undefined };
		}
		case 'arrow_function':
		case 'function_expression': {
			const parent = tsNode.parent;
			if (parent && parent.type === 'variable_declarator') {
				const nameNode = parent.childForFieldName('name');
				if (nameNode) {
					return { ...base, name: source.slice(nameNode.startIndex, nameNode.endIndex) };
				}
			}
			return { ...base, name: '<anonymous>' };
		}
		case 'identifier':
		case 'type_identifier':
			return { ...base, name: nodeText };
		case 'property_identifier':
		case 'private_property_identifier':
			return { ...base, canonicalName: nodeText };
		case 'call_expression': {
			const fn = tsNode.childForFieldName('function');
			return { ...base, name: fn ? source.slice(fn.startIndex, fn.endIndex).substring(0, 64) : '' };
		}
		default:
			return base;
	}
}
