'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { Stocklake } = require('../dist/nodes/Stocklake/Stocklake.node');
const { StocklakeTrigger } = require('../dist/nodes/StocklakeTrigger/StocklakeTrigger.node');
const { OPERATION_TOOLS } = require('../dist/nodes/Stocklake/descriptions/shared');

const dir = path.join(__dirname, '..', 'templates');
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
const templates = files.map((f) => ({
	file: f,
	workflow: JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')),
}));

const stocklakeProps = new Set(
	new Stocklake().nodeVersions[2].description.properties.map((p) => p.name),
);
const triggerDescription = new StocklakeTrigger().description;
const triggerProps = new Set(triggerDescription.properties.map((p) => p.name));
const eventOptions = triggerDescription.properties.find((p) => p.name === 'event').options;

test('there are four to five templates, each with its own name', () => {
	assert.ok(templates.length >= 4 && templates.length <= 5, `${templates.length} templates`);
	assert.equal(new Set(templates.map((t) => t.workflow.name)).size, templates.length);
});

for (const { file, workflow } of templates) {
	test(`${file}: valid graph, no credentials, a sticky note with the set-up`, () => {
		const names = workflow.nodes.map((n) => n.name);
		assert.equal(new Set(names).size, names.length, 'node names are unique');
		assert.equal(
			new Set(workflow.nodes.map((n) => n.id)).size,
			names.length,
			'node ids are unique',
		);
		for (const [from, out] of Object.entries(workflow.connections)) {
			assert.ok(names.includes(from), `connection from unknown node ${from}`);
			for (const links of Object.values(out)) {
				for (const link of links.flat()) assert.ok(names.includes(link.node), link.node);
			}
		}
		for (const node of workflow.nodes) {
			assert.equal(node.credentials, undefined, `${node.name} carries a credential`);
		}
		const sticky = workflow.nodes.find((n) => n.type === 'n8n-nodes-base.stickyNote');
		assert.ok(sticky, 'has a sticky note');
		assert.match(sticky.parameters.content, /Set up/);
		assert.deepEqual(workflow.pinData, {});
		assert.equal(workflow.settings.executionOrder, 'v1');
	});

	test(`${file}: the Stocklake nodes use real operations, events and parameters`, () => {
		for (const node of workflow.nodes) {
			if (node.type === 'n8n-nodes-stocklake.stocklake') {
				assert.equal(node.typeVersion, 2);
				const key = `${node.parameters.resource}.${node.parameters.operation}`;
				assert.ok(OPERATION_TOOLS[key], `${node.name}: unknown operation ${key}`);
				for (const name of Object.keys(node.parameters)) {
					assert.ok(stocklakeProps.has(name), `${node.name}: unknown parameter ${name}`);
				}
			}
			if (node.type === 'n8n-nodes-stocklake.stocklakeTrigger') {
				assert.ok(
					eventOptions.some((o) => o.value === node.parameters.event),
					`${node.name}: unknown event`,
				);
				for (const name of Object.keys(node.parameters)) {
					assert.ok(triggerProps.has(name), `${node.name}: unknown parameter ${name}`);
				}
			}
			if (
				node.type === 'n8n-nodes-stocklake.stocklakeTool' &&
				node.parameters.resource === 'toolkit'
			) {
				for (const key of node.parameters.toolkitOperations) {
					assert.ok(OPERATION_TOOLS[key], `${node.name}: unknown toolkit operation ${key}`);
					assert.notEqual(key, 'portfolio.checkHoldings');
				}
			}
		}
	});

	test(`${file}: code nodes only read nodes that exist and every expression is balanced`, () => {
		const names = new Set(workflow.nodes.map((n) => n.name));
		for (const node of workflow.nodes) {
			const code = node.parameters.jsCode;
			if (code) {
				for (const m of code.matchAll(/\$\('([^']+)'\)/g)) {
					assert.ok(names.has(m[1]), `${node.name} reads unknown node ${m[1]}`);
				}
				assert.doesNotThrow(
					() => new Function('x', 'xi', code.replace(/\$\(/g, 'x(').replace(/\$input/g, 'xi')),
					node.name,
				);
			}
			for (const value of Object.values(node.parameters)) {
				if (typeof value === 'string' && value.startsWith('=')) {
					assert.equal(
						(value.match(/\{\{/g) || []).length,
						(value.match(/\}\}/g) || []).length,
						`${node.name}: unbalanced expression`,
					);
				}
			}
		}
	});
}

test('every template is listed in templates/README.md and the main README', () => {
	const index = fs.readFileSync(path.join(dir, 'README.md'), 'utf8');
	const readme = fs.readFileSync(path.join(__dirname, '..', 'README.md'), 'utf8');
	for (const file of files) {
		assert.ok(index.includes(`./${file}`), `${file} is missing from templates/README.md`);
		assert.ok(readme.includes(`./templates/${file}`), `${file} is missing from the README`);
	}
});

test('README screenshots exist', () => {
	const readme = fs.readFileSync(path.join(__dirname, '..', 'README.md'), 'utf8');
	const shots = [...readme.matchAll(/assets\/screenshots\/([\w.-]+\.png)/g)].map((m) => m[1]);
	assert.ok(shots.length >= 6);
	for (const shot of shots) {
		assert.ok(
			fs.existsSync(path.join(__dirname, '..', 'assets', 'screenshots', shot)),
			`${shot} is missing`,
		);
	}
});
