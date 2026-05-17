# Repo Intelligence System

An AI-native repository intelligence system designed to provide deep structural understanding and intelligent analysis of complex codebases. This system visualizes repository topology, manages Git workflows, and uses a multi-model parallel processing pipeline to generate high-quality technical summaries.

## 🚀 Key Features

- **3-Tier Zoomable Graph Navigation**: Visualize your repository at three distinct levels:
  - **Cluster View**: High-level architectural groupings.
  - **Folder View**: Drill-down into specific directory structures.
  - **File View**: Focus on one-hop dependency neighborhoods.
- **Parallel Multi-Model Summarization & Handoff**: A specialized 5-model processing chain built using Groq:
  - **Phase 1 (Parallel)**: Four independent `llama-3.1-8b-instant` analysts parsing Overview, Code Structure, Risk & Error, and Dependency context respectively.
  - **Strict Output Contracts**: Enforces role-specific structural JSON schemas for absolute data accuracy.
  - **Phase 2 (Sequential)**: A professional Technical Writer/Synthesizer compiles the four analysis payloads into a two-section technical summary: a human-oriented Developer Summary and a paste-ready, dense "LLM Handoff Block" (ideal for Claude, GPT, or Gemini context injection).
- **Decoupled Cache Architecture**: Advanced state tracking using `git_status` and `cache_valid` flags to ensure high performance and data integrity.
- **AI-Native Command Surface**: Execute Git operations and intelligence tasks through a simplified, intention-driven command interface.
- **D3-Driven Visualizations**: High-performance graph rendering with depth-rank based layouts for clear repository topology.

## 🛠️ Prerequisites

Before you begin, ensure you have the following installed:
- [Node.js](https://nodejs.org/) (v16 or higher)
- [Git](https://git-scm.com/)
- [VS Code](https://code.visualstudio.com/) (to run as an extension)

## 📦 Installation & Setup

1. **Clone the Repository**
   ```bash
   git clone https://github.com/AjayManoja/repo_intellengence_system.git
   cd repo_intellengence_system
   ```

2. **Install Dependencies**
   ```bash
   npm install
   ```

3. **Configure Environment Variables**
   Create a `.env` file in the root directory and add your Groq API keys. You can use up to 5 keys for parallel processing:
   ```env
   GROQ_API_KEY_1=your_key_here
   GROQ_API_KEY_2=your_key_here
   GROQ_API_KEY_3=your_key_here
   GROQ_API_KEY_4=your_key_here
   GROQ_API_KEY_5=your_key_here
   ```

## 🔨 Build & Run

### For VS Code Extension:
1. **Compile the Code**:
   ```bash
   npm run build
   ```
2. **Launch Extension**:
   - Open the project in VS Code.
   - Press `F5` to open a new "Extension Development Host" window.
   - Use `Ctrl+Shift+P` (or `Cmd+Shift+P`) and search for **"Repo: Open Command Input"**.

### For CLI/Standalone Mode:
```bash
npm start
```

## 📖 Available Commands

Within the system's command input, you can use:
- `git visualize`: Opens the interactive 3D graph panel.
- `summarize <file_path>`: Generates a multi-role summary of the file.
- `new branch <name>`: Safely creates a new Git branch.
- `switch branch <name>`: Switches the current repository branch.
- `show status`: Displays current repository status.
- `export markdown <files>`: Generates structured context files for LLMs.

## 🏗️ Architecture

The system follows a strict decoupled architecture:
- **`LazyWorker`**: Handles all heavy computations (summaries, topology) in the background.
- **`GraphEngine`**: Manages the D3 state and incremental diffs for the UI.
- **`StructRepo`**: The single source of truth for repository state.
- **`Summarizer`**: Orchestrates the multi-model LLM pipeline.

## 📄 License

This project is licensed under the MIT License.
