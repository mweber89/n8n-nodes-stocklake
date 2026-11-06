import type { INodeProperties } from 'n8n-workflow';
import { withDocsLinks } from './shared';

const watchlistOperationsBase: INodeProperties = {
	displayName: 'Operation',
	name: 'operation',
	type: 'options',
	noDataExpression: true,
	displayOptions: { show: { resource: ['watchlist'] } },
	default: 'get',
	options: [
		{
			name: 'Get',
			value: 'get',
			description:
				"The caller's Stocklake watchlist, enriched with latest price, RSI and AI verdict (requires Pro). Read-only — starring is web-only, at stocklake.dev/dashboard.",
			action: 'Get watchlist',
		},
	],
};

export const watchlistOperations = withDocsLinks('watchlist', watchlistOperationsBase);

export const watchlistFields: INodeProperties[] = [];
