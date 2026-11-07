'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { Stocklake } = require('../dist/nodes/Stocklake/Stocklake.node');
const {
	buildSymbolList,
	estimateCost,
	itemBySymbol,
	orderBySymbols,
	splitValue,
} = require('../dist/nodes/Stocklake/symbols');
const { createFakeMcp, loadNode, runNode } = require('./helpers/fakeMcp');

const v2 = loadNode(Stocklake, 2);
const run = (opts) => runNode(v2, { typeVersion: 2, ...opts });

const getMany = { resource: 'stock', operation: 'getMany', simplify: false };

/** get_stocks as the API answers it, in an order of its own (reversed). */
function stocksTool(unknown = []) {
	return (args) => {
		const found = args.symbols.filter((s) => !unknown.includes(s));
		return {
			count: found.length,
			requested: args.symbols.length,
			missing: args.symbols.filter((s) => unknown.includes(s)),
			duplicates_collapsed: 0,
			symbols: Object.fromEntries([...found].reverse().map((s) => [s, { symbol: s, price: 1 }])),
		};
	};
}

const symbolsOf = (output) => output[0].map((i) => i.json.symbol);
const fromItems = (values, extra = {}) =>
	values.map((symbolsFromInput) => ({
		...getMany,
		symbolSource: 'fromInput',
		symbolsFromInput,
		...extra,
	}));

// ------------------------------------------------------------ pure rules

test('buildSymbolList trims, upper-cases, drops duplicates and keeps first-seen order', () => {
	const list = buildSymbolList([
		{ value: ' aapl ', item: 0 },
		{ value: 'msft', item: 1 },
		{ value: 'AAPL', item: 2 },
		{ value: 'nvda, msft', item: 3 },
	]);
	assert.deepEqual(
		list.symbols.map((s) => [s.symbol, s.item]),
		[
			['AAPL', 0],
			['MSFT', 1],
			['NVDA', 3],
		],
	);
	assert.equal(list.duplicates, 2);
	assert.deepEqual(list.invalid, []);
});

test('buildSymbolList reports invalid and empty values against their item', () => {
	const list = buildSymbolList([
		{ value: 'AAPL', item: 0 },
		{ value: 'NOT A TICKER', item: 1 },
		{ value: '', item: 2 },
		{ value: undefined, item: 3 },
		{ value: 'WAYTOOLONGTICKERSYMBOL', item: 4 },
		{ value: 'BRK.B', item: 5 },
	]);
	assert.deepEqual(
		list.symbols.map((s) => s.symbol),
		['AAPL', 'BRK.B'],
	);
	assert.deepEqual(
		list.invalid.map((e) => [e.item, e.input]),
		[
			[1, 'NOT A TICKER'],
			[2, ''],
			[3, ''],
			[4, 'WAYTOOLONGTICKERSYMBOL'],
		],
	);
});

test('splitValue reads arrays, comma lists and numbers', () => {
	assert.deepEqual(splitValue(['a, b', 'c']), ['a', 'b', 'c']);
	assert.deepEqual(splitValue(123), ['123']);
	assert.deepEqual(splitValue([]), ['']);
});

test('orderBySymbols restores the input order and tolerates share-class aliases', () => {
	const rows = [{ symbol: 'C' }, { symbol: 'BRK-B' }, { symbol: 'A' }, { symbol: 'ZZ' }];
	assert.deepEqual(
		orderBySymbols(rows, ['A', 'BRK.B', 'C']).map((r) => r.symbol),
		['A', 'BRK-B', 'C', 'ZZ'],
	);
	assert.equal(itemBySymbol([{ symbol: 'BRK.B', item: 4 }])('BRK-B'), 4);
});

test('estimateCost counts one call per ticker and one request per 25', () => {
	assert.deepEqual(estimateCost(60), { calls: 60, requests: 3 });
	assert.deepEqual(estimateCost(25), { calls: 25, requests: 1 });
	assert.deepEqual(estimateCost(0), { calls: 0, requests: 0 });
});

