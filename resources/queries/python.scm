; =============================================================================
; taint-wrangler — Python symbol and import queries
; tree-sitter-python >= 0.21
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
;   @tw.local         — assignment targets (for PDG local tracking)
; =============================================================================

; ---------------------------------------------------------------------------
; Symbols
; ---------------------------------------------------------------------------

; Regular function (covers both sync and async — tree-sitter-python >= 0.21
; uses function_definition for both; async_function_definition in older versions)
(function_definition
  name: (identifier) @symbol.name
  parameters: (parameters) @symbol.params
) @symbol.def

; Decorated function — capture the decorator as a modifier
(decorated_definition
  (decorator) @symbol.modifiers
  (function_definition
    name: (identifier) @symbol.name
    parameters: (parameters) @symbol.params
  ) @symbol.def
)

; Class
(class_definition
  name: (identifier) @symbol.name
) @symbol.def

; Decorated class
(decorated_definition
  (decorator) @symbol.modifiers
  (class_definition
    name: (identifier) @symbol.name
  ) @symbol.def
)

; ---------------------------------------------------------------------------
; Imports
; ---------------------------------------------------------------------------

; from x.y import a, b
; from . import x
(import_from_statement
  module_name: (_) @import.module
) @import.statement

; import x.y.z
(import_statement
  name: (_) @import.module
) @import.statement

; ---------------------------------------------------------------------------
; CPG-specific: call sites (for CallResolver cross-file edge building)
; ---------------------------------------------------------------------------

(call
  function: (_) @tw.call
)

; ---------------------------------------------------------------------------
; CPG-specific: local variable definitions (for PDG reaching-def tracking)
; ---------------------------------------------------------------------------

(assignment
  left: (identifier) @tw.local
)
