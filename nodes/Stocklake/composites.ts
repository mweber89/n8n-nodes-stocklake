import type { IDataObject } from 'n8n-workflow';

/**
 * The rules of the composite operations (Stock > Compare, Stock > Snapshot,
 * Portfolio > Check Holdings): which columns a row has, how rows are ranked, how a holding
 * is valued and flagged. Pure functions, no n8n runtime, so every rule is unit-testable.
 */

export const COMPARE_MAX_SYMBOLS = 25;
export const COMPARE_MIN_SYMBOLS = 2;

function isRecord(value: unknown): value is IDataObject {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A finite number from a number or a numeric string ("12", "1,5" is not one), else undefined. */
export function num(value: unknown): number | undefined {
	if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
	if (typeof value === 'string' && value.trim() !== '') {
		const parsed = Number(value.trim());
		return Number.isFinite(parsed) ? parsed : undefined;
	}
	return undefined;
}

export function round(value: number, digits = 2): number {
	const factor = 10 ** digits;
	return Math.round(value * factor) / factor;
}

/** Where the price sits between the 52-week low (0) and high (100). */
export function weekPosition(price?: number, low?: number, high?: number): number | null {
	if (price === undefined || low === undefined || high === undefined || high <= low) return null;
	return round(Math.min(100, Math.max(0, ((price - low) / (high - low)) * 100)), 1);
}

/** How far the analysts' mean target is above (+) or below (-) the price, in percent. */
export function upsidePct(price?: number, target?: number): number | null {
	if (price === undefined || target === undefined || price <= 0) return null;
	return round(((target - price) / price) * 100, 1);
}

export function rsiState(rsi: number | undefined, overbought = 70, oversold = 30): string | null {
	if (rsi === undefined) return null;
	if (rsi >= overbought) return 'overbought';
	if (rsi <= oversold) return 'oversold';
	return 'neutral';
}

function path(row: IDataObject, ...keys: string[]): unknown {
	let current: unknown = row;
	for (const key of keys) {
		if (!isRecord(current)) return undefined;
		current = current[key];
	}
	return current;
}

/** The numbers every composite reads from a stock, with the derived ones. Missing → null. */
export function quoteColumns(stock: IDataObject): IDataObject {
	const price = num(stock.price);
	const low = num(stock.week52_low);
	const high = num(stock.week52_high);
	const target = num(stock.analyst_target);
	return {
		symbol: (stock.symbol as string) ?? null,
		name: (stock.name as string) ?? null,
		sector: (stock.sector as string) ?? null,
		currency: (stock.currency as string) ?? null,
		price: price ?? null,
		change_pct: num(stock.change_pct) ?? null,
		market_cap_usd: num(stock.market_cap_usd) ?? null,
		pe_forward: num(stock.pe_forward) ?? null,
		pe_trailing: num(stock.pe_trailing) ?? null,
		rsi: num(path(stock, 'indicators', 'rsi')) ?? null,
		week52_low: low ?? null,
		week52_high: high ?? null,
		week52_position_pct: weekPosition(price, low, high),
		analyst_rating: (stock.analyst_rating as string) ?? null,
		analyst_target: target ?? null,
		analyst_upside_pct: upsidePct(price, target),
	};
}

/** The columns only a Pro account receives. */
export const PRO_COLUMNS = ['rating_score', 'rating_direction', 'ai_verdict', 'ai_score'] as const;

export function proColumns(stock: IDataObject): IDataObject {
	return {
		rating_score: num(path(stock, 'rating', 'score')) ?? null,
		rating_direction: (path(stock, 'rating', 'direction') as string) ?? null,
		ai_verdict: (stock.ai_verdict as string) ?? null,
		ai_score: num(stock.ai_score) ?? null,
	};
}

/** Whether the response carries what only Pro gets (the rating block, the AI score). */
export function hasProFields(stock: IDataObject): boolean {
	return isRecord(stock.rating) || stock.ai_score !== undefined || stock.ai_verdict !== undefined;
}

// ------------------------------------------------------------------- Compare

/** What "Rank by" can order by: the option value → the column and its label. */
export const RANK_COLUMNS: Record<string, string> = {
	aiScore: 'ai_score',
	analystUpside: 'analyst_upside_pct',
	changePct: 'change_pct',
	marketCap: 'market_cap_usd',
	peForward: 'pe_forward',
	ratingScore: 'rating_score',
	rsi: 'rsi',
	week52Position: 'week52_position_pct',
};

/**
 * Sorts the rows by one column and adds `rank` (1 = first). Rows with no value for the
 * column keep their order after the others and get rank null. Equal values share a rank
 * (1, 2, 2, 4).
 */
export function rankRows(
	rows: IDataObject[],
	column: string,
	order: 'asc' | 'desc',
): IDataObject[] {
	const direction = order === 'asc' ? 1 : -1;
	const keyed = rows.map((row, index) => ({ row, index, value: num(row[column]) }));
	const withValue = keyed
		.filter((entry) => entry.value !== undefined)
		.sort((a, b) => direction * ((a.value as number) - (b.value as number)) || a.index - b.index);
	const without = keyed.filter((entry) => entry.value === undefined);

	const ranked: IDataObject[] = [];
	let lastValue: number | undefined;
	let lastRank = 0;
	withValue.forEach((entry, position) => {
		const rank = entry.value === lastValue ? lastRank : position + 1;
		lastValue = entry.value;
		lastRank = rank;
		ranked.push({ rank, ...entry.row });
	});
	return [...ranked, ...without.map((entry) => ({ rank: null, ...entry.row }))];
}

// ------------------------------------------------------------------ Holdings

export type CostIs = 'perShare' | 'total';

export interface HoldingInput {
	symbol: unknown;
	quantity: unknown;
	cost: unknown;
}

export type ParsedHolding =
	| { ok: true; symbol: string; quantity: number; costPerShare?: number }
	| { ok: false; symbol: string; error: string };

/** One input item as a holding, or the reason it cannot be one. */
export function parseHolding(input: HoldingInput, costIs: CostIs): ParsedHolding {
	const symbol = String(input.symbol ?? '')
		.trim()
		.toUpperCase();
	if (symbol === '') return { ok: false, symbol, error: 'No ticker in this item' };
	if (!/^[A-Z0-9.\-^]{1,15}$/.test(symbol)) {
		return { ok: false, symbol, error: 'Not a valid-looking ticker symbol' };
	}
	const quantity = num(input.quantity);
	if (quantity === undefined || quantity <= 0) {
		return { ok: false, symbol, error: 'Quantity is missing or not a number above 0' };
	}
	const cost = num(input.cost);
	if (input.cost !== undefined && input.cost !== null && input.cost !== '' && cost === undefined) {
		return { ok: false, symbol, error: 'Cost is not a number' };
	}
	if (cost !== undefined && cost < 0) return { ok: false, symbol, error: 'Cost is below 0' };
	return {
		ok: true,
		symbol,
		quantity,
		costPerShare: cost === undefined ? undefined : costIs === 'total' ? cost / quantity : cost,
	};
}

export interface Holding {
	symbol: string;
	quantity: number;
	/** Average cost per share, or undefined when any of its lots has no cost. */
	costPerShare?: number;
	/** The input items it came from (one per lot). */
	items: number[];
	lots: number;
}

/** Lots of the same ticker (several input items) become one holding: the quantities add
 * up and the cost is the weighted average. Order of first appearance is kept. */
export function mergeLots(
	lots: Array<{ symbol: string; quantity: number; costPerShare?: number; item: number }>,
): Holding[] {
	const merged = new Map<string, Holding & { paid: number; complete: boolean }>();
	for (const lot of lots) {
		const existing = merged.get(lot.symbol);
		const paid = lot.costPerShare === undefined ? 0 : lot.costPerShare * lot.quantity;
		if (!existing) {
			merged.set(lot.symbol, {
				symbol: lot.symbol,
				quantity: lot.quantity,
				items: [lot.item],
				lots: 1,
				paid,
				complete: lot.costPerShare !== undefined,
			});
			continue;
		}
		existing.quantity += lot.quantity;
		existing.paid += paid;
		existing.complete = existing.complete && lot.costPerShare !== undefined;
		existing.lots += 1;
		if (!existing.items.includes(lot.item)) existing.items.push(lot.item);
	}
	return [...merged.values()].map(({ paid, complete, ...holding }) => ({
		...holding,
		costPerShare: complete ? paid / holding.quantity : undefined,
	}));
}

export interface HoldingRules {
	overbought: number;
	oversold: number;
	earningsWithinDays: number;
	insiderSaleUsd: number;
}

export interface Earnings {
	date: string;
	isEstimate: boolean | null;
}

export interface InsiderSales {
	/** Total value of the sales of the last 30 days. */
	valueUsd: number;
	count: number;
}

export const INSIDER_WINDOW_DAYS = 30;
const DAY_MS = 86_400_000;

/** Days from `now` to an ISO date (0 = today), or null when it is not a date. */
export function daysUntil(date: unknown, now: Date): number | null {
	if (typeof date !== 'string') return null;
	const time = Date.parse(date);
	if (Number.isNaN(time)) return null;
	return Math.ceil((time - now.getTime()) / DAY_MS);
}

/** The SELL transactions of the last 30 days, summed. */
export function insiderSales(response: IDataObject, now: Date): InsiderSales {
	const transactions = Array.isArray(response.transactions) ? response.transactions : [];
	let valueUsd = 0;
	let count = 0;
	for (const entry of transactions) {
		if (!isRecord(entry) || entry.type !== 'SELL') continue;
		const time = typeof entry.date === 'string' ? Date.parse(entry.date) : NaN;
		if (Number.isNaN(time) || now.getTime() - time > INSIDER_WINDOW_DAYS * DAY_MS) continue;
		const value = num(entry.value) ?? (num(entry.shares) ?? 0) * (num(entry.price) ?? 0);
		valueUsd += value;
		count += 1;
	}
	return { valueUsd: round(valueUsd, 0), count };
}

export interface HoldingRowInput {
	holding: Holding;
	stock: IDataObject;
	rules: HoldingRules;
	now: Date;
	earnings?: Earnings;
	/** Undefined when the insider sales were not checked. */
	insider?: InsiderSales;
}

/** One holding, valued and flagged. `weight_pct` is filled in once the total is known. */
export function holdingRow(input: HoldingRowInput): IDataObject {
	const { holding, stock, rules, now, earnings, insider } = input;
	const price = num(stock.price);
	const changePct = num(stock.change_pct);
	const previous =
		num(stock.prev_close) ??
		(price !== undefined && changePct !== undefined && changePct > -100
			? price / (1 + changePct / 100)
			: undefined);
	const value = price === undefined ? null : round(price * holding.quantity);
	const dayChange =
		price === undefined || previous === undefined
			? null
			: round((price - previous) * holding.quantity);
	const cost = holding.costPerShare === undefined ? null : round(holding.costPerShare * holding.quantity);
	const pl = value === null || cost === null ? null : round(value - cost);
	const rsi = num(path(stock, 'indicators', 'rsi'));

	const earningsDate = earnings?.date ?? (stock.earnings_date as string | undefined);
	const daysToEarnings = daysUntil(earningsDate, now);
	const flags: string[] = [];
	if (rsi !== undefined && rsi >= rules.overbought) flags.push('rsi_overbought');
	if (rsi !== undefined && rsi <= rules.oversold) flags.push('rsi_oversold');
	if (
		daysToEarnings !== null &&
		daysToEarnings >= 0 &&
		daysToEarnings <= rules.earningsWithinDays
	) {
		flags.push('earnings_soon');
	}
	if (insider && insider.valueUsd >= rules.insiderSaleUsd) flags.push('large_insider_sale');

	return {
		kind: 'holding',
		symbol: (stock.symbol as string) ?? holding.symbol,
		name: (stock.name as string) ?? null,
		currency: (stock.currency as string) ?? null,
		quantity: holding.quantity,
		lots: holding.lots,
		price: price ?? null,
		value,
		day_change: dayChange,
		day_change_pct: changePct ?? null,
		cost_per_share:
			holding.costPerShare === undefined ? null : round(holding.costPerShare, 4),
		cost,
		pl,
		pl_pct: pl === null || cost === null || cost === 0 ? null : round((pl / cost) * 100, 1),
		weight_pct: null,
		rsi: rsi ?? null,
		earnings_date: earningsDate ?? null,
		earnings_in_days: daysToEarnings,
		earnings_is_estimate: earnings?.isEstimate ?? (stock.earnings_is_estimate as boolean) ?? null,
		insider_sales_30d_usd: insider ? insider.valueUsd : null,
		flags,
	};
}

/** Fills `weight_pct` of every priced holding; null when the holdings are in several currencies. */
export function withWeights(rows: IDataObject[]): IDataObject[] {
	const priced = rows.filter((row) => num(row.value) !== undefined);
	const currencies = new Set(priced.map((row) => row.currency ?? ''));
	if (currencies.size !== 1) return rows;
	const total = priced.reduce((sum, row) => sum + (row.value as number), 0);
	if (total <= 0) return rows;
	return rows.map((row) =>
		num(row.value) === undefined
			? row
			: { ...row, weight_pct: round(((row.value as number) / total) * 100, 1) },
	);
}

const FLAG_NAMES = ['rsi_overbought', 'rsi_oversold', 'earnings_soon', 'large_insider_sale'];

interface CurrencyTotals {
	currency: string | null;
	holdings: number;
	total_value: number;
	day_change: number;
	day_change_pct: number | null;
	total_cost: number;
	total_pl: number;
	total_pl_pct: number | null;
}

/** The one summary item: totals, the biggest weight and which holdings carry which flag. */
export function summarize(
	rows: IDataObject[],
	failed: number,
	notes: string[] = [],
): IDataObject {
	const priced = rows.filter((row) => num(row.value) !== undefined);
	const groups = new Map<string, CurrencyTotals>();
	for (const row of priced) {
		const key = (row.currency as string) ?? '';
		const group = groups.get(key) ?? {
			currency: key === '' ? null : key,
			holdings: 0,
			total_value: 0,
			day_change: 0,
			day_change_pct: null,
			total_cost: 0,
			total_pl: 0,
			total_pl_pct: null,
		};
		group.holdings += 1;
		group.total_value += row.value as number;
		group.day_change += num(row.day_change) ?? 0;
		if (num(row.cost) !== undefined) {
			group.total_cost += row.cost as number;
			group.total_pl += num(row.pl) ?? 0;
		}
		groups.set(key, group);
	}
	const byCurrency = [...groups.values()].map((group) => {
		const before = group.total_value - group.day_change;
		return {
			...group,
			total_value: round(group.total_value),
			day_change: round(group.day_change),
			day_change_pct: before > 0 ? round((group.day_change / before) * 100, 2) : null,
			total_cost: round(group.total_cost),
			total_pl: round(group.total_pl),
			total_pl_pct: group.total_cost > 0 ? round((group.total_pl / group.total_cost) * 100, 1) : null,
		};
	});
	const single = byCurrency.length === 1 ? byCurrency[0] : undefined;

	const top = [...priced]
		.filter((row) => num(row.weight_pct) !== undefined)
		.sort((a, b) => (b.weight_pct as number) - (a.weight_pct as number))[0];

	const flags: IDataObject = {};
	for (const name of FLAG_NAMES) {
		flags[name] = rows
			.filter((row) => Array.isArray(row.flags) && (row.flags as string[]).includes(name))
			.map((row) => row.symbol as string);
	}
	const flagged = rows.filter((row) => Array.isArray(row.flags) && (row.flags as string[]).length > 0);
	const withoutCost = priced.filter((row) => num(row.cost) === undefined).length;

	const allNotes = [...notes];
	if (byCurrency.length > 1) {
		allNotes.push(
			'The holdings are in several currencies, so there is no single total or weight: see by_currency.',
		);
	}
	if (withoutCost > 0 && withoutCost < priced.length) {
		allNotes.push(
			`${withoutCost} holding(s) have no cost, so total_cost and total_pl count only the others.`,
		);
	}

	return {
		kind: 'summary',
		holdings: priced.length,
		failed,
		currency: single?.currency ?? null,
		total_value: single?.total_value ?? null,
		day_change: single?.day_change ?? null,
		day_change_pct: single?.day_change_pct ?? null,
		total_cost: single && single.total_cost > 0 ? single.total_cost : null,
		total_pl: single && single.total_cost > 0 ? single.total_pl : null,
		total_pl_pct: single?.total_pl_pct ?? null,
		top_weight_symbol: top ? (top.symbol as string) : null,
		top_weight_pct: top ? (top.weight_pct as number) : null,
		flagged_holdings: flagged.length,
		flags,
		by_currency: byCurrency,
		...(allNotes.length > 0 ? { notes: allNotes } : {}),
	};
}

// ------------------------------------------------------------------ Snapshot

/** The compact, flat read of one stock that an AI agent (or a person) can take in at a glance. */
export function snapshotFrom(
	stock: IDataObject,
	filing: IDataObject | undefined,
	now: Date,
	notes: string[],
): IDataObject {
	const columns = quoteColumns(stock);
	const price = columns.price as number | null;
	const rsi = columns.rsi as number | null;
	const histogram = num(path(stock, 'indicators', 'macd', 'histogram'));
	const sma50 = num(path(stock, 'indicators', 'sma50'));
	const sma200 = num(path(stock, 'indicators', 'sma200'));
	const side = (average?: number) =>
		price === null || average === undefined ? null : price >= average ? 'above' : 'below';

	const earningsDate = (stock.earnings_date as string) ?? null;
	const inDays = daysUntil(earningsDate, now);
	const pro = hasProFields(stock) ? proColumns(stock) : {};

	const snapshot: IDataObject = {
		...columns,
		rsi_state: rsiState(rsi ?? undefined),
		macd_state: histogram === undefined ? null : histogram >= 0 ? 'positive' : 'negative',
		price_vs_sma50: side(sma50),
		price_vs_sma200: side(sma200),
		analyst_count: num(stock.analyst_count) ?? null,
		next_earnings_date: earningsDate,
		next_earnings_in_days: inDays,
		next_earnings_is_estimate: (stock.earnings_is_estimate as boolean) ?? null,
		last_earnings_date: (stock.last_earnings_date as string) ?? null,
		latest_filing_date: filing ? ((filing.date_et as string) ?? null) : null,
		latest_filing_title: filing ? ((filing.title as string) ?? null) : null,
		latest_filing_headline: filing ? ((filing.headline as string) ?? null) : null,
		latest_filing_url: filing ? ((filing.sec_url as string) ?? null) : null,
		...pro,
		updated_at: (stock.updated_at as string) ?? null,
	};
	snapshot.summary = snapshotSentence(snapshot);
	if (notes.length > 0) snapshot.notes = notes;
	return snapshot;
}

function text(value: unknown): string | undefined {
	return typeof value === 'string' && value !== '' ? value : undefined;
}

/** One paragraph with the same facts, for a model or a message. */
export function snapshotSentence(s: IDataObject): string {
	const parts: string[] = [];
	const name = text(s.name);
	const head = `${s.symbol}${name ? ` (${name})` : ''}`;
	if (num(s.price) !== undefined) {
		const change = num(s.change_pct);
		parts.push(
			`${head}: ${s.price}${s.currency ? ` ${s.currency}` : ''}${
				change === undefined ? '' : `, ${change >= 0 ? '+' : ''}${change}% today`
			}.`,
		);
	} else {
		parts.push(`${head}: no price available.`);
	}
	const technical: string[] = [];
	if (num(s.rsi) !== undefined) technical.push(`RSI ${s.rsi} (${s.rsi_state})`);
	if (s.price_vs_sma200) technical.push(`${s.price_vs_sma200} the 200-day average`);
	if (s.macd_state) technical.push(`MACD ${s.macd_state}`);
	if (num(s.week52_position_pct) !== undefined) {
		technical.push(`${s.week52_position_pct}% of the way up its 52-week range`);
	}
	if (technical.length > 0) parts.push(`${technical.join(', ')}.`);
	if (text(s.analyst_rating)) {
		const upside = num(s.analyst_upside_pct);
		parts.push(
			`Analysts: ${String(s.analyst_rating).replace('_', ' ')}${
				num(s.analyst_target) === undefined ? '' : `, mean target ${s.analyst_target}`
			}${upside === undefined ? '' : ` (${upside >= 0 ? '+' : ''}${upside}%)`}.`,
		);
	}
	if (text(s.ai_verdict)) {
		parts.push(`AI verdict ${s.ai_verdict}${num(s.ai_score) === undefined ? '' : `, score ${s.ai_score}`}.`);
	}
	const when = text(s.next_earnings_date);
	if (when) {
		const days = num(s.next_earnings_in_days);
		parts.push(
			`Next earnings ${when.slice(0, 10)}${s.next_earnings_is_estimate ? ' (estimate)' : ''}${
				days === undefined || days < 0 ? '' : `, in ${days} day${days === 1 ? '' : 's'}`
			}.`,
		);
	}
	const filing = text(s.latest_filing_headline) ?? text(s.latest_filing_title);
	if (filing) parts.push(`Latest filing${text(s.latest_filing_date) ? ` (${s.latest_filing_date})` : ''}: ${filing}.`);
	return parts.join(' ');
}
