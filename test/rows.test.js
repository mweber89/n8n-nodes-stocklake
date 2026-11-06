'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { Stocklake } = require('../dist/nodes/Stocklake/Stocklake.node');
const { LIST_SPECS, chunk, extractRows, simplifyRow } = require('../dist/nodes/Stocklake/rows');
const { createFakeMcp, loadNode, runNode } = require('./helpers/fakeMcp');
const { responses, rl, stockRow } = require('./fixtures/responses');

const v1 = loadNode(Stocklake, 1);
const v2 = loadNode(Stocklake, 2);

const run = (node, typeVersion, opts) => runNode(node, { typeVersion, ...opts });

test('every list operation has a realistic fixture, and nothing else does', () => {
	assert.deepEqual(Object.keys(responses).sort(), Object.keys(LIST_SPECS).sort());
});

// ---------------------------------------------------------------- version 1

for (const [key, c] of Object.entries(responses)) {
	test(`v1 ${key}: output is byte-identical to the 0.1.1 shape (whole response, one item)`, async () => {
		const fake = createFakeMcp({ [c.tool]: c.response });
		const output = await run(v1, 1, { params: c.params, fake });
		assert.equal(
			JSON.stringify(output),
			JSON.stringify([[{ json: c.response, pairedItem: { item: 0 } }]]),
		);
	});
}

// ----------------------------------------------------------- row splitting

for (const [key, c] of Object.entries(responses)) {
	test(`v2 ${key}: one item per row, ${c.rowCount} expected`, async () => {
		const fake = createFakeMcp({ [c.tool]: c.response });
		const output = await run(v2, 2, { params: { ...c.params, simplify: false }, fake });
		assert.equal(output[0].length, c.rowCount);
		for (const item of output[0]) {
			assert.ok(
				item.json.symbol !== undefined || item.json.event !== undefined,
				'a row, not the wrapper',
			);
			assert.equal(item.json.count, undefined, 'wrapper fields are not on the rows');
		}
		assert.equal(fake.calls.length, 1);
	});
}

test('v2 history rows carry the symbol of the response', async () => {
	const c = responses['stock.getHistory'];
	const fake = createFakeMcp({ [c.tool]: c.response });
	const output = await run(v2, 2, { params: c.params, fake });
	assert.deepEqual(
		output[0].map((i) => i.json),
		[
			{ symbol: 'AAPL', date: '2026-11-03', open: 1, high: 2, low: 0.5, close: 1.5, volume: 10 },
			{ symbol: 'AAPL', date: '2026-11-04', open: 1.5, high: 2, low: 1, close: 1.8, volume: 11 },
			{ symbol: 'AAPL', date: '2026-11-05', open: 1.8, high: 2.2, low: 1.7, close: 2, volume: 12 },
		],
	);
});

test('v2 Market Movers: one item per mover with a category field', async () => {
	const c = responses['market.getMovers'];
	const fake = createFakeMcp({ [c.tool]: c.response });
	const output = await run(v2, 2, { params: c.params, fake });
	assert.deepEqual(
		output[0].map((i) => [i.json.category, i.json.symbol]),
		[
			['gainers', 'UP1'],
			['gainers', 'UP2'],
			['losers', 'DN1'],
			['most_active', 'MA1'],
		],
	);
});

test('v2 Economic Calendar: released and upcoming events are tagged with their bucket', async () => {
	const c = responses['market.getEconomicCalendar'];
	const fake = createFakeMcp({ [c.tool]: c.response });
	const output = await run(v2, 2, { params: c.params, fake });
	assert.deepEqual(
		output[0].map((i) => [i.json.bucket, i.json.event]),
		[
			['released_recent', 'ISM N-Mfg PMI'],
			['upcoming', 'Retail Sales YY'],
			['upcoming', 'Non-Farm Payrolls'],
		],
	);
});

test('v2 Get Many reads the symbol-keyed map as rows', async () => {
	const c = responses['stock.getMany'];
	const fake = createFakeMcp({ [c.tool]: c.response });
	const output = await run(v2, 2, { params: { ...c.params, simplify: false }, fake });
	assert.deepEqual(
		output[0].map((i) => i.json.symbol),
		['AAPL', 'MSFT'],
	);
	assert.deepEqual(
		output[0][0].json.indicators,
		{ rsi: 61.2, macd: { signal: 'positive' } },
		'full row kept',
	);
});

