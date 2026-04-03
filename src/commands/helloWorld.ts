import * as vscode from 'vscode';

export function executeHelloWorld(): void {
	vscode.window.showInformationMessage('Hello World from codegraph!');
}
