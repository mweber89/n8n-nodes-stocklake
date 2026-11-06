'use strict';

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { Stocklake } = require('../dist/nodes/Stocklake/Stocklake.node');
const generic = require('../dist/nodes/Stocklake/GenericFunctions');
const c = require('../dist/nodes/Stocklake/composites');
const { createFakeMcp, loadNode, runNode } = require('./helpers/fakeMcp');

/**
 * Composite operations (issue #7): Stock > Compare, Stock > Snapshot and
 * Portfolio > Check Holdings. The pure rules are tested directly; every operation then runs
 * through the node's real execute() against the fake server, including the cases where one
 * symbol (or one of the extra calls) fails and the rest has to come through.
 */

const v1 = loadNode(Stocklake, 1);
const v2 = loadNode(Stocklake, 2);
const run = (opts) => runNode(v2, { typeVersion: 2, ...opts });

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

// The fixed "now" of the pure tests; the node tests build dates from the real clock.
const NOW = new Date('2026-11-06T12:00:00Z');
const inDays = (days) => new Date(Date.now() + days * 86_400_000).toISOString();
const daysAgo = (days) => new Date(Date.now() - days * 86_400_000).toISOString();

/** A stock as get_stock / get_stocks answer it (the fields the composites read). */
function stockDoc(symbol, extra = {}) {
	return {
		symbol,
		name: `${symbol} Inc.`,
		sector: 'Technology',
		currency: 'USD',
		price: 100,
		prev_close: 98,
		change_pct: 2.04,
		market_cap_usd: 1e11,
		pe_forward: 20,
		pe_trailing: 25,
		week52_low: 50,
		week52_high: 150,
		analyst_rating: 'buy',
		analyst_target: 120,
		analyst_count: 30,
		earnings_date: inDays(60),
		earnings_is_estimate: true,
		last_earnings_date: daysAgo(30),
		updated_at: '2026-11-06T13:20:11+00:00',
		indicators: { rsi: 55, sma50: 95, sma200: 90, macd: { histogram: 0.4 } },
		...extra,
	};
}

const proDoc = (symbol, extra = {}) =>
	stockDoc(symbol, {
		rating: { score: 6.5, direction: 'POSITIVE' },
		ai_verdict: 'POSITIVE',
		ai_score: 70,
		...extra,
	});

/**
 * get_stocks as the API answers it. `docs` maps a symbol to its document; `unknown` symbols
 * come back in `missing`; `poison` makes any request that contains it fail on its arguments.
 */
function stocksTool(docs, { unknown = [], poison = [], nullMissing = false } = {}) {
	return (args) => {
		const hit = args.symbols.find((s) => poison.includes(s));
		if (hit) return { __toolError: `Invalid symbol: ${hit}` };
		const known = args.symbols.filter((s) => !unknown.includes(s));
		const missing = args.symbols.filter((s) => unknown.includes(s));
		return {
			count: known.length,
			requested: args.symbols.length,
			missing: nullMissing && missing.length === 0 ? null : missing,
			duplicates_collapsed: 0,
			symbols: Object.fromEntries(known.map((s) => [s, docs[s] ?? stockDoc(s)])),
		};
	};
}

const rl = (value) => ({ __rl: true, mode: 'id', value });
const compare = (symbols, extra = {}) => ({
	resource: 'stock',
	operation: 'compare',
	symbols,
	...extra,
});
const snapshot = (symbol = 'AAPL') => ({ resource: 'stock', operation: 'snapshot', symbol: rl(symbol) });
const holdings = (extra = {}) => ({ resource: 'portfolio', operation: 'checkHoldings', ...extra });

/** Input items for Check Holdings: the node reads symbol, quantity and cost from each. */
const holdingItems = (list) => list.map((json) => ({ json }));
const holdingParams = (list, options) => list.map((h) => ({
	...holdings({ holdingOptions: options ?? {} }),
	holdingSymbol: h.symbol,
	holdingQuantity: h.quantity,
	holdingCost: h.cost ?? '',
}));
const runHoldings = (list, { fake, options, hints, continueOnFail } = {}) =>
	run({ params: holdingParams(list, options), items: holdingItems(list), fake, hints, continueOnFail });

const flat = (output) => output[0].map((i) => i.json);

// ======================================================================== pure rules

test('weekPosition and upsidePct: where the price sits, how far the target is away', () => {
	assert.equal(c.weekPosition(100, 50, 150), 50);
	assert.equal(c.weekPosition(150, 50, 150), 100);
	assert.equal(c.weekPosition(40, 50, 150), 0, 'below the low is held at 0');
	assert.equal(c.weekPosition(100, 50, 50), null, 'no range, no position');
	assert.equal(c.weekPosition(undefined, 50, 150), null);
	assert.equal(c.upsidePct(100, 120), 20);
	assert.equal(c.upsidePct(100, 90), -10);
	assert.equal(c.upsidePct(0, 90), null);
});

test('rankRows: sorts, adds rank, ties share a rank, rows without a value come last', () => {
	const rows = [
		{ symbol: 'A', rsi: 50 },
		{ symbol: 'B', rsi: null },
		{ symbol: 'C', rsi: 70 },
		{ symbol: 'D', rsi: 70 },
		{ symbol: 'E', rsi: 20 },
	];
	const desc = c.rankRows(rows, 'rsi', 'desc');
	assert.deepEqual(desc.map((r) => [r.symbol, r.rank]), [
		['C', 1], ['D', 1], ['A', 3], ['E', 4], ['B', null],
	]);
	const asc = c.rankRows(rows, 'rsi', 'asc');
	assert.deepEqual(asc.map((r) => [r.symbol, r.rank]), [
		['E', 1], ['A', 2], ['C', 3], ['D', 3], ['B', null],
	]);
});

test('parseHolding: quantity and cost, cost per share or total, and what is rejected', () => {
	assert.deepEqual(c.parseHolding({ symbol: ' aapl ', quantity: '10', cost: '150' }, 'perShare'), {
		ok: true, symbol: 'AAPL', quantity: 10, costPerShare: 150,
	});
	assert.equal(c.parseHolding({ symbol: 'AAPL', quantity: 10, cost: 1500 }, 'total').costPerShare, 150);
	assert.equal(c.parseHolding({ symbol: 'AAPL', quantity: 10 }, 'perShare').costPerShare, undefined);
	for (const bad of [
		{ symbol: '', quantity: 1 },
		{ symbol: 'NOT A TICKER', quantity: 1 },
		{ symbol: 'AAPL', quantity: 'many' },
		{ symbol: 'AAPL', quantity: 0 },
		{ symbol: 'AAPL', quantity: -3 },
		{ symbol: 'AAPL', quantity: 1, cost: 'cheap' },
		{ symbol: 'AAPL', quantity: 1, cost: -5 },
	]) {
		assert.equal(c.parseHolding(bad, 'perShare').ok, false, JSON.stringify(bad));
	}
});

