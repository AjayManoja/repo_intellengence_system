import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { CacheEntry, LazyOperation } from '../types';

export class RecentCache {
    private readonly entries = new Map<string, CacheEntry>();
    private loaded = false;

    constructor(
        private readonly cacheDir: string,
        private readonly maxEntries: number = 20
    ) {}

    public async load(): Promise<void> {
        await fs.mkdir(this.cacheDir, { recursive: true });
        const files = await fs.readdir(this.cacheDir);

        for (const file of files) {
            if (!file.endsWith('.json')) {
                continue;
            }

            try {
                const raw = await fs.readFile(path.join(this.cacheDir, file), 'utf8');
                const entry = JSON.parse(raw) as CacheEntry;
                this.entries.set(entry.key, entry);
            } catch {
                // Corrupt cache entries are ignored and recomputed on demand.
            }
        }

        this.loaded = true;
        await this.evictIfNeeded();
    }

    public buildKey(operation: LazyOperation, fileSet: string[], branch: string): string {
        const stableInput = JSON.stringify({
            operation,
            fileSet: [...fileSet].sort(),
            branch
        });

        return crypto.createHash('sha256').update(stableInput).digest('hex');
    }

    public async get(key: string): Promise<CacheEntry | undefined> {
        if (!this.loaded) {
            await this.load();
        }

        const entry = this.entries.get(key);
        if (!entry) {
            return undefined;
        }

        entry.last_accessed = new Date().toISOString();
        await this.persist(entry);
        return entry;
    }

    public async set(entry: CacheEntry): Promise<void> {
        if (!this.loaded) {
            await this.load();
        }

        this.entries.set(entry.key, entry);
        await this.persist(entry);
        await this.evictIfNeeded();
    }

    public async markStale(key: string): Promise<void> {
        const entry = await this.get(key);
        if (!entry) {
            return;
        }

        entry.stale = true;
        await this.persist(entry);
    }

    private async persist(entry: CacheEntry): Promise<void> {
        await fs.mkdir(this.cacheDir, { recursive: true });
        await fs.writeFile(path.join(this.cacheDir, `${entry.key}.json`), JSON.stringify(entry, null, 2));
    }

    private async evictIfNeeded(): Promise<void> {
        if (this.entries.size <= this.maxEntries) {
            return;
        }

        const now = Date.now();
        const scored = [...this.entries.values()].map((entry) => {
            const accessed = new Date(entry.last_accessed).getTime();
            const timeSinceAccess = Math.max(1, now - accessed);
            const computeCost = Math.max(1, entry.compute_cost_ms);
            return {
                key: entry.key,
                score: timeSinceAccess / computeCost
            };
        });

        scored.sort((a, b) => a.score - b.score);

        while (this.entries.size > this.maxEntries) {
            const victim = scored.shift();
            if (!victim) {
                return;
            }

            this.entries.delete(victim.key);
            await fs.rm(path.join(this.cacheDir, `${victim.key}.json`), { force: true });
        }
    }
}
