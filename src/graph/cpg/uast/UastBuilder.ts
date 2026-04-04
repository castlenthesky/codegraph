import type Parser from 'tree-sitter';
import type { CpgNode, CpgEdge, CpgNodeType, UastBuildResult } from '../../../types/cpg';
import type { ParseResult } from '../../../types/parsing';
import { TS_NODE_MAP, extractNodeProps as tsExtractNodeProps } from './adapters/TypeScriptAdapter';
import { PY_NODE_MAP, extractNodeProps as pyExtractNodeProps } from './adapters/PythonAdapter';

type ExtractFn = (tsNode: Parameters<typeof tsExtractNodeProps>[0], source: string, filePath: string) => Record<string, unknown>;

export interface UastAdapter {
	nodeMap: Record<string, CpgNodeType>;
	extractProps: ExtractFn;
}

function getAdapter(language: string, customAdapters?: Map<string, UastAdapter>): UastAdapter {
	if (customAdapters?.has(language)) {
		return customAdapters.get(language)!;
	}
	switch (language) {
		case 'typescript':
		case 'javascript':
			return { nodeMap: TS_NODE_MAP, extractProps: tsExtractNodeProps };
		case 'python':
			return { nodeMap: PY_NODE_MAP, extractProps: pyExtractNodeProps };
		default:
			throw new Error(`No adapter for language: ${language}`);
	}
}

export class UastBuilder {
	private customAdapters?: Map<string, UastAdapter>;

	constructor(adapters?: Map<string, UastAdapter>) {
		this.customAdapters = adapters;
	}

	build(parseResult: ParseResult, filePath: string): UastBuildResult {
		const { tree } = parseResult;
		const source = tree.rootNode.text;
		const nodes: CpgNode[] = [];
		const edges: CpgEdge[] = [];
		const seenIds = new Set<string>();

		let adapter: UastAdapter;
		try {
			adapter = getAdapter(parseResult.language, this.customAdapters);
		} catch (err) {
			console.error(`UastBuilder: ${err instanceof Error ? err.message : String(err)}`);
			return { nodes: [], edges: [], removedNodeIds: [] };
		}

		const { nodeMap, extractProps } = adapter;

		const makeId = (tsNode: Parser.SyntaxNode, cpgType: string): string =>
			`${filePath}:${cpgType}:${tsNode.startPosition.row}:${tsNode.startPosition.column}`;

		let fileNodeId: string | null = null;

		const walk = (tsNode: Parser.SyntaxNode, parentCpgId: string | null, order: number): void => {
			const cpgType = nodeMap[tsNode.type];
			if (!cpgType) {
				let childOrder = 0;
				for (let i = 0; i < tsNode.childCount; i++) {
					const child = tsNode.child(i);
					if (!child) { continue; }
					walk(child, parentCpgId, childOrder++);
				}
				return;
			}

			const id = makeId(tsNode, cpgType);
			if (!seenIds.has(id)) {
				seenIds.add(id);
				const props = extractProps(tsNode, source, filePath);
				nodes.push({ id, label: cpgType, order, ...props } as CpgNode);

				if (cpgType === 'FILE') {
					fileNodeId = id;
				} else if (fileNodeId) {
					edges.push({ source: id, target: fileNodeId, type: 'SOURCE_FILE' });
				}

				if (parentCpgId && parentCpgId !== id) {
					edges.push({ source: parentCpgId, target: id, type: 'AST' });
				}
			}

			let childOrder = 0;
			for (let i = 0; i < tsNode.childCount; i++) {
				const child = tsNode.child(i);
				if (!child) { continue; }
				walk(child, id, childOrder++);
			}
		};

		walk(tree.rootNode, null, 0);
		return { nodes, edges, removedNodeIds: [] };
	}
}