test('mergeLots: the same ticker adds up, the cost is the weighted average, a lot without cost voids it', () => {
	const merged = c.mergeLots([
		{ symbol: 'AAPL', quantity: 10, costPerShare: 100, item: 0 },
		{ symbol: 'MSFT', quantity: 5, costPerShare: 200, item: 1 },
		{ symbol: 'AAPL', quantity: 30, costPerShare: 200, item: 2 },
	]);
	assert.deepEqual(merged.map((h) => [h.symbol, h.quantity, h.costPerShare, h.items, h.lots]), [
		['AAPL', 40, 175, [0, 2], 2],
		['MSFT', 5, 200, [1], 1],
	]);
	const partial = c.mergeLots([
		{ symbol: 'AAPL', quantity: 10, costPerShare: 100, item: 0 },
		{ symbol: 'AAPL', quantity: 10, item: 1 },
	]);
	assert.equal(partial[0].costPerShare, undefined);
});

test('insiderSales: only SELLs of the last 30 days count', () => {
	const sales = c.insiderSales(
		{
			transactions: [
				{ type: 'SELL', date: '2026-10-27T00:00:00+00:00', value: 600000 },
				{ type: 'SELL', date: '2026-10-20T00:00:00+00:00', shares: 1000, price: 500 },
				{ type: 'BUY', date: '2026-10-25T00:00:00+00:00', value: 9e9 },
				{ type: 'SELL', date: '2026-08-01T00:00:00+00:00', value: 9e9 },
				{ type: 'SELL', date: 'not a date', value: 9e9 },
			],
		},
		NOW,
	);
	assert.deepEqual(sales, { valueUsd: 1100000, count: 2 });
	assert.deepEqual(c.insiderSales({}, NOW), { valueUsd: 0, count: 0 });
});

const rules = { overbought: 70, oversold: 30, earningsWithinDays: 7, insiderSaleUsd: 1e6 };
const holding = (extra = {}) => ({ symbol: 'AAPL', quantity: 10, costPerShare: 80, items: [0], lots: 1, ...extra });

test('holdingRow: value, day change, profit against cost', () => {
	const row = c.holdingRow({ holding: holding(), stock: stockDoc('AAPL'), rules, now: NOW });
	assert.equal(row.value, 1000);
	assert.equal(row.day_change, 20, '(100 - 98) x 10');
	assert.equal(row.cost, 800);
	assert.equal(row.pl, 200);
	assert.equal(row.pl_pct, 25);
	assert.deepEqual(row.flags, []);
});

test('holdingRow: without a cost there is no profit or loss; without prev_close the day change comes from the percentage', () => {
	const row = c.holdingRow({
		holding: holding({ costPerShare: undefined }),
		stock: stockDoc('AAPL', { prev_close: undefined, price: 110, change_pct: 10 }),
		rules,
		now: NOW,
	});
	assert.equal(row.cost, null);
	assert.equal(row.pl, null);
	assert.equal(row.pl_pct, null);
	assert.equal(row.day_change, 100, '110 against 100');
});

test('holdingRow flags: overbought, oversold, earnings within the window, large insider sale', () => {
	const flagsOf = (stock, extra = {}) =>
		c.holdingRow({ holding: holding(), stock, rules, now: NOW, ...extra }).flags;
	assert.deepEqual(flagsOf(stockDoc('A', { indicators: { rsi: 70 } })), ['rsi_overbought']);
	assert.deepEqual(flagsOf(stockDoc('A', { indicators: { rsi: 30 } })), ['rsi_oversold']);
	assert.deepEqual(flagsOf(stockDoc('A', { indicators: { rsi: 50 } })), []);
	const soon = new Date(NOW.getTime() + 3 * 86_400_000).toISOString();
	const later = new Date(NOW.getTime() + 9 * 86_400_000).toISOString();
	assert.deepEqual(flagsOf(stockDoc('A', { earnings_date: soon })), ['earnings_soon']);
	assert.deepEqual(flagsOf(stockDoc('A', { earnings_date: later })), []);
	assert.deepEqual(flagsOf(stockDoc('A', { earnings_date: later }), { earnings: { date: soon, isEstimate: false } }), [
		'earnings_soon',
	], 'the calendar wins over the stock own date');
	assert.deepEqual(flagsOf(stockDoc('A'), { insider: { valueUsd: 1e6, count: 2 } }), ['large_insider_sale']);
	assert.deepEqual(flagsOf(stockDoc('A'), { insider: { valueUsd: 999999, count: 2 } }), []);
	const past = new Date(NOW.getTime() - 86_400_000).toISOString();
	assert.deepEqual(flagsOf(stockDoc('A', { earnings_date: past })), [], 'a past date is not "soon"');
});

test('withWeights and summarize: one currency gets a total and weights, several get neither', () => {
	const rows = ['AAPL', 'MSFT'].map((symbol, i) =>
		c.holdingRow({
			holding: holding({ symbol, quantity: i === 0 ? 30 : 10 }),
			stock: stockDoc(symbol),
			rules,
			now: NOW,
		}),
	);
	const weighted = c.withWeights(rows);
	assert.deepEqual(weighted.map((r) => r.weight_pct), [75, 25]);
	const summary = c.summarize(weighted, 1);
	assert.equal(summary.kind, 'summary');
	assert.equal(summary.total_value, 4000);
	assert.equal(summary.currency, 'USD');
	assert.equal(summary.top_weight_symbol, 'AAPL');
	assert.equal(summary.top_weight_pct, 75);
	assert.equal(summary.failed, 1);
	assert.equal(summary.holdings, 2);
	assert.equal(summary.total_cost, 3200);
	assert.equal(summary.total_pl, 800);

	const mixed = [
		c.holdingRow({ holding: holding(), stock: stockDoc('AAPL'), rules, now: NOW }),
		c.holdingRow({ holding: holding({ symbol: 'SAP.DE' }), stock: stockDoc('SAP.DE', { currency: 'EUR' }), rules, now: NOW }),
	];
	const mixedWeighted = c.withWeights(mixed);
	assert.deepEqual(mixedWeighted.map((r) => r.weight_pct), [null, null]);
	const mixedSummary = c.summarize(mixedWeighted, 0);
	assert.equal(mixedSummary.total_value, null);
	assert.equal(mixedSummary.currency, null);
	assert.equal(mixedSummary.by_currency.length, 2);
	assert.ok(mixedSummary.notes.some((n) => /several currencies/.test(n)));
});

// =============================================================================== Compare

