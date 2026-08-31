'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { stocklakeApiRequest } = require('../dist/nodes/Stocklake/GenericFunctions');

/**
 * Regression tests for the two error-handling bugs found 2026-08-31 by running
 * the node against the live API with real free/Pro keys:
 *
 *  - an application error carried in `structuredContent` (symbol_not_found and
 *    friends) was returned as a SUCCESSFUL item, so a typo'd ticker flowed
 *    downstream as `{ error: {...} }` behind a green checkmark;
 *  - an `isError: true` payload (the `pro_required` tier rejection, which is the
 *    single most likely failure a new free-tier user hits) was surfaced by
 *    dumping the entire ~1.5 KB JSON blob as the n8n error message.
 *
 * Every fixture below is a verbatim response shape captured from
 * api.stocklake.dev, not an invented one.
 */

function ctx(mcpResult) {
	return {
		getNode: () => ({ name: 'Stocklake', type: 'stocklake', credentials: {} }),
		getNodeParameter: (name, _i, fallback) => (name === 'authentication' ? 'apiKey' : fallback),
		helpers: {
			httpRequest: async () => ({ jsonrpc: '2.0', id: 'x', ...mcpResult }),
			httpRequestWithAuthentication: { call: async () => ({}) },
		},
	};
}

const callWith = (mcpResult) => stocklakeApiRequest.call(ctx(mcpResult), 'get_stock', {}, 0);

test('an application error inside structuredContent throws instead of returning a "successful" item', async () => {
	await assert.rejects(
		callWith({
			result: {
				isError: false,
				structuredContent: {
					error: {
						code: 'symbol_not_found',
						message: "No data found for 'ZZZZNOTREAL'",
						type: 'not_found',
					},
				},
			},
		}),
		(err) => {
			assert.match(err.message, /No data found for 'ZZZZNOTREAL'/);
			assert.match(err.description, /symbol_not_found/);
			return true;
		},
	);
});

test('a pro_required rejection surfaces one actionable line, not the raw JSON payload', async () => {
	// Abridged only in the fields that don't matter here; `message` and
	// `tell_your_user` are the real, several-hundred-character agent-facing text.
	const payload = {
		error: 'pro_required',
		your_tier: 'free',
		message:
			'This tool needs Pro tier. IF YOU (the AI agent) SUPPORT OAUTH: add https://api.stocklake.dev/mcp as a connector (if not already), then have the user upgrade at https://stocklake.dev/account — tier lives on the account, not a separate credential, so an existing OAuth connection needs no reconnect, no new key.',
		tell_your_user:
			'If your AI client supports OAuth (Claude, ChatGPT connectors, etc): add https://api.stocklake.dev/mcp as a connector, then upgrade from your account page — no key needed.',
		upgrade: 'https://stocklake.dev/login',
		preview: { symbol: 'COIN', verdict: 'NEUTRAL' },
		preview_note: 'Pro unlocks the full research bundle.',
	};

	await assert.rejects(
		callWith({ result: { isError: true, content: [{ type: 'text', text: JSON.stringify(payload) }] } }),
		(err) => {
			assert.match(err.message, /requires a Stocklake Pro account/);
			assert.match(err.message, /stocklake\.dev\/account/);
			// The whole point: the message is a readable line, not the JSON blob.
			assert.ok(
				err.message.length < 300,
				`expected a concise message, got ${err.message.length} chars`,
			);
			assert.doesNotMatch(err.message, /IF YOU \(the AI agent\)/);
			assert.doesNotMatch(err.message, /"your_tier"/);
			return true;
		},
	);
});

test('a partial batch miss is NOT an error — missing symbols are normal output', async () => {
	const structuredContent = {
		count: 1,
		symbols: [{ symbol: 'AAPL' }],
		requested: 2,
		missing: ['ZZZZNOTREAL'],
		duplicates_collapsed: 0,
	};
	assert.deepEqual(await callWith({ result: { isError: false, structuredContent } }), structuredContent);
});

test('an empty screener result is NOT an error — count 0 is a valid answer', async () => {
	const structuredContent = { count: 0, preset: null, filters: {}, results: [] };
	assert.deepEqual(await callWith({ result: { isError: false, structuredContent } }), structuredContent);
});

test('a plain-text isError payload (unknown tool) is surfaced verbatim', async () => {
	await assert.rejects(
		callWith({
			result: { isError: true, content: [{ type: 'text', text: "Unknown tool: 'get_nope'" }] },
		}),
		/Unknown tool: 'get_nope'/,
	);
});

test('a JSON-RPC protocol error is surfaced with its own message', async () => {
	await assert.rejects(
		callWith({ error: { code: -32602, message: 'Invalid request parameters', data: '' } }),
		/Invalid request parameters/,
	);
});

test('a normal successful response is returned unchanged', async () => {
	const structuredContent = { symbol: 'AAPL', price: 316.85 };
	assert.deepEqual(await callWith({ result: { isError: false, structuredContent } }), structuredContent);
});

test('an empty response envelope is an error, not an empty item', async () => {
	await assert.rejects(callWith({}), /empty response/);
});
