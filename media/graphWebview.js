(function () {
    const vscodeApi = acquireVsCodeApi();
    const container = document.getElementById('graph-container');
    const errorEl = document.getElementById('error-message');

    const NODE_COLORS = {
        METHOD: '#4FC1FF',
        TYPE_DECL: '#4EC9B0',
        CALL: '#CE9178',
        CONTROL_STRUCTURE: '#C586C0',
        IDENTIFIER: '#DCDCAA',
        LITERAL: '#B5CEA8',
        BLOCK: '#555555',
        RETURN: '#C586C0',
        LOCAL: '#9CDCFE',
        DIRECTORY: '#808080',
        FILE: '#FFFFFF',
    };

    const LINK_COLORS = {
        AST: '#444444',
        CFG: '#4FC1FF',
        REACHING_DEF: '#F44747',
        CDG: '#C586C0',
        CALL: '#CE9178',
        SOURCE_FILE: '#333333',
        IMPORT: '#569CD6',
        IMPORTS: '#569CD6',
        CONTAINS: '#444444',
    };

    const LINK_WIDTHS = {
        CFG: 2,
        REACHING_DEF: 2,
        CDG: 1.5,
        CALL: 2,
        IMPORT: 2,
        IMPORTS: 1.5,
    };

    const defaultLinkColor = getComputedStyle(document.body).getPropertyValue('--vscode-editorLineNumber-foreground') || '#858585';

    const Graph = ForceGraph()(container)
        .width(window.innerWidth)
        .height(window.innerHeight)
        .nodeLabel(node => `${node.type}: ${node.name || (node.code ? node.code.substring(0, 40) : node.id)}`)
        .nodeColor(node => NODE_COLORS[node.type] || '#858585')
        .linkColor(link => LINK_COLORS[link.type] || defaultLinkColor)
        .linkWidth(link => LINK_WIDTHS[link.type] || 1)
        .nodeRelSize(4)
        .d3VelocityDecay(0.3)
        .d3AlphaDecay(0.03)
        .cooldownTicks(200)
        .onNodeClick(node => {
            vscodeApi.postMessage({ command: 'nodeClick', node: { id: node.id, name: node.name, type: node.type, code: node.code } });
        });

    // Tune force strengths for better layout stability
    Graph.d3Force('charge').strength(-80);
    Graph.d3Force('link').strength(0.6).distance(40);

    window.addEventListener('resize', () => {
        Graph.width(window.innerWidth).height(window.innerHeight);
    });

    function showError(message) {
        if (errorEl) {
            errorEl.textContent = message;
            errorEl.style.display = 'block';
        }
    }

    function hideError() {
        if (errorEl) { errorEl.style.display = 'none'; }
    }

    vscodeApi.postMessage({ command: 'ready' });

    window.addEventListener('message', event => {
        const message = event.data;

        if (message.command === 'error') {
            showError(message.text);
            return;
        }

        hideError();

        if (message.command === 'updateGraph') {
            const { nodes, links } = message.data;
            console.log('[CodeGraph Webview] Full graph load:', JSON.stringify({
                nodeCount: nodes.length,
                linkCount: links.length,
                nodeTypes: nodes.reduce((acc, n) => { acc[n.type] = (acc[n.type] || 0) + 1; return acc; }, {}),
                sampleNodes: nodes.slice(0, 3).map(n => ({ id: n.id, type: n.type, name: n.name }))
            }, null, 2));
            Graph.graphData(message.data);
        } else if (message.command === 'incrementalUpdate') {
            const patch = message.patch;
            const { nodes, links } = Graph.graphData();
            let newNodes = [...nodes];
            let newLinks = [...links];

            if (patch.removeNodes && patch.removeNodes.length > 0) {
                const nodeIdsToRemove = new Set(patch.removeNodes);
                newNodes = newNodes.filter(n => !nodeIdsToRemove.has(n.id));
            }

            if (patch.removeLinks && patch.removeLinks.length > 0) {
                // After force-graph renders, it replaces source/target string IDs with node objects.
                // Normalize both sides of the comparison to handle both pre- and post-render states.
                // Include edge type in the key to avoid removing edges of a different type between the same pair of nodes.
                const linksToRemove = new Set(
                    patch.removeLinks.map(l => `${l.source.id ?? l.source}|${l.target.id ?? l.target}|${l.type ?? ''}`)
                );
                newLinks = newLinks.filter(l => {
                    const key = `${l.source.id ?? l.source}|${l.target.id ?? l.target}|${l.type ?? ''}`;
                    return !linksToRemove.has(key);
                });
            }

            if (patch.addNodes && patch.addNodes.length > 0) {
                newNodes = [...newNodes, ...patch.addNodes];
            }

            if (patch.addLinks && patch.addLinks.length > 0) {
                newLinks = [...newLinks, ...patch.addLinks];
            }

            if (patch.updateLinks && patch.updateLinks.length > 0) {
                const updateMap = new Map(patch.updateLinks.map(l => [`${l.source}|${l.target}|${l.type ?? ''}`, l]));
                newLinks = newLinks.map(link => {
                    const key = `${link.source.id ?? link.source}|${link.target.id ?? link.target}|${link.type ?? ''}`;
                    const update = updateMap.get(key);
                    return update ? { ...link, ...update } : link;
                });
            }

            if (patch.updateNodes && patch.updateNodes.length > 0) {
                const updateMap = new Map(patch.updateNodes.map(n => [n.id, n]));
                newNodes = newNodes.map(node => {
                    const update = updateMap.get(node.id);
                    return update ? { ...node, ...update } : node;
                });
            }

            console.log('[CodeGraph Webview] Incremental update:', JSON.stringify({
                before: { nodeCount: nodes.length, linkCount: links.length },
                patch: {
                    addNodes: patch.addNodes?.length || 0,
                    removeNodes: patch.removeNodes?.length || 0,
                    addLinks: patch.addLinks?.length || 0,
                    removeLinks: patch.removeLinks?.length || 0,
                },
                after: { nodeCount: newNodes.length, linkCount: newLinks.length },
                removedNodeIds: patch.removeNodes?.slice(0, 5) || []
            }, null, 2));

            Graph.graphData({ nodes: newNodes, links: newLinks });

            // For small changes, cool down quickly to avoid excessive reheat
            const totalChange = (patch.addNodes?.length || 0) + (patch.removeNodes?.length || 0) +
                (patch.addLinks?.length || 0) + (patch.removeLinks?.length || 0);
            if (totalChange < 10) {
                Graph.d3AlphaTarget(0.01);
                setTimeout(() => { Graph.d3AlphaTarget(0); }, 1500);
            }
        }
    });
})();
