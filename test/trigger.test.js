'use strict';

const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const { StocklakeTrigger } = require('../dist/nodes/StocklakeTrigger/StocklakeTrigger.node');
const poll = require('../dist/nodes/StocklakeTrigger/poll');
const {
	detectRsi,
	priceCandidates,
	sideOf,
	transactionValue,
} = require('../dist/nodes/StocklakeTrigger/events');
const {
	MAX_SEEN,
	MIN_SEEN,
	capList,
	pickFresh,
	readState,
	remember,
	seenCap,
} = require('../dist/nodes/StocklakeTrigger/state');
const { checksPerDay, estimate, estimateText } = require('../dist/nodes/StocklakeTrigger/estimate');
const { createFakeMcp } = require('./helpers/fakeMcp');
const { runPoll } = require('./helpers/fakePoll');

const node = new StocklakeTrigger();

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
let now = Date.parse('2026-11-06T15:00:00Z');
beforeEach(() => {
	now = Date.parse('2026-11-06T15:00:00Z');
	poll.clock.now = () => now;
});

/** Runs a check; `after` moves the clock first, so a test reads like a timeline. */
async function check(opts, after = 0) {
	now += after;
	return await runPoll(node, opts);
}

// ----------------------------------------------------------- responses

const signal = (symbol, flagged_at, extra = {}) => ({
	symbol,
	direction: 'POSITIVE',
	signal_score: 80,
	source: 'news',
	flagged_at,
	...extra,
});
const signals = (...rows) => ({ count: rows.length, signals: rows });

const stock = (symbol, rsi, change_pct, extra = {}) => ({
	symbol,
	name: `${symbol} Inc.`,
	price: 100,
	change_pct,
	prev_close: 100,
	indicators: rsi === null ? {} : { rsi },
	...extra,
});
const stocks = (...rows) => ({
	count: rows.length,
	symbols: Object.fromEntries(rows.map((r) => [r.symbol, r])),
});

// ======================================================= state: dedup, first check, cap

const row = (id, symbol) => ({ id, symbol, row: { id } });

test('pickFresh: an id that was sent is never sent again', () => {
	const state = { seen: [], known: [] };
	const options = { firstCheck: false, fireExisting: false, cap: 100, checkedSymbols: ['AAPL'] };
	const first = pickFresh([row('a', 'AAPL')], { seen: [], known: ['AAPL'] }, options);
	assert.deepEqual(
		first.fire.map((c) => c.id),
		['a'],
	);
	const second = pickFresh([row('a', 'AAPL'), row('b', 'AAPL')], { ...state, ...first }, options);
	assert.deepEqual(
		second.fire.map((c) => c.id),
		['b'],
	);
});

test('pickFresh: the first check records and fires nothing, unless asked to fire what exists', () => {
	const candidates = [row('a', 'AAPL'), row('b', 'MSFT')];
	const quiet = pickFresh(
		candidates,
		{ seen: [], known: [] },
		{
			firstCheck: true,
			fireExisting: false,
			cap: 100,
			checkedSymbols: ['AAPL', 'MSFT'],
		},
	);
	assert.deepEqual(quiet.fire, []);
	assert.deepEqual(quiet.seen, ['a', 'b'], 'recorded, so the next check does not announce them');
	assert.deepEqual(quiet.known, ['AAPL', 'MSFT']);

	const loud = pickFresh(
		candidates,
		{ seen: [], known: [] },
		{
			firstCheck: true,
			fireExisting: true,
			cap: 100,
			checkedSymbols: ['AAPL', 'MSFT'],
		},
	);
	assert.deepEqual(
		loud.fire.map((c) => c.id),
		['a', 'b'],
	);
});

test('pickFresh: a stock added after the first check is recorded, not announced; its next event is', () => {
	const options = { firstCheck: false, fireExisting: false, cap: 100 };
	const added = pickFresh(
		[row('old-nvda', 'NVDA')],
		{ seen: [], known: ['AAPL'] },
		{
			...options,
			checkedSymbols: ['AAPL', 'NVDA'],
		},
	);
	assert.deepEqual(added.fire, [], 'what NVDA already had is not news');
	const later = pickFresh([row('old-nvda', 'NVDA'), row('new-nvda', 'NVDA')], added, {
		...options,
		checkedSymbols: ['AAPL', 'NVDA'],
	});
	assert.deepEqual(
		later.fire.map((c) => c.id),
		['new-nvda'],
	);
});

test('pickFresh: a stock with no events yet still gets its baseline, so its first event is announced', () => {
	const options = { firstCheck: true, fireExisting: false, cap: 100, checkedSymbols: ['QUIET'] };
	const first = pickFresh([], { seen: [], known: [] }, options);
	const second = pickFresh([row('x', 'QUIET')], first, { ...options, firstCheck: false });
	assert.deepEqual(
		second.fire.map((c) => c.id),
		['x'],
	);
});

test('state cap: the list of seen ids never grows past the cap and drops the oldest', () => {
	assert.deepEqual(capList([1, 2, 3, 4, 5], 3), [3, 4, 5]);
	assert.deepEqual(remember(['a', 'b', 'c'], ['d', 'e'], 4), ['b', 'c', 'd', 'e']);
	// an id seen again moves to the newest end and is not duplicated
	assert.deepEqual(remember(['a', 'b', 'c'], ['a'], 10), ['b', 'c', 'a']);

	let seen = [];
	for (let i = 0; i < 50; i++) seen = remember(seen, [`id-${i}`], 10);
	assert.equal(seen.length, 10);
	assert.equal(seen[0], 'id-40');
	assert.equal(seen[9], 'id-49');
});

test('state cap: it scales with the number of stocks but stays between the bounds', () => {
	assert.equal(seenCap(0), MIN_SEEN);
	assert.equal(seenCap(10), MIN_SEEN);
	assert.equal(seenCap(120), 1200);
	assert.equal(seenCap(100000), MAX_SEEN);
});

