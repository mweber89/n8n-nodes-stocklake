import type {
	IExecuteFunctions,
	IDataObject,
	ILoadOptionsFunctions,
	IHttpRequestOptions,
	JsonObject,
} from 'n8n-workflow';
import { NodeApiError, NodeOperationError } from 'n8n-workflow';

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
function describeApiError(payload: unknown, fallback: string): ApiErrorText {
	if (typeof payload !== 'object' || payload === null) {
		return { message: fallback };
	}

	const body = payload as IDataObject;
	const err = body.error;

	// Per-tool application error: { error: { code, message, type } }
	if (typeof err === 'object' && err !== null) {
		const inner = err as IDataObject;
		const message = (inner.message as string) ?? (inner.code as string) ?? fallback;
		const code = inner.code as string | undefined;
		return { message, description: code ? `Stocklake error code: ${code}` : undefined };
	}

	// Tier rejection: { error: "pro_required", message, tell_your_user, preview, ... }.
	// Both `message` and `tell_your_user` are written for an AI agent deciding
	// whether to prompt for an upgrade, and run to several hundred characters of
	// OAuth-connector advice that doesn't apply inside n8n — so this states the
	// same thing in one line an n8n user can act on, and keeps the API's own
	// wording as secondary detail rather than discarding it.
	if (err === 'pro_required') {
		return {
			message:
				'This operation requires a Stocklake Pro account. Upgrade at https://stocklake.dev/account — Pro is enabled on the account, so your existing credential keeps working and needs no reconnect.',
			description: (body.preview_note as string) ?? (body.tell_your_user as string),
		};
	}

	if (typeof err === 'string') {
		return { message: (body.message as string) ?? err, description: err };
	}

	return { message: (body.message as string) ?? fallback };
}

/** Parses a JSON payload, returning undefined rather than throwing on non-JSON. */
function tryParseJson(text: string): unknown {
	try {
		return JSON.parse(text) as unknown;
	} catch {
		return undefined;
	}
}

/** What a failed HTTP call looked like: its status and, when there was one, its JSON body.
 * n8n's HTTP helper reports the same failure under different keys depending on the
 * version and the transport, so every place it is known to appear is checked. */
interface HttpFailure {
	status?: number;
	body?: IDataObject;
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
	return { status: Number.isFinite(status) ? status : undefined, body };
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
	if (!body) return undefined;

	if (status === 429) {
		const text = typeof body.error === 'string' ? body.error : 'Stocklake rate limit reached';
		return {
			message: text,
			description:
				'Daily limits reset at 00:00 UTC. Wait a moment before retrying if this is a short burst.',
		};
	}
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

let requestCounter = 0;

/**
 * Calls one Stocklake MCP tool over the Streamable HTTP transport and returns
 * the already-parsed payload. The server is stateless — no session/initialize
 * handshake is needed before tools/call (confirmed against api.stocklake.dev).
 *
 * Every tool response carries `structuredContent` pre-parsed alongside the
 * `content[0].text` JSON string, so this reads structuredContent first and
 * only falls back to parsing text for the rare plain-text tool error
 * (e.g. "Unknown tool: ...").
 */
export async function stocklakeApiRequest(
	this: IExecuteFunctions | ILoadOptionsFunctions,
	toolName: string,
	toolArguments: IDataObject,
	itemIndex = 0,
): Promise<IDataObject> {
	requestCounter += 1;

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
	};

	let response: McpJsonRpcResponse;
	let credentialAttached = false;
	try {
		// "authentication" chooses OAuth2 vs. API-key. Under API-key, the
		// credential is itself optional (Layer 1 tools work as an unauthenticated
		// guest, 25 calls/day) — only attach auth when the user actually picked
		// one for this node. Under OAuth2 the credential is required (see the
		// node's own `credentials` array), so it's always attached.
		const authentication = this.getNodeParameter('authentication', itemIndex, 'apiKey') as string;
		if (authentication === 'oAuth2') {
			credentialAttached = true;
			response = (await this.helpers.httpRequestWithAuthentication.call(
				this,
				'stocklakeOAuth2Api',
				options,
			)) as McpJsonRpcResponse;
		} else {
			const hasApiKeyCredential = this.getNode().credentials?.stocklakeApi !== undefined;
			credentialAttached = hasApiKeyCredential;
			response = hasApiKeyCredential
				? ((await this.helpers.httpRequestWithAuthentication.call(
						this,
						'stocklakeApi',
						options,
					)) as McpJsonRpcResponse)
				: ((await this.helpers.httpRequest(options)) as McpJsonRpcResponse);
		}
	} catch (error) {
		const failure = httpFailure(error);
		const friendly = describeAuthFailure(failure, credentialAttached);
		const apiError = new NodeApiError(this.getNode(), error as JsonObject, {
			itemIndex,
			...(friendly ? { message: friendly.message } : {}),
			...(failure.status !== undefined ? { httpCode: String(failure.status) } : {}),
		});
		// n8n replaces a description passed in the options with the API's own error text
		// when the response has a body, so ours is set afterwards.
		if (friendly) apiError.description = friendly.description;
		throw apiError;
	}

	// Shape 1 (see describeApiError): a protocol-level JSON-RPC rejection.
	if (response.error) {
		const { message, description } = describeApiError(response.error.data, response.error.message);
		throw new NodeOperationError(this.getNode(), message, {
			itemIndex,
			description: description ?? response.error.message,
		});
	}

	const result = response.result;
	if (!result) {
		throw new NodeOperationError(this.getNode(), 'Stocklake API returned an empty response', {
			itemIndex,
		});
	}

	const text = result.content?.[0]?.text ?? '';

	// Shape 2: tier/tool rejection. HTTP 200, no structuredContent, payload is a
	// JSON string (or plain text for an unknown tool) in content[0].text.
	if (result.isError) {
		const { message, description } = describeApiError(
			tryParseJson(text),
			text || 'Stocklake API returned an error',
		);
		throw new NodeOperationError(this.getNode(), message, { itemIndex, description });
	}

	if (result.structuredContent) {
		// Shape 3: an application error carried inside an otherwise-successful
		// envelope. Returning this as a normal item would report success for a
		// call that produced no data, so surface it as a real node error instead.
		if (result.structuredContent.error !== undefined) {
			const { message, description } = describeApiError(
				result.structuredContent,
				'Stocklake API returned an error',
			);
			throw new NodeOperationError(this.getNode(), message, { itemIndex, description });
		}
		return result.structuredContent;
	}

	const parsed = tryParseJson(text);
	if (parsed !== undefined && typeof parsed === 'object' && parsed !== null) {
		const body = parsed as IDataObject;
		if (body.error !== undefined) {
			const { message, description } = describeApiError(body, 'Stocklake API returned an error');
			throw new NodeOperationError(this.getNode(), message, { itemIndex, description });
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