test('v2 Activity: upcoming items come first and are flagged', async () => {
	const c = responses['stock.getActivity'];
	const fake = createFakeMcp({ [c.tool]: c.response });
	const output = await run(v2, 2, { params: c.params, fake });
	assert.deepEqual(
		output[0].map((i) => [i.json.id, i.json.upcoming]),
		[
			['earnings:1', true],
			['news:1', undefined],
			['news:2', undefined],
		],
	);
});

test('operations that are not lists still return the whole response as one item', async () => {
	const response = { vix: 18.9, breadth: { oversold_count: 3 } };
	const fake = createFakeMcp({ get_market_pulse: response });
	const output = await run(v2, 2, { params: { resource: 'market', operation: 'getPulse' }, fake });
	assert.deepEqual(output, [[{ json: response, pairedItem: { item: 0 } }]]);
});

test('an empty list gives no items, and is not an error', async () => {
	const fake = createFakeMcp({
		get_screener: { count: 0, preset: 'oversold', filters: {}, results: [] },
	});
	const output = await run(v2, 2, {
		params: { resource: 'screener', operation: 'screen', preset: 'oversold' },
		fake,
	});
	assert.deepEqual(output, [[]]);
});

// ----------------------------------------------------------------- simplify

test('Simplify is on by default and returns a flat, chosen set of fields', async () => {
	const c = responses['screener.screen'];
	const fake = createFakeMcp({ [c.tool]: c.response });
	const output = await run(v2, 2, { params: c.params, fake });
	const row = output[0][0].json;
	assert.deepEqual(Object.keys(row).sort(), [
		'ai_score',
		'ai_verdict',
		'analyst_rating',
		'change_pct',
		'currency',
		'industry',
		'market_cap_usd',
		'name',
		'pe_forward',
		'price',
		'rsi',
		'sector',
		'symbol',
		'volume',
	]);
	assert.equal(row.ai_headline, undefined);
	for (const value of Object.values(row)) assert.notEqual(typeof value, 'object', 'flat');
});

test('Simplify off returns the full row', async () => {
	const c = responses['screener.screen'];
	const fake = createFakeMcp({ [c.tool]: c.response });
	const output = await run(v2, 2, { params: { ...c.params, simplify: false }, fake });
	assert.deepEqual(output[0][0].json, c.response.results[0]);
});

test('Simplify flattens nested fields, e.g. Get Many pulls rsi out of indicators', async () => {
	const c = responses['stock.getMany'];
	const fake = createFakeMcp({ [c.tool]: c.response });
	const output = await run(v2, 2, { params: c.params, fake });
	assert.equal(output[0][0].json.rsi, 61.2);
	assert.equal(output[0][0].json.indicators, undefined);
	assert.equal(output[0][0].json.officers, undefined);
});

test('Simplify leaves out fields a row does not have instead of filling nulls', () => {
	assert.deepEqual(simplifyRow({ symbol: 'A', price: 1 }, ['symbol', 'price', 'rsi']), {
		symbol: 'A',
		price: 1,
	});
});

// ------------------------------------------------------------ response metadata

test('metadata is off by default: rows have no wrapper fields', async () => {
	const c = responses['screener.screen'];
	const fake = createFakeMcp({ [c.tool]: c.response });
	const output = await run(v2, 2, { params: c.params, fake });
	assert.ok(output[0].every((i) => i.json._meta === undefined));
});

test('Include Response Metadata adds the wrapper fields to every row as _meta', async () => {
	const c = responses['screener.screen'];
	const fake = createFakeMcp({ [c.tool]: c.response });
	const output = await run(v2, 2, {
		params: { ...c.params, options: { includeMetadata: true } },
		fake,
	});
	for (const item of output[0]) {
		assert.deepEqual(item.json._meta, { count: 2, preset: 'oversold', filters: { max_rsi: 30 } });
	}
});

test('metadata on an empty list still comes back, as the only item', async () => {
	const fake = createFakeMcp({
		get_analyst_trend: {
			symbol: 'XYZ',
			days: 90,
			count: 0,
			snapshots: [],
			note: 'fewer than 2 snapshots',
		},
	});
	const output = await run(v2, 2, {
		params: {
			resource: 'stock',
			operation: 'getAnalystTrend',
			symbol: rl('XYZ'),
			options: { includeMetadata: true },
		},
		fake,
	});
	assert.deepEqual(output, [
		[
			{
				json: { _meta: { symbol: 'XYZ', days: 90, count: 0, note: 'fewer than 2 snapshots' } },
				pairedItem: { item: 0 },
			},
		],
	]);
});

