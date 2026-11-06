'use strict';

/**
 * Dropdowns filled from Stocklake (version 2): sector, screener preset, signal source and
 * direction, activity types, and the watchlist in the symbol picker. Each one has a loaded
 * path, a fallback path and the two rules around them: a Pro-only tool is never called for
 * a credential that is not Pro, and one credential does not call the API again on every
 * editor open.
 */

const { test, beforeEach, mock } = require('node:test');
const assert = require('node:assert/strict');

const { Stocklake } = require('../dist/nodes/Stocklake/Stocklake.node');
const loaders = require('../dist/nodes/Stocklake/loadOptions');
const { FALLBACK_VALUES, COUNTRY_OPTIONS } = require('../dist/nodes/Stocklake/optionLists');
const { createFakeMcp, runLoader } = require('./helpers/fakeMcp');

const v1 = () => new Stocklake().nodeVersions[1];
const v2 = () => new Stocklake().nodeVersions[2];

beforeEach(() => {
	loaders.clearOptionCache();
	mock.restoreAll();
});

const PROBE = '__list_options__';

/** A server that answers the way the real one does for a value it does not accept. */
function server(extra = {}, options) {
	return createFakeMcp(
		{
			get_screener: (args) => {
				if (args.sector !== undefined) {
					return {
						error: {
							code: 'invalid_sector',
							message: 'sector must be one of: Energy, Technology, Crypto Assets',
							type: 'error',
						},
					};
				}
				if (args.preset !== undefined) {
					return {
						error: {
							code: 'invalid_preset',
							message: 'preset must be one of: high_conviction, momentum, oversold, quality',
							type: 'error',
						},
					};
				}
				return { count: 0, results: [] };
			},
			get_signals: (args) => {
				if (args.source !== undefined) {
					return {
						error: {
							code: 'invalid_source',
							message: 'source must be one of: news, filings, screener',
						},
					};
				}
				return {
					error: {
						code: 'invalid_direction',
						message: 'direction must be one of: NEGATIVE, POSITIVE',
					},
				};
			},
			get_stock_activity: {
				error: {
					code: 'invalid_types',
					message:
						"unknown type '__list_options__'; valid types: news, filing, insider, regulatory",
				},
			},
			get_watchlist: {
				count: 2,
				items: [
					{ symbol: 'RKLB', name: 'Rocket Lab Corporation' },
					{ symbol: 'COIN', name: 'Coinbase Global, Inc.' },
				],
			},
			...extra,
		},
		options,
	);
}

const toolCalls = (fake, name) => fake.calls.filter((c) => c.toolName === name);
const values = (options) => options.map((o) => o.value);

// --- loaded path -------------------------------------------------------------

test('sectors: loaded from the API, sorted, with "Any" first', async () => {
	const fake = server();
	const options = await runLoader(loaders.getSectors, { fake });

	assert.deepEqual(options[0], { name: 'Any', value: '' });
	assert.deepEqual(values(options), ['', 'Crypto Assets', 'Energy', 'Technology']);
	const [call] = toolCalls(fake, 'get_screener');
	assert.deepEqual(call.arguments, { sector: PROBE, limit: 1 });
});

test('sectors for the rotation view: the same list, "All 11 Sectors" first', async () => {
	const options = await runLoader(loaders.getSectorsForRotation, { fake: server() });
	assert.equal(options[0].name, 'All 11 Sectors (Rotation View)');
	assert.equal(options[0].value, '');
	assert.ok(values(options).includes('Crypto Assets'));
});

test('presets: loaded, the Pro one is labelled, "None" is first', async () => {
	const options = await runLoader(loaders.getScreenerPresets, { fake: server() });

	assert.deepEqual(options[0], { name: 'None (Use Filters Below)', value: '' });
	assert.deepEqual(values(options), ['', 'high_conviction', 'momentum', 'oversold', 'quality']);
	assert.equal(options.find((o) => o.value === 'high_conviction').name, 'High Conviction (Pro)');
	// A preset the node has never heard of still appears, title-cased.
	assert.equal(options.find((o) => o.value === 'quality').name, 'Quality');
});

test('presets: a free credential still sees High Conviction, marked Pro', async () => {
	const fake = server({}, { dailyLimit: 200 });
	const options = await runLoader(loaders.getScreenerPresets, { fake });
	assert.equal(options.find((o) => o.value === 'high_conviction').name, 'High Conviction (Pro)');
});

