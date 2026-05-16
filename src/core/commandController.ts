import { GitModule, ConfirmationCallback } from './gitModule';
import { GraphEngine } from './graphEngine';
import { LazyWorker } from './lazyWorker';
import { Parser } from './parser';
import { StructRepo } from './structRepo';
import { Summarizer } from './summarizer';
import { TopologyBuilder } from './topologyBuilder';
import { CommandExecutionResult, ParsedCommand } from '../types';

export class CommandController {
    private readonly summarizer: Summarizer;

    constructor(
        private readonly structRepo: StructRepo,
        private readonly parser: Parser,
        private readonly gitModule: GitModule,
        private readonly graphEngine: GraphEngine,
        private readonly lazyWorker: LazyWorker,
        private readonly topologyBuilder: TopologyBuilder
    ) {
        this.summarizer = new Summarizer(structRepo);
    }

    public async handleInput(
        input: string,
        confirm?: ConfirmationCallback
    ): Promise<CommandExecutionResult> {
        const parsed = this.parser.parseCommand(input);
        if (!parsed.ok) {
            const isSingleSuggestion = parsed.suggestions?.length === 1 && parsed.error.includes('Did you mean');
            return {
                ok: false,
                message: isSingleSuggestion
                    ? parsed.error
                    : parsed.suggestions?.length
                    ? `${parsed.error}\nAvailable commands:\n${parsed.suggestions.map((item) => `- ${item}`).join('\n')}`
                    : parsed.error
            };
        }

        return this.executeParsedCommand(parsed.command, confirm);
    }

    private async executeParsedCommand(
        command: ParsedCommand,
        confirm?: ConfirmationCallback
    ): Promise<CommandExecutionResult> {
        switch (command.definition.controller) {
            case 'SummarizeFile':
                return this.summarize(command.args.file);
            case 'VisualizeGraph':
                return this.visualize();
            case 'TraceConflict':
                return this.traceConflict(command.args.file);
            case 'ExportMarkdown':
                return this.exportMarkdown(command.args.files);
            default:
                return this.gitModule.executeCommand(command, confirm);
        }
    }

    private async summarize(filePath: string): Promise<CommandExecutionResult> {
        const validationError = this.validateFile(filePath);
        if (validationError) {
            return { ok: false, message: validationError };
        }

        const response = await this.lazyWorker.requestWithStatus('summarize', [filePath], () =>
            this.summarizer.summarizeFile(filePath)
        );

        return {
            ok: true,
            message: response.cacheHit
                ? `Success: cached summary loaded for ${filePath}.`
                : `Success: summary ready for ${filePath}.`,
            stdout: response.result.summary
        };
    }

    private async visualize(): Promise<CommandExecutionResult> {
        await this.topologyBuilder.waitUntilReady();
        const graph = await this.graphEngine.visualize();

        return {
            ok: true,
            message: `Success: repository graph opened for branch ${graph.branch}.`,
            openedPanel: 'graph',
            stdout: `nodes: ${Object.keys(graph.nodes).length}\nedges: ${graph.edges.length}`
        };
    }

    private async traceConflict(filePath: string): Promise<CommandExecutionResult> {
        const validationError = this.validateFile(filePath);
        if (validationError) {
            return { ok: false, message: validationError };
        }

        await this.topologyBuilder.waitUntilReady();
        await this.graphEngine.visualize();
        const trace = this.graphEngine.traceConflict(filePath);

        return {
            ok: true,
            message: `Success: conflict trace loaded for ${filePath}.`,
            stdout: trace.map((item) => `- ${item}`).join('\n')
        };
    }

    private async exportMarkdown(filesArgument: string): Promise<CommandExecutionResult> {
        const files = filesArgument.split(/\s+/).filter(Boolean);
        for (const filePath of files) {
            const validationError = this.validateFile(filePath);
            if (validationError) {
                return { ok: false, message: validationError };
            }
        }

        const summaries = await Promise.all(
            files.map((filePath) =>
                this.lazyWorker.request('markdown', [filePath], () => this.summarizer.summarizeFile(filePath))
            )
        );

        return {
            ok: true,
            message: 'Success: markdown context exported.',
            stdout: summaries.map((summary) => summary.summary).join('\n\n---\n\n')
        };
    }

    private validateFile(filePath: string): string | null {
        if (!filePath || !this.structRepo.hasFile(filePath)) {
            return `Error: file ${filePath} is not tracked in this repository.`;
        }

        return null;
    }
}
