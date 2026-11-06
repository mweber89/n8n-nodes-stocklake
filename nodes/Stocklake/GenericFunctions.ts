import type {
	IExecuteFunctions,
	IDataObject,
	ILoadOptionsFunctions,
	IHttpRequestOptions,
	INode,
	JsonObject,
} from 'n8n-workflow';
import { NodeApiError, NodeOperationError, sleep } from 'n8n-workflow';

export const STOCKLAKE_MCP_URL = 'https://api.stocklake.dev/mcp';
/** Sent with every request. */
export const USER_AGENT = 'n8n-nodes-stocklake';
export const STOCKLAKE_SEARCH_URL = 'https://api.stocklake.dev/api/search';

interface McpContent {
	type: string;
	text?: string;
}

interface McpToolResult {
	content?: McpContent[];
	structuredContent?: IDataObject;
	isError?: boolean;
}

interface McpJsonRpcResponse {
	jsonrpc: '2.0';
	id: string | number;
	result?: McpToolResult;
	// `data` is not always an object — a protocol-level rejection sends an empty
	// string for it — so this stays deliberately loose rather than IDataObject.
	error?: { code: number; message: string; data?: unknown };
}

/** What the node shows in the n8n UI for a failed call: a short, actionable
 * headline plus optional secondary detail. */
interface ApiErrorText {
	message: string;
	description?: string;
	/** True when the day's allowance is used up: nothing more can succeed in this run. */
	stopsRun?: boolean;
}

/**
 * The API signals failure in three different shapes depending on which layer
 * rejected the call, and only one of them is a JSON-RPC `error` (all three
 * confirmed against api.stocklake.dev):
 *
 *   1. HTTP non-2xx        — bad/inactive key (401), rate limit (429). Thrown by
 *                            the HTTP helper before we ever see a body.
 *   2. result.isError      — tier rejection (`pro_required`) and unknown-tool or
 *                            bad-argument errors. HTTP is 200 and there is NO
 *                            structuredContent; the payload is a JSON string
 *                            (or, for unknown-tool, plain text) in content[0].text.
 *   3. structuredContent.error — a per-tool application error inside an otherwise
 *                            successful envelope (isError is false): symbol_not_found,
 *                            history_not_found, invalid_preset, ...
 *
 * Shape 3 is the dangerous one: returned as-is it becomes a *successful* node
 * item whose json is `{ error: {...} }`, so a typo'd ticker would flow silently
 * downstream behind a green checkmark. All three are normalised here instead.
 *
 * Note this must NOT treat a partial batch miss as a failure — get_stocks reports
 * unresolved symbols in a `missing` array alongside real results, and an empty
 * screener result is `count: 0`. Neither sets `error`, so only the explicit
 * `error` key is treated as a failure.
 */
function describeApiError(
	payload: unknown,
	fallback: string,
	context?: ApiCallContext,
): ApiErrorText {
	if (typeof payload !== 'object' || payload === null) {
		return { message: fallback, description: describePlainError(fallback) };
	}

	const body = payload as IDataObject;
	const err = body.error;

	// Per-tool application error: { error: { code, message, type } }
	if (typeof err === 'object' && err !== null) {
		const inner = err as IDataObject;
		const message = (inner.message as string) ?? (inner.code as string) ?? fallback;
		const code = inner.code as string | undefined;
		return { message, description: describeToolError(inner, code, context) };
	}

	// Tier rejection: { error: "pro_required", message, tell_your_user, preview, ... }.
	// Both `message` and `tell_your_user` are written for an AI agent deciding
	// whether to prompt for an upgrade, and run to several hundred characters of
	// OAuth-connector advice that doesn't apply inside n8n — so this states the
	// same thing in one line an n8n user can act on, and keeps the API's own
	// wording as secondary detail rather than discarding it.
	if (err === 'pro_required') {
		const note = (body.preview_note as string) ?? (body.tell_your_user as string);
		return {
			message:
				'This operation requires a Stocklake Pro account. Upgrade at https://stocklake.dev/account — Pro is enabled on the account, so your existing credential keeps working and needs no reconnect.',
			description: [
				`Plan needed: Pro. A free account or a guest cannot run ${context?.toolName ?? 'this operation'}.`,
				note,
			]
				.filter(Boolean)
				.join(' '),
		};
	}

	if (typeof err === 'string') {
		return { message: (body.message as string) ?? err, description: err };
	}

	return { message: (body.message as string) ?? fallback };
}

