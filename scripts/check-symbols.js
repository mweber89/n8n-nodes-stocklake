#!/usr/bin/env node
'use strict';

/**
 * Runs the real version 2 node (Get Many, Symbol Source "From input items") against the
 * real Stocklake API with 60 tickers, one per input item, and checks what comes back:
 * three requests of 25 + 25 + 10, one row per ticker, in input order, each paired with
 * its input item. Needs a build (`npm run build`) and a Pro key; the 60 tickers count as
 * 60 calls toward the key's daily limit.
 *
 *   STOCKLAKE_PRO_KEY=sl_... node scripts/check-symbols.js
 *
 * The key comes from the environment only and is never printed.
 */
const path = require('node:path');

const root = path.join(__dirname, '..');
const { Stocklake } = require(path.join(root, 'dist/nodes/Stocklake/Stocklake.node'));

const key = process.env.STOCKLAKE_PRO_KEY;
if (!key) {
	console.error('Set STOCKLAKE_PRO_KEY.');
	process.exit(2);
}

// 60 large, long-listed US stocks, in a deliberately non-alphabetical order.
const TICKERS = (
	'NVDA MSFT AAPL AMZN GOOGL META AVGO TSLA BRK-B LLY ' +
	'JPM V WMT XOM UNH MA ORCL COST HD PG ' +
	'JNJ NFLX BAC ABBV CRM KO CVX AMD WFC MRK ' +
	'CSCO PEP ACN TMO LIN ADBE MCD ABT DIS GE ' +
	'QCOM TXN IBM CAT INTU VZ AMGN PFE NOW UBER ' +
	'GS ISRG BKNG RTX SPGI LOW HON T NEE UNP'
).split(' ');

const log = [];
async function send(options) {
	const response = await fetch(options.url, {
		method: options.method,
		headers: { ...options.headers, Authorization: `Bearer ${key}` },
		body: JSON.stringify(options.body),
	});
	const args = options.body.params.arguments;
	log.push({
		tool: options.body.params.name,
		status: response.status,
		symbols: args.symbols?.length,
		remaining: response.headers.get('x-ratelimit-remaining'),
	});
	const text = await response.text();
	if (!response.ok) throw new Error(`HTTP ${response.status}: ${text.slice(0, 200)}`);
	return JSON.parse(text.slice(text.indexOf('{')));
}

const items = TICKERS.map((ticker) => ({ json: { ticker } }));
const hints = [];
const params = {
	resource: 'stock',
	operation: 'getMany',
	symbolSource: 'fromInput',
	simplify: true,
	options: { includeMetadata: true },
};
const context = {
	getInputData: () => items,
	getNodeParameter: (name, i, fallback) =>
		name === 'symbolsFromInput'
			? items[i].json.ticker
			: name === 'authentication'
				? 'apiKey'
				: (params[name] ?? fallback),
	getNode: () => ({ name: 'Stocklake', credentials: { stocklakeApi: { id: '1', name: 'live' } } }),
	continueOnFail: () => false,
	addExecutionHints: (...h) => hints.push(...h),
	helpers: {
		httpRequest: send,
		httpRequestWithAuthentication: (_c, options) => send(options),
		returnJsonArray: (d) => (Array.isArray(d) ? d : [d]).map((json) => ({ json })),
		constructExecutionMetaData: (data, { itemData }) =>
			data.map((d) => ({ ...d, pairedItem: itemData })),
	},
};

(async () => {
	const node = new Stocklake().nodeVersions[2];
	const output = (await node.execute.call(context))[0];
	const rows = output.filter((i) => i.json.valid !== false);

	const got = rows.map((i) => i.json.symbol);
	const missing = TICKERS.filter((t) => !got.includes(t));
	const inOrder = got.every((s, k) => TICKERS.indexOf(s) >= (k ? TICKERS.indexOf(got[k - 1]) : 0));
	const paired = rows.every((i) => TICKERS[i.pairedItem.item] === i.json.symbol);

	console.log('requests      ', log.map((l) => `${l.tool}(${l.symbols})→${l.status}`).join('  '));
	console.log('remaining     ', log.map((l) => l.remaining).join(' → '));
	console.log('notice        ', hints.map((h) => h.message).join(' | ') || '(none)');
	console.log('rows          ', rows.length, 'of', TICKERS.length, missing.length ? `missing: ${missing}` : '');
	console.log('input order   ', inOrder);
	console.log('paired items  ', paired);
	console.log('first row     ', JSON.stringify(rows[0].json).slice(0, 220));

	const ok =
		log.length === 3 &&
		log.every((l) => l.status === 200) &&
		log.map((l) => l.symbols).join() === '25,25,10' &&
		rows.length === 60 &&
		inOrder &&
		paired &&
		hints.length === 1;
	console.log(ok ? '\nOK' : '\nFAILED');
	process.exit(ok ? 0 : 1);
})().catch((error) => {
	console.error(error.message);
	process.exit(1);
});
