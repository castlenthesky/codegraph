/**
 * Shared CPG node utilities used by both GraphViewProvider and DiffEngine.
 */

/**
 * Maps a CPG node label to a size multiplier for force-graph rendering.
 * Higher values produce larger nodes.
 */
export function cpgNodeVal(label: string): number {
	switch (label) {
		case 'METHOD': return 4;
		case 'TYPE_DECL': return 3;
		case 'DIRECTORY': return 3;
		case 'CALL': return 2;
		case 'CONTROL_STRUCTURE': return 2;
		case 'IDENTIFIER': return 1.5;
		case 'LITERAL': return 1.5;
		case 'BLOCK': return 1;
		default: return 2;
	}
}
