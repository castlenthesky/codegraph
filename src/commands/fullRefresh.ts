import type { Reconciler } from '../services/sync/Reconciler';

export async function executeFullRefresh(reconciler: Reconciler): Promise<void> {
	await reconciler.ensureWorkspaceRoot();
	await reconciler.reconcileInBackground();
	await reconciler.loadGraphFromDatabase();
}