test('Compare: one request, one item per stock, the same columns on every row', async () => {
	const fake = createFakeMcp({
		get_stocks: stocksTool({
			AAPL: stockDoc('AAPL'),
			MSFT: stockDoc('MSFT', { price: 140, indicators: { rsi: 72 }, analyst_target: undefined }),
		}),
	});
	const output = await run({ params: compare('AAPL, MSFT'), fake });
	assert.equal(fake.calls.length, 1);
	assert.deepEqual(fake.calls[0].arguments, { symbols: ['AAPL', 'MSFT'] });
	const [aapl, msft] = flat(output);
	assert.deepEqual(Object.keys(aapl), Object.keys(msft), 'aligned columns');
	assert.equal(aapl.week52_position_pct, 50);
	assert.equal(aapl.analyst_upside_pct, 20);
	assert.equal(aapl.rsi, 55);
	assert.equal(msft.analyst_target, null, 'a missing value is null, not a missing key');
	assert.equal(msft.analyst_upside_pct, null);
	assert.equal(msft.week52_position_pct, 90);
	assert.ok(!('rank' in aapl), 'no rank unless a Rank By is chosen');
	for (const column of ['price', 'change_pct', 'market_cap_usd', 'pe_forward', 'rsi', 'analyst_rating']) {
		assert.ok(column in aapl, column);
	}
	assert.deepEqual(output[0].map((i) => i.pairedItem), [{ item: 0 }, { item: 0 }]);
});

test('Compare: Rank By sorts, adds rank, and Order flips it', async () => {
	const docs = {
		A: stockDoc('A', { market_cap_usd: 3e9 }),
		B: stockDoc('B', { market_cap_usd: 9e9 }),
		C: stockDoc('C', { market_cap_usd: 5e9 }),
	};
	const fake = createFakeMcp({ get_stocks: stocksTool(docs) });
	const desc = await run({ params: compare('A, B, C', { rankBy: 'marketCap' }), fake });
	assert.deepEqual(flat(desc).map((r) => [r.rank, r.symbol]), [[1, 'B'], [2, 'C'], [3, 'A']]);
	const asc = await run({ params: compare('A, B, C', { rankBy: 'marketCap', rankOrder: 'asc' }), fake });
	assert.deepEqual(flat(asc).map((r) => [r.rank, r.symbol]), [[1, 'A'], [2, 'C'], [3, 'B']]);
	// Each row keeps the input item it came from.
	assert.ok(desc[0].every((i) => i.pairedItem.item === 0));
});

test('Compare: rank by 52-week position and by analyst upside use the derived columns', async () => {
	const docs = {
		A: stockDoc('A', { price: 60 }),
		B: stockDoc('B', { price: 140 }),
	};
	const fake = createFakeMcp({ get_stocks: stocksTool(docs) });
	const byPosition = await run({ params: compare('A, B', { rankBy: 'week52Position' }), fake });
	assert.deepEqual(flat(byPosition).map((r) => r.symbol), ['B', 'A']);
	const byUpside = await run({ params: compare('A, B', { rankBy: 'analystUpside' }), fake });
	assert.deepEqual(flat(byUpside).map((r) => r.symbol), ['A', 'B'], '120 against 60 beats 120 against 140');
});

test('Compare: an unknown symbol and an invalid one come back as items, the others are compared', async () => {
	const fake = createFakeMcp({ get_stocks: stocksTool({}, { unknown: ['ZZZZ'] }) });
	const output = await run({ params: compare('AAPL, ZZZZ, MSFT, NOT A TICKER'), fake });
	const rows = flat(output);
	assert.deepEqual(rows.map((r) => r.symbol), ['AAPL', 'MSFT', 'ZZZZ', 'NOT A TICKER']);
	assert.equal(rows[0].price, 100);
	assert.equal(rows[2].found, false);
	assert.match(rows[2].error, /no data for this symbol/i);
	assert.equal(rows[3].valid, false);
	assert.equal(fake.calls.length, 1, 'the bad ones cost no extra request');
});

test('Compare: the API sending missing as null (nothing missing) is fine', async () => {
	const fake = createFakeMcp({ get_stocks: stocksTool({}, { nullMissing: true }) });
	const output = await run({ params: compare('AAPL, MSFT'), fake });
	assert.equal(output[0].length, 2);
	assert.ok(flat(output).every((r) => r.price === 100));
});

test('Compare: a symbol the API answers under its own spelling (BRK.B as BRK-B) is still matched', async () => {
	const fake = createFakeMcp({
		get_stocks: () => ({
			count: 2,
			missing: null,
			symbols: { 'BRK-B': stockDoc('BRK-B'), AAPL: stockDoc('AAPL') },
		}),
	});
	const output = await run({ params: compare('BRK.B, AAPL'), fake });
	assert.deepEqual(flat(output).map((r) => r.symbol), ['BRK-B', 'AAPL']);
	assert.ok(flat(output).every((r) => r.found !== false));
});

test('Compare: a request that fails on one symbol is split until that symbol stands alone', async () => {
	const fake = createFakeMcp({ get_stocks: stocksTool({}, { poison: ['BAD'] }) });
	const output = await run({ params: compare('AAPL, MSFT, BAD, NVDA, AMD'), fake });
	const rows = flat(output);
	assert.deepEqual(rows.map((r) => r.symbol), ['AAPL', 'MSFT', 'NVDA', 'AMD', 'BAD']);
	assert.equal(rows[4].found, false);
	assert.match(rows[4].error, /Invalid symbol: BAD/);
	assert.ok(rows.slice(0, 4).every((r) => r.price === 100));
	assert.ok(fake.calls.length > 1);
	assert.ok(fake.calls.length <= 2 * 5, 'bounded by two requests per symbol');
});

test('Compare: when nothing can be read the node fails, with the first error', async () => {
	const down = { __httpError: { message: 'Bad gateway', response: { status: 502, data: {} }, httpCode: '502' } };
	const fake = createFakeMcp({ get_stocks: () => down });
	await assert.rejects(run({ params: compare('AAPL, MSFT'), fake }), /Stocklake/);
});

test('Compare: a rejected key ends the run at once instead of repeating it for every batch', async () => {
	const fake = createFakeMcp({
		get_stocks: () => ({
			__httpError: { message: 'Unauthorized', response: { status: 401, data: { error: 'Invalid API key' } } },
		}),
	});
	await assert.rejects(run({ params: compare('AAPL, MSFT'), fake, apiKeyCredential: true }));
	assert.equal(fake.calls.length, 1);

	// Check Holdings reads 25 per request: the second request is never sent.
	const many = Array.from({ length: 30 }, (_, i) => ({ symbol: `T${i}`, quantity: 1 }));
	const again = createFakeMcp({
		get_stocks: () => ({
			__httpError: { message: 'Unauthorized', response: { status: 401, data: { error: 'Invalid API key' } } },
		}),
	});
	await assert.rejects(runHoldings(many, { fake: again }));
	assert.equal(again.calls.length, 1);
});

