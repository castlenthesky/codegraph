/**
 * Graph node type definitions based on Joern CPG specification
 * Extended with FILE and DIRECTORY nodes for file system tracking
 */

export interface BaseNode {
	id: string;
	label: string;
}

export interface DirectoryNode extends BaseNode {
	label: 'DIRECTORY';
	name: string;
	path: string;
	relativePath: string;
	createdAt: number;
	modifiedAt: number;
}

export interface FileNode extends BaseNode {
	label: 'FILE';
	name: string;
	path: string;
	relativePath: string;
	extension: string;
	language: string;
	size: number;
	createdAt: number;
	modifiedAt: number;
	isParsed: boolean;
}

export type GraphNode = DirectoryNode | FileNode;

export interface GraphEdge {
	source: string;
	target: string;
	type: EdgeType;
}

export type EdgeType =
	| 'CONTAINS'    // Directory contains file/subdirectory
	| 'PARENT'      // Child to parent directory
	| 'DEFINED_IN'; // Code node defined in file
