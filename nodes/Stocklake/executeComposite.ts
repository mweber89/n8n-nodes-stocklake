import type { IDataObject, IExecuteFunctions, INodeExecutionData } from 'n8n-workflow';
import { NodeApiError, NodeOperationError } from 'n8n-workflow';

import { csvItem, csvSubject } from './csv';
import type { CsvOptions } from './csv';
import { runStopped, stocklakeApiRequest } from './GenericFunctions';
import {
	COMPARE_MAX_SYMBOLS,
	COMPARE_MIN_SYMBOLS,
	PRO_COLUMNS,
	RANK_COLUMNS,
	hasProFields,
	holdingRow,
	insiderSales,
	mergeLots,
	num,
	parseHolding,
	proColumns,
	quoteColumns,
	rankRows,
	snapshotFrom,
	summarize,
	withWeights,
} from './composites';
import type { CostIs, Earnings, HoldingRules, InsiderSales, ParsedHolding } from './composites';
import {
	errorItem,
	fetchRows,
	invalidItems,
	manualPlan,
	planFor,
	withAllowance,
	NOT_FOUND,
} from './executeRows';
import type { SymbolPlan } from './executeRows';
import { LIST_SPECS, SYMBOLS_PER_CALL, chunk } from './rows';
import { LARGE_BATCH_CALLS, itemBySymbol, lookupKeys } from './symbols';
import type { SymbolSource } from './symbols';

/** The operations that combine several calls (node version 2). */
export const COMPOSITE_OPERATIONS = new Set([
	'stock.compare',
	'stock.snapshot',
	'portfolio.checkHoldings',
]);


function hint(context: IExecuteFunctions, message: string) {
	context.addExecutionHints?.({ message, location: 'outputPane' });
}

