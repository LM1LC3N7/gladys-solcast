import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SCENE_TRIGGERS } from '../src/constants.js';
import { productionEvents } from '../src/events.js';
import { MINUTE } from './fixtures/solcast.js';

const START = Date.UTC(2026, 9, 16, 5);
const PEAK = Date.UTC(2026, 9, 16, 11, 15);
const END = Date.UTC(2026, 9, 16, 17);
const profile = { start: START, peakTime: PEAK, end: END, peakPower: 2400 };
const day = '2026-10-16';

test('start, peak and end fire when the clock passes them, once a day', () => {
  const fired = new Set();
  const check = (since, now) => productionEvents(profile, { since, now, day, fired });
  assert.deepEqual(check(START - 2 * MINUTE, START - MINUTE), []);
  assert.deepEqual(check(START - MINUTE, START), [
    { key: SCENE_TRIGGERS.PRODUCTION_STARTED, at: START },
  ]);
  assert.deepEqual(check(START - MINUTE, START), [], 'not twice');
  assert.deepEqual(check(PEAK - 30_000, PEAK + 30_000), [
    { key: SCENE_TRIGGERS.PRODUCTION_PEAK, at: PEAK },
  ]);
  assert.deepEqual(check(END - MINUTE, END + 10_000), [
    { key: SCENE_TRIGGERS.PRODUCTION_ENDED, at: END },
  ]);
  assert.deepEqual(
    [...fired],
    [
      `${day}:${SCENE_TRIGGERS.PRODUCTION_STARTED}`,
      `${day}:${SCENE_TRIGGERS.PRODUCTION_PEAK}`,
      `${day}:${SCENE_TRIGGERS.PRODUCTION_ENDED}`,
    ],
  );
});

test('a time seen too late, or unknown, fires nothing', () => {
  const fired = new Set();
  // Gladys was down for an hour around the peak.
  assert.deepEqual(
    productionEvents(profile, { since: PEAK - 30 * MINUTE, now: PEAK + 30 * MINUTE, day, fired }),
    [],
  );
  const unknown = { start: null, peakTime: null, end: END };
  assert.deepEqual(productionEvents(unknown, { since: 0, now: START + MINUTE, day, fired }), []);
  assert.deepEqual(productionEvents(undefined, { since: 0, now: END, day, fired }), []);
});
