#!/usr/bin/env node
'use strict';

/**
 * Calls every version-2 operation against the Stocklake API as a guest and,
 * when keys are given, with a free and a Pro key. Needs a build (`npm run build`).
 *
 *   STOCKLAKE_FREE_KEY=sl_... STOCKLAKE_PRO_KEY=sl_... node scripts/check-api.js
 *
 * Keys are read from the environment only and never printed. This uses the daily
 * quota of the keys it is given (and 25 guest calls per IP), so it is a manual
 * check, not part of `npm test`.
 */
const path = require('node:path');

const root = path.join(__dirname, '..');
const { Stocklake } = require(path.join(root, 'dist/nodes/Stocklake/Stocklake.node'));
const { loadNode, runNode } = require(path.join(root, 'test/helpers/fakeMcp'));
const { cases, v2Cases } = require(path.join(root, 'test/fixtures/operations'));

const tiers = [
	['guest', null],
	['free', process.env.STOCKLAKE_FREE_KEY],
	['pro', process.env.STOCKLAKE_PRO_KEY],
].filter(([name, key]) => name === 'guest' || key);

/** The node's own HTTP helpers, pointed at the real API. */
function liveHelpers(key) {
	const send = async (options) => {
		const response = await fetch(options.url, {
			method: 'POST',
			headers: { ...options.headers, ...(key ? { Authorization: `Bearer ${key}` } : {}) },
			body: JSON.stringify(options.body),
		});
		const text = await response.text();
		if (!response.ok) {
			// Shaped like the error n8n's HTTP helper throws, body included.
			let data;
			try {
				data = JSON.parse(text);
			} catch {
				data = undefined;
			}
			throw Object.assign(new Error(`HTTP ${response.status}`), {
				httpCode: String(response.status),
				response: { status: response.status, data },
			});
		}
		return JSON.parse(text.slice(text.indexOf('{')));
	};
	return {
		httpRequest: send,
		httpRequestWithAuthentication: (_credential, options) => send(options),
	};
}

(async () => {
	const node = loadNode(Stocklake, 2);
	// The five new operations by default; LIVE_ALL=1 also runs the original seventeen.
	const selected = (process.env.LIVE_ALL ? [...cases, ...v2Cases] : v2Cases).map((c) =>
		// The Signal fixture uses a direction the node does not offer (it is only there to
		// pin the version 1 wire format); ask the real API for a valid one.
		c.params.direction === 'LONG' ? { ...c, params: { ...c.params, direction: 'POSITIVE' } } : c,
	);
	let failures = 0;

	for (const [tier, key] of tiers) {
		console.log(`\n== ${tier}`);
		for (const c of selected) {
			try {
				const out = await runNode(node, {
					params: c.params,
					fake: liveHelpers(key),
					typeVersion: 2,
					apiKeyCredential: Boolean(key),
				});
				const first = out[0][0]?.json ?? {};
				console.log(
					`ok     ${c.name}  ${out[0].length} item(s) [${Object.keys(first).slice(0, 5).join(', ')}]`,
				);
			} catch (error) {
				// A Pro-only operation refused for guest/free is the expected answer.
				const expected = tier !== 'pro' && c.name.startsWith('stock.getAnalystTrend');
				if (!expected) failures++;
				console.log(
					`${expected ? 'denied' : 'FAIL  '} ${c.name}  ${String(error.message).split('\n')[0]}`,
				);
			}
		}
	}

	// Paging and Return All, which only show against the real API.
	const rlv = (value) => ({ __rl: true, mode: 'id', value });
	const paging = [
		[
			'Activity, Return All',
			{ resource: 'stock', operation: 'getActivity', symbol: rlv('NVDA'), returnAll: true },
		],
		[
			'Activity, Limit 60 (two pages)',
			{ resource: 'stock', operation: 'getActivity', symbol: rlv('NVDA'), maxResults: 60 },
		],
		[
			'Earnings Calendar, Return All',
			{ resource: 'earnings', operation: 'getCalendar', returnAll: true },
		],
		[
			'Get Many, 30 symbols (two batches)',
			{
				resource: 'stock',
				operation: 'getMany',
				symbols:
					'AAPL,MSFT,NVDA,AMZN,GOOGL,META,TSLA,AMD,INTC,ORCL,CRM,ADBE,NFLX,CSCO,QCOM,TXN,AVGO,IBM,UBER,SHOP,PYPL,SNOW,PLTR,COIN,SOFI,RKLB,F,GM,BA,DIS',
			},
		],
		[
			'Screener, Return All',
			{ resource: 'screener', operation: 'screen', preset: 'momentum', returnAll: true },
		],
		['Movers, Return All', { resource: 'market', operation: 'getMovers', returnAll: true }],
	];
	for (const [tier, key] of tiers) {
		console.log(`\n== paging, ${tier}`);
		for (const [label, params] of paging) {
			try {
				const out = await runNode(node, {
					params,
					fake: liveHelpers(key),
					typeVersion: 2,
					apiKeyCredential: Boolean(key),
				});
				console.log(`ok     ${label}  ${out[0].length} item(s)`);
			} catch (error) {
				failures++;
				console.log(`FAIL   ${label}  ${String(error.message).split('\n')[0]}`);
			}
		}
	}
	process.exit(failures ? 1 : 0);
})();
