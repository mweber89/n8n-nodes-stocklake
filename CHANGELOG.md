# Changelog

All notable changes to `n8n-nodes-stocklake`. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[semantic versioning](https://semver.org/).

## [2.0.0] - 2026-11-06

The node is rebuilt to behave like a native n8n node. Workflows saved with 0.1.x keep
running unchanged: they stay on **node version 1**, which has the same parameters and
the same output as 0.1.1. New nodes default to **version 2**. Nothing is converted
automatically; to move a node, open its settings and pick the new version.

### Added

- **Stocklake Trigger**, a new polling node that starts a workflow when something
  happens. Six events: New Signal (Pro), Earnings Coming Up, New SEC Filing, Insider
  Purchase, RSI Crossing and Price Move. It keeps what it has sent in the workflow's
  static data, so each event fires once. The first check after activation records the
  current situation and starts nothing (turn on *Fire on Existing Items* to change
  that). **Fetch Test Event** returns the latest matching event without touching the
  saved state. *Minimum Minutes Between Checks* (60 by default) throttles n8n's
  Poll Times, and *Estimated Calls per Day* with a warning under 15 minutes shows what
  a setting costs.
- **Eight operations**, taking the node from 17 to 25 (16 free, 9 Pro):
  Stock: Get Financials, Get Filings, Get Activity, Get Analyst Trend; Market: Get
  Economic Calendar; and three that combine several calls inside n8n: Stock: Compare,
  Stock: Snapshot and Portfolio: Check Holdings.
- **One item per row** for every operation that returns a list, with *Simplify*,
  *Return All / Limit* (paging, batches of 25 symbols) and *Include Response Metadata*.
  Every output item is paired with the input item that produced it.
- **Symbol Source** on Stock: Get Many and Earnings: Get Calendar: a typed list, the
  tickers of the input items, or your Stocklake watchlist (Pro). Lists are cleaned,
  de-duplicated and sent in batches; one bad ticker comes back as its own item
  instead of stopping the run. An estimate of the calls is shown before a long run.
- **Dropdowns loaded from Stocklake**: sector, screener preset, signal source and
  direction, activity types, and the symbol picker (which lists your watchlist).
  Loading them does not use up the daily allowance.
- **Reliability**: automatic retries on 429 that follow `Retry-After` (or back off),
  a clean stop on a used-up daily allowance, *Include Remaining Calls*, a request
  timeout, plan hints for free and guest credentials, and error messages that say what
  to do. With *Continue On Fail* a failed item is paired with its input item.
- **AI agent support**: a Tool Description written for a model on every operation,
  `$fromAI()` defaults for ticker, days and limit, and a **Toolkit** resource that
  gives an agent one tool with an operation filter (it only sees the operations you
  switch on, and cannot run any other).
- **CSV export** (*Options > Download as CSV*) on the list operations: one binary
  file with a header row, a byte order mark for Excel and protection against spreadsheet
  formulas.
- **Five workflow templates** in [`templates/`](./templates) (daily briefing to Slack,
  earnings alert by Gmail, oversold and overbought digest by email, holdings log in
  Google Sheets, AI agent), and six examples in [`examples/`](./examples).
- A codex file (categories, aliases) and per-operation documentation links.

### Changed

- The README is rewritten, with screenshots, a plan and limits table, trigger events
  and templates.
- All wording now says quotes are delayed about 15 minutes (the earlier text described
  them as current). The Free and Pro tier tables match what Stocklake serves, including that
  Insider Activity is free and Pro adds the AI read.
- On n8n Cloud the credential field recommends connecting a free account: a guest's 25
  calls a day are shared with other users of the same network address there. A rejected
  key, a guest limit, a Pro call without a Pro credential and a daily limit each get
  their own message instead of "Authorization failed".
- Requests carry the `User-Agent` `n8n-nodes-stocklake`.
- Signal Source no longer offers "Social" in version 2: the API has no such source.

## [0.1.1] - 2026-09-01

- Fixed 17 violations reported by n8n's community-package scanner and lint with the
  plugin the scanner uses.
- Fixed the node icon and added the brand assets and three example workflows.

## [0.1.0] - 2026-09-01

- First release: 17 operations on the Stocklake MCP endpoint, OAuth2 (dynamic client
  registration) and API key credentials, a guest mode without a credential.
