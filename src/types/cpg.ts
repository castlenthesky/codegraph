/**
 * Joern CPG (Code Property Graph) type system.
 * Defines all node types, edge types, and their properties per the Joern specification.
 */

// All 37+ concrete CPG node type strings
export type CpgNodeType =
	| 'META_DATA' | 'FILE' | 'NAMESPACE' | 'NAMESPACE_BLOCK'
	| 'METHOD' | 'METHOD_PARAMETER_IN' | 'METHOD_PARAMETER_OUT' | 'METHOD_RETURN'
	| 'TYPE' | 'TYPE_DECL' | 'TYPE_PARAMETER' | 'TYPE_ARGUMENT' | 'MEMBER'
	| 'BLOCK' | 'CALL' | 'CONTROL_STRUCTURE' | 'FIELD_IDENTIFIER' | 'IDENTIFIER'
	| 'LITERAL' | 'LOCAL' | 'METHOD_REF' | 'MODIFIER' | 'RETURN'
	| 'JUMP_TARGET' | 'JUMP_LABEL' | 'TYPE_REF'
	| 'COMMENT' | 'FINDING' | 'KEY_VALUE_PAIR' | 'TAG' | 'TAG_NODE_PAIR'
	| 'CONFIG_FILE' | 'BINDING' | 'ANNOTATION' | 'ANNOTATION_PARAMETER_ASSIGN'
	| 'ANNOTATION_PARAMETER' | 'ANNOTATION_LITERAL' | 'UNKNOWN';

// All CPG edge types
export type CpgEdgeType =
	| 'AST' | 'CFG' | 'REACHING_DEF' | 'CDG'
	| 'DOMINATE' | 'POST_DOMINATE'
	| 'CALL' | 'REF' | 'EVAL_TYPE' | 'CONTAINS'
	| 'BINDS_TO' | 'INHERITS_FROM' | 'BINDS' | 'TAGGED_BY'
	| 'SOURCE_FILE' | 'CONDITION' | 'RECEIVER' | 'ARGUMENT'
	| 'CAPTURE' | 'PARAMETER_LINK' | 'IS_CALL_FOR_IMPORT';

// Base CPG node - all optional properties that any CPG node might have
export interface CpgNode {
	id: string;
	label: CpgNodeType;
	// AST_NODE base properties
	code?: string;
	lineNumber?: number;
	columnNumber?: number;
	offset?: number;
	offsetEnd?: number;
	order?: number;
	// Name/identification
	name?: string;
	fullName?: string;
	filename?: string;
	// Type system
	typeFullName?: string;
	dynamicTypeHintFullName?: string;
	inheritsFromTypeFullName?: string[];
	typeDeclFullName?: string;
	// Method properties
	signature?: string;
	methodFullName?: string;
	isExternal?: boolean;
	astParentType?: string;
	astParentFullName?: string;
	evaluationStrategy?: string;
	// Call/expression properties
	dispatchType?: string;
	argumentIndex?: number;
	argumentName?: string;
	// Control flow
	controlStructureType?: string;
	// Identifiers
	canonicalName?: string;
	closureBindingId?: string;
	// Modifiers/annotations
	modifierType?: string;
	// Parameters
	index?: number;
	// AST parser info
	parserTypeName?: string;
	containedRef?: string;
	// META_DATA properties
	language?: string;
	version?: string;
	overlays?: string[];
	root?: string;
	hash?: string;
	content?: string;
	// Key-value
	key?: string;
	value?: string;
}

export interface CpgEdge {
	source: string;
	target: string;
	type: CpgEdgeType;
	variable?: string;  // For REACHING_DEF edges
}

export interface UastBuildResult {
	nodes: CpgNode[];
	edges: CpgEdge[];
	removedNodeIds: string[];
}