/** What a failed tool call was asked for, so an error can name it. */
interface ApiCallContext {
	toolName: string;
	toolArguments: IDataObject;
}

/** The symbol (or first symbol) of a call, for "this ticker was not found". */
function symbolOf(context?: ApiCallContext): string | undefined {
	const args = context?.toolArguments;
	if (!args) return undefined;
	if (typeof args.symbol === 'string' && args.symbol) return args.symbol;
	if (Array.isArray(args.symbols) && args.symbols.length > 0) return String(args.symbols[0]);
	return undefined;
}

/** An application error of one tool: say what to do about it, by error class. */
function describeToolError(
	inner: IDataObject,
	code: string | undefined,
	context?: ApiCallContext,
): string {
	const tail = code ? ` (Stocklake error code: ${code})` : '';
	if (code === 'symbol_not_found' || inner.type === 'not_found') {
		const symbol = symbolOf(context);
		const named = symbol ? `The symbol "${symbol}"` : 'The symbol';
		return `${named} is not in Stocklake. Use the exact ticker, with the exchange suffix for listings outside the US (SAP.DE, BP.L, 7203.T), or pick it from the symbol list.${tail}`;
	}
	if (code?.startsWith('invalid_') || code === 'batch_too_large') {
		const accepted = ['accepted', 'allowed', 'valid_values', 'valid']
			.map((k) => inner[k])
			.find(Array.isArray);
		const values = accepted ? ` Accepted values: ${(accepted as unknown[]).join(', ')}.` : '';
		return `Stocklake did not accept a value in this call. Change the field the message names and run again.${values}${tail}`;
	}
	return `Stocklake error code: ${code ?? 'unknown'}`;
}

/** A plain-text failure (no JSON): an unknown tool, or an input check of the server. */
function describePlainError(text: string): string | undefined {
	if (/^unknown tool/i.test(text)) {
		return 'This version of the node asks for a tool the API does not have. Update the node (Settings > Community Nodes > Update) or report it at https://github.com/mweber89/n8n-nodes-stocklake/issues.';
	}
	if (/validation error|invalid (input|argument|parameter)/i.test(text)) {
		return 'Stocklake rejected a value of this call. Check the fields of this operation against the allowed values shown in the field descriptions.';
	}
	return undefined;
}

/** Parses a JSON payload, returning undefined rather than throwing on non-JSON. */
function tryParseJson(text: string): unknown {
	try {
		return JSON.parse(text) as unknown;
	} catch {
		return undefined;
	}
}

/** What a failed HTTP call looked like: its status, its response headers (lower-cased
 * names) and, when there was one, its JSON body. n8n's HTTP helper reports the same
 * failure under different keys depending on the version and the transport, so every
 * place it is known to appear is checked. */
interface HttpFailure {
	status?: number;
	body?: IDataObject;
	headers?: IDataObject;
}

function asRecord(value: unknown): IDataObject | undefined {
	if (typeof value === 'string') {
		const parsed = tryParseJson(value);
		return typeof parsed === 'object' && parsed !== null ? (parsed as IDataObject) : undefined;
	}
	return typeof value === 'object' && value !== null && !Array.isArray(value)
		? (value as IDataObject)
		: undefined;
}

/** The same object with lower-case keys, since HTTP header names are case-insensitive. */
function lowerKeys(value: unknown): IDataObject | undefined {
	const record = asRecord(value);
	if (!record) return undefined;
	const out: IDataObject = {};
	for (const [key, entry] of Object.entries(record)) out[key.toLowerCase()] = entry;
	return out;
}

/** A numeric response header, or undefined when absent or not a number. */
function headerNumber(headers: IDataObject | undefined, name: string): number | undefined {
	const raw = headers?.[name];
	const first = Array.isArray(raw) ? raw[0] : raw;
	if (first === undefined || first === null || first === '') return undefined;
	const value = Number(first);
	return Number.isFinite(value) ? value : undefined;
}

