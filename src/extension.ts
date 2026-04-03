import * as vscode from 'vscode';
import { bootstrap } from './bootstrap';

export function activate(context: vscode.ExtensionContext): void {
	console.log('Congratulations, your extension "codegraph" is now active!');
	bootstrap(context);
}

export function deactivate(): void {}