test('readState ignores anything that is not its own state', () => {
	for (const bad of [undefined, null, 'x', [], {}, { version: 99, seen: ['a'] }]) {
		const state = readState(bad);
		assert.equal(state.initialised, false);
		assert.deepEqual(state.seen, []);
	}
	const good = readState({
		version: 1,
		signature: 's',
		initialised: true,
		checkedAt: 5,
		seen: ['a', 3, 'b'],
		known: ['X'],
		rsi: [['A', 50], ['B', 'x'], 'junk'],
	});
	assert.deepEqual(good.seen, ['a', 'b']);
	assert.deepEqual(good.rsi, [['A', 50]]);
	assert.equal(good.initialised, true);
});

// ============================================== threshold crossing (RSI)

const rsiOptions = (extra = {}) => ({
	threshold: 70,
	direction: 'up',
	firstCheck: false,
	fireExisting: false,
	...extra,
});
const quote = (symbol, rsi) => ({ symbol, rsi });

test('RSI: a crossing is a change of side, not "is above"', () => {
	let rsi = [['AAPL', 65]];
	const cross = detectRsi([quote('AAPL', 72)], rsi, rsiOptions());
	assert.equal(cross.events.length, 1);
	assert.equal(cross.events[0].direction, 'up');
	assert.equal(cross.events[0].previous_rsi, 65);
	assert.equal(cross.events[0].rsi, 72);
	rsi = cross.rsi;

	// still above on the next checks: nothing
	for (const value of [73, 80, 71, 70]) {
		const again = detectRsi([quote('AAPL', value)], rsi, rsiOptions());
		assert.deepEqual(again.events, [], `RSI ${value} is still above 70`);
		rsi = again.rsi;
	}
});

test('RSI: exactly on the level counts as above', () => {
	assert.equal(sideOf(70, 70), 'above');
	assert.equal(sideOf(69.99, 70), 'below');
	assert.equal(detectRsi([quote('A', 70)], [['A', 69.9]], rsiOptions()).events.length, 1);
	const down = detectRsi([quote('A', 69.9)], [['A', 70]], rsiOptions({ direction: 'down' }));
	assert.equal(down.events.length, 1);
	assert.equal(down.events[0].direction, 'down');
});

test('RSI: it fires again after the RSI went back and crossed again', () => {
	let rsi = [['A', 60]];
	const fired = [];
	for (const value of [72, 75, 65, 66, 71]) {
		const step = detectRsi([quote('A', value)], rsi, rsiOptions({ direction: 'either' }));
		fired.push(...step.events.map((e) => `${e.direction}@${value}`));
		rsi = step.rsi;
	}
	assert.deepEqual(fired, ['up@72', 'down@65', 'up@71']);
});

test('RSI: the direction filter ignores the other way but keeps the last value up to date', () => {
	let rsi = [['A', 75]];
	const down = detectRsi([quote('A', 60)], rsi, rsiOptions({ direction: 'up' }));
	assert.deepEqual(down.events, [], 'a fall is not an upward crossing');
	rsi = down.rsi;
	assert.deepEqual(rsi, [['A', 60]]);
	assert.equal(detectRsi([quote('A', 71)], rsi, rsiOptions()).events.length, 1);
});

test('RSI: a stock with no previous value, or no RSI, is not announced', () => {
	const first = detectRsi([quote('NEW', 90)], [], rsiOptions());
	assert.deepEqual(first.events, [], 'above on its first reading is not a crossing');
	assert.deepEqual(first.rsi, [['NEW', 90]]);

	const missing = detectRsi([{ symbol: 'NEW' }], first.rsi, rsiOptions());
	assert.deepEqual(missing.rsi, [['NEW', 90]], 'no RSI keeps the old value');
	assert.deepEqual(missing.events, []);
});

test('RSI: Fire on Existing Items announces what is already beyond the level on the first check', () => {
	const result = detectRsi(
		[quote('HOT', 80), quote('COLD', 40)],
		[],
		rsiOptions({ firstCheck: true, fireExisting: true }),
	);
	assert.deepEqual(
		result.events.map((e) => e.symbol),
		['HOT'],
	);
	assert.equal(result.events[0].previous_rsi, null);

	const either = detectRsi(
		[quote('HOT', 80), quote('COLD', 40)],
		[],
		rsiOptions({ firstCheck: true, fireExisting: true, direction: 'either' }),
	);
	assert.deepEqual(
		either.events.map((e) => `${e.symbol}:${e.direction}`),
		['HOT:up', 'COLD:down'],
	);
});

// ===================================================== price move

test('price move: more than the percentage, not equal to it, in the chosen direction', () => {
	const quotes = [
		{ symbol: 'UP', changePct: 5.01, prevClose: 10 },
		{ symbol: 'EQ', changePct: 5, prevClose: 10 },
		{ symbol: 'DOWN', changePct: -6, prevClose: 10 },
		{ symbol: 'QUIET', changePct: 1, prevClose: 10 },
		{ symbol: 'NONE' },
	];
	const either = priceCandidates(quotes, { threshold: 5, direction: 'either' }, now);
	assert.deepEqual(
		either.map((c) => c.symbol),
		['UP', 'DOWN'],
	);
	assert.deepEqual(
		priceCandidates(quotes, { threshold: 5, direction: 'down' }, now).map((c) => c.symbol),
		['DOWN'],
	);
	assert.equal(either[0].row.direction, 'up');
	assert.equal(either[1].row.direction, 'down');
});

test('price move: one id per stock, trading day and direction', () => {
	const id = (q) => priceCandidates([q], { threshold: 5, direction: 'either' }, now)[0].id;
	const monday = { symbol: 'A', changePct: 6, prevClose: 100 };
	assert.equal(
		id(monday),
		id({ ...monday, changePct: 7.5 }),
		'a bigger move the same day is the same event',
	);
	assert.notEqual(
		id(monday),
		id({ ...monday, prevClose: 106 }),
		'the next day has a new previous close',
	);
	assert.notEqual(
		id(monday),
		id({ ...monday, changePct: -6 }),
		'the other direction is a new event',
	);
});

// ===================================================== estimate

