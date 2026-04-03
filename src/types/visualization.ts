/**
 * Interface for the graph visualization provider.
 * Decouples sync/filesystem layers from the concrete GraphViewProvider.
 */
export interface IGraphViewProvider {
	refresh(): Promise<void>;
}
