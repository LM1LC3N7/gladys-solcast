// -----------------------------------------------------------------------------
// End to end: the real SDK wiring (src/handlers.js) against the SDK's fake
// Gladys and a fake Solcast behind the transport. Timers and Date are mocked:
// the tests move the clock minute by minute, like the app sees it.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEVICE_TRANSPORTS, createLogger } from '@gladysassistant/integration-sdk';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { SolcastApp } from '../src/app.js';
import { accountKey } from '../src/config.js';
import { ACTIONS, SCENE_TRIGGERS } from '../src/constants.js';
import { registerHandlers } from '../src/handlers.js';
import {
  API_KEY,
  DAY,
  HOUR,
  MINUTE,
  NOW,
  PARIS_DAYS,
  SOUTH,
  TZ,
  WEST,
  expectedEnergy,
  pvValue,
} from './fixtures/solcast.js';
import { fakeSolcast, memoryStore, settle } from './helpers/fakeSolcast.js';

const CONFIG = { api_key: API_KEY };
const OFFSET = 5 * MINUTE;
const site = (s) => `ext:test-integration:site:${s.resource_id}`;
const TOTAL = 'ext:test-integration:total:all';
const TODAY = PARIS_DAYS['2026-10-16'];
const TOMORROW = PARIS_DAYS['2026-10-17'];

async function setup(
  t,
  { config = CONFIG, store = memoryStore(), server = fakeSolcast(), now = NOW, devices = [] } = {},
) {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now });
  const gladys = createFakeGladys({ config, devices });
  const app = new SolcastApp({
    gladys,
    logger: createLogger({ level: 'silent' }),
    transport: server.transport,
    now: () => Date.now(),
    store,
    timeZone: TZ,
    random: () => OFFSET,
    userAgent: 'gladys-solcast/test',
  });
  registerHandlers(gladys, app);
  await gladys.connect();
  await settle();
  t.after(() => app.stop());
  const advance = async (ms, step = MINUTE) => {
    for (let elapsed = 0; elapsed < ms; elapsed += step) {
      t.mock.timers.tick(step);
      await settle();
    }
  };
  return { gladys, app, server, store, advance };
}

const deviceOf = (gladys, id) => gladys.fake.discoveredDevices.find((d) => d.external_id === id);
const create = async (gladys, ...ids) => {
  for (const id of ids) {
    await gladys.fake.deviceCreated(deviceOf(gladys, id));
  }
  await settle();
};
const last = (gladys, id, key) => gladys.fake.lastState(`${id}:${key}`);
const statesOf = (gladys, id, key) =>
  gladys.fake.states.filter((s) => s.device_feature_external_id === `${id}:${key}`);
const status = (gladys) => gladys.fake.connectionStatus;
const badgeOf = (gladys, id) =>
  gladys.fake.transports.filter((b) => b.device_external_id === id).at(-1);
const eventsOf = (gladys, key) => gladys.fake.sceneEvents.filter((e) => e.key === key);
const round2 = (value) => Math.round(value * 100) / 100;
const close = (actual, expected, epsilon = 0.011) =>
  assert.ok(Math.abs(actual - expected) <= epsilon, `${actual} is not ${expected}`);