test('estimate: checks a day and calls a day for each event', () => {
	assert.equal(checksPerDay(60), 24);
	assert.equal(checksPerDay(15), 96);
	assert.equal(checksPerDay(1), 1440);
	assert.equal(checksPerDay(5000), 1);

	assert.deepEqual(estimate({ event: 'signal', minutes: 60, limit: 10 }), {
		checksPerDay: 24,
		callsPerCheck: 10,
		callsPerDay: 240,
	});
	assert.equal(estimate({ event: 'rsi', symbols: 5, minutes: 60 }).callsPerDay, 120);
	assert.equal(estimate({ event: 'filing', symbols: 5, minutes: 60, filings: 2 }).callsPerDay, 240);
	assert.equal(estimate({ event: 'earnings', symbols: 3, minutes: 1440 }).callsPerDay, 3);
	assert.equal(
		estimate({ event: 'rsi', minutes: 60 }).callsPerDay,
		undefined,
		'a watchlist has no size here',
	);
});

test('estimate: the text gives the figure, warns above a free key and under 15 minutes', () => {
	const hourly = estimateText({ event: 'rsi', symbols: 2, minutes: 60 });
	assert.match(hourly, /About 48 calls a day at most/);
	assert.match(hourly, /every hour/);
	assert.doesNotMatch(hourly, /more often than/);

	const frequent = estimateText({ event: 'rsi', symbols: 2, minutes: 5 });
	assert.match(frequent, /More than|more than the 200/);
	assert.match(frequent, /more often than every 15 minutes/);

	const exactly = estimateText({ event: 'rsi', symbols: 1, minutes: 15 });
	assert.doesNotMatch(exactly, /more often than/, '15 minutes is not under 15');

	assert.match(estimateText({ event: 'rsi', minutes: 60 }), /one call per stock on your watchlist/);
});

// ================================================== the node: description

test('the trigger is a polling trigger with the six events and an hourly default', () => {
	const d = node.description;
	assert.equal(d.polling, true);
	assert.deepEqual(d.group, ['trigger']);
	assert.deepEqual(d.inputs, []);
	assert.equal(d.name, 'stocklakeTrigger');
	const event = d.properties.find((p) => p.name === 'event');
	assert.deepEqual(event.options.map((o) => o.value).sort(), [
		'earnings',
		'filing',
		'insider',
		'price',
		'rsi',
		'signal',
	]);
	const minutes = d.properties.find((p) => p.name === 'minutesBetweenChecks');
	assert.equal(minutes.default, 60);
	assert.equal(typeof node.methods.loadOptions.getSignalDirections, 'function');
	assert.deepEqual(
		d.credentials.map((c) => c.name),
		['stocklakeApi', 'stocklakeOAuth2Api'],
	);
});

test('a notice warns when the interval is under 15 minutes, and not otherwise', () => {
	const notice = node.description.properties.find((p) => p.name === 'frequentNotice');
	assert.deepEqual(notice.displayOptions.show.minutesBetweenChecks, [{ _cnd: { lt: 15 } }]);
	assert.match(notice.displayName, /more often than every 15 minutes/);
});

// ====================================== the node: signals (get_signals, Pro)

test('signals: the first check records and starts nothing; later checks send each new signal once', async () => {
	const staticData = {};
	let answer = signals(
		signal('FRSH', '2026-11-06T14:00:00Z'),
		signal('ADV', '2026-11-06T13:00:00Z'),
	);
	const fake = createFakeMcp({ get_signals: () => answer });
	const opts = { fake, staticData, params: { event: 'signal' } };

	assert.equal(await check(opts), null, 'first check: nothing fires');
	assert.deepEqual(fake.calls[0].arguments, { min_signal_score: 60, limit: 10 });
	assert.equal(staticData.state.initialised, true);

	answer = signals(
		signal('NEW1', '2026-11-06T15:30:00Z'),
		signal('FRSH', '2026-11-06T14:00:00Z'),
		signal('ADV', '2026-11-06T13:00:00Z'),
	);
	const second = await check(opts, HOUR);
	assert.deepEqual(
		second.map((i) => i.symbol),
		['NEW1'],
	);
	assert.equal(second[0].event, 'signal.new');

	assert.equal(await check(opts, HOUR), null, 'the same answer again fires nothing');
});

test('signals: several new ones come out oldest first', async () => {
	const staticData = {};
	let answer = signals(signal('OLD', '2026-11-06T10:00:00Z'));
	const fake = createFakeMcp({ get_signals: () => answer });
	const opts = { fake, staticData, params: { event: 'signal' } };
	await check(opts);
	answer = signals(
		signal('C', '2026-11-06T15:00:00Z'),
		signal('B', '2026-11-06T14:00:00Z'),
		signal('OLD', '2026-11-06T10:00:00Z'),
	);
	assert.deepEqual(
		(await check(opts, HOUR)).map((i) => i.symbol),
		['B', 'C'],
	);
});

test('signals: the same stock flagged again later is a new signal; the same flag is not', async () => {
	const staticData = {};
	let answer = signals(signal('FRSH', '2026-11-05T10:00:00Z'));
	const fake = createFakeMcp({ get_signals: () => answer });
	const opts = { fake, staticData, params: { event: 'signal' } };
	await check(opts);
	answer = signals(signal('FRSH', '2026-11-06T12:00:00Z'), signal('FRSH', '2026-11-05T10:00:00Z'));
	assert.equal((await check(opts, HOUR)).length, 1);
});

test('signals: direction, score and limit go to the API; a change starts a new baseline', async () => {
	const staticData = {};
	const fake = createFakeMcp({ get_signals: () => signals(signal('A', '2026-11-06T10:00:00Z')) });
	const base = { event: 'signal', direction: 'POSITIVE', minSignalScore: 80, signalLimit: 5 };
	await check({ fake, staticData, params: base });
	assert.deepEqual(fake.calls[0].arguments, {
		min_signal_score: 80,
		limit: 5,
		direction: 'POSITIVE',
	});

	// another direction: what the new filter returns was always there, so it is not announced
	const changed = createFakeMcp({
		get_signals: () => signals(signal('B', '2026-11-06T11:00:00Z')),
	});
	assert.equal(
		await check({ fake: changed, staticData, params: { ...base, direction: 'NEGATIVE' } }, HOUR),
		null,
	);
	assert.equal(JSON.parse(staticData.state.signature).direction, 'NEGATIVE');
});

