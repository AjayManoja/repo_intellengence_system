# Phase 1 Implementation Design

## Purpose

This document defines the Phase 1 build plan for the AI-native repository intelligence system. Phase 1 focuses on a reliable local architecture that can:

- initialize quickly when a repository opens
- keep one live repository state object
- translate simple user commands into safe Git operations
- run expensive work only when requested
- cache recent computed results
- maintain an incremental graph view of repository relationships

The core rule for Phase 1 is simple:

> All modules read repository state from `struct_repo`. Nothing except the approved updater path writes to it.

## Verified Design Summary

The proposed design is technically consistent and implementation-ready with a few important clarifications:

- The two-phase initialization is correct. `repo_index` gives a fast usable state, while `repo_topology` can arrive later without blocking the user.
- `struct_repo` should be the state gate for all modules. Git, cache, graph, and workers should not independently inspect the repo when a validated state value already exists.
- A monotonic `struct_repo.version` is necessary. It gives workers and graph updates a simple stale-result check.
- `cache_valid` should be treated as a cache-validity flag, not a Git dirty-state flag. Git state belongs in `git_status`.
- Branch validation cannot rely only on `git ls-files`; Phase 1A also needs a lightweight branch list command such as `git branch --format=%(refname:short)` or an equivalent Git daemon method.
- Deleted files need careful handling. A deleted file can appear in Git status but may not be readable during topology parsing.
- Untracked files are not returned by `git ls-files` unless explicitly included. If `?` status is required, Phase 1A must also read porcelain status.
- The graph should be lazy. It should not build until the graph panel opens or the user runs `git visualize`.

These points do not change the architecture. They make the implementation safer and more precise.

## System Boundaries

Phase 1 includes:

- local repository indexing
- command parsing and registry lookup
- safe Git command execution through controllers
- file watcher updates
- lazy worker execution
- disk-backed recent cache
- topology extraction for supported source files
- graph structure creation and incremental graph diffs
- editor panel behavior specification

Phase 1 does not include:

- autonomous code editing
- complex natural language command planning
- multi-agent or MoE summarization
- remote CI integration
- full semantic architecture inference across every language
- automatic destructive Git operations without confirmation

## Core Data Model

### `struct_repo`

`struct_repo` is the main in-memory state object. Every subsystem holds a reference to it.

```ts
interface StructRepo {
  version: number;
  repositoryRoot: string;
  currentBranch: string;
  branches: string[];
  repo_index: Record<string, RepoIndexEntry>;
  repo_topology: Record<string, RepoTopologyEntry>;
}
```

### `repo_index`

`repo_index` is built in Phase 1A and must always be available before commands are accepted.

```ts
interface RepoIndexEntry {
  path: string;
  git_status: "M" | "A" | "D" | "?" | "clean";
  last_commit_hash: string;
  branch: string;
  cache_valid: boolean;
}
```

### `repo_topology`

`repo_topology` is built in Phase 1B and may be unavailable for a short time.

```ts
interface RepoTopologyEntry {
  path: string;
  imports: string[];
  exports: string[];
  references: string[];
  declared_symbols: string[];
  used_symbols: string[];
  cluster: string;
  depth_rank: number;
  last_computed: string;
}
```

### Full File Entry View

Consumers that need the complete file view can compose it from `repo_index[path]` and `repo_topology[path]`.

```ts
interface StructRepoFileView {
  path: string;
  git_status: "M" | "A" | "D" | "?" | "clean";
  last_commit_hash: string;
  branch: string;
  cache_valid: boolean;
  imports: string[];
  exports: string[];
  references: string[];
  declared_symbols: string[];
  used_symbols: string[];
  cluster: string;
  depth_rank: number;
  last_computed: string;
}
```

## State Ownership Rules

All writes must go through one function:

```ts
repo_updater(patch): StructRepo
```

`repo_updater` is responsible for:

- applying the patch atomically
- incrementing `struct_repo.version` exactly once per write transaction
- preserving the same shared `struct_repo` reference
- preventing modules from mutating nested objects directly

Ownership rules:

