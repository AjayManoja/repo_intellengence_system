# System Architecture & Design Document: AI-Native Repository Intelligence

## 1. Problem Statement
Modern software repositories are overwhelmingly complex. Developers waste time grappling with Git syntax, tracking file dependencies, understanding system architectures, and managing fragmented debugging contexts. Traditional tools expose this complexity instead of simplifying it. Furthermore, AI assistants struggle to provide accurate help because they lack a structured, holistic understanding of the repository.

## 2. Solution Overview
We are building an AI-native repository intelligence system integrated directly into the developer's environment. This system acts as a smart abstraction layer that translates simple user intentions into executable operations. It visualizes the repository structure, manages Git workflows, and provides LLMs with up-to-date, structured context about the codebase.

---

## 3. Core System Components

To emulate a professional software engineering architecture, the system is decoupled into specific, specialized modules:

### 3.1. Command Parser & Controller (The Entry Point)
This module acts as the frontline for all user interactions.
- **Responsibility:** Interprets natural language or simplified commands (e.g., `new branch auth-refactor`).
- **Behavior:** 
  - Validates the command against a known registry.
  - If a typo is detected (e.g., `new brach`), it halts execution and returns a helpful error message: *"Did you mean 'new branch'?"*
  - If valid, it routes the sanitized command to the Controller, which dispatches it to the appropriate downstream module (like the Git Module).

### 3.2. Repo Structure Manager (`struct_repo`)
This is the **Main Gate for the AI Model**. Before any command reaches the Git Module or Graph Engine, this core structure is constructed.
- **Responsibility:** Maintains a plain, organized representation of the entire repository.
- **Behavior:**
  - Tracks all Git files, repository metadata, and directory hierarchies.
  - Arranges data in an optimized order that allows the LLM and other modules to easily parse the codebase state.
  - **State Tracking:** Every file entry includes a boolean flag: `isModified`.

### 3.3. Lazy Worker & Cache Engine
To ensure high performance and low resource consumption, the system uses a strict lazy-evaluation model.
- **Responsibility:** Executes heavy computations only when absolutely necessary and caches the results.
- **Behavior:**
  - **No Pre-computation of heavy tasks:** Workers sit idle until a specific command invokes them.
  - **Caching:** Once a task (e.g., a complex dependency summary) is computed, the result is stored in a `recent` folder. The system retains the Top-K most recent computations.
  - **Validation (`isModified` check):** Before processing a request for a file/module, the system checks the `isModified` boolean in `struct_repo`. 
    - If `isModified == true`: The worker re-computes the result, updates the cache, and resets the flag.
    - If `isModified == false`: The worker immediately returns the cached result from the `recent` folder.

### 3.4. Git Operations Module
Abstracts away standard Git syntax.
- **Responsibility:** Translates the parsed intentions into actual Git commands.
- **Behavior:**
  - *Always* references `struct_repo` to understand the current state of the files before executing operations.
  - Handles branching, merging, committing, and conflict detection under the hood.

### 3.5. Graph & Diff Engine
Generates the real-time visual representation of the repository.
- **Responsibility:** Maps dependencies, file relationships, and architectural flows.
- **Behavior:**
  - Maintains its own internal structure: `graph_structure` (which holds pre-computed diffs).
  - To build the visual graph, the engine measures the difference between the main `struct_repo` and its internal `graph_structure_repo`.
  - Uses these diffs to efficiently update nodes (e.g., coloring a node yellow for modified, red for conflict).

---

## 4. Expected System Workflows

### 4.1. Standard Command Execution Flow
1. **Input:** User types a simple command (`new branch feature-x`).
2. **Parsing:** The Parser checks the command.
   - *Typo?* Return correction prompt.
3. **Structure Prep:** System ensures `struct_repo` is up to date.
4. **Dispatch:** Controller sends the valid command to the Git Module.
5. **Execution:** Git Module reads `struct_repo`, performs the underlying Git action (`git checkout -b feature-x`), and updates `struct_repo` state.

### 4.2. Lazy Computation & Caching Flow
1. **Input:** User or LLM requests context for `AuthService.ts`.
2. **Check State:** The Lazy Worker checks `struct_repo` for `AuthService.ts`.
3. **Evaluate `isModified`:**
   - **True:** Worker runs AST parsing/dependency analysis, stores result in the `recent/` cache, marks `isModified = false`, and returns the context.
   - **False:** Worker skips computation and serves the existing data directly from the `recent/` cache.

### 4.3. Graph Rendering Flow
1. **Trigger:** A file is modified or a branch is changed.
2. **State Update:** `struct_repo` updates the file's `isModified` flag to `true`.
3. **Diff Measurement:** Graph Engine compares `struct_repo` against `graph_structure_repo`.
4. **Render:** The Graph Engine generates a targeted update (e.g., turning the modified node yellow) without rebuilding the entire architecture map.

---

## 5. Summary of Key Data Structures

```typescript
// Core conceptual interface for the Repo Structure
interface StructRepo {
  repositoryName: string;
  currentBranch: string;
  files: Record<string, TrackedFile>;
}

interface TrackedFile {
  filepath: string;
  isModified: boolean;  // Crucial for Lazy Worker caching
  gitStatus: "tracked" | "untracked" | "ignored";
  dependencies: string[];
}

// Graph Engine specific structure
interface GraphStructureRepo {
  nodes: GraphNode[];
  edges: GraphEdge[];
  lastCalculatedDiffs: any; // Pre-computed diff states
}
```

This architecture ensures maximum responsiveness, protects the user from command-line friction, and guarantees that the AI always receives structurally sound, up-to-date repository context.
