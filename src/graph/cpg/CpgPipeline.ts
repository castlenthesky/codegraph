import * as path from 'path';
import type { IParserService } from '../../types/parsing';
import type { IGraphStore } from '../../types/storage';
import type { IGraphViewProvider } from '../../types/visualization';
import { UastBuilder } from './uast/UastBuilder';
import { CfgBuilder } from './cfg/CfgBuilder';
import { PdgBuilder } from './pdg/PdgBuilder';
import { detectLanguage } from '../nodes/nodeFactory';

// Languages we can currently parse
const SUPPORTED_LANGUAGES = new Set(['typescript', 'javascript', 'python']);

export class CpgPipeline {
	private readonly cfgBuilder = new CfgBuilder();
	private readonly pdgBuilder = new PdgBuilder();

	constructor(
		private readonly parserService: IParserService,
		private readonly uastBuilder: UastBuilder,
		private readonly store: IGraphStore,
		private readonly graphView: IGraphViewProvider
	) {}

	/**
	 * Process a file: parse → build UAST → surgical DB update → refresh view.
	 * Called by FileWatcher on create/change events for supported file types.
	 */
	async processFile(filePath: string, source: string): Promise<void> {
		const ext = path.extname(filePath);
		const language = detectLanguage(ext);
		if (!SUPPORTED_LANGUAGES.has(language)) {
			return;
		}

		try {
			const parseResult = await this.parserService.parse(filePath, source);
			const uastResult = this.uastBuilder.build(parseResult, filePath);
			const cfgEdges = this.cfgBuilder.build(uastResult);
			const allEdges = [...uastResult.edges, ...cfgEdges];
			const pdgEdges = this.pdgBuilder.build(uastResult.nodes, allEdges);
			const finalEdges = [...allEdges, ...pdgEdges];
			await this.store.replaceFileSubgraph(filePath, uastResult.nodes, finalEdges);
			await this.graphView.refresh();
		} catch (error: any) {
			console.error(`CpgPipeline: error processing ${filePath}:`, error);
		}
	}

	/**
	 * Invalidate the parser cache for a deleted file.
	 */
	invalidate(filePath: string): void {
		this.parserService.invalidate(filePath);
	}

	dispose(): void {
		this.parserService.dispose();
	}
}
