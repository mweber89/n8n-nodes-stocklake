import type { INodeProperties, INodePropertyOptions } from 'n8n-workflow';

import { symbolLocatorField } from './shared';
import { inputOption, manualOption, sourceFields } from './SymbolSource';

/**
 * Operations that combine several calls and shape the result inside n8n (node version 2):
 * Stock > Compare, Stock > Snapshot and Portfolio > Check Holdings. Their rules are in
 * composites.ts, their execution in executeComposite.ts.
 */

export const compareOperation: INodePropertyOptions = {
	name: 'Compare',
	value: 'compare',
	description:
		'Two to 25 stocks side by side, one item per stock with the same columns: price, change, market cap, P/E, RSI, 52-week position and analyst view (Pro adds rating and AI score), optionally ranked (free)',
	action: 'Compare stocks',
};

export const snapshotOperation: INodePropertyOptions = {
	name: 'Snapshot',
	value: 'snapshot',
	description:
		'A compact summary of one stock for people and AI agents: quote, key indicators, analyst view, next earnings and the latest filing headline, with a sentence that says it all (free)',
	action: 'Get a stock snapshot',
};

export const portfolioResource: INodePropertyOptions = {
	name: 'Portfolio',
	value: 'portfolio',
};

export const portfolioOperations: INodeProperties = {
	displayName: 'Operation',
	name: 'operation',
	type: 'options',
	noDataExpression: true,
	displayOptions: { show: { resource: ['portfolio'] } },
	default: 'checkHoldings',
	options: [
		{
			name: 'Check Holdings',
			value: 'checkHoldings',
			description:
				'Value, day change, profit or loss against cost, weight and flags (overbought or oversold RSI, earnings soon, large insider sale) for every holding in the input items, plus one summary item (free; the insider flag needs Pro)',
			action: 'Check holdings',
		},
	],
};

const compareNotice =
	'Compare takes 2 to 25 tickers and reads them in one request. Each ticker counts as one call toward your daily limit. A ticker Stocklake does not know does not stop the others: it comes back as an item with an error.';

const rankOptions: INodePropertyOptions[] = [
	{ name: 'AI Score (Pro)', value: 'aiScore' },
	{ name: 'Analyst Upside', value: 'analystUpside' },
	{ name: 'Change %', value: 'changePct' },
	{ name: 'Forward P/E', value: 'peForward' },
	{ name: 'Market Cap', value: 'marketCap' },
	{ name: 'None (Keep My Order)', value: 'none' },
	{ name: 'Rating Score (Pro)', value: 'ratingScore' },
	{ name: 'RSI', value: 'rsi' },
	{ name: '52-Week Position', value: 'week52Position' },
];

export const compareFields: INodeProperties[] = [
	...sourceFields('stock', 'compare', [inputOption, manualOption], 'manual', compareNotice),
	{
		displayName: 'Symbols',
		name: 'symbols',
		type: 'string',
		default: '',
		required: true,
		placeholder: 'AAPL, MSFT, NVDA',
		description: 'Comma-separated tickers, 2 to 25',
		displayOptions: { show: { resource: ['stock'], operation: ['compare'], symbolSource: ['manual'] } },
	},
	{
		displayName: 'Rank By',
		name: 'rankBy',
		type: 'options',
		default: 'none',
		options: rankOptions,
		description:
			'Sort the stocks by this column and add a rank field (1 is first; stocks without a value come last with rank null)',
		displayOptions: { show: { resource: ['stock'], operation: ['compare'] } },
	},
	{
		displayName: 'Order',
		name: 'rankOrder',
		type: 'options',
		default: 'desc',
		options: [
			{ name: 'Highest First', value: 'desc' },
			{ name: 'Lowest First', value: 'asc' },
		],
		description: 'Which end of the ranking comes first',
		displayOptions: {
			show: { resource: ['stock'], operation: ['compare'] },
			hide: { rankBy: ['none'] },
		},
	},
];

