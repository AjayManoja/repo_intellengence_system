export type GitStatus = 'M' | 'A' | 'D' | '?' | 'clean';

export type LazyOperation = 'summarize' | 'graph_slice' | 'markdown' | 'conflict_trace';

export interface RepoIndexEntry {
    path: string;
    git_status: GitStatus;
    last_commit_hash: string;
    branch: string;
    cache_valid: boolean;
}

export interface RepoTopologyEntry {
    path: string;
    imports: string[];
    exports: string[];
    references: string[];
    declared_symbols: string[];
    used_symbols: string[];
    cluster: string;
    depth_rank: number;
    last_computed: string;
}

export interface StructRepoData {
    version: number;
    repositoryRoot: string;
    repositoryName: string;
    currentBranch: string;
    branches: string[];
    repo_index: Record<string, RepoIndexEntry>;
    repo_topology: Record<string, RepoTopologyEntry>;
}

export interface StructRepoFileView extends RepoIndexEntry {
    imports: string[];
    exports: string[];
    references: string[];
    declared_symbols: string[];
    used_symbols: string[];
    cluster: string;
    depth_rank: number;
    last_computed: string;
}

export interface PendingGraphDiff {
    path: string;
    old_hash: string;
    new_hash: string;
    timestamp: string;
}

export interface StructRepoPatch {
    currentBranch?: string;
    branches?: string[];
    indexEntries?: RepoIndexEntry[];
    topologyEntries?: RepoTopologyEntry[];
    removePaths?: string[];
    markCacheInvalid?: Array<{ path: string; old_hash?: string; new_hash?: string }>;
    markCacheValid?: string[];
    pendingGraphDiffs?: PendingGraphDiff[];
}

export interface CommandArgSpec {
    name: string;
    type: 'branch' | 'newBranch' | 'file' | 'files' | 'free';
    required: boolean;
    variadic?: boolean;
}

export interface CommandDefinition {
    key: string;
    controller: string;
    gitTemplate: string | null;
    destructive: boolean;
    needsTopology: boolean;
    args: CommandArgSpec[];
}

export interface ParsedCommand {
    raw: string;
    normalized: string;
    tokens: string[];
    definition: CommandDefinition;
    args: Record<string, string>;
}

export type CommandParseResult =
    | {
          ok: true;
          command: ParsedCommand;
      }
    | {
          ok: false;
          error: string;
          suggestions?: string[];
      };

export interface CommandExecutionResult {
    ok: boolean;
    message: string;
    command?: string;
    stdout?: string;
    stderr?: string;
    openedPanel?: 'graph';
}

export interface LazyJob {
    operation: LazyOperation;
    file_set: string[];
    branch: string;
    struct_repo_version: number;
}

export interface CacheEntry<T = unknown> {
    key: string;
    result: T;
    compute_cost_ms: number;
    last_accessed: string;
    file_set: string[];
    branch: string;
    stale?: boolean;
}

export interface GraphNode {
    path: string;
    imports: string[];
    exports: string[];
    references: string[];
    declared_symbols: string[];
    cluster: string;
    depth_rank: number;
    health_state: 'clean' | 'modified' | 'conflict' | 'ignored' | 'error';
}

export interface GraphEdge {
    from: string;
    to: string;
    weight: number;
}

export interface GraphStruct {
    nodes: Record<string, GraphNode>;
    edges: GraphEdge[];
    built_from_version: number;
    branch: string;
    pending_diffs: PendingGraphDiff[];
}

export interface FileSummary {
    file: string;
    branch: string;
    provider: 'local' | 'groq' | 'multi-groq';
    summary: string;
}
