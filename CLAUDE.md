# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a VS Code extension project called "codegraph" that provides a graph representation of code symbols. The extension is built with TypeScript and targets VS Code 1.107.0+.

## Development Commands

### Build and Compilation
- `npm run compile` - Compile TypeScript to JavaScript (output to `out/` directory)
- `npm run watch` - Watch mode compilation for development
- `npm run vscode:prepublish` - Production build (runs compile)

### Testing and Linting
- `npm test` - Run tests using vscode-test (runs pretest automatically)
- `npm run pretest` - Compile and lint (runs before tests)
- `npm run lint` - Run ESLint on the src directory

### Running the Extension
Use VS Code's debugger with the "Run Extension" launch configuration (F5) to test the extension in an Extension Development Host window.

## Architecture

### Project Structure
- `src/extension.ts` - Main extension entry point with activate/deactivate lifecycle hooks
- `src/test/extension.test.ts` - Test suite using Mocha
- `out/` - Compiled JavaScript output (git-ignored)
- `.vscode/launch.json` - Debug configurations for running extension and tests

### Extension Activation
The extension activates based on events defined in `package.json` activationEvents. Currently registers the `codegraph.helloWorld` command.

### TypeScript Configuration
- Module system: Node16
- Target: ES2022
- Strict mode enabled
- Source maps generated for debugging

### Linting Rules
ESLint configured with typescript-eslint:
- Naming conventions enforced (camelCase/PascalCase for imports)
- Requires curly braces, strict equality (===), semicolons
- Warns on throwing literals