export const snapshotFields: INodeProperties[] = [
	symbolLocatorField('Symbol', 'symbol', 'stock', 'snapshot'),
];

export const holdingsFields: INodeProperties[] = [
	{
		displayName:
			'Send one input item per holding. Each stock counts as one call toward your daily limit; on Pro, checking insider sales adds one more per holding. Holdings in several currencies are valued in their own currency and totalled per currency.',
		name: 'holdingsNotice',
		type: 'notice',
		default: '',
		displayOptions: { show: { resource: ['portfolio'], operation: ['checkHoldings'] } },
	},
	{
		displayName: 'Symbol',
		name: 'holdingSymbol',
		type: 'string',
		default: '={{ $json.symbol }}',
		required: true,
		placeholder: '{{ $json.symbol }}',
		description: 'The ticker of the holding, as an expression for each input item',
		displayOptions: { show: { resource: ['portfolio'], operation: ['checkHoldings'] } },
	},
	{
		displayName: 'Quantity',
		name: 'holdingQuantity',
		type: 'string',
		default: '={{ $json.quantity }}',
		required: true,
		placeholder: '{{ $json.quantity }}',
		description:
			'The number of shares, as an expression for each input item. Items with the same ticker are added up as lots of one holding.',
		displayOptions: { show: { resource: ['portfolio'], operation: ['checkHoldings'] } },
	},
	{
		displayName: 'Cost',
		name: 'holdingCost',
		type: 'string',
		default: '={{ $json.cost }}',
		placeholder: '{{ $json.cost }}',
		description:
			'What the shares cost, per share unless Options say it is the total. Leave empty for no profit or loss.',
		displayOptions: { show: { resource: ['portfolio'], operation: ['checkHoldings'] } },
	},
	{
		displayName: 'Options',
		name: 'holdingOptions',
		type: 'collection',
		placeholder: 'Add Option',
		default: {},
		displayOptions: { show: { resource: ['portfolio'], operation: ['checkHoldings'] } },
		options: [
			{
				displayName: 'Check Insider Sales',
				name: 'checkInsiderSales',
				type: 'boolean',
				default: true,
				description:
					'Whether to flag a holding whose insiders sold a large amount in the last 30 days. Needs Pro and costs one call per holding.',
			},
			{
				displayName: 'Cost Is',
				name: 'costIs',
				type: 'options',
				default: 'perShare',
				options: [
					{ name: 'Per Share', value: 'perShare' },
					{ name: 'Total for the Position', value: 'total' },
				],
				description: 'Whether the Cost field is the price paid per share or the total paid',
			},
			{
				displayName: 'Earnings Within Days',
				name: 'earningsWithinDays',
				type: 'number',
				typeOptions: { minValue: 1, maxValue: 30 },
				default: 7,
				description: 'Flag a holding that reports earnings within this many days (max 30)',
			},
			{
				displayName: 'Insider Sale From (USD)',
				name: 'insiderSaleUsd',
				type: 'number',
				typeOptions: { minValue: 0 },
				default: 1000000,
				description: 'Total value of insider sales in 30 days from which a holding is flagged',
			},
			{
				displayName: 'Output',
				name: 'output',
				type: 'options',
				default: 'both',
				options: [
					{ name: 'Holdings and Summary', value: 'both' },
					{ name: 'Holdings Only', value: 'holdings' },
					{ name: 'Summary Only', value: 'summary' },
				],
				description: 'Which items to return',
			},
			{
				displayName: 'Overbought RSI From',
				name: 'overboughtAbove',
				type: 'number',
				typeOptions: { minValue: 50, maxValue: 100 },
				default: 70,
				description: 'RSI at or above this flags a holding as overbought',
			},
			{
				displayName: 'Oversold RSI Up To',
				name: 'oversoldBelow',
				type: 'number',
				typeOptions: { minValue: 0, maxValue: 50 },
				default: 30,
				description: 'RSI at or below this flags a holding as oversold',
			},
		],
	},
];
