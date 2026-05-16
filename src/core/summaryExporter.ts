import fs from 'fs/promises';
import path from 'path';
import { FileSummary, StructRepoData } from '../types';

export interface SummaryExportResult {
    path: string;
    fileCount: number;
}

function timestamp(): string {
    return new Date().toISOString().replace(/[:.]/g, '-');
}

function pdfEscape(value: string): string {
    return value.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

function wrapLine(value: string, width: number): string[] {
    const words = value.replace(/\t/g, '    ').split(/\s+/);
    const lines: string[] = [];
    let current = '';

    for (const word of words) {
        if (!word) {
            continue;
        }

        const next = current ? `${current} ${word}` : word;
        if (next.length > width && current) {
            lines.push(current);
            current = word;
        } else {
            current = next;
        }
    }

    if (current) {
        lines.push(current);
    }

    return lines.length ? lines : [''];
}

export class SummaryExporter {
    constructor(private readonly repoState: StructRepoData) {}

    public async exportMarkdown(summaries: FileSummary[]): Promise<SummaryExportResult> {
        const outputPath = path.join(this.repoState.repositoryRoot, 'recent', `repo-summary-${timestamp()}.md`);
        const content = [
            `# Repository Summary`,
            '',
            `Repository: ${this.repoState.repositoryName}`,
            `Branch: ${this.repoState.currentBranch}`,
            `Generated: ${new Date().toISOString()}`,
            '',
            ...summaries.flatMap((summary) => [
                `## ${summary.file}`,
                '',
                `Provider: ${summary.provider}`,
                '',
                summary.summary,
                ''
            ])
        ].join('\n');

        await fs.mkdir(path.dirname(outputPath), { recursive: true });
        await fs.writeFile(outputPath, content, 'utf8');

        return {
            path: outputPath,
            fileCount: summaries.length
        };
    }

    public async exportPdf(summaries: FileSummary[]): Promise<SummaryExportResult> {
        const outputPath = path.join(this.repoState.repositoryRoot, 'recent', `repo-summary-${timestamp()}.pdf`);
        const lines = [
            `Repository Summary`,
            `Repository: ${this.repoState.repositoryName}`,
            `Branch: ${this.repoState.currentBranch}`,
            `Generated: ${new Date().toISOString()}`,
            '',
            ...summaries.flatMap((summary) => [
                summary.file,
                `Provider: ${summary.provider}`,
                '',
                ...summary.summary.split(/\r?\n/),
                ''
            ])
        ].flatMap((line) => wrapLine(line, 88));

        const pageHeight = 792;
        const marginLeft = 48;
        const firstBaseline = 744;
        const lineHeight = 14;
        const linesPerPage = Math.floor((firstBaseline - 48) / lineHeight);
        const pages: string[][] = [];

        for (let i = 0; i < lines.length; i += linesPerPage) {
            pages.push(lines.slice(i, i + linesPerPage));
        }

        const objects: string[] = [];
        objects.push('<< /Type /Catalog /Pages 2 0 R >>');
        objects.push(`<< /Type /Pages /Kids [${pages.map((_, index) => `${3 + index * 2} 0 R`).join(' ')}] /Count ${pages.length} >>`);

        pages.forEach((pageLines, index) => {
            const pageObjectId = 3 + index * 2;
            const contentObjectId = pageObjectId + 1;
            objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 ${pageHeight}] /Resources << /Font << /F1 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> >> >> /Contents ${contentObjectId} 0 R >>`);

            const body = [
                'BT',
                '/F1 10 Tf',
                `${marginLeft} ${firstBaseline} Td`,
                ...pageLines.flatMap((line, lineIndex) => [
                    lineIndex === 0 ? '' : `0 -${lineHeight} Td`,
                    `(${pdfEscape(line)}) Tj`
                ]).filter(Boolean),
                'ET'
            ].join('\n');

            objects.push(`<< /Length ${Buffer.byteLength(body, 'utf8')} >>\nstream\n${body}\nendstream`);
        });

        const chunks = ['%PDF-1.4\n'];
        const offsets: number[] = [0];

        objects.forEach((object, index) => {
            offsets.push(Buffer.byteLength(chunks.join(''), 'utf8'));
            chunks.push(`${index + 1} 0 obj\n${object}\nendobj\n`);
        });

        const xrefOffset = Buffer.byteLength(chunks.join(''), 'utf8');
        chunks.push(`xref\n0 ${objects.length + 1}\n`);
        chunks.push('0000000000 65535 f \n');
        for (const offset of offsets.slice(1)) {
            chunks.push(`${offset.toString().padStart(10, '0')} 00000 n \n`);
        }
        chunks.push(`trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`);

        await fs.mkdir(path.dirname(outputPath), { recursive: true });
        await fs.writeFile(outputPath, chunks.join(''), 'binary');

        return {
            path: outputPath,
            fileCount: summaries.length
        };
    }
}
