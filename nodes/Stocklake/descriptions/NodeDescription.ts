import type {
	INodeProperties,
	INodePropertyOptions,
	INodeTypeBaseDescription,
	INodeTypeDescription,
} from 'n8n-workflow';
import { NodeConnectionTypes } from 'n8n-workflow';

import { earningsFields, earningsOperations } from './EarningsDescription';
import { marketFields, marketOperations } from './MarketDescription';
import { newsFields, newsOperations } from './NewsDescription';
import { screenerFields, screenerOperations } from './ScreenerDescription';
import { sectorFields, sectorOperations } from './SectorDescription';
import { signalFields, signalOperations } from './SignalDescription';
import { stockFields, stockOperations } from './StockDescription';
import { watchlistFields, watchlistOperations } from './WatchlistDescription';

const credentialNotice: INodeProperties = {
	displayName:
		'Connect a free Stocklake credential: OAuth sign-in (an email link, no key to copy, recommended) or an API key. Without one the node runs as a guest, with 25 calls a day shared by everyone calling from the same network address, which on n8n Cloud includes other n8n users, so it can run out at any time. With a credential you get your own 200 calls a day. The AI research, signals, sector/market intelligence, news feed and watchlist operations require a Pro account. Quotes are delayed about 15 minutes.',
	name: 'credentialNotice',
	type: 'notice',
	default: '',
};

const authentication: INodeProperties = {
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
};

const resource: INodeProperties = {
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
};

/** The resources and operations that exist in every version so far. */
export const properties: INodeProperties[] = [
	credentialNotice,
	authentication,
	resource,
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
];

/** Builds the full description for one node version. */
export function versionDescription(
	base: INodeTypeBaseDescription,
	version: number,
	versionProperties: INodeProperties[] = properties,
): INodeTypeDescription {
	return {
		...base,
		version,
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
		properties: versionProperties,
	};
}
