// -----------------------------------------------------------------------------
// A fake Solcast API behind the transport the integration is given: the
// sites of the key, the forecasts of a site with the daily limit of a
// hobbyist account (reset at midnight UTC, a 429 "TooManyRequests" past it),
// busy 429 answers, 401/403/404 like the documentation and the Home
// Assistant simulator describe them. Records every request. No network.
// -----------------------------------------------------------------------------

import { SolcastError } from '../../src/solcast.js';
import { API_KEY, SOUTH, WEST, forecastAnswer, sitesAnswer } from '../fixtures/solcast.js';

const answer = (status, body, headers = {}) => ({
  status,
  headers,
  body: typeof body === 'string' ? body : JSON.stringify(body),
});

const error = (status, code, message) =>
  answer(status, { response_status: { error_code: code, message, errors: [] } });

export function fakeSolcast({ sites = [SOUTH, WEST], key = API_KEY, limit = 10 } = {}) {
  const server = {
    sites,
    key,
    limit,
    /** Calls counted in the current UTC day. */
    used: 0,
    day: undefined,
    /** { method, path, query, headers, at } */
    requests: [],
    /** No answer at all (DNS, connection refused). */
    down: false,
    /** The next forecast requests answer a busy 429 (no call used). */
    busy: 0,
    /** Headers added to the forecast answers (X-RateLimit-*). */
    forecastHeaders: {},
    /** Called with each request before it is answered. */
    onRequest: undefined,
    listings() {
      return this.requests.filter((r) => r.path === '/rooftop_sites');
    },
    forecasts(id) {
      return this.requests.filter(
        (r) => r.path.endsWith('/forecasts') && (id === undefined || r.path.includes(id)),
      );
    },
  };

  server.transport = async (url, { method = 'GET', headers = {} } = {}) => {
    const target = new URL(url);
    const request = {
      method,
      path: target.pathname,
      query: Object.fromEntries(target.searchParams),
      headers,
      at: Date.now(),
    };
    server.requests.push(request);
    server.onRequest?.(request);
    if (server.down) {
      throw new SolcastError('network', 'connection refused');
    }
    const auth = headers.Authorization;
    if (!auth) {
      return error(401, 'Unauthorized', 'An API key must be specified.');
    }
    if (auth !== `Bearer ${server.key}`) {
      return error(403, 'InvalidKey', 'Invalid API key.');
    }
    if (request.path === '/rooftop_sites' && method === 'GET') {
      return answer(200, sitesAnswer(server.sites));
    }
    const match = /^\/rooftop_sites\/([^/]+)\/forecasts$/.exec(request.path);
    if (match && method === 'GET') {
      const day = new Date(Date.now()).toISOString().slice(0, 10);
      if (day !== server.day) {
        server.day = day;
        server.used = 0;
      }
      const site = server.sites.find((s) => s.resource_id === decodeURIComponent(match[1]));
      if (!site) {
        return error(404, 'SiteNotFound', 'The specified site cannot be found.');
      }
      if (server.busy > 0) {
        server.busy -= 1;
        return answer(429, '');
      }
      if (server.used >= server.limit) {
        return error(429, 'TooManyRequests', 'You have exceeded your free daily limit.');
      }
      server.used += 1;
      const hours = Number(request.query.hours ?? 168);
      return answer(200, forecastAnswer(site, Date.now(), hours), server.forecastHeaders);
    }
    return error(404, 'NotFound', 'Not found.');
  };

  return server;
}

/** An in-memory store, in place of the /data file. */
export function memoryStore(initial = null) {
  return {
    data: initial,
    saves: 0,
    async load() {
      return this.data === null ? null : structuredClone(this.data);
    },
    async save(data) {
      this.saves += 1;
      this.data = structuredClone(data);
    },
  };
}

/** Lets the pending promises settle (no timer involved). */
export const settle = async (rounds = 20) => {
  for (let i = 0; i < rounds; i += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
};
