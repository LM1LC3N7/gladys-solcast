import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  backoffAfter,
  callsLeft,
  currentUsage,
  limitOf,
  offQuarter,
  planNext,
  productionIntervals,
} from '../src/budget.js';
import { TIMINGS } from '../src/constants.js';
import { mergePeriods, parsePeriods } from '../src/forecast.js';
import { DAY, HOUR, MINUTE, NOW, SOUTH, WEST, forecastAnswer } from './fixtures/solcast.js';

const OFFSET = 5 * MINUTE;
const periodsAt = (site, at) => parsePeriods(forecastAnswer(site, at, 72).forecasts);

test('the usage counter belongs to the UTC day, and is repaired', () => {
  const usage = { day: '2026-10-16', used: 4, exhausted: false };
  assert.deepEqual(currentUsage(usage, NOW), {
    day: '2026-10-16',
    used: 4,
    exhausted: false,
  });
  // 01:59 in Paris on the 17th is still the 16th in UTC… then the counter resets.
  assert.equal(currentUsage(usage, Date.UTC(2026, 9, 16, 23, 59)).used, 4);
  assert.equal(currentUsage(usage, Date.UTC(2026, 9, 17, 0, 0)).used, 0);
  assert.deepEqual(currentUsage({ day: '2026-10-16', used: -3, limit: 'x' }, NOW), {
    day: '2026-10-16',
    used: 0,
    exhausted: false,
  });
  assert.equal(currentUsage(null, NOW).used, 0);
});

test('the calls left: the configured limit, or the one Solcast sent if lower', () => {
  const day = '2026-10-16';
  assert.equal(callsLeft({ day, used: 3, exhausted: false }, 10), 7);
  assert.equal(callsLeft({ day, used: 3, exhausted: true }, 10), 0);
  assert.equal(callsLeft({ day, used: 12, exhausted: false }, 10), 0);
  assert.equal(callsLeft({ day, used: 3, exhausted: false, limit: 5 }, 10), 2);
  assert.equal(limitOf({ day, used: 0, limit: 50 }, 10), 10);
});

test('the production hours of the sites, merged and clipped', () => {
  const south = periodsAt(SOUTH, NOW);
  const west = periodsAt(WEST, NOW);
  assert.deepEqual(productionIntervals([south, west], NOW, Date.UTC(2026, 9, 17)), [
    [Date.UTC(2026, 9, 16, 5), Date.UTC(2026, 9, 16, 17)],
  ]);
  assert.deepEqual(
    productionIntervals([south], Date.UTC(2026, 9, 16, 12, 10), Date.UTC(2026, 9, 16, 13)),
    [[Date.UTC(2026, 9, 16, 12, 10), Date.UTC(2026, 9, 16, 13)]],
  );
  assert.deepEqual(productionIntervals([], NOW, NOW + DAY), []);
});

test('nothing to download without a device, nor without calls', () => {
  assert.deepEqual(planNext({ now: NOW, sites: [], forecasts: {}, left: 10 }), {
    at: Infinity,
    reason: 'no_device',
  });
  assert.deepEqual(
    planNext({ now: NOW, sites: ['a', 'b'], forecasts: {}, left: 1, offset: OFFSET }),
    { at: Date.UTC(2026, 9, 17) + OFFSET, reason: 'budget' },
  );
});

test('a site never downloaded is downloaded now, a failure waits', () => {
  assert.deepEqual(planNext({ now: NOW, sites: ['a'], forecasts: {}, left: 10 }), {
    at: NOW,
    reason: 'missing',
  });
  const retryAt = NOW + backoffAfter(1);
  assert.equal(
    planNext({ now: NOW, sites: ['a'], forecasts: {}, left: 10, attempt: { retryAt } }).at,
    retryAt,
  );
  assert.deepEqual(
    TIMINGS.backoff.map((_, i) => backoffAfter(i + 1) / MINUTE),
    [5, 10, 20, 40, 60],
  );
  assert.equal(backoffAfter(9), 60 * MINUTE);
  // A forecast ending within a day is downloaded again too.
  const old = { fetchedAt: NOW - 3 * DAY, periods: periodsAt(SOUTH, NOW - 3 * DAY) };
  assert.equal(
    planNext({ now: NOW, sites: ['a'], forecasts: { a: old }, left: 10 }).reason,
    'missing',
  );
});

/**
 * Plays the plan minute by minute from `from` to `to`, like the app: a due
 * download fetches every site (one call each) and stores the forecast.
 */
