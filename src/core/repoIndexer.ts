import path from 'path';
import { GitClient } from './gitClient';
import { StructRepo } from './structRepo';
import { GitStatus, RepoIndexEntry } from '../types';

function normalizePath(filePath: string): string {
    return filePath.split(path.sep).join('/');
}

function parseStatusCode(code: string): GitStatus {
    if (code.includes('D')) {
        return 'D';
    }
    if (code.includes('A')) {
        return 'A';
    }
    if (code.includes('M')) {
        return 'M';
    }
    if (code.includes('?')) {
        return '?';
    }
    return 'clean';
}

export class RepoIndexer {
    private readonly git: GitClient;

    constructor(private readonly structRepo: StructRepo) {
        this.git = new GitClient(structRepo.repositoryRoot);
    }

    public async buildShallowIndex(): Promise<void> {
        const [branchResult, branchesResult, filesResult, statusResult] = await Promise.all([
            this.git.run(['branch', '--show-current']),
            this.git.run(['branch', '--format=%(refname:short)']),
            this.git.run(['ls-files']),
            this.git.run(['status', '--porcelain'])
        ]);

        const currentBranch = branchResult.stdout || 'HEAD';
        const branches = branchesResult.stdout
            .split(/\r?\n/)
            .map((branch) => branch.trim())
            .filter(Boolean);

        const statusByPath = this.parsePorcelainStatus(statusResult.stdout);
        const trackedFiles = filesResult.stdout
            .split(/\r?\n/)
            .map((filePath) => normalizePath(filePath.trim()))
            .filter(Boolean);

        const allFiles = new Set<string>([...trackedFiles, ...Object.keys(statusByPath)]);
        const entries: RepoIndexEntry[] = [];

        for (const filePath of Array.from(allFiles).sort()) {
            entries.push({
                path: filePath,
                git_status: statusByPath[filePath] ?? 'clean',
                last_commit_hash: await this.getLastCommitHash(filePath),
                branch: currentBranch,
                cache_valid: true
            });
        }

        this.structRepo.repo_updater({
            currentBranch,
            branches,
            indexEntries: entries
        });
    }

    public async refreshGitState(): Promise<void> {
        await this.buildShallowIndex();
    }

    private parsePorcelainStatus(output: string): Record<string, GitStatus> {
        const statusByPath: Record<string, GitStatus> = {};

        for (const line of output.split(/\r?\n/)) {
            if (!line.trim()) {
                continue;
            }

            const code = line.slice(0, 2);
            const rawPath = line.slice(3).trim();
            const filePath = normalizePath(rawPath.includes(' -> ') ? rawPath.split(' -> ').pop() ?? rawPath : rawPath);
            statusByPath[filePath] = parseStatusCode(code);
        }

        return statusByPath;
    }

    private async getLastCommitHash(filePath: string): Promise<string> {
        try {
            const result = await this.git.run(['log', '-n', '1', '--format=%H', '--', filePath]);
            return result.stdout || '';
        } catch {
            return '';
        }
    }
}
