; =============================================================================
; taint-wrangler — TypeScript/JavaScript symbol and import queries
; tree-sitter-typescript >= 0.20
;
; Capture name conventions (shared across ALL language query files):
;   @symbol.def       — the full definition node (used for line numbers, kind)
;   @symbol.name      — the name identifier node
;   @symbol.params    — parameter list node (optional)
;   @symbol.modifiers — decorator / visibility modifier nodes (optional)
;   @import.statement — the full import node
;   @import.module    — the module path being imported from
;
; CPG-specific extensions (prefixed tw. to avoid collision):
;   @tw.call          — call expression nodes (for CallResolver)
;   @tw.local         — variable declarators (for PDG local tracking)
; =============================================================================

; ---------------------------------------------------------------------------
; Symbols
; ---------------------------------------------------------------------------

; Top-level function declaration
(function_declaration
  name: (identifier) @symbol.name
  parameters: (formal_parameters) @symbol.params
) @symbol.def

; Generator function
(generator_function_declaration
  name: (identifier) @symbol.name
  parameters: (formal_parameters) @symbol.params
) @symbol.def

; Class declaration
(class_declaration
  name: (type_identifier) @symbol.name
) @symbol.def

; Interface
(interface_declaration
  name: (type_identifier) @symbol.name
) @symbol.def

; Type alias
(type_alias_declaration
  name: (type_identifier) @symbol.name
) @symbol.def

; Enum
(enum_declaration
  name: (identifier) @symbol.name
) @symbol.def

; Method inside class body
(method_definition
  name: (property_identifier) @symbol.name
  parameters: (formal_parameters) @symbol.params
) @symbol.def

; Method with accessibility modifier (public/private/protected)
(method_definition
  (accessibility_modifier) @symbol.modifiers
  name: (property_identifier) @symbol.name
  parameters: (formal_parameters) @symbol.params
) @symbol.def

; Arrow function assigned to const/let: const foo = (...) => { }
(lexical_declaration
  (variable_declarator
    name: (identifier) @symbol.name
    value: (arrow_function
      parameters: (formal_parameters) @symbol.params
    )
  )
) @symbol.def

; Function expression assigned to const/let: const foo = function(...) { }
(lexical_declaration
  (variable_declarator
    name: (identifier) @symbol.name
    value: (function_expression
      parameters: (formal_parameters) @symbol.params
    )
  )
) @symbol.def

; Decorator on class or method
(decorator) @symbol.modifiers

; ---------------------------------------------------------------------------
; Imports
; ---------------------------------------------------------------------------

; import { A, B } from "./module"
; import type { T } from "./types"
; import DefaultExport from "module"
; import * as Foo from "module"
; import "./side-effect"
(import_statement
  source: (string) @import.module
) @import.statement

; ---------------------------------------------------------------------------
; CPG-specific: call sites (for CallResolver cross-file edge building)
; ---------------------------------------------------------------------------

(call_expression
  function: (_) @tw.call
)

; ---------------------------------------------------------------------------
; CPG-specific: local variable definitions (for PDG reaching-def tracking)
; ---------------------------------------------------------------------------

(variable_declarator
  name: (identifier) @tw.local
)
