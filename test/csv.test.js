'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { Stocklake } = require('../dist/nodes/Stocklake/Stocklake.node');
const csv = require('../dist/nodes/Stocklake/csv');
const { createFakeMcp, loadNode, runNode } = require('./helpers/fakeMcp');

/**
 * CSV export (issue #8): "Download as CSV" on History, Indicator History, Screener and
 * Compare (and every other list operation), one binary file with a header row and ISO dates.
 */

const v2 = loadNode(Stocklake, 2);
const run = (opts) => runNode(v2, { typeVersion: 2, ...opts });
const rl = (value) => ({ __rl: true, mode: 'id', value });

/** Reads a CSV file the way a spreadsheet does (RFC 4180): rows of cells. */
function parseCsv(text) {
	const rows = [];
	let row = [];
	let cell = '';
	let quoted = false;
	for (let i = 0; i < text.length; i++) {
		const ch = text[i];
		if (quoted) {
			if (ch === '"' && text[i + 1] === '"') {
				cell += '"';
				i++;
			} else if (ch === '"') quoted = false;
			else cell += ch;
		} else if (ch === '"') quoted = true;
		else if (ch === ',') {
			row.push(cell);
			cell = '';
		} else if (ch === '\r' || ch === '\n') {
			if (ch === '\r' && text[i + 1] === '\n') i++;
			row.push(cell);
			rows.push(row);
			row = [];
			cell = '';
		} else cell += ch;
	}
	if (cell !== '' || row.length > 0) {
		row.push(cell);
		rows.push(row);
	}
	return rows;
}

/** The text of the file in the first output item. */
function fileOf(item, property = 'data') {
	const binary = item.binary[property];
	assert.equal(binary.mimeType, 'text/csv');
	return Buffer.from(binary.data, 'base64').toString('utf8');
}

// ================================================================== the file format

test('csvText: header row first, columns in the order they first appear', () => {
	const { text, columns } = csv.csvText([
		{ symbol: 'A', price: 1 },
		{ symbol: 'B', rsi: 40, price: 2 },
	]);
	assert.deepEqual(columns, ['symbol', 'price', 'rsi']);
	assert.deepEqual(parseCsv(text.slice(1)), [
		['symbol', 'price', 'rsi'],
		['A', '1', ''],
		['B', '2', '40'],
	]);
});

test('csvText: UTF-8 byte order mark for Excel, CRLF line ends, a final line end', () => {
	const { text } = csv.csvText([{ a: 1 }]);
	assert.equal(text.charCodeAt(0), 0xfeff);
	assert.equal(text.slice(1), 'a\r\n1\r\n');
});

test('csvText: dates stay ISO text, a Date becomes ISO text, numbers and booleans are plain', () => {
	const { text } = csv.csvText([
		{ date: '2026-11-05', at: new Date('2026-11-05T14:30:00Z'), close: 250.1, up: true, gone: null },
	]);
	assert.deepEqual(parseCsv(text.slice(1))[1], [
		'2026-11-05',
		'2026-11-05T14:30:00.000Z',
		'250.1',
		'true',
		'',
	]);
});

test('csvText: nested objects become dotted columns, lists of plain values are joined', () => {
	const { text, columns } = csv.csvText([
		{ symbol: 'A', indicators: { rsi: 55, macd: { histogram: 0.4 } }, tags: ['x', 'y'], mixed: [{ a: 1 }] },
	]);
	assert.deepEqual(columns, ['symbol', 'indicators.rsi', 'indicators.macd.histogram', 'tags', 'mixed']);
	assert.deepEqual(parseCsv(text.slice(1))[1], ['A', '55', '0.4', 'x; y', '[{"a":1}]']);
});

test('csvText: commas, quotes and line breaks are quoted so each value stays in its cell', () => {
	const rows = [{ name: 'Acme, Inc.', note: 'say "hi"', text: 'two\nlines', pad: ' x ' }];
	const parsed = parseCsv(csv.csvText(rows).text.slice(1));
	assert.deepEqual(parsed[1], ['Acme, Inc.', 'say "hi"', 'two\nlines', ' x ']);
});

