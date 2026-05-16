export interface TrackedFile {
    filepath: string;
    isModified: boolean;
    gitStatus: 'tracked' | 'untracked' | 'ignored';
    dependencies: string[];
}

export interface StructRepoData {
    repositoryName: string;
    currentBranch: string;
    files: Record<string, TrackedFile>;
}

export interface GraphNode {
    id: string;
    type: 'file' | 'module' | 'branch';
    status: 'clean' | 'modified' | 'conflict';
}

export interface GraphEdge {
    source: string;
    target: string;
    relationship: 'depends_on' | 'imports';
}

export interface GraphStructureRepo {
    nodes: GraphNode[];
    edges: GraphEdge[];
    lastCalculatedDiffs: any;
}
