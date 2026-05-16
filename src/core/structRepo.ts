import { StructRepoData, TrackedFile } from '../types';

export class StructRepo {
    private data: StructRepoData;

    constructor(repositoryName: string, currentBranch: string) {
        this.data = {
            repositoryName,
            currentBranch,
            files: {}
        };
    }

    /**
     * The Main Gate for the model and modules.
     * Always tracks git files and repository information.
     */
    public getRepoState(): StructRepoData {
        return this.data;
    }

    public getFile(filepath: string): TrackedFile | undefined {
        return this.data.files[filepath];
    }

    public updateFile(filepath: string, status: 'tracked' | 'untracked' | 'ignored', isModified: boolean): void {
        if (!this.data.files[filepath]) {
            this.data.files[filepath] = {
                filepath,
                isModified,
                gitStatus: status,
                dependencies: []
            };
        } else {
            this.data.files[filepath].isModified = isModified;
            this.data.files[filepath].gitStatus = status;
        }
    }

    public markAsModified(filepath: string): void {
        if (this.data.files[filepath]) {
            this.data.files[filepath].isModified = true;
        }
    }

    public markAsClean(filepath: string): void {
        if (this.data.files[filepath]) {
            this.data.files[filepath].isModified = false;
        }
    }
}
