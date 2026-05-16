import { StructRepo } from './structRepo';
import { GraphStructureRepo, GraphNode, GraphEdge } from '../types';

export class GraphEngine {
    private structRepo: StructRepo;
    private graphStructure: GraphStructureRepo;

    constructor(structRepo: StructRepo) {
        this.structRepo = structRepo;
        this.graphStructure = {
            nodes: [],
            edges: [],
            lastCalculatedDiffs: null
        };
    }

    /**
     * Builds or updates the graph by comparing the main StructRepo with its internal GraphStructureRepo.
     * "to build graph -> graph_structre ref -> measured diff between struct_repo and graph_structre_repo"
     */
    public buildGraph(): GraphStructureRepo {
        const repoState = this.structRepo.getRepoState();
        const diffs: any[] = [];

        // Simple mock of measuring diffs between structRepo and internal graphStructure
        for (const [filepath, fileData] of Object.entries(repoState.files)) {
            const existingNode = this.graphStructure.nodes.find(n => n.id === filepath);

            if (!existingNode) {
                // New file added to graph
                this.graphStructure.nodes.push({
                    id: filepath,
                    type: 'file',
                    status: fileData.isModified ? 'modified' : 'clean'
                });
                diffs.push({ action: 'add', node: filepath });
            } else if (fileData.isModified) {
                // File modified
                existingNode.status = 'modified';
                diffs.push({ action: 'update', node: filepath, status: 'modified' });
            }
        }

        this.graphStructure.lastCalculatedDiffs = diffs;
        
        console.log(`[GraphEngine] Graph built with ${diffs.length} updates.`);
        return this.graphStructure;
    }
}
