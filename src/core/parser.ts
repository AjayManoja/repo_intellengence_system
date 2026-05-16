// Simple registry of known commands for the parser
const COMMAND_REGISTRY = ['new branch', 'delete branch', 'compare', 'ignore', 'undo', 'show conflicts', 'push'];

function levenshteinDistance(a: string, b: string): number {
    const matrix = [];
    for (let i = 0; i <= b.length; i++) {
        matrix[i] = [i];
    }
    for (let j = 0; j <= a.length; j++) {
        matrix[0][j] = j;
    }
    for (let i = 1; i <= b.length; i++) {
        for (let j = 1; j <= a.length; j++) {
            if (b.charAt(i - 1) === a.charAt(j - 1)) {
                matrix[i][j] = matrix[i - 1][j - 1];
            } else {
                matrix[i][j] = Math.min(
                    matrix[i - 1][j - 1] + 1,
                    Math.min(matrix[i][j - 1] + 1, matrix[i - 1][j] + 1)
                );
            }
        }
    }
    return matrix[b.length][a.length];
}

export class Parser {
    /**
     * Parses the user intention and routes it.
     */
    public parseCommand(input: string): { valid: boolean; command?: string; error?: string } {
        const normalizedInput = input.trim().toLowerCase();

        // Exact match
        const exactMatch = COMMAND_REGISTRY.find(cmd => normalizedInput.startsWith(cmd));
        if (exactMatch) {
            return { valid: true, command: normalizedInput };
        }

        // Check for typos
        let closestMatch = '';
        let lowestDistance = Infinity;

        // Try to match the first two words or first word as the core command intent
        const parts = normalizedInput.split(' ');
        const intent = parts.length > 1 ? `${parts[0]} ${parts[1]}` : parts[0];

        for (const cmd of COMMAND_REGISTRY) {
            const dist = levenshteinDistance(intent, cmd);
            if (dist < lowestDistance) {
                lowestDistance = dist;
                closestMatch = cmd;
            }
        }

        // Threshold for typo suggestion
        if (lowestDistance <= 3) {
            return { valid: false, error: `Command not found. Did you mean '${closestMatch}'?` };
        }

        return { valid: false, error: `Unknown command: ${input}` };
    }
}
