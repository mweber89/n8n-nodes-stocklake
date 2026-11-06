import type { ILoadOptionsFunctions, INodePropertyOptions } from 'n8n-workflow';

import { buildSymbolList } from '../Stocklake/symbols';
import {
	DEFAULT_FILINGS,
	DEFAULT_MINUTES,
	DEFAULT_SIGNAL_LIMIT,
	estimateText,
	estimateTitle,
} from './estimate';
import type { EstimateInput } from './estimate';
import type { EventKind } from './events';

/**
 * The "Estimated Calls per Day" field. A notice cannot show a figure that depends on the
 * other fields, so the field is a dropdown with the one option that says it: n8n loads it
 * again whenever one of the fields it depends on changes. Nothing can be chosen in it.
 */
export const ESTIMATE_DEPENDS_ON = [
	'event',
	'minutesBetweenChecks',
	'symbolSource',
	'symbols',
	'signalLimit',
	'filingsPerSymbol',
];

function numberOf(value: unknown, fallback: number): number {
	const n = Number(value);
	return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** What the dropdown shows for the current values of the fields. */
export function estimateInput(read: (name: string) => unknown): EstimateInput | undefined {
	const event = (read('event') as EventKind | undefined) ?? 'earnings';
	const source =
		(read('symbolSource') as string | undefined) ?? (event === 'signal' ? 'all' : 'manual');
	let symbols: number | undefined;
	if (event !== 'signal') {
		if (source === 'watchlist') symbols = undefined;
		else {
			symbols = buildSymbolList([{ value: read('symbols') ?? '', item: 0 }]).symbols.length;
			if (symbols === 0) return undefined;
		}
	}
	return {
		event,
		symbols,
		minutes: numberOf(read('minutesBetweenChecks'), DEFAULT_MINUTES),
		limit: numberOf(read('signalLimit'), DEFAULT_SIGNAL_LIMIT),
		filings: numberOf(read('filingsPerSymbol'), DEFAULT_FILINGS),
	};
}

export async function getCallEstimate(
	this: ILoadOptionsFunctions,
): Promise<INodePropertyOptions[]> {
	const input = estimateInput((name) => {
		try {
			return this.getCurrentNodeParameter(name);
		} catch {
			return undefined;
		}
	});
	if (!input) {
		return [
			{
				name: 'Add Symbols to See the Estimate',
				value: '',
				description: 'Every stock counts as a call at every check',
			},
		];
	}
	return [{ name: estimateTitle(input), value: '', description: estimateText(input) }];
}
