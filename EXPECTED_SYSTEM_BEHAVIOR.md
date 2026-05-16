# Expected System Behavior

## Purpose

This document defines the final expected behavior of the Phase 1 developer-facing system.

The system should feel like an intention-driven repository assistant:

```txt
developer types simple command
  -> extension validates it
  -> extension executes safe internal workflow
  -> extension prints a clear response
  -> visual panel opens only when needed
```

The developer should not need to remember raw Git syntax for supported workflows.

## User Interaction Model

The developer controls the system through a command input surface.

This command input can later be implemented as:

- a VS Code command palette command
- a custom extension command box
- a webview input bar
- a terminal-like extension panel

For Phase 1, behavior matters more than the exact UI surface.

Every command must return a text response to the command surface.

Visual commands may also open a panel.

## Core Rule

The user thinks in intentions.

The system translates those intentions into safe repository operations.

Example:

```txt
new branch login-fix
```

System internally performs:

```txt
validate command
check branch does not already exist
run git checkout -b login-fix
update struct_repo
print result
```

Expected user response:

```txt
Success: branch login-fix created.
```

## Response Style

Responses should be short, explicit, and action-based.

Use these response prefixes:

- `Success:` operation completed
- `Error:` operation could not run
- `Cancelled:` user declined confirmation
- `Unknown command.` parser could not identify the command
- `Working:` async operation started

Responses should mention the target object.

Good:

```txt
Success: branch auth-refactor created.
```

Bad:

```txt
Done.
```

## Command Behavior Table

| Input | Expected behavior | Expected response |
| --- | --- | --- |
| `new branch login-fix` | Create a new branch after validating it does not exist | `Success: branch login-fix created.` |
| `new branch login-fix` when branch already exists | Do not run Git command | `Error: branch login-fix already exists.` |
| `new branch` | Do not run Git command | `Error: missing branch name.` |
| `new brach login-fix` | Do not run Git command, suggest closest command | `Unknown command. Did you mean: new branch?` |
| `switch branch main` | Switch to existing branch | `Success: switched to branch main.` |
| `switch branch missing-branch` | Do not run Git command | `Error: branch missing-branch does not exist.` |
| `delete branch old-ui` | Ask for confirmation before deleting | `Confirm: delete branch old-ui? y/n` |
| confirmation `y` for delete branch | Delete branch | `Success: branch old-ui deleted.` |
| confirmation `n` for delete branch | Do not delete branch | `Cancelled: branch old-ui was not deleted.` |
| `undo commit` | Ask for confirmation before soft reset | `Confirm: undo last commit with soft reset? y/n` |
| confirmation `y` for undo commit | Run soft reset | `Success: last commit undone. Changes are still in your working tree.` |
| confirmation `n` for undo commit | Do not run reset | `Cancelled: last commit was not changed.` |
| `show status` | Show current Git status | `Success: repository status loaded.` plus status lines |
| `show log` | Show compact commit log | `Success: commit log loaded.` plus log lines |
| `show branch` | Show all local branches in the current terminal | `Success: branches loaded.` plus branch list |
| `show branches` | Show all local branches | `Success: branches loaded.` plus branch lines |
| `push changes` | Push current branch | `Success: pushed branch <branch-name>.` |
| `push changes` with Git failure | Print failure reason | `Error: push failed. <reason>` |
| `compare branch main login-fix` | Compare two existing branches | `Success: comparison loaded for main..login-fix.` plus diff summary |
| `compare branch main missing` | Do not run Git command | `Error: branch missing does not exist.` |
| `show conflicts` | Read conflict candidates from repo state | `Success: conflict status loaded.` or `Success: no conflicts found.` |
| `git visualize` | Build/update persisted graph database and open interactive graph panel | `Success: repository graph opened for branch <branch-name>.` |
| `summarize src/auth.ts` | Run lazy summary worker for file | `Working: summarizing src/auth.ts...` then `Success: summary ready for src/auth.ts.` |
| `summarize missing.ts` | Do not run worker | `Error: file missing.ts is not tracked in this repository.` |
| `export markdown src/auth.ts src/user.ts` | Generate markdown context file | `Working: exporting markdown context...` then `Success: markdown context exported.` |
| `trace conflict src/auth.ts` | Run graph traversal, no LLM | `Success: conflict trace loaded for src/auth.ts.` |

