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

        const roles = [
            {
                name: 'Overview',
                prompt: 'You are a code overview analyst. Return ONLY valid JSON, no prose. Output schema: { "purpose": string, "entry_points": string[], "public_api": string[], "one_line_summary": string }',
                apiKey: keys[1] ?? keys[0]
            },
            {
                name: 'Structure',
                prompt: 'You are a code structure analyst. Return ONLY valid JSON, no prose. Output schema: { "main_classes": string[], "main_functions": string[], "patterns_used": string[], "complexity_notes": string }',
                apiKey: keys[2] ?? keys[0]
            },
            {
                name: 'Risk',
                prompt: 'You are a risk and error analyst. Return ONLY valid JSON, no prose. Output schema: { "error_handling_gaps": string[], "unsafe_patterns": string[], "risk_level": "low"|"medium"|"high", "risk_notes": string }',
                apiKey: keys[3] ?? keys[0]
            },
            {
                name: 'Dependencies',
                prompt: 'You are a dependency and API analyst. Return ONLY valid JSON, no prose. Output schema: { "external_deps": string[], "internal_deps": string[], "exposes_to": string[], "api_surface": string }',
                apiKey: keys[4] ?? keys[0]
            }
        ];

        const jsonResults = await Promise.all(
            roles.map(async (role) => {
                const result = await this.callGroqJSONRole({ ...role, model: defaultModel }, filePath, trimmedSource, localSummary);
                return { name: role.name, data: result };
            })
        );

        const synthesizerKey = keys[5] ?? keys[0];
        const synthesizerPrompt = 'You are a senior technical writer. You receive structured analysis from 4 specialist models. Write a single coherent developer summary. Use markdown with these exact sections: ## Overview, ## Structure, ## Risk & Error Handling, ## Dependencies & API. Be direct and precise.';
        
        let userPrompt = 'Here is the structured analysis:\n';
        for (const res of jsonResults) {
            userPrompt += `${res.name.toUpperCase()}: ${res.data || 'null'}\n`;
        }
        userPrompt += `\nFile(s) analyzed: ${filePath}\n`;

        const synthesized = await this.callGroqSynthesizer({ name: 'Synthesizer', prompt: synthesizerPrompt, apiKey: synthesizerKey, model: defaultModel }, userPrompt);

        return synthesized ? [synthesized] : [];
    }

    private async callGroqJSONRole(
        role: SummaryRole,
        filePath: string,
        trimmedSource: string,
        localSummary: string
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
                    { role: 'user', content: `File: ${filePath}\nLocal context: ${localSummary}\nSource:\n${trimmedSource}` }
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
