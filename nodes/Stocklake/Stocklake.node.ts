import type {
	IExecuteFunctions,
	IDataObject,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	INodePropertyOptions,
} from 'n8n-workflow';
import { NodeConnectionTypes } from 'n8n-workflow';

import {
	cleanParams,
	parseSymbolList,
	searchSymbols,
	stocklakeApiRequest,
} from './GenericFunctions';
import { earningsFields, earningsOperations } from './descriptions/EarningsDescription';
import { marketFields, marketOperations } from './descriptions/MarketDescription';
import { newsFields, newsOperations } from './descriptions/NewsDescription';
import { screenerFields, screenerOperations } from './descriptions/ScreenerDescription';
import { sectorFields, sectorOperations } from './descriptions/SectorDescription';
import { signalFields, signalOperations } from './descriptions/SignalDescription';
import { stockFields, stockOperations } from './descriptions/StockDescription';
import { watchlistFields, watchlistOperations } from './descriptions/WatchlistDescription';

export class Stocklake implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Stocklake',
		name: 'stocklake',
		icon: { light: 'file:stocklake.svg', dark: 'file:stocklake.dark.svg' },
		group: ['transform'],
		version: 1,
		subtitle: '={{$parameter["resource"] + ": " + $parameter["operation"]}}',
		description:
			'Real-time and historical stock market data — fundamentals, technical indicators, AI research, insider activity, screener, signals, and macro/sector outlook',
		defaults: { name: 'Stocklake' },
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		usableAsTool: true,
		credentials: [
			{
				name: 'stocklakeApi',
				required: false,
				displayOptions: { show: { authentication: ['apiKey'] } },
			},
			{
				name: 'stocklakeOAuth2Api',
				required: true,
				displayOptions: { show: { authentication: ['oAuth2'] } },
			},
		],
		properties: [
			{
				displayName:
					'Sign in with OAuth (no key to copy/paste — recommended), or use an API key. Either way, a key/sign-in is optional for Stock/Screener/Market/Earnings-calendar operations (25 calls/day without one, 200/day once connected free). Every other operation — AI research, insider activity, signals, sector/market intelligence, news feed, watchlist — requires a Pro account.',
				name: 'credentialNotice',
				type: 'notice',
				default: '',
			},
			{
				displayName: 'Authentication',
				name: 'authentication',
				type: 'options',
				noDataExpression: true,
				default: 'apiKey',
				options: [
					{
						name: 'API Key (or None, for Guest Access)',
						value: 'apiKey',
					},
					{
						name: 'OAuth2 (Sign In with Stocklake)',
						value: 'oAuth2',
					},
				],
			},
			{
				displayName: 'Resource',
				name: 'resource',
				type: 'options',
				noDataExpression: true,
				default: 'stock',
				options: [
					{ name: 'Stock', value: 'stock' },
					{ name: 'Screener', value: 'screener' },
					{ name: 'Market', value: 'market' },
					{ name: 'Sector', value: 'sector' },
					{ name: 'Earnings', value: 'earnings' },
					{ name: 'News', value: 'news' },
					{ name: 'Signal', value: 'signal' },
					{ name: 'Watchlist', value: 'watchlist' },
				] as INodePropertyOptions[],
			},
			stockOperations,
			screenerOperations,
			marketOperations,
			sectorOperations,
			earningsOperations,
			newsOperations,
			signalOperations,
			watchlistOperations,
			...stockFields,
			...screenerFields,
			...marketFields,
			...sectorFields,
			...earningsFields,
			...newsFields,
			...signalFields,
			...watchlistFields,
		],
	};

	methods = {
		listSearch: {
			searchSymbols,
		},
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];

		const resource = this.getNodeParameter('resource', 0) as string;
		const operation = this.getNodeParameter('operation', 0) as string;

		for (let i = 0; i < items.length; i++) {
			// stocklakeApiRequest/buildToolCall already throw NodeApiError/NodeOperationError for
			// every real failure, so the not-continueOnFail path deliberately has no catch at all —
			// letting that error propagate as-is, rather than a bare `throw error` that would trip
			// the "always construct a NodeError" verification rule for no behavioral benefit.
			if (!this.continueOnFail()) {
				const { toolName, toolArguments } = buildToolCall.call(this, resource, operation, i);
				const responseData = await stocklakeApiRequest.call(this, toolName, toolArguments, i);
				const executionData = this.helpers.constructExecutionMetaData(
					this.helpers.returnJsonArray(responseData as IDataObject),
					{ itemData: { item: i } },
				);
				returnData.push(...executionData);
				continue;
			}

			try {
				const { toolName, toolArguments } = buildToolCall.call(this, resource, operation, i);
				const responseData = await stocklakeApiRequest.call(this, toolName, toolArguments, i);
				const executionData = this.helpers.constructExecutionMetaData(
					this.helpers.returnJsonArray(responseData as IDataObject),
					{ itemData: { item: i } },
				);
				returnData.push(...executionData);
			} catch (error) {
				returnData.push({
					json: { error: (error as Error).message },
					pairedItem: { item: i },
				});
			}
		}

		return [returnData];
	}
}