## Detailed Command Flows

### `new branch {name}`

Input:

```txt
new branch auth-refactor
```

Validation:

- command must match `new branch`
- branch name must be present
- branch must not already exist in `struct_repo.branches`

Execution:

```txt
git checkout -b auth-refactor
```

Success response:

```txt
Success: branch auth-refactor created.
```

Already exists response:

```txt
Error: branch auth-refactor already exists.
```

Missing name response:

```txt
Error: missing branch name.
```

Git failure response:

```txt
Error: branch auth-refactor was not created. <git failure reason>
```

Post-success behavior:

- update `currentBranch`
- update `branches`
- refresh `repo_index`
- increment `struct_repo.version`

### `switch branch {name}`

Input:

```txt
switch branch main
```

Validation:

- command must match `switch branch`
- branch name must be present
- branch must exist in `struct_repo.branches`

Execution:

```txt
git checkout main
```

Success response:

```txt
Success: switched to branch main.
```

Missing branch response:

```txt
Error: branch main does not exist.
```

Post-success behavior:

- update `currentBranch`
- refresh `repo_index`
- increment `struct_repo.version`

### `delete branch {name}`

Input:

```txt
delete branch old-ui
```

Validation:

- command must match `delete branch`
- branch name must be present
- branch must exist
- branch must not be the current branch

Confirmation response:

```txt
Confirm: delete branch old-ui? y/n
```

If user enters:

```txt
y
```

Execution:

```txt
git branch -d old-ui
```

Success response:

```txt
Success: branch old-ui deleted.
```

If user enters:

```txt
n
```

Response:

```txt
Cancelled: branch old-ui was not deleted.
```

Current branch response:

```txt
Error: cannot delete the current branch old-ui.
```

Git failure response:

```txt
Error: branch old-ui was not deleted. <git failure reason>
```

### `undo commit`

Input:

```txt
undo commit
```

Confirmation response:

```txt
Confirm: undo last commit with soft reset? y/n
```

If user enters:

```txt
y
```

Execution:

```txt
git reset --soft HEAD~1
```

Success response:

```txt
Success: last commit undone. Changes are still in your working tree.
```

If user enters:

```txt
n
```

Response:

```txt
Cancelled: last commit was not changed.
```

Git failure response:

```txt
Error: last commit was not undone. <git failure reason>
```

### `show status`

Input:

```txt
show status
```

Execution:

```txt
git status --short
```

Clean response:

```txt
Success: repository is clean.
```

Dirty response:

```txt
Success: repository status loaded.
M src/core/parser.ts
?? src/core/newFile.ts
```

Post-success behavior:

- refresh `repo_index`
- increment `struct_repo.version` only if state changed

### `show log`

Input:

```txt
show log
```

Execution:

```txt
git log --oneline
```

Success response:

```txt
Success: commit log loaded.
2687fee Initial repository intelligence system
```

Git failure response:

```txt
Error: commit log could not be loaded. <git failure reason>
```

### `show branches`

Input:

```txt
show branches
```

Execution:

```txt
git branch --list
```

Success response:

```txt
Success: branches loaded.
* main
  feature-login
```

Git failure response:

```txt
Error: could not list branches. <git failure reason>
```

### `compare branch {a} {b}`

Input:

```txt
compare branch main login-fix
```

Validation:

- both branches must exist

Execution:

```txt
git diff main..login-fix
```

Success response:

```txt
Success: comparison loaded for main..login-fix.
```

Missing branch response:

```txt
Error: branch login-fix does not exist.
```

### `git visualize`

Input:

```txt
git visualize
```

Validation:

- command must match exactly
- `repo_index` must exist
- if `repo_topology` is still building, wait on topology gate

Execution:

```txt
graphEngine.visualize()
persist recent/graph_struct.json
open graph panel
```

Success response:

```txt
Success: repository graph opened for branch main.
```

If topology is still building:

