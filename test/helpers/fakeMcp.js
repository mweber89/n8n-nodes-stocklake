'use strict';

/**
 * Fake Stocklake MCP server + fake n8n execution context.
 *
 * The node talks to Stocklake with one JSON-RPC `tools/call` POST per item.
 * `createFakeMcp` plays the server: it records the exact tool name and arguments
 * of every call and answers with canned responses, in the same envelope the real
 * API uses (structuredContent plus a JSON string in content[0].text).
 *
 * `runNode` drives a node's real `execute()` against it, so a test covers the
 * whole path: node parameters -> tool call -> response -> output items. Nothing
 * here touches the network.
 */

/**
 * @param {Record<string, unknown | ((args: object) => unknown)>} tools
 *   tool name -> canned structured response (or a function of the arguments).
 *   A response of the form `{ __rpcError: {...} }`, `{ __toolError: text }` or
 *   `{ __httpError: {...} }` makes the fake fail the way the real server does.
 */
function createFakeMcp(tools = {}, { dailyLimit = 200, search = () => [] } = {}) {
	const calls = [];
	const searches = [];

	async function handle(options, credentialName) {
		if (options.method === 'GET' && String(options.url).endsWith('/api/search')) {
			searches.push(options.qs?.q);
			return { results: search(options.qs?.q) };
		}
		const result = await handleToolCall(options, credentialName);
		// Like n8n with returnFullResponse: the body plus the response headers, as sent by the API.
		return options.returnFullResponse
			? { statusCode: 200, headers: { 'x-ratelimit-limit': String(dailyLimit) }, body: result }
			: result;
	}

	async function handleToolCall(options, credentialName) {
		const body = options.body;
		if (!body || body.method !== 'tools/call') {
			throw new Error(`Fake MCP only understands tools/call, got ${JSON.stringify(body)}`);
		}
		const toolName = body.params.name;
		const toolArguments = body.params.arguments;
		calls.push({
			toolName,
			arguments: toolArguments,
			url: options.url,
			credential: credentialName ?? null,
		});

		if (!(toolName in tools)) {
			return {
				jsonrpc: '2.0',
				id: body.id,
				result: { isError: true, content: [{ type: 'text', text: `Unknown tool: ${toolName}` }] },
			};
		}
		const entry = tools[toolName];
		const payload = typeof entry === 'function' ? entry(toolArguments) : entry;

		if (payload && payload.__httpError) {
			const err = new Error(payload.__httpError.message ?? 'HTTP error');
			Object.assign(err, payload.__httpError);
			throw err;
		}
		if (payload && payload.__rpcError) {
			return { jsonrpc: '2.0', id: body.id, error: payload.__rpcError };
		}
		if (payload && payload.__toolError !== undefined) {
			return {
				jsonrpc: '2.0',
				id: body.id,
				result: { isError: true, content: [{ type: 'text', text: payload.__toolError }] },
			};
		}
		return {
			jsonrpc: '2.0',
			id: body.id,
			result: { content: [{ type: 'text', text: JSON.stringify(payload) }], structuredContent: payload },
		};
	}

	return {
		calls,
		searches,
		httpRequest: (options) => handle(options, null),
		httpRequestWithAuthentication(credentialName, options) {
			return handle(options, credentialName);
		},
	};
}

/** Does one `displayOptions.show` clause accept the current parameter values? */
function showMatches(show, values) {
	return Object.entries(show ?? {}).every(([key, allowed]) => {
		const actual = values[key];
		return allowed.some((candidate) => {
			if (candidate !== null && typeof candidate === 'object' && candidate._cnd) {
				const cnd = candidate._cnd;
				if ('gte' in cnd) return actual >= cnd.gte;
				if ('gt' in cnd) return actual > cnd.gt;
				if ('lte' in cnd) return actual <= cnd.lte;
				if ('lt' in cnd) return actual < cnd.lt;
				if ('eq' in cnd) return actual === cnd.eq;
				if ('not' in cnd) return actual !== cnd.not;
				return false;
			}
			return candidate === actual;
		});
	});
}

/**
 * What n8n does before execute(): every parameter the user did not set takes the
 * default of the property that is visible for the current resource / operation /
 * version. Reproducing it keeps tests honest about the defaults the UI really sends.
 */
