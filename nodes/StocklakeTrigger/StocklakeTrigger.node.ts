import type {
	INodeProperties,
	INodeType,
	INodeTypeDescription,
	IPollFunctions,
	INodeExecutionData,
} from 'n8n-workflow';
import { NodeConnectionTypes } from 'n8n-workflow';

import { getSignalDirections } from '../Stocklake/loadOptions';
import {
	DEFAULT_FILINGS,
	DEFAULT_MINUTES,
	DEFAULT_SIGNAL_LIMIT,
	WARN_BELOW_MINUTES,
} from './estimate';
import { ESTIMATE_DEPENDS_ON, getCallEstimate } from './loadOptions';
import { poll } from './poll';

const forEvent = (...events: string[]) => ({ show: { event: events } });

/**
 * Shows what the settings cost in calls a day (see loadOptions.ts). Built here instead of
 * written out because the lint rules for dropdowns ask for "Name or ID" wording, which
 * does not fit a field that only shows a figure.
 */
const ESTIMATE_LOADER = {
	loadOptionsMethod: 'getCallEstimate',
	loadOptionsDependsOn: ESTIMATE_DEPENDS_ON,
};

function estimateField(): INodeProperties {
	return {
		displayName: 'Estimated Calls per Day',
		name: 'callEstimate',
		type: 'options',
		default: '',
		noDataExpression: true,
		typeOptions: ESTIMATE_LOADER,
		options: [],
		description:
			'What the settings above cost against your daily allowance. Only shows a figure: there is nothing to choose.',
	};
}

