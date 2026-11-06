import type {
	IDataObject,
	IHttpRequestOptions,
	ILoadOptionsFunctions,
	INodePropertyOptions,
	JsonObject,
} from 'n8n-workflow';
import { NodeApiError } from 'n8n-workflow';

import { STOCKLAKE_MCP_URL, STOCKLAKE_SEARCH_URL, USER_AGENT } from './GenericFunctions';
import { FALLBACK_VALUES, toOptions } from './optionLists';

/**
 * Dropdowns that are filled from Stocklake when the editor asks for them (version 2).
 *
 * How the values are found: the tools check their arguments before they do any work and
 * answer an unknown value with an error that names the accepted ones ("sector must be one
 * of: ..."). Asking with a value that cannot be valid therefore returns the accepted list, and
 * such a rejected call is not counted against the daily limit (checked against the API on
 * 2026-11-06: the remaining-calls counter does not move). `limit: 1` is sent anyway, so a
 * change in that behaviour could cost at most one call.
 *
 * Rules these functions keep:
 *   - Never a Pro-only tool for a credential that is not Pro. The tier is read from the
 *     daily limit the API reports on any response (5,000 for Pro), without a Pro call.
 *   - Each answer is kept per credential for LIST_TTL_MS, and a failed load for
 *     FAILURE_TTL_MS, so opening and closing the editor does not call the API again.
 *     Calls running at the same time share one request.
 *   - A failed load never reaches the user: the list that shipped with the node is shown.
 */

const LIST_TTL_MS = 30 * 60 * 1000;
const WATCHLIST_TTL_MS = 5 * 60 * 1000;
const FAILURE_TTL_MS = 60 * 1000;
/** A value no tool accepts, used to make a tool name its accepted values. */
const PROBE_VALUE = '__list_options__';
/** Pro accounts have 5,000 calls a day, Free 200 (100 from December), guests 25. */
const PRO_DAILY_LIMIT = 1000;

interface CacheEntry {
	at: number;
	ttl: number;
	value: Promise<unknown>;
}

const cache = new Map<string, CacheEntry>();

/** Forgets everything that was loaded. Used by tests. */
export function clearOptionCache(): void {
	cache.clear();
}

/** A loader runs once per key within its cache lifetime. A load that failed (it returned
 * the fallback) is kept for less, so the next editor open tries again soon. */
async function cached<T>(
	key: string,
	load: () => Promise<{ value: T; ok: boolean }>,
	ttl = LIST_TTL_MS,
): Promise<T> {
	const hit = cache.get(key);
	if (hit && Date.now() - hit.at < hit.ttl) return (await hit.value) as T;

	const entry: CacheEntry = {
		at: Date.now(),
		ttl,
		value: load().then(({ value, ok }) => {
			if (!ok) entry.ttl = FAILURE_TTL_MS;
			return value;
		}),
	};
	cache.set(key, entry);
	return (await entry.value) as T;
}

/** Which credential the node uses, as a cache key. It never contains the key or token. */
function credentialKey(ctx: ILoadOptionsFunctions): string {
	const authentication = ctx.getNodeParameter('authentication', 'apiKey') as string;
	const credentials = ctx.getNode().credentials ?? {};
	if (authentication === 'oAuth2') {
		const c = credentials.stocklakeOAuth2Api;
		return `oauth2:${c?.id ?? c?.name ?? ''}`;
	}
	const c = credentials.stocklakeApi;
	return c ? `apiKey:${c.id ?? c.name ?? ''}` : 'guest';
}

/** Whether the node runs with a credential at all (a guest has no watchlist). */
function hasCredential(ctx: ILoadOptionsFunctions): boolean {
	return credentialKey(ctx) !== 'guest';
}

interface ProbeAnswer {
	/** The tool's error message for the impossible value, if it gave one. */
	message?: string;
	/** Daily call limit the API reported with the answer. */
	dailyLimit?: number;
	/** The payload of a call that succeeded. */
	payload?: IDataObject;
}

function headerNumber(headers: IDataObject | undefined, name: string): number | undefined {
	if (!headers) return undefined;
	const wanted = name.toLowerCase();
	for (const [key, value] of Object.entries(headers)) {
		if (key.toLowerCase() === wanted) {
			const n = Number(value);
			return Number.isFinite(n) ? n : undefined;
		}
	}
	return undefined;
}

function parseJson(text: string): IDataObject | undefined {
	try {
		const parsed = JSON.parse(text) as unknown;
		return typeof parsed === 'object' && parsed !== null ? (parsed as IDataObject) : undefined;
	} catch {
		return undefined;
	}
}

