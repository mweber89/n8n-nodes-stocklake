'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { Stocklake } = require('../dist/nodes/Stocklake/Stocklake.node');
const { createFakeMcp, runNode } = require('./helpers/fakeMcp');
const { descriptionSignature } = require('./helpers/signature');
const { cases } = require('./fixtures/operations');

const workflow = require('./fixtures/workflow-v1.json');
const goldenCalls = require('./fixtures/v1-golden.json');
const goldenParameters = require('./fixtures/v1-parameters-golden.json');

test('the node is versioned: versions 1 and 2, version 2 is the default for new nodes', () => {
	const node = new Stocklake();

	assert.deepEqual(Object.keys(node.nodeVersions).map(Number), [1, 2]);
	assert.equal(node.description.defaultVersion, 2);
	assert.equal(node.currentVersion, 2);
	assert.equal(node.getNodeType().description.version, 2, 'no version asked for -> latest');

	assert.equal(node.nodeVersions[1].description.version, 1);
	assert.equal(node.nodeVersions[2].description.version, 2);
	for (const version of [1, 2]) {
		assert.equal(node.nodeVersions[version].description.usableAsTool, true);
		assert.equal(node.nodeVersions[version].description.name, 'stocklake');
	}
});

test('both versions share the node identity n8n stores in workflows', () => {
	const node = new Stocklake();
	assert.equal(node.description.name, 'stocklake');
	assert.deepEqual(
		node.nodeVersions[1].description.credentials,
		node.nodeVersions[2].description.credentials,
	);
});

/**
 * Regression: a workflow built on 0.1.1 (node typeVersion 1) must run unchanged.
 * test/fixtures/workflow-v1.json holds such a workflow; test/fixtures/v1-golden.json
 * holds what the 0.1.1 build sent and returned for each of its nodes (captured by
 * running the 0.1.1 code, not written from this code); and v1-parameters-golden.json
 * holds 0.1.1's parameter definitions.
 */
const stocklakeNodes = workflow.nodes.filter((n) => n.type === 'n8n-nodes-stocklake.stocklake');

const NEW_IN_V2 = [
	['stock', 'getFinancials'],
	['stock', 'getFilings'],
	['stock', 'getActivity'],
	['stock', 'getAnalystTrend'],
	['market', 'getEconomicCalendar'],
];

function operationValues(version, resource) {
	const property = new Stocklake().nodeVersions[version].description.properties.find(
		(p) => p.name === 'operation' && p.displayOptions.show.resource[0] === resource,
	);
	return property.options.map((o) => o.value);
}

test('version 2 adds exactly the five new operations; version 1 does not have them', () => {
	for (const [resource, operation] of NEW_IN_V2) {
		assert.ok(operationValues(2, resource).includes(operation), `v2 ${resource}.${operation}`);
		assert.ok(!operationValues(1, resource).includes(operation), `v1 ${resource}.${operation}`);
	}
	// Nothing else changed in the operation lists.
	assert.equal(operationValues(2, 'stock').length, operationValues(1, 'stock').length + 4);
	assert.equal(operationValues(2, 'market').length, operationValues(1, 'market').length + 1);
});

test('version 2 keeps every version 1 parameter unchanged', () => {
	const v1 = new Stocklake().nodeVersions[1].description;
	const v2 = new Stocklake().nodeVersions[2].description;
	// Version 2 shows Limit and Page only while Return All is off; that is the one
	// change to a version 1 property's visibility.
	const key = (p) => {
		const show = { ...p.displayOptions?.show };
		delete show.returnAll;
		return JSON.stringify([p.name, { ...p.displayOptions, show }]);
	};
	const sigV2 = new Map(descriptionSignature(v2).properties.map((p) => [key(p), p]));
	for (const p of descriptionSignature(v1).properties) {
		const same = sigV2.get(key(p));
		assert.ok(same, `v2 lost ${p.name}`);
		if (p.name === 'operation') continue;
		const { displayOptions: _v2Display, ...restV2 } = same;
		const { displayOptions: _v1Display, ...restV1 } = p;
		assert.deepEqual(restV2, restV1, p.name);
	}
});

