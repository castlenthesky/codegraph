import * as fs from 'fs';
import * as path from 'path';
import type { DirectoryNode, FileNode } from '../../types/nodes';

const LANG_MAP: Record<string, string> = {
	'.ts': 'typescript',
	'.tsx': 'typescript',
	'.js': 'javascript',
	'.jsx': 'javascript',
	'.py': 'python',
	'.go': 'go',
	'.rs': 'rust',
	'.java': 'java',
	'.c': 'c',
	'.cpp': 'cpp',
	'.h': 'c',
	'.hpp': 'cpp',
	'.cs': 'csharp',
	'.rb': 'ruby',
	'.php': 'php',
	'.swift': 'swift',
	'.kt': 'kotlin',
	'.scala': 'scala'
};

export function detectLanguage(extension: string): string {
	return LANG_MAP[extension.toLowerCase()] || 'unknown';
}

export function generateId(relativePath: string): string {
	return relativePath.replace(/\\/g, '/');
}

export function shouldIgnorePath(absolutePath: string): boolean {
	const basename = path.basename(absolutePath);
	return basename.startsWith('.') || absolutePath.includes('node_modules');
}

export async function createDirectoryNode(absolutePath: string, relativePath: string): Promise<DirectoryNode> {
	const stats = await fs.promises.stat(absolutePath);

	return {
		id: generateId(relativePath),
		label: 'DIRECTORY',
		name: path.basename(absolutePath),
		path: absolutePath,
		relativePath,
		createdAt: stats.birthtimeMs,
		modifiedAt: stats.mtimeMs
	};
}

export async function createFileNode(absolutePath: string, relativePath: string): Promise<FileNode> {
	const stats = await fs.promises.stat(absolutePath);
	const ext = path.extname(absolutePath);

	return {
		id: generateId(relativePath),
		label: 'FILE',
		name: path.basename(absolutePath),
		path: absolutePath,
		relativePath,
		extension: ext,
		language: detectLanguage(ext),
		size: stats.size,
		createdAt: stats.birthtimeMs,
		modifiedAt: stats.mtimeMs,
		isParsed: false
	};
}
