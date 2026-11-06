# Contributing

## Build, lint, test

```bash
npm ci
npm run build   # tsc + copies icons and the codex file into dist/
npm run lint    # @n8n/eslint-plugin-community-nodes and eslint-plugin-n8n-nodes-base
npm test        # node --test; runs against dist/, so build first
```

CI runs the same three commands on every push and pull request.

## How the node is organised

`Stocklake` is a versioned node (`nodes/Stocklake/Stocklake.node.ts`).

| Version | Where | Rule |
|---|---|---|
| 1 | `v1/StocklakeV1.ts` | The node as published in 0.1.x. **Frozen**: same parameters, same output. Workflows saved on it must keep running unchanged. |
| 2 | `v2/StocklakeV2.ts` | Default for new nodes. Changes to parameters or output shape go here. |

Both versions build their description from `descriptions/NodeDescription.ts` and
run the same `execute.ts` today. When version 2 needs a different parameter or a
different output shape, give version 2 its own copy of that part. Do not edit what
version 1 uses.

`test/versioning.test.js` guards this. It replays a workflow saved on 0.1.1
(`test/fixtures/workflow-v1.json`) and compares the tool calls and output with what
the 0.1.1 build produced (`test/fixtures/v1-golden.json`), and compares version 1's
parameter definitions with `test/fixtures/v1-parameters-golden.json`. If one of
those fails after your change, you changed version 1.

## Version 2 output

Version 2 runs `executeRows.ts`; version 1 keeps `execute.ts`. `rows.ts` holds, per
list operation, where the rows are in the response, which fields Simplify keeps, the
tool's per-call cap and how it pages (`LIST_SPECS`). To make an operation list-shaped,
add it there; the Return All, Limit, Simplify and Options fields are generated from
the same table (`descriptions/V2Additions.ts`). `test/rows.test.js` covers splitting,
Simplify, Limit, paging and paired items against realistic responses
(`test/fixtures/responses.js`), and checks that version 1 still returns the whole
response byte for byte.

## Adding or changing an operation

1. Add the case to `nodes/Stocklake/ToolMapping.ts` and its parameters to the
   matching file in `nodes/Stocklake/descriptions/`.
2. Register `resource.operation -> tool` in `OPERATION_TOOLS`
   (`descriptions/shared.ts`). This is what puts the docs link at the end of the
   operation's description.
3. Add a case to `test/fixtures/operations.js` with the **expected tool name and
   arguments written out by hand**, plus a realistic response. `test/operations.test.js`
   then checks the exact call and the output mapping for every node version.
4. If the operation is free or Pro, update the list in `test/copy.test.js` and the
   counts in the README. The test fails until they agree.

## Tests

Tests use `node --test` and no network. `test/helpers/fakeMcp.js` plays the
Stocklake MCP server: `createFakeMcp({ get_stock: { ... } })` answers
`tools/call` requests and records the tool name, arguments, URL and credential of
each one in `fake.calls`. `runNode(node, { params, fake, typeVersion })` runs a
node's real `execute()` against it, applying the node's parameter defaults the way
n8n does.

`test/copy.test.js` fails on any wording that presents quotes as current (they are
delayed about 15 minutes) and on any data-provider or model name in files that
ship.

## Reliability

`stocklakeApiRequest` (`GenericFunctions.ts`) owns every failure path. Version 2 only (node `typeVersion` 2 or more) retries a 429 that is not a used-up allowance, applies the Timeout option, remembers the allowance headers (`allowanceSeen`) and adds plan hints; version 1 keeps no retries, no timeout and no hints.

- `classifyRateLimit` decides what a 429 is from `x-ratelimit-remaining` (0 = daily, above 0 = batch too large), `Retry-After` and the body text. `describeRateLimit` words it. Only a `transient` one is retried.
- A message that stops the run (`stopsRun`: daily limit, used-up guest limit) is kept per execution (`callState`, keyed by the execute context), so later items fail without a request.
- Error text is by class: `describeApiError` (tool errors, plan), `describeAuthFailure` (401, 429), `describeTransportFailure` (timeout, unreachable, 5xx). A class without text is a gap: add the text and a test in `test/reliability.test.js`.
- `timing.sleep` is the one place the node waits; tests replace it.
- The fake server (`test/helpers/fakeMcp.js`) sends `x-ratelimit-limit` and `-remaining` and records each request's timeout in `fake.timeouts`.

