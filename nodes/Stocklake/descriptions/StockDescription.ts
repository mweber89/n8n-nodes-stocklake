import type { INodeProperties } from 'n8n-workflow';
import { symbolLocatorField } from './shared';

export const stockOperations: INodeProperties = {
	displayName: 'Operation',
	name: 'operation',
	type: 'options',
	noDataExpression: true,
	displayOptions: { show: { resource: ['stock'] } },
	default: 'get',
	options: [
		{
			name: 'Get',
			value: 'get',
			description:
				'Price, fundamentals and technical indicators for one stock (free — Pro unlocks rating, signals breakdown, relative strength and AI verdict on the same call)',
			action: 'Get a stock',
		},
		{
			name: 'Get History',
			value: 'getHistory',
			description: 'Daily OHLCV price history, up to 365 days (free)',
			action: 'Get stock history',
		},
		{
			name: 'Get Indicator History',
			value: 'getIndicatorHistory',
			description: 'Historical daily snapshot of every technical indicator together (requires Pro)',
			action: 'Get stock indicator history',
		},
		{
			name: 'Get Insider Activity',
			value: 'getInsiderActivity',
			description: 'AI-synthesized insider and institutional sentiment (requires Pro)',
			action: 'Get stock insider activity',
		},
		{
			name: 'Get Many',
			value: 'getMany',
			description: 'Batch stock data for up to 25 symbols in one call (free)',
			action: 'Get many stocks',
		},
		{
			name: 'Get News',
			value: 'getNews',
			description:
				'Recent news for one stock (free tier: up to 5 plain headlines; Pro: up to 50 articles with AI sentiment/summary/signal score)',
			action: 'Get stock news',
		},
		{
			name: 'Get Research',
			value: 'getResearch',
			description:
				'Full AI research bundle for one stock — summary, key points, risks, news, insider and signal context in a single call (requires Pro)',
			action: 'Get stock research',
		},
	],
};

export const stockFields: INodeProperties[] = [
	symbolLocatorField('Symbol', 'symbol', 'stock', 'get'),
	symbolLocatorField('Symbol', 'symbol', 'stock', 'getHistory'),
	symbolLocatorField('Symbol', 'symbol', 'stock', 'getNews'),
	symbolLocatorField('Symbol', 'symbol', 'stock', 'getResearch'),
	symbolLocatorField('Symbol', 'symbol', 'stock', 'getIndicatorHistory'),
	symbolLocatorField('Symbol', 'symbol', 'stock', 'getInsiderActivity'),
	{
		displayName: 'Symbols',
		name: 'symbols',
		type: 'string',
		default: '',
		required: true,
		placeholder: 'AAPL, MSFT, NVDA',
		description:
			'Comma-separated tickers, up to 25. Each symbol counts as one call toward the daily limit.',
		displayOptions: { show: { resource: ['stock'], operation: ['getMany'] } },
	},
	{
		displayName: 'Days',
		name: 'days',
		type: 'number',
		default: 90,
		typeOptions: { minValue: 1, maxValue: 365 },
		description: 'History window in days (max 365)',
		displayOptions: {
			show: { resource: ['stock'], operation: ['getHistory'] },
		},
	},
	{
		displayName: 'Limit',
		name: 'limit',
		type: 'number',
		default: 50,
		typeOptions: { minValue: 1 },
		description: 'Max number of results to return',
		hint: 'Free tier returns at most 5 articles regardless of this value. Pro returns up to 50.',
		displayOptions: { show: { resource: ['stock'], operation: ['getNews'] } },
	},
	{
		displayName: 'Days',
		name: 'days',
		type: 'number',
		default: 30,
		typeOptions: { minValue: 1 },
		description:
			'Look-back window in days (free tier is capped at 30 regardless of this value; Pro allows up to 90)',
		displayOptions: { show: { resource: ['stock'], operation: ['getNews'] } },
	},
	{
		displayName: 'Days',
		name: 'days',
		type: 'number',
		default: 90,
		typeOptions: { minValue: 1, maxValue: 730 },
		description:
			'History window in days (max 730). Returns every indicator together — there is no way to request a single indicator.',
		displayOptions: {
			show: { resource: ['stock'], operation: ['getIndicatorHistory'] },
		},
	},
];