test('signals: a list of stocks filters the answer; the others are remembered, not announced later', async () => {
	const staticData = {};
	let answer = signals(signal('AAPL', '2026-11-06T10:00:00Z'));
	const fake = createFakeMcp({ get_signals: () => answer });
	const only = { event: 'signal', symbolSource: 'manual', symbols: 'aapl' };
	await check({ fake, staticData, params: only });
	answer = signals(
		signal('TSLA', '2026-11-06T14:00:00Z'),
		signal('AAPL', '2026-11-06T13:00:00Z'),
		signal('AAPL', '2026-11-06T10:00:00Z'),
	);
	assert.deepEqual(
		(await check({ fake, staticData, params: only }, HOUR)).map((i) => i.symbol),
		['AAPL'],
	);

	// widening the list later does not release the TSLA signal that was already skipped
	const wide = { ...only, symbols: 'AAPL, TSLA' };
	assert.equal(await check({ fake, staticData, params: wide }, HOUR), null);
});

// ====================================== the node: earnings (get_earnings_calendar)

const earning = (symbol, earnings_date, extra = {}) => ({
	symbol,
	name: symbol,
	earnings_date,
	...extra,
});

test('earnings: each report date is announced once, with the days until it', async () => {
	const staticData = {};
	let answer = { results: [earning('AAPL', '2026-11-12T21:00:00+00:00')] };
	const fake = createFakeMcp({ get_earnings_calendar: () => answer });
	const opts = {
		fake,
		staticData,
		params: { event: 'earnings', symbols: 'AAPL, MSFT', daysAhead: 7 },
	};

	assert.equal(await check(opts), null);
	assert.deepEqual(fake.calls[0].arguments, {
		days: 7,
		symbols: ['AAPL', 'MSFT'],
		limit: 4,
	});

	answer = {
		results: [
			earning('AAPL', '2026-11-12T21:00:00+00:00'),
			earning('MSFT', '2026-11-10T21:00:00+00:00'),
		],
	};
	const out = await check(opts, HOUR);
	assert.deepEqual(
		out.map((i) => i.symbol),
		['MSFT'],
	);
	assert.equal(out[0].event, 'earnings.upcoming');
	assert.equal(out[0].days_until, 4);
	assert.equal(await check(opts, HOUR), null);
});

test('earnings: a date that moves is announced again', async () => {
	const staticData = {};
	let answer = { results: [earning('AAPL', '2026-11-12T21:00:00+00:00', { is_estimate: true })] };
	const fake = createFakeMcp({ get_earnings_calendar: () => answer });
	const opts = { fake, staticData, params: { event: 'earnings', symbols: 'AAPL' } };
	await check(opts);
	answer = { results: [earning('AAPL', '2026-11-12T21:00:00+00:00', { is_estimate: false })] };
	assert.equal(await check(opts, HOUR), null, 'confirming the same date is not news');
	answer = { results: [earning('AAPL', '2026-11-13T21:00:00+00:00')] };
	assert.equal((await check(opts, HOUR)).length, 1);
});

test('earnings: more than 25 stocks are read in batches of 25', async () => {
	const symbols = Array.from({ length: 60 }, (_, i) => `S${i}`);
	const fake = createFakeMcp({ get_earnings_calendar: () => ({ results: [] }) });
	await check({ fake, params: { event: 'earnings', symbols: symbols.join(',') } });
	assert.deepEqual(
		fake.calls.map((c) => c.arguments.symbols.length),
		[25, 25, 10],
	);
});

test('earnings: changing Days Ahead records the new window instead of announcing it', async () => {
	const staticData = {};
	let answer = { results: [] };
	const fake = createFakeMcp({ get_earnings_calendar: () => answer });
	const week = { event: 'earnings', symbols: 'AAPL', daysAhead: 7 };
	await check({ fake, staticData, params: week });
	answer = { results: [earning('AAPL', '2026-11-25T21:00:00+00:00')] };
	assert.equal(await check({ fake, staticData, params: { ...week, daysAhead: 30 } }, HOUR), null);
});

// ====================================== the node: filings (get_stock_filings)

const filing = (accession, filed_at, extra = {}) => ({
	accession,
	symbol: 'AAPL',
	filed_at,
	title: `Apple: ${accession}`,
	...extra,
});

test('filings: one request per stock, each accession announced once', async () => {
	const staticData = {};
	const answers = {
		AAPL: { items: [filing('a-1', '2026-11-02T16:30:00-05:00')] },
		MSFT: { items: [] },
	};
	const fake = createFakeMcp({ get_stock_filings: (args) => answers[args.symbol] });
	const opts = {
		fake,
		staticData,
		params: { event: 'filing', symbols: 'AAPL, MSFT', filingsPerSymbol: 3 },
	};

	assert.equal(await check(opts), null);
	assert.deepEqual(
		fake.calls.map((c) => c.arguments),
		[
			{ symbol: 'AAPL', limit: 3 },
			{ symbol: 'MSFT', limit: 3 },
		],
	);

	answers.AAPL = {
		items: [filing('a-2', '2026-11-06T16:00:00-05:00'), filing('a-1', '2026-11-02T16:30:00-05:00')],
	};
	answers.MSFT = { items: [filing('m-1', '2026-11-06T12:00:00-05:00', { symbol: 'MSFT' })] };
	const out = await check(opts, HOUR);
	assert.deepEqual(out.map((i) => i.accession).sort(), ['a-2', 'm-1']);
	assert.ok(out.every((i) => i.event === 'filing.new'));
	assert.equal(await check(opts, HOUR), null);
});

test('filings: the first filing of a stock that had none is announced', async () => {
	const staticData = {};
	const answers = { AAPL: { items: [] } };
	const fake = createFakeMcp({ get_stock_filings: (args) => answers[args.symbol] });
	const opts = { fake, staticData, params: { event: 'filing', symbols: 'AAPL' } };
	await check(opts);
	answers.AAPL = { items: [filing('first', '2026-11-06T10:00:00-05:00')] };
	assert.equal((await check(opts, HOUR)).length, 1);
});

// ====================================== the node: insider purchases (free plan)

