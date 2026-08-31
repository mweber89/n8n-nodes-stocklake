import type { ICredentialType, INodeProperties } from 'n8n-workflow';

/**
 * OAuth2 via Dynamic Client Registration (RFC 7591) + PKCE, discovered from
 * https://api.stocklake.dev/.well-known/oauth-authorization-server. n8n's base
 * `oAuth2Api` credential does the full RFC 9728 -> RFC 8414 -> RFC 7591 -> PKCE
 * chain itself once `useDynamicClientRegistration` is on — no client_id/secret
 * to obtain or paste in, unlike the Notion/Linear-style shared-app pattern.
 *
 * DCR (not a single shared client_id, the way Claude/ChatGPT connect) is the
 * right fit specifically because n8n is normally self-hosted per user, so every
 * installation has a different OAuth redirect URI — Stocklake's own
 * /oauth/register already accepts an arbitrary caller-supplied redirect_uris
 * list for exactly this shape of client (confirmed against mcpserver/external/
 * oauth.py; registered this way, not the anthropic-claude silent-approve path,
 * so the user sees Stocklake's normal consent screen).
 */
export class StocklakeOAuth2Api implements ICredentialType {
	name = 'stocklakeOAuth2Api';

	extends = ['oAuth2Api'];

	displayName = 'Stocklake OAuth2 API';

	icon = {
		light: 'file:../nodes/Stocklake/stocklake.svg',
		dark: 'file:../nodes/Stocklake/stocklake.dark.svg',
	} as const;

	documentationUrl = 'https://api.stocklake.dev/llms.txt';

	properties: INodeProperties[] = [
		{
			displayName: 'Use Dynamic Client Registration',
			name: 'useDynamicClientRegistration',
			type: 'hidden',
			default: true,
		},
		{
			displayName: 'Server URL',
			name: 'serverUrl',
			type: 'hidden',
			default: 'https://api.stocklake.dev',
			required: true,
		},
	];
}
