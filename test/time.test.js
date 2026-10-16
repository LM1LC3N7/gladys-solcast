import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  dayAndTime,
  dayKey,
  dayOf,
  hhmm,
  nextDayOf,
  resolveTimeZone,
  utcDayEnd,
  utcDayKey,
  utcDayStart,
} from '../src/time.js';
import { HOUR, NOW } from './fixtures/solcast.js';

test('the TZ of Gladys is used when valid, UTC otherwise', () => {
  assert.equal(resolveTimeZone('Europe/Paris'), 'Europe/Paris');
  assert.equal(resolveTimeZone(' Australia/Sydney '), 'Australia/Sydney');
  assert.equal(resolveTimeZone('Mars/Olympus'), 'UTC');
  assert.equal(resolveTimeZone(''), 'UTC');
  assert.equal(resolveTimeZone(undefined), 'UTC');
});

test('local days, hours and the UTC day of the daily limit', () => {
  assert.equal(dayKey(NOW, 'Europe/Paris'), '2026-10-16');
  assert.deepEqual(dayOf(NOW, 'Europe/Paris'), {
    key: '2026-10-16',
    start: Date.UTC(2026, 9, 15, 22),
    end: Date.UTC(2026, 9, 16, 22),
  });
  assert.equal(nextDayOf(NOW, 'Europe/Paris').key, '2026-10-17');
  assert.equal(hhmm(NOW, 'Europe/Paris'), '06:00');
  assert.equal(dayAndTime(NOW, 'Europe/Paris'), '16/10 06:00');
  // 04:00 UTC is already the afternoon in Sydney.
  assert.equal(hhmm(NOW, 'Australia/Sydney'), '15:00');
  assert.equal(utcDayKey(NOW), '2026-10-16');
  assert.equal(utcDayStart(NOW), Date.UTC(2026, 9, 16));
  assert.equal(utcDayEnd(NOW), Date.UTC(2026, 9, 17));
});

test('the days of the clock changes last 25 and 23 hours', () => {
  const autumn = dayOf(Date.UTC(2026, 9, 25, 12), 'Europe/Paris');
  assert.equal(autumn.end - autumn.start, 25 * HOUR);
  assert.equal(autumn.start, Date.UTC(2026, 9, 24, 22));
  const spring = dayOf(Date.UTC(2026, 2, 29, 12), 'Europe/Paris');
  assert.equal(spring.end - spring.start, 23 * HOUR);
  const utc = dayOf(NOW, 'UTC');
  assert.equal(utc.end - utc.start, 24 * HOUR);
});