test('Compare: fewer than 2 tickers and more than 25 are errors that say what to do', async () => {
	const fake = createFakeMcp({ get_stocks: stocksTool({}) });
	await assert.rejects(run({ params: compare('AAPL'), fake }), (error) => {
		assert.match(error.message, /at least 2 tickers/);
		assert.match(error.description, /second ticker/);
		return true;
	});
	const many = Array.from({ length: 26 }, (_, i) => `T${i}`).join(',');
	await assert.rejects(run({ params: compare(many), fake }), (error) => {
		assert.match(error.message, /at most 25 tickers, got 26/);
		assert.match(error.description, /Get Many/);
		return true;
	});
	assert.equal(fake.calls.length, 0, 'both are caught before any request');
	// Two entries, one of them invalid: compared with what is left, not an error.
	const output = await run({ params: compare('AAPL, NOT A TICKER'), fake });
	assert.equal(output[0].length, 2);
});

test('Compare: Pro columns appear when the response has them, and are absent on a free plan', async () => {
	const pro = createFakeMcp({ get_stocks: stocksTool({ AAPL: proDoc('AAPL'), MSFT: proDoc('MSFT', { ai_score: 40 }) }) });
	const [aapl] = flat(await run({ params: compare('AAPL, MSFT'), fake: pro }));
	assert.equal(aapl.rating_score, 6.5);
	assert.equal(aapl.rating_direction, 'POSITIVE');
	assert.equal(aapl.ai_verdict, 'POSITIVE');
	assert.equal(aapl.ai_score, 70);
	const ranked = flat(await run({ params: compare('AAPL, MSFT', { rankBy: 'aiScore', rankOrder: 'asc' }), fake: pro }));
	assert.deepEqual(ranked.map((r) => [r.rank, r.symbol]), [[1, 'MSFT'], [2, 'AAPL']]);

	const free = createFakeMcp({ get_stocks: stocksTool({}) });
	const [row] = flat(await run({ params: compare('AAPL, MSFT'), fake: free }));
	assert.ok(!('ai_score' in row));
	assert.ok(!('rating_score' in row));
});

test('Compare: ranking by a Pro column on a free plan keeps the order and says why', async () => {
	const fake = createFakeMcp({ get_stocks: stocksTool({}) });
	const hints = [];
	const output = await run({ params: compare('MSFT, AAPL', { rankBy: 'aiScore' }), fake, hints });
	assert.deepEqual(flat(output).map((r) => [r.symbol, r.rank, r.ai_score]), [
		['MSFT', null, null],
		['AAPL', null, null],
	]);
	assert.ok(hints.some((h) => /need a Pro account/.test(h.message)));
});

test('Compare: From Input Items compares the tickers of all items together, once, paired to their items', async () => {
	const fake = createFakeMcp({ get_stocks: stocksTool({}, { unknown: ['ZZZZ'] }) });
	const items = [{ json: { t: 'AAPL' } }, { json: { t: 'ZZZZ' } }, { json: { t: 'MSFT' } }];
	const output = await run({
		params: items.map((i) => ({
			resource: 'stock',
			operation: 'compare',
			symbolSource: 'fromInput',
			symbolsFromInput: i.json.t,
		})),
		items,
		fake,
	});
	assert.equal(fake.calls.length, 1);
	assert.deepEqual(fake.calls[0].arguments.symbols, ['AAPL', 'ZZZZ', 'MSFT']);
	assert.deepEqual(
		output[0].map((i) => [i.json.symbol, i.pairedItem.item]),
		[['AAPL', 0], ['MSFT', 2], ['ZZZZ', 1]],
	);
});

test('Compare: a manual list runs once per input item', async () => {
	const fake = createFakeMcp({ get_stocks: stocksTool({}) });
	const output = await run({
		params: [compare('AAPL, MSFT'), compare('NVDA, AMD')],
		fake,
	});
	assert.equal(fake.calls.length, 2);
	assert.deepEqual(output[0].map((i) => i.pairedItem.item), [0, 0, 1, 1]);
});

test('Compare with Continue On Fail: a failed item is an error item, the next one still runs', async () => {
	const fake = createFakeMcp({ get_stocks: stocksTool({}) });
	const output = await run({
		params: [compare('AAPL'), compare('NVDA, AMD')],
		fake,
		continueOnFail: true,
	});
	assert.match(output[0][0].json.error, /at least 2 tickers/);
	assert.ok(output[0][0].json.errorDescription);
	assert.deepEqual(output[0][0].pairedItem, { item: 0 });
	assert.deepEqual(output[0].slice(1).map((i) => i.json.symbol), ['NVDA', 'AMD']);
});

test('Compare is not in version 1', () => {
	const operation = v1.description.properties.find(
		(p) => p.name === 'operation' && p.displayOptions.show.resource[0] === 'stock',
	);
	assert.ok(!operation.options.some((o) => o.value === 'compare' || o.value === 'snapshot'));
});

// ============================================================================== Snapshot

test('Snapshot: quote, indicators, analysts, next earnings and the latest filing in one flat item', async () => {
	const fake = createFakeMcp({
		get_stock: stockDoc('AAPL', { earnings_date: inDays(10) }),
		get_stock_filings: {
			symbol: 'AAPL',
			items: [
				{
					accession: '1',
					date_et: '2026-11-02',
					title: 'Apple: earnings results (SEC 8-K)',
					headline: 'Apple reports record quarter',
					sec_url: 'https://www.sec.gov/x',
				},
			],
		},
	});
	const output = await run({ params: snapshot(), fake });
	assert.deepEqual(
		fake.calls.map((call) => [call.toolName, call.arguments]),
		[
			['get_stock', { symbol: 'AAPL' }],
			['get_stock_filings', { symbol: 'AAPL', limit: 1 }],
		],
	);
	assert.equal(output[0].length, 1);
	assert.deepEqual(output[0][0].pairedItem, { item: 0 });
	const s = output[0][0].json;
	assert.equal(s.symbol, 'AAPL');
	assert.equal(s.price, 100);
	assert.equal(s.week52_position_pct, 50);
	assert.equal(s.rsi, 55);
	assert.equal(s.rsi_state, 'neutral');
	assert.equal(s.macd_state, 'positive');
	assert.equal(s.price_vs_sma50, 'above');
	assert.equal(s.price_vs_sma200, 'above');
	assert.equal(s.analyst_rating, 'buy');
	assert.equal(s.analyst_upside_pct, 20);
	assert.equal(s.next_earnings_in_days, 10);
	assert.equal(s.next_earnings_is_estimate, true);
	assert.equal(s.latest_filing_date, '2026-11-02');
	assert.equal(s.latest_filing_headline, 'Apple reports record quarter');
	assert.equal(s.latest_filing_url, 'https://www.sec.gov/x');
	assert.ok(!('ai_score' in s), 'no Pro fields on a free plan');
	assert.ok(!('notes' in s));
	for (const part of ['AAPL (AAPL Inc.): 100 USD, +2.04% today', 'RSI 55 (neutral)', 'Analysts: buy', 'Next earnings', 'Latest filing (2026-11-02): Apple reports record quarter']) {
		assert.ok(s.summary.includes(part), `summary mentions: ${part}\n${s.summary}`);
	}
});