/** One tool call from a dropdown loader. Throws on an HTTP failure (401, 429, network). */
async function call(
	ctx: ILoadOptionsFunctions,
	toolName: string,
	toolArguments: IDataObject,
): Promise<ProbeAnswer> {
	const options: IHttpRequestOptions = {
		method: 'POST',
		url: STOCKLAKE_MCP_URL,
		headers: {
			'Content-Type': 'application/json',
			Accept: 'application/json, text/event-stream',
			'User-Agent': USER_AGENT,
		},
		body: {
			jsonrpc: '2.0',
			id: `n8n-options-${Date.now()}`,
			method: 'tools/call',
			params: { name: toolName, arguments: toolArguments },
		},
		json: true,
		returnFullResponse: true,
	};

	const authentication = ctx.getNodeParameter('authentication', 'apiKey') as string;
	let response: unknown;
	if (authentication === 'oAuth2') {
		response = await ctx.helpers.httpRequestWithAuthentication.call(
			ctx,
			'stocklakeOAuth2Api',
			options,
		);
	} else if (ctx.getNode().credentials?.stocklakeApi !== undefined) {
		response = await ctx.helpers.httpRequestWithAuthentication.call(ctx, 'stocklakeApi', options);
	} else {
		response = await ctx.helpers.httpRequest(options);
	}

	const full = response as { body?: IDataObject; headers?: IDataObject };
	const body = (full.body ?? {}) as IDataObject;
	const result = body.result as IDataObject | undefined;
	const answer: ProbeAnswer = { dailyLimit: headerNumber(full.headers, 'x-ratelimit-limit') };

	let payload = result?.structuredContent as IDataObject | undefined;
	if (!payload) {
		const content = result?.content as Array<{ text?: string }> | undefined;
		payload = parseJson(content?.[0]?.text ?? '');
	}
	const error = payload?.error;
	if (typeof error === 'object' && error !== null) {
		answer.message = (error as IDataObject).message as string | undefined;
	} else if (typeof error === 'string') {
		answer.message = (payload?.message as string | undefined) ?? error;
	} else if (payload) {
		answer.payload = payload;
	}
	return answer;
}

