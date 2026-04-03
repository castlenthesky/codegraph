/**
 * Cypher query serialization helpers for FalkorDB.
 * Used by FalkorDBStore to build property literals inline.
 * Note: FalkorDB does not support parameterized labels, so label names
 * must be validated against an allowlist before interpolation.
 */

export function serializeValue(value: unknown): string {
	if (typeof value === 'string') {
		return `"${value.replace(/"/g, '\\"')}"`;
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