const trade = (name, type, shares, price, date = '2026-11-03T00:00:00+00:00') => ({
	date,
	name,
	role: 'CEO',
	type,
	shares,
	price,
	value: Math.round(shares * price * 100) / 100,
});

test('insider: only purchases above the amount; sales and small buys are not announced', async () => {
	const staticData = {};
	let answer = { transactions: [trade('Old Buyer', 'BUY', 1000, 100)] };
	const fake = createFakeMcp({ get_insider_activity: () => answer });
	const opts = {
		fake,
		staticData,
		params: { event: 'insider', symbols: 'AAPL', minPurchaseUsd: 250000 },
	};
	assert.equal(await check(opts), null);
	assert.deepEqual(fake.calls[0].arguments, { symbol: 'AAPL' });

	answer = {
		transactions: [
			trade('Big Buyer', 'BUY', 5000, 100),
			trade('Small Buyer', 'BUY', 100, 100),
			trade('Seller', 'SELL', 90000, 100),
			trade('Old Buyer', 'BUY', 1000, 100),
		],
	};
	const out = await check(opts, HOUR);
	assert.deepEqual(
		out.map((i) => i.name),
		['Big Buyer'],
	);
	assert.equal(out[0].event, 'insider.purchase');
	assert.equal(out[0].symbol, 'AAPL');
	assert.equal(out[0].value, 500000);
	assert.equal(await check(opts, HOUR), null);
});

test('insider: lowering the amount later does not announce purchases that were already there', async () => {
	const staticData = {};
	const answer = { transactions: [trade('Small Buyer', 'BUY', 100, 100)] };
	const fake = createFakeMcp({ get_insider_activity: () => answer });
	await check({
		fake,
		staticData,
		params: { event: 'insider', symbols: 'AAPL', minPurchaseUsd: 250000 },
	});
	const lowered = { event: 'insider', symbols: 'AAPL', minPurchaseUsd: 1000 };
	assert.equal(await check({ fake, staticData, params: lowered }, HOUR), null);
});

test('insider: a purchase without a value is measured as shares times price', () => {
	assert.equal(transactionValue({ shares: 10, price: 2.5 }), 25);
	assert.equal(transactionValue({ value: 7, shares: 10, price: 2.5 }), 7);
	assert.equal(transactionValue({ shares: 10 }), undefined);
});

// ====================================== the node: RSI and price (get_stocks)

test('RSI through the node: the first check records, a crossing fires once, staying above does not', async () => {
	const staticData = {};
	let answer = stocks(stock('AAPL', 66, 0), stock('MSFT', 40, 0));
	const fake = createFakeMcp({ get_stocks: () => answer });
	const opts = {
		fake,
		staticData,
		params: { event: 'rsi', symbols: 'AAPL, MSFT', rsiThreshold: 70, rsiDirection: 'up' },
	};

	assert.equal(await check(opts), null);
	assert.deepEqual(fake.calls[0].arguments, { symbols: ['AAPL', 'MSFT'] });

	answer = stocks(stock('AAPL', 71.5, 1.2), stock('MSFT', 42, 0));
	const out = await check(opts, HOUR);
	assert.equal(out.length, 1);
	assert.equal(out[0].event, 'rsi.crossed');
	assert.equal(out[0].symbol, 'AAPL');
	assert.equal(out[0].previous_rsi, 66);
	assert.equal(out[0].rsi, 71.5);
	assert.equal(out[0].direction, 'up');
	assert.equal(out[0].threshold, 70);

	answer = stocks(stock('AAPL', 74, 1.2), stock('MSFT', 42, 0));
	assert.equal(await check(opts, HOUR), null, 'still above: no new event');
});

test('RSI through the node: a stock above the level at activation does not fire on later checks', async () => {
	const staticData = {};
	const fake = createFakeMcp({ get_stocks: () => stocks(stock('HOT', 85, 0)) });
	const opts = { fake, staticData, params: { event: 'rsi', symbols: 'HOT' } };
	assert.equal(await check(opts), null);
	assert.equal(await check(opts, HOUR), null);
	assert.equal(await check(opts, HOUR), null);
});

test('RSI through the node: Fire on Existing Items announces it on the first check only', async () => {
	const staticData = {};
	const fake = createFakeMcp({ get_stocks: () => stocks(stock('HOT', 85, 0)) });
	const opts = {
		fake,
		staticData,
		params: { event: 'rsi', symbols: 'HOT', options: { fireOnExisting: true } },
	};
	const first = await check(opts);
	assert.deepEqual(
		first.map((i) => i.symbol),
		['HOT'],
	);
	assert.equal(await check(opts, HOUR), null);
});

test('RSI through the node: a stock added to the list later is recorded first', async () => {
	const staticData = {};
	let answer = stocks(stock('AAPL', 50, 0));
	const fake = createFakeMcp({ get_stocks: () => answer });
	await check({ fake, staticData, params: { event: 'rsi', symbols: 'AAPL' } });
	answer = stocks(stock('AAPL', 50, 0), stock('NVDA', 90, 0));
	const wider = { event: 'rsi', symbols: 'AAPL, NVDA' };
	assert.equal(
		await check({ fake, staticData, params: wider }, HOUR),
		null,
		'NVDA is only recorded',
	);
	answer = stocks(stock('AAPL', 50, 0), stock('NVDA', 60, 0));
	assert.equal(
		await check({ fake, staticData, params: { ...wider, rsiDirection: 'down' } }, HOUR).then(
			(r) => r.length,
		),
		1,
	);
});

test('price move through the node: fires on the move, once per day and direction', async () => {
	const staticData = {};
	let answer = stocks(stock('TSLA', 50, 1), stock('NVDA', 50, 2));
	const fake = createFakeMcp({ get_stocks: () => answer });
	const opts = {
		fake,
		staticData,
		params: { event: 'price', symbols: 'TSLA, NVDA', moveThreshold: 5 },
	};
	assert.equal(await check(opts), null);

	answer = stocks(stock('TSLA', 50, -6.2), stock('NVDA', 50, 2));
	const out = await check(opts, HOUR);
	assert.equal(out.length, 1);
	assert.equal(out[0].event, 'price.moved');
	assert.equal(out[0].symbol, 'TSLA');
	assert.equal(out[0].change_pct, -6.2);
	assert.equal(out[0].direction, 'down');
	assert.equal(out[0].threshold_pct, 5);

	answer = stocks(stock('TSLA', 50, -8), stock('NVDA', 50, 2));
	assert.equal(await check(opts, HOUR), null, 'a bigger fall the same day is the same event');

	answer = stocks(stock('TSLA', 50, -8, { prev_close: 92 }), stock('NVDA', 50, 2));
	assert.equal((await check(opts, HOUR)).length, 1, 'the next trading day it can fire again');
});

