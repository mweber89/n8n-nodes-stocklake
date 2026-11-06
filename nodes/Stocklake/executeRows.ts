import type { IDataObject, IExecuteFunctions, INodeExecutionData } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import { stocklakeApiRequest } from './GenericFunctions';
import { buildToolCall } from './ToolMapping';
import {
	LARGE_BATCH_CALLS,
	SYMBOL_OPERATIONS,
	buildSymbolList,
	costNotice,
	estimateCost,
	itemBySymbol,
	orderBySymbols,
} from './symbols';
import type { SymbolList, SymbolSource } from './symbols';
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
		return { rows: orderBySymbols(rows, symbols), extras: [], metadata };
	}

	// Earnings Calendar for a long list of symbols: the tool takes 25 per call, so each
	// batch is read on its own and the results are merged by date, as the tool sorts them.
	const filter = baseArguments.symbols;
	if (spec.paging === 'offset' && Array.isArray(filter) && filter.length > SYMBOLS_PER_CALL) {
		const rows: IDataObject[] = [];
		let metadata: IDataObject = {};
		for (const batch of chunk(filter as string[], SYMBOLS_PER_CALL)) {
			const part = await fetchRows.call(
				this,
				spec,
				toolName,
				{ ...baseArguments, symbols: batch },
				wanted,
				itemIndex,
			);
			rows.push(...part.rows);
			const total =
				((metadata.total_in_window as number) ?? 0) +
				((part.metadata.total_in_window as number) ?? 0);
			metadata = { ...part.metadata, total_in_window: total };
		}
		const byDate = (row: IDataObject) => String(row.earnings_date ?? '');
		const sorted = rows
			.map((row, index) => ({ row, index }))
			.sort((a, b) => byDate(a.row).localeCompare(byDate(b.row)) || a.index - b.index)
			.map((entry) => entry.row);
		return { rows: wanted === undefined ? sorted : sorted.slice(0, wanted), extras: [], metadata };
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

/** Where the symbols of one call came from, already cleaned. */
interface SymbolPlan {
	source: SymbolSource;
	list: SymbolList;
}

/** The list of symbols one item (or, for From input items / From my watchlist, the whole
 * run) works on. */
function manualPlan(this: IExecuteFunctions, i: number): SymbolPlan {
	const raw = this.getNodeParameter('symbols', i, '') as string;
	// Nothing typed (or only commas) is an empty list, not a list with an empty ticker.
	if (raw.replace(/[\s,]/g, '') === '') {
		return { source: 'manual', list: { symbols: [], invalid: [], duplicates: 0 } };
	}
	return { source: 'manual', list: buildSymbolList([{ value: raw, item: i }]) };
}

async function planFor(
	this: IExecuteFunctions,
	source: SymbolSource,
	items: INodeExecutionData[],
): Promise<SymbolPlan> {
	if (source === 'fromInput') {
		// One value per input item: usually {{ $json.ticker }}, evaluated for each of them.
		const sources = items.map((_, i) => ({
			value: this.getNodeParameter('symbolsFromInput', i, ''),
			item: i,
		}));
		return { source, list: buildSymbolList(sources) };
	}
	// From my watchlist (Pro): the same list for every item, so it is read once.
	const response = await stocklakeApiRequest.call(this, 'get_watchlist', {}, 0);
	const entries = Array.isArray(response.items) ? (response.items as IDataObject[]) : [];
	return { source, list: buildSymbolList(entries.map((e) => ({ value: e.symbol, item: 0 }))) };
}

function invalidItems(plan: SymbolPlan): INodeExecutionData[] {
	return plan.list.invalid.map((entry) => ({
		json: { symbol: entry.input, valid: false, error: entry.reason },
		pairedItem: { item: entry.item },
	}));
}

async function itemOutput(
	this: IExecuteFunctions,
	i: number,
	plan: SymbolPlan | undefined,
): Promise<INodeExecutionData[]> {
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

	// Operations that take a list of tickers: the cleaned list replaces the raw one.
	const symbolOperation = SYMBOL_OPERATIONS[`${resource}.${operation}`];
	let callArguments = toolArguments;
	let skipCall = false;
	let symbolMeta: IDataObject = {};
	let invalidOutput: INodeExecutionData[] = [];
	let pairedItemOf: (symbol: unknown) => number | undefined = () => undefined;
	if (symbolOperation) {
		const chosen = this.getNodeParameter(
			'symbolSource',
			i,
			symbolOperation.defaultSource,
		) as SymbolSource;
		const own: SymbolPlan =
			plan ??
			(chosen === 'all'
				? { source: 'all', list: { symbols: [], invalid: [], duplicates: 0 } }
				: manualPlan.call(this, i));
		const { symbols, invalid, duplicates } = own.list;
		const names = symbols.map((s) => s.symbol);
		if (own.source === 'all') {
			delete callArguments.symbols;
		} else if (names.length > 0) {
			callArguments = { ...toolArguments, symbols: names };
		} else {
			delete callArguments.symbols;
			skipCall = true;
			if (invalid.length === 0 && own.source === 'manual') {
				throw new NodeOperationError(this.getNode(), 'Add at least one ticker symbol', {
					itemIndex: i,
					description: 'The Symbols field is empty.',
				});
			}
		}
		const cost = estimateCost(names.length);
		symbolMeta = {
			symbols_used: names.length,
			invalid_symbols: invalid.length,
			duplicates_removed: duplicates,
			estimated_calls: cost.calls,
			requests: cost.requests,
		};
		pairedItemOf = itemBySymbol(symbols);
		invalidOutput = invalidItems(own);
	}

	const fetched = skipCall
		? { rows: [] as IDataObject[], extras: [] as IDataObject[], metadata: {} as IDataObject }
		: await fetchRows.call(this, spec, toolName, callArguments, wanted, i);

	const meta = includeMetadata ? { _meta: { ...fetched.metadata, ...symbolMeta } } : {};
	const shaped = [...fetched.extras, ...fetched.rows].map((row) => ({
		json: {
			...(simplify ? simplifyRow(row, spec.simplify) : row),
			...meta,
		} as IDataObject,
		pairedItem: { item: pairedItemOf(row.symbol) ?? i },
	}));

	// No rows: nothing to pass on, unless the caller asked for the metadata, which
	// is then the only place a note such as "no data in this window" is visible.
	if (shaped.length === 0 && invalidOutput.length === 0 && includeMetadata) {
		return [{ json: meta as IDataObject, pairedItem: { item: i } }];
	}
	return [...shaped, ...invalidOutput];
}

/**
 * Node version 2: one output item per row for list-shaped operations (Simplify,
 * Return All / Limit and optional metadata apply), the whole response as one item
 * for every other operation. Every output item is paired with its input item.
 *
 * Operations that take a list of tickers have a Symbol Source. With "From input items"
 * or "From my watchlist" the node runs once for the whole input, not once per item, and
 * each row is paired with the input item that supplied its ticker.
 */
export async function executeRows(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
	const items = this.getInputData();
	const returnData: INodeExecutionData[] = [];
	const resource = this.getNodeParameter('resource', 0) as string;
	const operation = this.getNodeParameter('operation', 0) as string;
	const symbolOperation = SYMBOL_OPERATIONS[`${resource}.${operation}`];

	const guarded = async (i: number, work: () => Promise<INodeExecutionData[]>) => {
		if (!this.continueOnFail()) return await work();
		try {
			return await work();
		} catch (error) {
			return [{ json: { error: (error as Error).message }, pairedItem: { item: i } }];
		}
	};

	let source: SymbolSource | undefined;
	if (symbolOperation) {
		source = this.getNodeParameter(
			'symbolSource',
			0,
			symbolOperation.defaultSource,
		) as SymbolSource;
	}

	// Before the first call, say what the run will cost when it is large.
	let plans: Array<SymbolPlan | undefined> = items.map(() => undefined);
	let shared: SymbolPlan | undefined;
	if (symbolOperation && source) {
		if (source === 'fromInput' || source === 'fromWatchlist') {
			if (!this.continueOnFail()) {
				shared = await planFor.call(this, source, items);
			} else {
				try {
					shared = await planFor.call(this, source, items);
				} catch (error) {
					return [[{ json: { error: (error as Error).message }, pairedItem: { item: 0 } }]];
				}
			}
		} else if (source === 'manual') {
			plans = items.map((_, i) => manualPlan.call(this, i));
		}
		const own = shared ? [shared] : (plans as SymbolPlan[]);
		const calls = own.reduce((sum, p) => sum + (p?.list.symbols.length ?? 0), 0);
		if (calls > LARGE_BATCH_CALLS) {
			this.addExecutionHints?.({
				message: costNotice(estimateCost(calls)),
				location: 'outputPane',
			});
		}
	}

	if (shared) {
		returnData.push(...(await guarded(0, () => itemOutput.call(this, 0, shared))));
		return [returnData];
	}
	for (let i = 0; i < items.length; i++) {
		returnData.push(...(await guarded(i, () => itemOutput.call(this, i, plans[i]))));
	}
	return [returnData];
}
