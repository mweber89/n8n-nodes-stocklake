import type { IDataObject } from 'n8n-workflow';

/**
 * How node version 2 turns a list-shaped tool response into one n8n item per row.
 * Pure data and functions, no n8n runtime, so every rule is unit-testable.
 */

/** A simplified row keeps these fields: a plain key, or [outputKey, 'dotted.path']. */
export type Pick = string | [string, string];

export interface RowSource {
	/** Key of the array (or, with `object`, of the map keyed by symbol) in the response. */
	path: string;
	/** The value is an object whose values are the rows (get_stocks). */
	object?: boolean;
	/** Field added to each row from this source, to say where it came from. */
	tag?: { field: string; value: string | number | boolean };
	/** Not counted against Limit and only read from the first response of a paged read. */
	extra?: boolean;
}

export interface LimitSpec {
	/** Node parameter that holds the user's limit. */
	param: 'limit' | 'maxResults';
	/** Most rows the tool returns per call. */
	cap: number;
	/** Used when the parameter is not set. */
	fallback: number;
}

export interface ListSpec {
	sources: RowSource[];
	simplify: Pick[];
	limit?: LimitSpec;
	/** page: `page` argument; offset: `offset`/`next_offset`; symbols: chunks of 25 symbols. */
	paging?: 'page' | 'offset' | 'symbols';
}

/** get_stocks accepts at most this many symbols per call. */
export const SYMBOLS_PER_CALL = 25;

const quote = [
	'symbol',
	'name',
	'sector',
	'price',
	'change_pct',
	'volume',
	'rsi',
	'market_cap_usd',
	'analyst_rating',
	'ai_verdict',
	'ai_score',
];

/** `resource.operation` -> how its response becomes rows. Operations that are not
 * listed here return the whole response as one item, exactly like version 1. */
export const LIST_SPECS: Record<string, ListSpec> = {
	'stock.getMany': {
		sources: [{ path: 'symbols', object: true }],
		paging: 'symbols',
		simplify: [
			'symbol',
			'name',
			'exchange',
			'sector',
			'industry',
			'country',
			'currency',
			'price',
			'change_pct',
			'volume',
			'market_cap_usd',
			'pe_forward',
			['rsi', 'indicators.rsi'],
			'analyst_rating',
			'ai_verdict',
			'ai_score',
		],
	},
	'stock.getHistory': {
		sources: [{ path: 'history' }],
		simplify: ['symbol', 'date', 'open', 'high', 'low', 'close', 'volume'],
	},
	'stock.getIndicatorHistory': {
		sources: [{ path: 'snapshots' }],
		simplify: [
			'symbol',
			'recorded_at',
			'price',
			'rsi',
			'macd_histogram',
			'bb_pct',
			'sma20',
			'sma200',
		],
	},
	'stock.getNews': {
		sources: [{ path: 'articles' }],
		limit: { param: 'limit', cap: 50, fallback: 50 },
		simplify: [
			'symbol',
			'title',
			'published_at',
			'ai_sentiment',
			'ai_summary',
			'signal_score',
			'signal_score_band',
		],
	},
	'stock.getFilings': {
		sources: [{ path: 'items' }],
		limit: { param: 'maxResults', cap: 25, fallback: 10 },
		simplify: [
			'accession',
			'symbol',
			'company',
			'filed_at',
			'date_et',
			'title',
			'items',
			'sec_url',
			'relevance',
			'headline',
			'summary',
			'sentiment',
		],
	},
	'stock.getActivity': {
		sources: [
			{ path: 'upcoming', tag: { field: 'upcoming', value: true }, extra: true },
			{ path: 'items' },
		],
		limit: { param: 'maxResults', cap: 50, fallback: 25 },
		paging: 'page',
		simplify: [
			'id',
			'type',
			'symbol',
			'timestamp',
			'upcoming',
			'headline',
			'tone',
			'number',
			'summary',
		],
	},
	'stock.getAnalystTrend': {
		sources: [{ path: 'snapshots' }],
		simplify: [
			'symbol',
			'date',
			'analyst_rating',
			'analyst_rating_score',
			'analyst_count',
			'analyst_target',
			'analyst_target_high',
			'analyst_target_low',
			'analyst_target_median',
			'price',
		],
	},
	'screener.screen': {
		sources: [{ path: 'results' }],
		limit: { param: 'limit', cap: 25, fallback: 50 },
		simplify: [
			'symbol',
			'name',
			'sector',
			'industry',
			'country',
			'currency',
			'price',
			'change_pct',
			'volume',
			'market_cap_usd',
			'pe_forward',
			'rsi',
			'macd_signal',
			'sma200_trend',
			'analyst_rating',
			'ai_verdict',
			'ai_score',
		],
	},
	'market.getMovers': {
		sources: [
			{ path: 'gainers', tag: { field: 'category', value: 'gainers' } },
			{ path: 'losers', tag: { field: 'category', value: 'losers' } },
			{ path: 'most_active', tag: { field: 'category', value: 'most_active' } },
		],
		limit: { param: 'limit', cap: 20, fallback: 50 },
		simplify: ['category', ...quote],
	},
	'market.getEconomicCalendar': {
		sources: [
			{ path: 'released_recent', tag: { field: 'bucket', value: 'released_recent' } },
			{ path: 'upcoming', tag: { field: 'bucket', value: 'upcoming' } },
		],
		limit: { param: 'maxResults', cap: 50, fallback: 20 },
		simplify: [
			'bucket',
			'date',
			'time',
			'country',
			'event',
			'actual',
			'previous',
			'diff',
			'consensus',
			'key_event',
		],
	},
	'earnings.getCalendar': {
		sources: [{ path: 'results' }],
		limit: { param: 'limit', cap: 500, fallback: 50 },
		paging: 'offset',
		simplify: [
			'symbol',
			'name',
			'sector',
			'price',
			'rsi',
			'market_cap',
			'earnings_date',
			'is_estimate',
			'eps_trailing',
			'eps_forward',
		],
	},
	'earnings.getIntelligence': {
		sources: [{ path: 'results' }],
		limit: { param: 'limit', cap: 25, fallback: 25 },
		simplify: [
			'symbol',
			'name',
			'sector',
			'price',
			'rsi',
			'market_cap',
			'earnings_date',
			'is_estimate',
			'ai_verdict',
			'ai_score',
			'ai_score_band',
			'analyst_rating',
			'analyst_target',
		],
	},
	'news.getFeed': {
		sources: [{ path: 'articles' }],
		limit: { param: 'limit', cap: 25, fallback: 10 },
		simplify: [
			'symbol',
			'title',
			'published_at',
			'ai_sentiment',
			'ai_summary',
			'signal_score',
			'signal_score_band',
		],
	},
	'signal.getMany': {
		sources: [{ path: 'signals' }],
		limit: { param: 'limit', cap: 50, fallback: 50 },
		simplify: [
			'symbol',
			'direction',
			'signal_score',
			'signal_score_band',
			'source',
			'rationale',
			'flagged_at',
		],
	},
	'watchlist.get': {
		sources: [{ path: 'items' }],
		simplify: [
			'symbol',
			'name',
			'sector',
			'price',
			'change_pct',
			'rsi',
			'market_cap',
			'analyst_rating',
			'ai_verdict',
			'ai_score',
			'added_at',
			'price_at_add',
		],
	},
};