```txt
Working: repository topology is still building...
Success: repository graph opened for branch main.
```

If graph build fails:

```txt
Error: repository graph could not be opened. <reason>
```

Panel behavior:

- open graph panel
- show current branch name at the top with interactive breadcrumbs (e.g. `Repository > Cluster > File`)
- **Three Zoom Levels**:
  - **Level 1 (Cluster)**: Nodes represent clusters. Label = `cluster name (file count)`.
  - **Level 2 (Folder)**: Double-click a cluster to expand it. Shows folder pseudo-nodes and files. Other clusters remain collapsed.
  - **Level 3 (File)**: Double-click a file to focus. Shows the file and its one-hop neighbors.
- **Deterministic Layout**: Nodes are constrained to the Y-axis based on their `depth_rank`. `node.fy = depth_rank * scale`.
- **Edge Visual Distinction**:
  - **Hierarchy edges**: color: `#3a3a3a`, width: `1px`, opacity: `0.4`.
  - **Dependency edges**: color matches target state (`clean`: `#4a9eff`, `modified`: `#f5a623`, `conflict`: `#e74c3c`), width: `1.5px`, opacity: `0.85` (dims to `0.1` for non-adjacent nodes in File focus).
- folder pseudo nodes act as leaders; selecting a folder selects the files inside that folder recursively
- keep the visual style close to the reference mosaic but darker, less glowing, higher contrast, and with nodes clearly separated
- make the graph area and summary panel flexible so the user can focus on either the graph or the generated summary
- modified nodes appear amber/yellow and show a status halo
- conflict/error nodes appear red or error-colored
- clean nodes appear neutral/healthy
- ignored/untracked nodes appear gray
- persist the graph structure in `recent/graph_struct.json`
- clicking a node selects or focuses it; clicking `Analyze` generates the selected file/folder summary in the bottom panel
- bottom toolbar includes `Select`, `Generate Summary PDF`, and `Generate Markdown File`
- clicking `Select` enters selection mode, changes cursor behavior for node picking, and changes the button to `Cancel`
- clicking `Cancel` exits selection mode and clears the selection
- selected nodes are used as the file set for summary PDF or markdown generation
- generated PDF/markdown should use the summary currently shown in the bottom panel when available
- **Esc Key**: Zooms out to the previous level (File -> Folder -> Cluster).

Dependency detection must be generalized. It should use ES imports/exports when present, but also detect CommonJS `require`, dynamic `import()`, HTML `script/link` references, CSS `@import`, literal references to known repository files, and local symbol usage where one file declares a named function/class/const/interface and another file references that symbol.

Summary generation may run multiple model roles when keys are configured. Supported environment key names are:

```txt
GROQ_API_KEY
GROQ_API_KEY_1
GROQ_API_KEY_2
GROQ_API_KEY_3
GROQ_API_KEY_4
GROQ_API_KEY_5
GROQAPIKEY1
GROQAPIKEY2
GROQAPIKEY3
GROQAPIKEY4
GROQAPIKEY5
groqapikey1
groqapikey2
groqapikey3
groqapikey4
groqapikey5
```

Each configured role appends a different analysis section using a 5-model parallel chain:
- **Phase 1 (Parallel)**: 4 models generate JSON for Overview, Structure, Risk, and Dependencies.
- **Phase 2 (Sequential)**: 1 Synthesizer model compiles the JSON data into a coherent developer summary.

If no model key is available, the system must still generate a local structured summary.

Panel should not open for normal commands such as `new branch` or `show status`.

### `summarize {file}`

Input:

```txt
summarize src/auth.ts
```

Validation:

- file must exist in `repo_index`

Cache behavior:

- if cache hit and `cache_valid` is true, return cached summary
- if cache miss or stale, spawn lazy worker

Initial response:

```txt
Working: summarizing src/auth.ts...
```

Success response:

```txt
Success: summary ready for src/auth.ts.
```

Cached response:

```txt
Success: cached summary loaded for src/auth.ts.
```

Missing file response:

```txt
Error: file src/auth.ts is not tracked in this repository.
```

### `export markdown {files...}`

Input:

```txt
export markdown src/auth.ts src/user.ts
```

Validation:

- every file must exist in `repo_index`

Execution:

- generate structured markdown context
- save markdown output to configured export location
- use cache where valid

Initial response:

```txt
Working: exporting markdown context...
```

Success response:

```txt
Success: markdown context exported.
```

Missing file response:

```txt
Error: file src/user.ts is not tracked in this repository.
```

## Unknown Command Behavior

Input:

```txt
new brach login-fix
```

Expected response:

```txt
Unknown command. Did you mean: new branch?
```

No Git command runs.

Input:

```txt
make magic happen
```

Expected response:

```txt
Unknown command.
Available commands:
- new branch {name}
- delete branch {name}
- switch branch {name}
- undo commit
- show status
- show branches
- show log
- show conflicts
- push changes
- compare branch {a} {b}
- git visualize
- summarize {file}
- export markdown {files...}
- trace conflict {file}
```

No Git command runs.

## Confirmation Behavior

Destructive commands must always pause before execution.

Destructive commands include:

- `delete branch`
- `undo commit`
- future `force push`
- future `hard reset`
- future `clean files`

Confirmation format:

```txt
Confirm: <plain-language action>? y/n
```

Only lowercase or uppercase `y` should execute.

Anything else cancels.

Example:

```txt
Confirm: delete branch old-ui? y/n
n
Cancelled: branch old-ui was not deleted.
```

## Panel Behavior

Only commands that need visual output should open a panel.

Panel-opening commands:

- `git visualize`
- future architecture map commands
- future dependency graph commands

Non-panel commands:

- `new branch`
- `switch branch`
- `delete branch`
- `show status`
- `show branches`
- `show log`
- `push changes`

Graph panel default:

- current branch only
- no full repository explosion by default
- nodes are files/modules
- edges are imports/dependencies
- graph uses `graph_struct`
- graph never reparses files directly

Node click behavior:

| User action | Expected behavior |
| --- | --- |
| click one node | show node menu |
| click one node outside selection mode | focus the file/folder selection |
| click `Select` | enter node selection mode |
| click file node in selection mode | add/remove file from selected export set |
| click folder pseudo node in selection mode | add/remove every file under that folder recursively |
| click `Analyze` | generate a combined summary for selected files/folders in the bottom panel |
| click `Cancel` | leave selection mode and clear selected files |
| click `Generate Summary PDF` | write the generated summary PDF to `recent/` |
| click `Generate Markdown File` | write the generated markdown context to `recent/` |
| click red node and choose `Trace conflict` | show dependency impact chain |
| press Escape | restore full current-branch graph |

## State Update Expectations

After every successful Git command:

- refresh `repo_index`
- update `currentBranch` if needed
- update `branches` if needed
- increment `struct_repo.version`

After file save:

- wait 300ms debounce
- set `cache_valid: false`
- append pending graph diff
- increment `struct_repo.version`

After lazy worker success:

- write cache result
- set `cache_valid: true` for computed files
- increment `struct_repo.version`

After graph visualize:

- if `struct_repo.version` is unchanged, reuse graph
- if changed, consume pending diffs
- update changed nodes/edges only
- open or refresh graph panel

## Error Behavior

Errors should be clear and non-destructive.

The system should never silently run a guessed command.

Examples:

```txt
Error: branch payment-fix already exists.
```

```txt
Error: file src/payment.ts is not tracked in this repository.
```

```txt
Error: repository graph could not be opened. repo_topology is unavailable.
```

```txt
Error: push failed. Remote rejected the push.
```

## Minimum Phase 1 Acceptance Behavior

Phase 1 user behavior is acceptable when these examples work:

```txt
new branch test-branch
Success: branch test-branch created.
```

```txt
new branch test-branch
Error: branch test-branch already exists.
```

```txt
new brach test-branch
Unknown command. Did you mean: new branch?
```

```txt
switch branch main
Success: switched to branch main.
```

```txt
show status
Success: repository status loaded.
<status output>
```

```txt
git visualize
Success: repository graph opened for branch main.
```

The visual graph panel must open only for `git visualize`, not for every command.
