import type { IDataObject, IExecuteFunctions, INodeExecutionData } from 'n8n-workflow';

/**
 * CSV export (node version 2): the rows of a list operation, or of Compare, as one binary
 * file. Pure text rules here (unit-testable without n8n); `csvItem` adds the n8n part.
 *
 * Output rules, chosen so the file opens cleanly in a spreadsheet:
 *  - one header row, the columns in the order they first appear;
 *  - nested objects become dotted columns (`indicators.rsi`), lists of plain values are
 *    joined with "; ", other lists are kept as JSON;
 *  - dates stay the ISO text the API sends (a Date becomes ISO text), numbers use a
 *    point, an empty cell is a missing value;
 *  - a byte order mark at the start so Excel reads the file as UTF-8, CRLF line ends;
 *  - text that a spreadsheet would run as a formula (starts with = + - @) gets a leading
 *    apostrophe, numbers are never touched.
 */

export interface CsvOptions {
	downloadCsv?: boolean;
	csvFileName?: string;
	csvBinaryProperty?: string;
}

const BOM = '﻿';

/** One level of the row, nested objects spread into `parent.child` columns. */
export function flattenRow(row: IDataObject, prefix = ''): IDataObject {
	const out: IDataObject = {};
	for (const [key, value] of Object.entries(row)) {
		const name = prefix ? `${prefix}.${key}` : key;
		if (value !== null && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date)) {
			Object.assign(out, flattenRow(value as IDataObject, name));
		} else {
			out[name] = value;
		}
	}
	return out;
}

function isPlain(value: unknown): boolean {
	return value === null || ['string', 'number', 'boolean'].includes(typeof value);
}

function cellText(value: unknown): string {
	if (value === null || value === undefined) return '';
	if (value instanceof Date) return value.toISOString();
	if (Array.isArray(value)) {
		return value.every(isPlain)
			? value.map((v) => (v === null ? '' : String(v))).join('; ')
			: JSON.stringify(value);
	}
	if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
	if (typeof value === 'boolean') return value ? 'true' : 'false';
	return String(value);
}

/** A string a spreadsheet could take for a formula; a number such as -5 is not one. */
function looksLikeFormula(text: string): boolean {
	if (!/^[=+\-@\t\r]/.test(text)) return false;
	return !/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(text);
}

function escapeCell(value: unknown): string {
	let text = cellText(value);
	if (typeof value === 'string' && looksLikeFormula(text)) text = `'${text}`;
	return /[",\r\n]/.test(text) || /^\s|\s$/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function csvText(rows: IDataObject[]): { text: string; columns: string[] } {
	const flat = rows.map((row) => flattenRow(row));
	const columns: string[] = [];
	const seen = new Set<string>();
	for (const row of flat) {
		for (const key of Object.keys(row)) {
			if (!seen.has(key)) {
				seen.add(key);
				columns.push(key);
			}
		}
	}
	const lines = [columns.map(escapeCell).join(',')];
	for (const row of flat) lines.push(columns.map((c) => escapeCell(row[c])).join(','));
	return { text: BOM + lines.join('\r\n') + '\r\n', columns };
}

function slug(text: string): string {
	return text
		.replace(/[^A-Za-z0-9._-]+/g, '-')
		.replace(/-{2,}/g, '-')
		.replace(/^[-.]+|[-.]+$/g, '')
		.slice(0, 100);
}

const OPERATION_SLUGS: Record<string, string> = {
	screen: 'screener',
	getMany: 'stocks',
	compare: 'compare',
};

/** `AAPL-history-2026-11-06.csv`: ticker (when there is one), what it is, the day. */
export function csvFileName(
	operation: string,
	subject: string | undefined,
	custom: string | undefined,
	now = new Date(),
): string {
	const wanted = slug((custom ?? '').trim().replace(/\.csv$/i, ''));
	if (wanted) return `${wanted}.csv`;
	const kebab = (OPERATION_SLUGS[operation] ?? operation.replace(/^get/, ''))
		.replace(/([a-z0-9])([A-Z])/g, '$1-$2')
		.toLowerCase();
	const parts = [subject ? slug(subject) : '', kebab, now.toISOString().slice(0, 10)];
	return `${parts.filter(Boolean).join('-')}.csv`;
}

/** The part of the file name that says what the rows are about: the ticker of a
 * single-stock operation, or up to five tickers of a comparison. */
export function csvSubject(symbols: string[], max = 5): string | undefined {
	if (symbols.length === 0) return undefined;
	const shown = symbols.slice(0, max).map((s) => s.toUpperCase());
	return symbols.length > max ? `${shown.join('-')}-and-${symbols.length - max}-more` : shown.join('-');
}

/**
 * One output item that carries the rows as a CSV file in `binary`, with a short summary in
 * `json` (file name, row count, columns) for whatever comes next in the workflow.
 */
export async function csvItem(
	context: IExecuteFunctions,
	rows: IDataObject[],
	options: CsvOptions,
	naming: { operation: string; subject?: string },
	pairedItem: INodeExecutionData['pairedItem'],
	extra: IDataObject = {},
): Promise<INodeExecutionData> {
	const { text, columns } = csvText(rows);
	const fileName = csvFileName(naming.operation, naming.subject, options.csvFileName);
	const property = (options.csvBinaryProperty ?? '').trim() || 'data';
	const binary = await context.helpers.prepareBinaryData(
		Buffer.from(text, 'utf8'),
		fileName,
		'text/csv',
	);
	return {
		json: { fileName, rowCount: rows.length, columns, ...extra },
		binary: { [property]: binary },
		pairedItem,
	};
}
