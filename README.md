# n8n-nodes-stocklake

An [n8n](https://n8n.io) community node for the [Stocklake](https://stocklake.dev) API — real-time and historical US/international stock market data: fundamentals, technical indicators (RSI, MACD, Bollinger Bands, Williams %R, DeMark, Elliott Wave), AI-synthesized research, insider/institutional activity, earnings intelligence, and macro/sector outlook.

Stocklake has a free tier and a no-key guest mode — you can try every operation in this node without signing up.

## Installation

Follow n8n's guide to [install a community node](https://docs.n8n.io/integrations/community-nodes/installation/) in your n8n instance:

```
n8n-nodes-stocklake
```

## Credentials

An API key is **optional**. Without one, the node calls Stocklake as an unauthenticated guest (25 calls/day, the 8 market-data operations only). With a free key it's 200 calls/day; a Pro key unlocks 5000 calls/day plus 9 additional AI-research operations.

To get a key: go to [stocklake.dev/login](https://stocklake.dev/login), enter your email, and click the magic link — no password, no credit card. Your key is on the account page. Then add a **Stocklake API** credential in n8n and paste it in.

| Tier  | Calls/day | Operations |
|-------|-----------|------------|
| Guest (no credential) | 25 | Stock: Get / Get Many / Get History / Get News · Market: Get Movers / Get Pulse · Earnings: Get Calendar · Screener: Screen Stocks |
| Free  | 200 | Same operations as guest |
| Pro   | 5000 | All of the above, plus: Stock: Get Research / Get Indicator History / Get Insider Activity · Market: Get Assessment · Sector: Get Intelligence · Earnings: Get Intelligence · News: Get Feed · Signal: Get Many · Watchlist: Get |

A Pro-only operation called without a Pro key returns a clear error explaining what's needed and where to upgrade — the node doesn't hide these operations, since Stocklake's own philosophy is "data is free, intelligence is Pro," and it's useful to see what's available even before upgrading.

## Resources & operations

The node groups Stocklake's 17 API tools into 8 resources, matching how you'd naturally think about the data:

- **Stock** — Get, Get Many (batch, up to 25 symbols), Get History, Get News, Get Research, Get Indicator History, Get Insider Activity
- **Screener** — Screen Stocks (filter/rank the universe by sector, RSI, market cap, analyst rating, AI score, and more)
- **Market** — Get Pulse (VIX, Fear & Greed, breadth), Get Movers, Get Assessment (AI macro regime)
- **Sector** — Get Intelligence (one sector, or all 11 as a rotation view)
- **Earnings** — Get Calendar, Get Intelligence (AI-scored upcoming earnings)
- **News** — Get Feed (market-wide AI-flagged news briefing)
- **Signal** — Get Many (the AI-screened trade-idea queue)
- **Watchlist** — Get (your starred symbols on stocklake.dev, enriched with live data)

The **Symbol** field on single-stock operations is a Resource Locator: search by company name or ticker ("From List", backed by Stocklake's public autocomplete — no key needed), or type a ticker directly ("By Ticker").

## Example workflow

A daily oversold-stock digest: a Schedule Trigger fires two Stocklake nodes in parallel (Market → Get Pulse, Screener → Screen Stocks with the `oversold` preset), a Code node formats the two results into one digest string, and a final node is left ready for you to wire into Slack, Send Email, Google Sheets, or whatever you already use for notifications.

Import it via n8n's editor: **⋮ menu → Import from File/URL**, or paste the JSON below into **Import from Clipboard**. It's also checked into this repo at [`examples/oversold-digest.workflow.json`](./examples/oversold-digest.workflow.json).

<details>
<summary>Workflow JSON</summary>

```json
{
  "name": "Stocklake — Daily Oversold Digest",
  "nodes": [
    {
      "id": "a1b2c3d4-0001-4000-8000-000000000001",
      "name": "Every Morning 8am",
      "type": "n8n-nodes-base.scheduleTrigger",
      "typeVersion": 1.2,
      "position": [0, 0],
      "parameters": {
        "rule": {
          "interval": [{ "field": "cronExpression", "expression": "0 8 * * 1-5" }]
        }
      }
    },
    {
      "id": "a1b2c3d4-0002-4000-8000-000000000002",
      "name": "Market Pulse",
      "type": "n8n-nodes-stocklake.stocklake",
      "typeVersion": 1,
      "position": [220, -80],
      "parameters": {
        "resource": "market",
        "operation": "getPulse"
      }
    },
    {
      "id": "a1b2c3d4-0003-4000-8000-000000000003",
      "name": "Oversold Screen",
      "type": "n8n-nodes-stocklake.stocklake",
      "typeVersion": 1,
      "position": [220, 80],
      "parameters": {
        "resource": "screener",
        "operation": "screen",
        "preset": "oversold",
        "limit": 10
      }
    },
    {
      "id": "a1b2c3d4-0004-4000-8000-000000000004",
      "name": "Format Digest",
      "type": "n8n-nodes-base.code",
      "typeVersion": 2,
      "position": [460, 0],
      "parameters": {
        "mode": "runOnceForAllItems",
        "language": "javaScript",
        "jsCode": "const pulse = $('Market Pulse').first().json;\nconst screen = $('Oversold Screen').all().map(i => i.json);\n\nconst fg = pulse.fear_greed || {};\nconst br = pulse.breadth || {};\n\nconst lines = [\n  `Stocklake Oversold Digest — ${new Date().toDateString()}`,\n  '',\n  `VIX ${pulse.vix ?? '—'} | Fear & Greed ${fg.value ?? '—'} (${fg.description ?? 'n/a'})`,\n  `Breadth: ${br.oversold_pct ?? '—'}% oversold of ${br.universe_size ?? '—'} stocks`,\n  '',\n  `Oversold candidates (${screen.length}):`,\n  ...screen.map(s => `  ${(s.symbol ?? '?').padEnd(6)} RSI ${s.rsi ?? '—'}  $${s.price ?? '—'}  ${s.name ?? ''}`),\n];\n\nreturn [{ json: { digest: lines.join('\\n') } }];"
      }
    },
    {
      "id": "a1b2c3d4-0005-4000-8000-000000000005",
      "name": "Digest Ready",
      "type": "n8n-nodes-base.noOp",
      "typeVersion": 1,
      "position": [680, 0],
      "notes": "Wire this to Slack, Send Email, Google Sheets, etc. — whatever notification node you already have credentials for."
    }
  ],
  "connections": {
    "Every Morning 8am": {
      "main": [
        [
          { "node": "Market Pulse", "type": "main", "index": 0 },
          { "node": "Oversold Screen", "type": "main", "index": 0 }
        ]
      ]
    },
    "Market Pulse": {
      "main": [[{ "node": "Format Digest", "type": "main", "index": 0 }]]
    },
    "Oversold Screen": {
      "main": [[{ "node": "Format Digest", "type": "main", "index": 0 }]]
    },
    "Format Digest": {
      "main": [[{ "node": "Digest Ready", "type": "main", "index": 0 }]]
    }
  },
  "pinData": {}
}
```

</details>

No credential is required to run this example — it only uses guest-tier operations.

## Full API reference

Every parameter this node exposes maps 1:1 onto Stocklake's public MCP API — see [api.stocklake.dev/llms.txt](https://api.stocklake.dev/llms.txt) for the exact, always-current parameter list, defaults, and tier gating, or [stocklake.dev/docs](https://stocklake.dev/docs) for narrative docs.

## Compatibility

Tested against n8n's Streamable HTTP MCP transport as of n8n-workflow 2.x. Requires Node.js 20.15+.

## Resources

- [n8n community nodes documentation](https://docs.n8n.io/integrations/community-nodes/)
- [Stocklake API documentation](https://stocklake.dev/docs)
- [Stocklake API agent guide (llms.txt)](https://api.stocklake.dev/llms.txt)

## License

[MIT](./LICENSE.md)
