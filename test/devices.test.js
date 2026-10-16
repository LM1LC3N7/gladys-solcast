import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEVICE_FEATURE_CATEGORIES,
  DEVICE_FEATURE_TYPES,
  DEVICE_FEATURE_UNITS,
} from '@gladysassistant/integration-sdk';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { readSite } from '../src/client.js';
import { buildDevices, buildStates, parseDeviceId, siteIds, totalIds } from '../src/devices.js';
import { SOUTH, WEST } from './fixtures/solcast.js';

const sites = [readSite(SOUTH), readSite(WEST)];

test('one device per site, and the total with two sites', async () => {
  const gladys = createFakeGladys();
  const devices = buildDevices(gladys, sites, 'fr');
  assert.deepEqual(
    devices.map((d) => [d.name, d.external_id]),
    [
      ['Prévision Solcast (Toit sud)', `ext:test-integration:site:${SOUTH.resource_id}`],
      ['Prévision Solcast (Toit ouest)', `ext:test-integration:site:${WEST.resource_id}`],
      ['Prévision Solcast (tous les sites)', 'ext:test-integration:total:all'],
    ],
  );
  assert.equal(buildDevices(gladys, sites.slice(0, 1), 'en').length, 1, 'no total for one site');
  // The fake Gladys refuses what Gladys refuses (category, type, unit).
  await gladys.connect();
  await gladys.publishDiscoveredDevices(devices);
  assert.equal(gladys.fake.discoveredDevices.length, 3);
});

test('the features of Forecast.Solar, with their P10 and P90', () => {
  const [south] = buildDevices(createFakeGladys(), sites, 'en');
  const id = `ext:test-integration:site:${SOUTH.resource_id}`;
  assert.deepEqual(
    south.features.map((f) => [f.external_id.replace(`${id}:`, ''), f.name]),
    [
      ['power-now', 'Estimated power now'],
      ['power-now-p10', 'Estimated power now (P10)'],
      ['power-now-p90', 'Estimated power now (P90)'],
      ['energy-today', 'Estimated energy today'],
      ['energy-today-p10', 'Estimated energy today (P10)'],
      ['energy-today-p90', 'Estimated energy today (P90)'],
      ['energy-remaining-today', 'Estimated energy remaining today'],
      ['energy-remaining-today-p10', 'Estimated energy remaining today (P10)'],
      ['energy-remaining-today-p90', 'Estimated energy remaining today (P90)'],
      ['energy-tomorrow', 'Estimated energy tomorrow'],
      ['energy-tomorrow-p10', 'Estimated energy tomorrow (P10)'],
      ['energy-tomorrow-p90', 'Estimated energy tomorrow (P90)'],
    ],
  );
  const [power, , , today] = south.features;
  assert.equal(power.category, DEVICE_FEATURE_CATEGORIES.ENERGY_PRODUCTION_SENSOR);
  assert.equal(power.type, DEVICE_FEATURE_TYPES.ENERGY_PRODUCTION_SENSOR.POWER);
  assert.equal(power.unit, DEVICE_FEATURE_UNITS.WATT);
  assert.equal(today.type, DEVICE_FEATURE_TYPES.ENERGY_PRODUCTION_SENSOR.DAILY_PRODUCTION);
  assert.equal(today.unit, DEVICE_FEATURE_UNITS.KILOWATT_HOUR);
  assert.ok(south.features.every((f) => f.read_only && !f.has_feedback && f.keep_history));
  // Never an index nor a thirty-minutes production: the energy monitoring reads those.
  assert.ok(
    south.features.every(
      (f) =>
        f.type !== DEVICE_FEATURE_TYPES.ENERGY_PRODUCTION_SENSOR.INDEX &&
        f.type !== DEVICE_FEATURE_TYPES.ENERGY_PRODUCTION_SENSOR.THIRTY_MINUTES_PRODUCTION,
    ),
  );
  assert.deepEqual(south.params, [
    { name: 'resource_id', value: SOUTH.resource_id },
    { name: 'capacity_kw', value: '3' },
    { name: 'capacity_dc_kw', value: '3.6' },
    { name: 'azimuth', value: '180' },
    { name: 'tilt', value: '30' },
    { name: 'install_date', value: '2024-05-01' },
  ]);
});

test('states: the known values only, ids parsed back', () => {
  const gladys = createFakeGladys();
  const ids = siteIds(gladys, SOUTH.resource_id);
  const states = buildStates(ids, {
    power: { p50: 1200, p10: 700, p90: 1500 },
    today: null,
    remaining: { p50: 3.2, p10: 2, p90: 4 },
    tomorrow: null,
  });
  assert.deepEqual(
    states.map((s) => [s.device_feature_external_id.split(':').at(-1), s.state]),
    [
      ['power-now', 1200],
      ['power-now-p10', 700],
      ['power-now-p90', 1500],
      ['energy-remaining-today', 3.2],
      ['energy-remaining-today-p10', 2],
      ['energy-remaining-today-p90', 4],
    ],
  );
  assert.deepEqual(parseDeviceId(ids.device), { kind: 'site', id: SOUTH.resource_id });
  assert.deepEqual(parseDeviceId(totalIds(gladys).device), { kind: 'total', id: 'all' });
  assert.equal(parseDeviceId('ext:x:pet:1'), undefined);
});
