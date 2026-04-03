import type * as vscode from 'vscode';

/**
 * Interfaces for file system observation and scanning.
 */

export interface IFileWatcher {
	startWatching(): vscode.Disposable[];
	dispose(): void;
}

export interface IFileScanner {
	indexWorkspace(): Promise<void>;
}
