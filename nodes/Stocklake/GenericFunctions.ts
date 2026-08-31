import type {
  IExecuteFunctions,
  IDataObject,
  ILoadOptionsFunctions,
  IHttpRequestOptions,
  JsonObject,
} from "n8n-workflow";
import { NodeApiError, NodeOperationError } from "n8n-workflow";

export const STOCKLAKE_MCP_URL = "https://api.stocklake.dev/mcp";
export const STOCKLAKE_SEARCH_URL = "https://api.stocklake.dev/api/search";

interface McpContent {
  type: string;
  text?: string;
}

interface McpToolResult {
  content?: McpContent[];
  structuredContent?: IDataObject;
  isError?: boolean;
}

interface McpJsonRpcResponse {
  jsonrpc: "2.0";
  id: string | number;
  result?: McpToolResult;
  error?: { code: number; message: string; data?: IDataObject };
}

let requestCounter = 0;

/**
 * Calls one Stocklake MCP tool over the Streamable HTTP transport and returns
 * the already-parsed payload. The server is stateless — no session/initialize
 * handshake is needed before tools/call (confirmed live against api.stocklake.dev).
 *
 * Every tool response carries `structuredContent` pre-parsed alongside the
 * `content[0].text` JSON string, so this reads structuredContent first and
 * only falls back to parsing text for the rare plain-text tool error
 * (e.g. "Unknown tool: ...").
 */
export async function stocklakeApiRequest(
  this: IExecuteFunctions | ILoadOptionsFunctions,
  toolName: string,
  toolArguments: IDataObject,
  itemIndex = 0,
): Promise<IDataObject> {
  requestCounter += 1;

  const options: IHttpRequestOptions = {
    method: "POST",
    url: STOCKLAKE_MCP_URL,
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    },
    body: {
      jsonrpc: "2.0",
      id: `n8n-${Date.now()}-${requestCounter}`,
      method: "tools/call",
      params: {
        name: toolName,
        arguments: toolArguments,
      },
    },
    json: true,
  };

  let response: McpJsonRpcResponse;
  try {
    // Credentials are optional (Layer 1 tools work as an unauthenticated
    // guest, 25 calls/day) — only attach auth when the user picked a
    // credential for this node.
    const hasCredential =
      this.getNode().credentials?.stocklakeApi !== undefined;
    response = hasCredential
      ? ((await this.helpers.httpRequestWithAuthentication.call(
          this,
          "stocklakeApi",
          options,
        )) as McpJsonRpcResponse)
      : ((await this.helpers.httpRequest(options)) as McpJsonRpcResponse);
  } catch (error) {
    throw new NodeApiError(this.getNode(), error as JsonObject, { itemIndex });
  }

  if (response.error) {
    // A JSON-RPC-level error (e.g. code -32001 "requires the Pro tier" on an
    // unauthenticated/free-tier call to a Pro-only tool). data.tell_your_user
    // carries a plain-English explanation worth surfacing over the raw message.
    const data = response.error.data ?? {};
    const message = (data.tell_your_user as string) ?? response.error.message;
    throw new NodeOperationError(this.getNode(), message, {
      itemIndex,
      description: response.error.message,
    });
  }

  const result = response.result;
  if (!result) {
    throw new NodeOperationError(
      this.getNode(),
      "Stocklake API returned an empty response",
      {
        itemIndex,
      },
    );
  }

  if (result.structuredContent) {
    return result.structuredContent;
  }

  const text = result.content?.[0]?.text ?? "";
  if (result.isError) {
    throw new NodeOperationError(
      this.getNode(),
      text || "Stocklake API returned an error",
      {
        itemIndex,
      },
    );
  }

  try {
    return JSON.parse(text) as IDataObject;
  } catch {
    // A handful of tool errors (e.g. an unknown tool name) come back as
    // plain, non-JSON text rather than a structured error object.
    return { result: text };
  }
}

/** Splits a "AAPL, MSFT , nvda" field into a clean, de-duplicated symbol array. */
export function parseSymbolList(raw: string): string[] {
  const symbols = raw
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter((s) => s.length > 0);
  return [...new Set(symbols)];
}

/** Strips undefined/empty-string/null values so optional filters are omitted, not sent as "". */
export function cleanParams(params: IDataObject): IDataObject {
  const cleaned: IDataObject = {};
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    cleaned[key] = value;
  }
  return cleaned;
}

/**
 * Resource Locator "From list" search backend for the Symbol field, backed by
 * Stocklake's public autocomplete endpoint (no API key required, ~30 req/min
 * per IP — documented in https://api.stocklake.dev/llms.txt).
 */
export async function searchSymbols(
  this: ILoadOptionsFunctions,
  filter?: string,
): Promise<{ results: Array<{ name: string; value: string }> }> {
  if (!filter || filter.trim().length === 0) {
    return { results: [] };
  }

  const response = (await this.helpers.httpRequest({
    method: "GET",
    url: STOCKLAKE_SEARCH_URL,
    qs: { q: filter.trim() },
    json: true,
  })) as { results?: Array<{ symbol: string; name: string; sector?: string }> };

  return {
    results: (response.results ?? []).map((r) => ({
      name: `${r.symbol} — ${r.name}`,
      value: r.symbol,
    })),
  };
}
