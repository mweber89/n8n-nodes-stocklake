import type { IDataObject } from 'n8n-workflow';

import type { Candidate } from './state';

/**
 * The six events of the Stocklake Trigger: how a response of the API becomes candidate
 * events, which of them match the user's filter and what an output item looks like.
 * Pure functions, no n8n runtime. Which candidates are new is decided in state.ts.
 */

export type EventKind = 'signal' | 'earnings' | 'filing' | 'insider' | 'rsi' | 'price';

/** The `event` field of every output item, so one workflow can tell them apart. */
export const EVENT_NAMES: Record<EventKind, string> = {
	signal: 'signal.new',
	earnings: 'earnings.upcoming',
	filing: 'filing.new',
	insider: 'insider.purchase',
	rsi: 'rsi.crossed',
	price: 'price.moved',
};

/** The tool each event reads and the plan it needs. */
export const EVENT_TOOLS: Record<EventKind, { tool: string; pro: boolean }> = {
	signal: { tool: 'get_signals', pro: true },
	earnings: { tool: 'get_earnings_calendar', pro: false },
	filing: { tool: 'get_stock_filings', pro: false },
	insider: { tool: 'get_insider_activity', pro: false },
	rsi: { tool: 'get_stocks', pro: false },
	price: { tool: 'get_stocks', pro: false },
};

export type Direction = 'up' | 'down' | 'either';

