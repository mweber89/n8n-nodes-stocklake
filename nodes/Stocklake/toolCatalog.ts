/**
 * What an AI Agent sees of each operation (node version 2, Stocklake Tool): a description
 * written for a model, and the few arguments it fills in itself with `$fromAI()`.
 *
 * One table drives three things, so they cannot drift apart:
 *  - the default Tool Description of every operation,
 *  - the `$fromAI()` default of the matching parameters in the Tool (descriptions/ToolDescription.ts),
 *  - the single multi-operation tool ("Toolkit") and its operation filter (toolkit.ts).
 *
 * Wording rules: say what comes back, when to use the operation and what a free key gets;
 * no apostrophes or double quotes in any text that ends up inside a `$fromAI()` call.
 */

/** Resource value of the Toolkit (Stocklake Tool only). */
export const TOOLKIT_RESOURCE = 'toolkit';

export type ArgType = 'string' | 'number';

export interface ToolArg {
	/** Name the agent sees in the tool schema. */
	key: string;
	description: string;
	type: ArgType;
	/** Used when the agent leaves the argument out; makes it optional in the schema.
	 * Without one the argument is required. */
	fallback?: string | number;
}

export interface ToolOperation {
	/** Plain text of the one-line entry in the Toolkit list: what it does and what it needs. */
	summary: string;
	/** Tool Description of a node set to this one operation. */
	description: string;
	/** Node parameter name -> the argument the agent fills in for it. */
	args: Record<string, ToolArg>;
	/** Left out of the Toolkit (needs more than a few arguments). */
	notInToolkit?: boolean;
}

const SYMBOL: ToolArg = {
	key: 'symbol',
	description: 'The stock ticker symbol, for example NVDA or AAPL',
	type: 'string',
};

const SYMBOLS: ToolArg = {
	key: 'symbols',
	description: 'Comma-separated ticker symbols, for example AAPL, MSFT, NVDA',
	type: 'string',
};

function days(description: string, fallback: number): ToolArg {
	return { key: 'days', description, type: 'number', fallback };
}

function limit(description: string, fallback = 10): ToolArg {
	return { key: 'limit', description, type: 'number', fallback };
}

