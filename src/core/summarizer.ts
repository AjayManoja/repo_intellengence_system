import fs from 'fs/promises';
import path from 'path';
import { StructRepo } from './structRepo';
import { FileSummary } from '../types';

interface GroqChatResponse {
    choices?: Array<{
        message?: {
            content?: string;
        };
    }>;
}

interface SummaryRole {
    name: string;
    apiKey?: string;
    model: string;
    prompt: string;
}

export class Summarizer {
    constructor(private readonly structRepo: StructRepo) {}

    public async summarizeFile(filePath: string): Promise<FileSummary> {
        const file = this.structRepo.getFile(filePath);
        if (!file) {
            throw new Error(`file ${filePath} is not tracked in this repository.`);
        }

        const source = await this.readSource(filePath);
        const localSummary = this.buildLocalSummary(filePath, source);
        const roleSummaries = await this.tryGroqRoleSummaries(filePath, source, localSummary);

        return {
            file: filePath,
            branch: this.structRepo.currentBranch,
            provider: roleSummaries.length > 1 ? 'multi-groq' : roleSummaries.length === 1 ? 'groq' : 'local',
            summary: roleSummaries.length
                ? [localSummary, '', '---', '', '# Multi-model analysis', '', ...roleSummaries].join('\n')
                : localSummary
        };
    }

    private async readSource(filePath: string): Promise<string> {
        const absolutePath = path.join(this.structRepo.repositoryRoot, filePath);
        return fs.readFile(absolutePath, 'utf8');
    }

    private buildLocalSummary(filePath: string, source: string): string {
        const file = this.structRepo.getFile(filePath);
        const lines = source.split(/\r?\n/);
        const nonEmptyLines = lines.filter((line) => line.trim()).length;
        const imports = file?.imports.length ? file.imports.join(', ') : 'none detected';
        const exports = file?.exports.length ? file.exports.join(', ') : 'none detected';
        const references = file?.references.length ? file.references.join(', ') : 'none detected';
        const symbols = file?.declared_symbols.length ? file.declared_symbols.join(', ') : 'none detected';
        const firstDeclarations = this.extractDeclarations(source);

        return [
            `# ${filePath}`,
            '',
            `Branch: ${this.structRepo.currentBranch}`,
            `Git status: ${file?.git_status ?? 'unknown'}`,
            `Lines: ${lines.length} total, ${nonEmptyLines} non-empty`,
            `Imports: ${imports}`,
            `Exports: ${exports}`,
            `References: ${references}`,
            `Declared symbols: ${symbols}`,
            `Cluster: ${file?.cluster ?? 'unknown'}`,
            firstDeclarations.length ? `Main declarations: ${firstDeclarations.join(', ')}` : 'Main declarations: none detected',
            '',
            'Summary:',
            this.inferPurpose(filePath, firstDeclarations)
        ].join('\n');
    }

    private extractDeclarations(source: string): string[] {
        const declarations = new Set<string>();
        const patterns = [
            /\bexport\s+class\s+([A-Za-z0-9_]+)/g,
            /\bclass\s+([A-Za-z0-9_]+)/g,
            /\bexport\s+function\s+([A-Za-z0-9_]+)/g,
            /\bfunction\s+([A-Za-z0-9_]+)/g,
            /\bexport\s+const\s+([A-Za-z0-9_]+)/g,
            /\bconst\s+([A-Za-z0-9_]+)\s*=/g,
            /\binterface\s+([A-Za-z0-9_]+)/g,
            /\btype\s+([A-Za-z0-9_]+)/g
        ];

        for (const pattern of patterns) {
            for (const match of source.matchAll(pattern)) {
                if (match[1]) {
                    declarations.add(match[1]);
                }
                if (declarations.size >= 8) {
                    return [...declarations];
                }
            }
        }

        return [...declarations];
    }

    private inferPurpose(filePath: string, declarations: string[]): string {
        if (declarations.length > 0) {
            return `This file appears to define ${declarations.slice(0, 4).join(', ')} for the ${filePath} module.`;
        }

        return `This file is part of the repository module at ${filePath}. No exported symbols were detected locally.`;
    }

