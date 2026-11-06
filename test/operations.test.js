'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { Stocklake } = require('../dist/nodes/Stocklake/Stocklake.node');
const { createFakeMcp, loadNode, runNode } = require('./helpers/fakeMcp');
const { cases, v2Cases } = require('./fixtures/operations');
const { LIST_SPECS } = require('../dist/nodes/Stocklake/rows');

const MCP_URL = 'https://api.stocklake.dev/mcp';

/**
 * Every operation, end to end through the real execute(): node parameters in, the
 * exact tool name and arguments out (as the fake server saw them), and the response
 * mapped to output items. Run for each node version that exists.
 */
for (const version of [1, 2]) {
	for (const c of version === 1 ? cases : [...cases, ...v2Cases]) {
		test(`v${version} ${c.name}: calls ${c.tool} with the exact arguments`, async () => {
			const fake = createFakeMcp({ [c.tool]: c.response });
			const node = loadNode(Stocklake, version);

			const output = await runNode(node, { params: c.params, fake, typeVersion: version });

			const args = version === 2 && c.argsV2 ? c.argsV2 : c.args;
			assert.deepEqual(fake.calls, [
				{ toolName: c.tool, arguments: args, url: MCP_URL, credential: null },
			]);
			// Response mapping. Version 1, and every operation that is not a list in version
			// 2: one output item holding the whole structured response, paired with the
			// input item it came from. List operations in version 2 are split into rows,
			// which test/rows.test.js covers with realistic responses.
			const isList = version === 2 && `${c.params.resource}.${c.params.operation}` in LIST_SPECS;
			if (!isList) {
				assert.deepEqual(output, [[{ json: c.response, pairedItem: { item: 0 } }]]);
			}
		});
	}
}

test('one tool call per input item, each paired with its own input', async () => {
	const fake = createFakeMcp({ get_stock: (args) => ({ symbol: args.symbol }) });
	const node = loadNode(Stocklake, 2);
	const rl = (value) => ({ __rl: true, mode: 'id', value });

	const output = await runNode(node, {
		items: [{ json: {} }, { json: {} }, { json: {} }],
		params: [
			{ resource: 'stock', operation: 'get', symbol: rl('AAPL') },
			{ resource: 'stock', operation: 'get', symbol: rl('MSFT') },
			{ resource: 'stock', operation: 'get', symbol: rl('NVDA') },
		],
		fake,
		typeVersion: 2,
	});

	assert.deepEqual(
		fake.calls.map((call) => call.arguments),
		[{ symbol: 'AAPL' }, { symbol: 'MSFT' }, { symbol: 'NVDA' }],
	);
	assert.deepEqual(output, [
		[
			{ json: { symbol: 'AAPL' }, pairedItem: { item: 0 } },
			{ json: { symbol: 'MSFT' }, pairedItem: { item: 1 } },
			{ json: { symbol: 'NVDA' }, pairedItem: { item: 2 } },
		],
	]);
});

test('credentials: OAuth2 and API key are attached by name, guest sends none', async () => {
	const rl = { __rl: true, mode: 'id', value: 'AAPL' };
	const base = { resource: 'stock', operation: 'get', symbol: rl };
	const node = loadNode(Stocklake, 2);

	const guest = createFakeMcp({ get_stock: {} });
	await runNode(node, { params: base, fake: guest, typeVersion: 2 });
	assert.equal(guest.calls[0].credential, null);

	const apiKey = createFakeMcp({ get_stock: {} });
	await runNode(node, { params: base, fake: apiKey, typeVersion: 2, apiKeyCredential: true });
	assert.equal(apiKey.calls[0].credential, 'stocklakeApi');

	const oauth = createFakeMcp({ get_stock: {} });
	await runNode(node, {
		params: { ...base, authentication: 'oAuth2' },
		fake: oauth,
		typeVersion: 2,
	});
	assert.equal(oauth.calls[0].credential, 'stocklakeOAuth2Api');
});

test('a tool error reaches the user as a node error, or as an item with continueOnFail', async () => {
	const params = {
		resource: 'stock',
		operation: 'get',
		symbol: { __rl: true, mode: 'id', value: 'NOPE' },
	};
	const notFound = {
		error: { code: 'symbol_not_found', message: "No stock found for 'NOPE'", type: 'not_found' },
	};
	const node = loadNode(Stocklake, 2);

	await assert.rejects(
		runNode(node, { params, fake: createFakeMcp({ get_stock: notFound }), typeVersion: 2 }),
		/No stock found for 'NOPE'/,
	);

	const output = await runNode(node, {
		params,
		fake: createFakeMcp({ get_stock: notFound }),
		typeVersion: 2,
		continueOnFail: true,
	});
	assert.equal(output[0].length, 1);
	assert.equal(output[0][0].json.error, "No stock found for 'NOPE'");
	assert.match(output[0][0].json.errorDescription, /"NOPE" is not in Stocklake/);
	assert.deepEqual(output[0][0].pairedItem, { item: 0 });
});
