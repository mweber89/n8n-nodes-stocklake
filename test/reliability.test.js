'use strict';

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const { Stocklake } = require('../dist/nodes/Stocklake/Stocklake.node');
const generic = require('../dist/nodes/Stocklake/GenericFunctions');
const { createFakeMcp, loadNode, runNode } = require('./helpers/fakeMcp');

/**
 * Reliability (issue #6): 429 handling, the daily-allowance stop, the remaining-calls
 * option, the text of every error class, execution hints, continueOnFail with paired
 * items and the timeout option. Everything runs through the node's real execute()
 * against the fake server; the retry wait is replaced so no test sleeps.
 */

const v1 = loadNode(Stocklake, 1);
const v2 = loadNode(Stocklake, 2);
const run = (opts) => runNode(v2, { typeVersion: 2, ...opts });

const stock = (symbol = 'AAPL', extra = {}) => ({
	resource: 'stock',
	operation: 'get',
	symbol: { __rl: true, mode: 'id', value: symbol },
	...extra,
});

let waits;
const realSleep = generic.timing.sleep;
beforeEach(() => {
	waits = [];
	generic.timing.sleep = async (ms) => {
		waits.push(ms);
	};
});
afterEach(() => {
	generic.timing.sleep = realSleep;
});

/** An HTTP failure as n8n reports it: status, headers and JSON body under `response`. */
const http = (status, body, headers = {}, extra = {}) => ({
	__httpError: { message: `Request failed with status code ${status}`, response: { status, headers, data: body }, ...extra },
});

/** A tool that fails with the given failures in order, then answers with `then`. */
function failing(failures, then) {
	let n = 0;
	return () => (n < failures.length ? failures[n++] : then);
}

const tooMany = { error: 'Too many requests' };
const dailyBody = {
	error: "Daily limit reached (200 calls/day for tier 'free')",
	pro_upgrade: 'Pro has a higher allowance: https://example.test',
};

// ------------------------------------------------------------------ 429

test('429 with Retry-After: waits as long as the API asks, then succeeds', async () => {
	const fake = createFakeMcp({
		get_stock: failing([http(429, tooMany, { 'Retry-After': '2' })], { symbol: 'AAPL' }),
	});
	const output = await run({ params: stock(), fake });
	assert.deepEqual(waits, [2000]);
	assert.equal(fake.calls.length, 2);
	assert.equal(output[0][0].json.symbol, 'AAPL');
});

test('429 without Retry-After: backs off 1, 2, 4 seconds', async () => {
	const fake = createFakeMcp({
		get_stock: failing([http(429, tooMany), http(429, tooMany), http(429, tooMany)], { symbol: 'AAPL' }),
	});
	await run({ params: stock(), fake });
	assert.deepEqual(waits, [1000, 2000, 4000]);
	assert.equal(fake.calls.length, 4);
});

test('429 with Retry-After as an HTTP date is read too', async () => {
	const when = new Date(Date.now() + 5000).toUTCString();
	const fake = createFakeMcp({
		get_stock: failing([http(429, tooMany, { 'retry-after': when })], { symbol: 'AAPL' }),
	});
	await run({ params: stock(), fake });
	assert.equal(waits.length, 1);
	assert.ok(waits[0] >= 3000 && waits[0] <= 6000, `waited ${waits[0]}`);
});

test('429 that keeps coming: stops at Max Retries and says how many were tried', async () => {
	const fake = createFakeMcp({ get_stock: () => http(429, tooMany) });
	await assert.rejects(
		run({ params: stock('AAPL', { requestOptions: { maxRetries: 2 } }), fake }),
		(err) => {
			assert.match(err.message, /rate limiting/i);
			assert.match(err.description, /after 2 retries/);
			assert.match(err.description, /Max Retries/);
			assert.equal(String(err.httpCode), '429');
			return true;
		},
	);
	assert.equal(fake.calls.length, 3);
	assert.deepEqual(waits, [1000, 2000]);
});

test('Max Retries of 0 turns retrying off', async () => {
	const fake = createFakeMcp({ get_stock: () => http(429, tooMany) });
	await assert.rejects(
		run({ params: stock('AAPL', { requestOptions: { maxRetries: 0 } }), fake }),
		(err) => /Retries are off/.test(err.description),
	);
	assert.equal(fake.calls.length, 1);
	assert.deepEqual(waits, []);
});

