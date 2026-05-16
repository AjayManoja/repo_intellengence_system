import { RecentCache } from './recentCache';
import { StructRepo } from './structRepo';
import { CacheEntry, LazyJob, LazyOperation } from '../types';

export class LazyWorker {
    constructor(
        private readonly structRepo: StructRepo,
        private readonly cache: RecentCache
    ) {}

    public async request<T>(
        operation: LazyOperation,
        fileSet: string[],
        compute: (job: LazyJob) => Promise<T> | T
    ): Promise<T> {
        const response = await this.requestWithStatus(operation, fileSet, compute);
        return response.result;
    }

    public async requestWithStatus<T>(
        operation: LazyOperation,
        fileSet: string[],
        compute: (job: LazyJob) => Promise<T> | T
    ): Promise<{ result: T; cacheHit: boolean }> {
        const branch = this.structRepo.currentBranch;
        const key = this.cache.buildKey(operation, fileSet, branch);
        const cached = await this.cache.get(key);

        if (cached && this.isFileSetClean(cached.file_set)) {
            return { result: cached.result as T, cacheHit: true };
        }

        if (cached) {
            await this.cache.markStale(key);
        }

        const result = await this.spawnWorker(operation, fileSet, branch, compute);
        return { result, cacheHit: false };
    }

    private async spawnWorker<T>(
        operation: LazyOperation,
        fileSet: string[],
        branch: string,
        compute: (job: LazyJob) => Promise<T> | T
    ): Promise<T> {
        const job: LazyJob = {
            operation,
            file_set: [...fileSet].sort(),
            branch,
            struct_repo_version: this.structRepo.version
        };

        const started = Date.now();
        const result = await compute(job);
        const computeCost = Date.now() - started;

        if (this.structRepo.version !== job.struct_repo_version) {
            return this.spawnWorker(operation, fileSet, this.structRepo.currentBranch, compute);
        }

        const key = this.cache.buildKey(operation, job.file_set, branch);
        const entry: CacheEntry<T> = {
            key,
            result,
            compute_cost_ms: computeCost,
            last_accessed: new Date().toISOString(),
            file_set: job.file_set,
            branch
        };

        await this.cache.set(entry);
        this.structRepo.repo_updater({ markCacheValid: job.file_set });

        return result;
    }

    private isFileSetClean(fileSet: string[]): boolean {
        return fileSet.every((filePath) => {
            const entry = this.structRepo.getIndexEntry(filePath);
            return entry ? entry.cache_valid : false;
        });
    }
}
