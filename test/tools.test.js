'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { traverseNodeParameters, generateZodSchema } = require('n8n-workflow');

const { Stocklake } = require('../dist/nodes/Stocklake/Stocklake.node');
const catalog = require('../dist/nodes/Stocklake/toolCatalog');
const { OPERATION_TOOLS } = require('../dist/nodes/Stocklake/descriptions/shared');
const { toolkitDescriptionExpression } = require('../dist/nodes/Stocklake/descriptions/ToolDescription');
const { createFakeMcp, loadNode, resolveParameters, runNode } = require('./helpers/fakeMcp');

/**
 * AI-agent tuning (issue #8): what an AI Agent sees of the node when it is used as a tool
 * ("Stocklake Tool"): a description written for a model per operation, `$fromAI()` defaults for
 * the few arguments it fills in, and the Toolkit, one tool with an operation filter.
 *
 * `asTool` runs the node with `@tool` true, as n8n does for the tool variant, and fills the
 * `$fromAI()` values from `toolArguments`, as n8n does with what the model sent.
 */

const node = new Stocklake();
const v2 = loadNode(Stocklake, 2);
const description = v2.description;
const OPERATIONS = Object.keys(OPERATION_TOOLS);

const tool = (opts) => runNode(v2, { typeVersion: 2, asTool: true, ...opts });

/** A server that answers every tool with an empty but well-formed response. */
function emptyServer() {
	const empty = { count: 0, history: [], results: [], symbols: {}, items: [], articles: [], snapshots: [] };
	return createFakeMcp(new Proxy({}, { has: () => true, get: () => empty }));
}

/** What n8n builds the tool schema from: every `$fromAI()` call in the parameters. */
function placeholders(params) {
	const resolved = resolveParameters(description, params, 2, true);
	const found = [];
	traverseNodeParameters(resolved, found);
	return found;
}

// ====================================================================== the catalog

test('the catalog describes every operation of the node, and nothing else', () => {
	assert.deepEqual(Object.keys(catalog.TOOL_OPERATIONS).sort(), [...OPERATIONS].sort());
});

