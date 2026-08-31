import type { INodeProperties } from "n8n-workflow";

export const marketOperations: INodeProperties = {
  displayName: "Operation",
  name: "operation",
  type: "options",
  noDataExpression: true,
  displayOptions: { show: { resource: ["market"] } },
  default: "getPulse",
  options: [
    {
      name: "Get Pulse",
      value: "getPulse",
      description:
        "Current market state: VIX, Fear & Greed, RSI breadth, SPY/QQQ/IWM indices (free)",
      action: "Get market pulse",
    },
    {
      name: "Get Movers",
      value: "getMovers",
      description:
        "Top gainers, losers and most-active stocks from the Stocklake universe (free)",
      action: "Get market movers",
    },
    {
      name: "Get Assessment",
      value: "getAssessment",
      description:
        "AI macro regime and market outlook in one call (requires Pro)",
      action: "Get market assessment",
    },
  ],
};

export const marketFields: INodeProperties[] = [
  {
    displayName: "Category",
    name: "category",
    type: "options",
    default: "all",
    options: [
      { name: "All", value: "all" },
      { name: "Gainers", value: "gainers" },
      { name: "Losers", value: "losers" },
      { name: "Most Active", value: "most_active" },
    ],
    displayOptions: {
      show: { resource: ["market"], operation: ["getMovers"] },
    },
  },
  {
    displayName: "Limit",
    name: "limit",
    type: "number",
    default: 10,
    typeOptions: { minValue: 1, maxValue: 20 },
    description:
      "Results per category (max 20). A symbol appearing in more than one category counts once per category toward the daily limit.",
    displayOptions: {
      show: { resource: ["market"], operation: ["getMovers"] },
    },
  },
  {
    displayName: "Min Market Cap ($B)",
    name: "minMarketCapB",
    type: "number",
    default: 0,
    typeOptions: { minValue: 0 },
    description: "Leave at 0 for no minimum",
    displayOptions: {
      show: { resource: ["market"], operation: ["getMovers"] },
    },
  },
  {
    displayName: "History Count",
    name: "historyCount",
    type: "number",
    default: 0,
    typeOptions: { minValue: 0 },
    description:
      "How many prior regime/outlook readings to include alongside the current one",
    displayOptions: {
      show: { resource: ["market"], operation: ["getAssessment"] },
    },
  },
];