test('csvText: text a spreadsheet would run as a formula is defused, numbers are left alone', () => {
	const { text } = csv.csvText([
		{ a: '=SUM(A1)', b: '+1+1', c: '@cmd', d: '-text', e: '-5.5', f: -5.5, g: '1e3', h: '+7' },
	]);
	assert.deepEqual(parseCsv(text.slice(1))[1], [
		"'=SUM(A1)",
		"'+1+1",
		"'@cmd",
		"'-text",
		'-5.5',
		'-5.5',
		'1e3',
		'+7',
	]);
});

test('csvFileName: ticker, what the rows are, the day; or the name the user gave', () => {
	const day = new Date('2026-11-06T12:00:00Z');
	assert.equal(csv.csvFileName('getHistory', 'aapl', '', day), 'aapl-history-2026-11-06.csv');
	assert.equal(csv.csvFileName('getIndicatorHistory', 'MSFT', '', day), 'MSFT-indicator-history-2026-11-06.csv');
	assert.equal(csv.csvFileName('screen', 'oversold-Technology', '', day), 'oversold-Technology-screener-2026-11-06.csv');
	assert.equal(csv.csvFileName('screen', undefined, '', day), 'screener-2026-11-06.csv');
	assert.equal(csv.csvFileName('compare', 'AAPL-MSFT', '', day), 'AAPL-MSFT-compare-2026-11-06.csv');
	assert.equal(csv.csvFileName('getHistory', 'AAPL', 'my data', day), 'my-data.csv');
	assert.equal(csv.csvFileName('getHistory', 'AAPL', 'report.CSV', day), 'report.csv');
	assert.equal(csv.csvFileName('getHistory', 'AAPL', '../../etc/passwd', day), 'etc-passwd.csv', 'no path in a file name');
});

test('csvSubject: up to five tickers, then how many more', () => {
	assert.equal(csv.csvSubject([]), undefined);
	assert.equal(csv.csvSubject(['aapl', 'msft']), 'AAPL-MSFT');
	assert.equal(csv.csvSubject(['A', 'B', 'C', 'D', 'E', 'F', 'G']), 'A-B-C-D-E-and-2-more');
});

// ============================================================ through the node

const history = {
	symbol: 'AAPL',
	count: 3,
	history: [
		{ date: '2026-11-03', open: 1, high: 3, low: 0.5, close: 2, volume: 1000 },
		{ date: '2026-11-04', open: 2, high: 4, low: 1.5, close: 3, volume: 1500 },
		{ date: '2026-11-05', open: 3, high: 5, low: 2.5, close: 4, volume: 2000 },
	],
};

test('History: Download as CSV returns one binary file with a header row and ISO dates', async () => {
	const fake = createFakeMcp({ get_stock_history: history });
	const out = await run({
		fake,
		params: {
			resource: 'stock',
			operation: 'getHistory',
			symbol: rl('AAPL'),
			options: { downloadCsv: true },
		},
	});

	assert.equal(out[0].length, 1, 'one item for the whole file');
	const item = out[0][0];
	assert.match(item.json.fileName, /^AAPL-history-\d{4}-\d{2}-\d{2}\.csv$/);
	assert.equal(item.json.rowCount, 3);
	assert.deepEqual(item.json.columns, ['symbol', 'date', 'open', 'high', 'low', 'close', 'volume']);
	assert.equal(item.binary.data.fileName, item.json.fileName);
	assert.deepEqual(item.pairedItem, { item: 0 });

	const rows = parseCsv(fileOf(item).slice(1));
	assert.deepEqual(rows[0], ['symbol', 'date', 'open', 'high', 'low', 'close', 'volume']);
	assert.deepEqual(rows[1], ['AAPL', '2026-11-03', '1', '3', '0.5', '2', '1000']);
	assert.equal(rows.length, 4);
	for (const row of rows.slice(1)) assert.match(row[1], /^\d{4}-\d{2}-\d{2}$/);
});