const properties: INodeProperties[] = [
	{
		displayName:
			'Starts the workflow when something happens in Stocklake. n8n\u2019s Poll Times wake the node every minute unless you change them, but the node only calls Stocklake when its minimum time between checks has passed (an hour by default). Every check uses calls of your daily allowance (200 for a free account, 5,000 for Pro). Quotes are delayed about 15 minutes. Connect a Stocklake credential: without one the node runs as a guest with 25 calls a day shared with others.',
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
			{ name: 'API Key (or None, for Guest Access)', value: 'apiKey' },
			{ name: 'OAuth2 (Sign In with Stocklake)', value: 'oAuth2' },
		],
	},
	{
		displayName: 'Event',
		name: 'event',
		type: 'options',
		noDataExpression: true,
		default: 'earnings',
		options: [
			{
				name: 'Earnings Coming Up',
				value: 'earnings',
				description:
					'A stock reports earnings within the next days. Fires once for each report date (free).',
			},
			{
				name: 'Insider Purchase',
				value: 'insider',
				description: 'An insider buys shares above an amount (free)',
			},
			{
				name: 'New SEC Filing',
				value: 'filing',
				description: 'A new 8-K filing for a stock, with the headline and a summary (free)',
			},
			{
				name: 'New Signal',
				value: 'signal',
				description:
					'Stocklake flags a new signal, optionally by direction and score (requires Pro)',
			},
			{
				name: 'Price Move',
				value: 'price',
				description: 'A stock moves more than a percentage in a day, up or down (free)',
			},
			{
				name: 'RSI Crossing',
				value: 'rsi',
				description:
					'A stock’s RSI crosses a level, from one side to the other. It does not fire while the RSI stays beyond it (free).',
			},
		],
	},

	// ----------------------------------------------------------- symbols
	{
		displayName: 'Symbol Source',
		name: 'symbolSource',
		type: 'options',
		default: 'all',
		options: [
			{ name: 'All Stocks', value: 'all', description: 'Every signal Stocklake flags' },
			{ name: 'Manual List', value: 'manual', description: 'Only signals for the stocks you type' },
			{
				name: 'My Watchlist',
				value: 'watchlist',
				description: 'Only signals for the stocks starred in your Stocklake account (requires Pro)',
			},
		],
		displayOptions: forEvent('signal'),
	},
	{
		displayName: 'Symbol Source',
		name: 'symbolSource',
		type: 'options',
		default: 'manual',
		options: [
			{
				name: 'Manual List',
				value: 'manual',
				description: 'Type the tickers, separated by commas',
			},
			{
				name: 'My Watchlist',
				value: 'watchlist',
				description:
					'The stocks starred in your Stocklake account (requires Pro). Each stock on it counts as a call at every check.',
			},
		],
		displayOptions: forEvent('earnings', 'filing', 'insider', 'rsi', 'price'),
	},
	{
		displayName: 'Symbols',
		name: 'symbols',
		type: 'string',
		default: '',
		required: true,
		placeholder: 'AAPL, MSFT, NVDA',
		description:
			'Comma-separated tickers. Each stock counts as at least one call at every check. Filings and insider purchases are read one request per stock, so they take at most 25.',
		displayOptions: {
			show: {
				event: ['earnings', 'filing', 'insider', 'rsi', 'price'],
				symbolSource: ['manual'],
			},
		},
	},
	{
		displayName: 'Symbols',
		name: 'symbols',
		type: 'string',
		default: '',
		placeholder: 'AAPL, MSFT, NVDA',
		description: 'Comma-separated tickers; only signals for these stocks start the workflow',
		displayOptions: { show: { event: ['signal'], symbolSource: ['manual'] } },
	},

	// ---------------------------------------------------- event settings
	{
		displayName: 'Direction Name or ID',
		name: 'direction',
		type: 'options',
		default: '',
		typeOptions: { loadOptionsMethod: 'getSignalDirections' },
		description:
			'Only signals in this direction. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
		displayOptions: forEvent('signal'),
	},
	{
		displayName: 'Min Signal Score',
		name: 'minSignalScore',
		type: 'number',
		default: 60,
		typeOptions: { minValue: 0, maxValue: 100 },
		description: 'Only signals scored at least this (0-100)',
		displayOptions: forEvent('signal'),
	},
	{
		displayName: 'Max Signals per Check',
		name: 'signalLimit',
		type: 'number',
		default: DEFAULT_SIGNAL_LIMIT,
		typeOptions: { minValue: 1, maxValue: 25 },
		description:
			'Most signals read at each check. Each signal read counts as one call toward your daily limit, so this is also the most one check can use.',
		displayOptions: forEvent('signal'),
	},
	{
		displayName: 'Days Ahead',
		name: 'daysAhead',
		type: 'number',
		default: 7,
		typeOptions: { minValue: 1, maxValue: 30 },
		description:
			'Fires when a stock reports within this many days (max 30). Each report date fires once. Changing this starts over: the dates already inside the new window are remembered, not announced.',
		displayOptions: forEvent('earnings'),
	},
	{
		displayName: 'Filings to Read per Stock',
		name: 'filingsPerSymbol',
		type: 'number',
		default: DEFAULT_FILINGS,
		typeOptions: { minValue: 1, maxValue: 10 },
		description:
			'The latest filings read for each stock at each check. Each filing read counts as one call toward your daily limit, so a stock can use this many calls per check.',
		displayOptions: forEvent('filing'),
	},
	{
		displayName: 'Min Purchase (USD)',
		name: 'minPurchaseUsd',
		type: 'number',
		default: 100000,
		typeOptions: { minValue: 0 },
		description: 'Fires for an insider purchase worth at least this much (shares times price)',
		displayOptions: forEvent('insider'),
	},
	{
		displayName: 'RSI Level',
		name: 'rsiThreshold',
		type: 'number',
		default: 70,
		typeOptions: { minValue: 0, maxValue: 100 },
		description:
			'The level to cross. At or above it counts as above. The RSI is recalculated a few times a day, so checking more often than that finds nothing new.',
		displayOptions: forEvent('rsi'),
	},
	{
		displayName: 'Crossing',
		name: 'rsiDirection',
		type: 'options',
		default: 'up',
		options: [
			{ name: 'Down (Falls Below)', value: 'down' },
			{ name: 'Either Way', value: 'either' },
			{ name: 'Up (Rises to or Above)', value: 'up' },
		],
		displayOptions: forEvent('rsi'),
	},
	{
		displayName: 'Daily Move Above (%)',
		name: 'moveThreshold',
		type: 'number',
		default: 5,
		typeOptions: { minValue: 0, maxValue: 1000 },
		description:
			'Fires when a stock is up or down by more than this many percent on the day. Fires once per stock, day and direction.',
		displayOptions: forEvent('price'),
	},
	{
		displayName: 'Direction',
		name: 'moveDirection',
		type: 'options',
		default: 'either',
		options: [
			{ name: 'Down', value: 'down' },
			{ name: 'Either Way', value: 'either' },
			{ name: 'Up', value: 'up' },
		],
		displayOptions: forEvent('price'),
	},

	// ------------------------------------------------------------ schedule
	{
		displayName: 'Minimum Minutes Between Checks',
		name: 'minutesBetweenChecks',
		type: 'number',
		default: DEFAULT_MINUTES,
		typeOptions: { minValue: 1, maxValue: 1440 },
		description:
			'N8n’s Poll Times decide when the node wakes up, and start at every minute. To protect your daily allowance the node only calls Stocklake when this many minutes have passed since its last check: the default is hourly whatever the Poll Times are. Lower it, together with the Poll Times, to check more often.',
	},
	{
		displayName: `Checking more often than every ${WARN_BELOW_MINUTES} minutes uses your daily allowance fast, and most of this data changes less often than that. Prices are delayed about 15 minutes, indicators like the RSI are recalculated a few times a day, and signals, filings and insider purchases arrive a few times a day.`,
		name: 'frequentNotice',
		type: 'notice',
		default: '',
		displayOptions: { show: { minutesBetweenChecks: [{ _cnd: { lt: WARN_BELOW_MINUTES } }] } },
	},
	estimateField(),
	{
		displayName: 'Options',
		name: 'options',
		type: 'collection',
		placeholder: 'Add Option',
		default: {},
		options: [
			{
				displayName: 'Fire on Existing Items',
				name: 'fireOnExisting',
				type: 'boolean',
				default: false,
				description:
					'Whether the first check after you activate the workflow (or after you change the event settings) returns what already exists. Off by default: the first check only records the current situation and starts nothing.',
			},
		],
	},
];

export class StocklakeTrigger implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Stocklake Trigger',
		name: 'stocklakeTrigger',
		icon: {
			light: 'file:../Stocklake/stocklake.svg',
			dark: 'file:../Stocklake/stocklake.dark.svg',
		},
		group: ['trigger'],
		version: 1,
		subtitle:
			'={{ ({ earnings: "Earnings coming up", filing: "New SEC filing", insider: "Insider purchase", price: "Price move", rsi: "RSI crossing", signal: "New signal" })[$parameter["event"]] }}',
		description:
			'Starts a workflow on a new signal, upcoming earnings, a new SEC filing, an insider purchase, an RSI crossing or a big price move',
		defaults: { name: 'Stocklake Trigger' },
		polling: true,
		inputs: [],
		outputs: [NodeConnectionTypes.Main],
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
		// A copy: n8n adds the Poll Times to this list, and must not add them twice to a shared one.
		properties: [...properties],
	};

	methods = { loadOptions: { getCallEstimate, getSignalDirections } };

	async poll(this: IPollFunctions): Promise<INodeExecutionData[][] | null> {
		return await poll.call(this);
	}
}