export const TOOL_OPERATIONS: Record<string, ToolOperation> = {
	'stock.get': {
		summary: 'quote, fundamentals and indicators (RSI, MACD, moving averages) of one stock',
		description:
			'Price, fundamentals and technical indicators (RSI, MACD, Bollinger, moving averages) for ONE stock, with quotes delayed about 15 minutes. Use it for any question about a single ticker: its price, valuation, RSI or trend. Works without Pro; a Pro key adds the analyst rating, signals and an AI verdict. Needs the ticker symbol.',
		args: { symbol: SYMBOL },
	},
	'stock.getMany': {
		summary: 'the same data for up to 25 stocks, one row each (use compare to rank them)',
		description:
			'Price, fundamentals and indicators for several stocks in one call (up to 25 tickers), one row per stock. Use it to look up a list of tickers. To rank or compare them use the Compare operation instead. Free. Needs a comma-separated list of tickers.',
		args: { symbols: SYMBOLS },
	},
	'stock.compare': {
		summary: 'compare 2 to 25 stocks side by side and rank them by one column',
		description:
			'Compares 2 to 25 stocks side by side: one row per stock with identical columns (price, day change, market cap, forward P/E, RSI, 52-week position, analyst target upside), optionally ranked. Use it for questions like which of AAPL, MSFT and NVDA is cheapest, most oversold or has the most upside. Free; Pro adds rating and AI score columns. A ticker that does not exist comes back as its own row with an error and does not stop the others.',
		args: {
			symbols: SYMBOLS,
			rankBy: {
				key: 'rank_by',
				description:
					'Column to rank by: peForward (cheapest is lowest), rsi, changePct, marketCap, analystUpside, week52Position, or none to keep the order given',
				type: 'string',
				fallback: 'none',
			},
			rankOrder: {
				key: 'order',
				description:
					'desc ranks the highest value first, asc the lowest first (use asc for cheapest or most oversold)',
				type: 'string',
				fallback: 'desc',
			},
		},
	},
	'stock.snapshot': {
		summary: 'one-stop overview of a stock: quote, indicators, analysts, next earnings, latest filing',
		description:
			'A compact overview of ONE stock: quote, RSI and MACD state, price against the 50 and 200 day averages, analyst view, next earnings date and the latest SEC filing, plus a one-sentence summary. Use it as the first call when asked to tell me about a stock or for a quick overview. Free. Needs the ticker symbol.',
		args: { symbol: SYMBOL },
	},
	'stock.getHistory': {
		summary: 'daily price history (open, high, low, close, volume) of one stock, up to 365 days',
		description:
			'Daily price history (open, high, low, close, volume) of ONE stock, one row per trading day, up to 365 days. Use it for performance over a period, trend or chart data. Free. Needs the ticker symbol and how many days back.',
		args: {
			symbol: SYMBOL,
			days: days('How many days of history to return, 1 to 365', 30),
		},
	},
	'stock.getIndicatorHistory': {
		summary: 'daily history of RSI, MACD, Bollinger and moving averages of one stock (Pro)',
		description:
			'Daily history of the technical indicators of ONE stock together: price, RSI, MACD histogram, Bollinger %B and the 20 and 200 day averages. Use it to see how an indicator developed over time. Requires a Pro key. Needs the ticker symbol and how many days back.',
		args: {
			symbol: SYMBOL,
			days: days('How many days of indicator history to return, 1 to 365', 30),
		},
	},
	'stock.getNews': {
		summary: 'recent news headlines of one stock (Pro adds AI sentiment and summary)',
		description:
			'Recent news about ONE stock, newest first. A free key gets up to 5 plain headlines; Pro gets up to 50 articles with AI sentiment, summary and signal score. Use it for what is going on with a company. For market-wide news use the News Feed operation. Needs the ticker symbol.',
		args: {
			symbol: SYMBOL,
			limit: limit('Maximum number of articles to return'),
			days: days('Only news from this many days back', 14),
		},
	},
	'stock.getResearch': {
		summary: 'full AI research bundle of one stock: summary, risks, news, insiders (Pro)',
		description:
			'The full AI research bundle for ONE stock in one call: summary, key points, risks, news, insider activity and signal context. Use it for a deep dive, a bull and bear case or should I look at this stock. Requires a Pro key. Needs the ticker symbol.',
		args: { symbol: SYMBOL },
	},
	'stock.getInsiderActivity': {
		summary: 'insider buys and sells of one stock (Pro adds AI read and institutions)',
		description:
			'Insider transactions (purchases and sales by executives and directors) for ONE stock. Use it for questions about insider buying or selling. Works without Pro; Pro adds an AI-synthesized read and institutional holders. Needs the ticker symbol.',
		args: { symbol: SYMBOL },
	},
	'stock.getFinancials': {
		summary: 'balance sheet, income statement and cash flow of one stock',
		description:
			'Balance sheet, income statement and cash flow line items for ONE stock (revenue, margins, debt, cash flow). A free key gets the latest fiscal year, Pro up to 5 years and quarterly. Use it for fundamentals questions. Needs the ticker symbol.',
		args: { symbol: SYMBOL },
	},
	'stock.getFilings': {
		summary: 'latest SEC 8-K filings of one stock, newest first',
		description:
			'The latest SEC 8-K filings of ONE stock, newest first, with what each covers. A free key gets the 5 most recent, Pro up to 25 with headline, summary and sentiment. Use it for material company events. Needs the ticker symbol.',
		args: {
			symbol: SYMBOL,
			maxResults: limit('Maximum number of filings to return'),
		},
	},
	'stock.getActivity': {
		summary: 'timeline of news, filings, insider trades, earnings and analyst changes of one stock',
		description:
			'One timeline of recent events for ONE stock: news, SEC filings, insider trades, earnings, analyst changes and screener setups, newest first, up to 90 days. A free key gets dates and titles, Pro the content. Use it for what happened with a stock lately. Needs the ticker symbol.',
		args: {
			symbol: SYMBOL,
			days: days('How many days back to look, 1 to 90', 30),
			maxResults: limit('Maximum number of items to return'),
		},
	},
	'stock.getAnalystTrend': {
		summary: 'daily history of analyst rating, count and price targets of one stock (Pro)',
		description:
			'Daily history of analyst consensus for ONE stock: rating, number of analysts and price targets. Use it to see whether analysts are getting more or less positive. Requires a Pro key. Needs the ticker symbol and how many days back.',
		args: {
			symbol: SYMBOL,
			days: days('How many days of analyst history to return, 1 to 365', 90),
		},
	},
	'screener.screen': {
		summary: 'find stocks by preset (oversold, overbought, momentum) and sector',
		description:
			'Finds stocks that match a ready-made filter: oversold, overbought or momentum (Pro also has high_conviction), optionally within one sector. Returns rows with price, RSI, market cap and more. Use it for which stocks are oversold, or what is overbought in tech. Free except high_conviction.',
		args: {
			preset: {
				key: 'preset',
				description: 'Filter to apply: oversold, overbought, momentum, or leave empty for none',
				type: 'string',
				fallback: '',
			},
			sector: {
				key: 'sector',
				description:
					'Sector to search in, for example Technology, Energy or Healthcare. Leave empty for all sectors',
				type: 'string',
				fallback: '',
			},
			limit: limit('Maximum number of stocks to return, 1 to 25'),
		},
	},
	'market.getPulse': {
		summary: 'market state: VIX, Fear and Greed, breadth, SPY/QQQ/IWM',
		description:
			'The current state of the market: VIX, Fear and Greed, RSI breadth and the SPY, QQQ and IWM index readings. Use it for how is the market doing or is it risk-on or risk-off. Free. Takes no arguments.',
		args: {},
	},
	'market.getMovers': {
		summary: 'top gainers, losers and most active stocks',
		description:
			'The top gainers, top losers and most active stocks of the day. Use it for what is moving today. Free.',
		args: {
			category: {
				key: 'category',
				description: 'gainers, losers, most_active, or all for the three lists',
				type: 'string',
				fallback: 'all',
			},
			limit: limit('Maximum number of stocks per list'),
		},
	},
	'market.getAssessment': {
		summary: 'AI macro regime and market outlook (Pro)',
		description:
			'The AI assessment of the macro regime and the market outlook in one call. Use it for the big picture and how the market is positioned. Requires a Pro key. Takes no arguments.',
		args: {},
	},
	'market.getEconomicCalendar': {
		summary: 'upcoming and recent economic events (rates, CPI, GDP, payrolls)',
		description:
			'Upcoming and recently released economic events such as rate decisions, CPI, GDP and payrolls. A free key sees 1 day ahead and 2 back, Pro up to 14 ahead and 7 back. Use it for what is on the economic calendar.',
		args: {
			days: days('How many days ahead to look for events, 0 for the plan default', 0),
			maxResults: limit('Maximum number of events per group', 20),
		},
	},
	'sector.getIntelligence': {
		summary: 'AI view of sector strength and rotation, one sector or all 11 (Pro)',
		description:
			'AI-assessed sector signal, cycle stage and rotation guidance for one sector or all 11. Use it for which sectors are strong or weak. Requires a Pro key.',
		args: {
			sector: {
				key: 'sector',
				description:
					'One sector, for example Technology or Energy. Leave empty for all 11 sectors',
				type: 'string',
				fallback: '',
			},
		},
	},
	'earnings.getCalendar': {
		summary: 'upcoming earnings dates in the next days',
		description:
			'Upcoming earnings dates of tracked stocks in the next days. A free key gets the 5 largest companies, Pro all of them. Use it for who reports earnings this week. Free.',
		args: {
			days: days('How many days ahead to look, 1 to 30', 7),
			limit: limit('Maximum number of companies to return', 20),
		},
	},
	'earnings.getIntelligence': {
		summary: 'upcoming earnings with AI verdicts and risks (Pro)',
		description:
			'Upcoming earnings with an AI verdict, risk factors and AI score per company. Use it to judge which reports to be careful about. Requires a Pro key.',
		args: {
			daysAhead: days('How many days ahead to look, 1 to 30', 14),
			sector: {
				key: 'sector',
				description: 'Only this sector, for example Technology. Leave empty for all',
				type: 'string',
				fallback: '',
			},
			limit: limit('Maximum number of companies to return', 15),
		},
	},
	'news.getFeed': {
		summary: 'market-wide feed of the top AI-flagged news (Pro)',
		description:
			'The top AI-flagged news across every tracked stock: a market-wide briefing, not per stock. For one stock use the Get News operation. Requires a Pro key.',
		args: {
			days: days('How many days back to look, 1 to 7', 3),
			limit: limit('Maximum number of articles to return'),
		},
	},
	'signal.getMany': {
		summary: 'AI-screened stock ideas from the pipeline (Pro)',
		description:
			'Stock ideas recently surfaced by Stocklake from news, sector screening and sentiment, each with a direction and score. Use it for what ideas are there right now. Requires a Pro key.',
		args: { limit: limit('Maximum number of ideas to return') },
	},
	'watchlist.get': {
		summary: 'the Stocklake watchlist of the caller with price, RSI, AI verdict (Pro)',
		description:
			'The watchlist of the Stocklake account with latest price, RSI and AI verdict per stock. Read-only. Use it for how is my watchlist doing. Requires a Pro key. Takes no arguments.',
		args: {},
	},
	'portfolio.checkHoldings': {
		summary: 'check one holding: value, profit or loss, RSI and earnings flags',
		description:
			'Checks ONE holding you describe: current value, day change, profit or loss against cost and flags (overbought or oversold RSI, earnings soon). Use it for how is my position in a stock doing. Free. Needs the ticker, the number of shares and the cost per share.',
		args: {
			holdingSymbol: SYMBOL,
			holdingQuantity: {
				key: 'quantity',
				description: 'The number of shares held',
				type: 'number',
			},
			holdingCost: {
				key: 'cost',
				description: 'The price paid per share, or 0 if not known',
				type: 'number',
				fallback: 0,
			},
		},
		notInToolkit: true,
	},
};