test('History: the call to Stocklake is the same with and without the file', async () => {
	const plain = createFakeMcp({ get_stock_history: history });
	const file = createFakeMcp({ get_stock_history: history });
	const base = { resource: 'stock', operation: 'getHistory', symbol: rl('AAPL'), days: 30 };
	await run({ fake: plain, params: base });
	await run({ fake: file, params: { ...base, options: { downloadCsv: true } } });
	assert.deepEqual(file.calls.map((c) => [c.toolName, c.arguments]), plain.calls.map((c) => [c.toolName, c.arguments]));
});

test('History: a name and a field of your own', async () => {
	const fake = createFakeMcp({ get_stock_history: history });
	const out = await run({
		fake,
		params: {
			resource: 'stock',
			operation: 'getHistory',
			symbol: rl('AAPL'),
			options: { downloadCsv: true, csvFileName: 'apple prices', csvBinaryProperty: 'file' },
		},
	});
	assert.equal(out[0][0].json.fileName, 'apple-prices.csv');
	assert.ok(out[0][0].binary.file);
	assert.equal(out[0][0].binary.data, undefined);
	assert.match(fileOf(out[0][0], 'file'), /AAPL,2026-11-05/);
});

test('History: Simplify off writes every field the API sent', async () => {
	const fake = createFakeMcp({
		get_stock_history: { symbol: 'AAPL', history: [{ date: '2026-11-05', close: 4, adj_close: 3.9 }] },
	});
	const out = await run({
		fake,
		params: { resource: 'stock', operation: 'getHistory', symbol: rl('AAPL'), simplify: false, options: { downloadCsv: true } },
	});
	assert.ok(out[0][0].json.columns.includes('adj_close'));
});

test('History: with no rows there is no empty file', async () => {
	const fake = createFakeMcp({ get_stock_history: { symbol: 'AAPL', count: 0, history: [] } });
	const out = await run({
		fake,
		params: { resource: 'stock', operation: 'getHistory', symbol: rl('AAPL'), options: { downloadCsv: true } },
	});
	assert.deepEqual(out[0], []);
});

test('History: the metadata goes to the summary item, not into the file', async () => {
	const fake = createFakeMcp({ get_stock_history: { ...history, note: 'adjusted for splits' } });
	const out = await run({
		fake,
		params: {
			resource: 'stock',
			operation: 'getHistory',
			symbol: rl('AAPL'),
			options: { downloadCsv: true, includeMetadata: true },
		},
	});
	assert.ok(out[0][0].json._meta);
	assert.ok(!out[0][0].json.columns.includes('_meta'));
});

test('History: one file per input item, each paired with its own item', async () => {
	const fake = createFakeMcp({
		get_stock_history: (args) => ({ symbol: args.symbol, history: [{ date: '2026-11-05', close: 1 }] }),
	});
	const out = await run({
		fake,
		params: ['AAPL', 'MSFT'].map((s) => ({
			resource: 'stock',
			operation: 'getHistory',
			symbol: rl(s),
			options: { downloadCsv: true },
		})),
	});
	assert.equal(out[0].length, 2);
	assert.deepEqual(out[0].map((i) => i.pairedItem), [{ item: 0 }, { item: 1 }]);
	assert.match(out[0][0].json.fileName, /^AAPL-/);
	assert.match(out[0][1].json.fileName, /^MSFT-/);
});

