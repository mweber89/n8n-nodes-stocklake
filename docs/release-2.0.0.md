# Release 2.0.0: record

What happened between the rejection of 0.1.1 and the resubmission of 2.0.0, so the next
release and the next review start from the facts. Tracking issue: #10.

## Background

- **2026-09-01**: 0.1.1 published from GitHub Actions with npm provenance and submitted
  for verification.
- **Review of 0.1.1** (answer received early November 2026): "we are not currently
  accepting nodes that are MCP wrappers ... If you wanted to update the node to use a
  REST API instead we can move forward with the review."
- **Decision (2026-11-06)**: no REST API. Stocklake's MCP endpoint is its only public API
  and stays that way. Instead of writing to n8n first, rebuild the node so it is clearly
  an n8n integration and resubmit.
- **Research (2026-11-06)**: n8n's catalog (`api.n8n.io/api/community-nodes`, 2,220 nodes
  that day) already lists verified nodes that call an MCP endpoint's `tools/call`
  directly: `n8n-nodes-one-horizon` 0.1.6 and `@binartscom/n8n-nodes-havn` 0.1.12.

## Work (2026-11-06)

Ten issues, implemented in order:

| Issue | Commit | What |
|---|---|---|
| #1 | e4bd190 | Versioned node (v1 frozen, v2 default), no real-time wording, codex, test harness |
| #2 | d92f6b3, 8a67cc1, c43e7ca | Five more operations: financials, filings, activity, analyst trend, economic calendar |
| #3 | 320f52a | One item per row, Simplify, Return All / Limit, paired items |
| #4 | 22e868e | Dropdowns loaded from Stocklake, fallback lists, watchlist in the symbol picker |
| — | e3b9ff5 | Clear errors for guest limit, Pro without credential, rejected key |
| #5 | e4059a2 | Symbol Source (manual, input items, watchlist), batches of 25, cost notice |
| #6 | a77cf3a | 429 retries, daily-limit stop, errors by class, plan hints |
| #7 | e2ac804 | Composite operations: Compare, Snapshot, Check Holdings |
| #8 | 89e38ce | AI agent tool descriptions, `$fromAI()`, Toolkit, CSV export |
| #9 | f28de8b | Stocklake Trigger: six polling events |
| #10 | 091cf0d | README, five templates, CHANGELOG, version 2.0.0, resubmission notes |

The documentation page is in the Stocklake site repository (`mcpserver/external/web/n8n.html`).

## Release (2026-11-06 / 2026-11-07)

| When (UTC) | Step | Result |
|---|---|---|
| 11-06 19:35 | Publish run 42280972440 | `ENEEDAUTH`: the repo had no secrets; the `NPM_TOKEN` used for 0.1.1 had expired (2026-10-01) |
| 11-07 morning | Review of the work | Code, tests and CI fine; the publish, the docs page, the video and two live checks still open |
| 11-07 | Docs page | Merged to the site's main (fab336ae); full site test suite passed; rendered at desktop and phone width |
| 11-07 08:44 | Publish run 42356707968 | `E403`: the token was limited to the `@stocklake` scope; this package is unscoped |
| 11-07 08:53 | Publish run 42357352512 | `E403`: "granular access token with bypass 2fa enabled is required" |
| 11-07 08:58 | Publish run 42357649333 | **2.0.0 published** with provenance; `latest` = 2.0.0 |
| 11-07 08:58 | Scanner step in that run | Scanned 0.1.1: the registry still served the old `latest`. Fixed in 7b79ea9 (waits, scans by version) |
| 11-07 09:01 | `scan.yml` run 42357900809 | Failed with a 404 fetching the attested source: propagation lag right after publishing |
| 11-07 09:02 | `scan.yml` run 42357976344 | **"Package n8n-nodes-stocklake@2.0.0 has passed all security checks"** |
| 11-07 | Site deploy | stocklake.dev/n8n live (site version 2026.11.9) |
| 11-07 | Creator Portal | Resubmitted. The portal had no field for a note, so the text in `docs/resubmission.md` was not sent |

## Checks after the release

- **Dropdowns (#4), 2026-11-07**: `scripts/check-options.js` against the real API as guest,
  free and Pro: every loader returned values, the Pro-only loaders ran only for Pro, and
  the remaining-calls counter did not move.
- **CSV (#8), 2026-11-07**: a file written by the built `csv.js` parsed cleanly with a
  standard CSV reader: byte order mark, header row, ISO dates, quoting, and a cell starting
  with `=` escaped. Not opened in Excel or Google Sheets by hand.
- **Live checks for #5 and #9, 2026-11-07** (751d1f7): all passed on n8n 2.46.6 with the
  2.0.0 build. Report and the 29 workflows used: `docs/live-checks-2026-11-07.md`. Calls used:
  228 Pro, 50 Free. Findings: Compare is capped at 25 tickers by design (batching is for
  Get Many); Insider Purchase is a free event (Free reads the 5 newest filings per stock,
  Pro 50); a Free key on a Pro event fails at activation, where n8n retries five times
  (5 Free calls per activation). `docs/resubmission.md` "What was checked" was cut down to
  what that run saw.

## Next time

- **npm token**: a granular token for the package `n8n-nodes-stocklake` (not the
  `@stocklake` scope) with "Bypass two-factor authentication" ticked. Better: set up npm
  trusted publishing for `publish.yml` and drop the token (the workflow then needs
  npm 11.5.1 or later).
- **Scanner**: give the registry a minute after publishing; `scan.yml` re-runs it without
  publishing. Its exit code is always 0, so read the log.
- **Copy with numbers**: the Free limit drops from 200 to 100 calls a day in the December
  release. The places in this repo that say 200 are listed in the Stocklake repository,
  `docs/december-release-checklist.md` on `release/december-2026`.

## Open

- n8n's decision on the resubmission. If they write back, answer with the text in
  `docs/resubmission.md`.
- A demo video of 2.0 (the existing one, recorded 2026-09-02, shows 0.1.1).
- Unreleased on main since 2.0.0 (see CHANGELOG, Unreleased): Get Many returns an
  unknown ticker as its own item (decided 2026-11-07), the Insider Purchase option text and
  README corrections. They reach npm with the next version, after n8n's decision.
- Revoke the npm tokens used on 2026-11-07.