test('without a key, the status asks for it and nothing is requested', async (t) => {
  const { gladys, server } = await setup(t, { config: {} });
  assert.equal(server.requests.length, 0);
  assert.equal(status(gladys).connected, false);
  assert.match(status(gladys).message.en, /API key of your Solcast account/);
  const ack = await gladys.fake.action(ACTIONS.REFRESH_FORECAST);
  assert.match(ack.data.message.fr, /clé d'API/);
});

test('the sites are read for free and offered in Discovery; no download before a device', async (t) => {
  const { gladys, server, store, advance } = await setup(t);
  assert.equal(server.listings().length, 1);
  assert.equal(server.forecasts().length, 0);
  assert.deepEqual(
    gladys.fake.discoveredDevices.map((d) => d.external_id),
    [site(SOUTH), site(WEST), TOTAL],
  );
  assert.equal(status(gladys).connected, true);
  assert.equal(
    status(gladys).message.en,
    'Connected to Solcast: 2 sites. Add them from Discovery: only the added sites use calls.',
  );
  assert.equal(store.data.account, accountKey(API_KEY));
  assert.equal(store.data.sites.list.length, 2);
  await advance(6 * HOUR, 5 * MINUTE);
  assert.equal(server.forecasts().length, 0, 'nothing downloaded without a device');
  assert.equal(server.listings().length, 1, 'the sites are read once a day');
});

test('adding a site downloads its forecast once, then publishes its values', async (t) => {
  const server = fakeSolcast();
  let usedAtRequest;
  const store = memoryStore();
  server.onRequest = (request) => {
    if (request.path.endsWith('/forecasts')) {
      usedAtRequest = store.data.usage.used;
    }
  };
  const { gladys } = await setup(t, { server, store });
  await create(gladys, site(SOUTH));
  assert.equal(server.forecasts().length, 1);
  assert.equal(usedAtRequest, 1, 'the call is counted in /data before the request');
  assert.deepEqual(store.data.usage, { day: '2026-10-16', used: 1, exhausted: false });

  const id = site(SOUTH);
  assert.equal(last(gladys, id, 'power-now'), 0, 'before sunrise');
  close(last(gladys, id, 'energy-today'), expectedEnergy(SOUTH, NOW, TODAY.end));
  close(last(gladys, id, 'energy-today-p10'), expectedEnergy(SOUTH, NOW, TODAY.end, 'p10'));
  close(last(gladys, id, 'energy-today-p90'), expectedEnergy(SOUTH, NOW, TODAY.end, 'p90'));
  close(last(gladys, id, 'energy-remaining-today'), expectedEnergy(SOUTH, NOW, TODAY.end));
  close(last(gladys, id, 'energy-tomorrow'), expectedEnergy(SOUTH, TOMORROW.start, TOMORROW.end));

  const [updated] = eventsOf(gladys, SCENE_TRIGGERS.FORECAST_UPDATED);
  assert.equal(updated.data.device, id);
  assert.equal(updated.data.site, 'Toit sud');
  assert.equal(updated.data.energy_today, round2(expectedEnergy(SOUTH, NOW, TODAY.end)));
  assert.equal(updated.data.peak_time, '13:15');
  assert.equal(updated.data.calls_left, 9);

  assert.equal(
    status(gladys).message.en,
    'Forecast of 06:00 for 1 site. Next update around 08:17; 9 of 10 calls left today.',
  );
  assert.equal(
    status(gladys).message.fr,
    "Prévision de 06:00 pour 1 site. Prochaine mise à jour vers 08:17 ; 9 appels sur 10 restants aujourd'hui.",
  );
  assert.equal(badgeOf(gladys, id).transport, DEVICE_TRANSPORTS.CLOUD);
});

test('the power follows the curve every 5 minutes; an unchanged value is not sent again', async (t) => {
  const { gladys, advance } = await setup(t);
  await create(gladys, site(SOUTH));
  const id = site(SOUTH);
  await advance(Date.UTC(2026, 9, 16, 10) - NOW);
  const morning = statesOf(gladys, id, 'power-now').length;
  await advance(HOUR);
  const sent = statesOf(gladys, id, 'power-now').length - morning;
  assert.ok(sent >= 10 && sent <= 13, `${sent} power states in an hour of daylight`);
  const power = last(gladys, id, 'power-now');
  assert.ok(Math.abs(power - pvValue(SOUTH, Date.UTC(2026, 9, 16, 11, 30)) * 1000) < 150);
  // The night: 0 W once, then the 30-minute heartbeat only.
  await advance(Date.UTC(2026, 9, 16, 19) - Date.now());
  const night = statesOf(gladys, id, 'power-now').length;
  await advance(2 * HOUR);
  assert.ok(statesOf(gladys, id, 'power-now').length - night <= 4);
  assert.equal(last(gladys, id, 'power-now'), 0);
});

test('two sites and their total: 5 downloads of each a day, never more than 10 calls', async (t) => {
  const { gladys, server, store, advance } = await setup(t);
  await create(gladys, site(SOUTH), site(WEST), TOTAL);
  assert.equal(server.forecasts().length, 2);
  await advance(DAY);
  const times = (s) =>
    server.forecasts(s.resource_id).map((r) => new Date(r.at).toISOString().slice(11, 16));
  assert.deepEqual(times(SOUTH), ['04:00', '07:33', '10:03', '12:27', '14:49']);
  assert.deepEqual(times(WEST), times(SOUTH));
  assert.equal(server.used, 10);
  assert.deepEqual(store.data.usage, { day: '2026-10-16', used: 10, exhausted: false });
  assert.match(status(gladys).message.en, / 10 of 10 calls left today/, 'a new UTC day');
  // The total is the sum of the sites.
  for (const key of ['energy-today', 'energy-tomorrow', 'power-now']) {
    close(
      last(gladys, TOTAL, key),
      last(gladys, site(SOUTH), key) + last(gladys, site(WEST), key),
      key === 'power-now' ? 1 : 0.011,
    );
  }
  const updates = eventsOf(gladys, SCENE_TRIGGERS.FORECAST_UPDATED).filter(
    (e) => e.data.device === TOTAL,
  );
  // The first downloads came before the total was created.
  assert.equal(updates.length, 4, 'one event per download of the total');
  assert.equal(updates[0].data.site, 'Toit sud + Toit ouest');
});

test('a restart spends no call: the counter and the forecast come back from /data', async (t) => {
  const server = fakeSolcast();
  const store = memoryStore();
  const first = await setup(t, { server, store });
  await create(first.gladys, site(SOUTH));
  await first.advance(2.5 * HOUR);
  const calls = server.forecasts().length;
  const devices = first.gladys.fake.devices;
  first.app.stop();
  const at = Date.now();
  t.mock.timers.reset();

  const { gladys, advance } = await setup(t, { server, store, now: at, devices });
  assert.equal(server.forecasts().length, calls, 'no download at start');
  close(last(gladys, site(SOUTH), 'energy-today'), expectedEnergy(SOUTH, NOW, TODAY.end));
  assert.ok(last(gladys, site(SOUTH), 'power-now') > 0);
  assert.match(status(gladys).message.en, / 8 of 10 calls left today/);
  await advance(50 * MINUTE);
  assert.equal(server.forecasts().length, calls, 'the plan goes on');
});

test('the daily limit spent elsewhere: no call until midnight UTC, and the status says so', async (t) => {
  const server = fakeSolcast();
  server.day = '2026-10-16';
  server.used = 10;
  const { gladys, store, advance } = await setup(t, { server });
  await create(gladys, site(SOUTH));
  assert.equal(server.forecasts().length, 1);
  assert.deepEqual(store.data.usage, { day: '2026-10-16', used: 0, exhausted: true });
  assert.equal(
    status(gladys).message.en,
    'No Solcast call left today (daily limit reached): next forecast after 02:00 (midnight UTC). The values follow the last forecast.',
  );
  const ack = await gladys.fake.action(ACTIONS.REFRESH_FORECAST);
  assert.match(ack.data.message.en, /^No Solcast call left today \(10 a day\)/);
  await advance(Date.UTC(2026, 9, 17) - Date.now() - MINUTE);
  assert.equal(server.forecasts().length, 1);
  await advance(2 * MINUTE);
  assert.equal(server.forecasts().length, 2, 'downloaded after midnight UTC');
  assert.ok(last(gladys, site(SOUTH), 'energy-today') > 0);
});

test('Solcast busy: no call counted, a new try 5 minutes later', async (t) => {
  const server = fakeSolcast();
  server.busy = 1;
  const { gladys, store, advance } = await setup(t, { server });
  await create(gladys, site(SOUTH));
  assert.equal(store.data.usage.used, 0);
  assert.equal(
    status(gladys).message.en,
    'Solcast is busy (HTTP 429, no call used): next try around 06:05.',
  );
  await advance(4 * MINUTE);
  assert.equal(server.forecasts().length, 1);
  await advance(MINUTE);
  assert.equal(server.forecasts().length, 2);
  assert.equal(store.data.usage.used, 1);
  assert.match(status(gladys).message.en, /^Forecast of 06:05 for 1 site/);
});

test('Solcast unreachable: the values follow the stored forecast, the badge says since when', async (t) => {
  const { gladys, server, advance } = await setup(t);
  await create(gladys, site(SOUTH));
  server.down = true;
  await advance(27 * HOUR, 5 * MINUTE);
  const tries = server.forecasts().length;
  assert.ok(tries > 5 && tries < 40, `${tries} tries in 27 hours`);
  assert.equal(status(gladys).connected, false);
  assert.match(status(gladys).message.en, /^Solcast cannot be reached \(connection refused\)/);
  assert.deepEqual(badgeOf(gladys, site(SOUTH)), {
    device_external_id: site(SOUTH),
    transport: DEVICE_TRANSPORTS.CLOUD,
    degraded: true,
    message: {
      en: 'Forecast of 16/10 06:00: Solcast could not be read since.',
      fr: "Prévision du 16/10 06:00 : Solcast n'a pas pu être lu depuis.",
    },
  });
  // The 17th is known from the forecast of the 16th.
  close(
    last(gladys, site(SOUTH), 'energy-today'),
    expectedEnergy(SOUTH, TOMORROW.start, TOMORROW.end),
  );
  server.down = false;
  await advance(HOUR, 5 * MINUTE);
  assert.equal(status(gladys).connected, true);
  assert.equal(badgeOf(gladys, site(SOUTH)).degraded, undefined);
});

test('the refresh button: within the calls left, never twice in 10 minutes', async (t) => {
  const { gladys, server, advance } = await setup(t, { config: { ...CONFIG, daily_limit: 2 } });
  const nothing = await gladys.fake.action(ACTIONS.REFRESH_FORECAST);
  assert.match(nothing.data.message.en, /^Add a site from Discovery first/);
  assert.equal(server.forecasts().length, 0);

  await create(gladys, site(SOUTH));
  const soon = await gladys.fake.action(ACTIONS.REFRESH_FORECAST);
  assert.equal(
    soon.data.message.en,
    'Already downloaded 1 min ago: no call used. 1 of 2 calls left today.',
  );
  assert.equal(server.forecasts().length, 1);

  await advance(10 * MINUTE);
  const done = await gladys.fake.action(ACTIONS.REFRESH_FORECAST);
  assert.equal(server.forecasts().length, 2);
  assert.match(
    done.data.message.en,
    /^Forecast downloaded for 1 site \(1 call\)\. Today \d+\.\d kWh \(P10 \d+\.\d, P90 \d+\.\d\), tomorrow \d+\.\d kWh \(P10 \d+\.\d, P90 \d+\.\d\)\. 0 of 2 calls left today; next automatic update around 07:05\.$/,
  );
  assert.match(
    done.data.message.fr,
    /^Prévision téléchargée pour 1 site \(1 appel\)\. Aujourd'hui \d+,\d kWh .* 0 appel sur 2 restant aujourd'hui ; prochaine mise à jour automatique vers 07:05\.$/,
  );

  await advance(10 * MINUTE);
  const none = await gladys.fake.action(ACTIONS.REFRESH_FORECAST);
  assert.equal(
    none.data.message.en,
    'No Solcast call left today (2 a day): the limit resets after 02:00 (midnight UTC).',
  );
  assert.equal(server.forecasts().length, 2, 'no request without calls');
  await advance(4 * HOUR, 5 * MINUTE);
  assert.equal(server.forecasts().length, 2, 'nor from the plan');
});

test('the test button reads the sites for free and tells the calls left', async (t) => {
  const { gladys, server } = await setup(t);
  const ack = await gladys.fake.action(ACTIONS.TEST_CONNECTION);
  assert.equal(ack.success, true);
  assert.equal(
    ack.data.message.en,
    'Key accepted: Toit sud (3.0 kW), Toit ouest (2.0 kW). 10 of 10 calls left today, next update once a site is added.',
  );
  assert.equal(
    ack.data.message.fr,
    "Clé acceptée : Toit sud (3,0 kW), Toit ouest (2,0 kW). 10 appels sur 10 restants aujourd'hui, prochaine mise à jour dès qu'un site sera ajouté.",
  );
  assert.equal(server.listings().length, 2);
  const again = await gladys.fake.action(ACTIONS.TEST_CONNECTION);
  assert.match(again.data.message.en, /^Already read less than 30 seconds ago\. Key accepted/);
  assert.equal(server.listings().length, 2);
  assert.equal(server.forecasts().length, 0);
});

test('a refused key stops everything until the configuration changes', async (t) => {
  const { gladys, server, advance } = await setup(t, { config: { api_key: 'wrong' } });
  assert.equal(status(gladys).connected, false);
  assert.match(status(gladys).message.en, /refused the API key/);
  assert.equal(gladys.fake.discoveredDevices.length, 0);
  await advance(2 * HOUR, 5 * MINUTE);
  assert.equal(server.requests.length, 1, 'never retried by itself');
  const ack = await gladys.fake.action(ACTIONS.TEST_CONNECTION);
  assert.match(ack.data.message.en, /refused the API key/);
  assert.equal(server.requests.length, 2, 'the button tries once');
  await gladys.fake.configUpdated(CONFIG);
  await settle();
  assert.equal(status(gladys).connected, true);
  assert.equal(gladys.fake.discoveredDevices.length, 3);
});

test('production events: start, peak and end of the day, with the forecast as variables', async (t) => {
  const { gladys, advance } = await setup(t);
  await create(gladys, site(SOUTH));
  await advance(Date.UTC(2026, 9, 16, 22) - NOW);
  const [started] = eventsOf(gladys, SCENE_TRIGGERS.PRODUCTION_STARTED);
  const peaks = eventsOf(gladys, SCENE_TRIGGERS.PRODUCTION_PEAK);
  const ended = eventsOf(gladys, SCENE_TRIGGERS.PRODUCTION_ENDED);
  assert.equal(peaks.length, 1);
  assert.equal(ended.length, 1);
  assert.equal(started.data.device, site(SOUTH));
  assert.equal(started.data.peak_time, '13:15');
  const [peak] = peaks;
  assert.equal(peak.data.power_now, peak.data.peak_power, 'fired at the middle of the peak period');
  assert.equal(
    peak.data.peak_power,
    Math.round(pvValue(SOUTH, Date.UTC(2026, 9, 16, 11, 30)) * 1000),
  );
  assert.equal(ended.at(0).data.energy_remaining_today, 0);
  const order = gladys.fake.sceneEvents
    .map((e) => e.key)
    .filter((key) => key !== SCENE_TRIGGERS.FORECAST_UPDATED);
  assert.deepEqual(order, [
    SCENE_TRIGGERS.PRODUCTION_STARTED,
    SCENE_TRIGGERS.PRODUCTION_PEAK,
    SCENE_TRIGGERS.PRODUCTION_ENDED,
  ]);
});

test('a site added at noon: energy today stays unknown until tomorrow', async (t) => {
  const noon = Date.UTC(2026, 9, 16, 10, 10);
  const { gladys, advance } = await setup(t, { now: noon });
  await create(gladys, site(SOUTH));
  const id = site(SOUTH);
  assert.equal(last(gladys, id, 'energy-today'), undefined);
  assert.ok(last(gladys, id, 'energy-remaining-today') > 0);
  assert.ok(last(gladys, id, 'energy-tomorrow') > 0);
  assert.ok(last(gladys, id, 'power-now') > 1000);
  await advance(TODAY.end - noon + 10 * MINUTE, 5 * MINUTE);
  close(last(gladys, id, 'energy-today'), expectedEnergy(SOUTH, TOMORROW.start, TOMORROW.end));
});

test('after Gladys restarts, the status, devices and badges come back without a Solcast call', async (t) => {
  const { gladys, server } = await setup(t);
  await create(gladys, site(SOUTH));
  const requests = server.requests.length;
  const statuses = gladys.fake.connectionStatuses.length;
  await gladys.disconnect();
  await gladys.connect();
  await settle();
  assert.equal(server.requests.length, requests);
  assert.equal(gladys.fake.connectionStatuses.length, statuses + 1);
  assert.equal(badgeOf(gladys, site(SOUTH)).transport, DEVICE_TRANSPORTS.CLOUD);
});

test('the resource ids of the configuration choose the sites; unknown ones are told', async (t) => {
  const { gladys } = await setup(t, { config: { ...CONFIG, sites: SOUTH.resource_id } });
  assert.deepEqual(
    gladys.fake.discoveredDevices.map((d) => d.external_id),
    [site(SOUTH)],
  );
  await gladys.fake.configUpdated({ ...CONFIG, sites: 'zzzz-0000' });
  await settle();
  assert.equal(status(gladys).connected, false);
  assert.match(
    status(gladys).message.en,
    /No rooftop site of this key has the resource ids .*zzzz-0000/,
  );
});

test('a site deleted at Solcast: no call used, the status says it', async (t) => {
  const { gladys, server, store } = await setup(t);
  server.sites = [WEST];
  await create(gladys, site(SOUTH));
  assert.equal(server.forecasts().length, 1);
  assert.equal(store.data.usage.used, 0);
  assert.match(status(gladys).message.en, /no longer knows the site Toit sud/);
});

test('the X-RateLimit headers, when Solcast sends them, correct the counter', async (t) => {
  const server = fakeSolcast();
  server.forecastHeaders = { 'x-ratelimit-limit': '10', 'x-ratelimit-remaining': '5' };
  const { gladys, store } = await setup(t, { server });
  await create(gladys, site(SOUTH));
  assert.equal(store.data.usage.used, 5);
  assert.match(status(gladys).message.en, / 5 of 10 calls left today/);
});
