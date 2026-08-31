import type { INodeProperties, INodePropertyOptions } from "n8n-workflow";

/** Yahoo Finance's 11-sector GICS-style taxonomy — the sector vocabulary Stocklake's
 * screener/sector/earnings filters use (confirmed against live get_stock/get_screener
 * responses; there is no dedicated "list sectors" tool to derive this from dynamically). */
export const SECTOR_OPTIONS: INodePropertyOptions[] = [
  { name: "Basic Materials", value: "Basic Materials" },
  { name: "Communication Services", value: "Communication Services" },
  { name: "Consumer Cyclical", value: "Consumer Cyclical" },
  { name: "Consumer Defensive", value: "Consumer Defensive" },
  { name: "Energy", value: "Energy" },
  { name: "Financial Services", value: "Financial Services" },
  { name: "Healthcare", value: "Healthcare" },
  { name: "Industrials", value: "Industrials" },
  { name: "Real Estate", value: "Real Estate" },
  { name: "Technology", value: "Technology" },
  { name: "Utilities", value: "Utilities" },
];

/** A single-symbol Resource Locator field — "From list" searches Stocklake's public
 * autocomplete (no key needed), "By ticker" accepts a raw symbol directly. */
export function symbolLocatorField(
  displayName: string,
  name: string,
  resource: string,
  operation: string,
  description = "The stock ticker, e.g. AAPL",
): INodeProperties {
  return {
    displayName,
    name,
    type: "resourceLocator",
    default: { mode: "list", value: "" },
    required: true,
    displayOptions: {
      show: {
        resource: [resource],
        operation: [operation],
      },
    },
    modes: [
      {
        displayName: "From List",
        name: "list",
        type: "list",
        placeholder: "Search stocks…",
        typeOptions: {
          searchListMethod: "searchSymbols",
          searchable: true,
          searchFilterRequired: true,
        },
      },
      {
        displayName: "By Ticker",
        name: "id",
        type: "string",
        placeholder: "AAPL",
        validation: [
          {
            type: "regex",
            properties: {
              regex: "^[A-Za-z0-9.\\-^]{1,15}$",
              errorMessage: "Not a valid-looking ticker symbol",
            },
          },
        ],
      },
    ],
    description,
  };
}
