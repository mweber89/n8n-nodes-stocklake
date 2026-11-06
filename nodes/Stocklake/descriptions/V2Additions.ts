import type { INodeProperties, INodePropertyOptions } from 'n8n-workflow';

import { LIST_SPECS, listOperations } from '../rows';
import { properties } from './NodeDescription';
import { symbolLocatorField, withDocsLinks } from './shared';

/**
 * Operations and fields that exist in node version 2 only. Version 1 is frozen
 * (see CONTRIBUTING.md), so nothing here is reachable from it.
 *
 * Each parameter mirrors the real tool's signature: same names (as camelCase),
 * same allowed values, same defaults and limits.
 */

const stockOperationsV2: INodePropertyOptions[] = [
	{
		name: 'Get Activity',
		value: 'getActivity',
		description:
			'One timeline of news, SEC filings, insider trades, earnings, analyst changes and screener setups over the last 90 days (free: dates and titles; Pro: the content of each item)',
		action: 'Get stock activity',
	},
	{
		name: 'Get Analyst Trend',
		value: 'getAnalystTrend',
		description:
			'Daily history of analyst consensus: rating, number of analysts and price targets (requires Pro)',
		action: 'Get stock analyst trend',
	},
	{
		name: 'Get Filings',
		value: 'getFilings',
		description:
			'Latest SEC 8-K filings, newest first (free: the 5 most recent with what each covers; Pro: up to 25, with headline, summary and sentiment)',
		action: 'Get stock filings',
	},
	{
		name: 'Get Financials',
		value: 'getFinancials',
		description:
			'Balance sheet, income statement and cash flow line items (free: the latest fiscal year; Pro: up to 5 years and quarterly)',
		action: 'Get stock financials',
	},
];

const marketOperationsV2: INodePropertyOptions[] = [
	{
		name: 'Get Economic Calendar',
		value: 'getEconomicCalendar',
		description:
			'Upcoming and recently released economic events such as rate decisions, CPI, GDP and payrolls (free: 1 day ahead, 2 back; Pro: up to 14 ahead, 7 back)',
		action: 'Get economic calendar',
	},
];

/** The operations of one resource, with the version-2 ones added and the list kept
 * in alphabetical order (a rule of the n8n lint plugin). */
function withExtraOperations(
	operationProperty: INodeProperties,
	resource: string,
	extra: INodePropertyOptions[],
): INodeProperties {
	const added = withDocsLinks(resource, { ...operationProperty, options: extra });
	const options = [
		...(operationProperty.options as INodePropertyOptions[]),
		...(added.options as INodePropertyOptions[]),
	];
	options.sort((a, b) => a.name.localeCompare(b.name));
	return { ...operationProperty, options };
}

