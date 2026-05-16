import * as vscode from 'vscode';
import { initializeRepoIntelligence, RepoIntelligenceRuntime } from './index';
import { listCommandKeys } from './core/commandRegistry';
import { GraphPanel } from './ui/graphPanel';

function normalizeTerminalText(value: string): string {
    return value.replace(/\n/g, '\r\n');
}

function createRepoIntelligenceTerminal(
    runtime: RepoIntelligenceRuntime,
    extensionUri: vscode.Uri
): vscode.Pseudoterminal {
    const writeEmitter = new vscode.EventEmitter<string>();
    let inputBuffer = '';
    let busy = false;
    let pendingQuestion: ((answer: string) => void) | null = null;

    const write = (value: string) => writeEmitter.fire(normalizeTerminalText(value));
    const prompt = () => write('\r\nrepo> ');

    const runCommand = async (input: string): Promise<void> => {
        const command = input.trim();
        if (!command) {
            prompt();
            return;
        }

        if (pendingQuestion) {
            const resolve = pendingQuestion;
            pendingQuestion = null;
            resolve(command);
            return;
        }

        if (busy) {
            write('\r\nWorking: command still running.');
            prompt();
            return;
        }

        if (command.toLowerCase() === 'exit' || command.toLowerCase() === 'quit') {
            write('\r\nSession closed.');
            return;
        }

        if (command.toLowerCase() === 'help') {
            write(`\r\nAvailable commands:\r\n${listCommandKeys().map((key) => `- ${key}`).join('\r\n')}`);
            prompt();
            return;
        }

        busy = true;
        try {
            const result = await runtime.commandController.handleInput(command, async (message) => {
                write(`\r\nConfirm: ${message} y/n `);
                const answer = await new Promise<string>((resolve) => {
                    pendingQuestion = resolve;
                });
                return answer.trim().toLowerCase() === 'y';
            });

            write(`\r\n${result.message}`);
            if (result.stdout) {
                write(`\r\n${result.stdout}`);
            }
            if (result.stderr) {
                write(`\r\n${result.stderr}`);
            }

            if (result.openedPanel === 'graph') {
                await GraphPanel.createOrShow(extensionUri, runtime);
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            write(`\r\nError: ${message}`);
        } finally {
            busy = false;
            prompt();
        }
    };

    return {
        onDidWrite: writeEmitter.event,
        open: () => {
            const repoState = runtime.structRepo.getRepoState();
            write(`Repo Intelligence ready: ${repoState.repositoryName}`);
            write(`\r\nRepository: ${repoState.repositoryRoot}`);
            write(`\r\nBranch: ${repoState.currentBranch}`);
            write(`\r\nType a repository intention, or "help" for commands.`);
            prompt();
        },
        close: () => {
            writeEmitter.dispose();
        },
        handleInput: (data: string) => {
            for (const char of data) {
                if (char === '\r') {
                    write('\r\n');
                    const submitted = inputBuffer;
                    inputBuffer = '';
                    runCommand(submitted);
                    continue;
                }

                if (char === '\u007f') {
                    if (inputBuffer.length > 0) {
                        inputBuffer = inputBuffer.slice(0, -1);
                        write('\b \b');
                    }
                    continue;
                }

                inputBuffer += char;
                write(char);
            }
        }
    };
}

export function activate(context: vscode.ExtensionContext) {
    console.log('[DEBUG] Repo Intelligence: activate() called');
    vscode.window.showInformationMessage('DEBUG: Repo Intelligence Activating...');

    // Initialize the core modules
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';
    console.log(`[DEBUG] Workspace Root: ${workspaceRoot}`);

    let runtimePromise: Promise<RepoIntelligenceRuntime> | null = null;
    const getRuntime = async (): Promise<RepoIntelligenceRuntime> => {
        if (!workspaceRoot) {
            throw new Error('open a workspace folder before starting Repo Intelligence.');
        }

        if (!runtimePromise) {
            runtimePromise = initializeRepoIntelligence(workspaceRoot);
        }

        return runtimePromise;
    };

    // Register terminal command prompt UI
    let disposableInput = vscode.commands.registerCommand('repo-intelligence.openCommandInput', async () => {
        if (!workspaceRoot) {
            vscode.window.showErrorMessage('Error: open a workspace folder before starting Repo Intelligence.');
            return;
        }

        const runtime = await getRuntime();
        const terminal = vscode.window.createTerminal({
            name: 'Repo Intelligence',
            pty: createRepoIntelligenceTerminal(runtime, context.extensionUri)
        });
        terminal.show();
    });

    // Register Visualize UI directly (fallback if not called from input)
    let disposableVisualize = vscode.commands.registerCommand('repo-intelligence.visualize', async () => {
        try {
            const runtime = await getRuntime();
            await runtime.topologyBuilder.waitUntilReady();
            GraphPanel.createOrShow(context.extensionUri, runtime);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            vscode.window.showErrorMessage(`Error: repository graph could not be opened. ${message}`);
        }
    });

    context.subscriptions.push(disposableInput);
    context.subscriptions.push(disposableVisualize);
}

export function deactivate() {}
