#!/usr/bin/env node
'use strict';

/**
 * Runs every dropdown loader of version 2 against the real Stocklake API, as a guest and
 * with a free and a Pro key, and prints what each one returned and how many requests it
 * took. Needs a build (`npm run build`).
 *
 *   STOCKLAKE_FREE_KEY=sl_... STOCKLAKE_PRO_KEY=sl_... node scripts/check-options.js
 *
 * Keys come from the environment only and are never printed. The loaders ask with values
 * no tool accepts, which the API rejects without counting a call; the remaining-calls
 * counter is printed before and after so that can be seen.
 */
const path = require('node:path');

const root = path.join(__dirname, '..');
const loaders = require(path.join(root, 'dist/nodes/Stocklake/loadOptions'));

const tiers = [
	['guest', null],
	['free', process.env.STOCKLAKE_FREE_KEY],
	['pro', process.env.STOCKLAKE_PRO_KEY],
].filter(([name, key]) => name === 'guest' || key);

function liveContext(name, key, log) {
	const send = async (options) => {
		const get = options.method === 'GET';
		const url = get ? `${options.url}?${new URLSearchParams(options.qs)}` : options.url;
		const response = await fetch(url, {
			method: options.method,
			headers: { ...options.headers, ...(key ? { Authorization: `Bearer ${key}` } : {}) },
			body: get ? undefined : JSON.stringify(options.body),
		});
		log.push({
			tool: options.body?.params?.name ?? 'GET search',
			status: response.status,
			remaining: response.headers.get('x-ratelimit-remaining'),
		});
		const text = await response.text();
		if (!response.ok) {
			throw Object.assign(new Error(`HTTP ${response.status}`), {
				httpCode: String(response.status),
			});
		}
		const body = JSON.parse(text.slice(text.indexOf('{')));
		if (!options.returnFullResponse) return body;
		return {
			statusCode: response.status,
			headers: Object.fromEntries(response.headers.entries()),
			body,
		};
	};
	return {
		getNodeParameter: (parameter, fallback) =>
			parameter === 'authentication' ? 'apiKey' : fallback,
		getNode: () => ({
			credentials: key ? { stocklakeApi: { id: `live-${name}`, name } } : undefined,
		}),
		helpers: {
			httpRequest: send,
			httpRequestWithAuthentication: (_credential, options) => send(options),
		},
	};
}

(async () => {
	for (const [name, key] of tiers) {
		loaders.clearOptionCache();
		const log = [];
		const context = liveContext(name, key, log);
		console.log(`\n== ${name}`);
		const show = (label, options) =>
			console.log(`${label.padEnd(20)} ${options.map((o) => o.name).join(' | ')}`);

		show('sectors', await loaders.getSectors.call(context));
		show('presets', await loaders.getScreenerPresets.call(context));
		show('activity types', await loaders.getActivityTypes.call(context));
		show('signal sources', await loaders.getSignalSources.call(context));
		show('signal directions', await loaders.getSignalDirections.call(context));
		const watch = await loaders.searchSymbolsWithWatchlist.call(context, '');
		console.log(
			`${'watchlist'.padEnd(20)} ${watch.results.map((r) => r.value).join(', ') || '(empty)'}`,
		);
		const typed = await loaders.searchSymbolsWithWatchlist.call(context, 'aapl');
		console.log(
			`${'search "aapl"'.padEnd(20)} ${typed.results
				.slice(0, 3)
				.map((r) => r.name)
				.join(' | ')}`,
		);

		// A second round must not call the API at all.
		const before = log.length;
		await loaders.getSectors.call(context);
		await loaders.getScreenerPresets.call(context);
		await loaders.searchSymbolsWithWatchlist.call(context, '');
		console.log(`requests: ${before} for the first round, ${log.length - before} for the second`);
		for (const entry of log)
			console.log(`  ${entry.tool.padEnd(20)} HTTP ${entry.status}  remaining ${entry.remaining}`);
	}
})().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