test('activity types: loaded through the free activity tool', async () => {
	const fake = server();
	const options = await runLoader(loaders.getActivityTypes, { fake });

	assert.deepEqual(
		values(options),
		['news', 'filing', 'insider', 'regulatory'].sort((a, b) => {
			const name = (v) => options.find((o) => o.value === v).name;
			return name(a).localeCompare(name(b));
		}),
	);
	const [call] = toolCalls(fake, 'get_stock_activity');
	assert.deepEqual(call.arguments, { symbol: 'AAPL', types: [PROBE], limit: 1 });
	assert.equal(options.find((o) => o.value === 'regulatory').name, 'Regulatory');
});

test('signal source and direction: loaded for a Pro credential', async () => {
	const fake = server({}, { dailyLimit: 5000 });
	const sources = await runLoader(loaders.getSignalSources, { fake });
	const directions = await runLoader(loaders.getSignalDirections, { fake });

	assert.deepEqual(sources[0], { name: 'All', value: '' });
	assert.deepEqual(values(sources), ['', 'filings', 'news', 'screener']);
	assert.deepEqual(values(directions), ['', 'NEGATIVE', 'POSITIVE']);
	assert.equal(directions.find((o) => o.value === 'POSITIVE').name, 'Positive');
});

test('a value is read from the error text in each of the shapes the API uses', () => {
	const { parseAcceptedValues } = loaders;
	assert.deepEqual(parseAcceptedValues('sector must be one of: A, B, C'), ['A', 'B', 'C']);
	assert.deepEqual(parseAcceptedValues("unknown type 'x'; valid types: news, filing"), [
		'news',
		'filing',
	]);
	assert.deepEqual(parseAcceptedValues('preset must be one of: a, b.'), ['a', 'b']);
	assert.deepEqual(parseAcceptedValues('No stocks for country x. Use the full English name'), []);
	assert.deepEqual(parseAcceptedValues(undefined), []);
});

// --- fallback path -----------------------------------------------------------

const down = {
	__httpError: { message: 'getaddrinfo ENOTFOUND api.stocklake.dev', code: 'ENOTFOUND' },
};

test('offline: every dropdown shows the list that shipped with the node', async () => {
	const fake = createFakeMcp({
		get_screener: down,
		get_stock_activity: down,
		get_signals: down,
		get_watchlist: down,
	});

	const sectors = await runLoader(loaders.getSectors, { fake });
	assert.deepEqual(values(sectors).slice(1), [...FALLBACK_VALUES.sectors].sort());

	const presets = await runLoader(loaders.getScreenerPresets, { fake });
	assert.deepEqual(values(presets).slice(1), [
		'high_conviction',
		'momentum',
		'overbought',
		'oversold',
	]);

	const types = await runLoader(loaders.getActivityTypes, { fake });
	assert.deepEqual(values(types).sort(), [...FALLBACK_VALUES.activityTypes].sort());

	// Tier unknown, so no Pro-only call and the fallback lists.
	const sources = await runLoader(loaders.getSignalSources, { fake });
	assert.deepEqual(values(sources).slice(1), ['news', 'screener', 'sentiment']);
	const directions = await runLoader(loaders.getSignalDirections, { fake });
	assert.deepEqual(values(directions).slice(1), ['NEGATIVE', 'NEUTRAL', 'POSITIVE']);
	assert.equal(directions.find((o) => o.value === 'NEUTRAL').name, 'Neutral / Two-Sided');
	assert.equal(toolCalls(fake, 'get_signals').length, 0);
});

test('a rate-limited or signed-out answer (HTTP 429 / 401) falls back too', async () => {
	for (const status of [429, 401]) {
		loaders.clearOptionCache();
		const fake = createFakeMcp({
			get_screener: { __httpError: { message: `HTTP ${status}`, httpCode: String(status) } },
		});
		const sectors = await runLoader(loaders.getSectors, { fake });
		assert.deepEqual(values(sectors).slice(1), [...FALLBACK_VALUES.sectors].sort(), String(status));
	}
});

test('an answer that names no values (an unexpected message) falls back', async () => {
	const fake = createFakeMcp({
		get_screener: { error: { code: 'invalid_sector', message: 'bad sector' } },
	});
	const sectors = await runLoader(loaders.getSectors, { fake });
	assert.deepEqual(values(sectors).slice(1), [...FALLBACK_VALUES.sectors].sort());
});