// ------------------------------------------------------- From input items

test('From input items collects one ticker per input item into a single call', async () => {
	const fake = createFakeMcp({ get_stocks: stocksTool() });
	const output = await run({ params: fromItems(['aapl', ' msft', 'NVDA']), fake });

	assert.equal(fake.calls.length, 1);
	assert.deepEqual(fake.calls[0].arguments, { symbols: ['AAPL', 'MSFT', 'NVDA'] });
	// The API answered in reverse; the output follows the input.
	assert.deepEqual(symbolsOf(output), ['AAPL', 'MSFT', 'NVDA']);
	assert.deepEqual(
		output[0].map((i) => i.pairedItem),
		[{ item: 0 }, { item: 1 }, { item: 2 }],
	);
});

test('60 tickers from input items are sent as 25 + 25 + 10 and come back in input order', async () => {
	const tickers = Array.from({ length: 60 }, (_, k) => `T${k}`);
	const fake = createFakeMcp({ get_stocks: stocksTool() });
	const output = await run({ params: fromItems(tickers), fake });

	assert.deepEqual(
		fake.calls.map((c) => c.arguments.symbols.length),
		[25, 25, 10],
	);
	assert.deepEqual(symbolsOf(output), tickers);
	assert.deepEqual(
		output[0].map((i) => i.pairedItem.item),
		tickers.map((_, k) => k),
	);
});

test('duplicates across input items are asked for once and paired with the first item', async () => {
	const fake = createFakeMcp({ get_stocks: stocksTool() });
	const output = await run({
		params: fromItems(['aapl', 'MSFT', 'AAPL', 'msft ', 'NVDA'], {
			options: { includeMetadata: true },
		}),
		fake,
	});
	assert.deepEqual(fake.calls[0].arguments.symbols, ['AAPL', 'MSFT', 'NVDA']);
	assert.deepEqual(symbolsOf(output), ['AAPL', 'MSFT', 'NVDA']);
	assert.equal(output[0][0].json._meta.duplicates_removed, 2);
	assert.equal(output[0][0].json._meta.estimated_calls, 3);
});

test('an invalid ticker is reported on its own item and the rest still run', async () => {
	const fake = createFakeMcp({ get_stocks: stocksTool() });
	const output = await run({ params: fromItems(['AAPL', 'not a ticker', '', 'MSFT']), fake });

	assert.deepEqual(fake.calls[0].arguments.symbols, ['AAPL', 'MSFT']);
	const rows = output[0].filter((i) => i.json.valid !== false);
	const bad = output[0].filter((i) => i.json.valid === false);
	assert.deepEqual(
		rows.map((i) => i.json.symbol),
		['AAPL', 'MSFT'],
	);
	assert.deepEqual(
		bad.map((i) => [i.pairedItem.item, i.json.symbol, i.json.error]),
		[
			[1, 'not a ticker', 'Not a valid-looking ticker symbol'],
			[2, '', 'No ticker in this item'],
		],
	);
});

test('when every ticker is invalid no call is made and each item is still reported', async () => {
	const fake = createFakeMcp({ get_stocks: stocksTool() });
	const output = await run({ params: fromItems(['??', 'a b']), fake });
	assert.equal(fake.calls.length, 0);
	assert.equal(output[0].length, 2);
	assert.ok(output[0].every((i) => i.json.valid === false));
});

test('a symbol the API does not know comes back as its own item and is listed in the metadata', async () => {
	const fake = createFakeMcp({ get_stocks: stocksTool(['NOPE']) });
	const output = await run({
		params: fromItems(['AAPL', 'NOPE'], { options: { includeMetadata: true } }),
		fake,
	});
	assert.deepEqual(symbolsOf(output), ['AAPL', 'NOPE']);
	assert.deepEqual(output[0][0].json._meta.missing, ['NOPE']);
	const nope = output[0][1];
	assert.equal(nope.json.found, false);
	assert.match(nope.json.error, /no data for this symbol/);
	assert.deepEqual(nope.pairedItem, { item: 1 }, 'paired with the input item it came from');
});