const newFields: INodeProperties[] = [
	symbolLocatorField('Symbol', 'symbol', 'stock', 'getFinancials'),
	symbolLocatorField('Symbol', 'symbol', 'stock', 'getFilings'),
	symbolLocatorField('Symbol', 'symbol', 'stock', 'getActivity'),
	symbolLocatorField('Symbol', 'symbol', 'stock', 'getAnalystTrend'),

	// get_stock_financials
	{
		displayName: 'Period',
		name: 'period',
		type: 'options',
		default: 'annual',
		options: [
			{ name: 'Annual', value: 'annual' },
			{ name: 'Both', value: 'both' },
			{ name: 'Quarterly', value: 'quarterly' },
		],
		description:
			'Which reporting periods to return. Without Pro, Quarterly and Both return the latest annual year plus a note on what Pro unlocks.',
		displayOptions: { show: { resource: ['stock'], operation: ['getFinancials'] } },
	},
	{
		displayName: 'Statement',
		name: 'statement',
		type: 'options',
		default: 'all',
		options: [
			{ name: 'All', value: 'all' },
			{ name: 'Balance Sheet', value: 'balance_sheet' },
			{ name: 'Cash Flow', value: 'cash_flow' },
			{ name: 'Income Statement', value: 'income_stmt' },
		],
		description: 'Which statement to return',
		displayOptions: { show: { resource: ['stock'], operation: ['getFinancials'] } },
	},

	// get_stock_filings
	{
		displayName: 'Limit',
		// Not named `limit`: the n8n lint plugin forces any parameter with that name to
		// default 50 with no maximum, but the tool's real default is 10 and its maximum 25.
		name: 'maxResults',
		type: 'number',
		default: 10,
		typeOptions: { minValue: 1, maxValue: 25 },
		description: 'Max number of filings to return (default 10, max 25)',
		hint: 'Without Pro at most 5 filings are returned, whatever this is set to.',
		displayOptions: { show: { resource: ['stock'], operation: ['getFilings'] } },
	},

	// get_stock_activity
	{
		displayName: 'Types',
		name: 'types',
		type: 'multiOptions',
		default: [],
		options: [
			{ name: 'Analyst Change', value: 'analyst' },
			{ name: 'Earnings', value: 'earnings' },
			{ name: 'Filing', value: 'filing' },
			{ name: 'Insider', value: 'insider' },
			{ name: 'News', value: 'news' },
			{ name: 'Setup', value: 'setup' },
		],
		description: 'Which kinds of items to return. Leave empty for all of them.',
		displayOptions: { show: { resource: ['stock'], operation: ['getActivity'] } },
	},
	{
		displayName: 'Days',
		name: 'days',
		type: 'number',
		default: 90,
		typeOptions: { minValue: 1, maxValue: 90 },
		description: 'Look-back window in days (max 90)',
		displayOptions: { show: { resource: ['stock'], operation: ['getActivity'] } },
	},
	{
		displayName: 'Limit',
		name: 'maxResults',
		type: 'number',
		default: 25,
		typeOptions: { minValue: 1, maxValue: 50 },
		description: 'Items per page (default 25, max 50). Use Page to read further.',
		displayOptions: { show: { resource: ['stock'], operation: ['getActivity'] } },
	},
	{
		displayName: 'Page',
		name: 'page',
		type: 'number',
		default: 1,
		typeOptions: { minValue: 1 },
		description: 'Page number, starting at 1. The response says how many pages there are.',
		displayOptions: { show: { resource: ['stock'], operation: ['getActivity'] } },
	},

	// get_analyst_trend
	{
		displayName: 'Days',
		name: 'days',
		type: 'number',
		default: 90,
		typeOptions: { minValue: 1, maxValue: 365 },
		description: 'Number of days of daily analyst snapshots to return (max 365)',
		displayOptions: { show: { resource: ['stock'], operation: ['getAnalystTrend'] } },
	},

	// get_earnings_calendar (version 2 adds Limit and paging to it)
	{
		displayName: 'Limit',
		name: 'limit',
		type: 'number',
		default: 50,
		typeOptions: { minValue: 1 },
		description: 'Max number of results to return',
		hint: 'Without Pro the API returns the 5 largest companies, whatever this is set to.',
		displayOptions: { show: { resource: ['earnings'], operation: ['getCalendar'] } },
	},

	// get_economic_calendar
	{
		displayName: 'Days Ahead',
		name: 'days',
		type: 'number',
		default: 0,
		typeOptions: { minValue: 0, maxValue: 14 },
		description:
			'Look-ahead window in days for upcoming events. 0 uses the plan default (1 day without Pro, 3 with Pro). Maximum 1 without Pro, 14 with Pro.',
		displayOptions: { show: { resource: ['market'], operation: ['getEconomicCalendar'] } },
	},
	{
		displayName: 'Days Back',
		name: 'lookbackDays',
		type: 'number',
		default: 2,
		typeOptions: { minValue: 0, maxValue: 7 },
		description:
			'Look-back window in days for recently released events. Maximum 2 without Pro, 7 with Pro. Actual values arrive about a day late, so keep this at 2 or more to see them.',
		displayOptions: { show: { resource: ['market'], operation: ['getEconomicCalendar'] } },
	},
	{
		displayName: 'Limit',
		name: 'maxResults',
		type: 'number',
		default: 20,
		typeOptions: { minValue: 1, maxValue: 50 },
		description:
			'Max events per group; upcoming and recently released are capped separately (default 20). Maximum 20 without Pro, 50 with Pro.',
		displayOptions: { show: { resource: ['market'], operation: ['getEconomicCalendar'] } },
	},
	{
		displayName: 'Major Economies Only',
		name: 'majorOnly',
		type: 'boolean',
		default: false,
		description:
			'Whether to restrict results to the 8 largest economies (United States, Euro Area, United Kingdom, Japan, China, Germany, France, Canada)',
		displayOptions: { show: { resource: ['market'], operation: ['getEconomicCalendar'] } },
	},
	{
		displayName: 'Key Events Only',
		name: 'keyEventsOnly',
		type: 'boolean',
		default: false,
		description:
			'Whether to restrict results to the event types that move markets on their own: rate decisions, CPI, GDP and headline non-farm payrolls',
		displayOptions: { show: { resource: ['market'], operation: ['getEconomicCalendar'] } },
	},
];