test('the fallback holds every value version 1 offered, so nothing a workflow uses disappears', () => {
	const props = (node) => node.description.properties;
	const optionValues = (p) => (p.options ?? []).map((o) => o.value).filter((v) => v !== '');
	const find = (node, name, resource) =>
		props(node).find((p) => p.name === name && p.displayOptions?.show?.resource?.[0] === resource);

	const sector = optionValues(find(v1(), 'sector', 'screener'));
	assert.deepEqual([...FALLBACK_VALUES.sectors].sort(), [...sector].sort());
	assert.deepEqual(
		[...FALLBACK_VALUES.presets].sort(),
		optionValues(find(v1(), 'preset', 'screener')).sort(),
	);
	assert.deepEqual(
		[...FALLBACK_VALUES.signalDirections].sort(),
		optionValues(find(v1(), 'direction', 'signal')).sort(),
	);
	// The API has no "social" source; version 1 offers it, version 2 does not.
	const v1Sources = optionValues(find(v1(), 'source', 'signal'));
	assert.ok(v1Sources.includes('social'));
	assert.deepEqual(
		[...FALLBACK_VALUES.signalSources].sort(),
		v1Sources.filter((v) => v !== 'social').sort(),
	);
	const activity = props(v1()).find((p) => p.name === 'types');
	assert.equal(activity, undefined, 'activity types are new in version 2');
});

// --- Pro-only tools, never for a credential that is not Pro --------------------

test('a free credential never calls a Pro tool: signals and the watchlist', async () => {
	const fake = server({}, { dailyLimit: 200 });
	await runLoader(loaders.getSignalSources, { fake });
	await runLoader(loaders.getSignalDirections, { fake });
	await runLoader(loaders.searchSymbolsWithWatchlist, { fake, filter: '' });
	await runLoader(loaders.searchSymbolsWithWatchlist, { fake, filter: 'RK' });

	assert.equal(toolCalls(fake, 'get_signals').length, 0);
	assert.equal(toolCalls(fake, 'get_watchlist').length, 0);
});

test('a guest (no credential) makes no call for signals or the watchlist either', async () => {
	const fake = server({}, { dailyLimit: 25 });
	const sources = await runLoader(loaders.getSignalSources, { fake, auth: 'guest' });
	await runLoader(loaders.searchSymbolsWithWatchlist, { fake, auth: 'guest', filter: '' });

	assert.deepEqual(values(sources).slice(1), ['news', 'screener', 'sentiment']);
	assert.equal(toolCalls(fake, 'get_signals').length, 0);
	assert.equal(toolCalls(fake, 'get_watchlist').length, 0);
	// A guest does not even ask for its tier.
	assert.equal(fake.calls.length, 0);
});

test('the tier comes from the daily limit the API reports, in any header casing', async () => {
	const proFake = server({}, { dailyLimit: 5000 });
	assert.equal(await loaders.isProCredential(ctxFor(proFake)), true);
	loaders.clearOptionCache();
	assert.equal(await loaders.isProCredential(ctxFor(server({}, { dailyLimit: 200 }))), false);
	loaders.clearOptionCache();
	assert.equal(await loaders.isProCredential(ctxFor(server({}, { dailyLimit: 100 }))), false);
});

function ctxFor(fake) {
	return {
		getNodeParameter: (name, fallback) => (name === 'authentication' ? 'apiKey' : fallback),
		getNode: () => ({ credentials: { stocklakeApi: { id: 'c1', name: 'k' } } }),
		helpers: {
			httpRequest: fake.httpRequest,
			httpRequestWithAuthentication: fake.httpRequestWithAuthentication,
		},
	};
}

// --- watchlist in the symbol picker --------------------------------------------

test('watchlist: with nothing typed, a Pro credential sees its watchlist', async () => {
	const fake = server({}, { dailyLimit: 5000 });
	const { results } = await runLoader(loaders.searchSymbolsWithWatchlist, { fake, filter: '' });

	assert.deepEqual(
		results.map((r) => r.value),
		['RKLB', 'COIN'],
	);
	assert.equal(results[0].name, '★ RKLB — Rocket Lab Corporation (watchlist)');
	assert.equal(fake.searches.length, 0, 'no autocomplete request for an empty search');
});