- Only the file watcher sets `cache_valid: false`.
- Only a completed lazy worker sets `cache_valid: true`.
- Git controllers may update `git_status`, `last_commit_hash`, `currentBranch`, and `branches`.
- The topology worker may update `imports`, `exports`, `depth_rank`, and `last_computed`.
- No module owns a private copy of `struct_repo`.

## Initialization Sequence

Initialization must never block the user longer than Phase 1A.

### Phase 1A: Shallow Build

Runs immediately when the repository opens.

Inputs:

- `git ls-files`
- lightweight status read, preferably porcelain format
- current branch
- branch list
- last commit hash per tracked file

Output:

- populated `repo_index`
- populated `currentBranch`
- populated `branches`
- initial `struct_repo.version`

Required behavior:

- commands become available after Phase 1A
- no dependency parsing happens here
- missing topology is represented as unavailable, not as an error

### Phase 1B: Deep Build

Runs in a background worker after Phase 1A.

Inputs:

- `repo_index`
- readable source files

Work:

- parse supported files with AST tooling
- extract imports
- extract exports
- extract CommonJS `require`, dynamic import, HTML script/link, CSS import, and literal path references
- extract declared symbols and used symbols for files that do not expose explicit imports
- infer symbol-based edges when a known file declares a symbol used elsewhere
- infer feature clusters from path and symbol names
- resolve import paths where possible
- compute dependency order with topological sort
- assign `depth_rank`

Output:

- populated `repo_topology`
- merged full state in `struct_repo`

If a command needs topology before Phase 1B completes, it waits on an async readiness gate.

## Command Pipeline

All user commands move through the same six stages.

### Stage 1: Tokenizer

Normalize the command:

- trim whitespace
- collapse repeated spaces
- lowercase command keywords
- preserve user arguments where needed

Example:

```txt
New   Branch login-fix
```

becomes:

```ts
["new", "branch", "login-fix"]
```

### Stage 2: Registry Lookup

The registry is a static dictionary compiled at build time.

```ts
interface CommandDefinition {
  key: string;
  controller: string;
  gitTemplate: string;
  destructive: boolean;
  needsTopology: boolean;
  args: CommandArgSpec[];
}
```

Example entries:

```ts
{
  "new branch": {
    controller: "CreateBranch",
    gitTemplate: "git checkout -b {name}",
    destructive: false,
    needsTopology: false
  },
  "delete branch": {
    controller: "DeleteBranch",
    gitTemplate: "git branch -d {name}",
    destructive: true,
    needsTopology: false
  },
  "switch branch": {
    controller: "SwitchBranch",
    gitTemplate: "git checkout {name}",
    destructive: false,
    needsTopology: false
  },
  "undo commit": {
    controller: "UndoCommit",
    gitTemplate: "git reset --soft HEAD~1",
    destructive: true,
    needsTopology: false
  },
  "show log": {
    controller: "ShowLog",
    gitTemplate: "git log --oneline",
    destructive: false,
    needsTopology: false
  }
}
```

Exact match continues to pre-flight checks.

### Stage 3: Fuzzy Fallback

If no exact match is found:

- compare the verb+noun pair against registry keys
- use Levenshtein edit distance
- if closest distance is `<= 2`, suggest the command and stop
- if closest distance is `> 2`, return unknown command plus available commands

No command executes during fuzzy fallback.

No LLM is involved in Phase 1 command matching.

### Stage 4: Pre-Flight Reference Check

The controller validates arguments against `struct_repo`.

Examples:

- `new branch login-fix` checks that `login-fix` is not already in `branches`
- `switch branch main` checks that `main` exists in `branches`
- file commands check that the file exists in `repo_index`
- topology commands wait for the topology async gate if needed

The Git module must never call Git with an argument that was not validated.

### Stage 5: Confirmation Guard

Destructive commands must ask for confirmation before execution.

Examples:

- delete branch
- reset
- force push
- hard clean

The system prints the planned action in plain language and waits for `y/n`.

### Stage 6: Controller Execution

The controller:

- receives validated arguments
- fills the Git template
- calls the Git daemon
- captures success or failure
- updates `struct_repo` through `repo_updater`
- returns a user-readable result

