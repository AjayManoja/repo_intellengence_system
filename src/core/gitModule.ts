import { GitClient } from './gitClient';
import { RepoIndexer } from './repoIndexer';
import { StructRepo } from './structRepo';
import { CommandExecutionResult, ParsedCommand } from '../types';

export type ConfirmationCallback = (message: string) => Promise<boolean> | boolean;

export class GitModule {
    private readonly git: GitClient;
    private readonly indexer: RepoIndexer;

    constructor(private readonly structRepo: StructRepo) {
        this.git = new GitClient(structRepo.repositoryRoot);
        this.indexer = new RepoIndexer(structRepo);
    }

    public async executeCommand(
        command: ParsedCommand,
        confirm: ConfirmationCallback = () => false
    ): Promise<CommandExecutionResult> {
        const validationError = this.validateReferences(command);
        if (validationError) {
            return { ok: false, message: validationError };
        }

        if (command.definition.destructive) {
            const allowed = await confirm(this.describeDestructiveAction(command));
            if (!allowed) {
                return { ok: false, message: this.cancelledMessage(command) };
            }
        }

        if (command.definition.controller === 'ShowConflicts') {
            return this.showConflicts();
        }

        if (command.definition.controller === 'VisualizeGraph') {
            return {
                ok: true,
                message: 'Graph visualization requested. The graph engine will build from struct_repo.',
                command: 'git visualize'
            };
        }

        const gitArgs = this.buildGitArgs(command);
        if (!gitArgs) {
            return { ok: false, message: `No executable Git template for ${command.definition.key}.` };
        }

        try {
            const result = await this.git.run(gitArgs);
            await this.indexer.refreshGitState();

            return {
                ok: true,
                message: this.successMessage(command, result.stdout),
                command: `git ${gitArgs.join(' ')}`,
                stdout: result.stdout,
                stderr: result.stderr
            };
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return {
                ok: false,
                message: this.failureMessage(command, message),
                command: `git ${gitArgs.join(' ')}`
            };
        }
    }

    private validateReferences(command: ParsedCommand): string | null {
        for (const spec of command.definition.args) {
            const value = command.args[spec.name];
            if (spec.required && !value) {
                return `Missing required argument: ${spec.name}.`;
            }

            if (!value) {
                continue;
            }

            if (spec.type === 'branch' && !this.structRepo.branches.includes(value)) {
                return `Error: branch ${value} does not exist.`;
            }

            if (spec.type === 'newBranch' && this.structRepo.branches.includes(value)) {
                return `Error: branch ${value} already exists.`;
            }

            if (spec.type === 'file' && !this.structRepo.hasFile(value)) {
                return `Error: file ${value} is not tracked in this repository.`;
            }
        }

        if (command.definition.controller === 'DeleteBranch' && command.args.name === this.structRepo.currentBranch) {
            return `Error: cannot delete the current branch ${command.args.name}.`;
        }

        return null;
    }

    private describeDestructiveAction(command: ParsedCommand): string {
        if (command.definition.controller === 'DeleteBranch') {
            return `Delete branch ${command.args.name}?`;
        }

        if (command.definition.controller === 'UndoCommit') {
            return 'Undo the last commit with git reset --soft HEAD~1?';
        }

        return `Run destructive command: ${command.definition.key}?`;
    }

    private buildGitArgs(command: ParsedCommand): string[] | null {
        const template = command.definition.gitTemplate;
        if (!template) {
            return null;
        }

        let expanded = template;
        for (const [name, value] of Object.entries(command.args)) {
            expanded = expanded.replace(`{${name}}`, value);
        }

        const parts = expanded.split(' ').filter(Boolean);
        return parts[0] === 'git' ? parts.slice(1) : parts;
    }

    private showConflicts(): CommandExecutionResult {
        const conflictedFiles = this.structRepo
            .listFiles()
            .filter((file) => file.git_status === 'D' || file.git_status === 'M')
            .map((file) => file.path);

        if (conflictedFiles.length === 0) {
            return {
                ok: true,
                message: 'Success: no conflicts found.'
            };
        }

        return {
            ok: true,
            message: 'Success: conflict status loaded.',
            stdout: conflictedFiles.map((file) => `- ${file}`).join('\n')
        };
    }

    private successMessage(command: ParsedCommand, stdout: string): string {
        switch (command.definition.controller) {
            case 'CreateBranch':
                return `Success: branch ${command.args.name} created.`;
            case 'DeleteBranch':
                return `Success: branch ${command.args.name} deleted.`;
            case 'SwitchBranch':
                return `Success: switched to branch ${command.args.name}.`;
            case 'UndoCommit':
                return 'Success: last commit undone. Changes are still in your working tree.';
            case 'ShowStatus':
                return stdout ? 'Success: repository status loaded.' : 'Success: repository is clean.';
            case 'ShowLog':
                return 'Success: commit log loaded.';
            case 'PushChanges':
                return `Success: pushed branch ${this.structRepo.currentBranch}.`;
            case 'CompareBranch':
                return `Success: comparison loaded for ${command.args.a}..${command.args.b}.`;
            case 'ShowBranches':
                return 'Success: branches loaded.';
            default:
                return 'Success: command executed.';
        }
    }

    private failureMessage(command: ParsedCommand, reason: string): string {
        switch (command.definition.controller) {
            case 'CreateBranch':
                return `Error: branch ${command.args.name} was not created. ${reason}`;
            case 'DeleteBranch':
                return `Error: branch ${command.args.name} was not deleted. ${reason}`;
            case 'UndoCommit':
                return `Error: last commit was not undone. ${reason}`;
            case 'ShowLog':
                return `Error: commit log could not be loaded. ${reason}`;
            case 'PushChanges':
                return `Error: push failed. ${reason}`;
            case 'ShowBranches':
                return `Error: could not list branches. ${reason}`;
            default:
                return `Error: command failed. ${reason}`;
        }
    }

    private cancelledMessage(command: ParsedCommand): string {
        if (command.definition.controller === 'DeleteBranch') {
            return `Cancelled: branch ${command.args.name} was not deleted.`;
        }

        if (command.definition.controller === 'UndoCommit') {
            return 'Cancelled: last commit was not changed.';
        }

        return 'Cancelled: command was not executed.';
    }
}