test('a Retry-After longer than the node will wait is not retried', async () => {
	const fake = createFakeMcp({ get_stock: () => http(429, tooMany, { 'retry-after': '3600' }) });
	await assert.rejects(run({ params: stock(), fake }), (err) => {
		assert.match(err.message, /asked to wait 3600 seconds/);
		assert.match(err.description, /Run the workflow again later/);
		return true;
	});
	assert.equal(fake.calls.length, 1);
	assert.deepEqual(waits, []);
});

test('version 1 keeps its behaviour: a 429 is not retried', async () => {
	const fake = createFakeMcp({ get_stock: failing([http(429, tooMany)], { symbol: 'AAPL' }) });
	await assert.rejects(runNode(v1, { typeVersion: 1, params: stock(), fake }), /rate limit|Too many/i);
	assert.equal(fake.calls.length, 1);
	assert.deepEqual(waits, []);
});

// ------------------------------------------------------------ daily limit

const daily = (remaining = '0') =>
	http(429, dailyBody, {
		'x-ratelimit-limit': '200',
		'x-ratelimit-remaining': remaining,
		'x-ratelimit-reset': String(Math.floor(Date.now() / 1000) + 5 * 3600),
		'retry-after': '18000',
	});

test('daily allowance used up: stops at once with when it resets, never retries', async () => {
	const fake = createFakeMcp({ get_stock: () => daily() });
	await assert.rejects(run({ params: stock(), fake }), (err) => {
		assert.match(err.message, /Daily limit reached \(200 calls\/day/);
		assert.match(err.message, /Resets at 00:00 UTC/);
		assert.match(err.description, /did not retry/);
		assert.match(err.description, /about 5 hours/);
		assert.doesNotMatch(`${err.message} ${err.description}`, /example\.test/);
		assert.equal(String(err.httpCode), '429');
		return true;
	});
	assert.equal(fake.calls.length, 1);
	assert.deepEqual(waits, []);
});

test('daily allowance: a 429 with only the API text (no headers) is still a stop', async () => {
	const fake = createFakeMcp({ get_stock: () => http(429, dailyBody) });
	await assert.rejects(run({ params: stock(), fake }), /Resets at 00:00 UTC/);
	assert.equal(fake.calls.length, 1);
	assert.deepEqual(waits, []);
});

test('daily allowance: the rest of the items fail at once, without a request, under Continue On Fail', async () => {
	const fake = createFakeMcp({ get_stock: () => daily() });
	const params = ['AAPL', 'MSFT', 'NVDA'].map((s) => stock(s));
	const output = await run({ params, fake, continueOnFail: true });
	assert.equal(fake.calls.length, 1, 'only the first item reached the API');
	assert.equal(output[0].length, 3);
	output[0].forEach((item, i) => {
		assert.match(item.json.error, /Daily limit reached/);
		assert.match(item.json.errorDescription, /00:00 UTC/);
		assert.deepEqual(item.pairedItem, { item: i });
	});
});

test('daily allowance: without Continue On Fail the run ends on the first item', async () => {
	const fake = createFakeMcp({ get_stock: () => daily() });
	const params = ['AAPL', 'MSFT'].map((s) => stock(s));
	await assert.rejects(run({ params, fake }), /Daily limit reached/);
	assert.equal(fake.calls.length, 1);
});

test('a batch the allowance cannot cover is told apart from a used-up day', async () => {
	const fake = createFakeMcp({
		get_stocks: () =>
			http(
				429,
				{ error: 'Not enough calls left today (3 of 200 for tier free): this request can cost up to 25, one call per ticker. A smaller request still fits.' },
				{ 'x-ratelimit-limit': '200', 'x-ratelimit-remaining': '3' },
			),
	});
	const params = { resource: 'stock', operation: 'getMany', symbolSource: 'manual', symbols: 'AAPL,MSFT' };
	await assert.rejects(run({ params, fake }), (err) => {
		assert.match(err.message, /Not enough calls left today/);
		assert.match(err.description, /3 calls are left today/);
		assert.match(err.description, /fewer symbols/);
		assert.doesNotMatch(err.message, /Resets at 00:00 UTC/);
		return true;
	});
	assert.equal(fake.calls.length, 1);
	assert.deepEqual(waits, []);
});

test('a used-up guest limit also ends the run: later items make no request', async () => {
	const guest = {
		__httpError: {
			message: 'Request failed with status code 401',
			response: {
				status: 401,
				data: { jsonrpc: '2.0', error: { code: -32001, message: 'Sign-in required', data: { reason: 'guest_limit_reached' } } },
			},
		},
	};
	const fake = createFakeMcp({ get_stock: () => guest });
	const output = await run({ params: ['AAPL', 'MSFT'].map((s) => stock(s)), fake, continueOnFail: true });
	assert.equal(fake.calls.length, 1);
	assert.match(output[0][0].json.error, /guest limit is used up/);
	assert.match(output[0][1].json.error, /guest limit is used up/);
	assert.match(output[0][1].json.errorDescription, /Authentication/);
});

// ------------------------------------------------------- remaining calls

test('Include Remaining Calls adds _stocklake.remainingCalls to a whole-response item', async () => {
	const fake = createFakeMcp({ get_stock: { symbol: 'AAPL', price: 1 } }, { dailyLimit: 200 });
	const output = await run({
		params: stock('AAPL', { requestOptions: { includeRemainingCalls: true } }),
		fake,
	});
	assert.deepEqual(output[0][0].json._stocklake, { remainingCalls: 199, dailyLimit: 200 });
	assert.equal(output[0][0].json.symbol, 'AAPL');
});

test('Include Remaining Calls adds it to every row of a list', async () => {
	const fake = createFakeMcp({
		get_stocks: (args) => ({
			count: args.symbols.length,
			requested: args.symbols.length,
			missing: [],
			duplicates_collapsed: 0,
			symbols: Object.fromEntries(args.symbols.map((s) => [s, { symbol: s }])),
		}),
	});
	const output = await run({
		params: {
			resource: 'stock',
			operation: 'getMany',
			symbolSource: 'manual',
			symbols: 'AAPL,MSFT',
			simplify: false,
			requestOptions: { includeRemainingCalls: true },
		},
		fake,
	});
	assert.equal(output[0].length, 2);
	for (const item of output[0]) assert.equal(item.json._stocklake.remainingCalls, 199);
});

test('the remaining-calls field is off by default', async () => {
	const fake = createFakeMcp({ get_stock: { symbol: 'AAPL' } });
	const output = await run({ params: stock(), fake });
	assert.equal('_stocklake' in output[0][0].json, false);
});

test('Include Remaining Calls is left out when the API sent no figure', async () => {
	const fake = createFakeMcp({ get_stock: { symbol: 'AAPL' } });
	// An older gateway: the response carries no x-ratelimit headers at all.
	const plain = { ...fake, httpRequest: async (o) => (await fake.httpRequest({ ...o, returnFullResponse: false })) };
	const output = await run({
		params: stock('AAPL', { requestOptions: { includeRemainingCalls: true } }),
		fake: plain,
	});
	assert.equal('_stocklake' in output[0][0].json, false);
});

// ---------------------------------------------------------- error classes

const rejected = (fake, params = stock(), opts = {}) => run({ params, fake, ...opts });

test('error class: plan (pro_required) names the plan and says nothing needs reconnecting', async () => {
	const fake = createFakeMcp({
		get_stock_research: {
			__toolError: JSON.stringify({ error: 'pro_required', message: 'agent text', preview_note: 'Pro unlocks the full research bundle.' }),
		},
	});
	await assert.rejects(
		rejected(fake, { resource: 'stock', operation: 'getResearch', symbol: { __rl: true, mode: 'id', value: 'AAPL' } }),
		(err) => {
			assert.match(err.message, /requires a Stocklake Pro account/);
			assert.match(err.message, /needs no reconnect/);
			assert.match(err.description, /Plan needed: Pro/);
			assert.match(err.description, /get_stock_research/);
			assert.match(err.description, /full research bundle/);
			return true;
		},
	);
});

test('error class: unknown symbol names the symbol and how to write it', async () => {
	const fake = createFakeMcp({
		get_stock: { error: { code: 'symbol_not_found', message: "No data found for 'ZZZZ'", type: 'not_found' } },
	});
	await assert.rejects(rejected(fake, stock('ZZZZ')), (err) => {
		assert.match(err.message, /No data found for 'ZZZZ'/);
		assert.match(err.description, /The symbol "ZZZZ" is not in Stocklake/);
		assert.match(err.description, /SAP\.DE/);
		return true;
	});
});

test('error class: invalid argument carries the accepted values the API lists', async () => {
	const fake = createFakeMcp({
		get_screener: {
			error: {
				code: 'invalid_sector',
				message: "Unknown sector 'Tech'. Accepted: Technology, Healthcare",
				type: 'invalid_argument',
				accepted: ['Technology', 'Healthcare'],
			},
		},
	});
	await assert.rejects(
		rejected(fake, { resource: 'screener', operation: 'screen', preset: '' }),
		(err) => {
			assert.match(err.message, /Accepted: Technology, Healthcare/);
			assert.match(err.description, /Accepted values: Technology, Healthcare/);
			assert.match(err.description, /invalid_sector/);
			return true;
		},
	);
});

test('error class: an invalid argument with the values only in the message still points to the field', async () => {
	const fake = createFakeMcp({
		get_stock_financials: {
			error: { code: 'invalid_period', message: "period must be 'annual', 'quarterly' or 'both'", type: 'invalid_argument' },
		},
	});
	await assert.rejects(
		rejected(fake, { resource: 'stock', operation: 'getFinancials', symbol: { __rl: true, mode: 'id', value: 'AAPL' } }),
		(err) => {
			assert.match(err.message, /'annual', 'quarterly' or 'both'/);
			assert.match(err.description, /Change the field the message names/);
			return true;
		},
	);
});

test('error class: an input check of the server (plain text) says what to look at', async () => {
	const fake = createFakeMcp({ get_stock: { __toolError: '1 validation error for call[get_stock]\nsymbol\n  Field required' } });
	await assert.rejects(rejected(fake), (err) => {
		assert.match(err.message, /validation error/);
		assert.match(err.description, /rejected a value of this call/);
		return true;
	});
});

test('error class: a tool the API does not have points to updating the node', async () => {
	const fake = createFakeMcp({});
	await assert.rejects(rejected(fake), (err) => {
		assert.match(err.message, /Unknown tool: get_stock/);
		assert.match(err.description, /Update the node/);
		return true;
	});
});

test('error class: a protocol error keeps its own message and always has a description', async () => {
	const fake = createFakeMcp({ get_stock: { __rpcError: { code: -32602, message: 'Invalid request parameters', data: '' } } });
	await assert.rejects(rejected(fake), (err) => {
		assert.equal(err.message, 'Invalid request parameters');
		assert.ok(err.description);
		return true;
	});
});

test('error class: an empty response says to run again', async () => {
	const fake = createFakeMcp({});
	const empty = { ...fake, httpRequest: async () => ({ statusCode: 200, headers: {}, body: { jsonrpc: '2.0', id: 'x' } }) };
	await assert.rejects(rejected(empty), (err) => {
		assert.match(err.message, /empty response/);
		assert.match(err.description, /Run again/);
		return true;
	});
});

test('error class: a rejected key says the key is the problem', async () => {
	const fake = createFakeMcp({
		get_stock: http(401, { error: 'Invalid or inactive API key' }),
	});
	await assert.rejects(rejected(fake, stock(), { apiKeyCredential: true }), (err) => {
		assert.match(err.message, /rejected the API key/);
		assert.match(err.description, /Check the key/);
		assert.equal(String(err.httpCode), '401');
		return true;
	});
});

test('error class: a Pro operation without a credential says to add one', async () => {
	const fake = createFakeMcp({
		get_stock: http(401, { jsonrpc: '2.0', error: { code: -32001, message: 'requires the Pro tier', data: { reason: 'pro_tool_unauthenticated' } } }),
	});
	await assert.rejects(rejected(fake), (err) => {
		assert.match(err.message, /no credential attached/);
		assert.match(err.description, /Pro plan/);
		return true;
	});
});

test('error class: a timeout says how long it waited and which option to raise', async () => {
	const fake = createFakeMcp({
		get_stock: { __httpError: { message: 'timeout of 30000ms exceeded', code: 'ECONNABORTED' } },
	});
	await assert.rejects(rejected(fake), (err) => {
		assert.match(err.message, /did not answer within 30 seconds/);
		assert.match(err.description, /Timeout under Request Options/);
		return true;
	});
	assert.equal(fake.calls.length, 1, 'a timeout is not retried');
});

test('error class: a server that cannot be reached says so', async () => {
	const fake = createFakeMcp({
		get_stock: { __httpError: { message: 'getaddrinfo ENOTFOUND api.stocklake.dev', code: 'ENOTFOUND' } },
	});
	await assert.rejects(rejected(fake), (err) => {
		assert.equal(err.message, 'Could not reach api.stocklake.dev');
		assert.match(err.description, /proxy and firewall/);
		return true;
	});
});

test('error class: a 5xx is not blamed on the credential', async () => {
	const fake = createFakeMcp({ get_stock: http(503, { error: 'unavailable' }) });
	await assert.rejects(rejected(fake), (err) => {
		assert.match(err.message, /problem on its side \(HTTP 503\)/);
		assert.match(err.description, /Nothing is wrong with the node or the credential/);
		assert.equal(String(err.httpCode), '503');
		return true;
	});
});

test('every failure above is a node error (NodeApiError or NodeOperationError), never a bare Error', async () => {
	const cases = [
		http(429, tooMany),
		daily(),
		http(401, { error: 'Invalid or inactive API key' }),
		http(503, { error: 'x' }),
		{ __httpError: { message: 'boom' } },
		{ __rpcError: { code: -1, message: 'x', data: '' } },
		{ error: { code: 'symbol_not_found', message: 'nope' } },
	];
	for (const payload of cases) {
		const fake = createFakeMcp({ get_stock: () => payload });
		await assert.rejects(rejected(fake, stock('AAPL', { requestOptions: { maxRetries: 0 } })), (err) => {
			assert.match(err.constructor.name, /^Node(Api|Operation)Error$/);
			return true;
		});
	}
});

// ------------------------------------------------------------ continueOnFail

test('Continue On Fail: the failed item carries json.error and its own pairedItem, the others succeed', async () => {
	const fake = createFakeMcp({
		get_stock: (args) =>
			args.symbol === 'ZZZZ'
				? { error: { code: 'symbol_not_found', message: "No data found for 'ZZZZ'" } }
				: { symbol: args.symbol },
	});
	const output = await run({
		params: ['AAPL', 'ZZZZ', 'MSFT'].map((s) => stock(s)),
		fake,
		continueOnFail: true,
	});
	const items = output[0];
	assert.equal(items.length, 3);
	assert.deepEqual(items.map((i) => i.pairedItem), [{ item: 0 }, { item: 1 }, { item: 2 }]);
	assert.equal(items[0].json.symbol, 'AAPL');
	assert.match(items[1].json.error, /No data found for 'ZZZZ'/);
	assert.match(items[1].json.errorDescription, /"ZZZZ" is not in Stocklake/);
	assert.equal(items[2].json.symbol, 'MSFT');
});

test('Continue On Fail: an HTTP failure keeps its status next to the message', async () => {
	const fake = createFakeMcp({ get_stock: http(503, { error: 'x' }) });
	const output = await run({ params: stock(), fake, continueOnFail: true });
	assert.equal(output[0][0].json.httpCode, '503');
	assert.match(output[0][0].json.error, /problem on its side/);
});

test('Continue On Fail: a failure in a run over the whole input is paired with every input item', async () => {
	const fake = createFakeMcp({ get_stocks: http(503, { error: 'x' }) });
	const items = [{ json: { t: 'AAPL' } }, { json: { t: 'MSFT' } }, { json: { t: 'NVDA' } }];
	const output = await run({
		items,
		params: {
			resource: 'stock',
			operation: 'getMany',
			symbolSource: 'fromInput',
			symbolsFromInput: 'AAPL',
		},
		fake,
		continueOnFail: true,
	});
	assert.equal(output[0].length, 1);
	assert.match(output[0][0].json.error, /problem on its side/);
	assert.deepEqual(output[0][0].pairedItem, [{ item: 0 }, { item: 1 }, { item: 2 }]);
});

test('without Continue On Fail the error is thrown, not returned', async () => {
	const fake = createFakeMcp({ get_stock: http(503, { error: 'x' }) });
	await assert.rejects(run({ params: stock(), fake }), /problem on its side/);
});

// ------------------------------------------------------------------- hints

const withHints = async (params, tools, { node = v2, version = 2, items } = {}) => {
	const hints = [];
	const fake = createFakeMcp(tools);
	const output = await runNode(node, { typeVersion: version, params, fake, hints, items });
	return { hints, output };
};

test('hint: a response that says what Pro adds becomes one execution hint', async () => {
	const { hints } = await withHints(stock(), {
		get_stock: { symbol: 'AAPL', pro_unlocks: 'Pro unlocks the rating, signals and AI summary for AAPL.' },
	});
	assert.equal(hints.length, 1);
	assert.match(hints[0].message, /Fields left out on this plan: Pro unlocks the rating/);
	assert.equal(hints[0].location, 'outputPane');
});

test('hint: get_stock without a rating says rating and AI fields need Pro', async () => {
	const { hints } = await withHints(stock(), { get_stock: { symbol: 'AAPL', price: 1 } });
	assert.deepEqual(hints.map((h) => h.message), [
		'Rating and AI fields need Pro: the rating, signals and AI summary are left out of this response.',
	]);
});

test('hint: get_stocks without any rating says the same', async () => {
	const { hints } = await withHints(
		{ resource: 'stock', operation: 'getMany', symbolSource: 'manual', symbols: 'AAPL,MSFT' },
		{
			get_stocks: {
				count: 2, requested: 2, missing: [], duplicates_collapsed: 0,
				symbols: { AAPL: { symbol: 'AAPL' }, MSFT: { symbol: 'MSFT' } },
			},
		},
	);
	assert.match(hints[0].message, /Rating and AI fields need Pro/);
});

test('hint: a Pro answer (with a rating) adds none', async () => {
	const { hints } = await withHints(stock(), { get_stock: { symbol: 'AAPL', rating: { score: 7 } } });
	assert.deepEqual(hints, []);
});

test('hint: a capped list says what the cap is', async () => {
	const { hints } = await withHints(
		{ resource: 'stock', operation: 'getFilings', symbol: { __rl: true, mode: 'id', value: 'AAPL' } },
		{
			get_stock_filings: {
				symbol: 'AAPL', filings: [],
				items_note: 'Free returns the 5 most recent filings; Pro returns up to 25.',
				pro_unlocks: 'Pro adds headline, summary and sentiment.',
			},
		},
	);
	assert.equal(hints.length, 2);
	assert.match(hints.map((h) => h.message).join(' '), /Capped on this plan: Free returns the 5 most recent/);
});

test('hint: many items with the same gap add one hint, not one per item', async () => {
	const { hints } = await withHints(
		['AAPL', 'MSFT', 'NVDA'].map((s) => stock(s)),
		{ get_stock: (args) => ({ symbol: args.symbol }) },
	);
	assert.equal(hints.length, 1);
});

test('hint: version 1 adds none', async () => {
	const { hints } = await withHints(stock(), { get_stock: { symbol: 'AAPL' } }, { node: v1, version: 1 });
	assert.deepEqual(hints, []);
});

// ----------------------------------------------------------------- timeout

test('timeout: version 2 sends 30 seconds by default', async () => {
	const fake = createFakeMcp({ get_stock: { symbol: 'AAPL' } });
	await run({ params: stock(), fake });
	assert.deepEqual(fake.timeouts, [30000]);
});

test('timeout: the option sets it, and a timeout message names it', async () => {
	const fake = createFakeMcp({
		get_stock: { __httpError: { message: 'timeout of 5000ms exceeded', code: 'ECONNABORTED' } },
	});
	await assert.rejects(
		run({ params: stock('AAPL', { requestOptions: { timeout: 5000 } }), fake }),
		/did not answer within 5 seconds/,
	);
	assert.deepEqual(fake.timeouts, [5000]);
});

test('timeout: version 1 sets none, as before', async () => {
	const fake = createFakeMcp({ get_stock: { symbol: 'AAPL' } });
	await runNode(v1, { typeVersion: 1, params: stock(), fake });
	assert.deepEqual(fake.timeouts, [undefined]);
});

test('the request options exist on every version-2 operation and not on version 1', () => {
	const names = (node) => node.description.properties.filter((p) => p.name === 'requestOptions');
	const v2Fields = names(v2);
	assert.equal(v2Fields.length, 1);
	assert.deepEqual(
		v2Fields[0].options.map((o) => o.name).sort(),
		['includeRemainingCalls', 'maxRetries', 'timeout'],
	);
	assert.equal(v2Fields[0].displayOptions, undefined);
	assert.equal(names(v1).length, 0);
});