test('Snapshot: the Pro fields come along when the account has them', async () => {
	const fake = createFakeMcp({ get_stock: proDoc('AAPL'), get_stock_filings: { items: [] } });
	const s = flat(await run({ params: snapshot(), fake }))[0];
	assert.equal(s.ai_verdict, 'POSITIVE');
	assert.equal(s.ai_score, 70);
	assert.equal(s.rating_score, 6.5);
	assert.ok(s.summary.includes('AI verdict POSITIVE, score 70'));
});

test('Snapshot: a filing that cannot be read does not sink the snapshot', async () => {
	const fake = createFakeMcp({
		get_stock: stockDoc('AAPL'),
		get_stock_filings: { __httpError: { message: 'Bad gateway', response: { status: 502, data: {} } } },
	});
	const s = flat(await run({ params: snapshot(), fake }))[0];
	assert.equal(s.price, 100);
	assert.equal(s.latest_filing_title, null);
	assert.equal(s.latest_filing_url, null);
	assert.equal(s.notes.length, 1);
	assert.match(s.notes[0], /latest filing could not be read/);
});

test('Snapshot: no filings at all is a snapshot with null filing fields, not an error', async () => {
	const fake = createFakeMcp({ get_stock: stockDoc('AAPL'), get_stock_filings: { items: [] } });
	const s = flat(await run({ params: snapshot(), fake }))[0];
	assert.equal(s.latest_filing_date, null);
	assert.ok(!('notes' in s));
	assert.ok(!/Latest filing/.test(s.summary));
});

test('Snapshot: an unknown symbol is an error with what to do; Continue On Fail pairs it and the next item runs', async () => {
	const fake = createFakeMcp({
		get_stock: (args) =>
			args.symbol === 'ZZZZ'
				? { error: { code: 'symbol_not_found', message: "Symbol 'ZZZZ' not found." } }
				: stockDoc(args.symbol),
		get_stock_filings: { items: [] },
	});
	await assert.rejects(run({ params: snapshot('ZZZZ'), fake }), /ZZZZ/);
	const output = await run({
		params: [snapshot('ZZZZ'), snapshot('MSFT')],
		fake,
		continueOnFail: true,
	});
	assert.match(output[0][0].json.error, /ZZZZ/);
	assert.deepEqual(output[0][0].pairedItem, { item: 0 });
	assert.equal(output[0][1].json.symbol, 'MSFT');
	assert.deepEqual(output[0][1].pairedItem, { item: 1 });
});

test('Snapshot of an item with a daily limit used up: the stock call decides, nothing else is asked', async () => {
	const fake = createFakeMcp({
		get_stock: () => ({
			__httpError: {
				message: 'Too many requests',
				response: {
					status: 429,
					headers: { 'x-ratelimit-remaining': '0' },
					data: { error: 'Daily limit reached (200 calls/day)' },
				},
			},
		}),
	});
	await assert.rejects(run({ params: snapshot(), fake }), /Daily limit reached/);
	assert.equal(fake.calls.length, 1);
});

// ======================================================================== Check Holdings

/** A three-holding portfolio: AAPL overbought, MSFT reports soon, NVDA in the red. */
const portfolio = [
	{ symbol: 'AAPL', quantity: 10, cost: 80 },
	{ symbol: 'MSFT', quantity: 5, cost: 120 },
	{ symbol: 'NVDA', quantity: 20, cost: 150 },
];
const portfolioDocs = (pro = false) => {
	const make = pro ? proDoc : stockDoc;
	return {
		AAPL: make('AAPL', { price: 100, prev_close: 98, indicators: { rsi: 75 } }),
		MSFT: make('MSFT', { price: 200, prev_close: 205, change_pct: -2.44, indicators: { rsi: 50 }, earnings_date: inDays(30) }),
		NVDA: make('NVDA', { price: 100, prev_close: 100, change_pct: 0, indicators: { rsi: 25 } }),
	};
};
const calendar = (rows) => (args) => ({
	window_days: args.days,
	count: rows.length,
	total_in_window: rows.length,
	offset: 0,
	next_offset: null,
	results: rows.filter((r) => args.symbols.includes(r.symbol)),
});

test('Check Holdings: one item per holding with value, day change, profit, weight and flags, then a summary', async () => {
	const fake = createFakeMcp({
		get_stocks: stocksTool(portfolioDocs()),
		get_earnings_calendar: calendar([
			{ symbol: 'MSFT', earnings_date: inDays(3), is_estimate: false },
		]),
	});
	const output = await runHoldings(portfolio, { fake });
	const rows = flat(output);
	assert.equal(rows.length, 4);
	const [aapl, msft, nvda, summary] = rows;
	assert.equal(aapl.kind, 'holding');
	assert.equal(aapl.value, 1000);
	assert.equal(aapl.day_change, 20);
	assert.equal(aapl.pl, 200);
	assert.equal(aapl.pl_pct, 25);
	assert.deepEqual(aapl.flags, ['rsi_overbought']);
	assert.equal(msft.value, 1000);
	assert.equal(msft.day_change, -25);
	assert.equal(msft.earnings_in_days, 3);
	assert.equal(msft.earnings_is_estimate, false);
	assert.deepEqual(msft.flags, ['earnings_soon']);
	assert.equal(nvda.value, 2000);
	assert.equal(nvda.pl, -1000);
	assert.deepEqual(nvda.flags, ['rsi_oversold']);
	assert.deepEqual([aapl, msft, nvda].map((r) => r.weight_pct), [25, 25, 50]);

	assert.equal(summary.kind, 'summary');
	assert.equal(summary.holdings, 3);
	assert.equal(summary.failed, 0);
	assert.equal(summary.total_value, 4000);
	assert.equal(summary.day_change, -5);
	assert.equal(summary.total_cost, 800 + 600 + 3000);
	assert.equal(summary.total_pl, -400);
	assert.equal(summary.top_weight_symbol, 'NVDA');
	assert.equal(summary.top_weight_pct, 50);
	assert.equal(summary.flagged_holdings, 3);
	assert.deepEqual(summary.flags, {
		rsi_overbought: ['AAPL'],
		rsi_oversold: ['NVDA'],
		earnings_soon: ['MSFT'],
		large_insider_sale: [],
	});
	// Holdings are paired with their own item, the summary with all of them.
	assert.deepEqual(output[0].slice(0, 3).map((i) => i.pairedItem), [[{ item: 0 }], [{ item: 1 }], [{ item: 2 }]]);
	assert.deepEqual(output[0][3].pairedItem, [{ item: 0 }, { item: 1 }, { item: 2 }]);
});

