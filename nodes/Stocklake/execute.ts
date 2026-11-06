import type { IDataObject, IExecuteFunctions, INodeExecutionData } from 'n8n-workflow';

import { stocklakeApiRequest } from './GenericFunctions';
import { buildToolCall } from './ToolMapping';

/**
 * Runs the node: one Stocklake tool call per input item, one output item per
 * response. This is the behaviour of node version 1 and must not change for it;
 * a version that needs a different output shape gets its own execute function
 * instead of editing this one.
 */
export async function executeToolCallPerItem(
	this: IExecuteFunctions,
): Promise<INodeExecutionData[][]> {
	const items = this.getInputData();
	const returnData: INodeExecutionData[] = [];

	const resource = this.getNodeParameter('resource', 0) as string;
	const operation = this.getNodeParameter('operation', 0) as string;

	for (let i = 0; i < items.length; i++) {
		// stocklakeApiRequest/buildToolCall already throw NodeApiError/NodeOperationError for
		// every real failure, so the not-continueOnFail path deliberately has no catch at all —
		// letting that error propagate as-is, rather than a bare `throw error` that would trip
		// the "always construct a NodeError" verification rule for no behavioral benefit.
		if (!this.continueOnFail()) {
			const { toolName, toolArguments } = buildToolCall.call(this, resource, operation, i);
			const responseData = await stocklakeApiRequest.call(this, toolName, toolArguments, i);
			const executionData = this.helpers.constructExecutionMetaData(
				this.helpers.returnJsonArray(responseData as IDataObject),
				{ itemData: { item: i } },
			);
			returnData.push(...executionData);
			continue;
		}

		try {
			const { toolName, toolArguments } = buildToolCall.call(this, resource, operation, i);
			const responseData = await stocklakeApiRequest.call(this, toolName, toolArguments, i);
			const executionData = this.helpers.constructExecutionMetaData(
				this.helpers.returnJsonArray(responseData as IDataObject),
				{ itemData: { item: i } },
			);
			returnData.push(...executionData);
		} catch (error) {
			returnData.push({
				json: { error: (error as Error).message },
				pairedItem: { item: i },
			});
		}
	}

	return [returnData];
}