/** Operations of each resource that return rows. */
export function listOperations(resource: string): string[] {
	return Object.keys(LIST_SPECS)
		.filter((key) => key.startsWith(`${resource}.`))
		.map((key) => key.slice(resource.length + 1));
}

function isRecord(value: unknown): value is IDataObject {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readPath(row: IDataObject, path: string): unknown {
	let current: unknown = row;
	for (const part of path.split('.')) {
		if (!isRecord(current)) return undefined;
		current = current[part];
	}
	return current;
}

export interface ExtractedRows {
	/** Rows that count against Limit. */
	rows: IDataObject[];
	/** Rows that are returned alongside but are not counted (see RowSource.extra). */
	extras: IDataObject[];
}

/** Rows of one response: tagged with their source and, when a row does not name
 * its stock, the response's own `symbol` (history, news and analyst rows). */
export function extractRows(
	response: IDataObject,
	spec: ListSpec,
	{ includeExtras = true }: { includeExtras?: boolean } = {},
): ExtractedRows {
	const rows: IDataObject[] = [];
	const extras: IDataObject[] = [];
	const parentSymbol = typeof response.symbol === 'string' ? response.symbol : undefined;

	for (const source of spec.sources) {
		if (source.extra && !includeExtras) continue;
		const raw = response[source.path];
		let list: unknown[] = [];
		if (source.object && isRecord(raw)) list = Object.values(raw);
		else if (Array.isArray(raw)) list = raw;

		for (const entry of list) {
			if (!isRecord(entry)) continue;
			const row: IDataObject = {};
			if (source.tag) row[source.tag.field] = source.tag.value;
			if (parentSymbol !== undefined && entry.symbol === undefined) row.symbol = parentSymbol;
			Object.assign(row, entry);
			(source.extra ? extras : rows).push(row);
		}
	}
	return { rows, extras };
}

/** The chosen fields of a row, flat. Fields a row does not have are left out. */
export function simplifyRow(row: IDataObject, picks: Pick[]): IDataObject {
	const out: IDataObject = {};
	for (const pick of picks) {
		const [key, path] = typeof pick === 'string' ? [pick, pick] : pick;
		const value = readPath(row, path);
		if (value !== undefined) out[key] = value as IDataObject[string];
	}
	return out;
}

/** Everything in the response that is not a row: counts, applied filters, notes. */
export function responseMetadata(response: IDataObject, spec: ListSpec): IDataObject {
	const rowKeys = new Set(spec.sources.map((s) => s.path));
	const meta: IDataObject = {};
	for (const [key, value] of Object.entries(response)) {
		if (!rowKeys.has(key)) meta[key] = value;
	}
	return meta;
}

/** Splits a symbol list into batches the tool accepts. */
export function chunk<T>(list: T[], size: number): T[][] {
	const out: T[][] = [];
	for (let start = 0; start < list.length; start += size) out.push(list.slice(start, start + size));
	return out;
}