test('price move through the node: a stock that already moved at activation does not fire that day', async () => {
	const staticData = {};
	const fake = createFakeMcp({ get_stocks: () => stocks(stock('TSLA', 50, -9)) });
	const opts = { fake, staticData, params: { event: 'price', symbols: 'TSLA' } };
	assert.equal(await check(opts), null);
	assert.equal(await check(opts, HOUR), null);
});

// ====================================== schedule and quota

test('the minimum interval: n8n polls every minute, the node calls the API once an hour', async () => {
	const staticData = {};
	const fake = createFakeMcp({ get_signals: () => signals() });
	const opts = { fake, staticData, params: { event: 'signal' } };
	await check(opts);
	assert.equal(fake.calls.length, 1);

	for (let i = 0; i < 59; i++) assert.equal(await check(opts, MINUTE), null);
	assert.equal(fake.calls.length, 1, 'fifty-nine polls in the hour made no call');

	await check(opts, MINUTE);
	assert.equal(fake.calls.length, 2, 'the hour is up');
});

test('the minimum interval is the one set on the node, down to a minute', async () => {
	const fake = createFakeMcp({ get_signals: () => signals() });
	const opts = { fake, staticData: {}, params: { event: 'signal', minutesBetweenChecks: 5 } };
	await check(opts);
	await check(opts, MINUTE);
	assert.equal(fake.calls.length, 1);
	await check(opts, 4 * MINUTE);
	assert.equal(fake.calls.length, 2);
});

test('a check a few seconds early still counts as on time', async () => {
	const fake = createFakeMcp({ get_signals: () => signals() });
	const opts = { fake, staticData: {}, params: { event: 'signal' } };
	await check(opts);
	await check(opts, HOUR - 5000);
	assert.equal(fake.calls.length, 2);
});

test('a check that fails waits for the interval and the first check is still ahead', async () => {
	const staticData = {};
	let fail = true;
	const fake = createFakeMcp({
		get_signals: () =>
			fail
				? { __httpError: { httpCode: '500', message: 'boom' } }
				: signals(signal('A', '2026-11-06T10:00:00Z')),
	});
	const opts = { fake, staticData, params: { event: 'signal' } };
	await assert.rejects(check(opts));
	assert.equal(staticData.state.initialised, false);
	assert.equal(fake.calls.length, 1);

	fail = false;
	await check(opts, MINUTE);
	// not initialised yet, so the retry goes through at once; and it is the first check
	assert.equal(fake.calls.length, 2);
	assert.equal(staticData.state.initialised, true);
});

test('a state recorded under another version or by hand is replaced, not trusted', async () => {
	const staticData = { state: { version: 99, seen: ['x'], initialised: true } };
	const fake = createFakeMcp({ get_signals: () => signals(signal('A', '2026-11-06T10:00:00Z')) });
	assert.equal(
		await check({ fake, staticData, params: { event: 'signal' } }),
		null,
		'treated as a first check',
	);
	assert.equal(staticData.state.version, 1);
});

test('state cap through the node: static data stays small however many events there were', async () => {
	const staticData = {};
	let n = 0;
	const fake = createFakeMcp({
		get_signals: () =>
			signals(...Array.from({ length: 700 }, () => signal(`S${n++}`, '2026-11-06T10:00:00Z'))),
	});
	const opts = { fake, staticData, params: { event: 'signal' } };
	await check(opts);
	await check(opts, HOUR);
	await check(opts, HOUR);
	assert.equal(staticData.state.seen.length, MIN_SEEN);
	assert.ok(JSON.stringify(staticData).length < 100_000);
});

// ====================================== symbols

test('manual list: tickers are cleaned; a bad one, an empty list or a long one is an error that says so', async () => {
	const fake = createFakeMcp({ get_stocks: () => stocks() });
	await assert.rejects(
		check({ fake, params: { event: 'rsi', symbols: 'AAPL, not a ticker!' } }),
		/Not a ticker: "not a ticker!"/,
	);
	await assert.rejects(
		check({ fake, params: { event: 'rsi', symbols: ' , ' } }),
		/at least one ticker/,
	);
	await assert.rejects(
		check({
			fake,
			params: { event: 'filing', symbols: Array.from({ length: 26 }, (_, i) => `S${i}`).join(',') },
		}),
		/at most 25 stocks, and the list has 26/,
	);
	assert.equal(fake.calls.length, 0, 'nothing was sent for a list that was refused');

	await check({ fake, params: { event: 'rsi', symbols: ' aapl ,msft,AAPL' } });
	assert.deepEqual(fake.calls[0].arguments.symbols, ['AAPL', 'MSFT']);
});

test('watchlist: read once and kept for an hour, then read again', async () => {
	const staticData = {};
	let list = [{ symbol: 'AAPL' }, { symbol: 'MSFT' }];
	const fake = createFakeMcp({
		get_watchlist: () => ({ items: list }),
		get_stocks: () => stocks(stock('AAPL', 50, 0), stock('MSFT', 50, 0)),
	});
	const opts = {
		fake,
		staticData,
		params: { event: 'rsi', symbolSource: 'watchlist', minutesBetweenChecks: 10 },
	};
	await check(opts);
	const watchlistCalls = () => fake.calls.filter((c) => c.toolName === 'get_watchlist').length;
	assert.equal(watchlistCalls(), 1);
	assert.deepEqual(fake.calls[1].arguments.symbols, ['AAPL', 'MSFT']);

	await check(opts, 10 * MINUTE);
	await check(opts, 10 * MINUTE);
	assert.equal(watchlistCalls(), 1, 'twenty minutes later it is still the cached list');

	list = [{ symbol: 'AAPL' }, { symbol: 'MSFT' }, { symbol: 'NVDA' }];
	await check(opts, 40 * MINUTE);
	assert.equal(watchlistCalls(), 2);
	assert.deepEqual(fake.calls[fake.calls.length - 1].arguments.symbols, ['AAPL', 'MSFT', 'NVDA']);
});