    private async tryGroqRoleSummaries(filePath: string, source: string, localSummary: string): Promise<string[]> {
        const keys = this.getApiKeys();
        if (!keys[0] && !keys[1]) {
            return [];
        }

        const defaultModel = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';
        const trimmedSource = source.length > 18000 ? `${source.slice(0, 18000)}\n\n[truncated]` : source;
        
        const fileData = this.structRepo.getFile(filePath);
        const git_status = fileData?.git_status ?? 'unknown';
        const cluster = fileData?.cluster ?? 'unknown';
        const references_list = fileData?.references?.length ? fileData.references.join(', ') : 'none';

        const roles = [
            {
                name: 'Overview Analyst',
                model: 'llama-3.1-8b-instant',
                prompt: `You are a code overview analyst. You receive source code for one file.
You must return ONLY a JSON object. No prose. No markdown. No explanation outside the JSON.

Required schema:
{
  "file": "<filename>",
  "purpose": "<one sentence: what this file does and why it exists>",
  "layer": "<one of: ui | controller | service | model | util | config | test | observer | unknown>",
  "entry_points": ["<function or class name that external code calls into>"],
  "public_api": [
    { "name": "<symbol name>", "type": "<function|class|const|interface>", "summary": "<one line>" }
  ],
  "state_owned": ["<any global or module-level state this file owns>"],
  "primary_consumers": ["<other files or systems that use this file, from reference hints in the code>"]
}

If a field has no data, return an empty array or empty string. Never omit a field.`,
                userPrompt: `File: ${filePath}\nBranch: ${this.structRepo.currentBranch}\nGit status: ${git_status}\n\n<source>\n${trimmedSource}\n</source>`,
                apiKey: keys[1] ?? keys[0]
            },
            {
                name: 'Code Structure Analyst',
                model: 'llama-3.1-8b-instant',
                prompt: `You are a code structure analyst. You receive source code for one file.
You must return ONLY a JSON object. No prose. No markdown. No explanation outside the JSON.

Required schema:
{
  "file": "<filename>",
  "symbols": [
    {
      "name": "<symbol name>",
      "kind": "<function|class|const|interface|type|enum>",
      "exported": true | false,
      "async": true | false,
      "params": ["<param: type>"],
      "returns": "<return type or void>",
      "calls": ["<other symbol names this calls, local or imported>"],
      "complexity": "<low|medium|high>",
      "lines": "<approximate line range, e.g. 12-45>"
    }
  ],
  "imports": [
    { "from": "<module path>", "names": ["<imported names>"] }
  ],
  "exports": ["<exported symbol names>"],
  "side_effects_at_load": ["<anything that runs immediately when the file is imported, not inside a function>"]
}

complexity guide:
- low: simple reads, returns, no branching
- medium: 1-2 conditions, loops, or callbacks
- high: nested branches, multiple async paths, mutation of shared state

If a field has no data, return an empty array. Never omit a field.`,
                userPrompt: `File: ${filePath}\n\n<source>\n${trimmedSource}\n</source>`,
                apiKey: keys[2] ?? keys[0]
            },
            {
                name: 'Risk & Error Analyst',
                model: 'llama-3.1-8b-instant',
                prompt: `You are a risk and error review analyst. You receive source code for one file.
You must return ONLY a JSON object. No prose. No markdown. No explanation outside the JSON.

Required schema:
{
  "file": "<filename>",
  "unhandled_paths": [
    { "location": "<function name or line hint>", "description": "<what condition is not handled>" }
  ],
  "silent_failures": [
    { "location": "<function name or line hint>", "description": "<where errors are swallowed or ignored>" }
  ],
  "unsafe_assumptions": [
    { "location": "<function name or line hint>", "description": "<assumption that will break if input or state changes>" }
  ],
  "mutation_risks": [
    { "location": "<function name or line hint>", "description": "<shared state or object mutated in a non-obvious way>" }
  ],
  "async_risks": [
    { "location": "<function name or line hint>", "description": "<race condition, missing await, unhandled promise>" }
  ],
  "todos_fixmes": [
    { "location": "<line hint>", "text": "<exact TODO or FIXME comment text>" }
  ],
  "overall_risk": "<low|medium|high>",
  "risk_summary": "<one sentence: the single biggest risk in this file>"
}

If a category has no findings, return an empty array. Never omit a field.
Be specific. Vague entries like 'may have edge cases' are not acceptable.`,
                userPrompt: `File: ${filePath}\nGit status: ${git_status}\n\n<source>\n${trimmedSource}\n</source>`,
                apiKey: keys[3] ?? keys[0]
            },
            {
                name: 'Dependency & API Context Analyst',
                model: 'llama-3.1-8b-instant',
                prompt: `You are a dependency and API context analyst. You receive source code and known repository references for one file.
You must return ONLY a JSON object. No prose. No markdown. No explanation outside the JSON.

Required schema:
{
  "file": "<filename>",
  "depends_on": [
    { "file": "<path or module>", "reason": "<what it uses from there>", "critical": true | false }
  ],
  "depended_on_by": [
    { "file": "<path>", "reason": "<what that file uses from here>" }
  ],
  "external_apis_called": [
    { "name": "<API or service name>", "method": "<HTTP method or call type>", "url_or_endpoint": "<if visible in code>" }
  ],
  "events_emitted": ["<event names this file dispatches or emits>"],
  "events_consumed": ["<event names this file listens to>"],
  "env_vars_read": ["<environment variable names accessed>"],
  "cluster": "<which feature cluster this file belongs to, inferred from path and symbols>",
  "depth_rank": <integer: 0 = leaf/util, higher = closer to entry point>,
  "coupling_notes": "<one sentence: describe the tightest or most fragile coupling in this file>"
}

critical: true means the dependency is on the hot path or removal would break core behavior.
If a field has no data, return an empty array or empty string. Never omit a field.`,
                userPrompt: `File: ${filePath}\nKnown references from repo topology: ${references_list}\nKnown cluster: ${cluster}\n\n<source>\n${trimmedSource}\n</source>`,
                apiKey: keys[4] ?? keys[0]
            }
        ];

        const jsonResults = await Promise.all(
            roles.map(async (role) => {
                const result = await this.callGroqJSONRole(role, role.userPrompt);
                return { name: role.name, data: result };
            })
        );

        const synthesizerKey = keys[5] ?? keys[0];
        const synthesizerPrompt = `You are a senior engineering context synthesizer.
You receive four structured JSON analysis blobs for one or more source files.
Your job is to produce two sections of output, separated by the marker ---LLM_HANDOFF---.

SECTION 1 — Developer Summary
Write this for a human developer who is about to debug or review this file.
Use plain prose. Be direct. Lead with the most important finding.
Structure it as:
  ## [filename]
  **What it does:** [one sentence]
  **Key risks:** [bullet list, most critical first, specific not vague]
  **Hot symbols:** [the 2-3 functions/classes a debugger should look at first]
  **Fragile dependencies:** [what it relies on that could break it]
  **Suggested action:** [one concrete thing the developer should check or fix]

SECTION 2 — LLM Handoff Block (after the ---LLM_HANDOFF--- marker)
Write this as a compact, paste-ready context block.
A developer will copy this and paste it at the top of a new Claude or GPT conversation when debugging.
It must be dense, factual, and symbol-level accurate. No filler phrases.
Format exactly as:

=== REPO CONTEXT: [filename] ===
Purpose: [one line]
Layer: [layer value]
Public API: [comma-separated symbol names and types]
Depends on (critical): [only critical:true deps]
Exposes to: [depended_on_by files]
State owned: [module-level state]
Async risks: [from risk analysis, or "none"]
Unhandled paths: [from risk analysis, or "none"]
Known TODOs: [or "none"]
Cluster: [cluster name]
Git status: [M/A/D/clean]
=== END CONTEXT ===

If multiple files are being synthesized, produce one Developer Summary and one LLM Handoff Block per file,
then add a final cross-file section:

## Cross-file risk ranking
List the file pairs most likely to cause bugs when changed together, ranked by coupling severity.
Format: [file A] ↔ [file B] — [reason in one sentence]`;
        
        let userPrompt = `Analyze the following files. Each file has four JSON analysis blobs.\n\n--- FILE: ${filePath} ---\n\n`;
        for (const res of jsonResults) {
            let roleTitle = 'OVERVIEW';
            if (res.name.includes('Structure')) roleTitle = 'STRUCTURE';
            if (res.name.includes('Risk')) roleTitle = 'RISK';
            if (res.name.includes('Dependency')) roleTitle = 'DEPENDENCIES';
            userPrompt += `[${roleTitle}]\n${res.data || 'null'}\n\n`;
        }
        userPrompt += `Produce the Developer Summary and LLM Handoff Block for each file, then the cross-file risk ranking.\n`;

        const synthesized = await this.callGroqSynthesizer({ name: 'Synthesizer', prompt: synthesizerPrompt, apiKey: synthesizerKey, model: defaultModel }, userPrompt);

        return synthesized ? [synthesized] : [];
    }

