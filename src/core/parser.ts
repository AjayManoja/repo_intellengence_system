import { COMMAND_REGISTRY, listCommandKeys } from './commandRegistry';
import { CommandParseResult } from '../types';

export function tokenize(input: string): string[] {
    return input
        .trim()
        .replace(/\s+/g, ' ')
        .split(' ')
        .filter(Boolean);
}

function levenshteinDistance(a: string, b: string): number {
    const matrix: number[][] = [];

    for (let i = 0; i <= b.length; i += 1) {
        matrix[i] = [i];
    }

    for (let j = 0; j <= a.length; j += 1) {
        matrix[0][j] = j;
    }

    for (let i = 1; i <= b.length; i += 1) {
        for (let j = 1; j <= a.length; j += 1) {
            if (b.charAt(i - 1) === a.charAt(j - 1)) {
                matrix[i][j] = matrix[i - 1][j - 1];
            } else {
                matrix[i][j] = Math.min(
                    matrix[i - 1][j - 1] + 1,
                    matrix[i][j - 1] + 1,
                    matrix[i - 1][j] + 1
                );
            }
        }
    }

    return matrix[b.length][a.length];
}

export class Parser {
    public parseCommand(input: string): CommandParseResult {
        const rawTokens = tokenize(input);
        const lowerTokens = rawTokens.map((token) => token.toLowerCase());
        const normalized = lowerTokens.join(' ');

        if (lowerTokens.length === 0) {
            return { ok: false, error: 'Unknown command.', suggestions: listCommandKeys() };
        }

        const commandKey = this.findCommandKey(lowerTokens);
        const definition = COMMAND_REGISTRY[commandKey];

        if (definition) {
            const argumentTokens = rawTokens.slice(definition.key.split(' ').length);
            const args: Record<string, string> = {};

            for (let i = 0; i < definition.args.length; i += 1) {
                const spec = definition.args[i];
                const value = spec.variadic ? argumentTokens.slice(i).join(' ') : argumentTokens[i];

                if (spec.required && !value) {
                    return { ok: false, error: this.missingArgumentMessage(spec.name) };
                }

                if (value) {
                    args[spec.name] = value;
                }
            }

            return {
                ok: true,
                command: {
                    raw: input,
                    normalized,
                    tokens: lowerTokens,
                    definition,
                    args
                }
            };
        }

        let closestMatch = '';
        let lowestDistance = Infinity;

        for (const key of listCommandKeys()) {
            const distance = levenshteinDistance(commandKey, key);
            if (distance < lowestDistance) {
                closestMatch = key;
                lowestDistance = distance;
            }
        }

        if (lowestDistance <= 2) {
            return {
                ok: false,
                error: `Unknown command. Did you mean: ${closestMatch}?`,
                suggestions: [closestMatch]
            };
        }

        return {
            ok: false,
            error: 'Unknown command.',
            suggestions: listCommandKeys()
        };
    }

    private findCommandKey(tokens: string[]): string {
        const keys = listCommandKeys().sort((a, b) => b.split(' ').length - a.split(' ').length);

        for (const key of keys) {
            const keyTokens = key.split(' ');
            const candidate = tokens.slice(0, keyTokens.length).join(' ');
            if (candidate === key) {
                return key;
            }
        }

        return `${tokens[0] ?? ''} ${tokens[1] ?? ''}`.trim();
    }

    private missingArgumentMessage(name: string): string {
        if (name === 'name') {
            return 'Error: missing branch name.';
        }
        if (name === 'file') {
            return 'Error: missing file path.';
        }
        if (name === 'files') {
            return 'Error: missing file paths.';
        }
        return `Error: missing ${name}.`;
    }
}