test('Indicator History: the snapshots become the rows of the file', async () => {
	const fake = createFakeMcp({
		get_indicator_history: {
			symbol: 'MSFT',
			snapshots: [
				{ recorded_at: '2026-11-04T21:00:00+00:00', price: 400, rsi: 44.1, macd_histogram: -0.2, bb_pct: 0.3, sma20: 401, sma200: 380 },
				{ recorded_at: '2026-11-05T21:00:00+00:00', price: 405, rsi: 47.9, macd_histogram: 0.1, bb_pct: 0.5, sma20: 402, sma200: 381 },
			],
		},
	});
	const out = await run({
		fake,
		params: { resource: 'stock', operation: 'getIndicatorHistory', symbol: rl('MSFT'), options: { downloadCsv: true } },
	});
	assert.match(out[0][0].json.fileName, /^MSFT-indicator-history-/);
	const rows = parseCsv(fileOf(out[0][0]).slice(1));
	assert.deepEqual(rows[0], ['symbol', 'recorded_at', 'price', 'rsi', 'macd_histogram', 'bb_pct', 'sma20', 'sma200']);
	assert.equal(rows[1][1], '2026-11-04T21:00:00+00:00');
});

test('Screener: the matches become a file named after the preset and the sector', async () => {
	const fake = createFakeMcp({
		get_screener: {
			count: 2,
			results: [
				{ symbol: 'AAA', name: 'A, Inc.', sector: 'Technology', price: 10, change_pct: -1, rsi: 25, market_cap_usd: 1e9 },
				{ symbol: 'BBB', name: 'B Corp', sector: 'Technology', price: 20, change_pct: 2, rsi: 28, market_cap_usd: 2e9 },
			],
		},
	});
	const out = await run({
		fake,
		params: { resource: 'screener', operation: 'screen', preset: 'oversold', sector: 'Technology', options: { downloadCsv: true } },
	});
	assert.match(out[0][0].json.fileName, /^oversold-Technology-screener-/);
	const rows = parseCsv(fileOf(out[0][0]).slice(1));
	assert.equal(rows.length, 3);
	assert.equal(rows[1][rows[0].indexOf('name')], 'A, Inc.', 'a comma in a name stays in its cell');
});

test('Get Many: the tickers are in the name of the file', async () => {
	const fake = createFakeMcp({
		get_stocks: (args) => ({
			count: args.symbols.length,
			symbols: Object.fromEntries(args.symbols.map((s) => [s, { symbol: s, price: 1, indicators: { rsi: 50 } }])),
		}),
	});
	const out = await run({
		fake,
		params: { resource: 'stock', operation: 'getMany', symbols: 'aapl, msft', options: { downloadCsv: true } },
	});
	assert.match(out[0][0].json.fileName, /^AAPL-MSFT-stocks-/);
	assert.ok(out[0][0].json.columns.includes('rsi'));
});

const stockDoc = (symbol, extra = {}) => ({
	symbol,
	name: `${symbol} Inc.`,
	sector: 'Technology',
	currency: 'USD',
	price: 100,
	change_pct: 1,
	market_cap_usd: 1e11,
	pe_forward: 20,
	week52_low: 50,
	week52_high: 150,
	analyst_target: 120,
	indicators: { rsi: 55 },
	...extra,
});

test('Compare: the ranked rows become one file, a ticker that failed stays an item with its error', async () => {
	const fake = createFakeMcp({
		get_stocks: (args) => ({
			count: 2,
			requested: args.symbols.length,
			missing: ['NOPE'],
			symbols: {
				AAPL: stockDoc('AAPL', { pe_forward: 30 }),
				MSFT: stockDoc('MSFT', { pe_forward: 25 }),
			},
		}),
	});
	const out = await run({
		fake,
		params: {
			resource: 'stock',
			operation: 'compare',
			symbols: 'AAPL, MSFT, NOPE',
			rankBy: 'peForward',
			rankOrder: 'asc',
			options: { downloadCsv: true },
		},
	});

	assert.equal(out[0].length, 2, 'the file and the failed ticker');
	const [file, failed] = out[0];
	assert.match(file.json.fileName, /^MSFT-AAPL-compare-/, 'named in the order of the ranking');
	assert.equal(file.json.rowCount, 2);
	const rows = parseCsv(fileOf(file).slice(1));
	const symbolAt = rows[0].indexOf('symbol');
	assert.deepEqual(rows.slice(1).map((r) => r[symbolAt]), ['MSFT', 'AAPL'], 'ranked, cheapest first');
	assert.equal(rows[1][rows[0].indexOf('rank')], '1');
	assert.equal(failed.json.symbol, 'NOPE');
	assert.equal(failed.json.found, false);
	assert.ok(failed.json.error);
	assert.equal(failed.binary, undefined);
});

