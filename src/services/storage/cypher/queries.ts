/**
 * Cypher query serialization helpers for FalkorDB.
 * Used by FalkorDBStore to build property literals inline.
 * Note: FalkorDB does not support parameterized labels, so label names
 * must be validated against an allowlist before interpolation.
 */

import type { CpgNode, CpgEdge } from '../../../types/cpg';

export function serializeValue(value: unknown): string {
	if (typeof value === 'string') {
		const escaped = value
			.replace(/\\/g, '\\\\')
			.replace(/\n/g, '\\n')
			.replace(/\r/g, '\\r')
			.replace(/"/g, '\\"');
		return `"${escaped}"`;
	} else if (typeof value === 'number' || typeof value === 'boolean') {
		return String(value);
	} else if (value === null || value === undefined) {
		return 'null';
	}
	return `"${String(value)}"`;
}

export function serializeProperties(obj: Record<string, unknown>): string {
	const props = Object.entries(obj)
		.map(([key, value]) => `${key}: ${serializeValue(value)}`)
		.join(', ');
	return `{${props}}`;
}

const VALID_CPG_LABELS = new Set([
	'FILE', 'METHOD', 'CALL', 'TYPE_DECL', 'IDENTIFIER', 'LITERAL', 'BLOCK',
	'CONTROL_STRUCTURE', 'LOCAL', 'NAMESPACE', 'NAMESPACE_BLOCK',
	'METHOD_PARAMETER_IN', 'METHOD_PARAMETER_OUT', 'METHOD_RETURN',
	'MEMBER', 'TYPE', 'TYPE_PARAMETER', 'TYPE_ARGUMENT', 'RETURN',
	'MODIFIER', 'FIELD_IDENTIFIER', 'METHOD_REF', 'TYPE_REF',
	'JUMP_TARGET', 'JUMP_LABEL', 'COMMENT', 'META_DATA', 'UNKNOWN',
	'BINDING', 'ANNOTATION', 'ANNOTATION_PARAMETER_ASSIGN',
	'ANNOTATION_PARAMETER', 'ANNOTATION_LITERAL',
	'CONFIG_FILE', 'FINDING', 'KEY_VALUE_PAIR', 'TAG', 'TAG_NODE_PAIR',
	'DIRECTORY',
]);

export function safeCpgLabel(label: string): string {
	return VALID_CPG_LABELS.has(label) ? label : 'UNKNOWN';
}

export function buildBatchNodeCypher(nodes: CpgNode[]): string[] {
	return nodes.map(node => {
		const props = serializeProperties(node as unknown as Record<string, unknown>);
		const label = safeCpgLabel(node.label);
		return `MERGE (n:${label} {id: "${node.id.replace(/"/g, '\\"')}"}) SET n += ${props}`;
	});
}

export function buildBatchEdgeCypher(edges: CpgEdge[]): string[] {
	return edges.map(edge => {
		const extra = edge.variable ? ` {variable: "${edge.variable.replace(/"/g, '\\"')}"}` : '';
		return `MATCH (s {id: "${edge.source.replace(/"/g, '\\"')}"}), (t {id: "${edge.target.replace(/"/g, '\\"')}"}) MERGE (s)-[:${edge.type}${extra}]->(t)`;
	});
}
