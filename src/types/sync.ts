/**
 * Interfaces for graph synchronization and reconciliation.
 */

export interface IReconciler {
	loadGraphFromDatabase(): Promise<void>;
	reconcileInBackground(): Promise<void>;
	startPeriodicReconciliation(): void;
	dispose(): void;
}