/** The operations the Toolkit can offer, in the order of the list. */
export const TOOLKIT_OPERATIONS: string[] = Object.keys(TOOL_OPERATIONS).filter(
	(key) => !TOOL_OPERATIONS[key].notInToolkit,
);

/** Switched on in a new Toolkit: every operation that works without Pro. */
export const TOOLKIT_DEFAULT_OPERATIONS: string[] = [
	'stock.get',
	'stock.snapshot',
	'stock.compare',
	'stock.getMany',
	'stock.getHistory',
	'stock.getNews',
	'stock.getInsiderActivity',
	'stock.getFinancials',
	'stock.getFilings',
	'stock.getActivity',
	'screener.screen',
	'market.getPulse',
	'market.getMovers',
	'market.getEconomicCalendar',
	'earnings.getCalendar',
];

/** The arguments of the Toolkit tool, by the name the agent sees. One shared set for all
 * operations, so each description is general and each argument is optional in the
 * schema (empty text or 0 mean: not given). The operation says which ones it needs, and
 * leaving one out gives that operation its own default (see TOOL_OPERATIONS). */
export const TOOLKIT_ARGS: ToolArg[] = [
	{
		key: 'symbol',
		description:
			'Ticker symbol for the operations that take ONE stock (the stock.* operations such as stock.get), for example NVDA',
		type: 'string',
		fallback: '',
	},
	{
		key: 'symbols',
		description:
			'Comma-separated ticker symbols for stock.compare (2 to 25) and stock.getMany, for example AAPL, MSFT, NVDA',
		type: 'string',
		fallback: '',
	},
	{
		key: 'days',
		description:
			'Number of days for the operations that take a period (history, news, activity, earnings.getCalendar, market.getEconomicCalendar). 0 or left out uses the default of the operation',
		type: 'number',
		fallback: 0,
	},
	{
		key: 'limit',
		description:
			'Maximum number of rows for the operations that return a list. 0 or left out uses the default of the operation',
		type: 'number',
		fallback: 0,
	},
	{
		key: 'preset',
		description: 'For screener.screen: oversold, overbought or momentum',
		type: 'string',
		fallback: '',
	},
	{
		key: 'sector',
		description:
			'For screener.screen: only this sector, for example Technology, Energy or Healthcare',
		type: 'string',
		fallback: '',
	},
	{
		key: 'category',
		description: 'For market.getMovers: gainers, losers, most_active or all',
		type: 'string',
		fallback: '',
	},
	{
		key: 'rank_by',
		description:
			'For stock.compare: the column to rank by (peForward, rsi, changePct, marketCap, analystUpside or week52Position)',
		type: 'string',
		fallback: '',
	},
	{
		key: 'order',
		description:
			'For stock.compare with rank_by: desc puts the highest value first, asc the lowest first (asc for cheapest or most oversold)',
		type: 'string',
		fallback: '',
	},
];

/** `$fromAI()` call for one argument. */
export function fromAI(arg: ToolArg, defaultValue = arg.fallback): string {
	const parts = [`'${arg.key}'`, `'${arg.description}'`, `'${arg.type}'`];
	if (defaultValue !== undefined) {
		parts.push(typeof defaultValue === 'number' ? String(defaultValue) : `'${defaultValue}'`);
	}
	return `={{ $fromAI(${parts.join(', ')}) }}`;
}

/** Accepts stock.get, Stock.Get, stock_get or "stock: get" for the operation id stock.get. */
export function matchOperation(input: unknown, among: string[]): string | undefined {
	const squash = (text: string) => text.toLowerCase().replace(/[^a-z0-9]/g, '');
	const wanted = squash(String(input ?? ''));
	if (!wanted) return undefined;
	return among.find((key) => squash(key) === wanted);
}
