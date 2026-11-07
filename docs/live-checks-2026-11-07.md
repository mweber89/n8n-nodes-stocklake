# Checks on a running n8n, 2026-11-07

Evidence for the "Done when" items of
[#5](https://github.com/mweber89/n8n-nodes-stocklake/issues/5) (symbols from earlier steps,
batching, cost hint) and
[#9](https://github.com/mweber89/n8n-nodes-stocklake/issues/9) (Stocklake Trigger), run
against the built package of 2.0.0 and the production Stocklake API.

## Result at a glance

| Check | Result |
|---|---|
| #5 60 items from input items on a Pro key: 3 batches of at most 25, input order, duplicates removed, each invalid ticker its own item, cost notice, `_meta.estimated_calls` equal to the calls counted | **pass** (execution 1) |
| #5 the same with Compare | **pass with a note**: Compare takes at most 25 tickers and refuses 55 with a clear error (execution 2, no call made); repeated with 28 items it passes (execution 3) |
| #9 New Signal: test event, silent first activation, Fire on Existing Items, no repeat, forced event fires once | **pass** |
| #9 Earnings Coming Up: the same five | **pass** |
| #9 New SEC Filing: the same five | **pass** |
| #9 Insider Purchase: the same five | **pass** (on a Pro key and on a Free key) |
| #9 RSI Crossing: the same five | **pass** (the forced crossing needs a changed RSI value, see below) |
| #9 Price Move: the same five | **pass** |
| #9 a Free key on a Pro event gives a clear message | **pass** (test event and activation) |
| #9 which plan Insider Purchase needs | **Free.** The issue's "Pro" is out of date. A Free key reads fewer filings, see below |

No check failed, so no issue was opened. Three findings that were not part of the checks are
listed under [Findings](#findings).

## Setup

- Package: `n8n-nodes-stocklake` 2.0.0 built from `main` at commit `c66457f` with
  `scripts/dev-n8n.sh` (a clean checkout; `.n8n-dev` is git-ignored and was started empty).
- n8n 2.46.6, started by the script with Node 24.22.2. `npx n8n` does not install on
  Node 20.19 here (`isolated-vm` fails to build), as `CONTRIBUTING.md` says; Node 24 came
  from `npm install node@24` in a scratch folder.
- Credentials: the Pro and the Free test key of the Stocklake health-test accounts, entered
  as two *Stocklake API* credentials. No key is in this repository or in any file below.
- Workflows were created and run through n8n's own editor API (manual runs for *Fetch Test
  Event* and the Manual Trigger, activation for the Trigger). Every workflow is in
  [`live-checks-2026-11-07/workflows/`](live-checks-2026-11-07/workflows) with the credential
  id removed. Execution ids below are the ids in that throwaway n8n.
- Calls were counted twice: the node's own numbers, and the service's per-call usage log for
  the two test accounts. Both agree where they overlap.
- The npm package 2.0.0 was published during the day. The commits after `c66457f` changed
  only CI and documentation, so the local build that was run has the same code.
- The node description text of *Insider Purchase* and two README sentences were changed after
  the runs (see [Changes](#changes)). The behaviour that was run is unchanged by them.

## #5: 60 tickers from input items, Pro key

Workflow: Manual Trigger, a Code node that returns 60 items `{ ticker }`, then
*Stocklake Stock: Get Many* with *Symbol Source = From Input Items*, *Symbol* =
`{{ $json.ticker }}`, *Include Metadata* on.

The 60 items are 55 distinct large US tickers (`AAPL`, `MSFT`, `NVDA`, ... in no alphabetical
order), three repeats written as `aapl`, ` MSFT ` and `Nvda`, and two values that cannot be
tickers, `BAD TICKER!` and `12$%`.

```json
{
 "name": "5 Get Many 60 tickers",
 "nodes": [
  {
   "id": "a1000000-0000-4000-8000-000000000001",
   "name": "Manual Trigger",
   "type": "n8n-nodes-base.manualTrigger",
   "typeVersion": 1,
   "position": [
    0,
    0
   ],
   "parameters": {}
  },
  {
   "id": "a1000000-0000-4000-8000-000000000002",
   "name": "60 tickers",
   "type": "n8n-nodes-base.code",
   "typeVersion": 2,
   "position": [
    220,
    0
   ],
   "parameters": {
    "jsCode": "const tickers = [\"AAPL\", \"MSFT\", \"NVDA\", \"AMZN\", \"GOOGL\", \"META\", \"TSLA\", \"AVGO\", \"JPM\", \"aapl\", \"V\", \"MA\", \"UNH\", \"XOM\", \"BAD TICKER!\", \"LLY\", \"COST\", \"HD\", \"PG\", \"JNJ\", \"ABBV\", \"MRK\", \"KO\", \"PEP\", \"BAC\", \" MSFT \", \"WMT\", \"CVX\", \"CRM\", \"ORCL\", \"NFLX\", \"AMD\", \"ADBE\", \"TMO\", \"MCD\", \"CSCO\", \"ACN\", \"ABT\", \"LIN\", \"DHR\", \"Nvda\", \"TXN\", \"WFC\", \"PM\", \"QCOM\", \"INTU\", \"IBM\", \"GE\", \"CAT\", \"12$%\", \"AMGN\", \"NOW\", \"ISRG\", \"GS\", \"DIS\", \"UBER\", \"BKNG\", \"SPGI\", \"PFE\", \"T\"];\nreturn tickers.map((ticker) => ({ json: { ticker } }));"
   }
  },
  {
   "id": "a1000000-0000-4000-8000-000000000003",
   "name": "Stocklake Stock: Get Many",
   "type": "CUSTOM.stocklake",
   "typeVersion": 2,
   "position": [
    440,
    0
   ],
   "parameters": {
    "resource": "stock",
    "operation": "getMany",
    "symbolSource": "fromInput",
    "symbolsFromInput": "={{ $json.ticker }}",
    "simplify": true,
    "options": {
     "includeMetadata": true
    }
   },
   "credentials": {
    "stocklakeApi": {
     "id": "<your credential>",
     "name": "Stocklake Pro"
    }
   }
  }
 ],
 "connections": {
  "Manual Trigger": {
   "main": [
    [
     {
      "node": "60 tickers",
      "type": "main",
      "index": 0
     }
    ]
   ]
  },
  "60 tickers": {
   "main": [
    [
     {
      "node": "Stocklake Stock: Get Many",
      "type": "main",
      "index": 0
     }
    ]
   ]
  }
 },
 "settings": {
  "executionOrder": "v1"
 }
}
```

Execution **1**, status success:

| Check | Observed |
|---|---|
| Batches of at most 25 | The service logged three requests at three different moments, with 25, 25 and 5 tickers |
| Order | The 55 rows come back in the order of first appearance in the input (compared with the input list: identical) |
| Duplicates | None in the output; `_meta.duplicates_removed` is 3 |
| Invalid tickers | Two extra items, `{ "symbol": "BAD TICKER!", "valid": false, "error": "Not a valid-looking ticker symbol" }` paired with input item 14 and the same for `12$%` with item 49. Neither was sent |
| Pairing | Each row is paired with the input item that supplied it (first occurrence) |
| Cost notice | An execution hint in the output pane: "About 55 calls against your daily allowance: each ticker counts as one call. They are sent in 3 requests of up to 25." |
| `_meta` | `estimated_calls: 55`, `requests: 3`, `symbols_used: 55`, `invalid_symbols: 2`, `duplicates_removed: 3`, `count: 55`, `missing: []` |
| Calls counted by the service | **55** (`get_stocks`, one per ticker). Equal to `estimated_calls` |

**Compare with the same 60 items.** Execution **2** stops before any call (0 calls) with
"Compare takes at most 25 tickers, got 55", description "Remove tickers, or use Get Many with
Return All, which reads a longer list in several requests." That is the designed limit of
Compare (`COMPARE_MAX_SYMBOLS = 25`), not batching. So Compare was repeated with the first 28
of the items (25 distinct valid tickers, two repeats, one invalid): execution **3**, 25 rows
in input order, no repeat, one invalid item (paired with item 14), 25 calls counted. No cost
notice appears there because the run is not above 25 calls.

**Extra: a ticker of a valid shape that Stocklake does not know.** Execution **4**, Get Many
with `AAPL`, `ZZZQQ`, `MSFT`: two rows, and `_meta.missing` is `["ZZZQQ"]` with `count: 2`,
`requested: 3`. The unknown ticker is not its own item and is counted (3 calls). See
[Findings](#findings).

## #9: every Stocklake Trigger event

The Trigger was set to *Minimum Minutes Between Checks* = 1 and n8n's Poll Times to *Every
Minute*, so a check ran about once a minute. Each event ran in four steps on its own workflow
(Trigger connected to a No Operation node, so every start leaves an execution):

1. **Fetch Test Event** in the editor.
2. **Silent first activation**: activate, wait, look at the executions and the saved state
   for four checks.
3. **Forced event**: deactivate, change the saved state (see the table), activate again. One
   start expected, no further starts for two more checks.
4. **Fire on Existing Items** on a second workflow with the option on: the first check
   starts the workflow with what exists, no further start for two more checks.

An execution with mode `manual` is the test event; mode `trigger` is a start by the schedule.
Symbols were chosen from stocks that really had something to report: earnings `OXY, CEG,
KKR` (7 days), filings `AAPL, NVDA` (1 per stock), insider `ACN, AMT` (minimum 100,000
USD), RSI `CAT, VLTO` (level 50, either way), price `AXON, TEAM` (more than 5 %), signals
without a filter (minimum score 0, 3 per check).

Pro key results:

| Event | Test event | Silent activation | Forced event | Fire on Existing Items | Calls per check |
|---|---|---|---|---|---|
| New Signal | exec 8, `signal.new` | 0 starts in 4 checks; state recorded 3 ids | removed the newest seen id, exec **13**: 1 item, exactly the signal of that id; 0 starts in 2 more checks | exec **19**: 3 items; 0 more in 2 checks | 3 |
| Earnings Coming Up | exec 10, `earnings.upcoming` | 0 starts in 4 checks; 3 ids | removed `earnings|OXY|2026-11-09`, exec **15**: 1 item (OXY); none after | exec **22**: 3 items (CEG, KKR, OXY); none after | 1 |
| New SEC Filing | exec 7, `filing.new` | 0 starts in 4 checks; 2 ids | removed one accession, exec **14**: 1 item (NVDA); none after | exec **21**: 2 items (NVDA, AAPL); none after | 2 |
| Insider Purchase | exec 6, `insider.purchase` | 0 starts in 3 checks; 4 ids | removed the id of a purchase above the minimum, exec **12**: 1 item (AMT); none after | exec **17**: 3 items (AMT, ACN, ACN); none after | 2 |
| RSI Crossing | exec 9, `rsi.crossed` | 0 starts in 4 checks; last RSI of both stocks recorded | set the saved last RSI of CAT from 21 to 60 (level stays 50), exec **30**: 1 item, CAT, `previous_rsi` 60, `rsi` 21, `direction` down; none in 2 more checks | exec **18**: 1 item (VLTO, above the level, `direction` up chosen); none after | 2 |
| Price Move | exec 11, `price.moved` | 0 starts in 4 checks; 2 ids | removed `price|TEAM|...|down`, exec **16**: 1 item (TEAM); none after | exec **20**: 2 items (AXON, TEAM); none after | 2 |

Notes on the table:

- *Silent activation* is "0 starts" in the sense that the executions list of the workflow
  holds the test event (manual) and nothing in mode `trigger`, while the service's usage log
  shows a call at the activation and at every following check, and the saved static data
  shows `initialised: true` with the ids (or the RSI values) recorded.
- *Insider Purchase* ran three checks in its window instead of four: the first scheduled
  wake-up came 27 s after the activation check and, most likely, fell inside the node's 30 s
  margin and was skipped (the next call came 87 s after the activation one, then every 60 s).
  That is how *Minimum Minutes Between Checks* is meant to work.
- *RSI Crossing*, first attempt: the level was moved from 50 to 15 after the first check, to
  put CAT (RSI 21) on the other side. **Nothing fired**, in two checks, and that is correct:
  the node compares the stored previous value with the level in force at the time of the
  check, so moving the level never creates a crossing. A crossing needs the RSI value itself
  to change side between two checks, which is what the second attempt forced by editing the
  saved value. The README ("compares each stock with its value at the previous check")
  already says this. The first attempt is not a failure but the issue's "or move the
  threshold" does not apply to this event.
- *Calls per check* are what the service logged. Earnings on a Pro key counted 1 call for
  three stocks, below the "at least one per stock" upper bound that *Estimated Calls per Day*
  shows.

The state edits were made with the workflow deactivated, on the `workflow_entity.staticData`
column of the throwaway database, and are the only thing done outside n8n's editor API.

### A Free key

| What | Result |
|---|---|
| New Signal, *Fetch Test Event* (exec 24) | Error "This operation requires a Stocklake Pro account. Upgrade at https://stocklake.dev/account ...", description "Plan needed: Pro. A free account or a guest cannot run get_signals. ..." 1 call |
| New Signal, activation | n8n accepts the request, the check at activation fails with the same message, n8n shows "There was a problem activating the workflow" and retries **five times within about 16 seconds**; no execution is created. 5 calls per activation, measured on three activations; nothing more in the 4.5 minutes watched afterwards |
| Earnings, Filing, Insider, RSI, Price test events (exec 25 to 29) | Each returns its event, same shape as on Pro. The earnings test event counted 3 calls (a free key is counted per row), the others 2 |
| Insider Purchase, the whole sequence on a Free key (test exec 23, forced exec **31**, Fire on Existing Items exec **32**) | Same results as on Pro: forced check starts once with the AMT purchase, the existing-items start has the same 3 items, no repeats |

### Which plan Insider Purchase needs

**Free.** `get_insider_activity` is a free tool: every plan gets the filing facts with
`type`, `shares`, `price` and `value`, which is all the trigger uses. The plan only changes
how much is read per call. Same event, symbol `TSM` (many filings), minimum 0, Fire on
Existing Items, one check each:

| Key | Purchases found at the first check | Execution |
|---|---|---|
| Pro | 50 | 33 |
| Free | 5 | 34 |

A Free key sees the 5 newest filings of the last 90 days per stock (buys and sales together),
Pro up to 50. The node's description, the README and `docs/resubmission.md` now say Free with
that limit; issue #9's table still said Pro and has been corrected.

### A check that fails after activation

The credential's key was replaced by an invalid one 20 seconds after a successful activation
(earnings, `OXY`). Three executions with status error followed within about three minutes
(executions **35**, **36**, **37**), each with "Stocklake rejected the API key: it is invalid
or switched off." and the hint to check the credential. No call was counted for them. So a
failure after activation is visible in the executions; a Pro event with a Free key fails
earlier, at activation, where n8n shows it on the workflow instead (README corrected).

One trigger workflow as run (the others differ in the parameters; all are in the folder):

```json
{
 "name": "9 earnings pro silent",
 "nodes": [
  {
   "id": "b2000000-0000-4000-8000-000000000001",
   "name": "Stocklake Trigger",
   "type": "CUSTOM.stocklakeTrigger",
   "typeVersion": 1,
   "position": [
    0,
    0
   ],
   "parameters": {
    "event": "earnings",
    "symbolSource": "manual",
    "symbols": "OXY, CEG, KKR",
    "daysAhead": 7,
    "minutesBetweenChecks": 1,
    "pollTimes": {
     "item": [
      {
       "mode": "everyMinute"
      }
     ]
    }
   },
   "credentials": {
    "stocklakeApi": {
     "id": "<your credential>",
     "name": "Stocklake Pro"
    }
   }
  },
  {
   "id": "b2000000-0000-4000-8000-000000000002",
   "name": "Out",
   "type": "n8n-nodes-base.noOp",
   "typeVersion": 1,
   "position": [
    220,
    0
   ],
   "parameters": {}
  }
 ],
 "connections": {
  "Stocklake Trigger": {
   "main": [
    [
     {
      "node": "Out",
      "type": "main",
      "index": 0
     }
    ]
   ]
  }
 },
 "settings": {
  "executionOrder": "v1"
 }
}
```

## Findings

1. **Insider Purchase is a free event** (above). The only wrong place was issue #9.
2. **Unknown tickers in Get Many.** A ticker of a valid shape that Stocklake does not know
   is dropped without its own item and is counted as a call; it shows only in
   `_meta.missing` when *Include Metadata* is on. Compare, Snapshot and Check Holdings
   return it as an item (`found: false`). The test
   `symbols the API does not know are left out and listed as missing in the metadata` pins
   the current behaviour, so I left it; an item per unknown ticker would match #5's
   "report invalid tickers per item" more closely. This is for the maintainer to decide.
3. **Compare takes at most 25 tickers** where #5 lists Compare under automatic batching.
   The error says what to do. Left as is.

## Changes

- `README.md`: a *Plans* paragraph in the Trigger section (only New Signal needs Pro; what a
  Free key reads for Insider Purchase) and the sentence on failing checks.
- `nodes/StocklakeTrigger/StocklakeTrigger.node.ts`: the Insider Purchase option text says
  "free; a free key reads the 5 newest filings per stock, Pro up to 50".
- `test/trigger.test.js`: the section heading said "(Pro)"; it now says free plan. A new test
  keeps the node text and the README in agreement on the plan.
- `test/copy.test.js`: the no-"live" check ignores the name of this report's file.
- `docs/resubmission.md`: "What was checked" now lists only what was seen; see below.

## Calls used

| Account | Purpose | Calls |
|---|---|---|
| Pro | #5: Get Many 60 items | 55 |
| Pro | #5: Compare with 28 items | 25 |
| Pro | #5: unknown ticker | 3 |
| Pro | #5: a first earnings test event while writing the driver | 1 |
| Pro | #9: six events, silent + forced + Fire on Existing Items (signal 33, earnings 11, filing 24, insider 20, RSI 22, price 22) | 132 |
| Pro | #9: RSI forced by a changed value | 10 |
| Pro | #9: insider on TSM | 1 |
| Pro | #9: failure after activation | 1 |
| **Pro total** | | **228** (budget about 500) |
| Free | New Signal: one test event and three activations of 5 calls each | 16 |
| Free | Insider Purchase: test events, the whole sequence, TSM | 25 |
| Free | Earnings (3, counted per row), Filing (2), RSI (2) and Price (2) test events | 9 |
| **Free total** | | **50** (budget about 150; no quota reset needed) |

Nine further calls on the Pro test account from the same host were not made by these checks
(`get_market_pulse` every five minutes and one `get_watchlist`); they are not counted above.

## Not checked on this day

The earlier text of `docs/resubmission.md` also said that the Toolkit had been driven by an
AI agent, that all five templates ran end to end, and that `scripts/check-api.js` ran against
the production API with a guest, a Free and a Pro key. None of that was repeated here, and
no record of it is in the repository, so the text no longer claims it. Also not run: the
OAuth2 credential, *From My Watchlist*, a restart of n8n between two checks, n8n Cloud.