test('Compare: from input items, the file is paired with every item that supplied a ticker', async () => {
	const fake = createFakeMcp({
		get_stocks: (args) => ({
			count: args.symbols.length,
			symbols: Object.fromEntries(args.symbols.map((s) => [s, stockDoc(s)])),
		}),
	});
	const out = await run({
		fake,
		items: [{ json: { t: 'AAPL' } }, { json: { t: 'MSFT' } }],
		params: [
			{ resource: 'stock', operation: 'compare', symbolSource: 'fromInput', symbolsFromInput: 'AAPL', options: { downloadCsv: true } },
			{ resource: 'stock', operation: 'compare', symbolSource: 'fromInput', symbolsFromInput: 'MSFT', options: { downloadCsv: true } },
		],
	});
	assert.equal(out[0].length, 1);
	assert.deepEqual(out[0][0].pairedItem, [{ item: 0 }, { item: 1 }]);
});

test('Compare: without the option the rows are ordinary items', async () => {
	const fake = createFakeMcp({
		get_stocks: (args) => ({
			count: 2,
			symbols: Object.fromEntries(args.symbols.map((s) => [s, stockDoc(s)])),
		}),
	});
	const out = await run({
		fake,
		params: { resource: 'stock', operation: 'compare', symbols: 'AAPL, MSFT' },
	});
	assert.equal(out[0].length, 2);
	assert.equal(out[0][0].binary, undefined);
});

test('the file survives a round trip: what a spreadsheet reads is what the API sent', async () => {
	const rows = [
		{ symbol: 'A', name: 'Acme, "Best" Inc.', note: 'line1\nline2', price: 1.5, when: '2026-11-05' },
		{ symbol: 'B', name: '=cmd', note: null, price: -2, when: '2026-11-06' },
	];
	const read = parseCsv(csv.csvText(rows).text.slice(1));
	assert.deepEqual(read[1], ['A', 'Acme, "Best" Inc.', 'line1\nline2', '1.5', '2026-11-05']);
	assert.deepEqual(read[2], ['B', "'=cmd", '', '-2', '2026-11-06']);
});

test('the CSV options exist for the four named operations and nothing else changed for version 1', () => {
	const props = new Stocklake().nodeVersions[2].description.properties;
	const v1props = new Stocklake().nodeVersions[1].description.properties;
	const optionsFor = (resource, operation) =>
		props.filter(
			(p) =>
				p.name === 'options' &&
				p.displayOptions?.show?.resource?.includes(resource) &&
				p.displayOptions?.show?.operation?.includes(operation),
		);
	for (const [resource, operation] of [
		['stock', 'getHistory'],
		['stock', 'getIndicatorHistory'],
		['screener', 'screen'],
		['stock', 'compare'],
	]) {
		const [collection] = optionsFor(resource, operation);
		assert.ok(collection, `${resource}.${operation} has an Options collection`);
		const names = collection.options.map((o) => o.name);
		for (const name of ['downloadCsv', 'csvFileName', 'csvBinaryProperty']) {
			assert.ok(names.includes(name), `${resource}.${operation} has ${name}`);
		}
		const boolean = collection.options.find((o) => o.name === 'downloadCsv');
		assert.equal(boolean.type, 'boolean');
		assert.equal(boolean.default, false);
	}
	assert.equal(JSON.stringify(v1props).includes('downloadCsv'), false, 'version 1 has no CSV option');
});
