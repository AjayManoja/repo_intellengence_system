import fs from 'fs/promises';
import path from 'path';
import { StructRepo } from './structRepo';
import { GraphEdge, GraphNode, GraphStruct } from '../types';

export class GraphEngine {
    private graphStruct: GraphStruct | null = null;

    constructor(
        private readonly structRepo: StructRepo,
        private readonly storagePath = path.join(structRepo.repositoryRoot, 'recent', 'graph_struct.json')
    ) {}

    public async visualize(): Promise<GraphStruct> {
        if (!this.graphStruct) {
            this.graphStruct = await this.loadGraph();
        }

        if (!this.graphStruct || !this.isGraphSchemaCurrent(this.graphStruct)) {
            this.graphStruct = this.buildGraphStruct();
            await this.persistGraph();
            return this.graphStruct;
        }

        if (this.graphStruct.built_from_version === this.structRepo.version) {
            return this.graphStruct;
        }

        this.applyDiffs();
        await this.persistGraph();
        return this.graphStruct;
    }

    public focusOneHop(pathName: string): GraphStruct {
        const graph = this.graphStruct ?? this.buildGraphStruct();
        const visible = new Set<string>([pathName]);

        for (const edge of graph.edges) {
            if (edge.from === pathName) {
                visible.add(edge.to);
            }
            if (edge.to === pathName) {
                visible.add(edge.from);
            }
        }

        return {
            ...graph,
            nodes: Object.fromEntries(Object.entries(graph.nodes).filter(([pathKey]) => visible.has(pathKey)))
        };
    }

    public traceConflict(pathName: string): string[] {
        const graph = this.graphStruct ?? this.buildGraphStruct();
        const visited = new Set<string>();
        const queue = [pathName];

        while (queue.length > 0) {
            const current = queue.shift();
            if (!current || visited.has(current)) {
                continue;
            }

            visited.add(current);
            for (const edge of graph.edges) {
                if (edge.to === current && !visited.has(edge.from)) {
                    queue.push(edge.from);
                }
            }
        }

        return [...visited];
    }

    private buildGraphStruct(): GraphStruct {
        const nodes: Record<string, GraphNode> = {};
        const edges: GraphEdge[] = [];

        for (const file of this.structRepo.listFiles()) {
            nodes[file.path] = {
                path: file.path,
                imports: file.imports,
                exports: file.exports,
                references: file.references,
                declared_symbols: file.declared_symbols,
                cluster: file.cluster,
                depth_rank: file.depth_rank,
                health_state: this.getHealthState(file.path)
            };

            for (const imported of file.references) {
                if (!this.structRepo.hasFile(imported)) {
                    continue;
                }

                edges.push({
                    from: file.path,
                    to: imported,
                    weight: 1
                });
            }
        }

        return {
            nodes,
            edges,
            built_from_version: this.structRepo.version,
            branch: this.structRepo.currentBranch,
            pending_diffs: [...this.structRepo.peekPendingGraphDiffs()]
        };
    }

    private applyDiffs(): void {
        if (!this.graphStruct) {
            return;
        }

        const pendingDiffs = this.structRepo.consumePendingGraphDiffs();
        const changedPaths = new Set<string>(pendingDiffs.map((diff) => diff.path));
        const currentFiles = new Set(Object.keys(this.structRepo.getRepoState().repo_index));

        for (const pathName of Object.keys(this.graphStruct.nodes)) {
            if (!currentFiles.has(pathName)) {
                delete this.graphStruct.nodes[pathName];
                changedPaths.add(pathName);
            }
        }

        for (const pathName of currentFiles) {
            const file = this.structRepo.getFile(pathName);
            if (!file) {
                continue;
            }

            const existing = this.graphStruct.nodes[pathName];
            if (!existing || changedPaths.has(pathName)) {
                this.graphStruct.nodes[pathName] = {
                    path: file.path,
                    imports: file.imports,
                    exports: file.exports,
                    references: file.references,
                    declared_symbols: file.declared_symbols,
                    cluster: file.cluster,
                    depth_rank: file.depth_rank,
                    health_state: this.getHealthState(file.path)
                };
            }
        }

        this.graphStruct.edges = this.graphStruct.edges.filter(
            (edge) => !changedPaths.has(edge.from) && !changedPaths.has(edge.to)
        );

        for (const pathName of changedPaths) {
            const file = this.structRepo.getFile(pathName);
            if (!file) {
                continue;
            }

            for (const imported of file.references) {
                if (!this.structRepo.hasFile(imported)) {
                    continue;
                }

                this.graphStruct.edges.push({
                    from: file.path,
                    to: imported,
                    weight: 1
                });
            }
        }

        this.graphStruct.pending_diffs = pendingDiffs;
        this.graphStruct.branch = this.structRepo.currentBranch;
        this.graphStruct.built_from_version = this.structRepo.version;
    }

    private getHealthState(pathName: string): GraphNode['health_state'] {
        const entry = this.structRepo.getIndexEntry(pathName);
        if (!entry) {
            return 'error';
        }
        if (entry.git_status === '?') {
            return 'ignored';
        }
        if (!entry.cache_valid) {
            return 'modified';
        }
        return 'clean';
    }

    private async loadGraph(): Promise<GraphStruct | null> {
        try {
            const raw = await fs.readFile(this.storagePath, 'utf8');
            return JSON.parse(raw) as GraphStruct;
        } catch {
            return null;
        }
    }

    private isGraphSchemaCurrent(graph: GraphStruct): boolean {
        const nodePaths = new Set(Object.keys(graph.nodes));
        return Object.values(graph.nodes).every(
            (node) =>
                Array.isArray(node.references) &&
                Array.isArray(node.declared_symbols) &&
                typeof node.cluster === 'string'
        ) && graph.edges.every((edge) => nodePaths.has(edge.from) && nodePaths.has(edge.to));
    }

    private async persistGraph(): Promise<void> {
        if (!this.graphStruct) {
            return;
        }

        await fs.mkdir(path.dirname(this.storagePath), { recursive: true });
        await fs.writeFile(this.storagePath, JSON.stringify(this.graphStruct, null, 2));
    }
}