/** `resource.operation` of a property that is shown for exactly one operation. */
function operationKey(property: INodeProperties): string | undefined {
	const show = property.displayOptions?.show;
	const resource = show?.resource?.[0];
	const operation = show?.operation?.[0];
	return typeof resource === 'string' && typeof operation === 'string'
		? `${resource}.${operation}`
		: undefined;
}

function returnAllField(resource: string, operation: string): INodeProperties {
	return {
		displayName: 'Return All',
		name: 'returnAll',
		type: 'boolean',
		default: false,
		description: 'Whether to return all results or only up to a given limit',
		displayOptions: { show: { resource: [resource], operation: [operation] } },
	};
}

/** Adds Return All in front of each Limit, and hides Limit (and Page) while it is on. */
function withReturnAll(list: INodeProperties[]): INodeProperties[] {
	const out: INodeProperties[] = [];
	for (const property of list) {
		const key = operationKey(property);
		const spec = key ? LIST_SPECS[key] : undefined;
		const isLimit = spec?.limit?.param === property.name;
		const isPage = spec?.paging === 'page' && property.name === 'page';
		if (!key || !spec || !(isLimit || isPage)) {
			out.push(property);
			continue;
		}
		const [resource, operation] = key.split('.');
		if (isLimit) out.push(returnAllField(resource, operation));
		out.push({
			...property,
			displayOptions: {
				...property.displayOptions,
				show: { ...property.displayOptions?.show, returnAll: [false] },
			},
		});
	}
	return out;
}

/** Simplify and the Options collection, once per resource that has list operations. */
function outputFields(): INodeProperties[] {
	const resources = [...new Set(Object.keys(LIST_SPECS).map((key) => key.split('.')[0]))];
	return resources.flatMap((resource): INodeProperties[] => {
		const show = { resource: [resource], operation: listOperations(resource) };
		return [
			{
				displayName: 'Simplify',
				name: 'simplify',
				type: 'boolean',
				default: true,
				description:
					'Whether to return a flat, chosen set of fields for each row instead of every field the API sends',
				displayOptions: { show },
			},
			{
				displayName: 'Options',
				name: 'options',
				type: 'collection',
				placeholder: 'Add Option',
				default: {},
				displayOptions: { show },
				options: [
					{
						displayName: 'Include Response Metadata',
						name: 'includeMetadata',
						type: 'boolean',
						default: false,
						description:
							'Whether to add the details the API returns around the rows (counts, applied filters, notes) to every item as _meta',
					},
				],
			},
		];
	});
}

/** Version 1's properties plus the five new operations, one item per row, Simplify,
 * Return All / Limit and the metadata option. */
export const v2Properties: INodeProperties[] = [
	...withReturnAll([
		...properties.map((property) => {
			if (property.name !== 'operation') return property;
			const resource = property.displayOptions?.show?.resource?.[0] as string;
			if (resource === 'stock') return withExtraOperations(property, 'stock', stockOperationsV2);
			if (resource === 'market') return withExtraOperations(property, 'market', marketOperationsV2);
			return property;
		}),
		...newFields,
	]),
	...outputFields(),
];