function isRecord(value: unknown): value is IDataObject {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** An error that every further call would hit too (no or rejected credential, a limit):
 * carrying on with the other symbols would only repeat it. */
function endsTheRun(context: IExecuteFunctions, error: unknown): boolean {
	if (runStopped(context)) return true;
	return error instanceof NodeApiError && ['401', '403', '429'].includes(String(error.httpCode));
}

type NodeFailure = NodeApiError | NodeOperationError;

/** One tool call whose failure is returned, not thrown, so the caller can decide whether the
 * run goes on. Every failure of `stocklakeApiRequest` is already a node error. */
async function request(
	context: IExecuteFunctions,
	tool: string,
	args: IDataObject,
	itemIndex: number,
): Promise<{ response: IDataObject; error?: undefined } | { error: NodeFailure }> {
	try {
		return { response: await stocklakeApiRequest.call(context, tool, args, itemIndex) };
	} catch (error) {
		return { error: error as NodeFailure };
	}
}

interface StockRead {
	/** The stocks the API returned. */
	stocks: IDataObject[];
	/** Symbols the API says it does not know. */
	missing: Set<string>;
	/** Symbols whose request failed, with why. */
	failed: Map<string, string>;
	firstError?: NodeFailure;
}

/**
 * Reads the stocks of one batch (at most 25 symbols). A request that fails because of
 * its arguments is split in halves until the symbol that causes it stands alone, so one
 * bad symbol costs only itself. A failure that would repeat for every symbol (limit,
 * credential) ends the run instead.
 */
async function readBatch(
	this: IExecuteFunctions,
	batch: string[],
	itemIndex: number,
	out: StockRead,
): Promise<void> {
	const attempt = await request(this, 'get_stocks', { symbols: batch }, itemIndex);
	if (attempt.error === undefined) {
		const { response } = attempt;
		const stocks = isRecord(response.symbols) ? Object.values(response.symbols) : [];
		for (const stock of stocks) if (isRecord(stock)) out.stocks.push(stock);
		const missing = Array.isArray(response.missing) ? response.missing : [];
		for (const symbol of missing) out.missing.add(String(symbol).toUpperCase());
		return;
	}
	const { error } = attempt;
	if (endsTheRun(this, error)) throw error;
	out.firstError ??= error;
	if (error instanceof NodeOperationError && batch.length > 1) {
		const half = Math.ceil(batch.length / 2);
		await readBatch.call(this, batch.slice(0, half), itemIndex, out);
		await readBatch.call(this, batch.slice(half), itemIndex, out);
		return;
	}
	for (const symbol of batch) out.failed.set(symbol, error.message);
}

/** Reads any number of symbols, 25 per request. Throws when nothing could be read. */
async function readStocks(
	this: IExecuteFunctions,
	symbols: string[],
	itemIndex: number,
): Promise<StockRead & { find: (symbol: string) => IDataObject | undefined }> {
	const out: StockRead = { stocks: [], missing: new Set(), failed: new Map() };
	for (const batch of chunk(symbols, SYMBOLS_PER_CALL)) {
		await readBatch.call(this, batch, itemIndex, out);
	}
	if (out.stocks.length === 0 && out.missing.size === 0 && out.firstError !== undefined) {
		throw out.firstError;
	}
	const byKey = new Map<string, IDataObject>();
	for (const stock of out.stocks) {
		for (const key of lookupKeys(String(stock.symbol ?? ''))) byKey.set(key, stock);
	}
	const find = (symbol: string) => {
		for (const key of lookupKeys(symbol)) {
			const stock = byKey.get(key);
			if (stock) return stock;
		}
		return undefined;
	};
	return { ...out, find };
}

function notFoundRow(symbol: string, read: StockRead): IDataObject {
	return {
		symbol,
		found: false,
		error: read.failed.get(symbol) ?? NOT_FOUND,
	};
}

// ------------------------------------------------------------------ Compare

async function compareRun(
	this: IExecuteFunctions,
	plan: SymbolPlan,
	i: number,
): Promise<INodeExecutionData[]> {
	const { symbols, invalid } = plan.list;
	if (symbols.length + invalid.length < COMPARE_MIN_SYMBOLS) {
		throw new NodeOperationError(
			this.getNode(),
			`Compare needs at least ${COMPARE_MIN_SYMBOLS} tickers`,
			{
				itemIndex: i,
				description:
					'Add a second ticker to the Symbols field, or use Get to read a single stock.',
			},
		);
	}
	if (symbols.length > COMPARE_MAX_SYMBOLS) {
		throw new NodeOperationError(
			this.getNode(),
			`Compare takes at most ${COMPARE_MAX_SYMBOLS} tickers, got ${symbols.length}`,
			{
				itemIndex: i,
				description:
					'Remove tickers, or use Get Many with Return All, which reads a longer list in several requests.',
			},
		);
	}

	const pairedItemOf = itemBySymbol(symbols);
	const paired = (symbol: string) => ({ item: pairedItemOf(symbol) ?? i });
	const names = symbols.map((s) => s.symbol);
	const rankBy = this.getNodeParameter('rankBy', i, 'none') as string;
	const order = this.getNodeParameter('rankOrder', i, 'desc') as 'asc' | 'desc';
	const rankColumn = RANK_COLUMNS[rankBy];

	const failures: Array<{ json: IDataObject; symbol: string }> = [];
	let rows: IDataObject[] = [];
	if (names.length > 0) {
		const read = await readStocks.call(this, names, i);
		const found: IDataObject[] = [];
		for (const symbol of names) {
			const stock = read.find(symbol);
			if (stock) found.push(stock);
			else failures.push({ symbol, json: notFoundRow(symbol, read) });
		}
		const pro =
			found.some(hasProFields) || (rankColumn !== undefined && PRO_COLUMNS.includes(rankColumn as never));
		rows = found.map((stock) => ({ ...quoteColumns(stock), ...(pro ? proColumns(stock) : {}) }));
		if (rankColumn && PRO_COLUMNS.includes(rankColumn as never) && !found.some(hasProFields)) {
			hint(
				this,
				'Rating and AI score need a Pro account, so the rows could not be ranked by them. They are in the order you gave.',
			);
		}
		if (rankColumn) rows = rankRows(rows, rankColumn, order);
	}

	const options = (this.getNodeParameter('options', i, {}) ?? {}) as IDataObject;
	let output: INodeExecutionData[];
	if (options.downloadCsv === true && rows.length > 0) {
		// Download as CSV: the ranked rows become one file, paired with every input item
		// that supplied a ticker of it. Failed tickers stay items with their error below.
		const from = [...new Set(rows.map((row) => paired(String(row.symbol)).item))];
		output = [
			await csvItem(
				this,
				rows,
				options as CsvOptions,
				{ operation: 'compare', subject: csvSubject(rows.map((row) => String(row.symbol))) },
				from.map((item) => ({ item })),
			),
		];
	} else {
		output = rows.map((json) => ({
			json,
			pairedItem: paired(String(json.symbol)),
		}));
	}
	for (const failure of failures) {
		output.push({ json: failure.json, pairedItem: paired(failure.symbol) });
	}
	output.push(...invalidItems(plan));
	return withAllowance(this, i, output);
}

// ----------------------------------------------------------------- Snapshot

async function snapshotRun(this: IExecuteFunctions, i: number): Promise<INodeExecutionData[]> {
	const symbol = (this.getNodeParameter('symbol', i, '', { extractValue: true }) as string)
		.trim()
		.toUpperCase();
	const stock = await stocklakeApiRequest.call(this, 'get_stock', { symbol }, i);

	const notes: string[] = [];
	let filing: IDataObject | undefined;
	try {
		const response = await stocklakeApiRequest.call(
			this,
			'get_stock_filings',
			{ symbol, limit: 1 },
			i,
		);
		const items = Array.isArray(response.items) ? response.items : [];
		if (isRecord(items[0])) filing = items[0];
	} catch (error) {
		// The quote is worth returning without the filing.
		notes.push(`The latest filing could not be read: ${(error as Error).message}`);
	}

	return withAllowance(this, i, [
		{ json: snapshotFrom(stock, filing, new Date(), notes), pairedItem: { item: i } },
	]);
}

// ----------------------------------------------------------------- Holdings

interface HoldingOptions {
	costIs: CostIs;
	rules: HoldingRules;
	checkInsiderSales: boolean;
	output: 'both' | 'holdings' | 'summary';
}

function holdingOptions(context: IExecuteFunctions): HoldingOptions {
	const chosen = (context.getNodeParameter('holdingOptions', 0, {}) ?? {}) as IDataObject;
	return {
		costIs: chosen.costIs === 'total' ? 'total' : 'perShare',
		rules: {
			overbought: num(chosen.overboughtAbove) ?? 70,
			oversold: num(chosen.oversoldBelow) ?? 30,
			earningsWithinDays: num(chosen.earningsWithinDays) ?? 7,
			insiderSaleUsd: num(chosen.insiderSaleUsd) ?? 1_000_000,
		},
		checkInsiderSales: chosen.checkInsiderSales !== false,
		output:
			chosen.output === 'holdings' || chosen.output === 'summary'
				? (chosen.output as 'holdings' | 'summary')
				: 'both',
	};
}

/** The earnings calendar for the holdings: date and whether it is an estimate, by symbol. */
async function readEarnings(
	this: IExecuteFunctions,
	symbols: string[],
	days: number,
	notes: string[],
): Promise<(symbol: string) => Earnings | undefined> {
	const byKey = new Map<string, Earnings>();
	try {
		const spec = LIST_SPECS['earnings.getCalendar'];
		const { rows } = await fetchRows.call(
			this,
			spec,
			'get_earnings_calendar',
			{ days, symbols },
			undefined,
			0,
		);
		for (const row of rows) {
			if (typeof row.earnings_date !== 'string') continue;
			const entry: Earnings = {
				date: row.earnings_date,
				isEstimate: typeof row.is_estimate === 'boolean' ? row.is_estimate : null,
			};
			for (const key of lookupKeys(String(row.symbol ?? ''))) byKey.set(key, entry);
		}
	} catch (error) {
		notes.push(
			`The earnings calendar could not be read, so earnings dates come from each stock's own data: ${(error as Error).message}`,
		);
	}
	return (symbol) => {
		for (const key of lookupKeys(symbol)) {
			const entry = byKey.get(key);
			if (entry) return entry;
		}
		return undefined;
	};
}

async function checkHoldingsRun(this: IExecuteFunctions): Promise<INodeExecutionData[]> {
	const items = this.getInputData();
	const options = holdingOptions(this);
	const allItems = items.map((_, k) => ({ item: k }));
	const notes: string[] = [];

	// 1. Every input item is a lot; a bad one is reported against its item, not fatal.
	const output: INodeExecutionData[] = [];
	const lots: Array<{ symbol: string; quantity: number; costPerShare?: number; item: number }> = [];
	items.forEach((_, k) => {
		const parsed: ParsedHolding = parseHolding(
			{
				symbol: this.getNodeParameter('holdingSymbol', k, ''),
				quantity: this.getNodeParameter('holdingQuantity', k, ''),
				cost: this.getNodeParameter('holdingCost', k, ''),
			},
			options.costIs,
		);
		if (parsed.ok) {
			lots.push({
				symbol: parsed.symbol,
				quantity: parsed.quantity,
				costPerShare: parsed.costPerShare,
				item: k,
			});
		} else {
			output.push({
				json: { kind: 'holding', symbol: parsed.symbol, valid: false, error: parsed.error },
				pairedItem: { item: k },
			});
		}
	});
	const holdings = mergeLots(lots);
	if (items.length === 0 || (holdings.length === 0 && output.length === 0)) {
		throw new NodeOperationError(this.getNode(), 'There are no holdings to check', {
			description:
				'Send one input item per holding, each with a symbol and a quantity (and optionally a cost).',
		});
	}

	if (holdings.length > LARGE_BATCH_CALLS) {
		hint(
			this,
			`About ${holdings.length} calls against your daily allowance: each ticker counts as one call, and a Pro account adds one call per holding for the insider sales.`,
		);
	}

	// 2. Quotes, 25 symbols per request.
	const names = holdings.map((h) => h.symbol);
	const rows: Array<{ row: IDataObject; items: number[] }> = [];
	let failed = output.length;
	let proSeen = false;
	const stockRows: Array<{ holding: (typeof holdings)[number]; stock: IDataObject }> = [];
	const unreadable: Array<{ symbol: string; quantity: number; items: number[]; error: string }> = [];
	if (names.length > 0) {
		const read = await readStocks.call(this, names, 0);
		for (const holding of holdings) {
			const stock = read.find(holding.symbol);
			if (stock && num(stock.price) !== undefined) {
				stockRows.push({ holding, stock });
			} else {
				unreadable.push({
					symbol: holding.symbol,
					quantity: holding.quantity,
					items: holding.items,
					error: stock ? 'Stocklake has no price for this symbol' : notFoundRow(holding.symbol, read).error as string,
				});
			}
		}
		proSeen = stockRows.some(({ stock }) => hasProFields(stock));
	}

	// 3. Earnings: the calendar first, each stock's own date where the calendar has none.
	const now = new Date();
	const priced = stockRows.map(({ holding }) => holding.symbol);
	let earningsOf: (symbol: string) => Earnings | undefined = () => undefined;
	if (priced.length > 0) {
		earningsOf = await readEarnings.call(this, priced, options.rules.earningsWithinDays, notes);
	}

	// 4. Large insider sales, Pro only: one call per holding.
	const insiderOf = new Map<string, InsiderSales>();
	let insiderFailures = 0;
	if (options.checkInsiderSales && priced.length > 0) {
		if (!proSeen) {
			notes.push('Large insider sales were not checked: that needs a Pro account.');
			hint(this, 'Large insider sales are checked on a Pro account only, so that flag was skipped.');
		} else {
			for (const symbol of priced) {
				if (runStopped(this)) {
					insiderFailures += 1;
					continue;
				}
				try {
					const response = await stocklakeApiRequest.call(
						this,
						'get_insider_activity',
						{ symbol },
						0,
					);
					insiderOf.set(symbol, insiderSales(response, now));
				} catch {
					insiderFailures += 1;
				}
			}
			if (insiderFailures > 0) {
				notes.push(
					`The insider sales of ${insiderFailures} holding(s) could not be read, so they carry no insider flag.`,
				);
			}
		}
	}

	// 5. Value and flag every holding, then weigh them against the total.
	const built = stockRows.map(({ holding, stock }) => ({
		holding,
		row: holdingRow({
			holding,
			stock,
			rules: options.rules,
			now,
			earnings: earningsOf(holding.symbol),
			insider: insiderOf.get(holding.symbol),
		}),
	}));
	const weighted = withWeights(built.map((entry) => entry.row));
	built.forEach((entry, index) => {
		rows.push({ row: weighted[index], items: entry.holding.items });
	});
	for (const bad of unreadable) {
		failed += 1;
		rows.push({
			row: {
				kind: 'holding',
				symbol: bad.symbol,
				quantity: bad.quantity,
				found: false,
				error: bad.error,
			},
			items: bad.items,
		});
	}

	const summary = summarize(
		rows.map((entry) => entry.row).filter((row) => row.found !== false),
		failed,
		notes,
	);

	if (options.output !== 'summary') {
		output.push(
			...rows.map((entry) => ({
				json: entry.row,
				pairedItem: entry.items.map((item) => ({ item })),
			})),
		);
	} else {
		output.length = 0;
	}
	if (options.output !== 'holdings') output.push({ json: summary, pairedItem: allItems });
	return withAllowance(this, 0, output);
}

// -------------------------------------------------------------------- Entry

function compareSource(context: IExecuteFunctions): SymbolSource {
	return context.getNodeParameter('symbolSource', 0, 'manual') as SymbolSource;
}

/**
 * Runs one of the composite operations. Like the list operations, each one is paired with
 * its input items; a failure becomes an error item when Continue On Fail is on.
 */
export async function executeComposite(
	this: IExecuteFunctions,
	key: string,
): Promise<INodeExecutionData[][]> {
	const items = this.getInputData();
	const allItems = items.map((_, k) => ({ item: k }));
	const guarded = async (
		work: () => Promise<INodeExecutionData[]>,
		pairedItem: INodeExecutionData['pairedItem'],
	): Promise<INodeExecutionData[]> => {
		if (!this.continueOnFail()) return await work();
		try {
			return await work();
		} catch (error) {
			return [errorItem(error, pairedItem)];
		}
	};

	const returnData: INodeExecutionData[] = [];

	if (key === 'portfolio.checkHoldings') {
		returnData.push(...(await guarded(() => checkHoldingsRun.call(this), allItems)));
		return [returnData];
	}

	if (key === 'stock.snapshot') {
		for (let i = 0; i < items.length; i++) {
			returnData.push(...(await guarded(() => snapshotRun.call(this, i), { item: i })));
		}
		return [returnData];
	}

	// Stock > Compare: a manual list is compared per input item; tickers collected from
	// the input items are compared together, once.
	if (compareSource(this) === 'fromInput') {
		// Collecting the tickers cannot fail, so a plan is always there.
		const plan: SymbolPlan = await planFor.call(this, 'fromInput', items);
		returnData.push(...(await guarded(() => compareRun.call(this, plan, 0), allItems)));
		return [returnData];
	}
	for (let i = 0; i < items.length; i++) {
		returnData.push(
			...(await guarded(() => compareRun.call(this, manualPlan.call(this, i), i), { item: i })),
		);
	}
	return [returnData];
}
