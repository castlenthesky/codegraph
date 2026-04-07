import type Parser from 'tree-sitter';
import type { CpgNode, CpgEdge, CpgNodeType, UastBuildResult } from '../../../types/cpg';
import type { ParseResult } from '../../../types/parsing';
import { LANGUAGE_CONFIGS } from './LanguageConfig';
import { extractNodeProps as tsExtractNodeProps } from './adapters/TypeScriptAdapter';
import { extractNodeProps as pyExtractNodeProps } from './adapters/PythonAdapter';

type ExtractFn = (tsNode: Parameters<typeof tsExtractNodeProps>[0], source: string, filePath: string) => Record<string, unknown>;

export interface UastAdapter {
	nodeMap: Record<string, CpgNodeType>;
	extractProps: ExtractFn;
}

const EXTRACT_PROPS_MAP: Record<string, ExtractFn> = {
	'typescript': tsExtractNodeProps,
	'javascript': tsExtractNodeProps,
	'python': pyExtractNodeProps,
};

function getAdapter(language: string, customAdapters?: Map<string, UastAdapter>): UastAdapter {
	if (customAdapters?.has(language)) {
		return customAdapters.get(language)!;
	}
	const config = LANGUAGE_CONFIGS[language];
	if (!config) {
		throw new Error(`No adapter for language: ${language}`);
	}
	const extractProps = EXTRACT_PROPS_MAP[language];
	if (!extractProps) {
		throw new Error(`No extractNodeProps for language: ${language}`);
	}
	return { nodeMap: config.nodeMap, extractProps };
}

export class UastBuilder {
	private customAdapters?: Map<string, UastAdapter>;

	constructor(adapters?: Map<string, UastAdapter>) {
		this.customAdapters = adapters;
	}

	build(parseResult: ParseResult, filePath: string, fileNodeId: string): UastBuildResult {
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

		let cpgFileNodeId: string | null = null;

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

				if (cpgType === 'FILE') {
					// Use the filesystem FILE node — skip creating a duplicate CPG FILE node
					cpgFileNodeId = fileNodeId;
					// Still walk children; use null parent since we're skipping this node
					let childOrder = 0;
					for (let i = 0; i < tsNode.childCount; i++) {
						const child = tsNode.child(i);
						if (!child) { continue; }
						walk(child, null, childOrder++);
					}
					return;
				}

				const props = extractProps(tsNode, source, filePath);
				nodes.push({ id, label: cpgType, order, ...props } as CpgNode);

				if (cpgFileNodeId) {
					edges.push({ source: id, target: cpgFileNodeId, type: 'SOURCE_FILE' });
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