// -------------------------------------------------------------------- limit

test('Limit is sent to the tool', async () => {
	const fake = createFakeMcp({ get_screener: { results: [] } });
	await run(v2, 2, { params: { resource: 'screener', operation: 'screen', limit: 7 }, fake });
	assert.equal(fake.calls[0].arguments.limit, 7);
});

test('a Limit above the tool cap is held to the cap', async () => {
	const caps = {
		'screener.screen': ['get_screener', 25],
		'signal.getMany': ['get_signals', 50],
		'news.getFeed': ['get_news_feed', 25],
		'earnings.getIntelligence': ['get_earnings_intelligence', 25],
		'market.getMovers': ['get_market_movers', 20],
	};
	for (const [key, [tool, cap]] of Object.entries(caps)) {
		const [resource, operation] = key.split('.');
		const fake = createFakeMcp({ [tool]: {} });
		await run(v2, 2, { params: { resource, operation, limit: 1000 }, fake });
		assert.equal(fake.calls[0].arguments.limit, cap, key);
	}
	const filings = createFakeMcp({ get_stock_filings: {} });
	await run(v2, 2, {
		params: { resource: 'stock', operation: 'getFilings', symbol: rl('AAPL'), maxResults: 1000 },
		fake: filings,
	});
	assert.equal(filings.calls[0].arguments.limit, 25);
});

test('Limit and Return All are shown the way n8n expects', () => {
	const props = v2.description.properties;
	const returnAll = props.filter((p) => p.name === 'returnAll');
	assert.ok(returnAll.length >= 10);
	for (const p of returnAll) {
		assert.equal(p.type, 'boolean');
		assert.equal(p.default, false);
		assert.equal(p.description, 'Whether to return all results or only up to a given limit');
	}
	const limits = props.filter(
		(p) => ['limit', 'maxResults'].includes(p.name) && p.displayOptions.show.returnAll,
	);
	assert.equal(limits.length, returnAll.length, 'every Return All hides one Limit');
	for (const p of limits) assert.deepEqual(p.displayOptions.show.returnAll, [false]);
});

// ---------------------------------------------------- Return All and paging

test('Return All on a single-call operation asks for the tool maximum', async () => {
	const fake = createFakeMcp({ get_signals: { signals: [] } });
	await run(v2, 2, {
		params: { resource: 'signal', operation: 'getMany', returnAll: true, limit: 3 },
		fake,
	});
	assert.equal(fake.calls.length, 1);
	assert.equal(fake.calls[0].arguments.limit, 50);
});

function activityPages(totalPages, perPage) {
	let id = 0;
	return (args) => {
		const page = args.page;
		const items = Array.from({ length: perPage }, () => ({
			id: `news:${++id}`,
			type: 'news',
			symbol: 'NVDA',
			headline: `h${id}`,
		}));
		return {
			symbol: 'NVDA',
			page,
			pages: totalPages,
			total: totalPages * perPage,
			limit: args.limit,
			items,
			upcoming:
				page === 1
					? [{ id: 'earnings:1', type: 'earnings', symbol: 'NVDA', headline: 'Earnings' }]
					: [],
		};
	};
}

const activityParams = {
	resource: 'stock',
	operation: 'getActivity',
	symbol: rl('NVDA'),
	simplify: false,
};

test('Return All pages through Activity until the last page, 50 per call', async () => {
	const fake = createFakeMcp({ get_stock_activity: activityPages(3, 50) });
	const output = await run(v2, 2, { params: { ...activityParams, returnAll: true }, fake });

	assert.deepEqual(
		fake.calls.map((c) => [c.arguments.page, c.arguments.limit]),
		[
			[1, 50],
			[2, 50],
			[3, 50],
		],
	);
	assert.equal(output[0].length, 150 + 1, '3 pages of 50 plus the upcoming item, once');
	assert.equal(output[0].filter((i) => i.json.upcoming === true).length, 1);
	assert.equal(new Set(output[0].map((i) => i.json.id)).size, 151, 'no row twice');
});

