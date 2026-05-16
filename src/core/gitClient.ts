import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

export interface GitRunResult {
    stdout: string;
    stderr: string;
}

export class GitClient {
    constructor(private readonly repositoryRoot: string) {}

    public async run(args: string[]): Promise<GitRunResult> {
        const result = await execFileAsync('git', args, {
            cwd: this.repositoryRoot,
            windowsHide: true,
            maxBuffer: 10 * 1024 * 1024
        });

        return {
            stdout: result.stdout.trim(),
            stderr: result.stderr.trim()
        };
    }
}