test('descriptions are written for a model: what comes back, when to use it, which plan', () => {
	for (const [key, op] of Object.entries(catalog.TOOL_OPERATIONS)) {
		assert.ok(op.description.length >= 60 && op.description.length <= 520, `${key} length ${op.description.length}`);
		assert.match(op.description, /\b(Free|free|Pro)\b/, `${key} says which plan it needs`);
		assert.ok(op.summary.length > 10 && op.summary.length <= 100, `${key} summary`);
		assert.doesNotMatch(op.description, /\{\{|\$fromAI/, `${key} has no expression in its text`);
	}
	// Pro-only operations say so, so a model does not pick them for a free key.
	for (const key of ['stock.getResearch', 'stock.getIndicatorHistory', 'stock.getAnalystTrend', 'market.getAssessment', 'sector.getIntelligence', 'earnings.getIntelligence', 'news.getFeed', 'signal.getMany', 'watchlist.get']) {
		assert.match(catalog.TOOL_OPERATIONS[key].description, /Requires a Pro key/, key);
	}
});

test('operations that look alike point a model to the right one', () => {
	const text = (key) => catalog.TOOL_OPERATIONS[key].description;
	assert.match(text('stock.getMany'), /Compare/);
	assert.match(text('news.getFeed'), /Get News/);
	assert.match(text('stock.getNews'), /News Feed/);
});

// ======================================================================== tool mode

test('a Stocklake Tool carries a ready-made description for every operation', () => {
	for (const key of OPERATIONS) {
		const [resource, operation] = key.split('.');
		const resolved = resolveParameters(description, { resource, operation }, 2, true);
		assert.equal(resolved.toolDescription, catalog.TOOL_OPERATIONS[key].description, key);
	}
});

test('the node itself is unchanged: no tool description, no $fromAI, no Toolkit', () => {
	for (const key of OPERATIONS) {
		const [resource, operation] = key.split('.');
		const resolved = resolveParameters(description, { resource, operation }, 2, false);
		assert.equal(resolved.toolDescription, undefined, key);
		assert.equal(JSON.stringify(resolved).includes('$fromAI'), false, key);
	}
	const resources = description.properties
		.filter((p) => p.name === 'resource' && !p.displayOptions?.hide?.['@tool'])
		.flatMap((p) => p.options.map((o) => o.value));
	// Only the tool's copy of the resource list has the Toolkit.
	const visibleOutsideTools = description.properties.filter(
		(p) => p.name === 'resource' && !p.displayOptions?.show?.['@tool'],
	);
	assert.equal(visibleOutsideTools.length, 1);
	assert.equal(visibleOutsideTools[0].options.some((o) => o.value === 'toolkit'), false);
	assert.ok(resources.length > 0);
});

test('every $fromAI() the tool makes parses, has a valid key and is consistent', () => {
	for (const key of OPERATIONS) {
		const [resource, operation] = key.split('.');
		const found = placeholders({ resource, operation });
		const seen = new Map();
		for (const call of found) {
			assert.match(call.key, /^[a-zA-Z0-9_-]{1,64}$/, `${key}: ${call.key}`);
			assert.ok(call.description && call.description.length > 5, `${key}: ${call.key} has a description`);
			assert.ok(['string', 'number'].includes(call.type), `${key}: ${call.key} type`);
			const before = seen.get(call.key);
			if (before) assert.deepEqual(before, call, `${key}: ${call.key} used twice with a different meaning`);
			seen.set(call.key, call);
		}
		// What the catalog says the agent fills in is exactly what the schema has.
		const expected = Object.values(catalog.TOOL_OPERATIONS[key].args).map((a) => a.key).sort();
		assert.deepEqual([...seen.keys()].sort(), expected, key);
	}
});

test('the symbol is required, days and limit have a default (so the agent may leave them out)', () => {
	const calls = Object.fromEntries(placeholders({ resource: 'stock', operation: 'getNews' }).map((c) => [c.key, c]));
	assert.equal(calls.symbol.defaultValue, undefined, 'a ticker is required');
	assert.equal(calls.limit.defaultValue, 10);
	assert.equal(calls.days.defaultValue, 14);
	const schema = Object.fromEntries(Object.values(calls).map((c) => [c.key, generateZodSchema(c)]));
	assert.equal(schema.symbol.safeParse(undefined).success, false);
	assert.equal(schema.limit.safeParse(undefined).success, true);
	assert.equal(schema.symbol.safeParse('NVDA').success, true);
});

test('the Get Many and Compare list and the screener presets are filled by the agent too', () => {
	assert.deepEqual(placeholders({ resource: 'stock', operation: 'getMany' }).map((c) => c.key), ['symbols']);
	assert.deepEqual(placeholders({ resource: 'stock', operation: 'compare' }).map((c) => c.key).sort(), ['order', 'rank_by', 'symbols']);
	assert.deepEqual(placeholders({ resource: 'screener', operation: 'screen' }).map((c) => c.key).sort(), ['limit', 'preset', 'sector']);
});

test('no field an agent cannot use is shown to it (Return All, Symbol Source, Page)', () => {
	for (const key of ['stock.getMany', 'stock.compare', 'stock.getHistory', 'stock.getActivity', 'screener.screen', 'earnings.getCalendar']) {
		const [resource, operation] = key.split('.');
		const resolved = resolveParameters(description, { resource, operation }, 2, true);
		for (const hidden of ['returnAll', 'symbolSource', 'symbolsFromInput', 'page']) {
			assert.equal(hidden in resolved, false, `${key} shows ${hidden} to an agent`);
		}
	}
});

// Operation -> what an agent sends -> the call Stocklake gets.
const CALLS = [
	['stock.get', { symbol: 'NVDA' }, 'get_stock', { symbol: 'NVDA' }],
	['stock.getMany', { symbols: 'aapl, msft' }, 'get_stocks', { symbols: ['AAPL', 'MSFT'] }],
	['stock.getHistory', { symbol: 'NVDA' }, 'get_stock_history', { symbol: 'NVDA', days: 30 }],
	['stock.getHistory', { symbol: 'NVDA', days: 200 }, 'get_stock_history', { symbol: 'NVDA', days: 200 }],
	['stock.getIndicatorHistory', { symbol: 'NVDA' }, 'get_indicator_history', { symbol: 'NVDA', days: 30 }],
	['stock.getNews', { symbol: 'NVDA' }, 'get_stock_news', { symbol: 'NVDA', limit: 10, days: 14 }],
	['stock.getResearch', { symbol: 'NVDA' }, 'get_stock_research', { symbol: 'NVDA' }],
	['stock.getInsiderActivity', { symbol: 'NVDA' }, 'get_insider_activity', { symbol: 'NVDA' }],
	['stock.getFinancials', { symbol: 'NVDA' }, 'get_stock_financials', { symbol: 'NVDA' }],
	['stock.getFilings', { symbol: 'NVDA', limit: 3 }, 'get_stock_filings', { symbol: 'NVDA', limit: 3 }],
	['stock.getActivity', { symbol: 'NVDA' }, 'get_stock_activity', { symbol: 'NVDA', days: 30, limit: 10 }],
	['stock.getAnalystTrend', { symbol: 'NVDA' }, 'get_analyst_trend', { symbol: 'NVDA', days: 90 }],
	['screener.screen', { preset: 'oversold', sector: 'Technology' }, 'get_screener', { preset: 'oversold', sector: 'Technology', limit: 10 }],
	['market.getPulse', {}, 'get_market_pulse', {}],
	['market.getMovers', { category: 'losers', limit: 5 }, 'get_market_movers', { category: 'losers', limit: 5 }],
	['market.getAssessment', {}, 'get_market_assessment', {}],
	['market.getEconomicCalendar', {}, 'get_economic_calendar', { limit: 20 }],
	['sector.getIntelligence', { sector: 'Energy' }, 'get_sector_intelligence', { sector: 'Energy' }],
	['earnings.getCalendar', { days: 3 }, 'get_earnings_calendar', { days: 3, limit: 20 }],
	['earnings.getIntelligence', {}, 'get_earnings_intelligence', { days_ahead: 14, limit: 15 }],
	['news.getFeed', {}, 'get_news_feed', { days: 3, limit: 10 }],
	['signal.getMany', {}, 'get_signals', { limit: 10 }],
	['watchlist.get', {}, 'get_watchlist', {}],
];

test('each operation, set up as a tool, sends the right call for what an agent fills in', async () => {
	for (const [key, toolArguments, toolName, expected] of CALLS) {
		const [resource, operation] = key.split('.');
		const fake = emptyServer();
		await tool({ fake, toolArguments, params: { resource, operation } });
		assert.equal(fake.calls.length, 1, `${key}: one call`);
		assert.equal(fake.calls[0].toolName, toolName, key);
		assert.deepEqual(
			Object.fromEntries(Object.keys(expected).map((k) => [k, fake.calls[0].arguments[k]])),
			expected,
			key,
		);
	}
});

test('Compare, Snapshot and Check Holdings work as tools too', async () => {
	const stock = (symbol) => ({ symbol, name: symbol, price: 100, change_pct: 1, pe_forward: symbol === 'MSFT' ? 25 : 30, indicators: { rsi: 50 } });
	const fake = createFakeMcp({
		get_stocks: (args) => ({
			count: args.symbols.length,
			symbols: Object.fromEntries(args.symbols.map((s) => [s, stock(s)])),
		}),
		get_stock: stock('AAPL'),
		get_stock_filings: { items: [] },
	});

	const compared = await tool({
		fake,
		toolArguments: { symbols: 'AAPL, MSFT', rank_by: 'peForward', order: 'asc' },
		params: { resource: 'stock', operation: 'compare' },
	});
	assert.deepEqual(compared[0].map((i) => i.json.symbol), ['MSFT', 'AAPL']);
	assert.equal(compared[0][0].json.rank, 1);

	const snap = await tool({ fake, toolArguments: { symbol: 'AAPL' }, params: { resource: 'stock', operation: 'snapshot' } });
	assert.equal(snap[0][0].json.symbol, 'AAPL');
	assert.ok(snap[0][0].json.summary);

	const held = await tool({
		fake,
		toolArguments: { symbol: 'AAPL', quantity: 10, cost: 90 },
		params: { resource: 'portfolio', operation: 'checkHoldings' },
	});
	const holding = held[0].find((i) => i.json.symbol === 'AAPL');
	assert.equal(holding.json.quantity, 10);
	assert.equal(holding.json.value, 1000);
});

// ====================================================================== the Toolkit

const toolkit = (extra = {}) => ({ resource: 'toolkit', operation: 'choose', ...extra });

test('the Toolkit is a resource of the tool only, with its own operation and filter', () => {
	const resolved = resolveParameters(description, toolkit(), 2, true);
	assert.deepEqual(resolved.toolkitOperations, catalog.TOOLKIT_DEFAULT_OPERATIONS);
	assert.equal(resolved.operation, 'choose');
	assert.match(resolved.agentOperation, /\$fromAI\('operation'/);
	// Outside a tool none of this exists.
	const plain = resolveParameters(description, toolkit(), 2, false);
	assert.equal('toolkitOperations' in plain, false);
	assert.equal('agentOperation' in plain, false);
});

test('the filter starts with the operations that work without Pro, and offers all the others', () => {
	const free = ['stock.get','stock.getMany','stock.getHistory','stock.getNews','stock.getInsiderActivity','screener.screen','market.getPulse','market.getMovers','earnings.getCalendar','stock.getFinancials','stock.getFilings','stock.getActivity','market.getEconomicCalendar','stock.compare','stock.snapshot'];
	assert.deepEqual([...catalog.TOOLKIT_DEFAULT_OPERATIONS].sort(), [...free].sort());
	const filter = description.properties.find((p) => p.name === 'toolkitOperations');
	assert.equal(filter.type, 'multiOptions');
	assert.deepEqual(filter.options.map((o) => o.value).sort(), [...catalog.TOOLKIT_OPERATIONS].sort());
	const names = filter.options.map((o) => o.name);
	assert.deepEqual(names, [...names].sort((a, b) => a.localeCompare(b)), 'alphabetical, as n8n lints');
	assert.ok(!filter.options.some((o) => o.value === 'portfolio.checkHoldings'), 'Check Holdings needs more than a few arguments');
});

test('the Toolkit schema: an operation, and nine optional arguments', () => {
	const found = placeholders(toolkit());
	assert.deepEqual(found.map((c) => c.key).sort(), ['category', 'days', 'limit', 'order', 'operation', 'preset', 'rank_by', 'sector', 'symbol', 'symbols'].sort());
	const required = found.filter((c) => c.defaultValue === undefined).map((c) => c.key);
	assert.deepEqual(required, ['operation']);
	for (const call of found) assert.match(call.key, /^[a-zA-Z0-9_-]{1,64}$/);
});

/** Evaluates the description expression the way n8n does: with $parameter in scope. */
function describeFor(operations) {
	const expression = toolkitDescriptionExpression();
	assert.ok(expression.startsWith('={{ ') && expression.endsWith(' }}'));
	const body = expression.slice(4, -3);
	return new Function('$parameter', `return ${body};`)({ toolkitOperations: operations });
}

test('the Toolkit description lists exactly the operations that are switched on', () => {
	const text = describeFor(['stock.get', 'market.getPulse']);
	assert.match(text, /^Stocklake stock market data/);
	assert.match(text, /stock\.get\(symbol\) - /);
	assert.match(text, /market\.getPulse\(\) - /);
	assert.doesNotMatch(text, /screener\.screen/, 'an operation that is off is not mentioned');
	assert.doesNotMatch(text, /stock\.compare/);
	assert.equal(text.split('\n').length, 3, 'a line of introduction and one per operation');
});

test('the Toolkit description marks optional arguments and names the ones that matter', () => {
	const text = describeFor(catalog.TOOLKIT_DEFAULT_OPERATIONS);
	assert.match(text, /stock\.getHistory\(symbol, \[days\]\)/);
	assert.match(text, /stock\.compare\(symbols, \[rank_by\], \[order\]\)/);
	assert.match(text, /screener\.screen\(\[preset\], \[sector\], \[limit\]\)/);
	// An empty filter lists nothing but still reads as a sentence.
	assert.equal(describeFor([]).split('\n').length, 2);
	assert.ok(describeFor([]).length < 400);
});

test('the Toolkit description is small enough to be cheap on every call', () => {
	const all = describeFor(catalog.TOOLKIT_OPERATIONS);
	assert.ok(all.length < 3500, `all operations: ${all.length} characters`);
	const free = describeFor(catalog.TOOLKIT_DEFAULT_OPERATIONS);
	assert.ok(free.length < 2300, `default operations: ${free.length} characters`);
});

const SAMPLE = [
	[{ operation: 'stock.get', symbol: 'NVDA' }, 'get_stock', { symbol: 'NVDA' }],
	[{ operation: 'stock.getHistory', symbol: 'NVDA', days: 200 }, 'get_stock_history', { symbol: 'NVDA', days: 200 }],
	[{ operation: 'stock.getHistory', symbol: 'NVDA' }, 'get_stock_history', { symbol: 'NVDA', days: 30 }],
	[{ operation: 'screener.screen', preset: 'oversold', sector: 'Technology', limit: 5 }, 'get_screener', { preset: 'oversold', sector: 'Technology', limit: 5 }],
	[{ operation: 'market.getMovers', category: 'gainers' }, 'get_market_movers', { category: 'gainers', limit: 10 }],
	[{ operation: 'market.getPulse' }, 'get_market_pulse', {}],
	[{ operation: 'stock.getNews', symbol: 'NVDA', limit: 3 }, 'get_stock_news', { symbol: 'NVDA', limit: 3 }],
	[{ operation: 'earnings.getCalendar', days: 5 }, 'get_earnings_calendar', { days: 5 }],
	// How a model may write the operation: case, separators and the name of the menu entry.
	[{ operation: 'Stock.Get', symbol: 'NVDA' }, 'get_stock', { symbol: 'NVDA' }],
	[{ operation: 'stock_get', symbol: 'NVDA' }, 'get_stock', { symbol: 'NVDA' }],
	[{ operation: ' stock.get ', symbol: 'NVDA' }, 'get_stock', { symbol: 'NVDA' }],
];

test('the Toolkit runs the operation the agent names with the arguments it sent', async () => {
	for (const [toolArguments, toolName, expected] of SAMPLE) {
		const fake = emptyServer();
		await tool({ fake, toolArguments, params: toolkit() });
		assert.equal(fake.calls.length, 1, JSON.stringify(toolArguments));
		assert.equal(fake.calls[0].toolName, toolName);
		for (const [k, v] of Object.entries(expected)) {
			assert.deepEqual(fake.calls[0].arguments[k], v, `${JSON.stringify(toolArguments)} ${k}`);
		}
	}
});

test('the Toolkit gives rows like the operation set up by hand (Compare, ranked)', async () => {
	const stocks = {
		get_stocks: (args) => ({
			count: args.symbols.length,
			symbols: Object.fromEntries(
				args.symbols.map((s, n) => [s, { symbol: s, name: s, price: 10, pe_forward: 30 - n * 5, indicators: { rsi: 50 } }]),
			),
		}),
	};
	const out = await tool({
		fake: createFakeMcp(stocks),
		toolArguments: { operation: 'stock.compare', symbols: 'AAPL, MSFT, NVDA', rank_by: 'peForward', order: 'asc' },
		params: toolkit(),
	});
	assert.deepEqual(out[0].map((i) => [i.json.symbol, i.json.rank]), [['NVDA', 1], ['MSFT', 2], ['AAPL', 3]]);
	assert.ok(out[0].every((i) => i.pairedItem.item === 0));
});

test('the filter: an operation that is switched off cannot run, and no call is made', async () => {
	const fake = emptyServer();
	await assert.rejects(
		tool({
			fake,
			toolArguments: { operation: 'stock.getHistory', symbol: 'NVDA' },
			params: toolkit({ toolkitOperations: ['market.getPulse', 'stock.get'] }),
		}),
		(error) => {
			assert.match(error.message, /Operation "stock.getHistory" is not available in this tool/);
			assert.match(error.message, /Use one of: market\.getPulse, stock\.get$/, 'the agent is told what it may use');
			return true;
		},
	);
	assert.equal(fake.calls.length, 0);
});

test('the filter: a read-only market-data set is possible, and a Pro operation can be added', async () => {
	const marketOnly = ['market.getPulse', 'market.getMovers', 'market.getEconomicCalendar', 'earnings.getCalendar'];
	const fake = emptyServer();
	await tool({ fake, toolArguments: { operation: 'market.getMovers' }, params: toolkit({ toolkitOperations: marketOnly }) });
	assert.equal(fake.calls[0].toolName, 'get_market_movers');
	await assert.rejects(
		tool({ fake, toolArguments: { operation: 'stock.get', symbol: 'AAPL' }, params: toolkit({ toolkitOperations: marketOnly }) }),
		/not available/,
	);
	await tool({
		fake,
		toolArguments: { operation: 'stock.getResearch', symbol: 'AAPL' },
		params: toolkit({ toolkitOperations: [...marketOnly, 'stock.getResearch'] }),
	});
	assert.equal(fake.calls.at(-1).toolName, 'get_stock_research');
});

test('the Toolkit refuses what it cannot run with a message the agent can act on', async () => {
	const cases = [
		[{ operation: '  ' }, /Say which operation to run\. Use one of: stock\.get/],
		[{ operation: 'nonsense' }, /Unknown operation "nonsense"\. Use one of: stock\.get/],
		[{ operation: 'stock.get' }, /stock\.get needs the argument symbol/],
		[{ operation: 'stock.compare' }, /stock\.compare needs the argument symbols/],
		[{ operation: 'stock.compare', symbols: 'A, B', rank_by: 'bogus' }, /rank_by must be one of: .*peForward/],
		[{ operation: 'stock.compare', symbols: 'A, B', rank_by: 'rsi', order: 'up' }, /order must be one of: asc, desc/],
		[{ operation: 'market.getMovers', category: 'weird' }, /category must be one of: all, gainers, losers, most_active/],
		[{ operation: 'portfolio.checkHoldings', symbol: 'A', quantity: 1 }, /Unknown operation/],
	];
	for (const [toolArguments, pattern] of cases) {
		const fake = emptyServer();
		await assert.rejects(tool({ fake, toolArguments, params: toolkit() }), pattern, JSON.stringify(toolArguments));
		assert.equal(fake.calls.length, 0, 'nothing is sent for a call that cannot work');
	}
});

test('with an empty filter the Toolkit says so', async () => {
	await assert.rejects(
		tool({ fake: emptyServer(), toolArguments: { operation: 'stock.get', symbol: 'A' }, params: toolkit({ toolkitOperations: [] }) }),
		/No operation is switched on/,
	);
});

test('Continue On Fail: a refused call comes back as an item the agent can read', async () => {
	const out = await tool({
		fake: emptyServer(),
		continueOnFail: true,
		toolArguments: { operation: 'nonsense' },
		params: toolkit(),
	});
	assert.match(out[0][0].json.error, /Unknown operation "nonsense"/);
});

test('the request options of the node still apply to what the Toolkit runs', async () => {
	const fake = emptyServer();
	await tool({
		fake,
		toolArguments: { operation: 'stock.get', symbol: 'NVDA' },
		params: toolkit({ requestOptions: { timeout: 1234 } }),
	});
	assert.deepEqual(fake.timeouts, [1234]);
});

test('the Toolkit keeps the symbol checks of the operation (a bad ticker is an error row, not a crash)', async () => {
	const fake = createFakeMcp({
		get_stocks: (args) => ({ count: 1, symbols: { AAPL: { symbol: 'AAPL', price: 1, indicators: {} } }, missing: args.symbols.filter((s) => s !== 'AAPL') }),
	});
	const out = await tool({
		fake,
		toolArguments: { operation: 'stock.compare', symbols: 'AAPL, ZZZZ' },
		params: toolkit(),
	});
	assert.deepEqual(out[0].map((i) => i.json.symbol), ['AAPL', 'ZZZZ']);
	assert.equal(out[0][1].json.found, false);
});

test('version 1 is not touched: no tool fields, no Toolkit', () => {
	const v1 = node.nodeVersions[1].description;
	assert.equal(JSON.stringify(v1.properties).includes('@tool'), false);
	assert.equal(JSON.stringify(v1.properties).includes('toolkit'), false);
	assert.equal(v1.usableAsTool, true);
	assert.equal(description.usableAsTool, true);
});

// ============================================================== example workflow

test('example workflow ai-agent-toolkit: valid, a Toolkit with a filter, and the tool runs what the agent asks', async () => {
	const fs = require('node:fs');
	const path = require('node:path');
	const workflow = JSON.parse(
		fs.readFileSync(path.join(__dirname, '..', 'examples', 'ai-agent-toolkit.workflow.json'), 'utf8'),
	);
	const names = new Set(workflow.nodes.map((n) => n.name));
	assert.equal(names.size, workflow.nodes.length);
	for (const [from, kinds] of Object.entries(workflow.connections)) {
		assert.ok(names.has(from));
		for (const link of Object.values(kinds).flat(2)) assert.ok(names.has(link.node));
	}
	assert.ok(workflow.nodes.some((n) => /stickyNote/.test(n.type)));
	assert.ok(workflow.connections.Stocklake.ai_tool, 'the Stocklake tool is connected to the agent');

	const [stocklake] = workflow.nodes.filter((n) => n.type === 'n8n-nodes-stocklake.stocklakeTool');
	assert.equal(stocklake.typeVersion, 2);
	assert.equal(stocklake.parameters.resource, 'toolkit');
	const filter = stocklake.parameters.toolkitOperations;
	assert.ok(filter.length >= 2 && filter.length < catalog.TOOLKIT_OPERATIONS.length, 'a subset, not everything');
	for (const key of filter) assert.ok(catalog.TOOLKIT_OPERATIONS.includes(key), key);
	// Works for a free key: nothing in the filter needs Pro.
	for (const key of filter) assert.ok(catalog.TOOLKIT_DEFAULT_OPERATIONS.includes(key), `${key} needs Pro`);

	// The saved parameters, run like the agent would: one question, one call.
	const fake = emptyServer();
	await tool({
		fake,
		toolArguments: { operation: 'screener.screen', preset: 'oversold', sector: 'Technology' },
		params: stocklake.parameters,
	});
	assert.equal(fake.calls[0].toolName, 'get_screener');
	await assert.rejects(
		tool({ fake, toolArguments: { operation: 'stock.getResearch', symbol: 'AAPL' }, params: stocklake.parameters }),
		/not available/,
	);
	// The description the model reads lists exactly the filter.
	const text = describeFor(filter);
	for (const key of catalog.TOOLKIT_OPERATIONS) {
		assert.equal(text.includes(`${key}(`), filter.includes(key), key);
	}
});
