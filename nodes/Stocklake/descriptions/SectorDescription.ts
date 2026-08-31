import type { INodeProperties } from 'n8n-workflow';
import { SECTOR_OPTIONS } from './shared';

export const sectorOperations: INodeProperties = {
	displayName: 'Operation',
	name: 'operation',
	type: 'options',
	noDataExpression: true,
	displayOptions: { show: { resource: ['sector'] } },
	default: 'getIntelligence',
	options: [
		{
			name: 'Get Intelligence',
			value: 'getIntelligence',
			description:
				'AI-assessed sector signal, cycle stage and rotation guidance — one sector or all 11 (requires Pro)',
			action: 'Get sector intelligence',
		},
	],
};

export const sectorFields: INodeProperties[] = [
	{
		displayName: 'Sector',
		name: 'sector',
		type: 'options',
		default: '',
		options: [{ name: 'All 11 Sectors (Rotation View)', value: '' }, ...SECTOR_OPTIONS],
		displayOptions: {
			show: { resource: ['sector'], operation: ['getIntelligence'] },
		},
	},
	{
		displayName: 'Sort by Strength',
		name: 'sortByStrength',
		type: 'boolean',
		default: false,
		description:
			'Whether to rank sectors LEADING → LAGGING. Only applies when Sector is left on "All 11 Sectors".',
		displayOptions: {
			show: { resource: ['sector'], operation: ['getIntelligence'] },
		},
	},
	{
		displayName: 'History Count',
		name: 'historyCount',
		type: 'number',
		default: 0,
		typeOptions: { minValue: 0, maxValue: 3 },
		description:
			'Prior signal states per sector to include (0-3). Only applies when Sector is left on "All 11 Sectors".',
		displayOptions: {
			show: { resource: ['sector'], operation: ['getIntelligence'] },
		},
	},
];
