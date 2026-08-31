import type { IExecuteFunctions, IDataObject } from 'n8n-workflow';

import { cleanParams, parseSymbolList } from './GenericFunctions';

export interface ToolCall {
	toolName: string;
	toolArguments: IDataObject;
}

/** Resource/operation -> Stocklake MCP tool name + argument mapping. One switch, not
 * seventeen near-identical execute branches, since every operation is "read a few
 * node params, call one tool, return the parsed result" with no cross-tool logic.
 * Pulled into its own module (rather than a private function on the node class) so
 * the mapping — the part most likely to drift from the real API as Stocklake's
 * tools evolve — is unit-testable without a full n8n execution context. */
export function buildToolCall(
	this: IExecuteFunctions,
	resource: string,
	operation: string,
	i: number,
): ToolCall {
	const symbol = (locator: string) =>
		this.getNodeParameter(locator, i, '', { extractValue: true }) as string;

	switch (`${resource}.${operation}`) {
		case 'stock.get':
			return {
				toolName: 'get_stock',
				toolArguments: { symbol: symbol('symbol') },
			};
		case 'stock.getMany':
			return {
				toolName: 'get_stocks',
				toolArguments: {
					symbols: parseSymbolList(this.getNodeParameter('symbols', i, '') as string),
				},
			};
		case 'stock.getHistory':
			return {
				toolName: 'get_stock_history',
				toolArguments: {
					symbol: symbol('symbol'),
					days: this.getNodeParameter('days', i, 90) as number,
				},
			};
		case 'stock.getNews':
			return {
				toolName: 'get_stock_news',
				toolArguments: {
					symbol: symbol('symbol'),
					limit: this.getNodeParameter('limit', i, 10) as number,
					days: this.getNodeParameter('days', i, 30) as number,
				},
			};
		case 'stock.getResearch':
			return {
				toolName: 'get_stock_research',
				toolArguments: { symbol: symbol('symbol') },
			};
		case 'stock.getIndicatorHistory':
			return {
				toolName: 'get_indicator_history',
				toolArguments: {
					symbol: symbol('symbol'),
					days: this.getNodeParameter('days', i, 90) as number,
				},
			};
		case 'stock.getInsiderActivity':
			return {
				toolName: 'get_insider_activity',
				toolArguments: { symbol: symbol('symbol') },
			};

		case 'screener.screen': {
			// additionalFields' own property names are camelCase (n8n convention) but
			// get_screener's real params are snake_case — a previous version of this
			// spread the collection's raw keys straight into toolArguments, which
			// silently sent every one of these filters under the wrong name.
			const additional = this.getNodeParameter('additionalFields', i, {}) as IDataObject;
			return {
				toolName: 'get_screener',
				toolArguments: cleanParams({
					preset: this.getNodeParameter('preset', i, '') as string,
					sector: this.getNodeParameter('sector', i, '') as string,
					limit: this.getNodeParameter('limit', i, 20) as number,
					country: additional.country,
					min_rsi: additional.minRsi,
					max_rsi: additional.maxRsi,
					sma_trend: additional.smaTrend,
					macd_signal: additional.macdSignal,
					min_perf_1d: additional.minPerf1d,
					max_perf_1d: additional.maxPerf1d,
					min_volume: additional.minVolume,
					min_market_cap_b: additional.minMarketCapB,
					max_market_cap_b: additional.maxMarketCapB,
					max_pe_forward: additional.maxPeForward,
					analyst_rating: additional.analystRating,
					min_ai_score: additional.minAiScore,
					sort_by: additional.sortBy,
					sort_dir: additional.sortDir,
				}),
			};
		}

		case 'market.getPulse':
			return { toolName: 'get_market_pulse', toolArguments: {} };
		case 'market.getMovers':
			return {
				toolName: 'get_market_movers',
				toolArguments: cleanParams({
					category: this.getNodeParameter('category', i, 'all') as string,
					limit: this.getNodeParameter('limit', i, 10) as number,
					min_market_cap_b: (this.getNodeParameter('minMarketCapB', i, 0) as number) || undefined,
				}),
			};
		case 'market.getAssessment':
			return {
				toolName: 'get_market_assessment',
				toolArguments: {
					history_count: this.getNodeParameter('historyCount', i, 0) as number,
				},
			};

		case 'sector.getIntelligence':
			return {
				toolName: 'get_sector_intelligence',
				toolArguments: cleanParams({
					sector: this.getNodeParameter('sector', i, '') as string,
					sort_by_strength: this.getNodeParameter('sortByStrength', i, false) as boolean,
					history_count: this.getNodeParameter('historyCount', i, 0) as number,
				}),
			};

		case 'earnings.getCalendar':
			return {
				toolName: 'get_earnings_calendar',
				toolArguments: { days: this.getNodeParameter('days', i, 7) as number },
			};
		case 'earnings.getIntelligence':
			return {
				toolName: 'get_earnings_intelligence',
				toolArguments: cleanParams({
					days_ahead: this.getNodeParameter('daysAhead', i, 14) as number,
					sector: this.getNodeParameter('sector', i, '') as string,
					min_ai_score: (this.getNodeParameter('minAiScore', i, 0) as number) || undefined,
					limit: this.getNodeParameter('limit', i, 25) as number,
				}),
			};

		case 'news.getFeed':
			return {
				toolName: 'get_news_feed',
				toolArguments: {
					min_signal_score: this.getNodeParameter('minSignalScore', i, 60) as number,
					days: this.getNodeParameter('days', i, 3) as number,
					limit: this.getNodeParameter('limit', i, 10) as number,
				},
			};

		case 'signal.getMany':
			return {
				toolName: 'get_signals',
				toolArguments: cleanParams({
					direction: this.getNodeParameter('direction', i, '') as string,
					source: this.getNodeParameter('source', i, '') as string,
					min_signal_score: this.getNodeParameter('minSignalScore', i, 60) as number,
					limit: this.getNodeParameter('limit', i, 50) as number,
				}),
			};

		case 'watchlist.get':
			return { toolName: 'get_watchlist', toolArguments: {} };

		default:
			throw new Error(`Unknown Stocklake operation: ${resource}.${operation}`);
	}
}