test('the new operations list is alphabetical (n8n convention)', () => {
	for (const resource of ['stock', 'market']) {
		const property = new Stocklake().nodeVersions[2].description.properties.find(
			(p) => p.name === 'operation' && p.displayOptions.show.resource[0] === resource,
		);
		const names = property.options.map((o) => o.name);
		assert.deepEqual(
			names,
			[...names].sort((a, b) => a.localeCompare(b)),
		);
	}
});

test("the new parameters are dropdowns and multi-selects with the tool's exact values", () => {
	const props = new Stocklake().nodeVersions[2].description.properties;
	const find = (name, operation) =>
		props.find((p) => p.name === name && p.displayOptions?.show?.operation?.includes(operation));
	const values = (p) => p.options.map((o) => o.value).sort();

	assert.equal(find('period', 'getFinancials').type, 'options');
	assert.deepEqual(values(find('period', 'getFinancials')), ['annual', 'both', 'quarterly']);
	assert.equal(find('statement', 'getFinancials').type, 'options');
	assert.deepEqual(values(find('statement', 'getFinancials')), [
		'all',
		'balance_sheet',
		'cash_flow',
		'income_stmt',
	]);
	assert.equal(find('types', 'getActivity').type, 'multiOptions');
	assert.deepEqual(values(find('types', 'getActivity')), [
		'analyst',
		'earnings',
		'filing',
		'insider',
		'news',
		'setup',
	]);
	for (const operation of ['getFinancials', 'getFilings', 'getActivity', 'getAnalystTrend']) {
		assert.equal(find('symbol', operation).type, 'resourceLocator', operation);
		assert.equal(find('symbol', operation).modes[0].typeOptions.searchListMethod, 'searchSymbols');
	}
});

test('the new parameters carry the live tools\' exact defaults and limits', () => {
	// Written out by hand from the tool signatures in the Stocklake server.
	const expected = {
		'getFinancials.period': { default: 'annual' },
		'getFinancials.statement': { default: 'all' },
		'getFilings.maxResults': { default: 10, max: 25 },
		'getActivity.days': { default: 90, max: 90 },
		'getActivity.maxResults': { default: 25, max: 50 },
		'getActivity.page': { default: 1 },
		'getAnalystTrend.days': { default: 90, max: 365 },
		'getEconomicCalendar.lookbackDays': { default: 2 },
		'getEconomicCalendar.maxResults': { default: 20, max: 50 },
		'getEconomicCalendar.majorOnly': { default: false },
		'getEconomicCalendar.keyEventsOnly': { default: false },
		'getEconomicCalendar.days': { default: 0, max: 14 },
	};
	const props = new Stocklake().nodeVersions[2].description.properties;
	for (const [key, want] of Object.entries(expected)) {
		const [operation, name] = key.split('.');
		const p = props.find((x) => x.name === name && x.displayOptions?.show?.operation?.includes(operation));
		assert.ok(p, key);
		assert.deepEqual(p.default, want.default, `${key} default`);
		if (want.max !== undefined) assert.equal(p.typeOptions.maxValue, want.max, `${key} max`);
	}
});

test('the saved 0.1.1 workflow fixture covers every operation and is on node version 1', () => {
	assert.ok(stocklakeNodes.length >= cases.length, 'one node per version-1 operation case');
	for (const n of stocklakeNodes) assert.equal(n.typeVersion, 1, n.name);
});

for (const n of stocklakeNodes) {
	const goldenKey = n.name.replace(' (defaults omitted)', '');
	const c = cases.find((x) => x.name === goldenKey);

	test(`a v1 workflow node "${n.name}" still sends the same call and returns the same items`, async () => {
		const node = new Stocklake().getNodeType(n.typeVersion);
		assert.equal(node.description.version, 1, 'typeVersion 1 resolves to the v1 node');

		const fake = createFakeMcp({ [c.tool]: c.response });
		const output = await runNode(node, { params: n.parameters, fake, typeVersion: n.typeVersion });

		assert.deepEqual(fake.calls, goldenCalls[goldenKey].calls);
		assert.deepEqual(output, goldenCalls[goldenKey].output);
	});
}

test('version 1 keeps exactly the parameters, defaults and option values of 0.1.1', () => {
	const v1 = new Stocklake().nodeVersions[1].description;
	assert.deepEqual(descriptionSignature(v1), goldenParameters);
});