## Lazy Worker System

Core rule:

> Nothing expensive runs until requested.

Lazy operations include:

- `summarize`
- `graph_slice`
- `markdown`
- `conflict_trace`

Job descriptor:

```ts
interface LazyJob {
  operation: "summarize" | "graph_slice" | "markdown" | "conflict_trace";
  file_set: string[];
  branch: string;
  struct_repo_version: number;
}
```

Worker flow:

1. Capture `struct_repo.version`.
2. Run the operation asynchronously.
3. Before writing cache, compare current `struct_repo.version` with captured version.
4. If versions match, write result and mark files clean.
5. If versions differ, discard result and respawn with a fresh version.

Workers are fire-and-forget from the user perspective. The UI shows a spinner or pending state until the result is ready. 

**Groq Summarization Chain**:
For summarization, the worker implements a two-phase chain:
1. Fire 4 analyst models in parallel (Overview, Structure, Risk, Dependencies) requesting ONLY JSON output.
2. Fire a Synthesizer model that takes the JSON from step 1 and produces the final developer-facing Markdown.

## Recent Cache

The cache is a top-K weighted LRU cache backed by disk.

Default:

```txt
K = 20
folder = recent/
```

### Cache Key

```ts
key = hash(operation_type + sorted(file_paths) + branch_name)
```

Sorting makes file-set order irrelevant.

### Cache Entry

```ts
interface CacheEntry {
  key: string;
  result: unknown;
  compute_cost_ms: number;
  last_accessed: string;
  file_set: string[];
  branch: string;
}
```

### Lookup Flow:

1. Compute key.
2. Check memory cache.
3. If missing, check `recent/{key}.json`.
4. If no entry exists, spawn a lazy worker.
5. If an entry exists, check `cache_valid` for every file in `file_set`.
6. If all files are valid, return cached result and update `last_accessed`.
7. If any file is invalid, spawn a lazy worker and mark the old entry stale.

### Eviction

Weighted LRU score:

```txt
score = time_since_last_access / compute_cost_ms
```

Lowest score is evicted first. This keeps expensive results around longer than cheap results.

## `cache_valid` Lifecycle

`cache_valid` means:

> The cached computed result for this file is currently up-to-date.

It does not mean:

> The file is clean in Git.

Lifecycle:

- file watcher sets `cache_valid: false`
- lazy worker sets `cache_valid: true` after successful fresh computation and cache write
- cache lookup reads `cache_valid`
- graph diff engine reads `cache_valid` to determine modification halo state

File watcher debounce:

```txt
300ms after the last write event
```

Multiple rapid saves should produce one state update.

## Graph Layer

### `graph_struct`

```ts
interface GraphStruct {
  nodes: Record<string, GraphNode>;
  edges: GraphEdge[];
  built_from_version: number;
  branch: string;
  pending_diffs: PendingGraphDiff[];
}

interface GraphNode {
  path: string;
  imports: string[];
  exports: string[];
  references: string[];
  declared_symbols: string[];
  cluster: string;
  depth_rank: number;
  health_state: "clean" | "modified" | "conflict" | "ignored" | "error";
}

interface GraphEdge {
  from: string;
  to: string;
  weight: number;
}

interface PendingGraphDiff {
  path: string;
  old_hash: string;
  new_hash: string;
  timestamp: string;
}
```

### First Build

The graph is built lazily when:

- the graph panel opens
- the user runs `git visualize`

The graph worker reads `repo_topology` and constructs `graph_struct`.

The graph structure is persisted as the local graph database:

```txt
recent/graph_struct.json
```

This file is the reusable UI data source for the graph panel. The UI must not
re-parse repository files directly.

### Incremental Update

When `git visualize` runs again:

1. Read current `struct_repo.version`.
2. Compare with `graph_struct.built_from_version`.
3. If equal, render existing graph.
4. If different, consume `pending_diffs`.
5. Add new nodes.
6. Remove deleted nodes.
7. Rewire changed imports and exports.
8. Update `built_from_version`.
9. Render only changed nodes.

