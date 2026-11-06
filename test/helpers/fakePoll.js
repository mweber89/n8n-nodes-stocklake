'use strict';

/**
 * A fake n8n context for the polling trigger. It plays what n8n gives `poll()`: the
 * parameters (with the defaults n8n fills in), the mode, the node's workflow static
 * data (one object, kept between polls so a test can run several checks and look at
 * it) and the HTTP helpers, backed by the fake Stocklake server of fakeMcp.js.
 */

const { resolveParameters } = require('./fakeMcp');

/**
 * @param {object} node  the trigger instance
 * @param {object} opts
 * @param {object} opts.params  user-set parameters
 * @param {object} opts.fake  from createFakeMcp
 * @param {object} [opts.staticData]  the node's static data; pass the same object to every poll
 * @param {'manual'|'trigger'} [opts.mode]
 * @param {boolean} [opts.apiKeyCredential]
 */
function pollContext(node, opts) {
	const { fake, params = {}, staticData = {}, mode = 'trigger', apiKeyCredential = true } = opts;
	const values = resolveParameters(node.description, params, 1);
	return {
		getMode: () => mode,
		getNodeParameter(name, fallback) {
			return name in values ? values[name] : fallback;
		},
		getNode: () => ({
			name: 'Stocklake Trigger',
			type: 'n8n-nodes-stocklake.stocklakeTrigger',
			typeVersion: 1,
			credentials: apiKeyCredential
				? { stocklakeApi: { id: '1', name: 'Stocklake API' } }
				: undefined,
		}),
		getWorkflowStaticData: () => staticData,
		// Like n8n's own: the credential helper reads the credential through the `this` it is
		// called with, so a caller that passes some other object breaks (it did, once).
		getCredentials: async () => ({ apiKey: 'sl_test' }),
		helpers: {
			httpRequest: fake.httpRequest,
			httpRequestWithAuthentication: async function (credentialName, options) {
				await this.getCredentials(credentialName);
				return fake.httpRequestWithAuthentication(credentialName, options);
			},
			returnJsonArray: (data) => (Array.isArray(data) ? data : [data]).map((json) => ({ json })),
		},
	};
}

/** One check. Returns the output items (flat) or null when nothing was returned. */
async function runPoll(node, opts) {
	const output = await node.poll.call(pollContext(node, opts));
	return output === null ? null : output[0].map((item) => item.json);
}

module.exports = { pollContext, runPoll };
