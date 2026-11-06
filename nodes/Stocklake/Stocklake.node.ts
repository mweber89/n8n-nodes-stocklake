import type { INodeTypeBaseDescription, IVersionedNodeType } from 'n8n-workflow';
import { VersionedNodeType } from 'n8n-workflow';

import { StocklakeV1 } from './v1/StocklakeV1';
import { StocklakeV2 } from './v2/StocklakeV2';

/** Version a node is created with when a user drags it onto the canvas. Existing
 * workflows keep the `typeVersion` they were saved with. */
export const DEFAULT_VERSION = 2;

export class Stocklake extends VersionedNodeType {
	constructor() {
		const baseDescription: INodeTypeBaseDescription = {
			displayName: 'Stocklake',
			name: 'stocklake',
			icon: { light: 'file:stocklake.svg', dark: 'file:stocklake.dark.svg' },
			group: ['transform'],
			subtitle: '={{$parameter["resource"] + ": " + $parameter["operation"]}}',
			description:
				'Stock market data with quotes delayed about 15 minutes: fundamentals, technical indicators, AI research, insider activity, screener, signals, and macro/sector outlook',
			defaultVersion: DEFAULT_VERSION,
		};

		const nodeVersions: IVersionedNodeType['nodeVersions'] = {
			1: new StocklakeV1(baseDescription),
			2: new StocklakeV2(baseDescription),
		};

		super(nodeVersions, baseDescription);
	}
}