test('Return All starts at page 1 whatever the Page field says', async () => {
	const fake = createFakeMcp({ get_stock_activity: activityPages(2, 5) });
	await run(v2, 2, { params: { ...activityParams, returnAll: true, page: 4 }, fake });
	assert.equal(fake.calls[0].arguments.page, 1);
});

test('Limit above one page reads more pages and stops at exactly the limit', async () => {
	const fake = createFakeMcp({ get_stock_activity: activityPages(10, 50) });
	const output = await run(v2, 2, { params: { ...activityParams, maxResults: 120 }, fake });

	assert.deepEqual(
		fake.calls.map((c) => [c.arguments.page, c.arguments.limit]),
		[
			[1, 50],
			[2, 50],
			[3, 50],
		],
		'page size stays 50 so pages line up',
	);
	assert.equal(output[0].filter((i) => i.json.upcoming !== true).length, 120);
});

test('a Limit that fits in one page is one call, and Page picks the page', async () => {
	const fake = createFakeMcp({ get_stock_activity: activityPages(10, 10) });
	await run(v2, 2, { params: { ...activityParams, maxResults: 10, page: 3 }, fake });
	assert.equal(fake.calls.length, 1);
	assert.deepEqual([fake.calls[0].arguments.page, fake.calls[0].arguments.limit], [3, 10]);
});

test('paging stops when a page comes back empty, even if more pages were promised', async () => {
	const fake = createFakeMcp({
		get_stock_activity: (args) => ({
			page: args.page,
			pages: 99,
			items: args.page === 1 ? [{ id: 'a' }] : [],
		}),
	});
	const output = await run(v2, 2, { params: { ...activityParams, returnAll: true }, fake });
	assert.equal(fake.calls.length, 2);
	assert.equal(output[0].length, 1);
});

test('types are sent on every page', async () => {
	const fake = createFakeMcp({ get_stock_activity: activityPages(2, 3) });
	await run(v2, 2, { params: { ...activityParams, returnAll: true, types: ['news'] }, fake });
	assert.deepEqual(
		fake.calls.map((c) => c.arguments.types),
		[['news'], ['news']],
	);
});

function calendarPages(total, pageSize) {
	return (args) => {
		const start = args.offset ?? 0;
		const n = Math.min(args.limit, pageSize, total - start);
		const results = Array.from({ length: n }, (_, k) => ({
			symbol: `S${start + k}`,
			earnings_date: '2026-11-10',
		}));
		const next = start + n < total ? start + n : null;
		return { total_in_window: total, count: n, offset: start, next_offset: next, results };
	};
}

const calendarParams = { resource: 'earnings', operation: 'getCalendar', simplify: false };

test('Return All pages the earnings calendar with offset until next_offset is empty', async () => {
	const fake = createFakeMcp({ get_earnings_calendar: calendarPages(1200, 500) });
	const output = await run(v2, 2, { params: { ...calendarParams, returnAll: true }, fake });

	assert.deepEqual(
		fake.calls.map((c) => [c.arguments.limit, c.arguments.offset]),
		[
			[500, undefined],
			[500, 500],
			[500, 1000],
		],
	);
	assert.equal(output[0].length, 1200);
});

test('earnings calendar Limit of 700 reads two calls and keeps 700', async () => {
	const fake = createFakeMcp({ get_earnings_calendar: calendarPages(1200, 500) });
	const output = await run(v2, 2, { params: { ...calendarParams, limit: 700 }, fake });
	assert.equal(fake.calls.length, 2);
	assert.equal(output[0].length, 700);
});

test('earnings calendar for a plan that ignores offset does not loop', async () => {
	// Free and guest: the API returns the same 5 rows and keeps offering next_offset.
	const fake = createFakeMcp({
		get_earnings_calendar: () => ({
			total_in_window: 500,
			offset: 0,
			next_offset: 0,
			results: [{ symbol: 'A' }, { symbol: 'B' }],
		}),
	});
	const output = await run(v2, 2, { params: { ...calendarParams, returnAll: true }, fake });
	assert.equal(fake.calls.length, 1);
	assert.equal(output[0].length, 2);
});