test('Check Holdings: quotes in batches of 25, then the earnings calendar with the same symbols and the window', async () => {
	const many = Array.from({ length: 30 }, (_, i) => ({ symbol: `T${i}`, quantity: 1 }));
	const fake = createFakeMcp({
		get_stocks: stocksTool({}),
		get_earnings_calendar: calendar([]),
	});
	const output = await runHoldings(many, { fake, options: { earningsWithinDays: 14 } });
	const stockCalls = fake.calls.filter((call) => call.toolName === 'get_stocks');
	assert.deepEqual(stockCalls.map((call) => call.arguments.symbols.length), [25, 5]);
	const calendarCalls = fake.calls.filter((call) => call.toolName === 'get_earnings_calendar');
	assert.ok(calendarCalls.length >= 1);
	assert.ok(calendarCalls.every((call) => call.arguments.days === 14));
	const asked = calendarCalls.flatMap((call) => call.arguments.symbols);
	assert.deepEqual(new Set(asked), new Set(many.map((m) => m.symbol)));
	assert.equal(output[0].length, 31, '30 holdings and the summary');
});

test('Check Holdings: a holding the calendar does not list uses the earnings date of its own stock data', async () => {
	const fake = createFakeMcp({
		get_stocks: stocksTool({ AAPL: stockDoc('AAPL', { earnings_date: inDays(2) }) }),
		get_earnings_calendar: calendar([]),
	});
	const rows = flat(await runHoldings([{ symbol: 'AAPL', quantity: 1 }], { fake }));
	assert.deepEqual(rows[0].flags, ['earnings_soon']);
});

test('Check Holdings partial failures: unknown symbol, bad quantity, invalid ticker, a poisoned request - the rest is valued', async () => {
	const list = [
		{ symbol: 'AAPL', quantity: 10, cost: 80 },
		{ symbol: 'ZZZZ', quantity: 1 },
		{ symbol: 'MSFT', quantity: 'many' },
		{ symbol: 'NOT A TICKER', quantity: 1 },
		{ symbol: 'BAD', quantity: 1 },
		{ symbol: 'NVDA', quantity: 20 },
	];
	const fake = createFakeMcp({
		get_stocks: stocksTool(portfolioDocs(), { unknown: ['ZZZZ'], poison: ['BAD'] }),
		get_earnings_calendar: calendar([]),
	});
	const output = await runHoldings(list, { fake });
	const rows = flat(output);
	const bySymbol = Object.fromEntries(rows.filter((r) => r.kind === 'holding').map((r) => [r.symbol, r]));
	assert.equal(bySymbol.AAPL.value, 1000);
	assert.equal(bySymbol.NVDA.value, 2000);
	assert.equal(bySymbol.ZZZZ.found, false);
	assert.match(bySymbol.ZZZZ.error, /no data/i);
	assert.equal(bySymbol.BAD.found, false);
	assert.match(bySymbol.BAD.error, /Invalid symbol: BAD/);
	assert.match(bySymbol.MSFT.error, /Quantity/);
	assert.equal(bySymbol['NOT A TICKER'].valid, false);

	const summary = rows.find((r) => r.kind === 'summary');
	assert.equal(summary.holdings, 2);
	assert.equal(summary.failed, 4);
	assert.equal(summary.total_value, 3000);
	assert.equal(summary.top_weight_symbol, 'NVDA');
	// Every failed row sits with its own input item.
	const pair = (symbol) => output[0].find((i) => i.json.symbol === symbol).pairedItem;
	assert.deepEqual(pair('MSFT'), { item: 2 });
	assert.deepEqual(pair('NOT A TICKER'), { item: 3 });
	assert.deepEqual(pair('ZZZZ'), [{ item: 1 }]);
	assert.deepEqual(pair('BAD'), [{ item: 4 }]);
});

test('Check Holdings: when the earnings calendar fails the holdings are still checked, from their own earnings date', async () => {
	const fake = createFakeMcp({
		get_stocks: stocksTool({ AAPL: stockDoc('AAPL', { earnings_date: inDays(2) }) }),
		get_earnings_calendar: {
			__httpError: { message: 'Bad gateway', response: { status: 502, data: {} } },
		},
	});
	const rows = flat(await runHoldings([{ symbol: 'AAPL', quantity: 1 }], { fake }));
	assert.deepEqual(rows[0].flags, ['earnings_soon']);
	assert.ok(rows[1].notes.some((n) => /earnings calendar could not be read/.test(n)));
});

test('Check Holdings on Pro: insider sales of the last 30 days are checked per holding and flagged', async () => {
	const fake = createFakeMcp({
		get_stocks: stocksTool(portfolioDocs(true)),
		get_earnings_calendar: calendar([]),
		get_insider_activity: (args) => ({
			symbol: args.symbol,
			transactions:
				args.symbol === 'AAPL'
					? [
							{ type: 'SELL', date: daysAgo(5), value: 800000 },
							{ type: 'SELL', date: daysAgo(10), value: 400000 },
							{ type: 'SELL', date: daysAgo(60), value: 9e9 },
						]
					: [{ type: 'BUY', date: daysAgo(5), value: 9e9 }],
		}),
	});
	const rows = flat(await runHoldings(portfolio, { fake }));
	const insiderCalls = fake.calls.filter((call) => call.toolName === 'get_insider_activity');
	assert.deepEqual(insiderCalls.map((call) => call.arguments.symbol), ['AAPL', 'MSFT', 'NVDA']);
	assert.equal(rows[0].insider_sales_30d_usd, 1200000);
	assert.ok(rows[0].flags.includes('large_insider_sale'));
	assert.equal(rows[1].insider_sales_30d_usd, 0);
	assert.ok(!rows[1].flags.includes('large_insider_sale'));
	assert.deepEqual(rows[3].flags.large_insider_sale, ['AAPL']);
});

test('Check Holdings on a free plan: the insider flag is skipped with a hint and a note, and costs no call', async () => {
	const fake = createFakeMcp({
		get_stocks: stocksTool(portfolioDocs(false)),
		get_earnings_calendar: calendar([]),
		get_insider_activity: { transactions: [] },
	});
	const hints = [];
	const rows = flat(await runHoldings(portfolio, { fake, hints }));
	assert.equal(fake.calls.filter((call) => call.toolName === 'get_insider_activity').length, 0);
	assert.ok(hints.some((h) => /Pro account only/.test(h.message)));
	assert.ok(rows[3].notes.some((n) => /insider sales were not checked/.test(n)));
	assert.equal(rows[0].insider_sales_30d_usd, null);
});

