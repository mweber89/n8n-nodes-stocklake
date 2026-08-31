import type { INodeProperties } from "n8n-workflow";
import { SECTOR_OPTIONS } from "./shared";

export const earningsOperations: INodeProperties = {
  displayName: "Operation",
  name: "operation",
  type: "options",
  noDataExpression: true,
  displayOptions: { show: { resource: ["earnings"] } },
  default: "getCalendar",
  options: [
    {
      name: "Get Calendar",
      value: "getCalendar",
      description:
        "Upcoming earnings dates for stocks in the Stocklake universe (free)",
      action: "Get earnings calendar",
    },
    {
      name: "Get Intelligence",
      value: "getIntelligence",
      description:
        "Upcoming earnings with AI verdicts, risk factors and AI score (requires Pro)",
      action: "Get earnings intelligence",
    },
  ],
};

export const earningsFields: INodeProperties[] = [
  {
    displayName: "Days",
    name: "days",
    type: "number",
    default: 7,
    typeOptions: { minValue: 1, maxValue: 30 },
    description: "Look-ahead window in days (max 30)",
    displayOptions: {
      show: { resource: ["earnings"], operation: ["getCalendar"] },
    },
  },
  {
    displayName: "Days Ahead",
    name: "daysAhead",
    type: "number",
    default: 14,
    typeOptions: { minValue: 1, maxValue: 30 },
    description: "Look-ahead window in days (max 30)",
    displayOptions: {
      show: { resource: ["earnings"], operation: ["getIntelligence"] },
    },
  },
  {
    displayName: "Sector",
    name: "sector",
    type: "options",
    default: "",
    options: [{ name: "Any", value: "" }, ...SECTOR_OPTIONS],
    displayOptions: {
      show: { resource: ["earnings"], operation: ["getIntelligence"] },
    },
  },
  {
    displayName: "Min AI Score",
    name: "minAiScore",
    type: "number",
    default: 0,
    typeOptions: { minValue: 0, maxValue: 100 },
    description:
      "0-100, applied before Limit truncates the result. Leave at 0 for no minimum.",
    displayOptions: {
      show: { resource: ["earnings"], operation: ["getIntelligence"] },
    },
  },
  {
    displayName: "Limit",
    name: "limit",
    type: "number",
    default: 25,
    typeOptions: { minValue: 1, maxValue: 25 },
    description:
      "Max results. Each returned stock counts as one call toward the daily limit.",
    displayOptions: {
      show: { resource: ["earnings"], operation: ["getIntelligence"] },
    },
  },
];
