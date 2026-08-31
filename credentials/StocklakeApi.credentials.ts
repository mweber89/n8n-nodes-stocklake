import type {
  IAuthenticateGeneric,
  ICredentialTestRequest,
  ICredentialType,
  INodeProperties,
} from "n8n-workflow";

export class StocklakeApi implements ICredentialType {
  name = "stocklakeApi";

  displayName = "Stocklake API";

  icon = {
    light: "file:../nodes/Stocklake/stocklake.svg",
    dark: "file:../nodes/Stocklake/stocklake.dark.svg",
  } as const;

  documentationUrl = "https://api.stocklake.dev/llms.txt";

  properties: INodeProperties[] = [
    {
      displayName: "API Key",
      name: "apiKey",
      type: "string",
      typeOptions: { password: true },
      default: "",
      required: true,
      description:
        'Your Stocklake API key (starts with "sl_"). Get one for free at stocklake.dev/login — enter your email, click the magic link, and your key is on the account page. Free keys unlock the 8 market-data tools at 200 calls/day; upgrade to Pro on the same account page for the 9 AI research tools and 5000 calls/day.',
    },
  ];

  authenticate: IAuthenticateGeneric = {
    type: "generic",
    properties: {
      headers: {
        Authorization: "=Bearer {{$credentials.apiKey}}",
      },
    },
  };

  test: ICredentialTestRequest = {
    request: {
      baseURL: "https://api.stocklake.dev",
      url: "/mcp",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      body: {
        jsonrpc: "2.0",
        id: "credential-test",
        method: "tools/call",
        params: { name: "get_market_pulse", arguments: {} },
      },
    },
  };
}
