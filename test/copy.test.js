'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { Stocklake } = require('../dist/nodes/Stocklake/Stocklake.node');
const { OPERATION_TOOLS, DOCS_TOOLS_URL } = require('../dist/nodes/Stocklake/descriptions/shared');
const { cases, v2Cases } = require('./fixtures/operations');

const root = path.join(__dirname, '..');

function walk(dir, out = []) {
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) walk(full, out);
		else out.push(full);
	}
	return out;
}

/** Everything a user, a reviewer or the n8n scanner can read. */
const publicFiles = [
	'README.md',
	'CHANGELOG.md',
	'CONTRIBUTING.md',
	'package.json',
	'docs/resubmission.md',
	'templates/README.md',
	...walk(path.join(root, 'demo-workflows')).map((f) => path.relative(root, f)),
	...walk(path.join(root, 'examples')).map((f) => path.relative(root, f)),
	...walk(path.join(root, 'templates')).map((f) => path.relative(root, f)),
	...walk(path.join(root, 'nodes')).map((f) => path.relative(root, f)),
	...walk(path.join(root, 'credentials')).map((f) => path.relative(root, f)),
].filter((f) => /\.(md|json|ts)$/.test(f));

test('no wording that claims current quotes (they are delayed about 15 minutes)', () => {
	// Built from pieces so this file does not itself contain the words it forbids.
	const forbidden = new RegExp(
		['real[- ]?' + 'time', 'live' + ' data', '\\b' + 'live' + '\\b'].join('|'),
		'i',
	);
	for (const file of publicFiles) {
		// The file name of the checks report is a name, not a claim about the data.
		const text = fs
			.readFileSync(path.join(root, file), 'utf8')
			.replaceAll('live-checks-2026-11-07', 'checks-2026-11-07');
		const hit = text.split('\n').findIndex((line) => forbidden.test(line));
		assert.equal(hit, -1, `${file}:${hit + 1} claims current quotes`);
	}
});

test('no data-provider or internal model names anywhere', () => {
	const forbidden =
		/yahoo|ibkr|interactive brokers|finnhub|litellm|openrouter|deepseek|mistral|brave|alpha ?vantage|edgar|bafin|\bafm\b|cnmv|polygon/i;
	for (const file of publicFiles) {
		const text = fs.readFileSync(path.join(root, file), 'utf8');
		const hit = text.split('\n').findIndex((line) => forbidden.test(line));
		assert.equal(hit, -1, `${file}:${hit + 1} names a provider or model`);
	}
});

// The Toolkit (Stocklake Tool only) has no operation of its own: the agent picks one.
const operationOptions = new Stocklake().nodeVersions[2].description.properties
	.filter((p) => p.name === 'operation' && !p.displayOptions.show.resource.includes('toolkit'))
	.flatMap((p) =>
		p.displayOptions.show.resource.map((resource) => ({ resource, options: p.options })),
	);

test('every operation has a docs link to its own tool in its description', () => {
	let count = 0;
	for (const { resource, options } of operationOptions) {
		for (const option of options) {
			const tool = OPERATION_TOOLS[`${resource}.${option.value}`];
			assert.ok(tool, `${resource}.${option.value} is missing from OPERATION_TOOLS`);
			assert.ok(
				option.description.endsWith(`Docs: ${DOCS_TOOLS_URL}#${tool}`),
				`${resource}.${option.value} description does not end with its docs link`,
			);
			count++;
		}
	}
	assert.equal(count, Object.keys(OPERATION_TOOLS).length);
});

test('the docs-link table agrees with the tool each operation really calls', () => {
	for (const c of [...cases, ...v2Cases]) {
		const key = `${c.params.resource}.${c.params.operation}`;
		if (OPERATION_TOOLS[key]) assert.equal(OPERATION_TOOLS[key], c.tool, key);
	}
});

test('tier counts in the README match the operations the node defines', () => {
	// Operations that work without a Pro account (verified against the live API:
	// a guest call to each succeeds). Everything else needs Pro.
	const free = new Set([
		'stock.get',
		'stock.getMany',
		'stock.getHistory',
		'stock.getNews',
		'stock.getInsiderActivity',
		'screener.screen',
		'market.getPulse',
		'market.getMovers',
		'earnings.getCalendar',
		'stock.getFinancials',
		'stock.getFilings',
		'stock.getActivity',
		'market.getEconomicCalendar',
		// Composites: free, with Pro extras on top.
		'stock.compare',
		'stock.snapshot',
		'portfolio.checkHoldings',
	]);
	const all = Object.keys(OPERATION_TOOLS);
	assert.ok([...free].every((k) => all.includes(k)));
	const pro = all.length - free.size;

	const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
	assert.ok(
		readme.includes(`exposes all ${all.length} (${free.size} free, ${pro} Pro)`),
		`README must say "exposes all ${all.length} (${free.size} free, ${pro} Pro)"`,
	);
});

test('codex file: categories, aliases, documentation', () => {
	const codex = JSON.parse(
		fs.readFileSync(path.join(root, 'nodes/Stocklake/Stocklake.node.json'), 'utf8'),
	);
	assert.equal(codex.node, 'n8n-nodes-stocklake.stocklake');
	assert.deepEqual(codex.categories, ['Finance & Accounting', 'Analytics', 'Data & Storage']);
	assert.ok(codex.alias.length >= 10);
	assert.ok(codex.alias.every((a) => a === a.toLowerCase()));
	assert.ok(codex.resources.primaryDocumentation[0].url.startsWith('https://stocklake.dev/docs'));
	assert.ok(codex.resources.credentialDocumentation.length >= 1);
	assert.ok(
		fs.existsSync(path.join(root, 'dist/nodes/Stocklake/Stocklake.node.json')),
		'the codex file must be copied into dist by the build',
	);
});

test('both credentials point at their documentation', () => {
	const { StocklakeApi } = require('../dist/credentials/StocklakeApi.credentials');
	const { StocklakeOAuth2Api } = require('../dist/credentials/StocklakeOAuth2Api.credentials');
	assert.equal(new StocklakeApi().documentationUrl, 'https://stocklake.dev/docs#auth');
	assert.equal(new StocklakeOAuth2Api().documentationUrl, 'https://stocklake.dev/docs#oauth');
});
