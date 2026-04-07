/**
 * TypeScript/JavaScript node property extractor.
 * The nodeMap has moved to LanguageConfig.ts (TYPESCRIPT_CONFIG.nodeMap).
 * This file retains only the extractNodeProps function which has complex
 * language-specific logic that doesn't belong in a data config.
 *
 * TS_NODE_MAP is re-exported from LanguageConfig for backward compatibility
 * with existing tests and any code that imports it directly.
 */
export { LANGUAGE_CONFIGS } from '../LanguageConfig';
// Convenience re-export so tests and callers can still import TS_NODE_MAP here
import { LANGUAGE_CONFIGS as _LC } from '../LanguageConfig';
export const TS_NODE_MAP = _LC['typescript'].nodeMap;

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