test('unknown symbols come before invalid ones and both after the rows, across batches', async () => {
	const tickers = Array.from({ length: 30 }, (_, k) => `T${k}`);
	const fake = createFakeMcp({ get_stocks: stocksTool(['T3', 'T27']) });
	const output = await run({ params: fromItems([...tickers, '??']), fake });
	const items = output[0];
	assert.equal(items.length, 31);
	assert.deepEqual(items.slice(28).map((i) => i.json.symbol), ['T3', 'T27', '??']);
	assert.deepEqual(items.slice(28, 30).map((i) => i.json.found), [false, false]);
	assert.equal(items[30].json.valid, false);
	assert.deepEqual(items[29].pairedItem, { item: 27 });
});

test('with Download as CSV an unknown symbol stays an item next to the file', async () => {
	const fake = createFakeMcp({ get_stocks: stocksTool(['NOPE']) });
	const output = await run({
		params: fromItems(['AAPL', 'NOPE'], { options: { downloadCsv: true } }),
		fake,
	});
	assert.equal(output[0].length, 2);
	assert.ok(output[0][0].binary, 'the first item is the file');
	assert.equal(output[0][1].json.symbol, 'NOPE');
	assert.equal(output[0][1].json.found, false);
});

// ------------------------------------------------------------ cost notice

test('a run of more than 25 calls is announced before the first call', async () => {
	const tickers = Array.from({ length: 60 }, (_, k) => `T${k}`);
	const fake = createFakeMcp({ get_stocks: stocksTool() });
	const hints = [];
	let hintsBeforeFirstCall;
	const original = fake.httpRequest;
	fake.httpRequest = (options) => {
		hintsBeforeFirstCall ??= hints.length;
		return original(options);
	};
	await run({ params: fromItems(tickers), fake, hints });

	// The stub rows carry no rating, so the plan hint (reliability.test.js) comes too.
	const cost = hints.filter((h) => /daily allowance/.test(h.message));
	assert.equal(hintsBeforeFirstCall, 1);
	assert.equal(cost.length, 1);
	assert.match(cost[0].message, /About 60 calls against your daily allowance/);
	assert.match(cost[0].message, /3 requests of up to 25/);
});

test('a run of 25 calls or fewer shows no notice', async () => {
	const fake = createFakeMcp({ get_stocks: stocksTool() });
	const hints = [];
	await run({ params: fromItems(['AAPL', 'MSFT']), fake, hints });
	assert.deepEqual(hints.filter((h) => /daily allowance/.test(h.message)), []);
});

// -------------------------------------------------------------- Manual list

test('Manual list keeps working per item, cleans the list and reports invalid entries', async () => {
	const fake = createFakeMcp({ get_stocks: stocksTool() });
	const output = await run({
		params: { ...getMany, symbols: 'msft, aapl, msft, bad one' },
		fake,
	});
	assert.deepEqual(fake.calls[0].arguments.symbols, ['MSFT', 'AAPL']);
	assert.deepEqual(symbolsOf(output).slice(0, 2), ['MSFT', 'AAPL']);
	assert.equal(output[0][2].json.valid, false);
});

test('Manual list with nothing in it is an error, not an empty call', async () => {
	const fake = createFakeMcp({ get_stocks: stocksTool() });
	await assert.rejects(run({ params: { ...getMany, symbols: ' , ' }, fake }), /at least one ticker/);
	assert.equal(fake.calls.length, 0);
});

// ------------------------------------------------------------ From watchlist

test('From my watchlist reads the watchlist once, then fetches those symbols', async () => {
	const fake = createFakeMcp({
		get_watchlist: { count: 2, items: [{ symbol: 'NVDA' }, { symbol: 'AMD' }] },
		get_stocks: stocksTool(),
	});
	const output = await run({
		params: { ...getMany, symbolSource: 'fromWatchlist' },
		items: [{ json: {} }, { json: {} }],
		fake,
	});
	assert.deepEqual(
		fake.calls.map((c) => c.toolName),
		['get_watchlist', 'get_stocks'],
	);
	assert.deepEqual(fake.calls[1].arguments.symbols, ['NVDA', 'AMD']);
	assert.deepEqual(symbolsOf(output), ['NVDA', 'AMD']);
});

