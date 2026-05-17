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
  - **State Tracking:** Decoupled flags `git_status` (tracks repository changes) and `cache_valid` (tracks cache freshness).

### 3.3. Lazy Worker & Cache Engine
To ensure high performance and low resource consumption, the system uses a strict lazy-evaluation model.
- **Responsibility:** Executes heavy computations only when absolutely necessary and caches the results.
- **Behavior:**
  - **No Pre-computation of heavy tasks:** Workers sit idle until a specific command invokes them.
  - **Caching:** Once a task (e.g., a complex dependency summary) is computed, the result is stored in a `recent` folder. The system retains the Top-K most recent computations.
  - **Validation (`cache_valid` check):** Before processing a request for a file/module, the system checks the `cache_valid` boolean in `struct_repo`. 
    - If `cache_valid == false`: The worker re-computes the result, updates the cache, and resets the flag to true.
    - If `cache_valid == true`: The worker immediately returns the cached result from the `recent` folder.

### 3.4. Git Operations Module
Abstracts away standard Git syntax.
- **Responsibility:** Translates the parsed intentions into actual Git commands.
- **Behavior:**
  - *Always* references `struct_repo` to understand the current state of the files before executing operations.
  - Handles branching, merging, committing, and conflict detection under the hood.

### 3.5. Graph & Diff Engine (D3 + 3-Level Zoom)
Generates the real-time visual representation of the repository.
- **Responsibility:** Maps dependencies, file relationships, and architectural flows with depth-rank based layout.
- **Behavior:**
  - **3-Level Zoom Architecture:** Switches between Cluster (high-level), Folder (mid-level), and File (one-hop focus) views.
  - **Deterministic Layout:** Uses `depth_rank` as the Y-axis to visualize the repository hierarchy and dependency flow.
  - Maintains its own internal structure: `graph_structure` (which holds pre-computed diffs).
  - To build the visual graph, the engine measures the difference between the main `struct_repo` and its internal `graph_structure_repo`.
  - Uses these diffs to efficiently update nodes (e.g., coloring a node amber for modified, red for conflict).

### 3.6. Parallel Groq Summarizer & Handoff Chain
An intelligent orchestrator for high-quality structured summaries and downstream LLM contexts.
- **Responsibility:** Generates multi-role analysis using a 5-model parallel/sequential chain.
- **Behavior:**
  - **Phase 1 Analysts (Parallel):** Four independent `llama-3.1-8b-instant` models run in parallel to analyze Overview, Code Structure, Risk & Error, and Dependencies. Each model is bound by a strict, custom JSON schema contract ensuring structured precision.
  - **Phase 2 Synthesizer (Sequential):** A fifth model compiles the combined JSON findings to produce two distinct sections:
    - **Developer Summary**: Plain-prose, symbol-accurate review guide for humans.
    - **LLM Handoff Block**: Compact, paste-ready context snippet to quickly seed Claude or ChatGPT conversations with exact dependency, API, and status variables.
  - Supports dynamic API keys (`GROQ_API_KEY_1` to `5`) and model-specific configurations.

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
3. **Evaluate `cache_valid`:**
   - **False:** Worker runs AST parsing/dependency analysis or 5-model Groq chain, stores result in the `recent/` cache, marks `cache_valid = true`, and returns the context.
   - **True:** Worker skips computation and serves the existing data directly from the `recent/` cache.

### 4.3. Graph Rendering Flow
1. **Trigger:** A file is modified or a branch is changed.
2. **State Update:** `struct_repo` updates the file's `cache_valid` flag to `false`.
3. **Diff Measurement:** Graph Engine compares `struct_repo` against `graph_struct`.
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
  path: string;
  cache_valid: boolean;  // Decoupled from Git status
  git_status: "M" | "A" | "D" | "?" | "clean";
  dependencies: string[];
}

// Graph Engine specific structure
interface GraphStruct {
  nodes: Record<string, GraphNode>;
  edges: GraphEdge[];
  built_from_version: number;
}
```

This architecture ensures maximum responsiveness, protects the user from command-line friction, and guarantees that the AI always receives structurally sound, up-to-date repository context.
