import {
    PendingGraphDiff,
    RepoIndexEntry,
    RepoTopologyEntry,
    StructRepoData,
    StructRepoFileView,
    StructRepoPatch
} from '../types';

export class StructRepo {
    private readonly data: StructRepoData;
    private readonly pendingGraphDiffs: PendingGraphDiff[] = [];

    constructor(repositoryRoot: string, repositoryName: string, currentBranch: string = 'unknown') {
        this.data = {
            version: 0,
            repositoryRoot,
            repositoryName,
            currentBranch,
            branches: [],
            repo_index: {},
            repo_topology: {}
        };
    }

    public getRepoState(): Readonly<StructRepoData> {
        return this.data;
    }

    public get version(): number {
        return this.data.version;
    }

    public get repositoryRoot(): string {
        return this.data.repositoryRoot;
    }

    public get currentBranch(): string {
        return this.data.currentBranch;
    }

    public get branches(): readonly string[] {
        return this.data.branches;
    }

    public getIndexEntry(path: string): RepoIndexEntry | undefined {
        return this.data.repo_index[path];
    }

    public getTopologyEntry(path: string): RepoTopologyEntry | undefined {
        return this.data.repo_topology[path];
    }

    public hasFile(path: string): boolean {
        return Boolean(this.data.repo_index[path]);
    }

    public getFile(path: string): StructRepoFileView | undefined {
        const indexEntry = this.data.repo_index[path];
        if (!indexEntry) {
            return undefined;
        }

        const topologyEntry = this.data.repo_topology[path];
        return {
            ...indexEntry,
            imports: topologyEntry?.imports ?? [],
            exports: topologyEntry?.exports ?? [],
            references: topologyEntry?.references ?? [],
            declared_symbols: topologyEntry?.declared_symbols ?? [],
            used_symbols: topologyEntry?.used_symbols ?? [],
            cluster: topologyEntry?.cluster ?? this.inferFallbackCluster(path),
            depth_rank: topologyEntry?.depth_rank ?? -1,
            last_computed: topologyEntry?.last_computed ?? ''
        };
    }

    public listFiles(): StructRepoFileView[] {
        return Object.keys(this.data.repo_index)
            .sort()
            .map((path) => this.getFile(path))
            .filter((entry): entry is StructRepoFileView => Boolean(entry));
    }

    public consumePendingGraphDiffs(): PendingGraphDiff[] {
        return this.pendingGraphDiffs.splice(0, this.pendingGraphDiffs.length);
    }

    public peekPendingGraphDiffs(): readonly PendingGraphDiff[] {
        return this.pendingGraphDiffs;
    }

    public repo_updater(patch: StructRepoPatch): number {
        let changed = false;

        if (patch.currentBranch !== undefined && patch.currentBranch !== this.data.currentBranch) {
            this.data.currentBranch = patch.currentBranch;
            changed = true;
        }

        if (patch.branches !== undefined) {
            this.data.branches = [...patch.branches].sort();
            changed = true;
        }

        for (const entry of patch.indexEntries ?? []) {
            this.data.repo_index[entry.path] = { ...entry };
            changed = true;
        }

        for (const entry of patch.topologyEntries ?? []) {
            this.data.repo_topology[entry.path] = { ...entry };
            changed = true;
        }

        for (const path of patch.removePaths ?? []) {
            if (this.data.repo_index[path]) {
                delete this.data.repo_index[path];
                changed = true;
            }
            if (this.data.repo_topology[path]) {
                delete this.data.repo_topology[path];
                changed = true;
            }
        }

        for (const path of patch.markCacheValid ?? []) {
            const entry = this.data.repo_index[path];
            if (entry && !entry.cache_valid) {
                entry.cache_valid = true;
                changed = true;
            }
        }

        for (const change of patch.markCacheInvalid ?? []) {
            const entry = this.data.repo_index[change.path];
            if (entry && entry.cache_valid) {
                entry.cache_valid = false;
                changed = true;
            }

            this.pendingGraphDiffs.push({
                path: change.path,
                old_hash: change.old_hash ?? '',
                new_hash: change.new_hash ?? '',
                timestamp: new Date().toISOString()
            });
            changed = true;
        }

        for (const diff of patch.pendingGraphDiffs ?? []) {
            this.pendingGraphDiffs.push({ ...diff });
            changed = true;
        }

        if (changed) {
            this.data.version += 1;
        }

        return this.data.version;
    }

    private inferFallbackCluster(path: string): string {
        const lowerPath = path.toLowerCase();
        if (lowerPath.includes('ui') || lowerPath.endsWith('.html') || lowerPath.endsWith('.css')) {
            return 'ui';
        }
        if (lowerPath.includes('controller') || lowerPath.includes('command') || lowerPath.includes('core')) {
            return 'core';
        }
        if (lowerPath.includes('ai') || lowerPath.includes('llm') || lowerPath.includes('summary')) {
            return 'ai';
        }
        if (lowerPath.includes('test') || lowerPath.includes('spec')) {
            return 'tests';
        }
        if (lowerPath.endsWith('.md')) {
            return 'docs';
        }
        if (lowerPath.endsWith('.json') || lowerPath.includes('config')) {
            return 'config';
        }
        return 'app';
    }
}
