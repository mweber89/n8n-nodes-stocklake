'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { cleanParams, parseSymbolList } = require('../dist/nodes/Stocklake/GenericFunctions');

test('cleanParams strips undefined, null, and empty-string values', () => {
	assert.deepEqual(
		cleanParams({
			a: 'kept',
			b: undefined,
			c: null,
			d: '',
			e: 0,
			f: false,
			g: 'also kept',
		}),
		{ a: 'kept', e: 0, f: false, g: 'also kept' },
	);
});

test('cleanParams keeps zero and false — only strips undefined/null/empty-string', () => {
	assert.deepEqual(cleanParams({ zero: 0, no: false }), { zero: 0, no: false });
});

test('parseSymbolList trims, uppercases, and de-duplicates', () => {
	assert.deepEqual(parseSymbolList('aapl, MSFT ,aapl,  nvda,'), ['AAPL', 'MSFT', 'NVDA']);
});

test('parseSymbolList on an empty string returns an empty array', () => {
	assert.deepEqual(parseSymbolList(''), []);
});

test('parseSymbolList on a single symbol', () => {
	assert.deepEqual(parseSymbolList('  tsla  '), ['TSLA']);
});
