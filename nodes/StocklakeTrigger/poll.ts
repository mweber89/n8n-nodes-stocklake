import type {
	IDataObject,
	IExecuteFunctions,
	INodeExecutionData,
	IPollFunctions,
} from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import { stocklakeApiRequest } from '../Stocklake/GenericFunctions';
import { SYMBOLS_PER_CALL, chunk } from '../Stocklake/rows';
import { buildSymbolList } from '../Stocklake/symbols';
import { DEFAULT_FILINGS, DEFAULT_MINUTES, DEFAULT_SIGNAL_LIMIT } from './estimate';
import {
	EVENT_TOOLS,
	detectRsi,
	earningsCandidates,
	filingCandidates,
	insiderCandidates,
	insiderMatches,
	matchesSymbols,
	normalSymbol,
	priceCandidates,
	quotesOf,
	signalCandidates,
	sideOf,
} from './events';
import type { Direction, EventKind, Quote } from './events';
import { capList, emptyState, pickFresh, readState, seenCap } from './state';
import type { Candidate, TriggerState } from './state';

/**
 * Runs one check of the Stocklake Trigger: read the API, work out which events are new
 * since the last check, remember the situation, return the new ones. n8n calls this on
 * its poll times; the node itself only calls the API when its own minimum interval has
 * passed (the poll times of n8n start at one minute, which would use up a daily
 * allowance in an hour).
 */

/** The clock, replaceable in tests. */
export const clock = { now: (): number => Date.now() };

/** The watchlist is read at most this often: each stock on it counts as a call. */
export const WATCHLIST_REFRESH_MS = 60 * 60 * 1000;
/** n8n calls on the minute, so a check a few seconds early is still on time. */
const INTERVAL_SLACK_MS = 30 * 1000;

/** Most stocks one check reads: filings and insider activity take one request per stock. */
export const MAX_SYMBOLS: Record<EventKind, number> = {
	signal: 500,
	earnings: 100,
	filing: 25,
	insider: 25,
	rsi: 100,
	price: 100,
};

type SymbolSource = 'all' | 'manual' | 'watchlist';

export interface Config {
	event: EventKind;
	minutes: number;
	fireExisting: boolean;
	symbolSource: SymbolSource;
	symbolsText: string;
	direction: string;
	minSignalScore: number;
	signalLimit: number;
	daysAhead: number;
	filingsPerSymbol: number;
	minPurchaseUsd: number;
	rsiThreshold: number;
	rsiDirection: Direction;
	moveThreshold: number;
	moveDirection: Direction;
}

