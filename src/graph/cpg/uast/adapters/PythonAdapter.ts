/**
 * Python node property extractor.
 * The nodeMap has moved to LanguageConfig.ts (PYTHON_CONFIG.nodeMap).
 * This file retains only the extractNodeProps function which has complex
 * language-specific logic that doesn't belong in a data config.
 */
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
		case 'lambda': {
			// Anonymous — synthesize a positional name for debugging
			return { ...base, name: `<lambda>:${tsNode.startPosition.row + 1}` };
		}
		// Individual parameter node types
		case 'default_parameter':
		case 'typed_parameter':
		case 'typed_default_parameter': {
			const nameNode = tsNode.childForFieldName('name');
			return { ...base, name: nameNode ? source.slice(nameNode.startIndex, nameNode.endIndex) : nodeText.substring(0, 64) };
		}
		case 'list_splat_pattern': {
			// *args — strip the leading *
			return { ...base, name: nodeText.replace(/^\*/, '').substring(0, 64) };
		}
		case 'dictionary_splat_pattern': {
			// **kwargs — strip the leading **
			return { ...base, name: nodeText.replace(/^\*\*/, '').substring(0, 64) };
		}
		case 'attribute': {
			// obj.attr — emit canonicalName as the full "obj.attr" text
			return { ...base, canonicalName: nodeText.substring(0, 64) };
		}
		case 'assignment':
		case 'augmented_assignment': {
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