The diff engine compares dictionaries and precomputed pending diffs. It should not re-parse the filesystem.

## Panel Behavior

Default view:

- current branch subgraph only
- top header shows current branch name and interactive breadcrumbs
- **Advanced Grid Layout**: 
  - Nodes occupy horizontal bands based on `depth_rank`.
  - Band heights are calculated dynamically to fit the largest node in that rank.
  - Rows automatically wrap when exceeding viewport width and remain centered.
- **Interactive Navigation**:
  - Full D3 Zoom and Pan supported via mouse and floating UI controls.
  - Double-click to navigate between Cluster -> Folder -> File levels.
  - Zoom-aware label visibility to maintain clarity at all scales.
- **Visual Polish**:
  - Smart label truncation based on available slot width.
  - Staggered offsets and diagonal rotations for dense rows.
  - Native tooltips for full file paths.
- **Single-Scroll Integration**:
  - The graph, toolbar, and summary share a single vertical scrollbar.
  - The summary panel expands dynamically on analysis.
- **Interaction Guard**:
  - Background clicks pass through to UI buttons but trigger deselect on the graph.
  - One-hop view for file focus with an empty-state guard for isolated files.

Branch selector:

- populated from `struct_repo.branches`
- switching branch filters existing graph data for that branch
- no re-parse during selection

Subgraph focus:

- clicking a node shows its one-hop neighborhood
- implemented as a render-layer visibility filter
- Escape restores full branch view

Node menu:

- clicking a single file outside selection mode: focus that file selection
- `Select` button: enter selection mode
- `Cancel` button: leave selection mode and clear selected files
- `Analyze` button: summarize selected files or all files under selected folder pseudo nodes into the bottom panel
- selected files: `Generate Summary PDF`
- selected files: `Generate Markdown File`
- red node: `Trace conflict`
- two or more files: `Summarize all`

Phase 1 behavior:

- `Summarize` may call an LLM after structured context is built
- `Export markdown` uses a deterministic template first, with optional LLM prose
- `Generate Summary PDF` writes a local PDF export under `recent/`
- `Generate Markdown File` writes a local markdown context file under `recent/`
- exports use selected graph nodes as their file set and prefer the currently generated bottom-panel summary when available
- summary generation supports multiple configured Groq keys and role prompts
- supported key names include `GROQ_API_KEY`, `GROQ_API_KEY_1` through `GROQ_API_KEY_5`, `GROQAPIKEY1` through `GROQAPIKEY5`, and lowercase `groqapikey1` through `groqapikey5`
- model roles append separate sections instead of replacing each other: overview, code structure, error/risk review, dependency/API context, and LLM handoff notes
- `Trace conflict` is pure graph traversal and does not require an LLM
- `Summarize all` is reserved for Phase 2 MoE behavior

## End-to-End Data Flow

### File Change

```txt
file watcher
  -> debounce 300ms
  -> repo_updater sets cache_valid: false
  -> append graph pending diff
  -> increment struct_repo.version
```

### User Command

```txt
user input
  -> tokenizer
  -> registry lookup
  -> fuzzy fallback if needed
  -> pre-flight validation against struct_repo
  -> confirmation guard if destructive
  -> controller executes
  -> git daemon returns result
  -> repo_updater updates repo_index
  -> increment struct_repo.version
```

### Lazy Operation

```txt
operation request
  -> compute cache key
  -> check memory and disk cache
  -> check cache_valid for file_set
  -> clean hit returns cached result
  -> miss or stale spawns worker
  -> worker captures version
  -> worker computes (parallel chain for Groq)
  -> version match writes cache and sets cache_valid: true
  -> version mismatch discards and respawns
```

### Graph Visualize

```txt
git visualize
  -> compare struct_repo.version to graph_struct.built_from_version
  -> if same, render existing graph
  -> if changed, consume pending_diffs
  -> patch graph_struct
  -> update built_from_version
  -> render delta
```

## Expected System Behavior

The system should feel fast immediately after opening a repository.

Expected startup behavior:

