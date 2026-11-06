import type { INodePropertyOptions } from 'n8n-workflow';

/**
 * The values behind every dropdown that is loaded from Stocklake, as they were when this
 * was written. They are what the editor shows when the load fails (offline, rate limited,
 * a guest whose daily calls are used up) and what a free credential gets for the options
 * that would need a Pro-only call to load.
 */
export const FALLBACK_VALUES = {
	sectors: [
		'Basic Materials',
		'Communication Services',
		'Consumer Cyclical',
		'Consumer Defensive',
		'Energy',
		'Financial Services',
		'Healthcare',
		'Industrials',
		'Real Estate',
		'Technology',
		'Utilities',
	],
	presets: ['high_conviction', 'momentum', 'overbought', 'oversold'],
	signalSources: ['news', 'screener', 'sentiment'],
	signalDirections: ['POSITIVE', 'NEGATIVE', 'NEUTRAL'],
	activityTypes: ['news', 'filing', 'insider', 'earnings', 'analyst', 'setup'],
};

export type OptionKind = 'presets' | 'signalSources' | 'signalDirections' | 'activityTypes';

/** Friendly names for values the API is known to return. A value the API adds later is
 * shown title-cased, so a new preset or type appears without a node release. */
const LABELS: Record<OptionKind, Record<string, string>> = {
	// Presets that need a Pro account are marked in the name.
	presets: { high_conviction: 'High Conviction (Pro)' },
	signalSources: {},
	signalDirections: { NEUTRAL: 'Neutral / Two-Sided' },
	activityTypes: { analyst: 'Analyst Change' },
};

export function titleCase(value: string): string {
	return value
		.split(/[_\s]+/)
		.filter((part) => part.length > 0)
		.map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
		.join(' ');
}

export function labelFor(kind: OptionKind, value: string): string {
	return LABELS[kind][value] ?? titleCase(value);
}

/** Turns accepted values into dropdown options, sorted by name, with an optional leading
 * entry that stands for "no filter". */
export function toOptions(
	kind: OptionKind | 'sectors',
	values: string[],
	leading?: INodePropertyOptions,
): INodePropertyOptions[] {
	const options = [...new Set(values)].map((value) => ({
		name: kind === 'sectors' ? value : labelFor(kind, value),
		value,
	}));
	options.sort((a, b) => a.name.localeCompare(b.name));
	return leading ? [leading, ...options] : options;
}

/** Countries that have stocks in the universe. The API gives no list of them (its error
 * for an unknown country does not name the accepted ones), so this stays a fixed list;
 * an expression can still pass any name the API accepts. */
export const COUNTRY_OPTIONS: INodePropertyOptions[] = [
	'Argentina',
	'Australia',
	'Austria',
	'Bahamas',
	'Belgium',
	'Bermuda',
	'Brazil',
	'Bulgaria',
	'Canada',
	'Cayman Islands',
	'Chile',
	'China',
	'Colombia',
	'Cyprus',
	'Czech Republic',
	'Denmark',
	'Finland',
	'France',
	'Germany',
	'Greece',
	'Guernsey',
	'Hong Kong',
	'India',
	'Indonesia',
	'Ireland',
	'Israel',
	'Italy',
	'Japan',
	'Jersey',
	'Kazakhstan',
	'Liechtenstein',
	'Lithuania',
	'Luxembourg',
	'Macau',
	'Malaysia',
	'Mexico',
	'Monaco',
	'Netherlands',
	'Norway',
	'Panama',
	'Peru',
	'Philippines',
	'Singapore',
	'South Africa',
	'South Korea',
	'Spain',
	'Sweden',
	'Switzerland',
	'Taiwan',
	'Turkey',
	'United Arab Emirates',
	'United Kingdom',
	'United States',
	'Uruguay',
].map((name) => ({ name, value: name }));