export function httpFailure(error: unknown): HttpFailure {
	const e = (error ?? {}) as IDataObject;
	const response = (e.response ??
		(e.cause as IDataObject | undefined)?.response ??
		{}) as IDataObject;
	const statusRaw =
		response.status ?? response.statusCode ?? e.httpCode ?? e.statusCode ?? e.status;
	const status = statusRaw === undefined ? undefined : Number(statusRaw);
	const body =
		asRecord(response.data) ?? asRecord(response.body) ?? asRecord(e.error) ?? asRecord(e.body);
	const headers = lowerKeys(response.headers) ?? lowerKeys(e.headers);
	return { status: Number.isFinite(status) ? status : undefined, body, headers };
}

const CREDENTIAL_HELP =
	'Open the node, set Authentication, and add a Stocklake credential: OAuth2 (sign in with an email link, no key to copy) or an API key from https://stocklake.dev/login. A free account has its own 200 calls a day.';

/**
 * Turns the API's three different 401 answers, and its 429, into messages an n8n user can
 * act on. n8n would otherwise show its generic "Authorization failed - please check your
 * credentials" for all of them, which is wrong for two of the three: nothing is wrong
 * with a credential the user never added.
 *   - guest limit used up   (no credential; the 25 calls a day are shared by a network)
 *   - Pro operation as guest (no credential)
 *   - key rejected           (a credential that is invalid or switched off)
 * Returns undefined for anything else, which keeps n8n's own message.
 */
export function describeAuthFailure(
	failure: HttpFailure,
	credentialAttached: boolean,
): ApiErrorText | undefined {
	const { status, body } = failure;
	if (status === 429) return describeRateLimit(classifyRateLimit(failure, 0), failure.body, 0);
	if (!body) return undefined;

	if (status !== 401) return undefined;

	const error = body.error;
	const reason =
		typeof error === 'object' && error !== null
			? ((error as IDataObject).data as IDataObject | undefined)?.reason
			: undefined;

	if (reason === 'guest_limit_reached') {
		return {
			message:
				'The free guest limit is used up: 25 calls a day without a credential, shared by everyone calling from the same network address.',
			description: `${CREDENTIAL_HELP} Guest calls reset at 00:00 UTC.`,
			stopsRun: true,
		};
	}
	if (reason === 'pro_tool_unauthenticated') {
		return {
			message:
				'This operation requires a Stocklake Pro account, and this node has no credential attached.',
			description: `${CREDENTIAL_HELP} The account needs the Pro plan for this operation.`,
		};
	}
	if (typeof error === 'string' && /invalid or inactive api key/i.test(error)) {
		return {
			message: 'Stocklake rejected the API key: it is invalid or switched off.',
			description: credentialAttached
				? 'Check the key in the Stocklake API credential, or create a new one at https://stocklake.dev/account. Using OAuth2 instead avoids keys altogether.'
				: CREDENTIAL_HELP,
		};
	}
	return undefined;
}

// ---------------------------------------------------------------------------
// Rate limits
// ---------------------------------------------------------------------------

/** Retries after a 429 that is not a used-up allowance (node version 2 option). */
export const DEFAULT_MAX_RETRIES = 3;
/** How long one request may take before the node gives up (node version 2 option). */
export const DEFAULT_TIMEOUT_MS = 30_000;
/** The longest single wait before a retry. A server that asks for more is not retried. */
export const MAX_RETRY_WAIT_MS = 30_000;
const BACKOFF_BASE_MS = 1_000;

/** How the node waits. Tests replace `sleep` so a retry does not wait at all. */
export const timing = { sleep: (ms: number): Promise<void> => sleep(ms) };

/**
 * What a 429 means. The API sends it in three situations that need three different
 * answers, so reading only the status would be wrong for two of them:
 *   daily     the day's allowance is used up (x-ratelimit-remaining: 0). Waiting does not
 *             help before 00:00 UTC, so the node stops and says so.
 *   batch     calls are left, but fewer than this request costs (remaining > 0). A
 *             smaller request fits; retrying the same one never will.
 *   long      the server asks to wait longer than the node is willing to.
 *   transient anything else: retried after Retry-After, or an exponential backoff.
 */
