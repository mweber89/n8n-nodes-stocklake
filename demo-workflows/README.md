# Example workflows

Three ready-to-run workflows for the Stocklake node. Copy a file's contents and
paste it straight onto an empty n8n canvas (Ctrl+V) — no import dialog needed.

Credentials are deliberately omitted from the JSON. n8n auto-selects a matching
credential on paste **only when exactly one of that type exists**; if you have
both a `Stocklake API` and a `Stocklake OAuth2 API` credential, open each node
and pick the one you want before executing.

| File | What it shows |
|---|---|
| `1-common-actions.json` | A manual trigger fanning out to three operations in parallel — `Stock → Get`, `Screener → Screen` (oversold, sorted by RSI), `Market → Get Pulse`. One execution, three results. |
| `2-ai-agent.json` | The node attached to an AI Agent as a tool. The ticker is wired to `$fromAI('symbol', ...)`, so the model extracts it from the question ("what's the RSI on NVDA?") rather than it being hardcoded. |
| `3-daily-briefing.json` | A scheduled screen: market assessment → stocks under RSI 30 above $2B → split → `Stock → Get Research` per hit. |

## Notes

**Tier.** `1` and `3` use free-tier operations except `Get Research`, which is
Pro. `2` uses `Stock → Get`, which works on any tier — including with no
credential at all (25 calls/day as a guest).

**Chat model for `2`.** The agent needs a language model attached. The workflow
ships pointing at an OpenAI-compatible endpoint; set the model name and base URL
to whatever you use. Any model that supports tool calling will do — the node is
only useful to an agent that can actually invoke it.

**Rate limits.** `Screener`, `Get Many`, `Market → Get Movers`, `Signals` and
`Earnings → Get Intelligence` bill one call per row returned, not one per
request. Workflow `3` deliberately caps the screener at 5 for that reason.
