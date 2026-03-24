/**
 * Scorebook API — Cloudflare Worker wrapping KV
 *
 * Routes:
 *   GET    /kv/:store          — list all key/value pairs in a store
 *   GET    /kv/:store/:key     — get a single value
 *   PUT    /kv/:store/:key     — write a value (JSON body)
 *   DELETE /kv/:store/:key     — delete a key
 *
 * Auth: X-API-Key header must match the API_KEY secret.
 * KV keys are prefixed: "store:key" (e.g. "games:game-123")
 */

const ALLOWED_STORES = ['currentGame', 'games', 'teams', 'players'];

export default {
	async fetch(request, env) {
		// CORS preflight
		if (request.method === 'OPTIONS') {
			return corsResponse(new Response(null, { status: 204 }));
		}

		// Auth check
		const apiKey = request.headers.get('X-API-Key');
		if (!apiKey || apiKey !== env.API_KEY) {
			return corsResponse(new Response('Unauthorized', { status: 401 }));
		}

		const url = new URL(request.url);
		const parts = url.pathname.split('/').filter(Boolean);
		// Expected: ["kv", store] or ["kv", store, key]

		if (parts[0] !== 'kv' || parts.length < 2) {
			return corsResponse(new Response('Not found', { status: 404 }));
		}

		const store = parts[1];
		if (!ALLOWED_STORES.includes(store)) {
			return corsResponse(new Response('Invalid store', { status: 400 }));
		}

		const key = parts.length >= 3 ? parts.slice(2).join('/') : null;
		const prefix = store + ':';

		try {
			if (request.method === 'GET' && key) {
				// Get single value
				const value = await env.SCOREBOOK.get(prefix + key, 'json');
				if (value === null) {
					return corsResponse(new Response('Not found', { status: 404 }));
				}
				return corsResponse(Response.json(value));
			}

			if (request.method === 'GET' && !key) {
				// List all in store
				const list = await env.SCOREBOOK.list({ prefix });
				const results = [];
				for (const item of list.keys) {
					const value = await env.SCOREBOOK.get(item.name, 'json');
					const itemKey = item.name.slice(prefix.length);
					results.push({ key: itemKey, value });
				}
				return corsResponse(Response.json(results));
			}

			if (request.method === 'PUT' && key) {
				const body = await request.json();
				await env.SCOREBOOK.put(prefix + key, JSON.stringify(body));
				return corsResponse(new Response('OK', { status: 200 }));
			}

			if (request.method === 'DELETE' && key) {
				await env.SCOREBOOK.delete(prefix + key);
				return corsResponse(new Response('OK', { status: 200 }));
			}

			return corsResponse(new Response('Method not allowed', { status: 405 }));
		} catch (err) {
			return corsResponse(new Response('Internal error: ' + err.message, { status: 500 }));
		}
	}
};

function corsResponse(response) {
	const headers = new Headers(response.headers);
	headers.set('Access-Control-Allow-Origin', '*');
	headers.set('Access-Control-Allow-Methods', 'GET, PUT, DELETE, OPTIONS');
	headers.set('Access-Control-Allow-Headers', 'Content-Type, X-API-Key');
	return new Response(response.body, {
		status: response.status,
		statusText: response.statusText,
		headers
	});
}
