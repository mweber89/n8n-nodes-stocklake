#!/usr/bin/env node
'use strict';

/**
 * Calls every version-2 operation against the real Stocklake API as a guest and,
 * when keys are given, with a free and a Pro key. Needs a build (`npm run build`).
 *
 *   STOCKLAKE_FREE_KEY=sl_... STOCKLAKE_PRO_KEY=sl_... node scripts/live-check.js
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
			const error = new Error(`HTTP ${response.status}`);
			error.httpCode = String(response.status);
			throw error;
		}
		return JSON.parse(text.slice(text.indexOf('{')));
	};
	return { httpRequest: send, httpRequestWithAuthentication: (_credential, options) => send(options) };
}

(async () => {
	const node = loadNode(Stocklake, 2);
	// The five new operations by default; LIVE_ALL=1 also runs the original seventeen.
	const selected = process.env.LIVE_ALL ? [...cases, ...v2Cases] : v2Cases;
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
				const json = out[0][0].json;
				console.log(`ok     ${c.name}  [${Object.keys(json).slice(0, 6).join(', ')}]`);
			} catch (error) {
				// A Pro-only operation refused for guest/free is the expected answer.
				const expected = tier !== 'pro' && c.name.startsWith('stock.getAnalystTrend');
				if (!expected) failures++;
				console.log(`${expected ? 'denied' : 'FAIL  '} ${c.name}  ${String(error.message).split('\n')[0]}`);
			}
		}
	}
	process.exit(failures ? 1 : 0);
})();
