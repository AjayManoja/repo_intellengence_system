import { StructRepo } from './structRepo';

export class GitModule {
    private structRepo: StructRepo;

    constructor(structRepo: StructRepo) {
        this.structRepo = structRepo;
    }

    /**
     * Executes a parsed command.
     * "git modules always ref that one [struct_repo]"
     */
    public executeCommand(commandStr: string): void {
        const repoState = this.structRepo.getRepoState();
        
        // This simulates command dispatching based on the unified struct repo
        console.log(`[GitModule] Executing "${commandStr}" in context of ${repoState.repositoryName}`);

        if (commandStr.startsWith('new branch')) {
            const parts = commandStr.split(' ');
            const branchName = parts.length > 2 ? parts[2] : 'unknown-branch';
            console.log(`[GitModule] -> Running actual git command: git checkout -b ${branchName}`);
            // Underlying execution would happen here...
        } 
        else if (commandStr.startsWith('compare')) {
            console.log(`[GitModule] -> Running actual git command: git diff`);
        }
        else {
            console.log(`[GitModule] -> Unhandled command implementation.`);
        }
    }
}
