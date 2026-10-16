// -----------------------------------------------------------------------------
// The HTTPS transport against a loopback HTTP server (no Internet), and the
// errors of the Solcast answers.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {
  SolcastError,
  errorFor,
  errorReason,
  httpRequest,
  networkError,
  parseJson,
  parseRetryAfter,
  rateLimitOf,
} from '../src/solcast.js';

async function server(t, handler) {
  const srv = http.createServer(handler);
  await new Promise((resolve) => srv.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => srv.close(resolve)));
  return `http://127.0.0.1:${srv.address().port}`;
}

test('a request resolves the status, the headers and the body', async (t) => {
  let seen;
  const base = await server(t, (req, res) => {
    seen = { method: req.method, url: req.url, auth: req.headers.authorization };
    res.writeHead(429, { 'retry-after': '120', 'content-type': 'application/json' });
    res.end('{"response_status":{"error_code":"TooManyRequests"}}');
  });
  const answer = await httpRequest(`${base}/rooftop_sites?format=json`, {
    headers: { Authorization: 'Bearer k' },
  });
  assert.equal(answer.status, 429);
  assert.equal(answer.headers['retry-after'], '120');
  assert.match(answer.body, /TooManyRequests/);
  assert.deepEqual(seen, { method: 'GET', url: '/rooftop_sites?format=json', auth: 'Bearer k' });
});

test('a silent server times out, a huge answer is cut, a closed port is a network error', async (t) => {
  const base = await server(t, (req, res) => {
    if (req.url === '/big') {
      res.end('x'.repeat(5000));
    }
    // /slow never answers.
  });
  await assert.rejects(httpRequest(`${base}/slow`, { timeout: 200 }), { kind: 'timeout' });
  await assert.rejects(httpRequest(`${base}/big`, { maxBytes: 1000 }), { kind: 'size' });
  await assert.rejects(httpRequest('http://127.0.0.1:1/'), {
    kind: 'network',
    message: 'connection refused',
  });
});

test('the Solcast errors: refused key, unknown site, daily limit, busy, down', () => {
  const body = (code, message) =>
    JSON.stringify({ response_status: { error_code: code, message } });
  assert.equal(errorFor({ status: 401, body: body('Unauthorized', 'No key') }).kind, 'refused');
  const refused = errorFor({ status: 403, body: body('InvalidKey', 'Invalid API key.') });
  assert.equal(refused.kind, 'refused');
  assert.equal(errorReason(refused), 'API key refused: Invalid API key. (HTTP 403)');
  assert.equal(errorFor({ status: 404, body: '' }).kind, 'not_found');
  assert.equal(errorFor({ status: 402, body: '' }).kind, 'exhausted');
  const daily = errorFor({
    status: 429,
    body: body('TooManyRequests', 'You have exceeded your free daily limit.'),
  });
  assert.equal(daily.kind, 'exhausted');
  assert.equal(
    errorFor({ status: 429, body: body('Other', 'Daily limit reached') }).kind,
    'exhausted',
  );
  assert.equal(
    errorFor({ status: 429, body: '', headers: { 'x-ratelimit-remaining': '0' } }).kind,
    'exhausted',
  );
  const busy = errorFor({ status: 429, body: '', headers: { 'retry-after': '90' } });
  assert.equal(busy.kind, 'busy');
  assert.equal(busy.retryAfter, 90_000);
  assert.equal(errorFor({ status: 503, body: 'oops' }).kind, 'unavailable');
  const bad = errorFor({ status: 400, body: body('NotEmpty', "'hours' is invalid.") });
  assert.equal(bad.kind, 'http');
  assert.equal(errorReason(bad), "request failed: 'hours' is invalid. (HTTP 400)");
});

test('helpers: Retry-After, rate limit headers, JSON, socket errors', () => {
  const now = Date.UTC(2026, 9, 16);
  assert.equal(parseRetryAfter('30'), 30_000);
  assert.equal(parseRetryAfter(new Date(now + 60_000).toUTCString(), now), 60_000);
  assert.equal(parseRetryAfter(''), undefined);
  assert.equal(parseRetryAfter('later'), undefined);
  assert.deepEqual(rateLimitOf({ 'x-ratelimit-limit': '10', 'x-ratelimit-remaining': '7' }), {
    limit: 10,
    remaining: 7,
  });
  assert.deepEqual(rateLimitOf({}), { limit: undefined, remaining: undefined });
  assert.deepEqual(parseJson('{"a":1}'), { a: 1 });
  assert.throws(() => parseJson('<html>'), { kind: 'bad_response' });
  assert.throws(() => parseJson('3'), { kind: 'bad_response' });
  assert.equal(networkError({ code: 'ENOTFOUND' }).message, 'unknown host name');
  const own = new SolcastError('busy', 'x');
  assert.equal(networkError(own), own);
  assert.equal(errorReason(new Error('plain')), 'plain');
});