function resolveParameters(description, given, typeVersion) {
	const values = { ...given, '@version': typeVersion };
	for (const property of description.properties) {
		if (property.name in values) continue;
		const show = property.displayOptions?.show;
		const hide = property.displayOptions?.hide;
		if (show && !showMatches(show, values)) continue;
		if (hide && showMatches(hide, values)) continue;
		values[property.name] = property.default;
	}
	delete values['@version'];
	return values;
}

/** The node instance for one version, whether the class is versioned or not. */
function loadNode(NodeClass, version) {
	const instance = new NodeClass();
	if (instance.nodeVersions) return instance.nodeVersions[version];
	return instance;
}

/**
 * Runs `node.execute()` for the given items.
 *
 * @param {object} node          node instance for the version under test
 * @param {object} opts
 * @param {object | object[]} opts.params  user-set parameters (one object, or one per item)
 * @param {object} opts.fake     from createFakeMcp
 * @param {number} opts.typeVersion
 * @param {object[]} [opts.items]
 * @param {boolean} [opts.continueOnFail]
 * @param {boolean} [opts.apiKeyCredential]  whether an API-key credential is attached
 */
async function runNode(node, opts) {
	const { fake, typeVersion, continueOnFail = false, apiKeyCredential = false } = opts;
	const items = opts.items ?? [{ json: {} }];
	const perItem = Array.isArray(opts.params) ? opts.params : items.map(() => opts.params);
	const resolved = perItem.map((p) => resolveParameters(node.description, p, typeVersion));

	const context = {
		getInputData: () => items,
		getNodeParameter(name, itemIndex, fallback, options) {
			const values = resolved[itemIndex];
			if (!(name in values)) return fallback;
			const value = values[name];
			if (options?.extractValue && value !== null && typeof value === 'object' && value.__rl) {
				return value.value;
			}
			return value;
		},
		getNode: () => ({
			name: 'Stocklake',
			type: 'n8n-nodes-stocklake.stocklake',
			typeVersion,
			credentials: apiKeyCredential ? { stocklakeApi: { id: '1', name: 'Stocklake API' } } : undefined,
		}),
		continueOnFail: () => continueOnFail,
		helpers: {
			httpRequest: fake.httpRequest,
			httpRequestWithAuthentication: fake.httpRequestWithAuthentication,
			returnJsonArray: (data) => (Array.isArray(data) ? data : [data]).map((json) => ({ json })),
			constructExecutionMetaData: (data, { itemData }) =>
				data.map((d) => ({ ...d, pairedItem: itemData })),
		},
	};

	const output = await node.execute.call(context);
	return output;
}

/**
 * Runs a loadOptions / listSearch function the way the n8n editor does.
 *
 * @param {Function} method  the node's loader (called with an ILoadOptionsFunctions `this`)
 * @param {object} opts
 * @param {object} opts.fake  from createFakeMcp
 * @param {'apiKey'|'oAuth2'|'guest'} [opts.auth]  guest = apiKey authentication, no credential
 * @param {string} [opts.credentialId]
 * @param {string} [opts.filter]  search text for listSearch methods
 */
async function runLoader(method, { fake, auth = 'apiKey', credentialId = 'cred-1', filter } = {}) {
	const credentials =
		auth === 'oAuth2'
			? { stocklakeOAuth2Api: { id: credentialId, name: 'Stocklake OAuth2' } }
			: auth === 'apiKey'
				? { stocklakeApi: { id: credentialId, name: 'Stocklake API' } }
				: undefined;
	const context = {
		getNodeParameter: (name, fallback) =>
			name === 'authentication' ? (auth === 'oAuth2' ? 'oAuth2' : 'apiKey') : fallback,
		getNode: () => ({ name: 'Stocklake', type: 'n8n-nodes-stocklake.stocklake', credentials }),
		helpers: {
			httpRequest: fake.httpRequest,
			httpRequestWithAuthentication: fake.httpRequestWithAuthentication,
		},
	};
	return await method.call(context, filter);
}

module.exports = { createFakeMcp, loadNode, resolveParameters, runNode, runLoader };
