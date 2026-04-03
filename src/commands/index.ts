import * as vscode from 'vscode';
import type { Reconciler } from '../services/sync/Reconciler';
import { executeFullRefresh } from './fullRefresh';
import { executeHelloWorld } from './helloWorld';

export interface CommandDeps {
	reconciler: Reconciler;
}

export function registerAllCommands(context: vscode.ExtensionContext, deps: CommandDeps): void {
	context.subscriptions.push(
		vscode.commands.registerCommand('falkordb.helloWorld', executeHelloWorld),
		vscode.commands.registerCommand('codegraph.fullRefresh', () => executeFullRefresh(deps.reconciler))
	);
}
