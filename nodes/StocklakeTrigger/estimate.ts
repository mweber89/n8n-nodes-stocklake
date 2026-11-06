import type { EventKind } from './events';

/**
 * What a Stocklake Trigger costs against the daily allowance. Every check calls the API,
 * and a list tool counts one call per row it returns, so the figure is an upper bound:
 * checks a day times the calls one check can use. Pure functions, unit-tested.
 */

/** Daily calls of a guest, a free and a Pro account. */
export const GUEST_LIMIT = 25;
export const FREE_LIMIT = 200;
export const PRO_LIMIT = 5000;

/** Checks closer together than this get a warning. */
export const WARN_BELOW_MINUTES = 15;
export const DEFAULT_MINUTES = 60;
export const MIN_MINUTES = 1;
export const MAX_MINUTES = 1440;

export interface EstimateInput {
	event: EventKind;
	/** Stocks checked; undefined when the list is the watchlist, whose size is not known here. */
	symbols?: number;
	/** Minutes between two checks. */
	minutes: number;
	/** Signals read per check (Max Signals per Check). */
	limit?: number;
	/** Filings read per stock per check. */
	filings?: number;
}

export interface Estimate {
	checksPerDay: number;
	/** Calls one check can use; undefined when it depends on the size of the watchlist. */
	callsPerCheck?: number;
	callsPerDay?: number;
}

/** Most signals read per check and filings read per stock: also the defaults of the fields. */
export const DEFAULT_SIGNAL_LIMIT = 10;
export const DEFAULT_FILINGS = 2;

export function checksPerDay(minutes: number): number {
	return Math.round(1440 / Math.min(MAX_MINUTES, Math.max(MIN_MINUTES, minutes)));
}

/** Calls of one check: a signal check reads up to `limit` rows; the stock events read
 * every stock once (a filing check up to `filings` rows per stock). */
export function callsPerCheck(input: EstimateInput): number | undefined {
	if (input.event === 'signal') return Math.max(1, input.limit ?? DEFAULT_SIGNAL_LIMIT);
	if (input.symbols === undefined) return undefined;
	const per = input.event === 'filing' ? Math.max(1, input.filings ?? DEFAULT_FILINGS) : 1;
	return Math.max(1, input.symbols * per);
}

export function estimate(input: EstimateInput): Estimate {
	const checks = checksPerDay(input.minutes);
	const per = callsPerCheck(input);
	return {
		checksPerDay: checks,
		callsPerCheck: per,
		callsPerDay: per === undefined ? undefined : checks * per,
	};
}

function minutesText(minutes: number): string {
	if (minutes % 1440 === 0) return minutes === 1440 ? 'day' : `${minutes / 1440} days`;
	if (minutes % 60 === 0) return minutes === 60 ? 'hour' : `${minutes / 60} hours`;
	return minutes === 1 ? 'minute' : `${minutes} minutes`;
}

/** Signals need Pro, so they are weighed against a Pro account; the other events against
 * a free one (and Pro, when it is more than that too). */
function overAllowance(event: EventKind, callsPerDay: number): string | undefined {
	const pro = PRO_LIMIT.toLocaleString('en-US');
	if (event === 'signal') {
		return callsPerDay > PRO_LIMIT
			? `That is more than the ${pro} calls a day of a Pro account: read fewer signals or check less often.`
			: undefined;
	}
	if (callsPerDay <= FREE_LIMIT) return undefined;
	return `That is more than the ${FREE_LIMIT} calls a day of a free account${
		callsPerDay > PRO_LIMIT ? ` and the ${pro} of Pro` : ''
	}: use fewer stocks or check less often.`;
}

/** The sentence shown to the user. */
export function estimateText(input: EstimateInput): string {
	const e = estimate(input);
	const every = `every ${minutesText(input.minutes)}`;
	const parts: string[] = [];
	if (e.callsPerDay === undefined) {
		parts.push(
			`A check ${every} is ${e.checksPerDay} checks a day, each using one call per stock on your watchlist, so about ${e.checksPerDay} calls a day per stock.`,
		);
	} else {
		parts.push(
			`About ${e.callsPerDay.toLocaleString('en-US')} calls a day at most: ${e.checksPerDay} checks a day (${every}), up to ${e.callsPerCheck} calls each.`,
		);
		const over = overAllowance(input.event, e.callsPerDay);
		if (over) parts.push(over);
	}
	if (input.minutes < WARN_BELOW_MINUTES) {
		parts.push(
			`Checking more often than every ${WARN_BELOW_MINUTES} minutes uses your allowance fast, and most of this data changes less often than that.`,
		);
	}
	return parts.join(' ');
}

/** The short form, for the field that shows the estimate. */
export function estimateTitle(input: EstimateInput): string {
	const e = estimate(input);
	if (e.callsPerDay === undefined) {
		return `One call per watchlist stock, ${e.checksPerDay} times a day`;
	}
	const figure = `Up to ${e.callsPerDay.toLocaleString('en-US')} calls a day`;
	const limit = input.event === 'signal' ? PRO_LIMIT : FREE_LIMIT;
	const who = input.event === 'signal' ? 'a Pro account' : 'a free account';
	return e.callsPerDay > limit ? `${figure} (more than ${who} has)` : figure;
}
