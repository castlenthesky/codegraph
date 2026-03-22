import * as assert from 'assert';
import * as path from 'path';
import * as fs from 'fs';
import * as vscode from 'vscode';
import { GraphSynchronizer } from '../services/GraphSynchronizer';
import { FalkorDBService } from '../services/FalkorDBService';

suite('GraphSynchronizer Integration Test Suite', () => {
    let synchronizer: GraphSynchronizer;
    let dbService: FalkorDBService;

    setup(async () => {
        dbService = FalkorDBService.getInstance();
        synchronizer = new GraphSynchronizer();
        await dbService.connect();
        await dbService.clearGraph();
    });

    teardown(async () => {
        await dbService.clearGraph();
    });

    test('findOrphanNodes accurately detects missing FILE and DIRECTORY nodes', async () => {
        // Insert nodes directly that do not map to anything structural in the active physical workspace
        await dbService.createNode({
            id: 'mock_fake_file', label: 'FILE', name: 'missing.ts',
            path: '/var/tmp/non_existent.ts', relativePath: 'non_existent.ts', extension: '.ts',
            language: 'typescript', size: 0, createdAt: 0, modifiedAt: 0, isParsed: false
        });

        await dbService.createNode({
            id: 'mock_fake_dir', label: 'DIRECTORY', name: 'ghost_dir',
            path: '/var/tmp/ghost_dir', relativePath: 'ghost_dir', createdAt: 0, modifiedAt: 0
        });

        const syncTools = synchronizer as any;
        const orphans = await syncTools.findOrphanNodes();

        assert.strictEqual(orphans.length, 2, 'Should have flagged exactly 2 nodes as orphaned');
        assert.ok(orphans.includes('mock_fake_file'), 'Orphaned FILE missing');
        assert.ok(orphans.includes('mock_fake_dir'), 'Orphaned DIRECTORY missing');
    });
});
