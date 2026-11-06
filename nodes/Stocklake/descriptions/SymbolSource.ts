import type { INodeProperties } from 'n8n-workflow';

/**
 * The Symbol Source option of the operations that take a list of tickers (version 2).
 * Get Many reads its list from the Symbols field; Earnings Calendar reads no list unless
 * asked to. Both can instead collect the tickers from the input items or use the Pro
 * watchlist. The rules for cleaning and batching the list are in symbols.ts.
 */

const notice: Omit<INodeProperties, 'displayOptions'> = {
	displayName:
		'Each ticker counts as one call toward your daily limit. Lists of more than 25 tickers are sent in several requests and the results keep the order of the list.',
	name: 'symbolSourceNotice',
	type: 'notice',
	default: '',
};

const fromInput: Omit<INodeProperties, 'displayOptions'> = {
	displayName: 'Symbol',
	name: 'symbolsFromInput',
	type: 'string',
	default: '={{ $json.symbol }}',
	required: true,
	placeholder: '{{ $json.ticker }}',
	description:
		'The ticker of each input item, as an expression. The node reads it for every input item and works on all of them together. A value can also be a comma-separated list.',
};

function when(resource: string, operation: string, source: string[]) {
	return { show: { resource: [resource], operation: [operation], symbolSource: source } };
}

function sourceFields(
	resource: string,
	operation: string,
	options: INodeProperties['options'],
	defaultSource: string,
): INodeProperties[] {
	return [
		{
			displayName: 'Symbol Source',
			name: 'symbolSource',
			type: 'options',
			default: defaultSource,
			options,
			displayOptions: { show: { resource: [resource], operation: [operation] } },
		},
		{ ...fromInput, displayOptions: when(resource, operation, ['fromInput']) },
		{
			...notice,
			displayOptions: when(resource, operation, ['fromInput', 'fromWatchlist', 'manual']),
		},
	];
}

const watchlistOption = {
	name: 'From My Watchlist',
	value: 'fromWatchlist',
	description: 'The symbols starred in your Stocklake account (requires Pro)',
};
const inputOption = {
	name: 'From Input Items',
	value: 'fromInput',
	description: 'Collect a ticker from every input item',
};
const manualOption = {
	name: 'Manual List',
	value: 'manual',
	description: 'Type the tickers, separated by commas',
};

/** Fields added in front of Get Many's Symbols field. */
export const getManySourceFields = sourceFields(
	'stock',
	'getMany',
	[inputOption, manualOption, watchlistOption],
	'manual',
);

/** Fields added to Earnings Calendar, which also works without a list. */
export const calendarSourceFields: INodeProperties[] = [
	...sourceFields(
		'earnings',
		'getCalendar',
		[
			{
				name: 'All Companies',
				value: 'all',
				description: 'Every company reporting in the window',
			},
			inputOption,
			manualOption,
			watchlistOption,
		],
		'all',
	),
	{
		displayName: 'Symbols',
		name: 'symbols',
		type: 'string',
		default: '',
		placeholder: 'AAPL, MSFT, NVDA',
		description: 'Comma-separated tickers; only these companies are returned',
		displayOptions: when('earnings', 'getCalendar', ['manual']),
	},
];
