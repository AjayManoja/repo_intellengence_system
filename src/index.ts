import { Parser } from './core/parser';
import { StructRepo } from './core/structRepo';
import { GitModule } from './core/gitModule';
import { GraphEngine } from './core/graphEngine';
import { LazyWorker } from './core/lazyWorker';

// 1. Initialize the Core System State (Main Gate)
const mainRepoState = new StructRepo('my-cool-project', 'main');

// 2. Initialize Modules
const parser = new Parser();
const gitModule = new GitModule(mainRepoState);
const graphEngine = new GraphEngine(mainRepoState);
const lazyWorker = new LazyWorker(5); // Top-5 recent tasks cached

// Mock setup: add a tracked file
mainRepoState.updateFile('src/auth.ts', 'tracked', false);

// ------------------------------------------------------------------
// Demonstration of User Workflow
// ------------------------------------------------------------------
function handleUserCommand(input: string) {
    console.log(`\n--- User Typed: "${input}" ---`);
    
    // 1. Parser Checks Command
    const parseResult = parser.parseCommand(input);
    
    if (!parseResult.valid) {
        // "if user type new brach instead of new branch it will error msg with did you mean new branch?"
        console.error(`[Error] ${parseResult.error}`);
        return;
    }

    // 2. Valid Command -> Call Controller/Git Module
    console.log(`[Controller] Routing valid command: ${parseResult.command}`);
    gitModule.executeCommand(parseResult.command!);
}

function handleContextRequest(filepath: string) {
    console.log(`\n--- Requesting Context for: ${filepath} ---`);
    
    // Simulate a heavy computation task for a file
    const expensiveTask = () => {
        return `Context Data for ${filepath} (Generated at ${new Date().toISOString()})`;
    };

    // 3. Lazy Worker Evaluation
    try {
        const result = lazyWorker.executeTask(filepath, mainRepoState, expensiveTask);
        console.log(`[Result] ${result}`);
    } catch (e: any) {
        console.error(`[Error] ${e.message}`);
    }
}

// ------------------------------------------------------------------
// Simulation Run
// ------------------------------------------------------------------

// Test 1: Typo Command
handleUserCommand('new brach auth-feature');

// Test 2: Valid Command
handleUserCommand('new branch auth-feature');

// Test 3: Lazy Compute (First time - should compute)
handleContextRequest('src/auth.ts');

// Test 4: Lazy Compute (Second time, not modified - should cache)
handleContextRequest('src/auth.ts');

// Test 5: File Modified -> Graph Update -> Lazy Compute (Should re-compute)
console.log(`\n--- Modifying 'src/auth.ts' ---`);
mainRepoState.markAsModified('src/auth.ts');

// Rebuild Graph (it will notice the diff based on `isModified`)
graphEngine.buildGraph();

// Requesting context again (should re-compute since isModified is true)
handleContextRequest('src/auth.ts');