export interface RateLimit {
	kind: 'daily' | 'batch' | 'long' | 'transient';
	limit?: number;
	remaining?: number;
	/** Epoch seconds of the next reset, when the API said. */
	resetAt?: number;
	/** Seconds the server asked to wait, when it said. */
	retryAfter?: number;
	/** How long the node waits before the next attempt (transient only). */
	waitMs: number;
}

/** Retry-After is a number of seconds or an HTTP date. */
function retryAfterSeconds(raw: unknown): number | undefined {
	const first = Array.isArray(raw) ? raw[0] : raw;
	if (first === undefined || first === null || first === '') return undefined;
	const seconds = Number(first);
	if (Number.isFinite(seconds)) return Math.max(0, seconds);
	const date = Date.parse(String(first));
	return Number.isNaN(date) ? undefined : Math.max(0, Math.ceil((date - Date.now()) / 1000));
}

export function classifyRateLimit(failure: HttpFailure, attempt: number): RateLimit {
	const { headers, body } = failure;
	const remaining = headerNumber(headers, 'x-ratelimit-remaining');
	const base = {
		limit: headerNumber(headers, 'x-ratelimit-limit') ?? (body?.limit as number | undefined),
		remaining,
		resetAt: headerNumber(headers, 'x-ratelimit-reset'),
		retryAfter: retryAfterSeconds(headers?.['retry-after']),
	};
	const text = typeof body?.error === 'string' ? body.error : '';
	if (remaining === 0 || /daily limit/i.test(text)) return { kind: 'daily', ...base, waitMs: 0 };
	if (remaining !== undefined && remaining > 0) return { kind: 'batch', ...base, waitMs: 0 };

	const asked = base.retryAfter === undefined ? undefined : base.retryAfter * 1000;
	if (asked !== undefined && asked > MAX_RETRY_WAIT_MS) return { kind: 'long', ...base, waitMs: 0 };
	const backoff = Math.min(BACKOFF_BASE_MS * 2 ** attempt, MAX_RETRY_WAIT_MS);
	return { kind: 'transient', ...base, waitMs: asked ?? backoff };
}

function hoursUntil(epochSeconds: number | undefined): string {
	if (epochSeconds === undefined) return '';
	const hours = Math.max(0, (epochSeconds * 1000 - Date.now()) / 3_600_000);
	if (hours >= 1.5) return ` That is in about ${Math.round(hours)} hours.`;
	return ` That is in about ${Math.max(1, Math.round(hours * 60))} minutes.`;
}

/** The message and what-to-do text for a 429 the node will not (or no longer) retry. */
export function describeRateLimit(
	limit: RateLimit,
	body: IDataObject | undefined,
	retries: number,
): ApiErrorText {
	const apiText = typeof body?.error === 'string' ? body.error : undefined;
	if (limit.kind === 'daily') {
		const named = apiText && /daily limit/i.test(apiText);
		const calls = limit.limit === undefined ? '' : ` (${limit.limit} calls a day)`;
		return {
			message: `${named ? apiText : `Daily limit reached${calls}`}. Resets at 00:00 UTC.`,
			description: `The node did not retry, because waiting does not help before the reset.${hoursUntil(limit.resetAt)} Run the workflow again after 00:00 UTC, spread the calls over more days, or use a plan with a higher daily allowance (https://stocklake.dev/account).`,
			stopsRun: true,
		};
	}
	if (limit.kind === 'batch') {
		return {
			message: apiText ?? `Not enough calls left today (${limit.remaining} left)`,
			description: `${limit.remaining} calls are left today, and this request costs one call per ticker. Ask for less: lower Limit, or send fewer symbols. The node did not retry, since the same request would be refused again.`,
		};
	}
	if (limit.kind === 'long') {
		return {
			message: `Stocklake asked to wait ${limit.retryAfter} seconds before the next call`,
			description: `That is longer than the node waits (${MAX_RETRY_WAIT_MS / 1000} seconds), so it stopped. Run the workflow again later.`,
		};
	}
	return {
		message: `Stocklake is rate limiting this node${apiText ? `: ${apiText}` : ''}`,
		description:
			retries > 0
				? `Still limited after ${retries} ${retries === 1 ? 'retry' : 'retries'}. Raise Max Retries under Request Options, put a Wait node between runs, or run later.`
				: 'Retries are off. Set Max Retries under Request Options to retry with a backoff.',
	};
}

