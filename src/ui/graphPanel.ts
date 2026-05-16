import * as vscode from 'vscode';
import { RepoIntelligenceRuntime } from '../index';
import { SummaryExporter } from '../core/summaryExporter';
import { Summarizer } from '../core/summarizer';
import { FileSummary } from '../types';

export class GraphPanel {
    public static currentPanel: GraphPanel | undefined;
    private readonly _panel: vscode.WebviewPanel;
    private readonly runtime: RepoIntelligenceRuntime;
    private readonly summarizer: Summarizer;
    private latestSummaryFiles: string[] = [];
    private latestSummaries: FileSummary[] | null = null;
    private _disposables: vscode.Disposable[] = [];

    private constructor(panel: vscode.WebviewPanel, runtime: RepoIntelligenceRuntime) {
        this._panel = panel;
        this.runtime = runtime;
        this.summarizer = new Summarizer(runtime.structRepo);

        this._update();
        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
        this._panel.webview.onDidReceiveMessage((message) => this.handleMessage(message), null, this._disposables);
    }

    public static async createOrShow(extensionUri: vscode.Uri, runtime: RepoIntelligenceRuntime) {
        const column = vscode.window.activeTextEditor ? vscode.window.activeTextEditor.viewColumn : undefined;

        if (GraphPanel.currentPanel) {
            GraphPanel.currentPanel._panel.reveal(column);
            GraphPanel.currentPanel._update();
            return;
        }

        const panel = vscode.window.createWebviewPanel('repoGraph', 'Repository Graph', column || vscode.ViewColumn.One, {
            enableScripts: true,
            retainContextWhenHidden: true,
            localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'media')]
        });

        GraphPanel.currentPanel = new GraphPanel(panel, runtime);
    }

    public dispose() {
        GraphPanel.currentPanel = undefined;
        this._panel.dispose();
        while (this._disposables.length) {
            const disposable = this._disposables.pop();
            if (disposable) {
                disposable.dispose();
            }
        }
    }

    private async handleMessage(message: { command: string; file?: string; files?: string[] }) {
        try {
            switch (message.command) {
                case 'analyzeFiles':
                    await this.postCombinedSummary(message.files ?? []);
                    return;
                case 'generateMarkdown':
                    await this.exportSelected(message.files ?? [], 'markdown');
                    return;
                case 'generatePdf':
                    await this.exportSelected(message.files ?? [], 'pdf');
                    return;
            }
        } catch (error) {
            const text = error instanceof Error ? error.message : String(error);
            vscode.window.showErrorMessage(`Error: ${text}`);
            this._panel.webview.postMessage({ command: 'error', message: text });
        }
    }

    private async _update() {
        this._panel.webview.html = this._getHtmlForWebview();

        try {
            await this.runtime.topologyBuilder.waitUntilReady();
            const graphData = await this.runtime.graphEngine.visualize();
            this._panel.webview.postMessage({ command: 'updateGraph', data: graphData });
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            vscode.window.showErrorMessage(`Failed to load graph: ${message}`);
        }
    }

    private async summarizeFiles(files: string[]): Promise<FileSummary[]> {
        const selectedFiles = [...new Set(files)].filter((file) => this.runtime.structRepo.hasFile(file));
        if (selectedFiles.length === 0) {
            throw new Error('Select at least one file or folder node first.');
        }

        return Promise.all(
            selectedFiles.map(async (file) => {
                const response = await this.runtime.lazyWorker.requestWithStatus('summarize', [file], () =>
                    this.summarizer.summarizeFile(file)
                );
                return response.result;
            })
        );
    }

    private async postCombinedSummary(files: string[]): Promise<void> {
        this._panel.webview.postMessage({ command: 'summaryLoading', fileCount: files.length });
        const summaries = await this.summarizeFiles(files);
        this.latestSummaryFiles = this.normalizeFiles(files);
        this.latestSummaries = summaries;
        const summary = this.buildCombinedSummary(summaries);

        this._panel.webview.postMessage({
            command: 'combinedSummary',
            title: summaries.length === 1 ? summaries[0].file : `${summaries.length} selected files`,
            provider: [...new Set(summaries.map((item) => item.provider))].join(', '),
            summary
        });
    }

    private async exportSelected(files: string[], type: 'markdown' | 'pdf'): Promise<void> {
        this._panel.webview.postMessage({ command: 'exportLoading', exportType: type });
        const normalizedFiles = this.normalizeFiles(files);
        const summaries =
            this.latestSummaries && this.sameFiles(normalizedFiles, this.latestSummaryFiles)
                ? this.latestSummaries
                : await this.summarizeFiles(files);
        const exporter = new SummaryExporter(this.runtime.structRepo.getRepoState());
        const result = type === 'markdown' ? await exporter.exportMarkdown(summaries) : await exporter.exportPdf(summaries);

        vscode.window.showInformationMessage(
            `Success: ${type === 'markdown' ? 'markdown file' : 'summary PDF'} generated for ${result.fileCount} file(s).`
        );

        this._panel.webview.postMessage({
            command: 'exportReady',
            exportType: type,
            path: result.path,
            fileCount: result.fileCount,
            summary: this.buildCombinedSummary(summaries)
        });
    }

    private buildCombinedSummary(summaries: FileSummary[]): string {
        return summaries
            .map((summary) => [`# ${summary.file}`, '', `Branch: ${summary.branch}`, `Provider: ${summary.provider}`, '', summary.summary].join('\n'))
            .join('\n\n---\n\n');
    }

    private normalizeFiles(files: string[]): string[] {
        return [...new Set(files)].filter((file) => this.runtime.structRepo.hasFile(file)).sort();
    }

    private sameFiles(a: string[], b: string[]): boolean {
        return a.length === b.length && a.every((file, index) => file === b[index]);
    }

    private _getHtmlForWebview() {
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Repository Graph</title>
    <script src="https://d3js.org/d3.v7.min.js"></script>
    <style>
        :root {
            --bg: #050606;
            --panel: #0c0c09;
            --panel-border: rgba(235, 178, 18, 0.42);
            --text: #f1eee5;
            --muted: #8d897f;
            --folder: #777b82;
            --folder-stroke: #d0ad37;
            --file: #f5b817;
            --cluster: #3b82f6;
            --modified: #ffd456;
            --conflict: #e74c3c;
            --ignored: #6f6752;
            --selected: #2d7ff9;
            
            --edge-hierarchy: #3a3a3a;
            --edge-dep-clean: #4a9eff;
            --edge-dep-modified: #f5a623;
            --edge-dep-conflict: #e74c3c;
        }

        * { box-sizing: border-box; }
        body {
            margin: 0;
            min-height: 100vh;
            overflow-x: hidden;
            overflow-y: auto;
            color: var(--text);
            background: var(--bg);
            font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace;
            scroll-behavior: smooth;
        }

        .app {
            display: block;
            width: 100%;
        }

        .graph-shell {
            position: relative;
            width: 100%;
            min-height: 90vh;
            background: radial-gradient(circle at 50% 46%, rgba(38, 33, 20, 0.26), transparent 42%), #070808;
            border-bottom: 1px solid rgba(255, 255, 255, 0.05);
        }

        header {
            position: sticky;
            top: 0;
            background: linear-gradient(to bottom, var(--bg-app) 70%, transparent);
            padding: 24px 28px;
            z-index: 100;
            pointer-events: none; /* Pass through to graph */
        }

        header h1, header .meta {
            pointer-events: auto; /* Enable for text/breadcrumbs */
        }

        h1 {
            margin: 0;
            font-size: 24px;
            line-height: 1.15;
            letter-spacing: 0;
            pointer-events: auto;
        }
        
        .breadcrumb {
            cursor: pointer;
            color: var(--muted);
        }
        .breadcrumb:hover {
            color: var(--text);
            text-decoration: underline;
        }

        .meta {
            margin-top: 8px;
            color: var(--muted);
            font-size: 13px;
        }

        #graph {
            display: block;
            width: 100%;
            pointer-events: auto; /* Required for D3 zoom/pan events */
        }

        #viewport {
            pointer-events: none; /* Let clicks pass to nodes below */
        }

        .node-hit { 
            cursor: pointer; 
            pointer-events: auto; 
        }

        .hierarchy-edge {
            fill: none;
            stroke: var(--edge-hierarchy);
            stroke-width: 1px;
            opacity: 0.4;
        }

        .dependency-edge {
            fill: none;
            stroke-width: 1.5px;
        }
        .dependency-edge.clean { stroke: var(--edge-dep-clean); }
        .dependency-edge.modified { stroke: var(--edge-dep-modified); }
        .dependency-edge.conflict { stroke: var(--edge-dep-conflict); }
        .dependency-edge.error { stroke: var(--edge-dep-conflict); }
        .dependency-edge.ignored { stroke: var(--muted); }

        .node-hit { cursor: pointer; }
        .node-halo { opacity: 0.2; filter: blur(5px); }
        .node-circle { stroke-width: 2; cursor: pointer; }

        .node-circle.folder { fill: var(--folder); stroke: var(--folder-stroke); }
        .node-circle.cluster { fill: var(--cluster); stroke: #2563eb; }
        .node-circle.file { fill: var(--file); stroke: rgba(255, 226, 96, 0.8); }
        .node-circle.ignored { fill: var(--ignored); stroke: rgba(146, 128, 86, 0.76); }
        .node-circle.modified { fill: var(--modified); }
        .node-circle.conflict { fill: var(--conflict); }
        .node-circle.error { fill: var(--conflict); }

        .node-circle.selected { stroke: var(--selected); stroke-width: 4; }

        .node-label { fill: #dcd7ca; font-size: 11px; text-anchor: middle; pointer-events: none; }
        .node-label.folder, .node-label.cluster { fill: #f1eee5; font-size: 12px; font-weight: 700; }

        .badge { fill: var(--selected); stroke: rgba(255,255,255,0.42); stroke-width: 1; pointer-events: none; }

        .toolbar {
            position: sticky;
            left: 0;
            right: 0;
            bottom: 0;
            z-index: 100;
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 14px;
            padding: 12px 28px 18px;
            background: linear-gradient(transparent, rgba(7, 8, 8, 0.95) 30%, #070808 100%);
            pointer-events: none;
        }

        .toolbar-group { display: flex; align-items: center; gap: 10px; pointer-events: auto; }

        button {
            min-height: 40px;
            border: 1px solid rgba(255,255,255,0.18);
            border-radius: 7px;
            background: rgba(12, 12, 10, 0.9);
            color: var(--text);
            padding: 8px 16px;
            font: inherit;
            cursor: pointer;
        }

        button:hover { border-color: rgba(255,255,255,0.36); }
        button.active { border-color: var(--selected); color: #dceaff; }
        button:disabled { opacity: 0.45; cursor: not-allowed; }

        .selection-count { color: #d8a914; min-width: 96px; font-size: 13px; }

        .summary-panel {
            display: none;
            width: 100%;
            border-top: 1px solid var(--panel-border);
            background: linear-gradient(90deg, rgba(30, 25, 7, 0.86), #080908 38%);
            padding: 40px 20px;
        }

        .summary-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 24px;
            max-width: 1200px;
            margin-left: auto;
            margin-right: auto;
        }

        .summary-card {
            max-width: 1200px;
            margin: 0 auto;
            border: 1px solid var(--panel-border);
            border-radius: 12px;
            padding: 30px;
            background: rgba(9, 10, 9, 0.82);
            box-shadow: 0 10px 30px rgba(0,0,0,0.5);
        }

        .summary-title { margin: 0 0 10px; color: #fff8e7; font-size: 26px; line-height: 1.2; overflow-wrap: anywhere; }
        .summary-provider { color: var(--muted); font-size: 14px; margin-bottom: 30px; border-bottom: 1px solid rgba(255,255,255,0.05); padding-bottom: 15px; }
        .summary-body { color: #c2bdb2; white-space: pre-wrap; line-height: 1.8; font-size: 14px; }

        .close-summary {
            padding: 6px 12px;
            font-size: 12px;
            min-height: 30px;
            background: rgba(231, 76, 60, 0.1);
            border-color: rgba(231, 76, 60, 0.3);
            color: #ff9999;
        }
        .close-summary:hover {
            background: rgba(231, 76, 60, 0.2);
            border-color: rgba(231, 76, 60, 0.5);
        }

        .graph-layer {
            position: absolute;
            inset: 0;
            width: 100%;
            height: 100%;
            z-index: 1;
            pointer-events: none; /* Let background clicks through */
        }

        .zoom-capture {
            position: absolute;
            inset: 0;
            z-index: 2;
            background: transparent;
            pointer-events: all; /* Catches zoom, pan, and manual hit-tests */
        }

        header {
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            background: linear-gradient(to bottom, var(--bg-app) 70%, transparent);
            padding: 24px 28px;
            z-index: 100;
            pointer-events: none; /* Pass through to zoom capture */
        }

        header h1, header .meta {
            pointer-events: auto;
        }

        .toolbar {
            position: absolute;
            left: 0;
            right: 0;
            bottom: 0;
            z-index: 100;
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 14px;
            padding: 12px 28px 18px;
            background: linear-gradient(transparent, rgba(7, 8, 8, 0.95) 30%, #070808 100%);
            pointer-events: none;
        }

        .toolbar-group, .selection-status {
            pointer-events: auto;
        }

        .zoom-controls button {
            width: 36px;
            height: 36px;
            background: rgba(26, 31, 46, 0.9);
            color: #4a90d9;
            border: 1px solid #2a3550;
            border-radius: 6px;
            font-size: 20px;
            font-weight: bold;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: background 0.2s;
        }

        .zoom-controls button:hover {
            background: #2a3550;
            color: #fff;
        }

        .empty-state {
            position: absolute;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            text-align: center;
            pointer-events: none;
        }

        .empty-title {
            font-size: 18px;
            color: #4a90d9;
            margin-bottom: 8px;
            font-weight: bold;
        }

        .empty-msg {
            font-size: 14px;
            color: var(--muted);
        }
    </style>
</head>
<body>
    <div class="app">
        <main class="graph-shell" id="graphShell">
            <header>
                <h1 id="breadcrumbs"></h1>
                <div class="meta"><span id="repoMeta">Loading graph</span></div>
            </header>

            <!-- Layer 1: Graph SVG -->
            <svg id="graph" class="graph-layer" role="img" aria-label="Repository file-system and dependency graph">
                <defs>
                    <marker id="arrow-clean" viewBox="0 -5 10 10" refX="25" refY="0" markerWidth="6" markerHeight="6" orient="auto">
                        <path d="M0,-5L10,0L0,5" fill="var(--edge-dep-clean)" />
                    </marker>
                    <marker id="arrow-modified" viewBox="0 -5 10 10" refX="25" refY="0" markerWidth="6" markerHeight="6" orient="auto">
                        <path d="M0,-5L10,0L0,5" fill="var(--edge-dep-modified)" />
                    </marker>
                    <marker id="arrow-conflict" viewBox="0 -5 10 10" refX="25" refY="0" markerWidth="6" markerHeight="6" orient="auto">
                        <path d="M0,-5L10,0L0,5" fill="var(--edge-dep-conflict)" />
                    </marker>
                    <marker id="arrow-ignored" viewBox="0 -5 10 10" refX="25" refY="0" markerWidth="6" markerHeight="6" orient="auto">
                        <path d="M0,-5L10,0L0,5" fill="var(--muted)" />
                    </marker>
                </defs>
                <g id="viewport">
                    <g id="links"></g>
                    <g id="nodes"></g>
                </g>
            </svg>

            <!-- Layer 2: Zoom Capture -->
            <div id="zoomCapture" class="zoom-capture"></div>

            <!-- Layer 3: UI Overlays -->
            <div id="emptyState" class="empty-state" style="display: none;">
                <p id="emptyTitle" class="empty-title"></p>
                <p id="emptyMsg" class="empty-msg"></p>
            </div>

            <div class="zoom-controls">
                <button id="btnZoomIn" title="Zoom In">+</button>
                <button id="btnZoomReset" title="Reset Zoom">⊙</button>
                <button id="btnZoomOut" title="Zoom Out">−</button>
            </div>

            <div class="toolbar">
                <div class="toolbar-group">
                    <button id="analyzeButton">Analyze Selection</button>
                    <button id="selectingButton">Selection Mode</button>
                    <span id="selectionCount" class="selection-status">0 selected</span>
                </div>
                <div class="toolbar-group">
                    <button id="pdfButton">Summary PDF</button>
                    <button id="markdownButton">Markdown Context</button>
                </div>
            </div>
        </main>
        <section class="summary-panel" id="summaryPanel">
            <div class="summary-header">
                <span style="color: var(--muted); font-size: 12px; letter-spacing: 1px; text-transform: uppercase;">Analysis Report</span>
                <button class="close-summary" id="closeSummary">Close Report</button>
            </div>
            <div class="summary-card">
                <h2 id="summaryTitle" class="summary-title">Analyzing...</h2>
                <div id="summaryProvider" class="summary-provider">Connecting to models...</div>
                <div id="summaryBody" class="summary-body"></div>
            </div>
        </section>
    </div>
    <script>
        const svg = d3.select("#graph");
        const viewport = d3.select("#viewport");
        const capture = d3.select("#zoomCapture");
        const linksGroup = d3.select("#links");
        const nodesGroup = d3.select("#nodes");
        const breadcrumbs = document.getElementById('breadcrumbs');
        const repoMeta = document.getElementById('repoMeta');
        
        let graph = { nodes: {}, edges: [], branch: 'unknown' };
        let currentNodes = [];
        let selectedFiles = new Set();
        let selecting = false;
        let nodeHitAreas = new Map();

        let currentZoomLevel = 'cluster'; // cluster | folder | file
        let expandedCluster = null;
        let focusedFile = null;

        const zoom = d3.zoom()
            .scaleExtent([0.1, 5])
            .filter(event => {
                return !event.button && 
                       !event.target.closest('button') && 
                       !event.target.closest('.toolbar') &&
                       !event.target.closest('.zoom-controls');
            })
            .on('zoom', (event) => {
                viewport.attr('transform', event.transform);
                updateHitAreas(event.transform);
                updateLabelVisibility(event.transform.k);
            });

        capture.call(zoom);
        capture.on('dblclick.zoom', null);

        function updateHitAreas(transform) {
            nodeHitAreas.clear();
            currentNodes.forEach(node => {
                const sx = transform.applyX(node.x);
                const sy = transform.applyY(node.y);
                const sr = node.r * transform.k;
                nodeHitAreas.set(node.id, { x: sx, y: sy, r: sr, data: node });
            });
        }

        function hitTest(mx, my) {
            let hit = null;
            nodeHitAreas.forEach(area => {
                const dist = Math.hypot(mx - area.x, my - area.y);
                if (dist <= area.r + 5) hit = area.data;
            });
            return hit;
        }

        capture.on('click', (event) => {
            const [mx, my] = d3.pointer(event);
            const hit = hitTest(mx, my);
            if (hit) {
                handleNodeClick(hit);
            } else {
                selectedFiles.clear();
                paintSelection();
                updateControls();
            }
        });

        capture.on('dblclick', (event) => {
            const [mx, my] = d3.pointer(event);
            const hit = hitTest(mx, my);
            if (hit) handleNodeDblClick(hit);
        });

        capture.on('mousemove', (event) => {
            const [mx, my] = d3.pointer(event);
            const hit = hitTest(mx, my);
            if (hit) {
                handleNodeMouseOver(hit);
            } else {
                handleNodeMouseOut();
            }
        });

        function handleNodeClick(d) {
            if (!selecting) selectedFiles.clear();
            const shouldSelect = d.files.some(file => !selectedFiles.has(file));
            d.files.forEach(file => shouldSelect ? selectedFiles.add(file) : selectedFiles.delete(file));
            paintSelection();
            updateControls();
        }

        function handleNodeDblClick(d) {
            if (d.kind === 'cluster') {
                currentZoomLevel = 'folder';
                expandedCluster = d.label;
                resetZoom();
                buildAndRender();
            } else if (d.kind === 'file' || d.kind === 'folder') {
                if (d.kind === 'file') {
                    currentZoomLevel = 'file';
                    focusedFile = d.path || d.files[0];
                    resetZoom();
                    buildAndRender();
                }
            }
        }

        function updateLabelVisibility(k) {
            nodesGroup.selectAll('.node-label')
                .attr('opacity', d => {
                    if (k < 0.4) return 0;
                    if (k < 0.8) return (d.kind === 'folder' || d.kind === 'cluster') ? 1 : 0;
                    return 1;
                });
        }

        function initListeners() {
            document.getElementById('btnZoomIn').onclick = () => capture.transition().duration(250).call(zoom.scaleBy, 1.4);
            document.getElementById('btnZoomOut').onclick = () => capture.transition().duration(250).call(zoom.scaleBy, 0.7);
            document.getElementById('btnZoomReset').onclick = () => resetZoom();

            document.getElementById('analyzeButton').onclick = () => {
                const paths = Array.from(selectedFiles);
                vscode.postMessage({ command: 'analyze', files: paths });
                document.getElementById('summaryPanel').classList.add('visible');
                document.getElementById('summaryPanel').scrollIntoView({ behavior: 'smooth' });
                showSummary('Analyzing...', 'DINO System', 'Synthesizing knowledge from selected files...');
            };

            document.getElementById('selectingButton').onclick = () => {
                selecting = !selecting;
                document.getElementById('selectingButton').textContent = selecting ? 'Cancel Selection' : 'Selection Mode';
                if (!selecting) {
                    selectedFiles.clear();
                    paintSelection();
                    updateControls();
                }
            };

            document.getElementById('pdfButton').onclick = () => {
                vscode.postMessage({ command: 'export_pdf', files: Array.from(selectedFiles) });
            };

            document.getElementById('markdownButton').onclick = () => {
                vscode.postMessage({ command: 'export_markdown', files: Array.from(selectedFiles) });
            };

            document.getElementById('closeSummary').onclick = () => {
                document.getElementById('summaryPanel').classList.remove('visible');
            };
        }

        initListeners();

        function resetZoom() {
            capture.transition().duration(400).call(zoom.transform, d3.zoomIdentity.translate(0, 0).scale(1));
        }

        let simulation = d3.forceSimulation()
            .force("link", d3.forceLink().id(d => d.id).distance(80))
            .force("charge", d3.forceManyBody().strength(-200))
            .force("collide", d3.forceCollide().radius(d => d.r + 15).iterations(2));

        window.addEventListener('message', event => {
            const message = event.data;
            if (message.command === 'updateGraph') {
                graph = message.data;
                buildAndRender();
            }
            if (message.command === 'summaryLoading') {
                showSummary('Analyzing selection', 'Working...', '');
                document.getElementById('summaryPanel').style.display = 'block';
                window.scrollTo(0, document.body.scrollHeight);
            }
            if (message.command === 'combinedSummary') {
                showSummary(message.title, message.provider, message.summary);
                window.scrollTo(0, document.body.scrollHeight);
            }
            if (message.command === 'exportLoading') {
                document.getElementById('summaryProvider').textContent = 'Generating...';
                document.getElementById('summaryPanel').style.display = 'block';
                window.scrollTo(0, document.body.scrollHeight);
            }
            if (message.command === 'exportReady') {
                showSummary('Generated ' + message.exportType, message.path, message.summary || '');
            }
            if (message.command === 'error') {
                showSummary('Error', '', message.message);
            }
        });

        document.getElementById('closeSummary').addEventListener('click', () => {
            document.getElementById('summaryPanel').style.display = 'none';
            window.scrollTo(0, 0);
        });

        document.getElementById('selectButton').addEventListener('click', () => {
            selecting = !selecting;
            document.getElementById('selectButton').textContent = selecting ? 'Cancel' : 'Selection Mode';
            document.getElementById('selectButton').classList.toggle('active', selecting);
            if (!selecting) { selectedFiles.clear(); paintSelection(); }
            updateControls();
        });

        document.getElementById('analyzeButton').addEventListener('click', () => {
            vscode.postMessage({ command: 'analyzeFiles', files: Array.from(selectedFiles) });
        });
        document.getElementById('pdfButton').addEventListener('click', () => {
            vscode.postMessage({ command: 'generatePdf', files: Array.from(selectedFiles) });
        });
        document.getElementById('markdownButton').addEventListener('click', () => {
            vscode.postMessage({ command: 'generateMarkdown', files: Array.from(selectedFiles) });
        });

        window.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                if (currentZoomLevel === 'file') {
                    currentZoomLevel = 'folder';
                    focusedFile = null;
                    buildAndRender();
                } else if (currentZoomLevel === 'folder') {
                    currentZoomLevel = 'cluster';
                    expandedCluster = null;
                    buildAndRender();
                }
            }
        });

        function showSummary(title, provider, body) {
            document.getElementById('summaryTitle').textContent = title;
            document.getElementById('summaryProvider').textContent = provider;
            document.getElementById('summaryBody').textContent = body || 'Working...';
        }

        function renderEmptyState(title, message) {
            const el = document.getElementById('emptyState');
            if (title) {
                document.getElementById('emptyTitle').textContent = title;
                document.getElementById('emptyMsg').textContent = message;
                el.style.display = 'block';
                svg.style('opacity', 0.2);
            } else {
                el.style.display = 'none';
                svg.style('opacity', 1);
            }
        }

        function updateControls() {
            document.getElementById('selectionCount').textContent = selectedFiles.size + ' selected';
            const disable = selectedFiles.size === 0;
            document.getElementById('analyzeButton').disabled = disable;
            document.getElementById('pdfButton').disabled = disable;
            document.getElementById('markdownButton').disabled = disable;
        }

        function handleNodeMouseOver(d) {
            const connected = neighbors.get(d.id) || new Set();
            nodesGroup.selectAll('.node-label')
                .attr('opacity', n => (n.id === d.id || connected.has(n.id)) ? 1 : 0.15)
                .text(n => getLabelText(n, n.id === d.id || connected.has(n.id)));
        }

        function handleNodeMouseOut() {
            nodesGroup.selectAll('.node-label')
                .attr('opacity', 1)
                .text(n => getLabelText(n, false));
        }

        function buildAndRender() {
            updateBreadcrumbs();
            
            const fileNodes = Object.values(graph.nodes || {}).filter(n => !n.path.toLowerCase().endsWith('.md'));
            const maxDepth = Math.max(1, ...fileNodes.map(n => n.depth_rank || 0));
            const graphHeight = Math.max(600, (maxDepth + 1) * 120);
            const graphWidth = document.getElementById('graphShell').clientWidth || 1000;
            
            svg.attr('viewBox', \`0 0 \${graphWidth} \${graphHeight}\`)
               .attr('height', graphHeight);
            
            let vNodes = [];
            let vEdges = [];
            let vNodeMap = new Map();

            if (currentZoomLevel === 'cluster') {
                const clusters = new Map();
                fileNodes.forEach(f => {
                    const c = f.cluster || 'app';
                    if (!clusters.has(c)) clusters.set(c, { id: 'cluster:'+c, kind: 'cluster', label: c, files: [], depthSum: 0 });
                    clusters.get(c).files.push(f.path);
                    clusters.get(c).depthSum += (f.depth_rank || 0);
                });
                
                vNodes = Array.from(clusters.values()).map(c => {
                    const depth = c.files.length ? c.depthSum / c.files.length : 0;
                    c.fy = 80 + (depth / maxDepth) * (graphHeight - 160);
                    c.r = 25 + Math.min(20, Math.sqrt(c.files.length) * 3);
                    c.health_state = 'clean';
                    c.displayLabel = c.label + ' (' + c.files.length + ')';
                    return c;
                });

                const edgeSet = new Set();
                (graph.edges || []).forEach(e => {
                    const fNode = graph.nodes[e.from];
                    const tNode = graph.nodes[e.to];
                    if (fNode && tNode) {
                        const c1 = fNode.cluster || 'app';
                        const c2 = tNode.cluster || 'app';
                        if (c1 !== c2) {
                            const key = c1 + '->' + c2;
                            if (!edgeSet.has(key)) {
                                edgeSet.add(key);
                                vEdges.push({ source: 'cluster:'+c1, target: 'cluster:'+c2, kind: 'dependency', state: 'clean', opacity: 0.85 });
                            }
                        }
                    }
                });
            } else if (currentZoomLevel === 'folder') {
                const clusters = new Map();
                const folders = new Map();
                
                fileNodes.forEach(f => {
                    const c = f.cluster || 'app';
                    if (c === expandedCluster) {
                        const dir = f.path.includes('/') ? f.path.slice(0, f.path.lastIndexOf('/')) : '.';
                        const fid = 'folder:' + dir;
                        if (!folders.has(fid)) folders.set(fid, { id: fid, kind: 'folder', label: dir, files: [], depthSum: 0 });
                        folders.get(fid).files.push(f.path);
                        folders.get(fid).depthSum += (f.depth_rank || 0);
                        
                        vNodes.push({
                            id: 'file:'+f.path, kind: 'file', label: f.path.split('/').pop(), files: [f.path], 
                            fy: 80 + ((f.depth_rank || 0) / maxDepth) * (graphHeight - 160), 
                            health_state: f.health_state, r: 16, displayLabel: f.path.split('/').pop()
                        });
                    } else {
                        if (!clusters.has(c)) clusters.set(c, { id: 'cluster:'+c, kind: 'cluster', label: c, files: [], depthSum: 0 });
                        clusters.get(c).files.push(f.path);
                        clusters.get(c).depthSum += (f.depth_rank || 0);
                    }
                });

                Array.from(folders.values()).forEach(fol => {
                    const depth = fol.files.length ? fol.depthSum / fol.files.length : 0;
                    fol.fy = 80 + (depth / maxDepth) * (graphHeight - 160) - 60;
                    fol.r = 20 + Math.min(15, Math.sqrt(fol.files.length) * 2);
                    fol.health_state = 'clean';
                    fol.displayLabel = fol.label;
                    vNodes.push(fol);
                    
                    fol.files.forEach(fp => {
                        vEdges.push({ source: fol.id, target: 'file:'+fp, kind: 'hierarchy', opacity: 0.4 });
                    });
                });

                Array.from(clusters.values()).forEach(c => {
                    const depth = c.files.length ? c.depthSum / c.files.length : 0;
                    c.fy = 80 + (depth / maxDepth) * (graphHeight - 160);
                    c.r = 25 + Math.min(20, Math.sqrt(c.files.length) * 3);
                    c.health_state = 'clean';
                    c.displayLabel = c.label;
                    vNodes.push(c);
                });

                const edgeSet = new Set();
                (graph.edges || []).forEach(e => {
                    const fNode = graph.nodes[e.from];
                    const tNode = graph.nodes[e.to];
                    if (fNode && tNode) {
                        const c1 = fNode.cluster || 'app';
                        const c2 = tNode.cluster || 'app';
                        
                        let sId = c1 === expandedCluster ? 'file:'+fNode.path : 'cluster:'+c1;
                        let tId = c2 === expandedCluster ? 'file:'+tNode.path : 'cluster:'+c2;
                        
                        if (sId !== tId) {
                            const key = sId + '->' + tId;
                            if (!edgeSet.has(key)) {
                                edgeSet.add(key);
                                vEdges.push({ source: sId, target: tId, kind: 'dependency', state: tNode.health_state, opacity: 0.85 });
                            }
                        }
                    }
                });
            } else if (currentZoomLevel === 'file') {
                const visibleNodes = new Set([focusedFile]);
                (graph.edges || []).forEach(e => {
                    if (e.from === focusedFile) visibleNodes.add(e.to);
                    if (e.to === focusedFile) visibleNodes.add(e.from);
                });

                fileNodes.forEach(f => {
                    if (visibleNodes.has(f.path)) {
                        vNodes.push({
                            id: 'file:'+f.path, kind: 'file', label: f.path.split('/').pop(), files: [f.path], 
                            fy: 80 + ((f.depth_rank || 0) / maxDepth) * (graphHeight - 160), 
                            health_state: f.health_state, r: 18, displayLabel: f.path.split('/').pop()
                        });
                    }
                });

                (graph.edges || []).forEach(e => {
                    if (e.from === focusedFile || e.to === focusedFile) {
                        vEdges.push({ 
                            source: 'file:'+e.from, target: 'file:'+e.to, 
                            kind: 'dependency', state: graph.nodes[e.to]?.health_state || 'clean', 
                            opacity: 0.85 
                        });
                    }
                });
            }

            // Grid Positioning with Band-Height and Centering
            const nodesByDepth = d3.group(vNodes, n => n.fy);
            const sortedDepths = Array.from(nodesByDepth.keys()).sort((a,b) => a - b);
            
            const BAND_PADDING = 30;
            const LABEL_HEIGHT = 40;
            const MIN_NODE_GAP = 20;

            let currentY = 100;
            const graphWidthActual = Math.max(1000, graphWidth);

            sortedDepths.forEach(depthY => {
                const nodesAtDepth = nodesByDepth.get(depthY);
                nodesAtDepth.sort((a,b) => a.id.localeCompare(b.id));

                // Calculate max radius in this depth to define band height
                const maxRadius = Math.max(...nodesAtDepth.map(n => n.r));
                const bandH = maxRadius * 2 + LABEL_HEIGHT + BAND_PADDING;
                
                // Wrapping logic
                const SLOT_WIDTH_BASE = 80; // approximate
                const MAX_NODES_PER_ROW = Math.max(1, Math.floor((graphWidthActual - 80) / (maxRadius * 2 + MIN_NODE_GAP)));

                const rows = [];
                for (let i = 0; i < nodesAtDepth.length; i += MAX_NODES_PER_ROW) {
                    rows.push(nodesAtDepth.slice(i, i + MAX_NODES_PER_ROW));
                }

                rows.forEach((rowNodes, rowIndex) => {
                    const n = rowNodes.length;
                    const rowTotalNodeWidth = rowNodes.reduce((sum, node) => sum + node.r * 2, 0);
                    const totalGaps = (n - 1) * MIN_NODE_GAP;
                    const totalRequired = rowTotalNodeWidth + totalGaps;

                    // If it fits, center. If not, scale gap down to min 4px
                    const gap = totalRequired <= (graphWidthActual - 80)
                        ? MIN_NODE_GAP
                        : Math.max(4, (graphWidthActual - 80 - rowTotalNodeWidth) / (n - 1));

                    const actualRowWidth = rowTotalNodeWidth + (n - 1) * gap;
                    let curX = (graphWidthActual - actualRowWidth) / 2;

                    rowNodes.forEach((node, idx) => {
                        node.x = curX + node.r;
                        node.fy = currentY + rowIndex * (maxRadius * 2 + LABEL_HEIGHT + 20);
                        node.rowSize = rowNodes.length;
                        node.indexInRow = idx;
                        node.y = node.fy;
                        curX += node.r * 2 + gap;
                    });
                });

                currentY += rows.length * (maxRadius * 2 + LABEL_HEIGHT + 20) + BAND_PADDING;
            });

            const finalGraphHeight = Math.max(600, currentY + 100);
            svg.attr('height', finalGraphHeight).attr('viewBox', \`0 0 \${graphWidthActual} \${finalGraphHeight}\`);

            if (vNodes.length === 0) {
                renderEmptyState('Empty View', 'No nodes to display in this level.');
            } else if (currentZoomLevel === 'file' && vNodes.length === 1 && vEdges.length === 0) {
                renderEmptyState(focusedFile.split('/').pop(), 'No internal structure or dependencies found for this file.');
            } else {
                renderEmptyState(null);
            }

            vNodes.forEach(n => {
                vNodeMap.set(n.id, n);
            });

            currentNodes = vNodes;
            updateHitAreas(d3.zoomTransform(capture.node()));

            const linkData = vEdges.filter(d => vNodeMap.has(d.source) && vNodeMap.has(d.target));

            const neighbors = new Map();
            linkData.forEach(l => {
                const s = typeof l.source === 'object' ? l.source.id : l.source;
                const t = typeof l.target === 'object' ? l.target.id : l.target;
                if (!neighbors.has(s)) neighbors.set(s, new Set());
                if (!neighbors.has(t)) neighbors.set(t, new Set());
                neighbors.get(s).add(t);
                neighbors.get(t).add(s);
            });

            function getLabelText(n, isHoveredOrConnected) {
                if (isHoveredOrConnected || currentZoomLevel === 'cluster' || currentZoomLevel === 'file' || n.kind !== 'file') {
                    return n.displayLabel;
                }
                const slotWidth = Math.max(30, graphWidth / n.rowSize);
                const maxChars = Math.max(4, Math.floor((slotWidth - 8) / 6.6));
                return n.displayLabel.length > maxChars ? n.displayLabel.slice(0, maxChars - 1) + '…' : n.displayLabel;
            }

            repoMeta.textContent = \`\${vNodes.length} nodes, \${linkData.length} edges\`;

            // Render links
            const link = linksGroup.selectAll("path")
                .data(linkData, d => typeof d.source === 'object' ? d.source.id + '-' + d.target.id : d.source + '-' + d.target)
                .join("path")
                .attr("class", d => d.kind === 'hierarchy' ? 'hierarchy-edge' : 'dependency-edge ' + (d.state || 'clean'))
                .style("opacity", d => d.opacity)
                .attr("marker-end", d => d.kind === 'dependency' ? \`url(#arrow-\${d.state || 'clean'})\` : null);

            // Render nodes
            const node = nodesGroup.selectAll("g")
                .data(vNodes, d => d.id)
                .join("g")
                .attr("class", "node-hit")
                .call(d3.drag()
                    .on("start", dragstarted)
                    .on("drag", dragged)
                    .on("end", dragended))
                .on("mouseover", (event, d) => {
                    const connected = neighbors.get(d.id) || new Set();
                    nodesGroup.selectAll('.node-label')
                        .attr('opacity', n => (n.id === d.id || connected.has(n.id)) ? 1 : 0.15)
                        .text(n => getLabelText(n, n.id === d.id || connected.has(n.id)));
                })
                .on("mouseout", () => {
                    nodesGroup.selectAll('.node-label')
                        .attr('opacity', 1)
                        .text(n => getLabelText(n, false));
                })
                .on("dblclick", (event, d) => {
                    event.stopPropagation();
                    if (d.kind === 'cluster') {
                        currentZoomLevel = 'folder';
                        expandedCluster = d.label;
                        resetZoom();
                        buildAndRender();
                    } else if (d.kind === 'file' || d.kind === 'folder') {
                        if (d.kind === 'file') {
                            currentZoomLevel = 'file';
                            focusedFile = d.path || d.files[0];
                            resetZoom();
                            buildAndRender();
                        }
                    }
                })
                .on("click", (event, d) => {
                    event.stopPropagation();
                    if (!selecting) selectedFiles.clear();
                    const shouldSelect = d.files.some(file => !selectedFiles.has(file));
                    d.files.forEach(file => shouldSelect ? selectedFiles.add(file) : selectedFiles.delete(file));
                    paintSelection();
                    updateControls();
                });

            node.selectAll("*").remove();
            
            node.append("title").text(d => d.displayLabel);

            node.append("circle")
                .attr("class", "node-halo")
                .attr("r", d => d.r + 10)
                .attr("fill", d => d.kind === 'cluster' ? 'var(--cluster)' : d.kind === 'folder' ? 'var(--folder)' : d.health_state === 'modified' ? 'var(--modified)' : d.health_state === 'conflict' ? 'var(--conflict)' : 'var(--file)');

            node.append("circle")
                .attr("class", d => "node-circle " + d.kind + " " + (d.health_state || ''))
                .attr("r", d => d.r);

            // Tick line for staggered labels
            node.filter(d => d.rowSize > 4 && d.rowSize <= 8 && d.indexInRow % 2 !== 0 && (currentZoomLevel === 'folder' || currentZoomLevel === 'file') && d.kind === 'file')
                .append('line')
                .attr('x1', 0)
                .attr('y1', d => d.r + 4)
                .attr('x2', 0)
                .attr('y2', d => d.r + 22)
                .attr('stroke', 'var(--muted)')
                .attr('stroke-width', 1)
                .attr('stroke-dasharray', '2,2');

            node.append("text")
                .attr("class", d => "node-label " + d.kind)
                .attr("text-anchor", d => ((currentZoomLevel === 'folder' || currentZoomLevel === 'file') && d.rowSize > 8 && d.kind === 'file') ? "end" : "middle")
                .attr("transform", d => {
                    if (currentZoomLevel === 'cluster' || d.kind !== 'file') return \`translate(0, \${d.r + 14})\`;
                    const isDense = d.rowSize > 8;
                    const isStaggered = d.rowSize > 4 && d.rowSize <= 8;
                    if (isDense) {
                        return \`translate(-6, \${d.r + 10}) rotate(-45)\`;
                    } else if (isStaggered) {
                        const isOdd = d.indexInRow % 2 !== 0;
                        return \`translate(0, \${d.r + (isOdd ? 30 : 14)})\`;
                    }
                    return \`translate(0, \${d.r + 14})\`;
                })
                .text(d => getLabelText(d, false));

            simulation.nodes(vNodes).on("tick", () => {
                link.attr("d", d => {
                    if (d.kind === 'hierarchy') {
                        return \`M \${d.source.x} \${d.source.y} L \${d.target.x} \${d.target.y}\`;
                    }
                    const dx = d.target.x - d.source.x, dy = d.target.y - d.source.y;
                    const dr = Math.sqrt(dx * dx + dy * dy);
                    // calculate offset to avoid arrow inside node
                    const r = d.target.r + 4;
                    const endX = d.target.x - dx * (r / dr);
                    const endY = d.target.y - dy * (r / dr);
                    return \`M \${d.source.x} \${d.source.y} L \${endX} \${endY}\`;
                });
                node.attr("transform", d => \`translate(\${d.x},\${d.y})\`);
            });

            simulation.force("link").links(linkData);
            simulation.force("x", d3.forceX(graphWidth / 2).strength(0.05));
            simulation.alpha(1).restart();

            paintSelection();
        }

        function updateBreadcrumbs() {
            let html = \`<span class="breadcrumb" onclick="zoomTo('cluster')">\${graph.branch || 'Repository'}</span>\`;
            if (currentZoomLevel === 'folder' || currentZoomLevel === 'file') {
                html += \` > <span class="breadcrumb" onclick="zoomTo('folder')">\${expandedCluster}</span>\`;
            }
            if (currentZoomLevel === 'file') {
                html += \` > \${focusedFile}\`;
            }
            breadcrumbs.innerHTML = html;
        }

        window.zoomTo = function(level) {
            if (level === 'cluster') { currentZoomLevel = 'cluster'; expandedCluster = null; focusedFile = null; }
            if (level === 'folder' && currentZoomLevel === 'file') { currentZoomLevel = 'folder'; focusedFile = null; }
            resetZoom();
            buildAndRender();
        }

        function dragstarted(event, d) {
            if (!event.active) simulation.alphaTarget(0.3).restart();
            d.fx = d.x; d.fy = d.y;
        }
        function dragged(event, d) {
            d.fx = event.x; // only X is free to move, Y is fixed by depth_rank logic, but let user drag if they want
        }
        function dragended(event, d) {
            if (!event.active) simulation.alphaTarget(0);
            d.fx = null;
            // Restore original FY based on depth_rank
            d.fy = d.fy; 
        }

        function paintSelection() {
            nodesGroup.selectAll("circle.node-circle").classed("selected", d => {
                return d.files.length > 0 && d.files.every(f => selectedFiles.has(f));
            });
        }
    </script>
</body>
</html>`;
    }
}
