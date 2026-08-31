import type { INodeProperties } from 'n8n-workflow';

export const newsOperations: INodeProperties = {
	displayName: 'Operation',
	name: 'operation',
	type: 'options',
	noDataExpression: true,
	displayOptions: { show: { resource: ['news'] } },
	default: 'getFeed',
	options: [
		{
			name: 'Get Feed',
			value: 'getFeed',
			description:
				'Top AI-flagged news across every tracked stock — a market-wide briefing, not per-symbol (requires Pro). For one stock, use Stock → Get News instead.',
			action: 'Get news feed',
		},
	],
};

export const newsFields: INodeProperties[] = [
	{
		displayName: 'Min Signal Score',
		name: 'minSignalScore',
		type: 'number',
		default: 60,
		typeOptions: { minValue: 0, maxValue: 100 },
		description: '0-100, the minimum signal score used to select articles server-side',
		displayOptions: { show: { resource: ['news'], operation: ['getFeed'] } },
	},
	{
		displayName: 'Days',
		name: 'days',
		type: 'number',
		default: 3,
		typeOptions: { minValue: 1, maxValue: 10 },
		description: 'Look-back window in days (max 10)',
		displayOptions: { show: { resource: ['news'], operation: ['getFeed'] } },
	},
	{
		displayName: 'Limit',
		name: 'limit',
		type: 'number',
		default: 10,
		typeOptions: { minValue: 1, maxValue: 25 },
		displayOptions: { show: { resource: ['news'], operation: ['getFeed'] } },
	},
];
