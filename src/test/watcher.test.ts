import * as assert from 'assert';
import * as path from 'path';
import * as vscode from 'vscode';
import { FileSystemWatcher } from '../services/FileSystemWatcher';

suite('FileSystemWatcher Logic Test Suite', () => {
    test('generateId correctly normalizes paths cross-platform', () => {
        // Exploit typing to test private methods simply
        const watcher = new FileSystemWatcher() as any;
        const winPath = 'src\\\\controllers\\\\App.ts';
        const id = watcher.generateId(winPath);
        assert.strictEqual(id, 'src/controllers/App.ts', 'Should convert backslashes to forward slashes');
    });

    test('detectLanguage maps extensions properly', () => {
        const watcher = new FileSystemWatcher() as any;
        assert.strictEqual(watcher.detectLanguage('.ts'), 'typescript');
        assert.strictEqual(watcher.detectLanguage('.py'), 'python');
        assert.strictEqual(watcher.detectLanguage('.unknown'), 'unknown');
    });
});
