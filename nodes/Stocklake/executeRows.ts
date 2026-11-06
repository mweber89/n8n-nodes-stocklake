import type { IDataObject, IExecuteFunctions, INodeExecutionData } from 'n8n-workflow';

import { stocklakeApiRequest } from './GenericFunctions';
import { buildToolCall } from './ToolMapping';
import {
	LIST_SPECS,
	SYMBOLS_PER_CALL,
	chunk,
	extractRows,
	responseMetadata,
	simplifyRow,
} from './rows';
import type { ListSpec } from './rows';

/** Stops a paged read that does not end (a server that keeps saying "more"). */
const MAX_PAGES = 200;

interface Fetched {
	rows: IDataObject[];
	extras: IDataObject[];
	metadata: IDataObject;
}

/**
 * Reads the rows of one list operation, paging when the tool pages and respecting
 * the tool's per-call caps. `wanted` is the user's Limit, or undefined for Return All.
 */
async function fetchRows(
	this: IExecuteFunctions,
	spec: ListSpec,
	toolName: string,
	baseArguments: IDataObject,
	wanted: number | undefined,
	itemIndex: number,
): Promise<Fetched> {
	const call = (args: IDataObject) => stocklakeApiRequest.call(this, toolName, args, itemIndex);
	const cap = spec.limit?.cap ?? Number.MAX_SAFE_INTEGER;
	// Every page has the same size, otherwise page N would not line up with page N-1.
	const perCall = Math.min(wanted ?? cap, cap);

	// Symbols: the tool takes 25 per call, so a longer list is sent in batches.
	if (spec.paging === 'symbols') {
		const symbols = (baseArguments.symbols as string[]) ?? [];
		const rows: IDataObject[] = [];
		const metadata: IDataObject = { count: 0, requested: 0, missing: [], duplicates_collapsed: 0 };
		for (const batch of chunk(symbols, SYMBOLS_PER_CALL)) {
			const response = await call({ ...baseArguments, symbols: batch });
			rows.push(...extractRows(response, spec).rows);
			const meta = responseMetadata(response, spec);
			metadata.count = (metadata.count as number) + ((meta.count as number) ?? 0);
			metadata.requested =
				(metadata.requested as number) + ((meta.requested as number) ?? batch.length);
			metadata.missing = [...(metadata.missing as string[]), ...((meta.missing as string[]) ?? [])];
			metadata.duplicates_collapsed =
				(metadata.duplicates_collapsed as number) + ((meta.duplicates_collapsed as number) ?? 0);
		}
		return { rows, extras: [], metadata };
	}

	// Paged by `page` (Activity) or by `offset` (Earnings Calendar).
	if (spec.paging === 'page' || spec.paging === 'offset') {
		const rows: IDataObject[] = [];
		let extras: IDataObject[] = [];
		let metadata: IDataObject = {};
		let page =
			spec.paging === 'page' && wanted !== undefined ? ((baseArguments.page as number) ?? 1) : 1;
		let offset = 0;

		for (let n = 0; n < MAX_PAGES; n++) {
			const args: IDataObject = { ...baseArguments, limit: perCall };
			if (spec.paging === 'page') args.page = page;
			else if (offset > 0) args.offset = offset;

			const response = await call(args);
			const extracted = extractRows(response, spec, { includeExtras: n === 0 });
			rows.push(...extracted.rows);
			if (n === 0) extras = extracted.extras;
			metadata = responseMetadata(response, spec);

			if (extracted.rows.length === 0) break;
			if (wanted !== undefined && rows.length >= wanted) break;

			if (spec.paging === 'page') {
				const pages = (response.pages as number) ?? 1;
				if (page >= pages) break;
				page += 1;
			} else {
				const next = response.next_offset;
				if (typeof next !== 'number' || next <= offset) break;
				offset = next;
			}
		}
		return { rows: wanted === undefined ? rows : rows.slice(0, wanted), extras, metadata };
	}

	// One call. The tool enforces its own cap; the argument is kept within it.
	const args = spec.limit ? { ...baseArguments, limit: perCall } : baseArguments;
	const response = await call(args);
	const { rows, extras } = extractRows(response, spec);
	return { rows, extras, metadata: responseMetadata(response, spec) };
}

async function itemOutput(this: IExecuteFunctions, i: number): Promise<INodeExecutionData[]> {
	const resource = this.getNodeParameter('resource', i) as string;
	const operation = this.getNodeParameter('operation', i) as string;
	const { toolName, toolArguments } = buildToolCall.call(this, resource, operation, i);
	const spec = LIST_SPECS[`${resource}.${operation}`];

	// Not list-shaped (Get, Research, Pulse, Financials, ...): the whole response, one item.
	if (!spec) {
		const response = await stocklakeApiRequest.call(this, toolName, toolArguments, i);
		return this.helpers.constructExecutionMetaData(
			this.helpers.returnJsonArray(response as IDataObject),
			{ itemData: { item: i } },
		);
	}

	let wanted: number | undefined;
	if (spec.limit) {
		const returnAll = this.getNodeParameter('returnAll', i, false) as boolean;
		wanted = returnAll
			? undefined
			: (this.getNodeParameter(spec.limit.param, i, spec.limit.fallback) as number);
	}
	const simplify = this.getNodeParameter('simplify', i, true) as boolean;
	const options = this.getNodeParameter('options', i, {}) as IDataObject;
	const includeMetadata = options.includeMetadata === true;

	const fetched = await fetchRows.call(this, spec, toolName, toolArguments, wanted, i);

	const meta = includeMetadata ? { _meta: fetched.metadata } : {};
	const shaped = [...fetched.extras, ...fetched.rows].map((row) => ({
		...(simplify ? simplifyRow(row, spec.simplify) : row),
		...meta,
	}));

	// No rows: nothing to pass on, unless the caller asked for the metadata, which
	// is then the only place a note such as "no data in this window" is visible.
	const json = shaped.length === 0 && includeMetadata ? [meta as IDataObject] : shaped;
	return this.helpers.constructExecutionMetaData(
		json.map((entry) => ({ json: entry })),
		{ itemData: { item: i } },
	);
}

/**
 * Node version 2: one output item per row for list-shaped operations (Simplify,
 * Return All / Limit and optional metadata apply), the whole response as one item
 * for every other operation. Every output item is paired with its input item.
 */
export async function executeRows(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
	const items = this.getInputData();
	const returnData: INodeExecutionData[] = [];

	for (let i = 0; i < items.length; i++) {
		if (!this.continueOnFail()) {
			returnData.push(...(await itemOutput.call(this, i)));
			continue;
		}
		try {
			returnData.push(...(await itemOutput.call(this, i)));
		} catch (error) {
			returnData.push({ json: { error: (error as Error).message }, pairedItem: { item: i } });
		}
	}

	return [returnData];
}