test('Get Many with more than 25 symbols is sent in batches of 25', async () => {
	const symbols = Array.from({ length: 60 }, (_, k) => `S${k}`);
	const fake = createFakeMcp({
		get_stocks: (args) => ({
			count: args.symbols.filter((s) => s !== 'S59').length,
			requested: args.symbols.length,
			missing: args.symbols.includes('S59') ? ['S59'] : [],
			duplicates_collapsed: 0,
			symbols: Object.fromEntries(
				args.symbols.filter((s) => s !== 'S59').map((s) => [s, { symbol: s, price: 1 }]),
			),
		}),
	});
	const output = await run(v2, 2, {
		params: {
			resource: 'stock',
			operation: 'getMany',
			symbols: symbols.join(','),
			options: { includeMetadata: true },
		},
		fake,
	});

	assert.deepEqual(
		fake.calls.map((c) => c.arguments.symbols.length),
		[25, 25, 10],
	);
	assert.equal(output[0].length, 59);
	const { count, requested, missing, duplicates_collapsed, estimated_calls, requests } =
		output[0][0].json._meta;
	assert.deepEqual(
		{ count, requested, missing, duplicates_collapsed, estimated_calls, requests },
		{
			count: 59,
			requested: 60,
			missing: ['S59'],
			duplicates_collapsed: 0,
			estimated_calls: 60,
			requests: 3,
		},
	);
});

test('chunk splits lists and keeps order', () => {
	assert.deepEqual(chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
	assert.deepEqual(chunk([], 25), []);
});

// ------------------------------------------------------------- paired items

test('every output item is paired with the input item that produced it', async () => {
	const fake = createFakeMcp({
		get_stock_history: (args) => ({
			symbol: args.symbol,
			history: [{ date: 'd1' }, { date: 'd2' }],
		}),
	});
	const output = await run(v2, 2, {
		items: [{ json: {} }, { json: {} }, { json: {} }],
		params: ['AAPL', 'MSFT', 'NVDA'].map((s) => ({
			resource: 'stock',
			operation: 'getHistory',
			symbol: rl(s),
		})),
		fake,
	});

	assert.deepEqual(
		output[0].map((i) => [i.json.symbol, i.pairedItem.item]),
		[
			['AAPL', 0],
			['AAPL', 0],
			['MSFT', 1],
			['MSFT', 1],
			['NVDA', 2],
			['NVDA', 2],
		],
	);
});

test('paired items stay right when one input item needs several calls', async () => {
	const fake = createFakeMcp({ get_stock_activity: (args) => activityPages(2, 2)(args) });
	const output = await run(v2, 2, {
		items: [{ json: {} }, { json: {} }],
		params: [
			{ ...activityParams, returnAll: true },
			{ ...activityParams, returnAll: true },
		],
		fake,
	});
	assert.deepEqual(
		output[0].map((i) => i.pairedItem.item),
		[0, 0, 0, 0, 0, 1, 1, 1, 1, 1],
	);
});

test('a failed input item with Continue On Fail is paired too, and later items still run', async () => {
	const fake = createFakeMcp({
		get_stock_history: (args) =>
			args.symbol === 'BAD'
				? { error: { code: 'symbol_not_found', message: 'No data for BAD', type: 'not_found' } }
				: { symbol: args.symbol, history: [{ date: 'd1' }] },
	});
	const output = await run(v2, 2, {
		items: [{ json: {} }, { json: {} }, { json: {} }],
		params: ['AAPL', 'BAD', 'MSFT'].map((s) => ({
			resource: 'stock',
			operation: 'getHistory',
			symbol: rl(s),
		})),
		fake,
		continueOnFail: true,
	});
	assert.deepEqual(
		output[0].map((i) => [i.json.symbol ?? i.json.error, i.pairedItem.item]),
		[
			['AAPL', 0],
			['No data for BAD', 1],
			['MSFT', 2],
		],
	);
});

test('items are paired by object, not just present: constructExecutionMetaData is used', async () => {
	const c = responses['signal.getMany'];
	const fake = createFakeMcp({ [c.tool]: c.response });
	const output = await run(v2, 2, { params: c.params, fake });
	for (const item of output[0]) assert.deepEqual(item.pairedItem, { item: 0 });
});

// ----------------------------------------------------------- extractRows unit

test('extractRows tags rows, injects the parent symbol, and ignores non-object entries', () => {
	const spec = LIST_SPECS['market.getMovers'];
	const { rows } = extractRows(
		{ gainers: [{ symbol: 'A' }, 'junk', null], losers: [stockRow('B')] },
		spec,
	);
	assert.deepEqual(
		rows.map((r) => [r.category, r.symbol]),
		[
			['gainers', 'A'],
			['losers', 'B'],
		],
	);
});
