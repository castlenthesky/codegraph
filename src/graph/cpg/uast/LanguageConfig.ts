/**
 * Data-driven language configuration registry.
 * Each entry provides everything the CPG pipeline needs to support a language:
 * node type mappings, grammar info, import patterns, and metadata.
 *
 * Inspired by repowise's LANGUAGE_CONFIGS pattern — a single dict of config
 * objects replaces per-language subclasses, making it trivial to add new languages.
 */
import type { CpgNodeType } from '../../../types/cpg';

export interface LanguageConfig {
	/** Maps tree-sitter node type strings to CPG node type labels. */
	nodeMap: Record<string, CpgNodeType>;

	/** NPM package providing the tree-sitter grammar, with optional sub-export. */
	grammar: { module: string; subExport?: string };

	/** tree-sitter node types that represent import statements. */
	importNodeTypes: string[];

	/** tree-sitter node types that represent export declarations. */
	exportNodeTypes: string[];

	/**
	 * Determine symbol visibility from its name and any modifier strings.
	 * Mirrors repowise's per-language visibility_fn.
	 */
	visibilityFn: (name: string, modifiers: string[]) => 'public' | 'private' | 'protected';

	/** Common entry-point filenames for this language. */
	entryPointPatterns: string[];

	/** tree-sitter node types that represent class-like scopes (for parent detection). */
	parentClassTypes: Set<string>;

	/**
	 * Relative path (from extension root) to the .scm query file for this language.
	 * Used by QueryService in Phase 2.
	 */
	queryFile: string;

	/** File extensions that map to this language (without dot). */
	fileExtensions: string[];
}

// ---------------------------------------------------------------------------
// TypeScript / JavaScript
// ---------------------------------------------------------------------------

const TS_NODE_MAP: Record<string, CpgNodeType> = {
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

function tsVisibility(name: string, modifiers: string[]): 'public' | 'private' | 'protected' {
	if (modifiers.includes('private')) { return 'private'; }
	if (modifiers.includes('protected')) { return 'protected'; }
	return 'public';
}

const TYPESCRIPT_CONFIG: LanguageConfig = {
	nodeMap: TS_NODE_MAP,
	grammar: { module: 'tree-sitter-typescript', subExport: 'typescript' },
	importNodeTypes: ['import_statement'],
	exportNodeTypes: ['export_statement'],
	visibilityFn: tsVisibility,
	entryPointPatterns: ['index.ts', 'index.js', 'main.ts', 'main.js', 'app.ts', 'app.js', 'server.ts', 'server.js'],
	parentClassTypes: new Set(['class_declaration', 'class_expression']),
	queryFile: 'resources/queries/typescript.scm',
	fileExtensions: ['ts', 'tsx', 'js', 'jsx'],
};

// JavaScript shares the TypeScript grammar but gets its own config entry
// so LanguageConfig-aware code can reference 'javascript' directly.
const JAVASCRIPT_CONFIG: LanguageConfig = {
	...TYPESCRIPT_CONFIG,
	fileExtensions: ['js', 'jsx'],
};

// ---------------------------------------------------------------------------
// Python
// ---------------------------------------------------------------------------

const PY_NODE_MAP: Record<string, CpgNodeType> = {
	// File root
	'module': 'FILE',

	// Definitions
	'function_definition': 'METHOD',
	'lambda': 'METHOD',
	'class_definition': 'TYPE_DECL',

	// Parameters (individual param nodes, not the container)
	'default_parameter': 'METHOD_PARAMETER_IN',
	'typed_parameter': 'METHOD_PARAMETER_IN',
	'typed_default_parameter': 'METHOD_PARAMETER_IN',
	'list_splat_pattern': 'METHOD_PARAMETER_IN',    // *args
	'dictionary_splat_pattern': 'METHOD_PARAMETER_IN', // **kwargs

	// Blocks
	'block': 'BLOCK',

	// Control structures
	'if_statement': 'CONTROL_STRUCTURE',
	'for_statement': 'CONTROL_STRUCTURE',
	'while_statement': 'CONTROL_STRUCTURE',
	'try_statement': 'CONTROL_STRUCTURE',
	'with_statement': 'CONTROL_STRUCTURE',
	'raise_statement': 'CONTROL_STRUCTURE',
	'except_clause': 'CONTROL_STRUCTURE',
	'conditional_expression': 'CONTROL_STRUCTURE',  // ternary: x if cond else y

	// Locals / variable definitions
	'assignment': 'LOCAL',           // was UNKNOWN — needed for PDG reaching-def
	'augmented_assignment': 'LOCAL', // x += 1
	'named_expression': 'LOCAL',     // walrus operator :=

	// Calls
	'call': 'CALL',
	'assert_statement': 'CALL',  // assert as a call-like construct
	'import_from_statement': 'CALL',
	'import_statement': 'CALL',

	// Field access
	'attribute': 'FIELD_IDENTIFIER',  // obj.attr — was missing

	// Identifiers + literals
	'identifier': 'IDENTIFIER',
	'string': 'LITERAL',
	'integer': 'LITERAL',
	'float': 'LITERAL',
	'true': 'LITERAL',
	'false': 'LITERAL',
	'none': 'LITERAL',

	// Control flow returns
	'return_statement': 'RETURN',
	'yield': 'RETURN',
	'yield_statement': 'RETURN',

	// Annotations
	'comment': 'COMMENT',
	'decorator': 'ANNOTATION',
};

function pyVisibility(name: string, _modifiers: string[]): 'public' | 'private' | 'protected' {
	// Python convention: double underscore = private, single = "protected" (by convention)
	if (name.startsWith('__') && !name.endsWith('__')) { return 'private'; }
	if (name.startsWith('_')) { return 'protected'; }
	return 'public';
}

const PYTHON_CONFIG: LanguageConfig = {
	nodeMap: PY_NODE_MAP,
	grammar: { module: 'tree-sitter-python' },
	importNodeTypes: ['import_statement', 'import_from_statement'],
	exportNodeTypes: [],  // Python has no explicit export syntax
	visibilityFn: pyVisibility,
	entryPointPatterns: ['__main__.py', 'main.py', 'app.py', 'wsgi.py', 'asgi.py', 'manage.py'],
	parentClassTypes: new Set(['class_definition']),
	queryFile: 'resources/queries/python.scm',
	fileExtensions: ['py'],
};

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export const LANGUAGE_CONFIGS: Record<string, LanguageConfig> = {
	'typescript': TYPESCRIPT_CONFIG,
	'javascript': JAVASCRIPT_CONFIG,
	'python': PYTHON_CONFIG,
};