// ---------------------------------------------------------------------------
// What one execution has seen
// ---------------------------------------------------------------------------

/** Kept per execution (keyed by the execute context, which n8n creates for each run). */
interface CallState {
	/** Calls left today and the daily limit, from the newest response headers. */
	remaining?: number;
	dailyLimit?: number;
	/** Set once the day's allowance is used up: later calls fail at once, without a request. */
	stopped?: ApiErrorText;
	/** Execution hints already shown, so a hundred items add one hint, not a hundred. */
	hinted: Set<string>;
}

const callStates = new WeakMap<object, CallState>();

function callState(context: object): CallState {
	let state = callStates.get(context);
	if (!state) {
		state = { hinted: new Set() };
		callStates.set(context, state);
	}
	return state;
}

/** Whether this execution already hit a limit that ends the run (the day's allowance, the
 * guest limit): every further call would fail at once, so a caller that carries on after
 * a failure should not. */
export function runStopped(context: object): boolean {
	return callState(context).stopped !== undefined;
}

/** The newest "calls left today" figure of this execution, as the API reported it. */
export function allowanceSeen(context: object): {
	remainingCalls?: number;
	dailyLimit?: number;
} {
	const state = callStates.get(context);
	return { remainingCalls: state?.remaining, dailyLimit: state?.dailyLimit };
}

/** How the node was told to make requests. Version 1 keeps its original behaviour:
 * no retries, no timeout of its own, no hints. */
interface RequestSettings {
	version2: boolean;
	maxRetries: number;
	timeoutMs?: number;
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
	const n = Number(value);
	return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : fallback;
}

function requestSettings(
	context: IExecuteFunctions | ILoadOptionsFunctions,
	itemIndex: number,
): RequestSettings {
	if (Number(context.getNode().typeVersion ?? 1) < 2) return { version2: false, maxRetries: 0 };
	const chosen = (context.getNodeParameter('requestOptions', itemIndex, {}) ?? {}) as IDataObject;
	return {
		version2: true,
		maxRetries: clampInt(chosen.maxRetries, 0, 10, DEFAULT_MAX_RETRIES),
		timeoutMs: clampInt(chosen.timeout, 1_000, 600_000, DEFAULT_TIMEOUT_MS),
	};
}

// ---------------------------------------------------------------------------
// Transport failures
// ---------------------------------------------------------------------------

function errorCode(error: unknown): string | undefined {
	const e = (error ?? {}) as IDataObject;
	const code = e.code ?? (e.cause as IDataObject | undefined)?.code;
	return typeof code === 'string' ? code : undefined;
}

const TIMEOUT_CODES = new Set([
	'ECONNABORTED',
	'ETIMEDOUT',
	'ESOCKETTIMEDOUT',
	'UND_ERR_HEADERS_TIMEOUT',
]);
const NETWORK_CODES = new Set([
	'ENOTFOUND',
	'ECONNREFUSED',
	'ECONNRESET',
	'EAI_AGAIN',
	'EHOSTUNREACH',
]);

/** Timeouts, a server that cannot be reached, and 5xx: failures with no body to read. */
function describeTransportFailure(
	failure: HttpFailure,
	error: unknown,
	timeoutMs: number | undefined,
): ApiErrorText | undefined {
	const code = errorCode(error);
	const text = String((error as Error | undefined)?.message ?? '');
	if (failure.status === undefined) {
		if ((code && TIMEOUT_CODES.has(code)) || /timeout|timed out/i.test(text)) {
			const seconds = timeoutMs === undefined ? undefined : Math.round(timeoutMs / 1000);
			return {
				message: `Stocklake did not answer${seconds ? ` within ${seconds} seconds` : ' in time'}`,
				description:
					'Raise Timeout under Request Options, or run again. A long symbol list or Return All takes more than one request.',
			};
		}
		if (code && NETWORK_CODES.has(code)) {
			return {
				message: 'Could not reach api.stocklake.dev',
				description:
					'Check that this n8n instance can reach https://api.stocklake.dev (network, proxy and firewall rules), then run again.',
			};
		}
		return undefined;
	}
	if (failure.status >= 500) {
		return {
			message: `Stocklake had a problem on its side (HTTP ${failure.status})`,
			description: 'Nothing is wrong with the node or the credential. Run again in a few minutes.',
		};
	}
	return undefined;
}