test('Check Holdings: Check Insider Sales off asks nothing, and says nothing about it', async () => {
	const fake = createFakeMcp({
		get_stocks: stocksTool(portfolioDocs(true)),
		get_earnings_calendar: calendar([]),
		get_insider_activity: { transactions: [] },
	});
	const hints = [];
	const rows = flat(await runHoldings(portfolio, { fake, hints, options: { checkInsiderSales: false } }));
	assert.equal(fake.calls.filter((call) => call.toolName === 'get_insider_activity').length, 0);
	assert.ok(!hints.some((h) => /insider/i.test(h.message)));
	assert.ok(!rows[3].notes);
});

test('Check Holdings: an insider call that fails leaves that holding without the flag and says so; the daily limit stops the rest', async () => {
	let n = 0;
	const fake = createFakeMcp({
		get_stocks: stocksTool(portfolioDocs(true)),
		get_earnings_calendar: calendar([]),
		get_insider_activity: () => {
			n += 1;
			if (n === 1) return { __httpError: { message: 'Bad gateway', response: { status: 502, data: {} } } };
			return {
				__httpError: {
					message: 'Too many requests',
					response: { status: 429, headers: { 'x-ratelimit-remaining': '0' }, data: { error: 'Daily limit reached (5000 calls/day)' } },
				},
			};
		},
	});
	const rows = flat(await runHoldings(portfolio, { fake }));
	assert.equal(rows.length, 4, 'all three holdings and the summary still come back');
	assert.ok(rows.slice(0, 3).every((r) => r.value !== null));
	assert.equal(fake.calls.filter((call) => call.toolName === 'get_insider_activity').length, 2, 'no request after the limit stopped the run');
	assert.ok(rows[3].notes.some((note) => /3 holding\(s\) could not be read/.test(note)));
});

test('Check Holdings: lots of the same ticker become one holding with a weighted cost, paired with every lot', async () => {
	const list = [
		{ symbol: 'AAPL', quantity: 10, cost: 100 },
		{ symbol: 'MSFT', quantity: 5, cost: 100 },
		{ symbol: 'AAPL', quantity: 30, cost: 200 },
	];
	const fake = createFakeMcp({
		get_stocks: stocksTool({ AAPL: stockDoc('AAPL', { price: 250 }) }),
		get_earnings_calendar: calendar([]),
	});
	const output = await runHoldings(list, { fake });
	assert.deepEqual(fake.calls[0].arguments.symbols, ['AAPL', 'MSFT'], 'a ticker is asked for once');
	const aapl = output[0][0];
	assert.equal(aapl.json.quantity, 40);
	assert.equal(aapl.json.lots, 2);
	assert.equal(aapl.json.cost_per_share, 175);
	assert.equal(aapl.json.cost, 7000);
	assert.equal(aapl.json.value, 10000);
	assert.deepEqual(aapl.pairedItem, [{ item: 0 }, { item: 2 }]);
});

test('Check Holdings: holdings in several currencies get no total and no weights, only totals per currency', async () => {
	const fake = createFakeMcp({
		get_stocks: stocksTool({
			AAPL: stockDoc('AAPL'),
			'SAP.DE': stockDoc('SAP.DE', { currency: 'EUR', price: 200, prev_close: 200, change_pct: 0 }),
		}),
		get_earnings_calendar: calendar([]),
	});
	const rows = flat(
		await runHoldings([{ symbol: 'AAPL', quantity: 10 }, { symbol: 'SAP.DE', quantity: 5 }], { fake }),
	);
	assert.deepEqual(rows.slice(0, 2).map((r) => r.weight_pct), [null, null]);
	const summary = rows[2];
	assert.equal(summary.total_value, null);
	assert.deepEqual(
		summary.by_currency.map((g) => [g.currency, g.total_value]),
		[['USD', 1000], ['EUR', 1000]],
	);
	assert.ok(summary.notes.some((note) => /several currencies/.test(note)));
});

test('Check Holdings options: cost as a total, RSI limits, earnings window, output', async () => {
	const docs = { AAPL: stockDoc('AAPL', { indicators: { rsi: 60 }, earnings_date: inDays(12) }) };
	const fake = createFakeMcp({ get_stocks: stocksTool(docs), get_earnings_calendar: calendar([]) });
	const list = [{ symbol: 'AAPL', quantity: 10, cost: 800 }];
	const rows = flat(
		await runHoldings(list, {
			fake,
			options: { costIs: 'total', overboughtAbove: 60, earningsWithinDays: 14 },
		}),
	);
	assert.equal(rows[0].cost_per_share, 80);
	assert.equal(rows[0].pl, 200);
	assert.deepEqual(rows[0].flags, ['rsi_overbought', 'earnings_soon']);

	const holdingsOnly = flat(await runHoldings(list, { fake, options: { output: 'holdings' } }));
	assert.deepEqual(holdingsOnly.map((r) => r.kind), ['holding']);
	const summaryOnly = await runHoldings(list, { fake, options: { output: 'summary' } });
	assert.deepEqual(flat(summaryOnly).map((r) => r.kind), ['summary']);
	assert.equal(summaryOnly[0][0].json.total_value, 1000);
});

test('Check Holdings: a holding without a price is a failure row, not a zero in the totals', async () => {
	const fake = createFakeMcp({
		get_stocks: stocksTool({ AAPL: stockDoc('AAPL'), NVDA: stockDoc('NVDA', { price: undefined }) }),
		get_earnings_calendar: calendar([]),
	});
	const rows = flat(
		await runHoldings([{ symbol: 'AAPL', quantity: 10 }, { symbol: 'NVDA', quantity: 1 }], { fake }),
	);
	assert.equal(rows[1].found, false);
	assert.match(rows[1].error, /no price/);
	assert.equal(rows[2].holdings, 1);
	assert.equal(rows[2].failed, 1);
	assert.equal(rows[2].total_value, 1000);
});

test('Check Holdings: nothing to check is an error that says what to send; every item bad is not', async () => {
	const fake = createFakeMcp({ get_stocks: stocksTool({}), get_earnings_calendar: calendar([]) });
	await assert.rejects(run({ params: holdings(), items: [], fake }), (error) => {
		assert.match(error.message, /no holdings to check/);
		assert.match(error.description, /symbol and a quantity/);
		return true;
	});
	const output = await runHoldings([{ symbol: 'AAPL', quantity: 'x' }], { fake });
	assert.equal(output[0][0].json.valid, false);
	assert.equal(output[0][1].json.kind, 'summary');
	assert.equal(output[0][1].json.holdings, 0);
	assert.equal(output[0][1].json.failed, 1);
	assert.equal(fake.calls.length, 0, 'nothing valid, nothing asked');
});

