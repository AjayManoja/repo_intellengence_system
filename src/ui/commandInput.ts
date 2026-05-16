import * as vscode from 'vscode';
import { Parser } from '../core/parser';
import { GitModule } from '../core/gitModule';
import { GraphEngine } from '../core/graphEngine';

export class CommandInput {
    private parser: Parser;
    private gitModule: GitModule;
    private graphEngine: GraphEngine;
    private extensionUri: vscode.Uri;

    constructor(parser: Parser, gitModule: GitModule, graphEngine: GraphEngine, extensionUri: vscode.Uri) {
        this.parser = parser;
        this.gitModule = gitModule;
        this.graphEngine = graphEngine;
        this.extensionUri = extensionUri;
    }

    public async show() {
        console.log('[DEBUG] CommandInput.show() invoked');
        vscode.window.showInformationMessage('DEBUG: Command Input Triggered');

        const input = await vscode.window.showInputBox({
            prompt: 'Enter a repository intention (e.g., "new branch fix-login", "git visualize")',
            placeHolder: 'Intention-driven command...'
        });

        if (!input) {
            return;
        }

        vscode.window.setStatusBarMessage(`Executing: ${input}`, 3000);

        if (input.trim().toLowerCase() === 'git visualize') {
            await vscode.commands.executeCommand('repo-intelligence.visualize');
            return;
        }

        const parseResult = this.parser.parseCommand(input);

        if (!parseResult.ok) {
            vscode.window.showErrorMessage(parseResult.error || 'Unknown command.');
            return;
        }

        const cmdKey = parseResult.command.definition.key;

        try {
            // Confirm for destructive commands if needed (simplified for phase 1)
            if (cmdKey === 'delete branch' || cmdKey === 'undo commit') {
                const confirm = await vscode.window.showWarningMessage(
                    `Confirm: ${cmdKey}?`,
                    { modal: true },
                    'Yes', 'No'
                );
                if (confirm !== 'Yes') {
                    vscode.window.showInformationMessage(`Cancelled: ${cmdKey} was not executed.`);
                    return;
                }
            }

            // Fallback for Phase 1 A
            // We pass the parsed command or string as required by the user's updated gitModule
            this.gitModule.executeCommand(parseResult.command);
            vscode.window.showInformationMessage(`Success: ${cmdKey} executed.`);
        } catch (err: any) {
            vscode.window.showErrorMessage(`Error: operation failed. ${err.message}`);
        }
    }
}