test('an empty watchlist makes no stock call and returns nothing', async () => {
	const fake = createFakeMcp({ get_watchlist: { count: 0, items: [] }, get_stocks: stocksTool() });
	const output = await run({ params: { ...getMany, symbolSource: 'fromWatchlist' }, fake });
	assert.deepEqual(
		fake.calls.map((c) => c.toolName),
		['get_watchlist'],
	);
	assert.deepEqual(output, [[]]);
});

test('a free credential gets the Pro message for the watchlist, not a silent empty list', async () => {
	const fake = createFakeMcp({
		get_watchlist: { __toolError: JSON.stringify({ error: 'pro_required' }) },
	});
	await assert.rejects(
		run({ params: { ...getMany, symbolSource: 'fromWatchlist' }, fake }),
		/requires a Stocklake Pro account/,
	);
});

// -------------------------------------------------------- Earnings Calendar

const calendar = { resource: 'earnings', operation: 'getCalendar', simplify: false };
const calendarTool = (args) => ({
	total_in_window: (args.symbols ?? []).length || 100,
	next_offset: null,
	results: (args.symbols ?? ['ALL']).map((symbol, k) => ({
		symbol,
		earnings_date: `2026-11-${String(30 - (symbol.charCodeAt(1) % 20)).padStart(2, '0')}`,
	})),
});

test('Earnings Calendar defaults to every company and sends no symbols', async () => {
	const fake = createFakeMcp({ get_earnings_calendar: calendarTool });
	await run({ params: calendar, fake });
	assert.equal('symbols' in fake.calls[0].arguments, false);
});

test('Earnings Calendar with a manual list filters by those symbols', async () => {
	const fake = createFakeMcp({ get_earnings_calendar: calendarTool });
	await run({ params: { ...calendar, symbolSource: 'manual', symbols: 'aapl, msft' }, fake });
	assert.deepEqual(fake.calls[0].arguments.symbols, ['AAPL', 'MSFT']);
});

test('Earnings Calendar for 60 input tickers reads 25 + 25 + 10 and merges by date', async () => {
	const tickers = Array.from({ length: 60 }, (_, k) => `T${String.fromCharCode(65 + (k % 26))}${k}`);
	const fake = createFakeMcp({ get_earnings_calendar: calendarTool });
	const output = await run({
		params: tickers.map((symbolsFromInput) => ({
			...calendar,
			symbolSource: 'fromInput',
			symbolsFromInput,
			returnAll: true,
		})),
		fake,
	});
	assert.deepEqual(
		fake.calls.map((c) => c.arguments.symbols.length),
		[25, 25, 10],
	);
	assert.equal(output[0].length, 60);
	const dates = output[0].map((i) => i.json.earnings_date);
	assert.deepEqual(dates, [...dates].sort());
});

test('Earnings Calendar with an empty watchlist does not fall back to every company', async () => {
	const fake = createFakeMcp({
		get_watchlist: { count: 0, items: [] },
		get_earnings_calendar: calendarTool,
	});
	const output = await run({ params: { ...calendar, symbolSource: 'fromWatchlist' }, fake });
	assert.deepEqual(
		fake.calls.map((c) => c.toolName),
		['get_watchlist'],
	);
	assert.deepEqual(output, [[]]);
});

// -------------------------------------------------------------- version 1

test('version 1 has no Symbol Source and still takes the comma-separated list', () => {
	const v1 = loadNode(Stocklake, 1);
	assert.equal(
		v1.description.properties.some((p) => p.name === 'symbolSource'),
		false,
	);
	assert.ok(v2.description.properties.some((p) => p.name === 'symbolSource'));
});
