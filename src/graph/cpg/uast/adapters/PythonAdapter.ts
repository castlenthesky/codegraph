import type { CpgNodeType } from '../../../../types/cpg';

export const PY_NODE_MAP: Record<string, CpgNodeType> = {
	'module': 'FILE',
	'function_definition': 'METHOD',
	'class_definition': 'TYPE_DECL',
	'block': 'BLOCK',
	'if_statement': 'CONTROL_STRUCTURE',
	'for_statement': 'CONTROL_STRUCTURE',
	'while_statement': 'CONTROL_STRUCTURE',
	'try_statement': 'CONTROL_STRUCTURE',
	'with_statement': 'CONTROL_STRUCTURE',
	'assignment': 'UNKNOWN',
	'named_expression': 'LOCAL',
	'call': 'CALL',
	'import_from_statement': 'CALL',
	'import_statement': 'CALL',
	'identifier': 'IDENTIFIER',
	'string': 'LITERAL',
	'integer': 'LITERAL',
	'float': 'LITERAL',
	'true': 'LITERAL',
	'false': 'LITERAL',
	'none': 'LITERAL',
	'return_statement': 'RETURN',
	'comment': 'COMMENT',
	'decorator': 'ANNOTATION',
};

export function extractNodeProps(
	tsNode: { type: string; startIndex: number; endIndex: number; startPosition: { row: number; column: number }; childForFieldName(name: string): { startIndex: number; endIndex: number } | null },
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
		case 'function_definition':
		case 'class_definition': {
			const nameNode = tsNode.childForFieldName('name');
			return { ...base, name: nameNode ? source.slice(nameNode.startIndex, nameNode.endIndex) : undefined };
		}
		case 'assignment': {
			const leftNode = tsNode.childForFieldName('left');
			return { ...base, name: leftNode ? source.slice(leftNode.startIndex, leftNode.endIndex).substring(0, 64) : undefined };
		}
		case 'call': {
			const fn = tsNode.childForFieldName('function');
			return { ...base, name: fn ? source.slice(fn.startIndex, fn.endIndex).substring(0, 64) : '' };
		}
		case 'identifier':
			return { ...base, name: nodeText };
		default:
			return base;
	}
}
