# n8n Creator Portal resubmission: n8n-nodes-stocklake 2.0.0

Notes for n8n's reviewers, written to be pasted into the Creator Portal and kept in the
repository so the claims can be checked. The first section is the text to paste; the rest
is the evidence behind it.

## Text to paste into the portal

> **n8n-nodes-stocklake 2.0.0: a resubmission after the 0.1.1 review.**
>
> The 0.1.1 review declined the node because it is an MCP wrapper and asked for a REST
> API. Stocklake does not have a REST API: its MCP endpoint (Streamable HTTP, OAuth 2.1
> with dynamic client registration, or an API key) is its only public API, and the same
> endpoint serves Claude and ChatGPT. We are not able to offer a second one for this node.
> n8n's own community-node catalog lists nodes that call an MCP endpoint's `tools/call`
> directly (One Horizon and HAVN, see below), so we ask that this node is judged on what
> it does in n8n.
>
> Version 2.0.0 is not a pass-through to the endpoint. It is built from n8n's own parts:
>
> - a **polling trigger** (Stocklake Trigger) with six events, state in workflow static
>   data so each event fires once, a silent first activation, a test event, and a call
>   estimate with a warning;
> - **one item per row** for every list, Simplify, Return All / Limit with paging, paired
>   items, Continue On Fail;
> - **dynamic options** loaded from the service, a resource locator for the symbol, and
>   symbols taken from earlier steps with batching and per-ticker validation;
> - **three composite operations** (Compare, Snapshot, Check Holdings) that combine calls
>   and compute their result in n8n;
> - **429 handling** with `Retry-After`, a clean stop on a used-up daily allowance, plan
>   hints and error messages by class;
> - **AI agent support** (tool descriptions written for a model, `$fromAI()` defaults, a
>   Toolkit with an operation filter), CSV export as binary data;
> - versioning: workflows saved with 0.1.x keep running on node version 1, unchanged.
>
> Published from GitHub Actions with npm provenance, no runtime dependencies, all requests
> through n8n's HTTP helpers, MIT licence, 5 workflow templates, a documentation page and
> a demo video. Everything is listed with the evidence in `docs/resubmission.md` in the
> repository.

## Why the node talks to an MCP endpoint

