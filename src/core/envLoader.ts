import * as fs from 'fs';
import * as path from 'path';

export function loadEnvFile(repositoryRoot: string): void {
    const envPath = path.join(repositoryRoot, '.env');
    if (!fs.existsSync(envPath)) {
        return;
    }

    const raw = fs.readFileSync(envPath, 'utf8');
    for (const line of raw.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) {
            continue;
        }

        const separatorIndex = trimmed.indexOf('=');
        if (separatorIndex === -1) {
            continue;
        }

        const key = trimmed.slice(0, separatorIndex).trim();
        const value = trimmed.slice(separatorIndex + 1).trim().replace(/^"|"$/g, '');

        if (key && process.env[key] === undefined) {
            process.env[key] = value;
        }
    }
}