function isRecord(value: unknown): value is IDataObject {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function list(value: unknown): IDataObject[] {
	return Array.isArray(value) ? value.filter(isRecord) : [];
}

function text(value: unknown): string {
	return typeof value === 'string'
		? value
		: value === undefined || value === null
			? ''
			: String(value);
}

function num(value: unknown): number | undefined {
	return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/** What the API calls a stock, for comparing symbols typed by a person with answers. */
export function normalSymbol(symbol: unknown): string {
	return text(symbol).trim().toUpperCase().replace(/\./g, '-');
}

function time(value: unknown): number {
	const t = Date.parse(text(value));
	return Number.isNaN(t) ? 0 : t;
}

// ---------------------------------------------------------------- signals

/** A signal has no id of its own: the stock, who flagged it, which way and when. */
export function signalCandidates(response: IDataObject): Candidate[] {
	return list(response.signals).map((row) => ({
		id: [
			'signal',
			normalSymbol(row.symbol),
			text(row.source),
			text(row.direction),
			text(row.flagged_at),
		].join('|'),
		symbol: normalSymbol(row.symbol),
		row: { event: EVENT_NAMES.signal, ...row },
	}));
}

/** Signals for the chosen stocks only; no list means every stock. */
export function matchesSymbols(candidate: Candidate, symbols: string[] | undefined): boolean {
	if (!symbols || symbols.length === 0) return true;
	const wanted = new Set(symbols.map(normalSymbol));
	return wanted.has(normalSymbol(candidate.symbol));
}

// --------------------------------------------------------------- earnings

/** One event per stock and report date. A date that moves is announced again. */
export function earningsCandidates(response: IDataObject, now: number): Candidate[] {
	return list(response.results).map((row) => {
		const date = text(row.earnings_date);
		const when = time(date);
		return {
			id: ['earnings', normalSymbol(row.symbol), date.slice(0, 10)].join('|'),
			symbol: normalSymbol(row.symbol),
			row: {
				event: EVENT_NAMES.earnings,
				...row,
				days_until: when > 0 ? Math.max(0, Math.floor((when - now) / 86_400_000)) : null,
			},
		};
	});
}

// ----------------------------------------------------------------- filings

export function filingCandidates(symbol: string, response: IDataObject): Candidate[] {
	return list(response.items).map((row) => {
		const own = text(row.symbol) || symbol;
		const id = text(row.accession) || [own, text(row.filed_at), text(row.title)].join('|');
		return {
			id: ['filing', id].join('|'),
			symbol: normalSymbol(symbol),
			row: { event: EVENT_NAMES.filing, ...row, symbol: own },
		};
	});
}

// ---------------------------------------------------------------- insiders

export function transactionValue(row: IDataObject): number | undefined {
	const value = num(row.value);
	if (value !== undefined) return value;
	const shares = num(row.shares);
	const price = num(row.price);
	return shares !== undefined && price !== undefined ? shares * price : undefined;
}

/** Every purchase in the answer, whatever its size: the amount is a filter applied after,
 * so lowering it does not announce purchases that were there all along. */
export function insiderCandidates(symbol: string, response: IDataObject): Candidate[] {
	return list(response.transactions)
		.filter((row) => text(row.type).toUpperCase() === 'BUY')
		.map((row) => {
			const value = transactionValue(row);
			return {
				id: [
					'insider',
					normalSymbol(symbol),
					text(row.date).slice(0, 10),
					text(row.name),
					text(row.shares),
					value === undefined ? '' : String(Math.round(value)),
				].join('|'),
				symbol: normalSymbol(symbol),
				row: {
					event: EVENT_NAMES.insider,
					symbol,
					...row,
					...(value !== undefined ? { value } : {}),
				},
			};
		});
}

export function insiderMatches(candidate: Candidate, minValue: number): boolean {
	const value = num(candidate.row.value);
	return value !== undefined && value >= minValue;
}

// ------------------------------------------------------------------- quotes

/** What the two price events read from one stock of `get_stocks`. */
export interface Quote {
	symbol: string;
	name?: string;
	sector?: string;
	price?: number;
	changePct?: number;
	prevClose?: number;
	rsi?: number;
	volume?: number;
	marketCapUsd?: number;
	updatedAt?: string;
}

export function quotesOf(response: IDataObject): Quote[] {
	const symbols = response.symbols;
	const rows = isRecord(symbols) ? Object.values(symbols).filter(isRecord) : [];
	return rows
		.filter((row) => typeof row.symbol === 'string')
		.map((row) => ({
			symbol: text(row.symbol),
			name: typeof row.name === 'string' ? row.name : undefined,
			sector: typeof row.sector === 'string' ? row.sector : undefined,
			price: num(row.price),
			changePct: num(row.change_pct),
			prevClose: num(row.prev_close),
			rsi: isRecord(row.indicators) ? num(row.indicators.rsi) : undefined,
			volume: num(row.volume),
			marketCapUsd: num(row.market_cap_usd),
			updatedAt: typeof row.updated_at === 'string' ? row.updated_at : undefined,
		}));
}

function quoteFields(quote: Quote): IDataObject {
	const out: IDataObject = { symbol: quote.symbol };
	const add = (key: string, value: unknown) => {
		if (value !== undefined) out[key] = value as IDataObject[string];
	};
	add('name', quote.name);
	add('sector', quote.sector);
	add('price', quote.price);
	add('change_pct', quote.changePct);
	add('volume', quote.volume);
	add('market_cap_usd', quote.marketCapUsd);
	return out;
}

// --------------------------------------------------------------------- RSI

export type Side = 'above' | 'below';

/** At the threshold counts as above, so every value is on exactly one side and a crossing
 * is a change of side between two checks, never "is above". */
export function sideOf(value: number, threshold: number): Side {
	return value >= threshold ? 'above' : 'below';
}

export function allowed(direction: Direction, moved: 'up' | 'down'): boolean {
	return direction === 'either' || direction === moved;
}

export interface RsiOptions {
	threshold: number;
	direction: Direction;
	firstCheck: boolean;
	fireExisting: boolean;
}

export interface RsiResult {
	events: IDataObject[];
	/** The new last-value list, one entry per stock, the ones read this time newest. */
	rsi: Array<[string, number]>;
}

/**
 * Compares each stock's RSI with its value at the previous check. A crossing is a change
 * of side. A stock with no previous value is only recorded, except on the first check when
 * asked to announce what already exists (then: every stock already beyond the threshold in
 * the chosen direction). A stock without an RSI keeps its old value.
 */
export function detectRsi(
	quotes: Quote[],
	previous: Array<[string, number]>,
	options: RsiOptions,
): RsiResult {
	const before = new Map(previous);
	const after = new Map(previous);
	const events: IDataObject[] = [];

	for (const quote of quotes) {
		if (quote.rsi === undefined) continue;
		const last = before.get(quote.symbol);
		const side = sideOf(quote.rsi, options.threshold);
		const base = (previousRsi: number | null, moved: 'up' | 'down') => ({
			event: EVENT_NAMES.rsi,
			...quoteFields(quote),
			rsi: quote.rsi,
			previous_rsi: previousRsi,
			threshold: options.threshold,
			direction: moved,
		});

		if (last === undefined) {
			if (options.firstCheck && options.fireExisting) {
				const moved = side === 'above' ? 'up' : 'down';
				if (allowed(options.direction, moved)) events.push(base(null, moved));
			}
		} else {
			const was = sideOf(last, options.threshold);
			if (was !== side) {
				const moved = side === 'above' ? 'up' : 'down';
				if (allowed(options.direction, moved)) events.push(base(last, moved));
			}
		}
		after.delete(quote.symbol);
		after.set(quote.symbol, quote.rsi);
	}
	return { events, rsi: [...after.entries()] };
}

// ------------------------------------------------------------------- price

/** The day a move belongs to: the previous close it is measured from, which stays put for
 * the whole session and over a weekend, or else the calendar day (UTC). */
export function dayKey(quote: Quote, now: number): string {
	return quote.prevClose !== undefined
		? String(quote.prevClose)
		: new Date(now).toISOString().slice(0, 10);
}

/** Moves of more than `threshold` percent either way, one candidate per stock, day and way. */
export function priceCandidates(
	quotes: Quote[],
	options: { threshold: number; direction: Direction },
	now: number,
): Candidate[] {
	const out: Candidate[] = [];
	for (const quote of quotes) {
		if (quote.changePct === undefined) continue;
		const moved = quote.changePct >= 0 ? 'up' : 'down';
		if (Math.abs(quote.changePct) <= options.threshold) continue;
		if (!allowed(options.direction, moved)) continue;
		out.push({
			id: ['price', normalSymbol(quote.symbol), dayKey(quote, now), moved].join('|'),
			symbol: normalSymbol(quote.symbol),
			row: {
				event: EVENT_NAMES.price,
				...quoteFields(quote),
				...(quote.prevClose !== undefined ? { prev_close: quote.prevClose } : {}),
				direction: moved,
				threshold_pct: options.threshold,
			},
		});
	}
	return out;
}