- Stocklake's public API is an MCP server and nothing else: `https://api.stocklake.dev/mcp`,
  JSON-RPC over Streamable HTTP, documented at
  [api.stocklake.dev/llms.txt](https://api.stocklake.dev/llms.txt) and
  [stocklake.dev/docs](https://stocklake.dev/docs). There is no REST API, and none is
  planned.
- The node does not show MCP to the user. There is no "call a tool" field: there are
  resources and operations with typed parameters, and each operation's output is shaped
  for n8n. The protocol is an implementation detail of `GenericFunctions.ts`, the way a
  REST node hides its URLs.
- Authentication is n8n-native: an OAuth2 credential that uses n8n's dynamic client
  registration and PKCE support (nothing to copy), and an API key credential. A guest mode
  works without a credential for the free operations.
- Precedent. These packages are in the catalog served by
  `api.n8n.io/api/community-nodes` and call `tools/call` on an MCP endpoint directly
  (checked on 2026-11-06 by reading the published packages):
  `n8n-nodes-one-horizon` 0.1.6 (`mcp.onehorizon.ai/mcp`) and
  `@binartscom/n8n-nodes-havn` 0.1.12 (`mcp.havnre.app/mcp`).

## What the node does that a generic MCP client node cannot

| n8n feature | What 2.0.0 does | Where |
|---|---|---|
| Trigger | Stocklake Trigger: a polling node, six events (new signal, earnings coming up, new SEC filing, insider purchase, RSI crossing, price move; only the signal event needs Pro). Dedup in `getWorkflowStaticData`, a first check that only records, `Fetch Test Event` in manual mode, a minimum interval and a call estimate with a warning under 15 minutes | `nodes/StocklakeTrigger/` |
| Items | One output item per row for 15 list operations; Simplify; Return All / Limit with paging; `_meta`; every item paired with its input item (`pairedItem`) | `nodes/Stocklake/rows.ts`, `executeRows.ts` |
| Dynamic options | Sector, preset, signal source and direction, activity types and the symbol picker (with the watchlist) are `loadOptions` / `listSearch` methods, cached per credential, never costing a call and never calling a Pro tool for a free credential | `nodes/Stocklake/loadOptions.ts` |
| Inputs from earlier steps | Symbol Source: manual, from input items, from the watchlist; trimmed, upper-cased, de-duplicated; batches of 25 in input order; a bad ticker is its own item | `nodes/Stocklake/symbols.ts` |
| Composite operations | Stock: Compare (ranked table), Stock: Snapshot (one flat item), Portfolio: Check Holdings (lots, weights, flags, summary, per-currency totals), computed in n8n from several calls | `nodes/Stocklake/composites.ts`, `executeComposite.ts` |
| Reliability | 429 retry that follows `Retry-After` or backs off, no retry on a used-up daily allowance, remaining-calls option, timeout option, errors by class with a hint, plan hints for free and guest credentials, Continue On Fail with paired items | `nodes/Stocklake/GenericFunctions.ts` |
| AI agents | `usableAsTool`; a description written for a model on every operation; `$fromAI()` defaults; a Toolkit resource with an operation filter that the call is checked against | `descriptions/ToolDescription.ts`, `toolkit.ts` |
| Binary data | Download as CSV: one binary file, byte order mark, formula-injection protection | `nodes/Stocklake/csv.ts` |
| Versioning | Version 1 is frozen (golden tests replay a workflow saved on 0.1.1); version 2 is the default for new nodes | `nodes/Stocklake/v1/`, `v2/`, `test/versioning.test.js` |
| Discoverability | Codex file with categories and aliases, a documentation link on every operation, five templates, six example workflows | `Stocklake.node.json`, `templates/`, `examples/` |

## Requirements for verified nodes

| Requirement | State |
|---|---|
| Published with npm provenance from GitHub Actions | `.github/workflows/publish.yml` runs `npm publish --provenance` (manual dispatch, `id-token: write`) |
| `@n8n/scan-community-package` is clean | Run after publishing; result recorded in the release notes of 2.0.0 |
| Lint with `@n8n/eslint-plugin-community-nodes` | Clean; part of CI and `prepublishOnly` |
| No runtime dependencies | `package.json` has none; `n8n-workflow` is a peer |
| No file system, environment or direct network access | All requests go through `this.helpers.httpRequest` and `httpRequestWithAuthentication` |
| Documentation | README with screenshots, the page at [stocklake.dev/n8n](https://stocklake.dev/n8n), a documentation link on every operation and credential |
| Licence | MIT |
| Tests | `npm test`: the operations against a fake MCP endpoint, golden tests for version 1, the trigger's state, templates and copy |
| Honest copy | No claim of current quotes: the nodes say that quotes are delayed about 15 minutes. A test fails on the words that would claim otherwise, and on provider names |

## What was checked

Only what was seen is listed. Workflows, execution ids and the calls used are in
[`live-checks-2026-11-07.md`](live-checks-2026-11-07.md).

- **On a running n8n** (2.46.6, the 2.0.0 build loaded as a custom extension, 2026-11-07,
  a Pro and a Free test key):
  - *Symbols from earlier steps*: Get Many with 60 input items on a Pro key went out as
    three requests of 25, 25 and 5, the rows kept the input order, three repeats were
    removed, the two invalid tickers came back as their own items, the cost notice was
    shown, and the 55 calls the node estimated were the 55 the service counted. Compare
    refuses more than 25 tickers with a clear error and works with 28 items.
  - *Stocklake Trigger*, all six events on a Pro key: the test event, a first activation
    that starts nothing and records the state, *Fire on Existing Items*, no repeat over
    several checks a minute apart, and one forced event that starts exactly once (a removed
    id; for RSI a changed stored value, because moving the level does not create a
    crossing).
  - *A free key*: the six test events (New Signal gives the Pro message; at activation n8n
    shows it and tries five times), Insider Purchase through the whole sequence (it needs
    no Pro; a free key reads the 5 newest filings per stock where Pro reads 50), and a
    rejected key after activation, which shows in the executions.
- **By tests** (`npm test`, no network, 483 tests on 2026-11-07): every operation against
  a fake MCP endpoint (the exact tool, arguments and output), golden tests for version 1,
  the trigger's dedup, first run, threshold crossing and state cap, the templates and the
  copy.
- **Not checked again on 2026-11-07, so not claimed here**: the Toolkit driven by an AI
  agent, the five templates run end to end, `scripts/check-api.js` across guest, free and
  Pro, the OAuth2 credential, *From My Watchlist*, and an n8n restart between two checks.
  The dropdown loaders against the real API are recorded in
  [`release-2.0.0.md`](release-2.0.0.md).

## What changed since the review of 0.1.1

See [CHANGELOG.md](../CHANGELOG.md). In short: 17 operations became 25, lists became one
item per row, a trigger was added, three composite operations, dynamic options, retry and
quota handling, agent support, CSV export, templates, documentation and a corrected tier
table.

## Links

- npm: <https://www.npmjs.com/package/n8n-nodes-stocklake>
- Source: <https://github.com/mweber89/n8n-nodes-stocklake>
- Documentation: <https://stocklake.dev/n8n>
- Templates: [`templates/`](../templates)
- Demo video: <https://drive.google.com/file/d/1g_7a1zXe-JI65sHCZaW5QPqww68WdUR_/view?usp=sharing>
  (recorded 2026-09-02 on 0.1.1; replace with a 2.0 recording before submitting, or say in
  the portal which version it shows)

## Before submitting

1. 2.0.0 is on npm with provenance and the scanner reports nothing.
2. The documentation page at stocklake.dev/n8n is deployed.
3. The demo video link is in the portal form and above.
4. Paste the text at the top of this file into the notes field.
