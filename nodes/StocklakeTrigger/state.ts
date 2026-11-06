import type { IDataObject } from 'n8n-workflow';

/**
 * What the Stocklake Trigger remembers between two checks, kept in the node's workflow
 * static data. It is small on purpose: ids of events already sent, the last RSI value per
 * stock, and the stocks that already have a baseline. Pure functions, no n8n runtime, so
 * every rule (dedup, first check, cap) is unit-testable.
 */

export const STATE_VERSION = 1;

/** Fewest ids kept, however short the symbol list. */
export const MIN_SEEN = 500;
/** Most ids kept: static data is saved with the workflow, so it must stay small. */
export const MAX_SEEN = 2000;
/** Most stocks whose last RSI is kept. The watchlist holds at most 500 stocks. */
export const MAX_RSI = 1000;
/** Most stocks remembered as "already has a baseline". */
export const MAX_KNOWN = 1000;

export interface TriggerState {
	version: number;
	/** The settings the state belongs to; other settings mean a new baseline. */
	signature: string;
	/** False until the first check has recorded the current situation. */
	initialised: boolean;
	/** When the last real check started (ms since epoch), for the minimum interval. */
	checkedAt: number;
	/** Ids of events already sent (or deliberately not sent), oldest first. */
	seen: string[];
	/** Stocks that have a baseline; a stock added later is recorded, not announced. */
	known: string[];
	/** Last RSI per stock, oldest first. */
	rsi: Array<[string, number]>;
	/** The watchlist as last read and when, so a check does not read it every time. */
	watchlist?: { at: number; symbols: string[] };
}

export function emptyState(signature = ''): TriggerState {
	return {
		version: STATE_VERSION,
		signature,
		initialised: false,
		checkedAt: 0,
		seen: [],
		known: [],
		rsi: [],
	};
}

function strings(value: unknown): string[] {
	return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

/** The stored state, or a fresh one when there is none or it cannot be read. */
export function readState(raw: unknown): TriggerState {
	if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return emptyState();
	const r = raw as IDataObject;
	if (r.version !== STATE_VERSION) return emptyState();
	const rsi: Array<[string, number]> = [];
	if (Array.isArray(r.rsi)) {
		for (const pair of r.rsi) {
			if (
				Array.isArray(pair) &&
				typeof pair[0] === 'string' &&
				typeof pair[1] === 'number' &&
				Number.isFinite(pair[1])
			) {
				rsi.push([pair[0], pair[1]]);
			}
		}
	}
	const wl = r.watchlist as IDataObject | undefined;
	return {
		version: STATE_VERSION,
		signature: typeof r.signature === 'string' ? r.signature : '',
		initialised: r.initialised === true,
		checkedAt: typeof r.checkedAt === 'number' ? r.checkedAt : 0,
		seen: strings(r.seen),
		known: strings(r.known),
		rsi,
		...(wl && typeof wl.at === 'number' && Array.isArray(wl.symbols)
			? { watchlist: { at: wl.at, symbols: strings(wl.symbols) } }
			: {}),
	};
}

/** How many event ids to keep for a list of this many stocks: enough that no id of the
 * latest responses is dropped, never more than static data should hold. */
export function seenCap(symbolCount: number): number {
	return Math.min(MAX_SEEN, Math.max(MIN_SEEN, symbolCount * 10));
}

/** The newest `cap` entries, oldest first. */
export function capList<T>(list: T[], cap: number): T[] {
	return list.length > cap ? list.slice(list.length - cap) : list;
}

/** `ids` added to `seen` (those already there move to the newest end), capped. */
export function remember(seen: string[], ids: string[], cap: number): string[] {
	const fresh = new Set(ids);
	const kept = seen.filter((id) => !fresh.has(id));
	return capList([...kept, ...fresh], cap);
}

export interface Candidate {
	id: string;
	/** The stock the event is about, when it is about one. */
	symbol?: string;
	row: IDataObject;
}

export interface Fresh {
	/** Candidates to announce, in the order given. */
	fire: Candidate[];
	/** The new list of seen ids. */
	seen: string[];
	/** The new list of known stocks. */
	known: string[];
}

export interface FreshOptions {
	/** The first check after activation (or after the settings changed). */
	firstCheck: boolean;
	/** Announce what already exists on the first check. */
	fireExisting: boolean;
	cap: number;
	/** Every stock this check read, with or without events: they have a baseline from now on.
	 * Leave out for events that are not about a list of stocks you name (signals). */
	checkedSymbols?: string[];
	/** Ids of rows that were returned but do not match the filter: remembered, not sent. */
	alsoSeen?: string[];
}

/**
 * Which of these events are new. An id seen before is never sent again. On the first check
 * nothing is sent (unless asked), and the same holds for a stock that has no baseline yet:
 * it was added to the list after the first check, so what it already has is recorded, not
 * announced.
 */
export function pickFresh(
	candidates: Candidate[],
	state: Pick<TriggerState, 'seen' | 'known'>,
	options: FreshOptions,
): Fresh {
	const seen = new Set(state.seen);
	const known = new Set(state.known);
	const announceAll = options.firstCheck && options.fireExisting;
	const fire: Candidate[] = [];
	const ids: string[] = [...(options.alsoSeen ?? [])];

	for (const candidate of candidates) {
		if (seen.has(candidate.id)) {
			ids.push(candidate.id);
			continue;
		}
		const baselined =
			options.checkedSymbols === undefined ||
			candidate.symbol === undefined ||
			known.has(candidate.symbol);
		if (announceAll || (!options.firstCheck && baselined)) fire.push(candidate);
		ids.push(candidate.id);
		seen.add(candidate.id);
	}

	return {
		fire,
		seen: remember(state.seen, ids, options.cap),
		known: capList([...new Set([...state.known, ...(options.checkedSymbols ?? [])])], MAX_KNOWN),
	};
}
