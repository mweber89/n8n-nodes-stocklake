# n8n-nodes-stocklake

An [n8n](https://n8n.io) community node for the [Stocklake](https://stocklake.dev) API — US and international stock market data, with quotes delayed about 15 minutes: fundamentals, technical indicators (RSI, MACD, Bollinger Bands, Williams %R, DeMark, Elliott Wave), AI-synthesized research, insider/institutional activity, earnings intelligence, and macro/sector outlook.

Stocklake has a free tier and a no-key guest mode: the free operations work without signing up. The AI research, signals, sector and market intelligence, news feed and watchlist operations need a Pro account.

## Installation

Follow n8n's guide to [install a community node](https://docs.n8n.io/integrations/community-nodes/installation/) in your n8n instance:

```
n8n-nodes-stocklake
```

## Credentials

Credentials are **optional**. Without one, the node calls Stocklake as an unauthenticated guest (25 calls/day, free operations only). Once connected, either way below, it's 200 calls/day; a Pro account unlocks 5,000 calls/day plus the AI-research operations. Current limits are on [stocklake.dev/docs#rate-limits](https://stocklake.dev/docs#rate-limits). The node's **Authentication** dropdown picks between the two:

**OAuth2 (recommended)** — add a **Stocklake OAuth2 API** credential and click Connect. No key to copy or paste: your browser opens, you sign in with a magic link (or you're already signed in), and n8n handles the rest — including token refresh. Under the hood this uses n8n's Dynamic Client Registration support against Stocklake's own OAuth server, the same mechanism Claude and ChatGPT connectors use.

**API key** — go to [stocklake.dev/login](https://stocklake.dev/login), enter your email, click the magic link, and your key is on the account page. Add a **Stocklake API** credential in n8n and paste it in. Useful if your n8n instance can't complete a browser-based OAuth flow (e.g. some headless/CI setups).

| Tier  | Calls/day | Operations |
|-------|-----------|------------|
| Guest (no credential) | 25 | Free operations: Stock: Get / Get Many / Get History / Get News / Get Insider Activity / Get Financials / Get Filings / Get Activity · Market: Get Movers / Get Pulse / Get Economic Calendar · Earnings: Get Calendar · Screener: Screen Stocks |
| Free  | 200 | Same operations as guest |
| Pro   | 5000 | All of the above (with more on some: the AI read on Get Insider Activity, five years and quarterly statements on Get Financials, summaries on Get Filings, the content of each Get Activity item, a longer Get Economic Calendar window), plus: Stock: Get Research / Get Indicator History / Get Analyst Trend · Market: Get Assessment · Sector: Get Intelligence · Earnings: Get Intelligence · News: Get Feed · Signal: Get Many · Watchlist: Get |

A Pro-only operation called without a Pro key returns a clear error explaining what's needed and where to upgrade — the node doesn't hide these operations, since Stocklake's own philosophy is "data is free, intelligence is Pro," and it's useful to see what's available even before upgrading.

## Resources & operations

The Stocklake API has 22 tools: 13 available without Pro and 9 that need it. Version 2 of this node exposes all 22 (13 free, 9 Pro), grouped into 8 resources; version 1 has the original 17. Each operation links to its reference page:

- **Stock** ([reference](https://stocklake.dev/docs/tools#get_stock)) — Get, Get Many (batch, up to 25 symbols), Get History, Get News, Get Research, Get Indicator History, Get Insider Activity, plus new in version 2: Get Financials ([reference](https://stocklake.dev/docs/tools#get_stock_financials); balance sheet, income statement and cash flow, latest year free, 5 years and quarterly on Pro), Get Filings ([reference](https://stocklake.dev/docs/tools#get_stock_filings); SEC 8-K filings, summaries on Pro), Get Activity ([reference](https://stocklake.dev/docs/tools#get_stock_activity); one timeline of news, filings, insider trades, earnings, analyst changes and setups), Get Analyst Trend ([reference](https://stocklake.dev/docs/tools#get_analyst_trend); Pro)
- **Screener** ([reference](https://stocklake.dev/docs/tools#get_screener)) — Screen Stocks (filter/rank the universe by sector, RSI, market cap, analyst rating, AI score, and more)
- **Market** ([reference](https://stocklake.dev/docs/tools#get_market_pulse)) — Get Pulse (VIX, Fear & Greed, breadth), Get Movers, Get Assessment (AI macro regime), and new in version 2: Get Economic Calendar ([reference](https://stocklake.dev/docs/tools#get_economic_calendar); rate decisions, CPI, GDP, payrolls)
- **Sector** ([reference](https://stocklake.dev/docs/tools#get_sector_intelligence)) — Get Intelligence (one sector, or all 11 as a rotation view)
- **Earnings** ([reference](https://stocklake.dev/docs/tools#get_earnings_calendar)) — Get Calendar, Get Intelligence (AI-scored upcoming earnings)
- **News** ([reference](https://stocklake.dev/docs/tools#get_news_feed)) — Get Feed (market-wide AI-flagged news briefing)
- **Signal** ([reference](https://stocklake.dev/docs/tools#get_signals)) — Get Many (the AI-screened trade-idea queue)
- **Watchlist** ([reference](https://stocklake.dev/docs/tools#get_watchlist)) — Get (your starred symbols on stocklake.dev, enriched with the latest data)

The **Symbol** field on single-stock operations is a Resource Locator: search by company name or ticker ("From List", backed by Stocklake's public autocomplete — no key needed), or type a ticker directly ("By Ticker").

## Node versions

The node has two versions. **Version 2** is the default for new nodes. **Version 1** is the node as published in 0.1.x: workflows saved with it keep running with the same parameters and the same output, and are never converted automatically. To move a node to version 2, open its settings and pick the new version.

## Output (version 2)

Version 2 behaves like a native n8n node. Operations that return a list give **one item per row**, so you can wire them straight into Filter, Sort, Split In Batches or a spreadsheet node without splitting a blob first:

- Stock: Get Many, Get History, Get Indicator History, Get News, Get Filings, Get Activity, Get Analyst Trend
- Screener: Screen Stocks
- Market: Get Movers (one item per mover, with a `category` field), Get Economic Calendar (rows carry a `bucket` of `released_recent` or `upcoming`)
- Earnings: Get Calendar, Get Intelligence
- News: Get Feed
- Signal: Get Many
- Watchlist: Get

Every other operation (Stock: Get, Get Research, Get Financials, Get Insider Activity; Market: Get Pulse, Get Assessment; Sector: Get Intelligence) returns the whole response as one item.

- **Simplify** (on by default) returns a flat, chosen set of fields per row. Turn it off for every field the API returns, including nested objects. Rows that lack a chosen field simply leave it out.
- **Return All / Limit.** With Return All off, **Limit** is the number of rows you get back. With it on, you get everything the API will give you: Activity reads page after page, the Earnings Calendar pages through the whole window on Pro, Get Many sends symbols in batches of 25, and the other operations ask for the API's maximum per call (Screener 25, Signals 50, News Feed 25, Earnings Intelligence 25, Filings 25, Movers 20 per category). A Limit above an operation's per-call maximum is held to that maximum; Activity and the Earnings Calendar read further pages to reach it. Each page or batch counts as a call on your daily limit, as the API bills it.
- **Include Response Metadata** (under Options) adds what the API returns around the rows, such as counts, applied filters and notes about the plan, to every item as `_meta`. If a list comes back empty, that one item is still returned so the note is not lost.
- Rows from History, Indicator History, News and Analyst Trend carry the `symbol` they belong to, so rows from several input items stay distinguishable after a Merge.
- Every output item is paired with the input item that produced it, so expressions such as `$('Stocklake').item` work.

Version 1 keeps returning the whole response as one item; its output has not changed.

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
      "typeVersion": 2,
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
      "typeVersion": 2,
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

No credential is required to run this example. It only uses free operations.

## Full API reference

Every parameter this node exposes maps 1:1 onto Stocklake's public MCP API — see [api.stocklake.dev/llms.txt](https://api.stocklake.dev/llms.txt) for the exact, always-current parameter list, defaults, and tier gating, or [stocklake.dev/docs](https://stocklake.dev/docs) for narrative docs.

## Development

See [CONTRIBUTING.md](./CONTRIBUTING.md) for building, testing, and trying the node in a local n8n.

## Compatibility

Tested against n8n's Streamable HTTP MCP transport as of n8n-workflow 2.x. Requires Node.js 20.15+.

## Resources

- [n8n community nodes documentation](https://docs.n8n.io/integrations/community-nodes/)
- [Stocklake API documentation](https://stocklake.dev/docs)
- [Stocklake API agent guide (llms.txt)](https://api.stocklake.dev/llms.txt)

## License

[MIT](./LICENSE.md)
