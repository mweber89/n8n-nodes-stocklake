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
	assert.deepEqual(node.nodeVersions[1].description.credentials, node.nodeVersions[2].description.credentials);
});

/**
 * Regression: a workflow built on 0.1.1 (node typeVersion 1) must run unchanged.
 * test/fixtures/workflow-v1.json holds such a workflow; test/fixtures/v1-golden.json
 * holds what the 0.1.1 build sent and returned for each of its nodes (captured by
 * running the 0.1.1 code, not written from this code); and v1-parameters-golden.json
 * holds 0.1.1's parameter definitions.
 */
const stocklakeNodes = workflow.nodes.filter((n) => n.type === 'n8n-nodes-stocklake.stocklake');

test('the saved 0.1.1 workflow fixture covers every operation and is on node version 1', () => {
	assert.ok(stocklakeNodes.length >= cases.length);
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