test('watchlist: matches come first when searching, without duplicates', async () => {
	const fake = server(
		{},
		{
			dailyLimit: 5000,
			search: () => [
				{ symbol: 'RKLB', name: 'Rocket Lab Corporation' },
				{ symbol: 'RKT', name: 'Rocket Companies' },
			],
		},
	);
	const { results } = await runLoader(loaders.searchSymbolsWithWatchlist, { fake, filter: 'rk' });

	assert.deepEqual(
		results.map((r) => r.value),
		['RKLB', 'RKT'],
	);
	assert.ok(results[0].name.startsWith('★'));
	assert.equal(results[1].name, 'RKT — Rocket Companies');
});

test('search for a credential that is not Pro is the plain autocomplete, as before', async () => {
	const fake = server(
		{},
		{ dailyLimit: 200, search: () => [{ symbol: 'AAPL', name: 'Apple Inc.' }] },
	);
	const typed = await runLoader(loaders.searchSymbolsWithWatchlist, { fake, filter: 'aap' });
	assert.deepEqual(typed.results, [{ name: 'AAPL — Apple Inc.', value: 'AAPL' }]);
	const empty = await runLoader(loaders.searchSymbolsWithWatchlist, { fake, filter: '' });
	assert.deepEqual(empty.results, []);
});

test('a watchlist that cannot be loaded leaves the search working', async () => {
	const fake = server(
		{ get_watchlist: down },
		{ dailyLimit: 5000, search: () => [{ symbol: 'AAPL', name: 'Apple Inc.' }] },
	);
	const { results } = await runLoader(loaders.searchSymbolsWithWatchlist, { fake, filter: 'aap' });
	assert.deepEqual(results, [{ name: 'AAPL — Apple Inc.', value: 'AAPL' }]);
});

// --- caching ------------------------------------------------------------------

test('one credential: a second editor open does not call the API again', async () => {
	const fake = server({}, { dailyLimit: 5000 });
	for (let i = 0; i < 3; i += 1) {
		await runLoader(loaders.getSectors, { fake });
		await runLoader(loaders.getScreenerPresets, { fake });
		await runLoader(loaders.getActivityTypes, { fake });
		await runLoader(loaders.getSignalSources, { fake });
		await runLoader(loaders.getSignalDirections, { fake });
		await runLoader(loaders.searchSymbolsWithWatchlist, { fake, filter: '' });
	}
	const perTool = (name) => toolCalls(fake, name).length;
	assert.equal(perTool('get_screener'), 2, 'one sector probe, one preset probe (also the tier)');
	assert.equal(perTool('get_stock_activity'), 1);
	assert.equal(perTool('get_signals'), 2);
	assert.equal(perTool('get_watchlist'), 1);
});

test('the cache is per credential: another credential loads for itself', async () => {
	const fake = server();
	await runLoader(loaders.getSectors, { fake, credentialId: 'a' });
	await runLoader(loaders.getSectors, { fake, credentialId: 'a' });
	await runLoader(loaders.getSectors, { fake, credentialId: 'b' });
	await runLoader(loaders.getSectors, { fake, auth: 'oAuth2', credentialId: 'a' });
	await runLoader(loaders.getSectors, { fake, auth: 'guest' });

	assert.equal(toolCalls(fake, 'get_screener').length, 4);
	const used = toolCalls(fake, 'get_screener').map((c) => c.credential);
	assert.deepEqual(used, ['stocklakeApi', 'stocklakeApi', 'stocklakeOAuth2Api', null]);
});

test('requests made at the same moment share one call', async () => {
	const fake = server();
	await Promise.all([
		runLoader(loaders.getSectors, { fake }),
		runLoader(loaders.getSectors, { fake }),
		runLoader(loaders.getSectorsForRotation, { fake }),
	]);
	assert.equal(toolCalls(fake, 'get_screener').length, 1);
});

