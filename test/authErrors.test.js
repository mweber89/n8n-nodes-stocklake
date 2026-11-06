'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
	describeAuthFailure,
	httpFailure,
	stocklakeApiRequest,
} = require('../dist/nodes/Stocklake/GenericFunctions');

/**
 * The API answers a refused call with HTTP 401 in three different ways, and with 429
 * when a daily limit is used up. n8n alone turns every 401 into "Authorization failed -
 * please check your credentials", which is wrong for a guest who never had one. These
 * bodies are the ones the real API sends (message text shortened where it is long).
 */
const guestLimit = {
	jsonrpc: '2.0',
	id: 't',
	error: {
		code: -32001,
		message: 'Sign-in required: the 25 calls a day without an account are used up for today.',
		data: { reason: 'guest_limit_reached', action_for_agent: 'Authenticate with OAuth' },
	},
};
const proAsGuest = {
	jsonrpc: '2.0',
	id: 't',
	error: {
		code: -32001,
		message: "'get_analyst_trend' requires the Pro tier, and this request carried no credentials.",
		data: { reason: 'pro_tool_unauthenticated', tool: 'get_analyst_trend' },
	},
};
const badKey = { error: 'Invalid or inactive API key', oauth: 'PREFERRED: use OAuth' };
const dailyLimit = {
	error: "Daily limit reached (200 calls/day for tier 'free')",
	pro_upgrade: "Today's 200 Free calls are used. Pro has 5,000 calls a day: https://example.test",
};

/** The same failure as n8n's HTTP helper can report it. */
const shapes = {
	axios: (status, body) =>
		Object.assign(new Error('Request failed'), { response: { status, data: body } }),
	requestLib: (status, body) =>
		Object.assign(new Error('Request failed'), { statusCode: status, error: body }),
	bodyString: (status, body) =>
		Object.assign(new Error('Request failed'), {
			httpCode: String(status),
			response: { body: JSON.stringify(body) },
		}),
};

function ctx(error, { credential = false } = {}) {
	return {
		getNode: () => ({
			name: 'Stocklake',
			credentials: credential ? { stocklakeApi: { id: '1', name: 'k' } } : {},
		}),
		getNodeParameter: (name, _i, fallback) => (name === 'authentication' ? 'apiKey' : fallback),
		helpers: {
			httpRequest: async () => {
				throw error;
			},
			httpRequestWithAuthentication: { call: async () => ({}) },
		},
	};
}
// httpRequestWithAuthentication is invoked with .call(this, name, options) by the node
const withKey = (error) => {
	const c = ctx(error, { credential: true });
	c.helpers.httpRequestWithAuthentication = {
		call: async () => {
			throw error;
		},
	};
	return c;
};

const request = (c) => stocklakeApiRequest.call(c, 'get_stock', {}, 0);

for (const [shapeName, make] of Object.entries(shapes)) {
	test(`${shapeName}: a used-up guest limit says so and says what to do`, async () => {
		await assert.rejects(request(ctx(make(401, guestLimit))), (err) => {
			assert.match(err.message, /guest limit is used up/i);
			assert.match(err.message, /25 calls a day/);
			assert.match(err.message, /same network address/);
			assert.match(err.description, /Authentication/);
			assert.match(err.description, /OAuth2/);
			assert.match(err.description, /00:00 UTC/);
			assert.doesNotMatch(err.message, /check your credentials/i);
			assert.equal(String(err.httpCode), '401');
			return true;
		});
	});

	test(`${shapeName}: a Pro operation without a credential says a credential is needed`, async () => {
		await assert.rejects(request(ctx(make(401, proAsGuest))), (err) => {
			assert.match(err.message, /requires a Stocklake Pro account/);
			assert.match(err.message, /no credential attached/);
			assert.match(err.description, /Pro plan/);
			return true;
		});
	});

	test(`${shapeName}: a rejected key says the key is the problem, not "credentials"`, async () => {
		await assert.rejects(request(withKey(make(401, badKey))), (err) => {
			assert.match(err.message, /rejected the API key/);
			assert.match(err.description, /Check the key in the Stocklake API credential/);
			return true;
		});
	});

	test(`${shapeName}: a daily limit (429) is reported with the API's own text, without the upsell`, async () => {
		await assert.rejects(request(withKey(make(429, dailyLimit))), (err) => {
			assert.match(err.message, /Daily limit reached \(200 calls\/day/);
			assert.match(err.description, /00:00 UTC/);
			assert.doesNotMatch(`${err.message} ${err.description}`, /5,000|example\.test/);
			return true;
		});
	});
}

test("a 401 the node does not recognise keeps n8n's own message", async () => {
	await assert.rejects(request(ctx(shapes.axios(401, { error: 'something else' }))), (err) => {
		assert.doesNotMatch(err.message, /guest limit|requires a Stocklake Pro|rejected the API key/);
		return true;
	});
});

test('other failures (500, no body, network) are untouched', async () => {
	assert.equal(
		describeAuthFailure(httpFailure(shapes.axios(500, { error: 'boom' })), true),
		undefined,
	);
	assert.equal(describeAuthFailure(httpFailure(new Error('ECONNRESET')), false), undefined);
	assert.equal(describeAuthFailure({ status: 401 }, false), undefined);
});

test('httpFailure reads status and body from every shape n8n reports', () => {
	for (const make of Object.values(shapes)) {
		const failure = httpFailure(make(401, badKey));
		assert.equal(failure.status, 401);
		assert.deepEqual(failure.body, badKey);
	}
});

test('a rejected key with no credential attached points to adding one', () => {
	const text = describeAuthFailure({ status: 401, body: badKey }, false);
	assert.match(text.description, /Authentication/);
});

test('every request identifies the node in its User-Agent', async () => {
	let seen;
	const c = {
		getNode: () => ({ name: 'Stocklake', credentials: {} }),
		getNodeParameter: (name, _i, fallback) => (name === 'authentication' ? 'apiKey' : fallback),
		helpers: {
			httpRequest: async (options) => {
				seen = options;
				return { jsonrpc: '2.0', id: 'x', result: { structuredContent: { ok: true } } };
			},
			httpRequestWithAuthentication: { call: async () => ({}) },
		},
	};
	await stocklakeApiRequest.call(c, 'get_market_pulse', {}, 0);
	assert.equal(seen.headers['User-Agent'], 'n8n-nodes-stocklake');
});
