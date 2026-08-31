import type { INodeProperties } from 'n8n-workflow';
import { SECTOR_OPTIONS } from './shared';

export const screenerOperations: INodeProperties = {
	displayName: 'Operation',
	name: 'operation',
	type: 'options',
	noDataExpression: true,
	displayOptions: { show: { resource: ['screener'] } },
	default: 'screen',
	options: [
		{
			name: 'Screen Stocks',
			value: 'screen',
			description:
				'Filter and rank the Stocklake universe by fundamentals, technicals and (Pro) AI signals',
			action: 'Screen stocks',
		},
	],
};

export const screenerFields: INodeProperties[] = [
	{
		displayName: 'Preset',
		name: 'preset',
		type: 'options',
		default: '',
		options: [
			{ name: 'None (Use Filters Below)', value: '' },
			{ name: 'Oversold', value: 'oversold' },
			{ name: 'Overbought', value: 'overbought' },
			{ name: 'Momentum', value: 'momentum' },
			{ name: 'High Conviction (Pro)', value: 'high_conviction' },
		],
		description:
			'A ready-made filter combination. High Conviction requires Pro and defaults sort to AI score unless overridden below.',
		displayOptions: { show: { resource: ['screener'], operation: ['screen'] } },
	},
	{
		displayName: 'Sector',
		name: 'sector',
		type: 'options',
		default: '',
		options: [{ name: 'Any', value: '' }, ...SECTOR_OPTIONS],
		displayOptions: { show: { resource: ['screener'], operation: ['screen'] } },
	},
	{
		displayName: 'Limit',
		name: 'limit',
		type: 'number',
		default: 20,
		typeOptions: { minValue: 1, maxValue: 25 },
		description:
			'Max results (1-25). Each returned stock counts as one call toward the daily limit.',
		displayOptions: { show: { resource: ['screener'], operation: ['screen'] } },
	},
	{
		displayName: 'Additional Fields',
		name: 'additionalFields',
		type: 'collection',
		placeholder: 'Add Field',
		default: {},
		displayOptions: { show: { resource: ['screener'], operation: ['screen'] } },
		options: [
			{
				displayName: 'Country',
				name: 'country',
				type: 'string',
				default: '',
				description: 'e.g. United States, Germany, Japan',
			},
			{
				displayName: 'Min RSI',
				name: 'minRsi',
				type: 'number',
				default: 0,
				typeOptions: { minValue: 0, maxValue: 100 },
			},
			{
				displayName: 'Max RSI',
				name: 'maxRsi',
				type: 'number',
				default: 100,
				typeOptions: { minValue: 0, maxValue: 100 },
			},
			{
				displayName: 'SMA Trend',
				name: 'smaTrend',
				type: 'options',
				default: '',
				options: [
					{ name: 'Any', value: '' },
					{ name: 'Above 200-Day SMA', value: 'above_200' },
					{ name: 'Below 200-Day SMA', value: 'below_200' },
				],
			},
			{
				displayName: 'MACD Signal',
				name: 'macdSignal',
				type: 'options',
				default: '',
				options: [
					{ name: 'Any', value: '' },
					{ name: 'Positive', value: 'positive' },
					{ name: 'Negative', value: 'negative' },
				],
			},
			{
				displayName: 'Min 1-Day Perf (%)',
				name: 'minPerf1d',
				type: 'number',
				default: 0,
			},
			{
				displayName: 'Max 1-Day Perf (%)',
				name: 'maxPerf1d',
				type: 'number',
				default: 0,
			},
			{
				displayName: 'Min Volume',
				name: 'minVolume',
				type: 'number',
				default: 0,
				typeOptions: { minValue: 0 },
			},
			{
				displayName: 'Min Market Cap ($B)',
				name: 'minMarketCapB',
				type: 'number',
				default: 0,
				typeOptions: { minValue: 0 },
			},
			{
				displayName: 'Max Market Cap ($B)',
				name: 'maxMarketCapB',
				type: 'number',
				default: 0,
				typeOptions: { minValue: 0 },
			},
			{
				displayName: 'Max Forward P/E',
				name: 'maxPeForward',
				type: 'number',
				default: 0,
				typeOptions: { minValue: 0 },
			},
			{
				displayName: 'Analyst Rating',
				name: 'analystRating',
				type: 'options',
				default: '',
				options: [
					{ name: 'Any', value: '' },
					{ name: 'Strong Buy', value: 'strong_buy' },
					{ name: 'Buy', value: 'buy' },
					{ name: 'Hold', value: 'hold' },
					{ name: 'Sell', value: 'sell' },
					{ name: 'Strong Sell', value: 'strong_sell' },
				],
			},
			{
				displayName: 'Min AI Score (Pro)',
				name: 'minAiScore',
				type: 'number',
				default: 0,
				typeOptions: { minValue: 0, maxValue: 100 },
				description: '0-100. Ignored on free/guest.',
			},
			{
				displayName: 'Sort By',
				name: 'sortBy',
				type: 'options',
				default: 'market_cap',
				options: [
					{ name: 'Market Cap', value: 'market_cap' },
					{ name: 'RSI', value: 'rsi' },
					{ name: '1-Day Performance', value: 'perf_1d' },
					{ name: 'Volume', value: 'volume' },
					{ name: 'Analyst Rating', value: 'analyst_rating' },
					{ name: 'Rating (Pro)', value: 'rating' },
					{ name: 'AI Score (Pro)', value: 'ai_score' },
				],
				description: 'Rating/AI Score sort silently falls back to Market Cap on free/guest',
			},
			{
				displayName: 'Sort Direction',
				name: 'sortDir',
				type: 'options',
				default: 'desc',
				options: [
					{ name: 'Descending', value: 'desc' },
					{ name: 'Ascending', value: 'asc' },
				],
			},
		],
	},
];
