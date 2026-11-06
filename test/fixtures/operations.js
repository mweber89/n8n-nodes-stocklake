'use strict';

/**
 * One case per Stocklake operation (plus a few with non-default parameters).
 *
 * `params`   what a user sets in the node UI (everything else takes the node default)
 * `tool`     the exact MCP tool name the node must call
 * `args`     the exact arguments it must send
 * `response` what the fake server answers with (structuredContent)
 *
 * Expected values are written out by hand on purpose: they are the contract with
 * the Stocklake API, so they must not be derived from the code under test.
 */
const rl = (value) => ({ __rl: true, mode: 'list', value });

const cases = [
	{
		name: 'stock.get',
		params: { resource: 'stock', operation: 'get', symbol: rl('AAPL') },
		tool: 'get_stock',
		args: { symbol: 'AAPL' },
		response: { symbol: 'AAPL', price: 201.5, rsi: 55.2 },
	},
	{
		name: 'stock.getMany',
		params: { resource: 'stock', operation: 'getMany', symbols: 'aapl, MSFT ,aapl, nvda' },
		tool: 'get_stocks',
		args: { symbols: ['AAPL', 'MSFT', 'NVDA'] },
		response: { stocks: [{ symbol: 'AAPL' }, { symbol: 'MSFT' }, { symbol: 'NVDA' }], missing: [] },
	},
	{
		name: 'stock.getHistory (default days)',
		params: { resource: 'stock', operation: 'getHistory', symbol: rl('TSLA') },
		tool: 'get_stock_history',
		args: { symbol: 'TSLA', days: 90 },
		response: { symbol: 'TSLA', count: 1, history: [{ date: '2026-11-05', close: 250.1 }] },
	},
	{
		name: 'stock.getHistory (days set)',
		params: { resource: 'stock', operation: 'getHistory', symbol: rl('TSLA'), days: 30 },
		tool: 'get_stock_history',
		args: { symbol: 'TSLA', days: 30 },
		response: { symbol: 'TSLA', count: 0, history: [] },
	},
	{
		name: 'stock.getNews',
		params: { resource: 'stock', operation: 'getNews', symbol: rl('NVDA'), limit: 5, days: 7 },
		tool: 'get_stock_news',
		args: { symbol: 'NVDA', limit: 5, days: 7 },
		response: { symbol: 'NVDA', articles: [{ title: 'A headline' }] },
	},
	{
		name: 'stock.getResearch',
		params: { resource: 'stock', operation: 'getResearch', symbol: rl('COIN') },
		tool: 'get_stock_research',
		args: { symbol: 'COIN' },
		response: { symbol: 'COIN', ai_summary: { verdict: 'neutral' } },
	},
	{
		name: 'stock.getIndicatorHistory',
		params: { resource: 'stock', operation: 'getIndicatorHistory', symbol: rl('MSFT'), days: 60 },
		tool: 'get_indicator_history',
		args: { symbol: 'MSFT', days: 60 },
		response: { symbol: 'MSFT', snapshots: [{ date: '2026-11-05', rsi: 44.1 }] },
	},
	{
		name: 'stock.getInsiderActivity',
		params: { resource: 'stock', operation: 'getInsiderActivity', symbol: rl('AAPL') },
		tool: 'get_insider_activity',
		args: { symbol: 'AAPL' },
		response: { symbol: 'AAPL', insider: { transactions: [] } },
	},
	{
		name: 'screener.screen (preset only)',
		params: { resource: 'screener', operation: 'screen', preset: 'oversold', limit: 10 },
		tool: 'get_screener',
		args: { preset: 'oversold', limit: 10 },
		response: { count: 1, results: [{ symbol: 'XYZ', rsi: 24 }] },
	},
	{
		name: 'screener.screen (additional filters, snake_case on the wire)',
		params: {
			resource: 'screener',
			operation: 'screen',
			sector: 'Technology',
			limit: 25,
			additionalFields: {
				minRsi: 30,
				maxRsi: 45,
				smaTrend: 'above_200',
				macdSignal: 'positive',
				minMarketCapB: 10,
				maxPeForward: 25,
				analystRating: 'buy',
				minAiScore: 60,
				sortBy: 'perf_1d',
				sortDir: 'desc',
				country: 'United States',
			},
		},
		tool: 'get_screener',
		args: {
			sector: 'Technology',
			limit: 25,
			country: 'United States',
			min_rsi: 30,
			max_rsi: 45,
			sma_trend: 'above_200',
			macd_signal: 'positive',
			min_market_cap_b: 10,
			max_pe_forward: 25,
			analyst_rating: 'buy',
			min_ai_score: 60,
			sort_by: 'perf_1d',
			sort_dir: 'desc',
		},
		response: { count: 0, results: [] },
	},
	{
		name: 'market.getPulse',
		params: { resource: 'market', operation: 'getPulse' },
		tool: 'get_market_pulse',
		args: {},
		response: { vix: 18.9, fear_greed: { value: 39 } },
	},
	{
		name: 'market.getMovers',
		params: { resource: 'market', operation: 'getMovers', category: 'gainers', limit: 5, minMarketCapB: 2 },
		tool: 'get_market_movers',
		args: { category: 'gainers', limit: 5, min_market_cap_b: 2 },
		response: { gainers: [{ symbol: 'UP', change_pct: 9 }] },
	},
	{
		name: 'market.getAssessment',
		params: { resource: 'market', operation: 'getAssessment', historyCount: 3 },
		tool: 'get_market_assessment',
		args: { history_count: 3 },
		response: { regime: 'CAUTIOUS' },
	},
	{
		name: 'sector.getIntelligence',
		params: {
			resource: 'sector',
			operation: 'getIntelligence',
			sector: 'Energy',
			sortByStrength: true,
			historyCount: 2,
		},
		tool: 'get_sector_intelligence',
		args: { sector: 'Energy', sort_by_strength: true, history_count: 2 },
		response: { sector: 'Energy', signal: 'NEUTRAL' },
	},
	{
		name: 'earnings.getCalendar',
		params: { resource: 'earnings', operation: 'getCalendar', days: 10 },
		tool: 'get_earnings_calendar',
		args: { days: 10 },
		response: { count: 1, earnings: [{ symbol: 'AAPL', date: '2026-11-12' }] },
	},
	{
		name: 'earnings.getIntelligence',
		params: {
			resource: 'earnings',
			operation: 'getIntelligence',
			daysAhead: 7,
			sector: 'Technology',
			minAiScore: 55,
			limit: 15,
		},
		tool: 'get_earnings_intelligence',
		args: { days_ahead: 7, sector: 'Technology', min_ai_score: 55, limit: 15 },
		response: { count: 0, earnings: [] },
	},
	{
		name: 'news.getFeed',
		params: { resource: 'news', operation: 'getFeed', minSignalScore: 70, days: 2, limit: 8 },
		tool: 'get_news_feed',
		args: { min_signal_score: 70, days: 2, limit: 8 },
		response: { count: 0, articles: [] },
	},
	{
		name: 'signal.getMany',
		params: {
			resource: 'signal',
			operation: 'getMany',
			direction: 'LONG',
			source: 'sector_screener',
			minSignalScore: 65,
			limit: 20,
		},
		tool: 'get_signals',
		args: { direction: 'LONG', source: 'sector_screener', min_signal_score: 65, limit: 20 },
		response: { count: 0, signals: [] },
	},
	{
		name: 'watchlist.get',
		params: { resource: 'watchlist', operation: 'get' },
		tool: 'get_watchlist',
		args: {},
		response: { count: 1, items: [{ symbol: 'AAPL' }] },
	},
];

module.exports = { cases, rl };
