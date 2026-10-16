import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULTS, accountKey, normalizeConfig, parseSiteIds } from '../src/config.js';
import { normalizeMemory } from '../src/store.js';

test('the configuration, normalized', () => {
  assert.deepEqual(normalizeConfig(), {
    apiKey: '',
    account: '',
    siteIds: [],
    dailyLimit: DEFAULTS.daily_limit,
    language: 'fr',
  });
  const config = normalizeConfig({
    api_key: ' key-1 ',
    sites: 'a-1, b-2\nb-2',
    daily_limit: '50',
    language: 'EN',
  });
  assert.equal(config.apiKey, 'key-1');
  assert.equal(config.account, accountKey('key-1'));
  assert.notEqual(config.account, 'key-1', 'the key itself is never stored');
  assert.deepEqual(config.siteIds, ['a-1', 'b-2']);
  assert.equal(config.dailyLimit, 50);
  assert.equal(config.language, 'en');
  assert.equal(normalizeConfig({ daily_limit: 0 }).dailyLimit, 1);
  assert.equal(normalizeConfig({ daily_limit: 500 }).dailyLimit, 50);
  assert.equal(normalizeConfig({ daily_limit: '' }).dailyLimit, 10);
  assert.equal(normalizeConfig({ daily_limit: 'ten' }).dailyLimit, 10);
  assert.equal(normalizeConfig({ language: 'de' }).language, 'fr');
  assert.deepEqual(parseSiteIds(' ; '), []);
});

test('the stored state, repaired', () => {
  assert.deepEqual(normalizeMemory(null), {
    account: null,
    offset: null,
    usage: null,
    forecasts: {},
    attempt: null,
    sites: null,
  });
  const period = { end: 1, length: 1800000, p50: 1, p10: 0.5, p90: 1.2 };
  const memory = normalizeMemory({
    account: 'abc',
    offset: 120000,
    usage: { day: '2026-10-16', used: 3 },
    forecasts: { a: { fetchedAt: 5, periods: [period, { end: 'x' }] }, b: { fetchedAt: 5 } },
    attempt: { retryAt: 9, failures: 2 },
    sites: { at: 7, list: [{ id: 'a', name: 'Toit' }, { name: 'no id' }] },
  });
  assert.deepEqual(memory.forecasts, { a: { fetchedAt: 5, periods: [period] } });
  assert.deepEqual(memory.attempt, { retryAt: 9, failures: 2 });
  assert.deepEqual(memory.sites, { at: 7, list: [{ id: 'a', name: 'Toit' }] });
  assert.equal(memory.offset, 120000);
});
