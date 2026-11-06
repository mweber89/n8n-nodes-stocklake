'use strict';

/**
 * Responses shaped like the real Stocklake API's (trimmed to a few rows and fields,
 * keeping the real top-level keys). One per list-shaped operation.
 */
const rl = (value) => ({ __rl: true, mode: 'id', value });

const stockRow = (symbol, extra = {}) => ({
	symbol,
	name: `${symbol} Inc.`,
	sector: 'Technology',
	industry: 'Software',
	price: 100,
	change_pct: 1.5,
	volume: 1000,
	market_cap_usd: 5e9,
	currency: 'USD',
	pe_forward: 20,
	rsi: 45,
	analyst_rating: 'buy',
	ai_verdict: 'NEUTRAL',
	ai_headline: 'A long headline that Simplify drops',
	ai_score: 55,
	ai_score_band: 'Moderate',
	...extra,
});

const responses = {
	'screener.screen': {
		params: { resource: 'screener', operation: 'screen', preset: 'oversold' },
		tool: 'get_screener',
		response: {
			count: 2,
			preset: 'oversold',
			filters: { max_rsi: 30 },
			results: [stockRow('AMD'), stockRow('INTC')],
		},
		rowCount: 2,
	},
	'stock.getMany': {
		params: { resource: 'stock', operation: 'getMany', symbols: 'AAPL, MSFT' },
		tool: 'get_stocks',
		response: {
			count: 2,
			requested: 2,
			missing: [],
			duplicates_collapsed: 0,
			symbols: {
				AAPL: stockRow('AAPL', { indicators: { rsi: 61.2, macd: { signal: 'positive' } }, officers: [{ name: 'A' }] }),
				MSFT: stockRow('MSFT', { indicators: { rsi: 40.1 } }),
			},
		},
		rowCount: 2,
	},
	'stock.getHistory': {
		params: { resource: 'stock', operation: 'getHistory', symbol: rl('AAPL') },
		tool: 'get_stock_history',
		response: {
			symbol: 'AAPL',
			days_requested: 90,
			days_returned: 3,
			count: 3,
			history_available: { bars: 5000, earliest_date: '2006-01-03' },
			history: [
				{ date: '2026-11-03', open: 1, high: 2, low: 0.5, close: 1.5, volume: 10 },
				{ date: '2026-11-04', open: 1.5, high: 2, low: 1, close: 1.8, volume: 11 },
				{ date: '2026-11-05', open: 1.8, high: 2.2, low: 1.7, close: 2, volume: 12 },
			],
		},
		rowCount: 3,
	},
	'stock.getIndicatorHistory': {
		params: { resource: 'stock', operation: 'getIndicatorHistory', symbol: rl('MSFT') },
		tool: 'get_indicator_history',
		response: {
			symbol: 'MSFT',
			days: 90,
			full: false,
			count: 2,
			snapshots: [
				{ recorded_at: '2026-11-04', price: 400, rsi: 50, macd_histogram: 0.4, bb_pct: 60, sma20: 399, sma200: 380 },
				{ recorded_at: '2026-11-05', price: 405, rsi: 52, macd_histogram: 0.5, bb_pct: 65, sma20: 400, sma200: 381 },
			],
		},
		rowCount: 2,
	},
	'stock.getNews': {
		params: { resource: 'stock', operation: 'getNews', symbol: rl('NVDA') },
		tool: 'get_stock_news',
		response: {
			symbol: 'NVDA',
			count: 2,
			status: 'ok',
			days: 30,
			articles: [
				{ title: 'One', published_at: '2026-11-05T20:23:00+00:00', ai_sentiment: 'NEGATIVE', ai_summary: 's1', signal_score: 35, signal_score_band: 'Weak', extra_field: 'x' },
				{ title: 'Two', published_at: '2026-11-04T10:00:00+00:00', ai_sentiment: 'POSITIVE', ai_summary: 's2', signal_score: 70, signal_score_band: 'Strong', extra_field: 'y' },
			],
		},
		rowCount: 2,
	},
	'stock.getFilings': {
		params: { resource: 'stock', operation: 'getFilings', symbol: rl('AAPL') },
		tool: 'get_stock_filings',
		response: {
			symbol: 'AAPL',
			count: 1,
			limit: 10,
			status: 'ok',
			items_note: 'Free returns the 5 most recent filings',
			items: [
				{ accession: '0000320193-26-000024', symbol: 'AAPL', company: 'Apple Inc.', filed_at: '2026-11-02T16:30:23-05:00', date: 'Nov 2, 2026', time: '16:30 ET', date_et: '2026-11-02', session: 'After close', title: 'Apple: earnings results (SEC 8-K)', items: ['Results of operations'], sec_url: 'https://www.sec.gov/x', relevance: 90, summary: 'sum', headline: 'head', sentiment: 'Positive' },
			],
		},
		rowCount: 1,
	},
	'stock.getAnalystTrend': {
		params: { resource: 'stock', operation: 'getAnalystTrend', symbol: rl('AAPL') },
		tool: 'get_analyst_trend',
		response: {
			symbol: 'AAPL',
			days: 90,
			count: 2,
			snapshots: [
				{ date: '2026-08-10', analyst_rating: 'buy', analyst_rating_score: 2.08, analyst_count: 41, analyst_target: 322.8, analyst_target_high: 400, analyst_target_low: 215, analyst_target_median: 330, price: 307.85 },
				{ date: '2026-08-11', analyst_rating: 'buy', analyst_rating_score: 2.07, analyst_count: 41, analyst_target: 323.1, analyst_target_high: 400, analyst_target_low: 215, analyst_target_median: 330, price: 309 },
			],
		},
		rowCount: 2,
	},
	'stock.getActivity': {
		params: { resource: 'stock', operation: 'getActivity', symbol: rl('NVDA') },
		tool: 'get_stock_activity',
		response: {
			symbol: 'NVDA',
			days: 90,
			count: 2,
			total: 2,
			page: 1,
			pages: 1,
			limit: 25,
			status: 'ok',
			counts: { news: 1, earnings: 1 },
			items: [
				{ id: 'news:1', type: 'news', symbol: 'NVDA', timestamp: '2026-11-05T20:23:00+00:00', headline: 'H1', tone: 'Negative', number: 35, number_label: 'Score', summary: 's', extra: { url: 'u' } },
				{ id: 'news:2', type: 'news', symbol: 'NVDA', timestamp: '2026-11-04T20:23:00+00:00', headline: 'H2', tone: 'Positive', number: 60, number_label: 'Score', summary: 's2', extra: { url: 'u2' } },
			],
			upcoming: [
				{ id: 'earnings:1', type: 'earnings', symbol: 'NVDA', timestamp: '2026-11-17T00:00:00+00:00', headline: 'Earnings on Nov 17, 2026', summary: 'e', extra: { upcoming: true } },
			],
		},
		rowCount: 3,
	},
	'market.getMovers': {
		params: { resource: 'market', operation: 'getMovers', category: 'all' },
		tool: 'get_market_movers',
		response: {
			category: 'all',
			limit_per_category: 10,
			gainers: [stockRow('UP1'), stockRow('UP2')],
			losers: [stockRow('DN1')],
			most_active: [stockRow('MA1')],
		},
		rowCount: 4,
	},
	'market.getEconomicCalendar': {
		params: { resource: 'market', operation: 'getEconomicCalendar' },
		tool: 'get_economic_calendar',
		response: {
			window_days: 1,
			lookback_days: 2,
			today: '2026-11-06',
			released_total: 1,
			upcoming_total: 2,
			truncated_note: 'n',
			released_recent: [
				{ actual: '54.5', consensus: null, country: 'United States', date: '2026-11-04', event: 'ISM N-Mfg PMI', previous: '54.9', time: '15:00 UTC', diff: '-0.4', key_event: false },
			],
			upcoming: [
				{ actual: null, consensus: null, country: 'Euro Area', date: '2026-11-06', event: 'Retail Sales YY', previous: '0.8', time: '10:00 UTC', key_event: false },
				{ actual: null, consensus: null, country: 'United States', date: '2026-11-06', event: 'Non-Farm Payrolls', previous: '29', time: '13:30 UTC', key_event: true },
			],
		},
		rowCount: 3,
	},
	'earnings.getCalendar': {
		params: { resource: 'earnings', operation: 'getCalendar' },
		tool: 'get_earnings_calendar',
		response: {
			window_days: 7,
			from_date: '2026-11-06',
			to_date: '2026-11-13',
			count: 2,
			total_in_window: 2,
			offset: 0,
			next_offset: null,
			results: [
				{ symbol: '8031.T', name: 'MITSUI', sector: 'Industrials', market_cap: 1.3e13, price: 4633, rsi: 53.7, earnings_date: '2026-11-06T01:00:00+00:00', is_estimate: true, eps_trailing: 346, eps_forward: 293 },
				{ symbol: 'AMS.MC', name: 'AMADEUS', sector: 'Technology', market_cap: 2.4e10, price: 59.5, rsi: 66, earnings_date: '2026-11-06T12:00:00+00:00', is_estimate: false, eps_trailing: 3, eps_forward: 3.9 },
			],
		},
		rowCount: 2,
	},
	'earnings.getIntelligence': {
		params: { resource: 'earnings', operation: 'getIntelligence' },
		tool: 'get_earnings_intelligence',
		response: {
			count: 1,
			days_ahead: 14,
			from_date: '2026-11-06',
			to_date: '2026-11-20',
			results: [
				{ symbol: 'AMS.MC', name: 'AMADEUS', sector: 'Technology', price: 59.5, rsi: 66, market_cap: 2.4e10, earnings_date: '2026-11-06T12:00:00+00:00', is_estimate: false, eps_trailing: 3, eps_forward: 3.9, ai_verdict: 'POSITIVE', ai_score: 61, ai_score_band: 'Moderate', ai_risks: ['r1', 'r2'], analyst_rating: 'buy', analyst_target: 70 },
			],
		},
		rowCount: 1,
	},
	'news.getFeed': {
		params: { resource: 'news', operation: 'getFeed' },
		tool: 'get_news_feed',
		response: {
			count: 1,
			days: 3,
			min_signal_score: 60,
			articles: [
				{ symbol: 'CVI', title: 'CVR acquires refineries', published_at: '2026-11-05T17:45:00+00:00', ai_sentiment: 'POSITIVE', ai_summary: 's', signal_score: 80, signal_score_band: 'Very Strong' },
			],
		},
		rowCount: 1,
	},
	'signal.getMany': {
		params: { resource: 'signal', operation: 'getMany' },
		tool: 'get_signals',
		response: {
			count: 2,
			filters: { min_signal_score: 60 },
			window: '14d',
			signals: [
				{ symbol: 'ABC', direction: 'POSITIVE', signal_score: 81, signal_score_band: 'Very Strong', source: 'sector', sources: ['sector', 'news'], rationale: 'r', expires: '2026-11-08', flagged_at: '2026-11-05' },
				{ symbol: 'XYZ', direction: 'NEGATIVE', signal_score: 66, signal_score_band: 'Strong', source: 'news', sources: ['news'], rationale: 'r2', expires: '2026-11-08', flagged_at: '2026-11-04' },
			],
		},
		rowCount: 2,
	},
	'watchlist.get': {
		params: { resource: 'watchlist', operation: 'get' },
		tool: 'get_watchlist',
		response: {
			count: 1,
			items: [
				{ symbol: 'RKLB', name: 'Rocket Lab', sector: 'Industrials', price: 48.5, change_pct: 5.5, rsi: 31.6, market_cap: 2.9e10, analyst_rating: 'buy', added_at: '2026-07-25T15:13:25+00:00', price_at_add: 63.9, ai_verdict: 'NEGATIVE', ai_headline: 'long', ai_score: 44, ai_score_band: 'Weak', atr_pct: 8.9 },
			],
		},
		rowCount: 1,
	},
};

module.exports = { responses, rl, stockRow };