// ---------------------------------------------------------------------------
// Execution hints for fields a free or guest credential does not get
// ---------------------------------------------------------------------------

/** What the API says about fields this plan leaves out. A free or guest answer carries
 * `pro_unlocks` (what Pro adds) and, for capped lists, a note that says what the cap is. */
export function planHints(toolName: string, payload: IDataObject): string[] {
	const hints: string[] = [];
	const text = (value: unknown): string | undefined => {
		if (typeof value === 'string') return value.trim() || undefined;
		if (Array.isArray(value)) {
			const joined = value.filter((v) => typeof v === 'string').join('; ');
			return joined || undefined;
		}
		return undefined;
	};
	const unlocks = text(payload.pro_unlocks);
	if (payload.pro_unlocks !== undefined && payload.pro_unlocks !== null) {
		hints.push(unlocks ? `Fields left out on this plan: ${unlocks}` : 'Some fields need Pro.');
	}
	for (const key of ['news_note', 'filings_note', 'items_note']) {
		const note = text(payload[key]);
		if (note) hints.push(`Capped on this plan: ${note}`);
	}
	// get_stock and get_stocks carry no note. Pro always adds a `rating`, free and guest never do.
	if (hints.length === 0) {
		const rows =
			toolName === 'get_stock'
				? [payload]
				: toolName === 'get_stocks' &&
					  typeof payload.symbols === 'object' &&
					  payload.symbols !== null
					? Object.values(payload.symbols as IDataObject).filter(
							(row): row is IDataObject => typeof row === 'object' && row !== null,
						)
					: [];
		if (rows.length > 0 && payload.error === undefined && rows.every((row) => !('rating' in row))) {
			hints.push(
				'Rating and AI fields need Pro: the rating, signals and AI summary are left out of this response.',
			);
		}
	}
	return hints;
}

function addPlanHints(context: object, toolName: string, payload: IDataObject): void {
	const add = (context as IExecuteFunctions).addExecutionHints;
	if (typeof add !== 'function') return;
	const state = callState(context);
	for (const message of planHints(toolName, payload)) {
		if (state.hinted.has(message)) continue;
		state.hinted.add(message);
		add.call(context, { message, location: 'outputPane' });
	}
}

// ---------------------------------------------------------------------------
// The request
// ---------------------------------------------------------------------------

let requestCounter = 0;

/** n8n answers with the body alone, or (returnFullResponse) with status, headers and body. */
function unwrapResponse(raw: unknown): { response: McpJsonRpcResponse; headers?: IDataObject } {
	const r = (raw ?? {}) as IDataObject;
	if ('statusCode' in r && 'body' in r) {
		return { response: r.body as McpJsonRpcResponse, headers: lowerKeys(r.headers) };
	}
	return { response: raw as McpJsonRpcResponse };
}

/**
 * Calls one Stocklake MCP tool over the Streamable HTTP transport and returns
 * the already-parsed payload. The server is stateless — no session/initialize
 * handshake is needed before tools/call (confirmed against api.stocklake.dev).
 *
 * Every tool response carries `structuredContent` pre-parsed alongside the
 * `content[0].text` JSON string, so this reads structuredContent first and
 * only falls back to parsing text for the rare plain-text tool error
 * (e.g. "Unknown tool: ...").
 *
 * Node version 2 also retries a 429 that is not a used-up allowance, applies the
 * Timeout option, remembers the allowance the response headers report (read with
 * `allowanceSeen`), and adds an execution hint when a free or guest credential gets
 * fewer fields. Once the day's allowance is used up, every later call of the same
 * execution fails at once without a request.
 */
