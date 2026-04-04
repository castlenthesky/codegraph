---
name: Development Workflow
description: How to run tests, scripts, and the extension; key commands and gotchas
type: project
---

## Key Commands
- `bun test test/unit` — run all unit tests (392 tests as of session 1)
- `bun run scripts/generate-snapshots.ts` — regenerate CST JSON snapshots (alias: `npm run test:update-goldens`)
- `bun run scripts/generate-uast-snapshot.ts [language]` — generate UAST JSON for a language fixture (python, typescript, javascript); omit arg for all languages
- `bun run scripts/parse.ts <file>` — print raw tree-sitter S-expression CST for a file
- `npm run compile` — tsc compilation (output to `out/`); tests are NOT compiled (excluded from tsconfig)
- `npm run lint` — ESLint on src/

## Testing Gotchas
- Tests run with **bun test**, not mocha/jest. Use `bun:test` imports (`describe`, `test`, `expect`, `mock`).
- Tree-sitter native bindings DO NOT work under bun test — tests must mock `tree-sitter`, `tree-sitter-typescript`, and `tree-sitter-python` via `mock.module()`.
- Scripts (in `scripts/`) run directly with `bun run` and CAN use real tree-sitter native bindings.
- `test/` directory is excluded from `tsconfig.json` — tests run via bun, not tsc.
- `mock.module` is last-write-wins per file — grammar failure tests are isolated to a separate file (`parserService.grammarFailure.test.ts`) for this reason.

## Snapshot Directories
- CST snapshots: `test/__snapshots__/tree-sitter-cst/{language}/{language}_hello_world.json`
- UAST snapshots: `test/__snapshots__/uast/{language}/{language}_hello_world.json`

## Adding a New Language Adapter
1. Create `src/graph/cpg/uast/adapters/{Language}Adapter.ts` — export `{LANG}_NODE_MAP` and `extractNodeProps()`
2. Add a case to `getAdapter()` in `UastBuilder.ts`
3. Add the grammar to `generate-uast-snapshot.ts` `LANGUAGE_MAP`
4. Run `bun run scripts/generate-uast-snapshot.ts {language}` to generate the snapshot
5. Check `tree-sitter-{language}` is in package.json devDependencies
