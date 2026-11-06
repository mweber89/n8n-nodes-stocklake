import type { IDataObject } from 'n8n-workflow';

import { SYMBOLS_PER_CALL, chunk } from './rows';

/**
 * Symbol handling for the operations that take a list of tickers (Get Many, Earnings
 * Calendar): where the list comes from, cleaning it, and what a run will cost.
 * Pure functions, no n8n runtime, so every rule is unit-testable.
 */

/** Same shape the By Ticker field accepts. */
export const TICKER_PATTERN = /^[A-Z0-9.\-^]{1,15}$/;

/** A run that needs more calls than this is announced before it starts. */
export const LARGE_BATCH_CALLS = 25;

export type SymbolSource = 'all' | 'manual' | 'fromInput' | 'fromWatchlist';

/** Operations with a Symbol Source option, and the source used when none is chosen. */
export const SYMBOL_OPERATIONS: Record<string, { defaultSource: SymbolSource }> = {
	'stock.getMany': { defaultSource: 'manual' },
	'earnings.getCalendar': { defaultSource: 'all' },
};

export interface SymbolEntry {
	symbol: string;
	/** The input item that supplied it (the first one, when several did). */
	item: number;
}

export interface InvalidEntry {
	input: string;
	item: number;
	reason: string;
}

export interface SymbolList {
	symbols: SymbolEntry[];
	invalid: InvalidEntry[];
	duplicates: number;
}

/** One raw value (a cell, a field, a typed list) as the tickers it holds. A value can
 * be a ticker, a comma-separated list or an array of either; an empty one is kept as
 * '' so it can be reported against its item. */
export function splitValue(value: unknown): string[] {
	if (Array.isArray(value)) {
		const parts = value.flatMap((entry) => splitValue(entry));
		return parts.length > 0 ? parts : [''];
	}
	if (value === undefined || value === null) return [''];
	if (typeof value === 'object') return [JSON.stringify(value)];
	const parts = String(value)
		.split(',')
		.map((part) => part.trim())
		.filter((part) => part.length > 0);
	return parts.length > 0 ? parts : [''];
}

/**
 * Trims and upper-cases every ticker, drops repeats (the first one keeps its place, so
 * the order of the input is the order of the output) and sets aside the ones that cannot
 * be tickers, so one bad value does not fail the run.
 */
export function buildSymbolList(sources: Array<{ value: unknown; item: number }>): SymbolList {
	const symbols: SymbolEntry[] = [];
	const invalid: InvalidEntry[] = [];
	const seen = new Set<string>();
	let duplicates = 0;

	for (const { value, item } of sources) {
		for (const raw of splitValue(value)) {
			const symbol = raw.trim().toUpperCase();
			if (symbol === '') {
				invalid.push({ input: '', item, reason: 'No ticker in this item' });
			} else if (!TICKER_PATTERN.test(symbol)) {
				invalid.push({ input: raw, item, reason: 'Not a valid-looking ticker symbol' });
			} else if (seen.has(symbol)) {
				duplicates += 1;
			} else {
				seen.add(symbol);
				symbols.push({ symbol, item });
			}
		}
	}
	return { symbols, invalid, duplicates };
}

/** What the API calls the same stock: "BRK.B" is answered as "BRK-B". */
function lookupKeys(symbol: string): string[] {
	const upper = symbol.toUpperCase();
	return [upper, upper.replace(/\./g, '-')];
}

/** Rows back in the order the symbols were asked for. Rows that match no symbol keep
 * their place at the end. The sort is stable. */
export function orderBySymbols<T extends IDataObject>(rows: T[], symbols: string[]): T[] {
	const position = new Map<string, number>();
	symbols.forEach((symbol, index) => {
		for (const key of lookupKeys(symbol)) if (!position.has(key)) position.set(key, index);
	});
	const rank = (row: T) => {
		for (const key of lookupKeys(String(row.symbol ?? ''))) {
			const found = position.get(key);
			if (found !== undefined) return found;
		}
		return symbols.length;
	};
	return rows
		.map((row, index) => ({ row, index, rank: rank(row) }))
		.sort((a, b) => a.rank - b.rank || a.index - b.index)
		.map((entry) => entry.row);
}

/** The input item that supplied each symbol, with the alias spellings the API uses. */
export function itemBySymbol(symbols: SymbolEntry[]): (symbol: unknown) => number | undefined {
	const map = new Map<string, number>();
	for (const entry of symbols) {
		for (const key of lookupKeys(entry.symbol)) if (!map.has(key)) map.set(key, entry.item);
	}
	return (symbol) => {
		for (const key of lookupKeys(String(symbol ?? ''))) {
			const item = map.get(key);
			if (item !== undefined) return item;
		}
		return undefined;
	};
}

export interface CostEstimate {
	calls: number;
	requests: number;
}

/** Each ticker is one call against the daily allowance; the requests are the batches. */
export function estimateCost(symbolCount: number): CostEstimate {
	return {
		calls: symbolCount,
		requests: chunk(new Array<number>(symbolCount).fill(0), SYMBOLS_PER_CALL).length,
	};
}

export function costNotice(estimate: CostEstimate): string {
	const requests =
		estimate.requests === 1
			? 'one request'
			: `${estimate.requests} requests of up to ${SYMBOLS_PER_CALL}`;
	return `About ${estimate.calls} calls against your daily allowance: each ticker counts as one call. They are sent in ${requests}.`;
}
