import type {
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeBaseDescription,
	INodeTypeDescription,
} from 'n8n-workflow';

import { searchSymbols } from '../GenericFunctions';
import { versionDescription } from '../descriptions/NodeDescription';
import { executeToolCallPerItem } from '../execute';

/** Version 2: the default for new nodes. It starts out identical to version 1 and is
 * where the 2.0 changes land (new operations, row-level output). Anything that would
 * change what a version 1 workflow receives belongs here, never in version 1. */
export class StocklakeV2 implements INodeType {
	description: INodeTypeDescription;

	constructor(baseDescription: INodeTypeBaseDescription) {
		this.description = versionDescription(baseDescription, 2);
	}

	methods = { listSearch: { searchSymbols } };

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		return await executeToolCallPerItem.call(this);
	}
}