- Phase 1A completes quickly.
- Commands are available as soon as `repo_index` exists.
- Deep topology work runs in the background.
- The UI does not freeze during topology build.

Expected command behavior:

- known commands execute through controllers
- typos produce suggestions and do not execute
- destructive commands always request confirmation
- invalid files or branches are rejected before Git is called
- Git command results update `struct_repo`

Expected cache behavior:

- repeated summary/export/graph requests return quickly when files are valid
- modified files (cache_valid: false) trigger recomputation
- stale worker results are discarded when the repo changes during computation
- recent cache survives process restarts

Expected graph behavior:

- graph builds only when requested
- default view is scoped to current branch
- file changes update only affected nodes and edges
- graph focus hides unrelated nodes without mutating graph data
- conflict tracing works through graph traversal

Expected failure behavior:

- missing topology causes a wait, not a crash
- missing files return clear validation errors
- Git failures return clear controller errors
- corrupt cache entries are ignored and recomputed
- deleted files remain representable in `repo_index` even if content parsing is skipped

## Implementation Order

Build in this order:

1. `repo_index` builder using Git-tracked files and lightweight status.
2. `repo_updater` with atomic version increments.
3. File watcher with 300ms debounce.
4. Command tokenizer.
5. Static command registry.
6. Fuzzy matcher with threshold `<= 2`.
7. Controller stubs for common Git commands.
8. Pre-flight argument validation against `struct_repo`.
9. Confirmation guard for destructive commands.
10. Disk-backed recent cache in `recent/`.
11. Weighted LRU eviction.
12. Cache lookup with `isModified` guard.
13. Lazy worker runner with optimistic version check.
14. `repo_topology` builder using AST parsing.
15. Dependency topological sort and `depth_rank`.
16. Graph builder.
17. Graph diff engine and `pending_diffs`.
18. Panel renderer with branch selector, focus mode, and node-click actions.

## Initial Command Set

Start with these commands:

| User command | Controller | Git template | Destructive |
| --- | --- | --- | --- |
| `new branch {name}` | `CreateBranch` | `git checkout -b {name}` | No |
| `delete branch {name}` | `DeleteBranch` | `git branch -d {name}` | Yes |
| `switch branch {name}` | `SwitchBranch` | `git checkout {name}` | No |
| `undo commit` | `UndoCommit` | `git reset --soft HEAD~1` | Yes |
| `show log` | `ShowLog` | `git log --oneline` | No |
| `show status` | `ShowStatus` | `git status --short` | No |
| `show conflicts` | `ShowConflicts` | derived from index conflict state | No |
| `push changes` | `PushChanges` | `git push` | No |
| `compare branch {a} {b}` | `CompareBranch` | `git diff {a}..{b}` | No |
| `git visualize` | `VisualizeGraph` | no Git command required | No |

## Acceptance Criteria

Phase 1 is complete when:

- opening a repo produces `repo_index` quickly
- `repo_topology` builds asynchronously and merges into `struct_repo`
- all state writes go through `repo_updater`
- `struct_repo.version` increments on every write
- command parsing supports exact and fuzzy matching
- destructive commands require confirmation
- controllers validate all branch and file references before Git execution
- lazy workers discard stale results after version changes
- recent cache persists to disk and evicts by weighted LRU
- file watcher updates `isModified` with debounce
- graph builds lazily and updates incrementally
- panel behavior matches the current-branch-first workflow

## Implementation Notes for Current Codebase

The current repository already has early files for:

- `src/core/structRepo.ts`
- `src/core/parser.ts`
- `src/core/gitModule.ts`
- `src/core/lazyWorker.ts`
- `src/core/graphEngine.ts`
- `src/types/index.ts`

These should be treated as prototypes. The Phase 1 implementation should evolve them toward this document instead of preserving the older simplified interfaces.

Recommended first refactor:

- replace `filepath` with `path`
- replace `gitStatus: tracked | untracked | ignored` with `git_status: M | A | D | ? | clean`
- add `repo_index`, `repo_topology`, `branches`, and `version`
- remove direct mutator methods like `markAsModified` from public module access
- introduce `repo_updater` as the only write path
