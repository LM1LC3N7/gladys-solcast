// -----------------------------------------------------------------------------
// The only network access: HTTPS requests to the Solcast API, and the errors
// they end with.
//
// Documented by Solcast (docs.solcast.com.au: "Rooftop Sites (Hobbyist)",
// "Errors"): the key goes in `Authorization: Bearer <key>`, a failed request
// answers `{ response_status: { error_code, message } }`, 429 means "too many
// requests". The Home Assistant integration BJReplay/ha-solcast-solar
// (Apache-2.0) documents what a hobbyist meets in practice: the daily limit
// is a 429 whose error_code is "TooManyRequests" ("You have exceeded your
// free daily limit."), while a 429 without it is a busy server ("try again
// later"), frequent on the quarter hours, that uses no call.
// -----------------------------------------------------------------------------

import http from 'node:http';
import https from 'node:https';
import { LIMITS, TIMINGS } from './constants.js';

/**
 * A failed Solcast call. `kind`:
 * - `no_key`: no API key in the configuration (never sent);
 * - `refused`: the key was refused (401, 403);
 * - `not_found`: no such rooftop site (404);
 * - `exhausted`: the daily limit is reached (429 "TooManyRequests", 402);
 * - `busy`: Solcast asks to try again later (other 429), `retryAfter` in ms;
 * - `unavailable`: Solcast is down (5xx);
 * - `network`, `timeout`: no answer;
 * - `bad_response`, `size`: an answer that is not the expected JSON;
 * - `http`: any other status.
 */
export class SolcastError extends Error {
  constructor(kind, message, { status, retryAfter, detail } = {}) {
    super(message);
    this.name = 'SolcastError';
    this.kind = kind;
    this.status = status;
    this.retryAfter = retryAfter;
    this.detail = detail;
  }
}

/** Errors after which Solcast answered: the request may have used a call. */
export const ANSWERED = new Set(['bad_response', 'size']);

const NETWORK_REASONS = {
  ECONNREFUSED: 'connection refused',
  ECONNRESET: 'connection reset',
  EHOSTUNREACH: 'host unreachable',
  ENETUNREACH: 'network unreachable',
  ENOTFOUND: 'unknown host name',
  EAI_AGAIN: 'host name not resolved',
  ETIMEDOUT: 'connection timed out',
  EPIPE: 'connection closed',
};

/** A socket error -> SolcastError (never the request: its headers carry the key). */
export function networkError(err) {
  if (err instanceof SolcastError) {
    return err;
  }
  const reason = NETWORK_REASONS[err?.code] ?? err?.code ?? 'network error';
  return new SolcastError('network', reason);
}

/** A short, secret-free reason for a log or a status message. */
export function errorReason(err) {
  if (err instanceof SolcastError) {
    const detail = err.detail ? `: ${err.detail}` : '';
    return err.status ? `${err.message}${detail} (HTTP ${err.status})` : `${err.message}${detail}`;
  }
  return String(err?.message ?? err);
}

/**
 * One request; resolves `{ status, headers, body }` whatever the status. The
 * promise settles once: a request destroyed for its size or its timeout may
 * still end or fail after that.
 * @param {string} url
 * @param {{ method?: string, headers?: object, timeout?: number, maxBytes?: number }} options
 */
export function httpRequest(
  url,
  {
    method = 'GET',
    headers = {},
    timeout = TIMINGS.requestTimeout,
    maxBytes = LIMITS.responseBytes,
  } = {},
) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const lib = target.protocol === 'https:' ? https : http;
    let timer;
    let settled = false;
    const settle = (fn, value) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        fn(value);
      }
    };
    const req = lib.request(target, { method, headers }, (res) => {
      const chunks = [];
      let size = 0;
      res.on('data', (chunk) => {
        size += chunk.length;
        if (size > maxBytes) {
          settle(reject, new SolcastError('size', 'answer too large'));
          req.destroy();
          return;
        }
        chunks.push(chunk);
      });
      res.on('end', () =>
        settle(resolve, {
          status: res.statusCode,
          headers: res.headers,
          body: Buffer.concat(chunks).toString('utf8'),
        }),
      );
      res.on('error', (err) => settle(reject, networkError(err)));
    });
    timer = setTimeout(() => {
      settle(
        reject,
        new SolcastError('timeout', `no answer within ${Math.round(timeout / 1000)} s`),
      );
      req.destroy();
    }, timeout);
    req.on('error', (err) => settle(reject, networkError(err)));
    req.end();
  });
}

/** Retry-After (seconds or an HTTP date) -> milliseconds, undefined when absent. */
export function parseRetryAfter(value, now = Date.now()) {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  const seconds = Number(value);
  if (Number.isFinite(seconds)) {
    return Math.max(0, seconds * 1000);
  }
  const date = Date.parse(value);
  return Number.isNaN(date) ? undefined : Math.max(0, date - now);
}

/** The `response_status` of an error answer, if any. */
export function responseStatus(body) {
  try {
    const status = JSON.parse(body)?.response_status;
    return status && typeof status === 'object' ? status : undefined;
  } catch {
    return undefined;
  }
}

const header = (headers, name) => {
  const value = headers?.[name] ?? headers?.[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
};

/** The X-RateLimit-* headers Solcast documents, when sent: { limit, remaining }. */
export function rateLimitOf(headers) {
  const read = (name) => {
    const n = Number(header(headers, name));
    return Number.isInteger(n) && n >= 0 ? n : undefined;
  };
  return { limit: read('x-ratelimit-limit'), remaining: read('x-ratelimit-remaining') };
}

/** The error of a non-2xx answer. */
export function errorFor({ status, headers = {}, body = '' }, { now } = {}) {
  const solcast = responseStatus(body);
  const detail = typeof solcast?.message === 'string' ? solcast.message.slice(0, 120) : undefined;
  const options = { status, detail };
  if (status === 401 || status === 403) {
    return new SolcastError('refused', 'API key refused', options);
  }
  if (status === 404) {
    return new SolcastError('not_found', 'rooftop site not found', options);
  }
  if (status === 402) {
    return new SolcastError('exhausted', 'request limit reached', options);
  }
  if (status === 429) {
    const daily =
      solcast?.error_code === 'TooManyRequests' ||
      /daily limit/i.test(detail ?? '') ||
      rateLimitOf(headers).remaining === 0;
    if (daily) {
      return new SolcastError('exhausted', 'daily limit reached', options);
    }
    return new SolcastError('busy', 'Solcast is busy', {
      ...options,
      retryAfter: parseRetryAfter(header(headers, 'retry-after'), now),
    });
  }
  if (status >= 500) {
    return new SolcastError('unavailable', 'Solcast is unavailable', options);
  }
  return new SolcastError('http', 'request failed', options);
}

/** A JSON answer. */
export function parseJson(body) {
  try {
    const json = JSON.parse(body);
    if (json && typeof json === 'object') {
      return json;
    }
  } catch {
    // reported below
  }
  throw new SolcastError('bad_response', 'Solcast sent an answer that is not JSON');
}
