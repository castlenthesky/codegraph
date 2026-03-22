import * as assert from 'assert';
import * as path from 'path';
import * as fs from 'fs';
import Parser from 'tree-sitter';
import Python from 'tree-sitter-python';

import { describe, test, beforeAll } from 'bun:test';

describe('Tree-sitter Parser Test Suite', () => {
    let parser: Parser;
    const pythonFixturesPath = path.join(__dirname, '..', 'test', 'fixtures', 'code_examples', 'python', 'src');

    beforeAll(() => {
        // Initialize the parser with Python language
        parser = new Parser();
        parser.setLanguage(Python);
    });

    test('Parser should be initialized', () => {
        assert.ok(parser, 'Parser should be defined');
        assert.ok(parser.getLanguage(), 'Parser should have a language set');
    });

    test('Should parse database/db.py without errors', () => {
        const filePath = path.join(pythonFixturesPath, 'database', 'db.py');
        const sourceCode = fs.readFileSync(filePath, 'utf8');

        const tree = parser.parse(sourceCode);

        assert.ok(tree, 'Tree should be created');
        assert.ok(tree.rootNode, 'Tree should have a root node');
        assert.strictEqual(tree.rootNode.hasError, false, 'Tree should not have parsing errors');
        assert.strictEqual(tree.rootNode.type, 'module', 'Root node should be a module');
    });

    test('Should parse services/item_service.py without errors', () => {
        const filePath = path.join(pythonFixturesPath, 'services', 'item_service.py');
        const sourceCode = fs.readFileSync(filePath, 'utf8');

        const tree = parser.parse(sourceCode);

        assert.ok(tree, 'Tree should be created');
        assert.ok(tree.rootNode, 'Tree should have a root node');
        assert.strictEqual(tree.rootNode.hasError, false, 'Tree should not have parsing errors');
        assert.strictEqual(tree.rootNode.type, 'module', 'Root node should be a module');
    });

    test('Should parse api/routes.py without errors', () => {
        const filePath = path.join(pythonFixturesPath, 'api', 'routes.py');
        const sourceCode = fs.readFileSync(filePath, 'utf8');

        const tree = parser.parse(sourceCode);

        assert.ok(tree, 'Tree should be created');
        assert.ok(tree.rootNode, 'Tree should have a root node');
        assert.strictEqual(tree.rootNode.hasError, false, 'Tree should not have parsing errors');
        assert.strictEqual(tree.rootNode.type, 'module', 'Root node should be a module');
    });

    test('Should parse main.py without errors', () => {
        const filePath = path.join(pythonFixturesPath, 'main.py');
        const sourceCode = fs.readFileSync(filePath, 'utf8');

        const tree = parser.parse(sourceCode);

        assert.ok(tree, 'Tree should be created');
        assert.ok(tree.rootNode, 'Tree should have a root node');
        assert.strictEqual(tree.rootNode.hasError, false, 'Tree should not have parsing errors');
        assert.strictEqual(tree.rootNode.type, 'module', 'Root node should be a module');
    });

    test('Should extract class definitions from db.py', () => {
        const filePath = path.join(pythonFixturesPath, 'database', 'db.py');
        const sourceCode = fs.readFileSync(filePath, 'utf8');

        const tree = parser.parse(sourceCode);
        const query = new Parser.Query(Python, '(class_definition name: (identifier) @class.name)');
        const captures = query.captures(tree.rootNode);

        const classNames = captures.map(c => sourceCode.slice(c.node.startIndex, c.node.endIndex));

        assert.ok(classNames.includes('Database'), 'Should find Database class');
        assert.ok(classNames.length > 0, 'Should find at least one class');
    });

    test('Should extract function definitions from db.py', () => {
        const filePath = path.join(pythonFixturesPath, 'database', 'db.py');
        const sourceCode = fs.readFileSync(filePath, 'utf8');

        const tree = parser.parse(sourceCode);
        const query = new Parser.Query(Python, '(function_definition name: (identifier) @function.name)');
        const captures = query.captures(tree.rootNode);

        const functionNames = captures.map(c => sourceCode.slice(c.node.startIndex, c.node.endIndex));

        assert.ok(functionNames.includes('connect'), 'Should find connect method');
        assert.ok(functionNames.includes('disconnect'), 'Should find disconnect method');
        assert.ok(functionNames.includes('initialize_schema'), 'Should find initialize_schema method');
        assert.ok(functionNames.includes('insert_item'), 'Should find insert_item method');
        assert.ok(functionNames.includes('get_item'), 'Should find get_item method');
        assert.ok(functionNames.includes('delete_item'), 'Should find delete_item method');
        assert.ok(functionNames.length > 0, 'Should find multiple functions');
    });

    test('Should extract import statements from main.py', () => {
        const filePath = path.join(pythonFixturesPath, 'main.py');
        const sourceCode = fs.readFileSync(filePath, 'utf8');

        const tree = parser.parse(sourceCode);
        const query = new Parser.Query(Python, '(import_from_statement module_name: (dotted_name) @import.module)');
        const captures = query.captures(tree.rootNode);

        const imports = captures.map(c => sourceCode.slice(c.node.startIndex, c.node.endIndex));

        assert.ok(imports.includes('database.db'), 'Should find database.db import');
        assert.ok(imports.includes('services.item_service'), 'Should find services.item_service import');
        assert.ok(imports.includes('api.routes'), 'Should find api.routes import');
    });

    test('Should verify all fixture files exist', () => {
        const files = [
            path.join(pythonFixturesPath, 'database', 'db.py'),
            path.join(pythonFixturesPath, 'services', 'item_service.py'),
            path.join(pythonFixturesPath, 'api', 'routes.py'),
            path.join(pythonFixturesPath, 'main.py')
        ];

        files.forEach(file => {
            assert.ok(fs.existsSync(file), `File should exist: ${file}`);
        });
    });

    test('Should parse all fixture files and build UAST', () => {
        const files = [
            'database/db.py',
            'services/item_service.py',
            'api/routes.py',
            'main.py'
        ];

        const trees: { file: string; tree: Parser.Tree; nodeCount: number }[] = [];

        files.forEach(file => {
            const filePath = path.join(pythonFixturesPath, file);
            const sourceCode = fs.readFileSync(filePath, 'utf8');
            const tree = parser.parse(sourceCode);

            assert.strictEqual(tree.rootNode.hasError, false,
                `File ${file} should parse without errors`);

            // Count nodes in the tree
            let nodeCount = 0;
            const countNodes = (node: Parser.SyntaxNode) => {
                nodeCount++;
                for (let i = 0; i < node.childCount; i++) {
                    countNodes(node.child(i)!);
                }
            };
            countNodes(tree.rootNode);

            trees.push({ file, tree, nodeCount });
        });

        // Verify we have meaningful trees
        assert.ok(trees.length === 4, 'Should have parsed 4 files');
        trees.forEach(({ file, nodeCount }) => {
            assert.ok(nodeCount > 10,
                `File ${file} should have a substantial syntax tree (nodes: ${nodeCount})`);
        });
    });
});
