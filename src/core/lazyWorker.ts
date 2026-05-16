import { StructRepo } from './structRepo';

export class LazyWorker {
    private cache: Map<string, any>;
    private maxCacheSize: number;

    constructor(maxCacheSize: number = 10) {
        // "store it in recent name folders it will store top-k recent computed"
        this.cache = new Map();
        this.maxCacheSize = maxCacheSize;
    }

    /**
     * Executes work lazily. No pre-compute.
     * Uses the `isModified` flag to determine if it should re-compute.
     */
    public executeTask(filepath: string, structRepo: StructRepo, taskFn: () => any): any {
        const fileNode = structRepo.getFile(filepath);

        if (!fileNode) {
            throw new Error(`File ${filepath} not found in StructRepo.`);
        }

        // "add in each file bool : isModified if yes then re-compute else send to same to the user"
        if (!fileNode.isModified && this.cache.has(filepath)) {
            console.log(`[LazyWorker] Returning cached result for ${filepath}`);
            return this.cache.get(filepath);
        }

        console.log(`[LazyWorker] Computing task for ${filepath}...`);
        const result = taskFn();
        
        this.storeInCache(filepath, result);
        
        // Mark as clean since we have processed the latest state
        structRepo.markAsClean(filepath);

        return result;
    }

    private storeInCache(key: string, result: any) {
        if (this.cache.size >= this.maxCacheSize) {
            // Remove oldest entry (Map iterates in insertion order)
            const firstKey = this.cache.keys().next().value;
            if (firstKey !== undefined) {
                this.cache.delete(firstKey);
            }
        }
        this.cache.set(key, result);
    }
}