export async function stocklakeApiRequest(
	this: IExecuteFunctions | ILoadOptionsFunctions,
	toolName: string,
	toolArguments: IDataObject,
	itemIndex = 0,
): Promise<IDataObject> {
	requestCounter += 1;
	const state = callState(this);
	if (state.stopped) {
		throw new NodeOperationError(this.getNode(), state.stopped.message, {
			itemIndex,
			description: state.stopped.description,
		});
	}
	const settings = requestSettings(this, itemIndex);
	const callContext: ApiCallContext = { toolName, toolArguments };

	const options: IHttpRequestOptions = {
		method: 'POST',
		url: STOCKLAKE_MCP_URL,
		headers: {
			'Content-Type': 'application/json',
			Accept: 'application/json, text/event-stream',
			// Says which client the traffic comes from, so usage from n8n can be told apart.
			'User-Agent': USER_AGENT,
		},
		body: {
			jsonrpc: '2.0',
			id: `n8n-${Date.now()}-${requestCounter}`,
			method: 'tools/call',
			params: {
				name: toolName,
				arguments: toolArguments,
			},
		},
		json: true,
		...(settings.version2 ? { returnFullResponse: true, timeout: settings.timeoutMs } : {}),
	};

	let credentialAttached = false;
	// "authentication" chooses OAuth2 vs. API-key. Under API-key, the
	// credential is itself optional (Layer 1 tools work as an unauthenticated
	// guest, 25 calls/day) — only attach auth when the user actually picked
	// one for this node. Under OAuth2 the credential is required (see the
	// node's own `credentials` array), so it's always attached.
	const authentication = this.getNodeParameter('authentication', itemIndex, 'apiKey') as string;
	const send = async (): Promise<unknown> => {
		if (authentication === 'oAuth2') {
			credentialAttached = true;
			return await this.helpers.httpRequestWithAuthentication.call(
				this,
				'stocklakeOAuth2Api',
				options,
			);
		}
		const hasApiKeyCredential = this.getNode().credentials?.stocklakeApi !== undefined;
		credentialAttached = hasApiKeyCredential;
		return hasApiKeyCredential
			? await this.helpers.httpRequestWithAuthentication.call(this, 'stocklakeApi', options)
			: await this.helpers.httpRequest(options);
	};

	let raw: unknown;
	for (let attempt = 0; ; attempt++) {
		try {
			raw = await send();
			break;
		} catch (error) {
			const failure = httpFailure(error);
			let friendly: ApiErrorText | undefined;
			if (failure.status === 429) {
				const limit = classifyRateLimit(failure, attempt);
				if (limit.kind === 'transient' && attempt < settings.maxRetries) {
					await timing.sleep(limit.waitMs);
					continue;
				}
				friendly = describeRateLimit(limit, failure.body, attempt);
			} else {
				friendly =
					describeAuthFailure(failure, credentialAttached) ??
					describeTransportFailure(failure, error, settings.timeoutMs);
			}
			if (friendly?.stopsRun) state.stopped = friendly;
			const apiError = new NodeApiError(this.getNode(), error as JsonObject, {
				itemIndex,
				...(friendly ? { message: friendly.message } : {}),
				...(failure.status !== undefined ? { httpCode: String(failure.status) } : {}),
			});
			// n8n replaces a description passed in the options with the API's own error text
			// when the response has a body, so ours is set afterwards.
			// The same goes for the message: n8n maps some error codes (ECONNABORTED, ENOTFOUND)
			// to its own wording after the options are applied.
			if (friendly) {
				apiError.message = friendly.message;
				apiError.description = friendly.description;
			}
			throw apiError;
		}
	}

	const { response, headers } = unwrapResponse(raw);
	const remaining = headerNumber(headers, 'x-ratelimit-remaining');
	if (remaining !== undefined) state.remaining = remaining;
	const dailyLimit = headerNumber(headers, 'x-ratelimit-limit');
	if (dailyLimit !== undefined) state.dailyLimit = dailyLimit;

	const payload = interpretResponse(this.getNode(), response, itemIndex, callContext);
	if (settings.version2) addPlanHints(this, toolName, payload);
	return payload;
}

