# Workflow templates

Five ready-to-run workflows for the Stocklake nodes, written for n8n's template library.
Open one, click **Copy** and paste it onto an empty canvas (Ctrl+V), or use
**⋮ > Import from File**. Each one has a sticky note with the set-up steps.

Quotes are delayed about 15 minutes. A free Stocklake account is enough for all five
(200 calls a day); connect it on every Stocklake node. Credentials are left out of the
files on purpose: n8n selects the one you have, or asks you to pick.

| Template | Trigger | What it does | Needs | Calls per run |
|---|---|---|---|---|
| [Daily stock briefing to Slack](./daily-watchlist-briefing-slack.json) | Schedule, weekdays 08:00 | Reads the market pulse (VIX, Fear & Greed, S&P 500) and your stocks, posts one message | Slack | 1 + one per ticker |
| [Earnings week alert by Gmail](./earnings-week-alert-gmail.json) | **Stocklake Trigger**, Earnings Coming Up | Emails once for each company that reports in the next 7 days, again if the date moves | Gmail | about 7 a check, every 6 hours |
| [Oversold and overbought digest by email](./oversold-screener-digest-email.json) | Schedule, weekdays 21:30 | Lists the 10 most oversold and 10 most overbought stocks in one email | SMTP | up to 20 |
| [Holdings check logged in Google Sheets](./holdings-check-google-sheets.json) | Schedule, weekdays 21:30 | Reads your holdings from a sheet, values them, flags RSI extremes and soon-reporting stocks, appends one row per holding | Google Sheets | one per holding |
| [AI agent with Stocklake tools](./ai-agent-with-stocklake-tools.json) | Chat | An agent answers market questions with real numbers from a filtered Stocklake toolkit | a chat model | what the agent uses |

Each Slack, Gmail, SMTP and Sheets node can be replaced by whatever you already use
(Telegram, Teams, Notion, Airtable ...): the Stocklake part writes plain fields such as
`text`, `subject` and `body` for the next node.

## Pro variants

None of the templates needs Pro. Pro adds, where it fits: *From My Watchlist* as the
Symbol Source of the briefing, the Signal event of the trigger, and Pro operations in the
AI agent's toolkit filter.

## Before you submit one to the n8n template library

- Replace the example addresses (`you@example.com`) and tickers with what you want shown.
- Run each template once with a real credential and look at the output of every node.
- Keep the sticky note: the library shows it as the description.
