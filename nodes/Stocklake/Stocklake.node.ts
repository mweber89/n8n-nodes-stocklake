import type {
	IExecuteFunctions,
	IDataObject,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	INodePropertyOptions,
} from 'n8n-workflow';
import { NodeConnectionTypes } from 'n8n-workflow';

import { searchSymbols, stocklakeApiRequest } from './GenericFunctions';
import { buildToolCall } from './ToolMapping';
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
