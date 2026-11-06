import type { INodeProperties, INodePropertyOptions } from 'n8n-workflow';

/** Stocklake's per-tool reference. Every tool has an anchor named after it. */
export const DOCS_TOOLS_URL = 'https://stocklake.dev/docs/tools';

/** `resource.operation` -> the Stocklake tool it calls. Used for the docs link in each
 * operation's description; test/operations.test.js checks it against ToolMapping so
 * the two cannot drift apart. */
export const OPERATION_TOOLS: Record<string, string> = {
	'stock.get': 'get_stock',
	'stock.getMany': 'get_stocks',
	'stock.getHistory': 'get_stock_history',
	'stock.getNews': 'get_stock_news',
	'stock.getResearch': 'get_stock_research',
	'stock.getIndicatorHistory': 'get_indicator_history',
	'stock.getInsiderActivity': 'get_insider_activity',
	'screener.screen': 'get_screener',
	'market.getPulse': 'get_market_pulse',
	'market.getMovers': 'get_market_movers',
	'market.getAssessment': 'get_market_assessment',
	'sector.getIntelligence': 'get_sector_intelligence',
	'earnings.getCalendar': 'get_earnings_calendar',
	'earnings.getIntelligence': 'get_earnings_intelligence',
	'news.getFeed': 'get_news_feed',
	'signal.getMany': 'get_signals',
	'watchlist.get': 'get_watchlist',
};

/** Appends a link to the tool's reference page to every operation's description. */
export function withDocsLinks(resource: string, operations: INodeProperties): INodeProperties {
	return {
		...operations,
		options: (operations.options as INodePropertyOptions[]).map((option) => {
			const tool = OPERATION_TOOLS[`${resource}.${option.value}`];
			if (!tool) {
				throw new Error(`No Stocklake tool registered for ${resource}.${option.value}`);
			}
			return {
				...option,
				description: `${option.description} Docs: ${DOCS_TOOLS_URL}#${tool}`,
			};
		}),
	};
}

/** The 11-sector GICS-style taxonomy Stocklake's screener, sector and earnings filters
 * use (confirmed against get_stock/get_screener responses; there is no dedicated
 * "list sectors" tool to derive this from dynamically). */
export const SECTOR_OPTIONS: INodePropertyOptions[] = [
	{ name: 'Basic Materials', value: 'Basic Materials' },
	{ name: 'Communication Services', value: 'Communication Services' },
	{ name: 'Consumer Cyclical', value: 'Consumer Cyclical' },
	{ name: 'Consumer Defensive', value: 'Consumer Defensive' },
	{ name: 'Energy', value: 'Energy' },
	{ name: 'Financial Services', value: 'Financial Services' },
	{ name: 'Healthcare', value: 'Healthcare' },
	{ name: 'Industrials', value: 'Industrials' },
	{ name: 'Real Estate', value: 'Real Estate' },
	{ name: 'Technology', value: 'Technology' },
	{ name: 'Utilities', value: 'Utilities' },
];

/** A single-symbol Resource Locator field — "From list" searches Stocklake's public
 * autocomplete (no key needed), "By ticker" accepts a raw symbol directly. */
export function symbolLocatorField(
	displayName: string,
	name: string,
	resource: string,
	operation: string,
	description = 'The stock ticker, e.g. AAPL',
): INodeProperties {
	return {
		displayName,
		name,
		type: 'resourceLocator',
		default: { mode: 'list', value: '' },
		required: true,
		displayOptions: {
			show: {
				resource: [resource],
				operation: [operation],
			},
		},
		modes: [
			{
				displayName: 'From List',
				name: 'list',
				type: 'list',
				placeholder: 'Search stocks…',
				typeOptions: {
					searchListMethod: 'searchSymbols',
					searchable: true,
					searchFilterRequired: true,
				},
			},
			{
				displayName: 'By Ticker',
				name: 'id',
				type: 'string',
				placeholder: 'AAPL',
				validation: [
					{
						type: 'regex',
						properties: {
							regex: '^[A-Za-z0-9.\\-^]{1,15}$',
							errorMessage: 'Not a valid-looking ticker symbol',
						},
					},
				],
			},
		],
		description,
	};
}
