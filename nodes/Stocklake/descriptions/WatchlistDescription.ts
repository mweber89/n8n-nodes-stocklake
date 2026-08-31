import type { INodeProperties } from "n8n-workflow";

export const watchlistOperations: INodeProperties = {
  displayName: "Operation",
  name: "operation",
  type: "options",
  noDataExpression: true,
  displayOptions: { show: { resource: ["watchlist"] } },
  default: "get",
  options: [
    {
      name: "Get",
      value: "get",
      description:
        "The caller's Stocklake watchlist, enriched with live price, RSI and AI verdict (requires Pro). Read-only — starring is web-only, at stocklake.dev/dashboard.",
      action: "Get watchlist",
    },
  ],
};

export const watchlistFields: INodeProperties[] = [];
