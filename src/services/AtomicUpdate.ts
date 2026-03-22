import { FalkorDBService } from './FalkorDBService';
import { GraphViewProvider } from '../providers/GraphViewProvider';

/**
 * Service orchestrating "Atomic Commits" across the underlying FalkorDB layer and
 * the active webview presentation. 
 * 
 * Ensures that if a database modification succeeds but the graphical UI fails to
 * represent that modification, the database immediately rolls back that operation to
 * retain architectural integrity.
 * 
 * Interactions:
 * - `FalkorDBService`: Provides the backend transaction capability or rollbacks.
 * - `GraphViewProvider`: Attempted output endpoint; failure here triggers a revert.
 */
export class AtomicUpdate {
    private dbService: FalkorDBService;
    private graphView?: GraphViewProvider;

    /**
     * @param graphView The UI Provider to bind against this update context.
     */
    constructor(graphView?: GraphViewProvider) {
        this.dbService = FalkorDBService.getInstance();
        this.graphView = graphView;
    }

    /**
     * Executes a given mutating database operation synchronously paired with a subsequent
     * view refresh. Enforces a strict two-phase update strategy.
     * 
     * @param operation The primary business intent to run against FalkorDB.
     * @param rollback The compensatory/rollback action triggered internally if the UI or primary logic faults.
     * @returns The resolved type of the executed operation, or faults via an explicit throw.
     */
    public async execute<T>(
        operation: () => Promise<T>,
        rollback?: () => Promise<void>
    ): Promise<T> {
        let result: T;

        try {
            // Phase 1: Exectue mutating DB operation
            result = await operation();

            // Phase 2: Request UI to ingest modified graph
            if (this.graphView) {
                await this.graphView.refresh();
            }

            return result;
        } catch (error) {
            // Rollback procedure fallback
            if (rollback) {
                try {
                    await rollback();
                } catch (rollbackError) {
                    console.error('CRITICAL: Rollback compensatory action completely failed:', rollbackError);
                }
            }
            throw error;
        }
    }
}