    private async callGroqJSONRole(
        role: SummaryRole,
        userPrompt: string
    ): Promise<string | null> {
        const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${role.apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: role.model,
                temperature: 0.1,
                response_format: { type: 'json_object' },
                messages: [
                    { role: 'system', content: role.prompt },
                    { role: 'user', content: userPrompt }
                ]
            })
        });

        if (!response.ok) return null;
        const data = (await response.json()) as GroqChatResponse;
        return data.choices?.[0]?.message?.content?.trim() || null;
    }

    private async callGroqSynthesizer(
        role: SummaryRole,
        userPrompt: string
    ): Promise<string | null> {
        const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${role.apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: role.model,
                temperature: 0.3,
                messages: [
                    { role: 'system', content: role.prompt },
                    { role: 'user', content: userPrompt }
                ]
            })
        });

        if (!response.ok) return null;
        const data = (await response.json()) as GroqChatResponse;
        return data.choices?.[0]?.message?.content?.trim() || null;
    }

    private getApiKeys(): Record<number, string> {
        return {
            0: process.env.GROQ_API_KEY || '',
            1: process.env.GROQ_API_KEY_1 || process.env.GROQAPIKEY1 || process.env.groqapikey1 || '',
            2: process.env.GROQ_API_KEY_2 || process.env.GROQAPIKEY2 || process.env.groqapikey2 || '',
            3: process.env.GROQ_API_KEY_3 || process.env.GROQAPIKEY3 || process.env.groqapikey3 || '',
            4: process.env.GROQ_API_KEY_4 || process.env.GROQAPIKEY4 || process.env.groqapikey4 || '',
            5: process.env.GROQ_API_KEY_5 || process.env.GROQAPIKEY5 || process.env.groqapikey5 || ''
        };
    }
}