/** Turns the three failure shapes into thrown errors and returns the payload otherwise. */
function interpretResponse(
	node: INode,
	response: McpJsonRpcResponse,
	itemIndex: number,
	callContext: ApiCallContext,
): IDataObject {
	// Shape 1 (see describeApiError): a protocol-level JSON-RPC rejection.
	if (response.error) {
		const { message, description } = describeApiError(
			response.error.data,
			response.error.message,
			callContext,
		);
		throw new NodeOperationError(node, message, {
			itemIndex,
			description:
				description ??
				`Stocklake refused the request itself (code ${response.error.code}). Update the node (Settings > Community Nodes > Update); if it persists, report it at https://github.com/mweber89/n8n-nodes-stocklake/issues.`,
		});
	}

	const result = response.result;
	if (!result) {
		throw new NodeOperationError(node, 'Stocklake API returned an empty response', {
			itemIndex,
			description: 'Run again. If it keeps happening, the API may be having a problem.',
		});
	}

	const text = result.content?.[0]?.text ?? '';

	// Shape 2: tier/tool rejection. HTTP 200, no structuredContent, payload is a
	// JSON string (or plain text for an unknown tool) in content[0].text.
	if (result.isError) {
		const { message, description } = describeApiError(
			tryParseJson(text),
			text || 'Stocklake API returned an error',
			callContext,
		);
		throw new NodeOperationError(node, message, { itemIndex, description });
	}

	if (result.structuredContent) {
		// Shape 3: an application error carried inside an otherwise-successful
		// envelope. Returning this as a normal item would report success for a
		// call that produced no data, so surface it as a real node error instead.
		if (result.structuredContent.error !== undefined) {
			const { message, description } = describeApiError(
				result.structuredContent,
				'Stocklake API returned an error',
				callContext,
			);
			throw new NodeOperationError(node, message, { itemIndex, description });
		}
		return result.structuredContent;
	}

	const parsed = tryParseJson(text);
	if (parsed !== undefined && typeof parsed === 'object' && parsed !== null) {
		const body = parsed as IDataObject;
		if (body.error !== undefined) {
			const { message, description } = describeApiError(
				body,
				'Stocklake API returned an error',
				callContext,
			);
			throw new NodeOperationError(node, message, { itemIndex, description });
		}
		return body;
	}

	// A tool response that is neither structured nor JSON (rare) is still worth
	// returning verbatim rather than failing the item.
	return { result: text };
}

/** Splits a "AAPL, MSFT , nvda" field into a clean, de-duplicated symbol array. */
export function parseSymbolList(raw: string): string[] {
	const symbols = raw
		.split(',')
		.map((s) => s.trim().toUpperCase())
		.filter((s) => s.length > 0);
	return [...new Set(symbols)];
}

/** Strips undefined/empty-string/null values so optional filters are omitted, not sent as "". */
export function cleanParams(params: IDataObject): IDataObject {
	const cleaned: IDataObject = {};
	for (const [key, value] of Object.entries(params)) {
		if (value === undefined || value === null || value === '') continue;
		cleaned[key] = value;
	}
	return cleaned;
}

/**
 * Resource Locator "From list" search backend for the Symbol field, backed by
 * Stocklake's public autocomplete endpoint (no API key required, ~30 req/min
 * per IP — documented in https://api.stocklake.dev/llms.txt).
 */
export async function searchSymbols(
	this: ILoadOptionsFunctions,
	filter?: string,
): Promise<{ results: Array<{ name: string; value: string }> }> {
	if (!filter || filter.trim().length === 0) {
		return { results: [] };
	}

	const response = (await this.helpers.httpRequest({
		method: 'GET',
		url: STOCKLAKE_SEARCH_URL,
		qs: { q: filter.trim() },
		json: true,
	})) as { results?: Array<{ symbol: string; name: string; sector?: string }> };

	return {
		results: (response.results ?? []).map((r) => ({
			name: `${r.symbol} — ${r.name}`,
			value: r.symbol,
		})),
	};
}