function number(value: unknown, fallback: number, min: number, max: number): number {
	const n = Number(value);
	return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

export function readConfig(ctx: IPollFunctions): Config {
	const get = <T>(name: string, fallback: T): T => ctx.getNodeParameter(name, fallback) as T;
	const event = get<string>('event', 'earnings') as EventKind;
	if (!(event in EVENT_TOOLS)) {
		throw new NodeOperationError(ctx.getNode(), `Unknown event "${event}"`);
	}
	const options = get<IDataObject>('options', {});
	return {
		event,
		minutes: number(get('minutesBetweenChecks', DEFAULT_MINUTES), DEFAULT_MINUTES, 1, 1440),
		fireExisting: options.fireOnExisting === true,
		symbolSource: get<SymbolSource>('symbolSource', event === 'signal' ? 'all' : 'manual'),
		symbolsText: get<string>('symbols', ''),
		direction: get<string>('direction', ''),
		minSignalScore: number(get('minSignalScore', 60), 60, 0, 100),
		signalLimit: number(get('signalLimit', DEFAULT_SIGNAL_LIMIT), DEFAULT_SIGNAL_LIMIT, 1, 25),
		daysAhead: number(get('daysAhead', 7), 7, 1, 30),
		filingsPerSymbol: number(get('filingsPerSymbol', DEFAULT_FILINGS), DEFAULT_FILINGS, 1, 10),
		minPurchaseUsd: number(get('minPurchaseUsd', 100_000), 100_000, 0, Number.MAX_SAFE_INTEGER),
		rsiThreshold: number(get('rsiThreshold', 70), 70, 0, 100),
		rsiDirection: get<Direction>('rsiDirection', 'up'),
		moveThreshold: number(get('moveThreshold', 5), 5, 0, 1000),
		moveDirection: get<Direction>('moveDirection', 'either'),
	};
}

/** The settings that decide what the API is asked for. A state recorded under other
 * settings would announce things that were always there, so a change starts a new baseline. */
export function signatureOf(config: Config): string {
	const parts: IDataObject = { event: config.event };
	if (config.event === 'signal') {
		parts.direction = config.direction;
		parts.minSignalScore = config.minSignalScore;
	}
	if (config.event === 'earnings') parts.daysAhead = config.daysAhead;
	return JSON.stringify(parts);
}

/** How n8n's poll functions look to the shared request code, which was written for the
 * execute functions of the node: the parameter lookup takes an item index there. Reports
 * node version 2, whose request rules (retries, timeout, quota header) the trigger wants.
 * Everything else (the credential helpers need their own `this`) is the poll context itself. */
function requestContext(poll: IPollFunctions): IExecuteFunctions {
	return new Proxy(poll, {
		get(target, property, receiver) {
			if (property === 'getNode') return () => ({ ...target.getNode(), typeVersion: 2 });
			if (property === 'getNodeParameter') {
				return (name: string, _itemIndex: number, fallback?: unknown, options?: object) =>
					target.getNodeParameter(name, fallback as never, options as never);
			}
			const value = Reflect.get(target, property, receiver) as unknown;
			return typeof value === 'function' ? value.bind(target) : value;
		},
	}) as unknown as IExecuteFunctions;
}

function tooMany(ctx: IPollFunctions, config: Config, count: number): NodeOperationError {
	const max = MAX_SYMBOLS[config.event];
	const per =
		config.event === 'filing' || config.event === 'insider'
			? ' This event needs one request per stock.'
			: '';
	return new NodeOperationError(
		ctx.getNode(),
		`This event checks at most ${max} stocks, and the list has ${count}`,
		{
			description: `Use a shorter list.${per} Every stock counts as a call at every check, so a long list also uses up the daily allowance quickly.`,
		},
	);
}

/** The tickers to check, or undefined for every stock (signals only). */
async function resolveSymbols(
	ctx: IPollFunctions,
	request: IExecuteFunctions,
	config: Config,
	state: TriggerState,
	now: number,
	manual: boolean,
): Promise<{ symbols: string[] | undefined; watchlist?: TriggerState['watchlist'] }> {
	if (config.symbolSource === 'all' && config.event === 'signal') return { symbols: undefined };

	let symbols: string[];
	let watchlist: TriggerState['watchlist'];
	if (config.symbolSource === 'watchlist') {
		const cached = state.watchlist;
		if (!manual && cached && now - cached.at < WATCHLIST_REFRESH_MS) {
			symbols = cached.symbols;
			watchlist = cached;
		} else {
			const response = await stocklakeApiRequest.call(request, 'get_watchlist', {});
			const entries = Array.isArray(response.items) ? (response.items as IDataObject[]) : [];
			symbols = buildSymbolList(entries.map((e) => ({ value: e.symbol, item: 0 }))).symbols.map(
				(s) => s.symbol,
			);
			watchlist = { at: now, symbols };
		}
		if (symbols.length === 0) {
			throw new NodeOperationError(ctx.getNode(), 'Your Stocklake watchlist is empty', {
				description:
					'Star some stocks on your Stocklake account page, or switch Symbol Source to a manual list.',
			});
		}
	} else {
		const list = buildSymbolList([{ value: config.symbolsText, item: 0 }]);
		if (list.invalid.some((e) => e.input !== '')) {
			throw new NodeOperationError(
				ctx.getNode(),
				`Not a ticker: ${list.invalid
					.filter((e) => e.input !== '')
					.map((e) => `"${e.input}"`)
					.join(', ')}`,
				{ description: 'Type tickers separated by commas, for example AAPL, MSFT, SAP.DE.' },
			);
		}
		symbols = list.symbols.map((s) => s.symbol);
		if (symbols.length === 0) {
			throw new NodeOperationError(ctx.getNode(), 'Add at least one ticker to Symbols', {
				description: 'This event looks at the stocks you name, for example AAPL, MSFT, NVDA.',
			});
		}
	}
	if (symbols.length > MAX_SYMBOLS[config.event]) throw tooMany(ctx, config, symbols.length);
	return { symbols, watchlist };
}

/** What one read of the API found. */
interface Observation {
	/** Events that can be announced once, each with a stable id. */
	candidates: Candidate[];
	/** Which of the candidates pass the user's filter (applied after the dedup). */
	passes: (candidate: Candidate) => boolean;
	/** The stocks that were read (their baseline is set by this check). */
	checked: string[];
	/** Quotes, for the RSI event, which compares values instead of ids. */
	quotes?: Quote[];
}

async function observe(
	request: IExecuteFunctions,
	config: Config,
	symbols: string[] | undefined,
	now: number,
): Promise<Observation> {
	const call = (tool: string, args: IDataObject) => stocklakeApiRequest.call(request, tool, args);
	const checked = (symbols ?? []).map(normalSymbol);

	switch (config.event) {
		case 'signal': {
			const args: IDataObject = {
				min_signal_score: config.minSignalScore,
				limit: config.signalLimit,
			};
			if (config.direction !== '') args.direction = config.direction;
			const response = await call('get_signals', args);
			return {
				candidates: signalCandidates(response),
				passes: (c) => matchesSymbols(c, symbols),
				checked,
			};
		}
		case 'earnings': {
			const candidates: Candidate[] = [];
			for (const batch of chunk(symbols ?? [], SYMBOLS_PER_CALL)) {
				const response = await call('get_earnings_calendar', {
					days: config.daysAhead,
					symbols: batch,
					limit: Math.min(500, batch.length * 2),
				});
				candidates.push(...earningsCandidates(response, now));
			}
			return { candidates, passes: () => true, checked };
		}
		case 'filing': {
			const candidates: Candidate[] = [];
			for (const symbol of symbols ?? []) {
				const response = await call('get_stock_filings', {
					symbol,
					limit: config.filingsPerSymbol,
				});
				candidates.push(...filingCandidates(symbol, response));
			}
			return { candidates, passes: () => true, checked };
		}
		case 'insider': {
			const candidates: Candidate[] = [];
			for (const symbol of symbols ?? []) {
				const response = await call('get_insider_activity', { symbol });
				candidates.push(...insiderCandidates(symbol, response));
			}
			return {
				candidates,
				passes: (c) => insiderMatches(c, config.minPurchaseUsd),
				checked,
			};
		}
		case 'rsi':
		case 'price': {
			const quotes: Quote[] = [];
			for (const batch of chunk(symbols ?? [], SYMBOLS_PER_CALL)) {
				quotes.push(...quotesOf(await call('get_stocks', { symbols: batch })));
			}
			return {
				candidates:
					config.event === 'price'
						? priceCandidates(
								quotes,
								{ threshold: config.moveThreshold, direction: config.moveDirection },
								now,
							)
						: [],
				passes: () => true,
				checked,
				quotes,
			};
		}
	}
}

/** The time an event is about, to put the announced ones in the order they happened. */
function whenOf(row: IDataObject): number {
	const value = row.flagged_at ?? row.filed_at ?? row.date ?? row.earnings_date;
	const t = Date.parse(String(value ?? ''));
	return Number.isNaN(t) ? 0 : t;
}

function chronological(rows: IDataObject[]): IDataObject[] {
	return rows
		.map((row, index) => ({ row, index }))
		.sort((a, b) => whenOf(a.row) - whenOf(b.row) || a.index - b.index)
		.map((entry) => entry.row);
}

/** The event to show while building the workflow: the latest that matches right now. */
export function latestMatch(config: Config, observation: Observation): IDataObject | undefined {
	if (config.event === 'rsi') {
		const wanted = (observation.quotes ?? [])
			.filter((q) => q.rsi !== undefined)
			.map((q) => ({ q, side: sideOf(q.rsi as number, config.rsiThreshold) }))
			.filter(({ side }) => {
				const moved = side === 'above' ? 'up' : 'down';
				return config.rsiDirection === 'either' || config.rsiDirection === moved;
			})
			.sort(
				(a, b) =>
					Math.abs((a.q.rsi as number) - config.rsiThreshold) -
					Math.abs((b.q.rsi as number) - config.rsiThreshold),
			);
		const first = wanted[0];
		if (!first) return undefined;
		const detected = detectRsi([first.q], [], {
			threshold: config.rsiThreshold,
			direction: config.rsiDirection,
			firstCheck: true,
			fireExisting: true,
		}).events;
		return detected[0];
	}
	const matching = observation.candidates.filter(observation.passes).map((c) => c.row);
	if (matching.length === 0) return undefined;
	if (config.event === 'earnings') {
		return chronological(matching)[0];
	}
	if (config.event === 'price') {
		return [...matching].sort(
			(a, b) => Math.abs(Number(b.change_pct ?? 0)) - Math.abs(Number(a.change_pct ?? 0)),
		)[0];
	}
	const ordered = chronological(matching);
	return ordered[ordered.length - 1];
}

const NOTHING_TO_SHOW: Record<EventKind, string> = {
	signal: 'No signal matches the filters right now',
	earnings: 'None of these stocks reports earnings in the chosen window',
	filing: 'No recent 8-K filing was found for these stocks',
	insider: 'No insider purchase of this size was found for these stocks',
	rsi: 'None of these stocks is on the chosen side of the threshold right now',
	price: 'None of these stocks has moved by more than the chosen percentage today',
};

const HOW_TO_SEE_ONE: Record<EventKind, string> = {
	signal: 'Lower Min Signal Score or choose any direction to see a sample.',
	earnings: 'Raise Days Ahead or add stocks to see a sample.',
	filing: 'Add stocks to see a sample.',
	insider: 'Lower Min Purchase or add stocks to see a sample.',
	rsi: 'Move the threshold towards the current RSI of one of the stocks to see a sample.',
	price: 'Lower the percentage to see a sample.',
};

/** One check. Returns the new events as items, or null when there is nothing new. */
export async function poll(this: IPollFunctions): Promise<INodeExecutionData[][] | null> {
	const manual = this.getMode() === 'manual';
	const config = readConfig(this);
	const root = this.getWorkflowStaticData('node');
	const now = clock.now();
	const signature = signatureOf(config);
	const request = requestContext(this);

	// While building the workflow: the latest matching event, state untouched.
	if (manual) {
		const { symbols } = await resolveSymbols(this, request, config, emptyState(), now, true);
		const observation = await observe(request, config, symbols, now);
		const latest = latestMatch(config, observation);
		if (!latest) {
			throw new NodeOperationError(this.getNode(), NOTHING_TO_SHOW[config.event], {
				description: `This is a test run: it shows the latest event that matches now. ${HOW_TO_SEE_ONE[config.event]} When the workflow is active, the node only returns events that happen after it starts.`,
			});
		}
		return [this.helpers.returnJsonArray([latest])];
	}

	let state = readState(root.state);
	if (state.signature !== signature) state = emptyState(signature);

	// n8n's own poll times start at one minute; this node calls the API less often.
	const sinceLast = now - state.checkedAt;
	if (state.initialised && sinceLast < config.minutes * 60_000 - INTERVAL_SLACK_MS) return null;

	// Marked before the call: a check that fails waits for the interval like any other.
	state.checkedAt = now;
	root.state = state as unknown as IDataObject;

	const { symbols, watchlist } = await resolveSymbols(this, request, config, state, now, false);
	if (watchlist) state.watchlist = watchlist;
	const observation = await observe(request, config, symbols, now);
	const firstCheck = !state.initialised;
	const cap = seenCap(observation.checked.length || config.signalLimit);

	let fire: IDataObject[];
	if (config.event === 'rsi') {
		const known = new Set(state.known);
		const result = detectRsi(observation.quotes ?? [], state.rsi, {
			threshold: config.rsiThreshold,
			direction: config.rsiDirection,
			firstCheck,
			fireExisting: config.fireExisting,
		});
		fire = result.events;
		state.rsi = capList(result.rsi, 1000);
		state.known = [...new Set([...known, ...observation.checked])];
	} else {
		const fresh = pickFresh(observation.candidates, state, {
			firstCheck,
			fireExisting: config.fireExisting,
			cap,
			// Signals are not about a list: a stock that turns up is not a new stock.
			checkedSymbols: config.event === 'signal' ? undefined : observation.checked,
		});
		fire = chronological(fresh.fire.filter(observation.passes).map((c) => c.row));
		state.seen = fresh.seen;
		state.known = fresh.known;
	}

	state.initialised = true;
	root.state = state as unknown as IDataObject;
	return fire.length > 0 ? [this.helpers.returnJsonArray(fire)] : null;
}
