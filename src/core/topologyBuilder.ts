import fs from 'fs/promises';
import path from 'path';
import ts from 'typescript';
import { StructRepo } from './structRepo';
import { RepoTopologyEntry } from '../types';

const SUPPORTED_EXTENSIONS = new Set([
    '.ts',
    '.tsx',
    '.js',
    '.jsx',
    '.mjs',
    '.cjs',
    '.html',
    '.htm',
    '.css',
    '.json',
    '.md'
]);
const IDENTIFIER_PATTERN = /\b[A-Za-z_$][A-Za-z0-9_$]*\b/g;
const RESERVED_WORDS = new Set([
    'const',
    'let',
    'var',
    'return',
    'if',
    'else',
    'for',
    'while',
    'switch',
    'case',
    'break',
    'continue',
    'function',
    'class',
    'import',
    'export',
    'from',
    'default',
    'new',
    'this',
    'true',
    'false',
    'null',
    'undefined',
    'async',
    'await',
    'try',
    'catch',
    'throw',
    'interface',
    'type',
    'extends',
    'implements'
]);

function normalizePath(filePath: string): string {
    return filePath.split(path.sep).join('/');
}

export class TopologyBuilder {
    private readiness: Promise<void> | null = null;

    constructor(private readonly structRepo: StructRepo) {}

    public buildInBackground(): Promise<void> {
        this.readiness = this.build();
        return this.readiness;
    }

    public async waitUntilReady(): Promise<void> {
        if (this.readiness) {
            await this.readiness;
        }
    }

    public async build(): Promise<void> {
        const files = this.structRepo
            .listFiles()
            .filter((file) => file.git_status !== 'D')
            .filter((file) => SUPPORTED_EXTENSIONS.has(path.extname(file.path)));

        const rawEntries: RepoTopologyEntry[] = [];

        for (const file of files) {
            const absolutePath = path.join(this.structRepo.repositoryRoot, file.path);
            try {
                const source = await fs.readFile(absolutePath, 'utf8');
                const parsed = this.parseSource(file.path, source);
                rawEntries.push(parsed);
            } catch {
                rawEntries.push({
                    path: file.path,
                    imports: [],
                    exports: [],
                    references: [],
                    declared_symbols: [],
                    used_symbols: [],
                    cluster: this.inferCluster(file.path),
                    depth_rank: -1,
                    last_computed: new Date().toISOString()
                });
            }
        }

        const referencedEntries = this.applySymbolReferences(rawEntries);
        const rankedEntries = this.applyDepthRank(referencedEntries);
        this.structRepo.repo_updater({ topologyEntries: rankedEntries });
    }

    private parseSource(filePath: string, source: string): RepoTopologyEntry {
        const imports = new Set<string>();
        const exports = new Set<string>();
        const references = new Set<string>();
        const declaredSymbols = new Set<string>();
        const usedSymbols = new Set<string>();
        const extension = path.extname(filePath).toLowerCase();

        this.extractRegexReferences(filePath, source, references);
        this.extractPathLiteralReferences(filePath, source, references);

        if (['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'].includes(extension)) {
            const sourceFile = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true);
            this.parseScriptSource(filePath, sourceFile, imports, exports, references, declaredSymbols);
        } else {
            this.extractTextDeclarations(source, declaredSymbols);
        }

        for (const symbol of source.matchAll(IDENTIFIER_PATTERN)) {
            const value = symbol[0];
            if (!RESERVED_WORDS.has(value) && value.length > 1) {
                usedSymbols.add(value);
            }
        }

        for (const symbol of declaredSymbols) {
            usedSymbols.delete(symbol);
        }

        const allReferences = new Set([...imports, ...references]);