/** "sector must be one of: A, B, C" and "unknown type 'x'; valid types: a, b" -> [A, B, C]. */
export function parseAcceptedValues(message: string | undefined): string[] {
	if (!message) return [];
	const match = /(?:must be one of|valid [a-z ]*?):\s*(.+)$/i.exec(message);
	if (!match) return [];
	return match[1]
		.replace(/\.$/, '')
		.split(',')
		.map((value) => value.trim().replace(/^['"]|['"]$/g, ''))
		.filter((value) => value.length > 0);
}

interface Loaded {
	values: string[];
	ok: boolean;
}

/** Loads the accepted values of one argument by asking with an impossible one. */
async function loadAccepted(
	ctx: ILoadOptionsFunctions,
	toolName: string,
	toolArguments: IDataObject,
): Promise<Loaded & { dailyLimit?: number }> {
	try {
		const answer = await call(ctx, toolName, toolArguments);
		const values = parseAcceptedValues(answer.message);
		return { values, ok: values.length > 0, dailyLimit: answer.dailyLimit };
	} catch {
		return { values: [], ok: false };
	}
}

/** The screener's preset probe also tells the tier, so one call serves both. */
function presetProbe(ctx: ILoadOptionsFunctions) {
	return cached(`${credentialKey(ctx)}|presetProbe`, async () => {
		const loaded = await loadAccepted(ctx, 'get_screener', { preset: PROBE_VALUE, limit: 1 });
		return { value: loaded, ok: loaded.ok };
	});
}

/** True only when the API said this credential has the Pro daily limit. Unknown counts
 * as not Pro, so a Pro-only tool is never called on a guess. */
export async function isProCredential(ctx: ILoadOptionsFunctions): Promise<boolean> {
	if (!hasCredential(ctx)) return false;
	const probe = await presetProbe(ctx);
	return probe.dailyLimit !== undefined && probe.dailyLimit >= PRO_DAILY_LIMIT;
}

function fallbackOrLoaded(loaded: Loaded, fallback: string[]): string[] {
	return loaded.ok ? loaded.values : fallback;
}

const ANY: INodePropertyOptions = { name: 'Any', value: '' };
const ALL_SECTORS: INodePropertyOptions = { name: 'All 11 Sectors (Rotation View)', value: '' };

async function sectorValues(ctx: ILoadOptionsFunctions): Promise<string[]> {
	return await cached(`${credentialKey(ctx)}|sectors`, async () => {
		const loaded = await loadAccepted(ctx, 'get_screener', { sector: PROBE_VALUE, limit: 1 });
		return { value: fallbackOrLoaded(loaded, FALLBACK_VALUES.sectors), ok: loaded.ok };
	});
}

export async function getSectors(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
	return toOptions('sectors', await sectorValues(this), ANY);
}

export async function getSectorsForRotation(
	this: ILoadOptionsFunctions,
): Promise<INodePropertyOptions[]> {
	return toOptions('sectors', await sectorValues(this), ALL_SECTORS);
}

export async function getScreenerPresets(
	this: ILoadOptionsFunctions,
): Promise<INodePropertyOptions[]> {
	const probe = await presetProbe(this);
	const values = fallbackOrLoaded(probe, FALLBACK_VALUES.presets);
	return toOptions('presets', values, { name: 'None (Use Filters Below)', value: '' });
}

export async function getActivityTypes(
	this: ILoadOptionsFunctions,
): Promise<INodePropertyOptions[]> {
	const values = await cached(`${credentialKey(this)}|activityTypes`, async () => {
		const loaded = await loadAccepted(this, 'get_stock_activity', {
			symbol: 'AAPL',
			types: [PROBE_VALUE],
			limit: 1,
		});
		return { value: fallbackOrLoaded(loaded, FALLBACK_VALUES.activityTypes), ok: loaded.ok };
	});
	return toOptions('activityTypes', values);
}

/** get_signals is Pro-only: for any other credential the list that shipped is used and
 * the tool is not called. */
async function signalValues(
	ctx: ILoadOptionsFunctions,
	argument: 'source' | 'direction',
	fallback: string[],
): Promise<string[]> {
	if (!(await isProCredential(ctx))) return fallback;
	return await cached(`${credentialKey(ctx)}|signal:${argument}`, async () => {
		const loaded = await loadAccepted(ctx, 'get_signals', { [argument]: PROBE_VALUE, limit: 1 });
		return { value: fallbackOrLoaded(loaded, fallback), ok: loaded.ok };
	});
}

export async function getSignalSources(
	this: ILoadOptionsFunctions,
): Promise<INodePropertyOptions[]> {
	const values = await signalValues(this, 'source', FALLBACK_VALUES.signalSources);
	return toOptions('signalSources', values, { name: 'All', value: '' });
}

export async function getSignalDirections(
	this: ILoadOptionsFunctions,
): Promise<INodePropertyOptions[]> {
	const values = await signalValues(this, 'direction', FALLBACK_VALUES.signalDirections);
	return toOptions('signalDirections', values, { name: 'All', value: '' });
}

interface WatchlistEntry {
	symbol: string;
	name: string;
}

/** The credential's watchlist. Pro only, so a free credential or a guest gets an empty
 * list without a call. Each returned item counts as a call, hence the cache. */
async function watchlist(ctx: ILoadOptionsFunctions): Promise<WatchlistEntry[]> {
	if (!(await isProCredential(ctx))) return [];
	return await cached(
		`${credentialKey(ctx)}|watchlist`,
		async () => {
			try {
				const answer = await call(ctx, 'get_watchlist', {});
				const items = (answer.payload?.items ?? []) as IDataObject[];
				const entries = items
					.filter((item) => typeof item.symbol === 'string')
					.map((item) => ({
						symbol: item.symbol as string,
						name: (item.name as string | undefined) ?? '',
					}));
				return { value: entries, ok: answer.message === undefined };
			} catch {
				return { value: [] as WatchlistEntry[], ok: false };
			}
		},
		WATCHLIST_TTL_MS,
	);
}

/** Symbol search for the "From List" mode of a symbol field in version 2: the same
 * autocomplete as before, with the credential's watchlist first. With nothing typed it
 * lists the watchlist (Pro); a free credential sees what it saw before. */
export async function searchSymbolsWithWatchlist(
	this: ILoadOptionsFunctions,
	filter?: string,
): Promise<{ results: Array<{ name: string; value: string }> }> {
	const term = (filter ?? '').trim();
	const starred = await watchlist(this);
	const mark = (entry: WatchlistEntry) => ({
		name: `★ ${entry.symbol}${entry.name ? ` — ${entry.name}` : ''} (watchlist)`,
		value: entry.symbol,
	});

	if (term.length === 0) return { results: starred.map(mark) };

	const needle = term.toLowerCase();
	const mine = starred.filter(
		(entry) =>
			entry.symbol.toLowerCase().includes(needle) || entry.name.toLowerCase().includes(needle),
	);

	let found: Array<{ name: string; value: string }> = [];
	try {
		const response = (await this.helpers.httpRequest({
			method: 'GET',
			url: STOCKLAKE_SEARCH_URL,
			qs: { q: term },
			json: true,
		})) as { results?: Array<{ symbol: string; name: string }> };
		found = (response.results ?? []).map((r) => ({
			name: `${r.symbol} — ${r.name}`,
			value: r.symbol,
		}));
	} catch (error) {
		// Without the autocomplete the watchlist matches are still worth showing.
		if (mine.length === 0) throw new NodeApiError(this.getNode(), error as JsonObject);
	}

	const first = new Set(mine.map((entry) => entry.symbol));
	return { results: [...mine.map(mark), ...found.filter((r) => !first.has(r.value))] };
}