test('lists are kept for 30 minutes; a failed load is retried after one', async () => {
	let now = 1_000_000;
	mock.method(Date, 'now', () => now);

	const fake = server();
	await runLoader(loaders.getSectors, { fake });
	now += 29 * 60 * 1000;
	await runLoader(loaders.getSectors, { fake });
	assert.equal(toolCalls(fake, 'get_screener').length, 1, 'still cached at 29 minutes');
	now += 2 * 60 * 1000;
	await runLoader(loaders.getSectors, { fake });
	assert.equal(toolCalls(fake, 'get_screener').length, 2, 'loaded again after 31 minutes');

	loaders.clearOptionCache();
	const broken = createFakeMcp({ get_screener: down });
	await runLoader(loaders.getSectors, { fake: broken });
	now += 30 * 1000;
	await runLoader(loaders.getSectors, { fake: broken });
	assert.equal(toolCalls(broken, 'get_screener').length, 1, 'a failure is not retried at once');
	now += 40 * 1000;
	await runLoader(loaders.getSectors, { fake: broken });
	assert.equal(toolCalls(broken, 'get_screener').length, 2, 'but is retried after a minute');
});

test('every request from a loader identifies the node', async () => {
	const seen = [];
	const fake = server();
	const original = fake.httpRequest;
	fake.httpRequest = (options) => {
		seen.push(options.headers['User-Agent']);
		return original(options);
	};
	await runLoader(loaders.getSectors, { fake, auth: 'guest' });
	assert.deepEqual(seen, ['n8n-nodes-stocklake']);
});

// --- the node descriptions --------------------------------------------------------

function* walk(properties) {
	for (const p of properties) {
		yield p;
		if (p.type === 'collection' || p.type === 'fixedCollection') yield* walk(p.options ?? []);
	}
}

test('version 2 wires each loaded field to a method the node has', () => {
	const node = v2();
	const wired = new Map();
	for (const p of walk(node.description.properties)) {
		const method = p.typeOptions?.loadOptionsMethod;
		if (method) wired.set(`${p.displayOptions?.show?.resource?.[0]}.${p.name}`, method);
	}
	assert.deepEqual(Object.fromEntries(wired), {
		'screener.preset': 'getScreenerPresets',
		'screener.sector': 'getSectors',
		'sector.sector': 'getSectorsForRotation',
		'earnings.sector': 'getSectors',
		'signal.direction': 'getSignalDirections',
		'signal.source': 'getSignalSources',
		'stock.types': 'getActivityTypes',
	});
	for (const method of wired.values()) {
		assert.equal(typeof node.methods.loadOptions[method], 'function', method);
	}
	assert.equal(typeof node.methods.listSearch.searchSymbols, 'function');
});

test('version 1 is untouched: no loaded option, its own symbol search', () => {
	const node = v1();
	for (const p of walk(node.description.properties)) {
		assert.equal(p.typeOptions?.loadOptionsMethod, undefined, p.name);
	}
	assert.equal(node.methods.loadOptions, undefined);
	const symbol = node.description.properties.find((p) => p.type === 'resourceLocator');
	assert.equal(symbol.modes[0].typeOptions.searchFilterRequired, true);
});

test('version 2 symbol pickers list the watchlist when nothing is typed', () => {
	const pickers = v2().description.properties.filter((p) => p.type === 'resourceLocator');
	assert.ok(pickers.length >= 10);
	for (const p of pickers) {
		const list = p.modes.find((m) => m.name === 'list');
		assert.equal(list.typeOptions.searchFilterRequired, false, p.displayOptions.show.operation[0]);
		assert.equal(list.typeOptions.searchListMethod, 'searchSymbols');
	}
});

test('country is a dropdown of the countries in the universe, "Any" first', () => {
	const screener = v2().description.properties.find(
		(p) => p.name === 'additionalFields' && p.displayOptions.show.resource[0] === 'screener',
	);
	const country = screener.options.find((o) => o.name === 'country');
	assert.equal(country.type, 'options');
	assert.deepEqual(country.options[0], { name: 'Any', value: '' });
	const names = country.options.slice(1).map((o) => o.value);
	assert.deepEqual(
		names,
		COUNTRY_OPTIONS.map((o) => o.value),
	);
	for (const expected of ['United States', 'Germany', 'Japan', 'United Kingdom']) {
		assert.ok(names.includes(expected), expected);
	}
	assert.deepEqual(
		names,
		[...names].sort((a, b) => a.localeCompare(b)),
	);
});

test('the signal operation no longer names a "social" source', () => {
	const operation = v2().description.properties.find(
		(p) => p.name === 'operation' && p.displayOptions.show.resource[0] === 'signal',
	);
	assert.ok(!/social/i.test(operation.options[0].description));
});
