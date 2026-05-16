import { CommandDefinition } from '../types';

export const COMMAND_REGISTRY: Record<string, CommandDefinition> = {
    'new branch': {
        key: 'new branch',
        controller: 'CreateBranch',
        gitTemplate: 'git checkout -b {name}',
        destructive: false,
        needsTopology: false,
        args: [{ name: 'name', type: 'newBranch', required: true }]
    },
    'delete branch': {
        key: 'delete branch',
        controller: 'DeleteBranch',
        gitTemplate: 'git branch -d {name}',
        destructive: true,
        needsTopology: false,
        args: [{ name: 'name', type: 'branch', required: true }]
    },
    'switch branch': {
        key: 'switch branch',
        controller: 'SwitchBranch',
        gitTemplate: 'git checkout {name}',
        destructive: false,
        needsTopology: false,
        args: [{ name: 'name', type: 'branch', required: true }]
    },
    'undo commit': {
        key: 'undo commit',
        controller: 'UndoCommit',
        gitTemplate: 'git reset --soft HEAD~1',
        destructive: true,
        needsTopology: false,
        args: []
    },
    'show log': {
        key: 'show log',
        controller: 'ShowLog',
        gitTemplate: 'git log --oneline',
        destructive: false,
        needsTopology: false,
        args: []
    },
    'show status': {
        key: 'show status',
        controller: 'ShowStatus',
        gitTemplate: 'git status --short',
        destructive: false,
        needsTopology: false,
        args: []
    },
    'show branches': {
        key: 'show branches',
        controller: 'ShowBranches',
        gitTemplate: 'git branch --list',
        destructive: false,
        needsTopology: false,
        args: []
    },
    'show conflicts': {
        key: 'show conflicts',
        controller: 'ShowConflicts',
        gitTemplate: null,
        destructive: false,
        needsTopology: false,
        args: []
    },
    'push changes': {
        key: 'push changes',
        controller: 'PushChanges',
        gitTemplate: 'git push',
        destructive: false,
        needsTopology: false,
        args: []
    },
    'compare branch': {
        key: 'compare branch',
        controller: 'CompareBranch',
        gitTemplate: 'git diff {a}..{b}',
        destructive: false,
        needsTopology: false,
        args: [
            { name: 'a', type: 'branch', required: true },
            { name: 'b', type: 'branch', required: true }
        ]
    },
    'git visualize': {
        key: 'git visualize',
        controller: 'VisualizeGraph',
        gitTemplate: null,
        destructive: false,
        needsTopology: true,
        args: []
    },
    summarize: {
        key: 'summarize',
        controller: 'SummarizeFile',
        gitTemplate: null,
        destructive: false,
        needsTopology: false,
        args: [{ name: 'file', type: 'file', required: true }]
    },
    'export markdown': {
        key: 'export markdown',
        controller: 'ExportMarkdown',
        gitTemplate: null,
        destructive: false,
        needsTopology: false,
        args: [{ name: 'files', type: 'files', required: true, variadic: true }]
    },
    'trace conflict': {
        key: 'trace conflict',
        controller: 'TraceConflict',
        gitTemplate: null,
        destructive: false,
        needsTopology: true,
        args: [{ name: 'file', type: 'file', required: true }]
    },
    'show branch': {
        key: 'show branch',
        controller: 'ShowBranches',
        gitTemplate: 'git branch --list',
        destructive: false,
        needsTopology: false,
        args: []
    }
};

export function listCommandKeys(): string[] {
    return Object.keys(COMMAND_REGISTRY).sort();
}
