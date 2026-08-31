import type { INodeProperties } from 'n8n-workflow';

export const signalOperations: INodeProperties = {
	displayName: 'Operation',
	name: 'operation',
	type: 'options',
	noDataExpression: true,
	displayOptions: { show: { resource: ['signal'] } },
	default: 'getMany',
	options: [
		{
			name: 'Get Many',
			value: 'getMany',
			description:
				'AI-screened stock ideas recently surfaced by the pipeline — news, sector screening, sentiment and social (requires Pro)',
			action: 'Get many signals',
		},
	],
};

export const signalFields: INodeProperties[] = [
	{
		displayName: 'Direction',
		name: 'direction',
		type: 'options',
		default: '',
		options: [
			{ name: 'All', value: '' },
			{ name: 'Positive', value: 'POSITIVE' },
			{ name: 'Negative', value: 'NEGATIVE' },
			{ name: 'Neutral / Two-Sided', value: 'NEUTRAL' },
		],
		displayOptions: { show: { resource: ['signal'], operation: ['getMany'] } },
	},
	{
		displayName: 'Source',
		name: 'source',
		type: 'options',
		default: '',
		options: [
			{ name: 'All', value: '' },
			{ name: 'News', value: 'news' },
			{ name: 'Screener', value: 'screener' },
			{ name: 'Sentiment', value: 'sentiment' },
			{ name: 'Social', value: 'social' },
		],
		displayOptions: { show: { resource: ['signal'], operation: ['getMany'] } },
	},
	{
		displayName: 'Min Signal Score',
		name: 'minSignalScore',
		type: 'number',
		default: 60,
		typeOptions: { minValue: 0, maxValue: 100 },
		description: 'A blend of conviction, source track record and real technical factors',
		displayOptions: { show: { resource: ['signal'], operation: ['getMany'] } },
	},
	{
		displayName: 'Limit',
		name: 'limit',
		type: 'number',
		default: 50,
		typeOptions: { minValue: 1, maxValue: 50 },
		description: 'Each returned signal counts as one call toward the daily limit',
		displayOptions: { show: { resource: ['signal'], operation: ['getMany'] } },
	},
];