test('watchlist: an empty one is an error that says what to do', async () => {
	const fake = createFakeMcp({ get_watchlist: () => ({ items: [] }) });
	await assert.rejects(
		check({ fake, params: { event: 'price', symbolSource: 'watchlist' } }),
		/watchlist is empty/,
	);
});

test('a free key asking for a Pro event gets the plan error of the API, not silence', async () => {
	const fake = createFakeMcp({
		get_signals: () => ({ __toolError: JSON.stringify({ error: 'pro_required', message: 'x' }) }),
	});
	await assert.rejects(
		check({ fake, params: { event: 'signal' } }),
		/requires a Stocklake Pro account/,
	);
});

// ====================================== test mode (manual)

test('test mode: the latest matching event, without touching the saved state or waiting for the interval', async () => {
	const staticData = {};
	const fake = createFakeMcp({
		get_signals: () =>
			signals(
				signal('OLD', '2026-11-06T09:00:00Z'),
				signal('NEWEST', '2026-11-06T14:00:00Z'),
				signal('MID', '2026-11-06T11:00:00Z'),
			),
	});
	const opts = { fake, staticData, mode: 'manual', params: { event: 'signal' } };
	const first = await check(opts);
	assert.deepEqual(
		first.map((i) => i.symbol),
		['NEWEST'],
	);
	assert.deepEqual(staticData, {}, 'nothing saved');
	const second = await check(opts, MINUTE);
	assert.deepEqual(
		second.map((i) => i.symbol),
		['NEWEST'],
		'asked again a minute later, it still answers',
	);
	assert.equal(fake.calls.length, 2);
});

test('test mode: earnings show the next report, filings and insider buys the latest, price the biggest move', async () => {
	const earnings = createFakeMcp({
		get_earnings_calendar: () => ({
			results: [earning('LATE', '2026-11-12T21:00:00Z'), earning('SOON', '2026-11-09T21:00:00Z')],
		}),
	});
	assert.equal(
		(
			await check({
				fake: earnings,
				mode: 'manual',
				params: { event: 'earnings', symbols: 'LATE, SOON' },
			})
		)[0].symbol,
		'SOON',
	);

	const filings = createFakeMcp({
		get_stock_filings: () => ({
			items: [
				filing('old', '2026-11-01T10:00:00-05:00'),
				filing('new', '2026-11-05T10:00:00-05:00'),
			],
		}),
	});
	assert.equal(
		(
			await check({ fake: filings, mode: 'manual', params: { event: 'filing', symbols: 'AAPL' } })
		)[0].accession,
		'new',
	);

	const insider = createFakeMcp({
		get_insider_activity: () => ({
			transactions: [
				trade('A', 'BUY', 5000, 100, '2026-10-01T00:00:00+00:00'),
				trade('B', 'BUY', 5000, 100, '2026-11-02T00:00:00+00:00'),
				trade('C', 'BUY', 1, 100, '2026-11-04T00:00:00+00:00'),
			],
		}),
	});
	assert.equal(
		(
			await check({
				fake: insider,
				mode: 'manual',
				params: { event: 'insider', symbols: 'AAPL', minPurchaseUsd: 1000 },
			})
		)[0].name,
		'B',
	);

	const price = createFakeMcp({
		get_stocks: () => stocks(stock('A', 50, 6), stock('B', 50, -9), stock('C', 50, 1)),
	});
	assert.equal(
		(
			await check({
				fake: price,
				mode: 'manual',
				params: { event: 'price', symbols: 'A, B, C', moveThreshold: 5 },
			})
		)[0].symbol,
		'B',
	);
});

test('test mode: RSI shows a stock that is on the chosen side of the level now', async () => {
	const fake = createFakeMcp({
		get_stocks: () => stocks(stock('LOW', 40, 0), stock('HIGH', 78, 0), stock('NEAR', 71, 0)),
	});
	const out = await check({
		fake,
		mode: 'manual',
		params: { event: 'rsi', symbols: 'LOW, HIGH, NEAR', rsiThreshold: 70, rsiDirection: 'up' },
	});
	assert.equal(out.length, 1);
	assert.equal(out[0].symbol, 'NEAR', 'the one closest to the level');
	assert.equal(out[0].event, 'rsi.crossed');
	assert.equal(out[0].previous_rsi, null);
});

test('test mode: when nothing matches it says so and how to get a sample', async () => {
	const fake = createFakeMcp({ get_stocks: () => stocks(stock('A', 40, 0)) });
	await assert.rejects(
		check({ fake, mode: 'manual', params: { event: 'rsi', symbols: 'A', rsiThreshold: 70 } }),
		(error) =>
			/None of these stocks is on the chosen side/.test(error.message) &&
			/test run/.test(error.description) &&
			/Move the threshold/.test(error.description),
	);
});

// ====================================== requests

test('the trigger asks as version 2 does: the API key credential, a timeout and the allowance headers', async () => {
	const fake = createFakeMcp({ get_signals: () => signals() });
	await check({ fake, params: { event: 'signal' } });
	assert.equal(fake.calls[0].credential, 'stocklakeApi');
	assert.equal(fake.timeouts[0], 30000);

	const guest = createFakeMcp({ get_signals: () => signals() });
	await check({ fake: guest, apiKeyCredential: false, params: { event: 'signal' } });
	assert.equal(guest.calls[0].credential, null, 'no credential, a guest call');
});

test('the credential helper gets the real poll context (n8n reads the credential through its this)', async () => {
	const fake = createFakeMcp({ get_signals: () => signals() });
	await check({ fake, params: { event: 'signal' } });
	assert.equal(fake.calls[0].credential, 'stocklakeApi');
});

