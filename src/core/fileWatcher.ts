import fs from 'fs';
import path from 'path';
import { StructRepo } from './structRepo';

function normalizePath(filePath: string): string {
    return filePath.split(path.sep).join('/');
}

export class FileWatcher {
    private watcher: fs.FSWatcher | null = null;
    private readonly timers = new Map<string, NodeJS.Timeout>();

    constructor(
        private readonly structRepo: StructRepo,
        private readonly debounceMs: number = 300
    ) {}

    public start(): void {
        if (this.watcher) {
            return;
        }

        this.watcher = fs.watch(
            this.structRepo.repositoryRoot,
            { recursive: true },
            (_eventType, filename) => {
                if (!filename) {
                    return;
                }

                const relativePath = normalizePath(filename.toString());
                if (relativePath.startsWith('.git/') || relativePath.includes('/node_modules/')) {
                    return;
                }

                this.schedule(relativePath);
            }
        );
    }

    public stop(): void {
        this.watcher?.close();
        this.watcher = null;

        for (const timer of this.timers.values()) {
            clearTimeout(timer);
        }
        this.timers.clear();
    }

    private schedule(filePath: string): void {
        const existing = this.timers.get(filePath);
        if (existing) {
            clearTimeout(existing);
        }

        const timer = setTimeout(() => {
            this.timers.delete(filePath);
            if (this.structRepo.hasFile(filePath)) {
                const currentHash = this.structRepo.getIndexEntry(filePath)?.last_commit_hash ?? '';
                this.structRepo.repo_updater({
                    markCacheInvalid: [{ path: filePath, old_hash: currentHash, new_hash: currentHash }]
                });
            }
        }, this.debounceMs);

        this.timers.set(filePath, timer);
    }
}
