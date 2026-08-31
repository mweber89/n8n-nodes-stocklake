'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildToolCall } = require('../dist/nodes/Stocklake/ToolMapping');

/**
 * Minimal fake IExecuteFunctions — just enough of `getNodeParameter` for
 * buildToolCall's needs. Symbol resourceLocator fields are mocked as already
 * resolved to a plain string (extracting the real {mode, value} shape is
 * n8n core's job, not this function's).
 */
function ctx(params) {
	return {
		getNodeParameter(name, _itemIndex, fallback) {
			return Object.prototype.hasOwnProperty.call(params, name) ? params[name] : fallback;
		},
	};
}

function call(resource, operation, params) {
	return buildToolCall.call(ctx(params), resource, operation, 0);
}

test('stock.get', () => {
	assert.deepEqual(call('stock', 'get', { symbol: 'AAPL' }), {
		toolName: 'get_stock',
		toolArguments: { symbol: 'AAPL' },
	});
});

test('stock.getMany dedupes, uppercases, and trims the symbol list', () => {
	assert.deepEqual(call('stock', 'getMany', { symbols: 'aapl, MSFT ,aapl,  nvda' }), {
		toolName: 'get_stocks',
		toolArguments: { symbols: ['AAPL', 'MSFT', 'NVDA'] },
	});
});

test('stock.getHistory', () => {
	assert.deepEqual(call('stock', 'getHistory', { symbol: 'TSLA', days: 30 }), {
		toolName: 'get_stock_history',
		toolArguments: { symbol: 'TSLA', days: 30 },
	});
});

test('stock.getNews', () => {
	assert.deepEqual(call('stock', 'getNews', { symbol: 'NVDA', limit: 5, days: 7 }), {
		toolName: 'get_stock_news',
		toolArguments: { symbol: 'NVDA', limit: 5, days: 7 },
	});
});

test('stock.getResearch', () => {
	assert.deepEqual(call('stock', 'getResearch', { symbol: 'COIN' }), {
		toolName: 'get_stock_research',
		toolArguments: { symbol: 'COIN' },
	});
});

test('stock.getIndicatorHistory', () => {
	assert.deepEqual(call('stock', 'getIndicatorHistory', { symbol: 'AMD', days: 180 }), {
		toolName: 'get_indicator_history',
		toolArguments: { symbol: 'AMD', days: 180 },
	});
});

test('stock.getInsiderActivity', () => {
	assert.deepEqual(call('stock', 'getInsiderActivity', { symbol: 'META' }), {
		toolName: 'get_insider_activity',
		toolArguments: { symbol: 'META' },
	});
});

// This is the direct regression test for the real bug found and fixed
// 2026-08-31: the Additional Fields collection's camelCase property names
// (n8n convention) were being spread straight into toolArguments instead of
// translated to the API's real snake_case params, so every one of these
// filters was silently sent under the wrong name and had no effect.
test('screener.screen maps every Additional Field to its real snake_case API param', () => {
	const result = call('screener', 'screen', {
		preset: 'oversold',
		sector: 'Technology',
		limit: 15,
		additionalFields: {
			country: 'United States',
			minRsi: 20,
			maxRsi: 40,
			smaTrend: 'above_200',
			macdSignal: 'positive',
			minPerf1d: -5,
			maxPerf1d: 5,
			minVolume: 1000000,
			minMarketCapB: 10,
			maxMarketCapB: 500,
			maxPeForward: 30,
			analystRating: 'strong_buy',
			minAiScore: 70,
			sortBy: 'rsi',
			sortDir: 'asc',
		},
	});

	assert.equal(result.toolName, 'get_screener');
	assert.deepEqual(result.toolArguments, {
		preset: 'oversold',
		sector: 'Technology',
		limit: 15,
		country: 'United States',
		min_rsi: 20,
		max_rsi: 40,
		sma_trend: 'above_200',
		macd_signal: 'positive',
		min_perf_1d: -5,
		max_perf_1d: 5,
		min_volume: 1000000,
		min_market_cap_b: 10,
		max_market_cap_b: 500,
		max_pe_forward: 30,
		analyst_rating: 'strong_buy',
		min_ai_score: 70,
		sort_by: 'rsi',
		sort_dir: 'asc',
	});
});

test('screener.screen with no Additional Fields sends only preset/sector/limit', () => {
	const result = call('screener', 'screen', { preset: '', sector: '', limit: 20 });
	assert.deepEqual(result.toolArguments, { limit: 20 });
});

test('market.getPulse takes no arguments', () => {
	assert.deepEqual(call('market', 'getPulse', {}), {
		toolName: 'get_market_pulse',
		toolArguments: {},
	});
});

test('market.getMovers drops a zero (unset) min market cap', () => {
	const result = call('market', 'getMovers', { category: 'gainers', limit: 10, minMarketCapB: 0 });
	assert.deepEqual(result.toolArguments, { category: 'gainers', limit: 10 });
});

test('market.getMovers keeps a real min market cap', () => {
	const result = call('market', 'getMovers', { category: 'gainers', limit: 10, minMarketCapB: 2 });
	assert.deepEqual(result.toolArguments, { category: 'gainers', limit: 10, min_market_cap_b: 2 });
});

test('market.getAssessment', () => {
	assert.deepEqual(call('market', 'getAssessment', { historyCount: 3 }), {
		toolName: 'get_market_assessment',
		toolArguments: { history_count: 3 },
	});
});

test('sector.getIntelligence', () => {
	assert.deepEqual(
		call('sector', 'getIntelligence', { sector: 'Energy', sortByStrength: true, historyCount: 1 }),
		{
			toolName: 'get_sector_intelligence',
			toolArguments: { sector: 'Energy', sort_by_strength: true, history_count: 1 },
		},
	);
});

test('earnings.getCalendar', () => {
	assert.deepEqual(call('earnings', 'getCalendar', { days: 14 }), {
		toolName: 'get_earnings_calendar',
		toolArguments: { days: 14 },
	});
});

test('earnings.getIntelligence drops a zero (unset) min AI score', () => {
	const result = call('earnings', 'getIntelligence', {
		daysAhead: 7,
		sector: '',
		minAiScore: 0,
		limit: 25,
	});
	assert.deepEqual(result.toolArguments, { days_ahead: 7, limit: 25 });
});

test('news.getFeed', () => {
	assert.deepEqual(call('news', 'getFeed', { minSignalScore: 70, days: 5, limit: 20 }), {
		toolName: 'get_news_feed',
		toolArguments: { min_signal_score: 70, days: 5, limit: 20 },
	});
});

test('signal.getMany', () => {
	assert.deepEqual(
		call('signal', 'getMany', {
			direction: 'POSITIVE',
			source: 'news',
			minSignalScore: 65,
			limit: 25,
		}),
		{
			toolName: 'get_signals',
			toolArguments: { direction: 'POSITIVE', source: 'news', min_signal_score: 65, limit: 25 },
		},
	);
});

test('watchlist.get takes no arguments', () => {
	assert.deepEqual(call('watchlist', 'get', {}), {
		toolName: 'get_watchlist',
		toolArguments: {},
	});
});

test('an unknown resource/operation pair throws', () => {
	assert.throws(() => call('bogus', 'thing', {}), /Unknown Stocklake operation: bogus\.thing/);
});
