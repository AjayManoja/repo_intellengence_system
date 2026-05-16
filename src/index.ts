import path from 'path';
import readline from 'readline/promises';
import { stdin as input, stdout as output } from 'process';
import { CommandController } from './core/commandController';
import { listCommandKeys } from './core/commandRegistry';
import { loadEnvFile } from './core/envLoader';
import { FileWatcher } from './core/fileWatcher';
import { GitModule } from './core/gitModule';
import { GraphEngine } from './core/graphEngine';
import { LazyWorker } from './core/lazyWorker';
import { Parser } from './core/parser';
import { RecentCache } from './core/recentCache';
import { RepoIndexer } from './core/repoIndexer';
import { StructRepo } from './core/structRepo';
import { TopologyBuilder } from './core/topologyBuilder';

export interface RepoIntelligenceRuntime {
    structRepo: StructRepo;
    parser: Parser;
    gitModule: GitModule;
    graphEngine: GraphEngine;
    lazyWorker: LazyWorker;
    topologyBuilder: TopologyBuilder;
    fileWatcher: FileWatcher;
    commandController: CommandController;
}

interface CliArgs {
    repositoryRoot: string;
    commandText: string;
}

function parseCliArgs(argv: string[]): CliArgs {
    let repositoryRoot = process.cwd();
    const commandParts: string[] = [];

    for (let i = 0; i < argv.length; i += 1) {
        const arg = argv[i];

        if (arg === '--repo' || arg === '--repository-root') {
            const value = argv[i + 1];
            if (!value) {
                throw new Error(`Missing value for ${arg}.`);
            }

            repositoryRoot = path.resolve(value);
            i += 1;
            continue;
        }

        commandParts.push(arg);
    }

    return {
        repositoryRoot,
        commandText: commandParts.join(' ').trim()
    };
}

export async function initializeRepoIntelligence(repositoryRoot = process.cwd()): Promise<RepoIntelligenceRuntime> {
    loadEnvFile(repositoryRoot);

    const repositoryName = path.basename(repositoryRoot);
    const structRepo = new StructRepo(repositoryRoot, repositoryName);
    const indexer = new RepoIndexer(structRepo);

    await indexer.buildShallowIndex();

    const parser = new Parser();
    const gitModule = new GitModule(structRepo);
    const graphEngine = new GraphEngine(structRepo);
    const cache = new RecentCache(path.join(repositoryRoot, 'recent'), 20);
    await cache.load();

    const lazyWorker = new LazyWorker(structRepo, cache);
    const topologyBuilder = new TopologyBuilder(structRepo);
    const fileWatcher = new FileWatcher(structRepo, 300);
    const commandController = new CommandController(
        structRepo,
        parser,
        gitModule,
        graphEngine,
        lazyWorker,
        topologyBuilder
    );

    topologyBuilder.buildInBackground().catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`[topology] background build failed: ${message}`);
    });

    fileWatcher.start();

    return {
        structRepo,
        parser,
        gitModule,
        graphEngine,
        lazyWorker,
        topologyBuilder,
        fileWatcher,
        commandController
    };
}

function printCommandResult(result: Awaited<ReturnType<CommandController['handleInput']>>): void {
    console.log(result.message);

    if (result.stdout) {
        console.log(result.stdout);
    }

    if (result.stderr) {
        console.error(result.stderr);
    }
}

async function runTerminalCommand(
    runtime: RepoIntelligenceRuntime,
    terminal: readline.Interface,
    inputText: string
): Promise<void> {
    const result = await runtime.commandController.handleInput(inputText, async (message) => {
        const answer = await terminal.question(`Confirm: ${message} y/n `);
        return answer.trim().toLowerCase() === 'y';
    });

    printCommandResult(result);
}

async function main(): Promise<void> {
    const cliArgs = parseCliArgs(process.argv.slice(2));
    const runtime = await initializeRepoIntelligence(cliArgs.repositoryRoot);
    const repoState = runtime.structRepo.getRepoState();
    const terminal = readline.createInterface({ input, output });

    try {
        console.log(`repo_intelligence ready: ${repoState.repositoryName}`);
        console.log(`repository: ${repoState.repositoryRoot}`);
        console.log(`branch: ${repoState.currentBranch}`);
        console.log(`indexed files: ${Object.keys(repoState.repo_index).length}`);
        console.log(`struct_repo.version: ${repoState.version}`);

        if (cliArgs.commandText) {
            await runTerminalCommand(runtime, terminal, cliArgs.commandText);
            return;
        }

        console.log('Type a repository intention, or "help" for commands. Type "exit" to quit.');

        while (true) {
            const command = (await terminal.question('repo> ')).trim();

            if (!command) {
                continue;
            }

            if (command.toLowerCase() === 'exit' || command.toLowerCase() === 'quit') {
                break;
            }

            if (command.toLowerCase() === 'help') {
                console.log(`Available commands:\n${listCommandKeys().map((key) => `- ${key}`).join('\n')}`);
                continue;
            }

            await runTerminalCommand(runtime, terminal, command);
        }
    } finally {
        terminal.close();
        runtime.fileWatcher.stop();
    }
}

if (require.main === module) {
    main().catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        console.error(message);
        process.exitCode = 1;
    });
}
