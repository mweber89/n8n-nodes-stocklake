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

## Checking against the live API

`scripts/live-check.js` runs the version-2 operations through the node's real
`execute()` against api.stocklake.dev as a guest, and with a free and a Pro key if
you pass them:

```bash
npm run build
STOCKLAKE_FREE_KEY=... STOCKLAKE_PRO_KEY=... node scripts/live-check.js
```

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
that needs network access and some disk space.

## Before and after publishing

Before a release, `npm run build && npm run lint && npm test` must be green (this is
also what `prepublishOnly` runs).

After publishing to npm, scan the published package the way n8n's verification does:

```bash
npx @n8n/scan-community-package n8n-nodes-stocklake
```

Fix anything it reports before submitting the new version for verification.