test('Check Holdings with Continue On Fail: a failure of the whole run is one error item paired with every input item', async () => {
	const fake = createFakeMcp({
		get_stocks: () => ({
			__httpError: { message: 'Unauthorized', response: { status: 401, data: { error: 'Invalid API key' } } },
		}),
	});
	const output = await runHoldings(portfolio, { fake, continueOnFail: true });
	assert.equal(output[0].length, 1);
	assert.ok(output[0][0].json.error);
	assert.deepEqual(output[0][0].pairedItem, [{ item: 0 }, { item: 1 }, { item: 2 }]);
});

test('Check Holdings: more than 25 holdings are announced before they are read', async () => {
	const many = Array.from({ length: 30 }, (_, i) => ({ symbol: `T${i}`, quantity: 1 }));
	const fake = createFakeMcp({ get_stocks: stocksTool({}), get_earnings_calendar: calendar([]) });
	const hints = [];
	await runHoldings(many, { fake, hints });
	assert.ok(hints.some((h) => /About 30 calls/.test(h.message)));
});

test('Check Holdings can be asked for remaining calls like every other operation', async () => {
	const fake = createFakeMcp({ get_stocks: stocksTool({}), get_earnings_calendar: calendar([]) });
	const output = await run({
		params: holdingParams([{ symbol: 'AAPL', quantity: 1 }]).map((p) => ({
			...p,
			requestOptions: { includeRemainingCalls: true },
		})),
		items: holdingItems([{ symbol: 'AAPL', quantity: 1 }]),
		fake,
	});
	assert.ok(output[0].every((i) => typeof i.json._stocklake.remainingCalls === 'number'));
});

// ================================================================= description and docs

const props = () => new Stocklake().nodeVersions[2].description.properties;

test('Portfolio is a resource of version 2 only; Compare and Snapshot are Stock operations of version 2 only', () => {
	const resource = (version) =>
		new Stocklake().nodeVersions[version].description.properties.find((p) => p.name === 'resource');
	assert.ok(resource(2).options.some((o) => o.value === 'portfolio'));
	assert.ok(!resource(1).options.some((o) => o.value === 'portfolio'));
	const operations = props().find(
		(p) => p.name === 'operation' && p.displayOptions.show.resource[0] === 'portfolio',
	);
	assert.deepEqual(operations.options.map((o) => o.value), ['checkHoldings']);
	assert.equal(operations.default, 'checkHoldings');
	const stockOps = props().find(
		(p) => p.name === 'operation' && p.displayOptions.show.resource[0] === 'stock',
	);
	for (const value of ['compare', 'snapshot']) assert.ok(stockOps.options.some((o) => o.value === value));
});

test('Compare and Check Holdings parameters have the defaults the operations rely on', () => {
	const find = (name, operation) =>
		props().find((p) => p.name === name && p.displayOptions?.show?.operation?.[0] === operation);
	assert.equal(find('rankBy', 'compare').default, 'none');
	assert.equal(find('rankOrder', 'compare').default, 'desc');
	assert.deepEqual(
		find('rankBy', 'compare').options.map((o) => o.value).sort(),
		['aiScore', 'analystUpside', 'changePct', 'marketCap', 'none', 'peForward', 'ratingScore', 'rsi', 'week52Position'],
	);
	assert.equal(find('holdingSymbol', 'checkHoldings').default, '={{ $json.symbol }}');
	assert.equal(find('holdingQuantity', 'checkHoldings').default, '={{ $json.quantity }}');
	assert.equal(find('holdingCost', 'checkHoldings').default, '={{ $json.cost }}');
	const options = find('holdingOptions', 'checkHoldings');
	const names = options.options.map((o) => o.displayName);
	assert.deepEqual(names, [...names].sort((a, b) => a.localeCompare(b)), 'options are alphabetical');
});

// ================================================================== example workflows

const examplesDir = path.join(__dirname, '..', 'examples');
const exampleFiles = {
	'compare-stocks.workflow.json': { resource: 'stock', operation: 'compare' },
	'check-holdings.workflow.json': { resource: 'portfolio', operation: 'checkHoldings' },
	'stock-snapshot.workflow.json': { resource: 'stock', operation: 'snapshot' },
};

for (const [file, expected] of Object.entries(exampleFiles)) {
	test(`example workflow ${file}: valid, on node version 2, and its settings run`, async () => {
		const workflow = JSON.parse(fs.readFileSync(path.join(examplesDir, file), 'utf8'));
		const names = new Set(workflow.nodes.map((n) => n.name));
		assert.equal(names.size, workflow.nodes.length, 'node names are unique');
		for (const from of Object.keys(workflow.connections)) assert.ok(names.has(from), `connection from ${from}`);
		for (const link of Object.values(workflow.connections).flatMap((c2) => c2.main.flat())) {
			assert.ok(names.has(link.node), `connection to ${link.node}`);
		}
		const nodes = workflow.nodes.filter((n) => n.type === 'n8n-nodes-stocklake.stocklake');
		assert.equal(nodes.length, 1);
		const [node] = nodes;
		assert.equal(node.typeVersion, 2);
		assert.equal(node.parameters.resource, expected.resource);
		assert.equal(node.parameters.operation, expected.operation);
		assert.ok(workflow.nodes.some((n) => /stickyNote/.test(n.type)), 'explains itself in a note');

		// The saved parameters run against the real execute() and give the documented output.
		const fake = createFakeMcp({
			get_stocks: stocksTool(portfolioDocs(false)),
			get_stock: stockDoc('AAPL'),
			get_stock_filings: { items: [] },
			get_earnings_calendar: calendar([]),
		});
		// Check Holdings reads each holding from an input item through `={{ $json.field }}`.
		const input = expected.operation === 'checkHoldings' ? portfolio : [{}];
		const params = input.map((json) =>
			Object.fromEntries(
				Object.entries(node.parameters).map(([key, value]) => [
					key,
					typeof value === 'string' && value.startsWith('={{ $json.')
						? (json[value.slice('={{ $json.'.length, -3).trim()] ?? '')
						: value,
				]),
			),
		);
		const output = await run({ params, items: input.map((json) => ({ json })), fake });
		assert.ok(output[0].length >= 1);
		assert.ok(output[0].every((i) => !('error' in i.json) || i.json.found === false));
		if (expected.operation === 'checkHoldings') {
			assert.deepEqual(output[0].map((i) => i.json.kind), ['holding', 'holding', 'holding', 'summary']);
		}
	});
}
