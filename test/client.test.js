import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SolcastClient, readSite } from '../src/client.js';
import { API_KEY, NOW, SOUTH, WEST } from './fixtures/solcast.js';
import { fakeSolcast } from './helpers/fakeSolcast.js';

function client(server) {
  const solcast = new SolcastClient({
    transport: server.transport,
    userAgent: 'gladys-solcast/test',
    now: () => NOW,
  });
  solcast.configure({ apiKey: ` ${API_KEY} ` });
  return solcast;
}

test('the sites of the key: the key in the header only, never in the URL', async () => {
  const server = fakeSolcast();
  const sites = await client(server).sites();
  assert.deepEqual(sites, [
    {
      id: SOUTH.resource_id,
      name: 'Toit sud',
      capacity: 3,
      capacityDc: 3.6,
      azimuth: 180,
      tilt: 30,
      installDate: '2024-05-01',
    },
    {
      id: WEST.resource_id,
      name: 'Toit ouest',
      capacity: 2,
      capacityDc: 2.4,
      azimuth: 90,
      tilt: 30,
      installDate: '2024-05-01',
    },
  ]);
  const [request] = server.requests;
  assert.equal(request.path, '/rooftop_sites');
  assert.deepEqual(request.query, { format: 'json' });
  assert.deepEqual(request.headers, {
    Authorization: `Bearer ${API_KEY}`,
    Accept: 'application/json',
    'User-Agent': 'gladys-solcast/test',
  });
  assert.equal(server.used, 0, 'listing the sites uses no call');
});

test('the forecast of a site: 72 hours, the rate limit headers when sent', async () => {
  const server = fakeSolcast();
  server.forecastHeaders = { 'x-ratelimit-limit': '10', 'x-ratelimit-remaining': '9' };
  const { periods, rateLimit } = await client(server).forecasts(SOUTH.resource_id);
  assert.equal(periods.length, 145);
  assert.deepEqual(rateLimit, { limit: 10, remaining: 9 });
  const [request] = server.forecasts();
  assert.equal(request.path, `/rooftop_sites/${SOUTH.resource_id}/forecasts`);
  assert.deepEqual(request.query, { format: 'json', hours: '72' });
  assert.equal(server.used, 1);
});

test('errors: no key, a refused key, an unknown site, an answer that is not JSON', async () => {
  const server = fakeSolcast();
  const none = new SolcastClient({ transport: server.transport });
  await assert.rejects(none.sites(), { kind: 'no_key' });
  assert.equal(server.requests.length, 0);

  const wrong = new SolcastClient({ transport: server.transport });
  wrong.configure({ apiKey: 'nope' });
  await assert.rejects(wrong.sites(), { kind: 'refused', status: 403 });
  await assert.rejects(client(server).forecasts('zzzz'), { kind: 'not_found' });

  const html = new SolcastClient({
    transport: async () => ({ status: 200, headers: {}, body: '<html>maintenance</html>' }),
  });
  html.configure({ apiKey: API_KEY });
  await assert.rejects(html.sites(), { kind: 'bad_response' });
  const empty = new SolcastClient({
    transport: async () => ({ status: 200, headers: {}, body: '{}' }),
  });
  empty.configure({ apiKey: API_KEY });
  await assert.rejects(empty.sites(), { kind: 'bad_response' });
  await assert.rejects(empty.forecasts('x'), { kind: 'bad_response' });
});

test('a site without resource id is skipped, missing fields stay undefined', () => {
  assert.equal(readSite({ name: 'x' }), undefined);
  assert.deepEqual(readSite({ resource_id: ' r1 ', capacity: '' }), {
    id: 'r1',
    name: 'r1',
    capacity: undefined,
    capacityDc: undefined,
    azimuth: undefined,
    tilt: undefined,
    installDate: undefined,
  });
});