function simulate({ sites, from, to, limit = 10, forecasts = {}, onMinute }) {
  const downloads = [];
  let usage = { day: undefined, used: 0, exhausted: false };
  for (let now = from; now < to; now += MINUTE) {
    usage = currentUsage(usage, now);
    onMinute?.(now, { usage, forecasts, downloads });
    const left = callsLeft(usage, limit);
    const plan = planNext({
      now,
      sites: sites.map((s) => s.resource_id),
      forecasts,
      left,
      offset: OFFSET,
    });
    if (now >= plan.at) {
      for (const site of sites) {
        if (callsLeft(usage, limit) > 0) {
          const stored = forecasts[site.resource_id]?.periods ?? [];
          forecasts[site.resource_id] = {
            fetchedAt: now,
            periods: mergePeriods(stored, periodsAt(site, now)),
          };
          usage = { ...usage, used: usage.used + 1 };
        }
      }
      downloads.push(now);
    }
  }
  return downloads;
}

const yesterdayEvening = (sites) =>
  Object.fromEntries(
    sites.map((s) => [
      s.resource_id,
      { fetchedAt: Date.UTC(2026, 9, 15, 15), periods: periodsAt(s, Date.UTC(2026, 9, 15, 15)) },
    ]),
  );

test('two sites, 10 calls: 5 downloads of both over the daylight, none at night', () => {
  const sites = [SOUTH, WEST];
  const downloads = simulate({
    sites,
    from: Date.UTC(2026, 9, 16, 0, 0),
    to: Date.UTC(2026, 9, 18, 0, 0),
    forecasts: yesterdayEvening(sites),
  });
  const day1 = downloads.filter((t) => t < Date.UTC(2026, 9, 17));
  const day2 = downloads.filter((t) => t >= Date.UTC(2026, 9, 17));
  for (const day of [day1, day2]) {
    assert.equal(day.length, 5, day.map((t) => new Date(t).toISOString()).join(' '));
    const sunrise = Math.floor(day[0] / DAY) * DAY + 5 * HOUR;
    assert.equal(day[0], sunrise + OFFSET, 'the first one when production starts');
    assert.ok(day.at(-1) < sunrise + 12 * HOUR - HOUR, 'the last one well before sunset');
    for (let i = 1; i < day.length; i += 1) {
      const gap = day[i] - day[i - 1];
      assert.ok(gap > 2 * HOUR && gap < 2.6 * HOUR, `evenly spread: ${gap / MINUTE} min`);
    }
    for (const at of day) {
      const into = (at % (15 * MINUTE)) / MINUTE;
      assert.ok(
        into >= 2 && into <= 13,
        `away from the quarter hours: ${new Date(at).toISOString()}`,
      );
    }
  }
});

test('one site, 10 calls: 10 downloads a day', () => {
  const downloads = simulate({
    sites: [SOUTH],
    from: Date.UTC(2026, 9, 16, 0, 0),
    to: Date.UTC(2026, 9, 17, 0, 0),
    forecasts: yesterdayEvening([SOUTH]),
  });
  assert.equal(downloads.length, 10);
  assert.ok(downloads.every((t, i) => i === 0 || t - downloads[i - 1] >= TIMINGS.minGap));
});

test('calls spent elsewhere (a manual refresh) are spread again, never exceeded', () => {
  const sites = [SOUTH, WEST];
  let spent = false;
  const downloads = simulate({
    sites,
    from: Date.UTC(2026, 9, 16, 0, 0),
    to: Date.UTC(2026, 9, 17, 0, 0),
    forecasts: yesterdayEvening(sites),
    onMinute(now, state) {
      if (!spent && now === Date.UTC(2026, 9, 16, 9)) {
        spent = true;
        state.usage.used += 4;
      }
    },
  });
  // 10 calls: 2 per download, 4 spent by hand -> 3 automatic downloads.
  assert.equal(downloads.length, 3);
});

test('a first start at noon downloads at once, then spreads the rest', () => {
  const downloads = simulate({
    sites: [SOUTH, WEST],
    from: Date.UTC(2026, 9, 16, 10, 0),
    to: Date.UTC(2026, 9, 17, 0, 0),
  });
  assert.equal(downloads[0], Date.UTC(2026, 9, 16, 10, 0));
  assert.equal(downloads.length, 5);
  assert.ok(downloads.at(-1) < Date.UTC(2026, 9, 16, 17));
});

test('planned times keep away from the quarter hours', () => {
  assert.equal(offQuarter(Date.UTC(2026, 9, 16, 7, 29)), Date.UTC(2026, 9, 16, 7, 33));
  assert.equal(offQuarter(Date.UTC(2026, 9, 16, 8, 0, 30)), Date.UTC(2026, 9, 16, 8, 3));
  assert.equal(offQuarter(Date.UTC(2026, 9, 16, 8, 7)), Date.UTC(2026, 9, 16, 8, 7));
  assert.equal(offQuarter(Date.UTC(2026, 9, 16, 8, 13)), Date.UTC(2026, 9, 16, 8, 13));
});