## Symbol Source

Get Many and Earnings Calendar (version 2) take their tickers from a manual list,
from the input items or from the watchlist. `symbols.ts` holds the pure rules
(cleaning, duplicates, invalid values, order, cost estimate); `executeRows.ts` plans the
source, makes the batches and pairs rows with input items; `descriptions/SymbolSource.ts`
has the fields. `test/symbolSource.test.js` covers them, and
`STOCKLAKE_PRO_KEY=... node scripts/check-symbols.js` runs 60 tickers through the real
node against the real API (it uses 60 calls of the key's daily limit).

## Composite operations

Stock → Compare, Stock → Snapshot and Portfolio → Check Holdings (version 2) call more than one tool and shape the result, so they have no entry in `ToolMapping.ts` or `LIST_SPECS`. `executeRows` hands them to `executeComposite.ts`; every rule (columns, ranking, valuing and flagging a holding, the summary, the snapshot sentence) is a pure function in `composites.ts`, tested on its own in `test/composites.test.js` and again through `execute()`.

- One bad symbol must not sink the rest. `readBatch` splits a request that fails on its arguments until the symbol stands alone; a failure that every symbol would share (401/403/429, a used-up allowance) ends the run instead. Extra calls (earnings calendar, insider sales, the latest filing) degrade to a note, never to a failure.
- A new composite goes in `COMPOSITE_OPERATIONS`, in `OPERATION_TOOLS` (the tool its docs link points to), in the free list of `test/copy.test.js`, and gets an example under `examples/` that `test/composites.test.js` runs.

## AI agent tool and CSV export

`toolCatalog.ts` is the one table behind the Stocklake Tool (version 2): per operation a description for a model, a one-line summary, and the arguments the agent fills in (node parameter -> `$fromAI` key, description, default). `descriptions/ToolDescription.ts` turns it into properties shown only for a tool (`displayOptions.show['@tool']`): a Description per operation, `$fromAI()` copies of the matching fields (the originals are hidden for a tool with `hide['@tool']`), and the Toolkit resource with its operation filter. `toolkit.ts` runs a Toolkit call by running the ordinary operation with the agent's arguments in place of the node's own parameters (a Proxy over the execution context), so nothing is implemented twice. Rules: a new operation needs an entry in `TOOL_OPERATIONS` (a test fails otherwise); text inside a `$fromAI()` call must not contain quotes or apostrophes; every argument needs a fallback, or it is required. `csv.ts` holds the file rules (tests in `test/csv.test.js`) and `descriptions/CsvOptions.ts` the options.

To check an agent end to end, run `./scripts/dev-n8n.sh`, build a workflow like `examples/ai-agent-toolkit.workflow.json` with a chat model credential, ask a few questions and look at the tool calls in the agent's execution (Return Intermediate Steps). The unit tests (`test/tools.test.js`) cover the descriptions, the `$fromAI()` schema, the filter and every operation as a tool, but not how a model chooses.

## Stocklake Trigger

`nodes/StocklakeTrigger/` is a separate node (`polling: true`, version 1), registered in `package.json`. `events.ts` turns the responses of the API into candidate events and holds the RSI crossing and price move rules; `state.ts` is what the node keeps in the workflow static data (`pickFresh` decides what is new, `remember`/`capList` keep it small); `estimate.ts` and `loadOptions.ts` are the calls-a-day estimate, shown in a dropdown that n8n reloads when a field changes (a notice cannot show a figure); `poll.ts` runs one check: the minimum interval, the symbols (manual or the watchlist, cached an hour), the reads and the state. The request code of the other node is reused through a Proxy over the poll context (`requestContext`): it must stay the real context underneath, since n8n's credential helper reads the credential through `this`. Tests are in `test/trigger.test.js` with `test/helpers/fakePoll.js` (a poll context with static data that outlives a check, and `poll.clock.now` to move time).

Rules to keep: a new event needs an `EVENT_NAMES` and an `EVENT_TOOLS` entry, a signature entry in `signatureOf` when a setting changes what the API is asked for (a change then starts a new baseline), a case in `observe`, `latestMatch` and `NOTHING_TO_SHOW`; ids must be stable and rows that do not match a filter are still remembered (so widening the filter does not announce old rows). n8n saves static data only when a poll returns data and at activation, so nothing may depend on state surviving a restart between two empty checks. To try it: `./scripts/dev-n8n.sh`, add a Stocklake Trigger to a workflow, **Fetch Test Event**, then activate it with a short interval (and **Fire on Existing Items**) and watch the executions.

## Dropdowns loaded from Stocklake

`nodes/Stocklake/loadOptions.ts` holds the `methods.loadOptions` functions and the
symbol search with the watchlist (version 2 only); `descriptions/LoadedOptions.ts`
turns the matching version-2 fields into loaded ones, and `optionLists.ts` has the
fallback lists. Rules the tests (`test/loadOptions.test.js`) pin down: never a Pro
tool for a credential that is not Pro, one request per credential and list within
the cache lifetime, and the fallback list on any failure. When the API gains a
sector, preset or type, nothing here needs to change; to make the fallback current,
update `FALLBACK_VALUES`.

## Checking against the real API

`scripts/check-api.js` runs the version-2 operations through the node's real
`execute()` against api.stocklake.dev as a guest, and with a free and a Pro key if
you pass them:

```bash
npm run build
STOCKLAKE_FREE_KEY=... STOCKLAKE_PRO_KEY=... node scripts/check-api.js
```

`scripts/check-options.js` does the same for the dropdown loaders and prints what
each returned and how many requests it made.

Keys come from the environment only and are never printed or stored. It spends
the keys' daily quota, so it is not part of `npm test`. A Pro-only operation
refused for guest or free is reported as `denied`, which is the expected answer.

## Trying the node in a local n8n

The unit tests do not start n8n. For a manual end-to-end check:

```bash
./scripts/dev-n8n.sh
```

This builds, copies `dist/` into `./.n8n-dev/.n8n/custom/n8n-nodes-stocklake/`
(the folder n8n loads custom nodes from) and starts `npx n8n` with
`N8N_USER_FOLDER=./.n8n-dev`, so nothing touches your normal `~/.n8n`. Open
<http://localhost:5678>, create a workflow and add the **Stocklake** node. A node
added this way is version 2; to check version 1, paste a workflow from
`test/fixtures/workflow-v1.json` and rename its node type to match what the editor
shows for custom nodes (`CUSTOM.stocklake`). Re-run the script after a change; it
rebuilds and refreshes the copy, then you restart n8n.

Delete `./.n8n-dev` to start clean. n8n is downloaded by `npx` on first run, so
that needs network access and some disk space. Current n8n releases need Node 24 or
newer; with an older Node, install a newer one first (for example
`npm install node@24` in a scratch folder and put its `bin` first on `PATH`).
The script sets `N8N_CUSTOM_EXTENSIONS`, which this n8n version needs to load the
folder, and copies with `cp` so it works without `rsync`.

To check the dropdowns: in the editor, add a Stocklake node, pick Screener and open
Preset and Sector, Signal and open Source and Direction, Stock → Get Activity and open
Types, and Stock → Get and click the symbol field. With a Pro credential the symbol
list shows the watchlist; with a guest or a used-up limit the dropdowns still fill from
the lists that ship with the node.

## Before and after publishing

Before a release, `npm run build && npm run lint && npm test` must be green (this is
also what `prepublishOnly` runs).

After publishing to npm, scan the published package the way n8n's verification does:

```bash
npx @n8n/scan-community-package n8n-nodes-stocklake
```

Fix anything it reports before submitting the new version for verification.