/** Resource/operation -> Stocklake MCP tool name + argument mapping. One switch, not
 * seventeen near-identical execute branches, since every operation is "read a few
 * node params, call one tool, return the parsed result" with no cross-tool logic. */
function buildToolCall(
	this: IExecuteFunctions,
	resource: string,
	operation: string,
	i: number,
): { toolName: string; toolArguments: IDataObject } {
	const symbol = (locator: string) =>
		this.getNodeParameter(locator, i, '', { extractValue: true }) as string;

	switch (`${resource}.${operation}`) {
		case 'stock.get':
			return {
				toolName: 'get_stock',
				toolArguments: { symbol: symbol('symbol') },
			};
		case 'stock.getMany':
			return {
				toolName: 'get_stocks',
				toolArguments: {
					symbols: parseSymbolList(this.getNodeParameter('symbols', i, '') as string),
				},
			};
		case 'stock.getHistory':
			return {
				toolName: 'get_stock_history',
				toolArguments: {
					symbol: symbol('symbol'),
					days: this.getNodeParameter('days', i, 90) as number,
				},
			};
		case 'stock.getNews':
			return {
				toolName: 'get_stock_news',
				toolArguments: {
					symbol: symbol('symbol'),
					limit: this.getNodeParameter('limit', i, 10) as number,
					days: this.getNodeParameter('days', i, 30) as number,
				},
			};
		case 'stock.getResearch':
			return {
				toolName: 'get_stock_research',
				toolArguments: { symbol: symbol('symbol') },
			};
		case 'stock.getIndicatorHistory':
			return {
				toolName: 'get_indicator_history',
				toolArguments: {
					symbol: symbol('symbol'),
					days: this.getNodeParameter('days', i, 90) as number,
				},
			};
		case 'stock.getInsiderActivity':
			return {
				toolName: 'get_insider_activity',
				toolArguments: { symbol: symbol('symbol') },
			};

		case 'screener.screen': {
			const additional = this.getNodeParameter('additionalFields', i, {}) as IDataObject;
			return {
				toolName: 'get_screener',
				toolArguments: cleanParams({
					preset: this.getNodeParameter('preset', i, '') as string,
					sector: this.getNodeParameter('sector', i, '') as string,
					limit: this.getNodeParameter('limit', i, 20) as number,
					...additional,
				}),
			};
		}

		case 'market.getPulse':
			return { toolName: 'get_market_pulse', toolArguments: {} };
		case 'market.getMovers':
			return {
				toolName: 'get_market_movers',
				toolArguments: cleanParams({
					category: this.getNodeParameter('category', i, 'all') as string,
					limit: this.getNodeParameter('limit', i, 10) as number,
					min_market_cap_b: (this.getNodeParameter('minMarketCapB', i, 0) as number) || undefined,
				}),
			};
		case 'market.getAssessment':
			return {
				toolName: 'get_market_assessment',
				toolArguments: {
					history_count: this.getNodeParameter('historyCount', i, 0) as number,
				},
			};

		case 'sector.getIntelligence':
			return {
				toolName: 'get_sector_intelligence',
				toolArguments: cleanParams({
					sector: this.getNodeParameter('sector', i, '') as string,
					sort_by_strength: this.getNodeParameter('sortByStrength', i, false) as boolean,
					history_count: this.getNodeParameter('historyCount', i, 0) as number,
				}),
			};

		case 'earnings.getCalendar':
			return {
				toolName: 'get_earnings_calendar',
				toolArguments: { days: this.getNodeParameter('days', i, 7) as number },
			};
		case 'earnings.getIntelligence':
			return {
				toolName: 'get_earnings_intelligence',
				toolArguments: cleanParams({
					days_ahead: this.getNodeParameter('daysAhead', i, 14) as number,
					sector: this.getNodeParameter('sector', i, '') as string,
					min_ai_score: (this.getNodeParameter('minAiScore', i, 0) as number) || undefined,
					limit: this.getNodeParameter('limit', i, 25) as number,
				}),
			};

		case 'news.getFeed':
			return {
				toolName: 'get_news_feed',
				toolArguments: {
					min_signal_score: this.getNodeParameter('minSignalScore', i, 60) as number,
					days: this.getNodeParameter('days', i, 3) as number,
					limit: this.getNodeParameter('limit', i, 10) as number,
				},
			};

		case 'signal.getMany':
			return {
				toolName: 'get_signals',
				toolArguments: cleanParams({
					direction: this.getNodeParameter('direction', i, '') as string,
					source: this.getNodeParameter('source', i, '') as string,
					min_signal_score: this.getNodeParameter('minSignalScore', i, 60) as number,
					limit: this.getNodeParameter('limit', i, 50) as number,
				}),
			};

		case 'watchlist.get':
			return { toolName: 'get_watchlist', toolArguments: {} };

		default:
			throw new Error(`Unknown Stocklake operation: ${resource}.${operation}`);
	}
}