test('each instance has its own property list, since n8n adds the Poll Times to it', () => {
	const a = new StocklakeTrigger().description.properties;
	const b = new StocklakeTrigger().description.properties;
	assert.notEqual(a, b);
	assert.equal(a.filter((p) => p.name === 'pollTimes').length, 0);
});

// ====================================== the plan each event needs

test('only the signal event needs Pro; insider activity is free', () => {
	const { EVENT_TOOLS } = require('../dist/nodes/StocklakeTrigger/events');
	assert.deepEqual(
		Object.entries(EVENT_TOOLS)
			.filter(([, v]) => v.pro)
			.map(([k]) => k),
		['signal'],
	);
});

test('node and README agree: insider purchases are free, and a free key reads fewer filings', () => {
	const fs = require('node:fs');
	const path = require('node:path');
	const event = node.description.properties.find((p) => p.name === 'event');
	const insider = event.options.find((o) => o.value === 'insider');
	assert.match(insider.description, /\bfree\b/);
	assert.doesNotMatch(insider.description, /requires pro/i);
	assert.match(insider.description, /5 newest filings per stock, Pro up to 50/);

	const readme = fs.readFileSync(path.join(__dirname, '..', 'README.md'), 'utf8');
	assert.match(readme, /\| \*\*Insider Purchase\*\* [^\n]*\| Free \|/);
	assert.match(readme, /Only \*\*New Signal\*\* needs Pro/);
	assert.match(readme, /5 newest insider filings of the last 90 days per stock/);
});

// ====================================== the estimate field

test('the estimate field follows the other fields and says so when there is nothing to count', async () => {
	const { getCallEstimate, estimateInput } = require('../dist/nodes/StocklakeTrigger/loadOptions');
	const load = async (values) =>
		await getCallEstimate.call({ getCurrentNodeParameter: (name) => values[name] });

	const hourly = await load({
		event: 'rsi',
		symbolSource: 'manual',
		symbols: 'AAPL, MSFT',
		minutesBetweenChecks: 60,
	});
	assert.equal(hourly.length, 1);
	assert.equal(hourly[0].name, 'Up to 48 calls a day');
	assert.match(hourly[0].description, /24 checks a day/);

	const often = await load({
		event: 'rsi',
		symbolSource: 'manual',
		symbols: 'AAPL, MSFT',
		minutesBetweenChecks: 5,
	});
	assert.equal(often[0].name, 'Up to 576 calls a day (more than a free account has)');
	assert.match(often[0].description, /more often than every 15 minutes/);

	assert.equal(
		(await load({ event: 'rsi', symbolSource: 'manual', symbols: '' }))[0].name,
		'Add Symbols to See the Estimate',
	);
	assert.match(
		(await load({ event: 'rsi', symbolSource: 'watchlist' }))[0].name,
		/One call per watchlist stock, 24 times a day/,
	);
	assert.equal((await load({ event: 'signal', signalLimit: 10 }))[0].name, 'Up to 240 calls a day');
	assert.equal(
		(await load({ event: 'filing', symbols: 'AAPL', filingsPerSymbol: 3 }))[0].name,
		'Up to 72 calls a day',
	);

	// untouched fields use the defaults of the node
	assert.deepEqual(
		estimateInput(() => undefined),
		undefined,
		'no symbols typed yet',
	);
	// a loader that cannot read a field does not break the editor
	const broken = await getCallEstimate.call({
		getCurrentNodeParameter: () => {
			throw new Error('no such parameter');
		},
	});
	assert.equal(broken[0].name, 'Add Symbols to See the Estimate');
});

test('the estimate field depends on every field that changes the figure', () => {
	const field = node.description.properties.find((p) => p.name === 'callEstimate');
	assert.equal(field.typeOptions.loadOptionsMethod, 'getCallEstimate');
	assert.deepEqual([...field.typeOptions.loadOptionsDependsOn].sort(), [
		'event',
		'filingsPerSymbol',
		'minutesBetweenChecks',
		'signalLimit',
		'symbolSource',
		'symbols',
	]);
});

// ====================================== the example workflow

test('the example workflow is valid, uses the trigger and its settings run', async () => {
	const fs = require('node:fs');
	const path = require('node:path');
	const workflow = JSON.parse(
		fs.readFileSync(
			path.join(__dirname, '..', 'examples', 'earnings-and-rsi-alerts.workflow.json'),
			'utf8',
		),
	);
	const names = new Set(workflow.nodes.map((n) => n.name));
	assert.equal(names.size, workflow.nodes.length);
	for (const [from, out] of Object.entries(workflow.connections)) {
		assert.ok(names.has(from));
		for (const link of out.main.flat()) assert.ok(names.has(link.node));
	}
	assert.ok(workflow.nodes.some((n) => /stickyNote/.test(n.type)));
	const triggers = workflow.nodes.filter((n) => n.type === 'n8n-nodes-stocklake.stocklakeTrigger');
	assert.deepEqual(triggers.map((t) => t.parameters.event).sort(), ['earnings', 'rsi']);

	// Each saved trigger records on the first check and fires on a change.
	const earnings = triggers.find((t) => t.parameters.event === 'earnings').parameters;
	const rsi = triggers.find((t) => t.parameters.event === 'rsi').parameters;
	let answer = { results: [] };
	const fakeEarnings = createFakeMcp({ get_earnings_calendar: () => answer });
	const e = { fake: fakeEarnings, staticData: {}, params: earnings };
	assert.equal(await check(e), null);
	answer = { results: [earning('NVDA', '2026-11-12T21:00:00+00:00')] };
	const fired = await check(e, 6 * HOUR);
	assert.equal(fired[0].symbol, 'NVDA');
	assert.equal(fired[0].days_until, 6);

	let quotes = stocks(stock('AAPL', 65, 0));
	const fakeRsi = createFakeMcp({ get_stocks: () => quotes });
	const r = { fake: fakeRsi, staticData: {}, params: rsi };
	assert.equal(await check(r), null);
	quotes = stocks(stock('AAPL', 72, 0));
	const crossed = await check(r, 2 * HOUR);
	assert.equal(crossed[0].previous_rsi, 65);
	assert.equal(crossed[0].threshold, 70);
});
