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

/** Version 1: the node as published in 0.1.x. Existing workflows stay on it, so its
 * parameters and output shape are frozen. test/versioning.test.js replays workflows
 * saved on 0.1.1 against it. */
export class StocklakeV1 implements INodeType {
	description: INodeTypeDescription;

	constructor(baseDescription: INodeTypeBaseDescription) {
		this.description = versionDescription(baseDescription, 1);
	}

	methods = { listSearch: { searchSymbols } };

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		return await executeToolCallPerItem.call(this);
	}
}
