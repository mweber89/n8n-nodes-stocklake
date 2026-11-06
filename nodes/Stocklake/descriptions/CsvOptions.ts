import type { INodeProperties } from 'n8n-workflow';

/**
 * The CSV export options (node version 2), added to the Options collection of the list
 * operations and of Compare. The rules for the file are in csv.ts.
 */
export const csvOptionFields: INodeProperties[] = [
	{
		displayName: 'CSV File Name',
		name: 'csvFileName',
		type: 'string',
		default: '',
		placeholder: 'AAPL-history.csv',
		description:
			'Name of the CSV file. Leave empty for a name made from the ticker, the operation and the date.',
	},
	{
		displayName: 'Download as CSV',
		name: 'downloadCsv',
		type: 'boolean',
		default: false,
		description:
			'Whether to return the rows as one CSV file (binary) instead of one item per row. The file has a header row and ISO dates and opens in a spreadsheet. Items that could not be read stay as separate items with their error.',
	},
	{
		displayName: 'Put CSV in Field',
		name: 'csvBinaryProperty',
		type: 'string',
		default: 'data',
		description: 'Name of the binary field that holds the CSV file',
	},
];