        return {
            path: filePath,
            imports: [...imports].filter(Boolean).sort(),
            exports: [...exports].sort(),
            references: [...allReferences].filter(Boolean).sort(),
            declared_symbols: [...declaredSymbols].sort(),
            used_symbols: [...usedSymbols].sort().slice(0, 80),
            cluster: this.inferCluster(filePath, [...declaredSymbols]),
            depth_rank: -1,
            last_computed: new Date().toISOString()
        };
    }

    private parseScriptSource(
        filePath: string,
        sourceFile: ts.SourceFile,
        imports: Set<string>,
        exports: Set<string>,
        references: Set<string>,
        declaredSymbols: Set<string>
    ): void {
        const visit = (node: ts.Node): void => {
            if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
                imports.add(this.resolveReferencePath(filePath, node.moduleSpecifier.text));
            }

            if (ts.isExportDeclaration(node)) {
                if (node.exportClause && ts.isNamedExports(node.exportClause)) {
                    for (const element of node.exportClause.elements) {
                        exports.add(element.name.text);
                    }
                }

                if (node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
                    imports.add(this.resolveReferencePath(filePath, node.moduleSpecifier.text));
                }
            }

            if (ts.isCallExpression(node)) {
                const expressionText = node.expression.getText(sourceFile);
                const firstArg = node.arguments[0];
                if (
                    (expressionText === 'require' || expressionText === 'import') &&
                    firstArg &&
                    ts.isStringLiteralLike(firstArg)
                ) {
                    imports.add(this.resolveReferencePath(filePath, firstArg.text));
                }
            }

            if (
                (ts.isFunctionDeclaration(node) ||
                    ts.isClassDeclaration(node) ||
                    ts.isInterfaceDeclaration(node) ||
                    ts.isTypeAliasDeclaration(node) ||
                    ts.isEnumDeclaration(node)) &&
                node.name
            ) {
                declaredSymbols.add(node.name.text);
            }

            if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
                declaredSymbols.add(node.name.text);
            }

            if (this.hasExportModifier(node)) {
                const namedNode = node as ts.Node & { name?: ts.Identifier | ts.StringLiteral | ts.NumericLiteral };
                if (namedNode.name && 'text' in namedNode.name) {
                    exports.add(namedNode.name.text);
                    declaredSymbols.add(namedNode.name.text);
                }
            }

            ts.forEachChild(node, visit);
        };

        visit(sourceFile);
    }

    private extractRegexReferences(fromFile: string, source: string, references: Set<string>): void {
        const patterns = [
            /\bsrc\s*=\s*["']([^"']+)["']/gi,
            /\bhref\s*=\s*["']([^"']+)["']/gi,
            /@import\s+(?:url\()?["']?([^"')]+)["']?\)?/gi
        ];

        for (const pattern of patterns) {
            for (const match of source.matchAll(pattern)) {
                const resolved = this.resolveReferencePath(fromFile, match[1]);
                if (this.structRepo.hasFile(resolved)) {
                    references.add(resolved);
                }
            }
        }
    }

    private extractPathLiteralReferences(fromFile: string, source: string, references: Set<string>): void {
        const knownFiles = Object.keys(this.structRepo.getRepoState().repo_index).sort((a, b) => b.length - a.length);
        const normalizedSource = source.split(path.sep).join('/');

        for (const knownFile of knownFiles) {
            if (knownFile === fromFile) {
                continue;
            }

            const basename = path.basename(knownFile);
            if (normalizedSource.includes(knownFile) || (basename.includes('.') && normalizedSource.includes(basename))) {
                references.add(knownFile);
            }
        }
    }

    private extractTextDeclarations(source: string, declaredSymbols: Set<string>): void {
        const titleMatch = source.match(/<title>([^<]+)<\/title>/i);
        if (titleMatch) {
            declaredSymbols.add(titleMatch[1].replace(/[^A-Za-z0-9_$]+/g, '_'));
        }

        for (const match of source.matchAll(/\b(?:id|class)\s*=\s*["']([^"']+)["']/gi)) {
            for (const token of match[1].split(/\s+/)) {
                if (token) {
                    declaredSymbols.add(token.replace(/[^A-Za-z0-9_$]+/g, '_'));
                }
            }
        }
    }

    private applySymbolReferences(entries: RepoTopologyEntry[]): RepoTopologyEntry[] {
        const symbolOwners = new Map<string, string>();

        for (const entry of entries) {
            for (const symbol of entry.declared_symbols) {
                if (!symbolOwners.has(symbol)) {
                    symbolOwners.set(symbol, entry.path);
                }
            }
        }

        return entries.map((entry) => {
            const references = new Set(entry.references);
            for (const symbol of entry.used_symbols) {
                const owner = symbolOwners.get(symbol);
                if (owner && owner !== entry.path) {
                    references.add(owner);
                }
            }

            return {
                ...entry,
                references: [...references].sort()
            };
        });
    }

    private resolveReferencePath(fromFile: string, referencePath: string): string {
        if (/^(https?:)?\/\//.test(referencePath) || referencePath.startsWith('#')) {
            return referencePath;
        }

        if (!referencePath.startsWith('.') && !referencePath.startsWith('/')) {
            const knownDirect = this.resolveKnownCandidate(referencePath.replace(/^\//, ''));
            return knownDirect ?? referencePath;
        }

        const baseDir = path.dirname(fromFile);
        const candidate = normalizePath(path.normalize(path.join(baseDir, referencePath.replace(/^\//, ''))));
        return this.resolveKnownCandidate(candidate) ?? candidate;
    }

    private resolveKnownCandidate(candidate: string): string | null {
        const knownFiles = this.structRepo.getRepoState().repo_index;

        for (const extension of ['', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.html', '.css', '.json']) {
            const fileCandidate = `${candidate}${extension}`;
            if (knownFiles[fileCandidate]) {
                return fileCandidate;
            }
        }

        for (const extension of ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.html', '.css', '.json']) {
            const indexCandidate = `${candidate}/index${extension}`;
            if (knownFiles[indexCandidate]) {
                return indexCandidate;
            }
        }

        return null;
    }

    private hasExportModifier(node: ts.Node): boolean {
        return Boolean(
            ts.canHaveModifiers(node) &&
                ts.getModifiers(node)?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)
        );
    }

    private applyDepthRank(entries: RepoTopologyEntry[]): RepoTopologyEntry[] {
        const byPath = new Map(entries.map((entry) => [entry.path, entry]));
        const incomingCount = new Map<string, number>();
        const depths = new Map<string, number>();

        for (const entry of entries) {
            incomingCount.set(entry.path, incomingCount.get(entry.path) ?? 0);
        }

        for (const entry of entries) {
            for (const referenced of entry.references) {
                if (byPath.has(referenced)) {
                    incomingCount.set(referenced, (incomingCount.get(referenced) ?? 0) + 1);
                }
            }
        }

        const roots = entries
            .filter((entry) => this.isLikelyEntry(entry.path) || (incomingCount.get(entry.path) ?? 0) === 0)
            .sort((a, b) => Number(this.isLikelyEntry(b.path)) - Number(this.isLikelyEntry(a.path)) || a.path.localeCompare(b.path));
        const queue = roots.map((entry) => entry.path);

        for (const root of queue) {
            depths.set(root, 0);
        }

        while (queue.length > 0) {
            const current = queue.shift();
            if (!current) {
                continue;
            }

            const currentDepth = depths.get(current) ?? 0;
            const entry = byPath.get(current);
            if (!entry) {
                continue;
            }

            for (const referenced of entry.references) {
                if (!byPath.has(referenced)) {
                    continue;
                }

                const nextDepth = currentDepth + 1;
                const previousDepth = depths.get(referenced);
                if (previousDepth === undefined || nextDepth < previousDepth) {
                    depths.set(referenced, nextDepth);
                    queue.push(referenced);
                }
            }
        }

        return entries.map((entry) => ({
            ...entry,
            depth_rank: depths.get(entry.path) ?? 0
        }));
    }

    private isLikelyEntry(filePath: string): boolean {
        const base = path.basename(filePath).toLowerCase();
        return /^(main|index|app|extension|server|client|bootstrap)\./.test(base);
    }

    private inferCluster(filePath: string, symbols: string[] = []): string {
        const lower = `${filePath} ${symbols.join(' ')}`.toLowerCase();
        if (/\b(ui|view|panel|component|webview|html|css|style)\b/.test(lower) || /\.(html|css|scss)$/.test(filePath)) {
            return 'ui';
        }
        if (/\b(controller|command|intent|parser|registry|router)\b/.test(lower)) {
            return 'controller';
        }
        if (/\b(ai|llm|groq|summary|summarizer|model|prompt)\b/.test(lower)) {
            return 'ai';
        }
        if (/\b(git|repo|graph|topology|cache|worker|core|struct)\b/.test(lower)) {
            return 'core';
        }
        if (/\b(test|spec|mock|fixture)\b/.test(lower)) {
            return 'tests';
        }
        if (/\b(readme|docs|markdown)\b/.test(lower) || filePath.endsWith('.md')) {
            return 'docs';
        }
        if (/\b(config|env|package|tsconfig)\b/.test(lower) || /\.(json|env)$/.test(filePath)) {
            return 'config';
        }
        return path.dirname(filePath).split('/')[0] || 'app';
    }
}
