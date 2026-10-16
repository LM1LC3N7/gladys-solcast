import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeValues,
  covers,
  dayProfile,
  energyBetween,
  knowsWholeDay,
  mergePeriods,
  normalizePeriods,
  parseDate,
  parseDuration,
  parsePeriods,
  powerAt,
  sumPeriods,
} from '../src/forecast.js';
import {
  HOUR,
  MINUTE,
  NOW,
  PARIS_DAYS,
  PERIOD,
  SOUTH,
  TZ,
  WEST,
  expectedEnergy,
  forecastAnswer,
  pvValue,
} from './fixtures/solcast.js';

const periodsAt = (site, at, hours = 72) => parsePeriods(forecastAnswer(site, at, hours).forecasts);
const close = (actual, expected, epsilon = 0.011) =>
  assert.ok(Math.abs(actual - expected) <= epsilon, `${actual} is not ${expected}`);

test('both date formats of Solcast are read, a date without a zone is not', () => {
  const at = Date.UTC(2026, 9, 16, 4, 30);
  assert.equal(parseDate('2026-10-16T04:30:00.0000000Z'), at);
  assert.equal(parseDate('2026-10-16T04:30:00+00:00'), at);
  assert.equal(parseDate('2026-10-16T06:30:00+02:00'), at);
  assert.equal(parseDate('2026-10-16T04:30:00Z'), at);
  assert.ok(Number.isNaN(parseDate('2026-10-16T04:30:00')));
  assert.ok(Number.isNaN(parseDate('yesterday')));
  assert.ok(Number.isNaN(parseDate(null)));
  assert.equal(parseDuration('PT30M'), 30 * MINUTE);
  assert.equal(parseDuration('PT1H'), HOUR);
  assert.equal(parseDuration('PT1H30M'), 90 * MINUTE);
  assert.equal(parseDuration('P1D'), undefined);
  assert.equal(parseDuration('PT0M'), undefined);
});

test('the periods of an answer: sorted, repaired, the same in both formats', () => {
  const legacy = parsePeriods(forecastAnswer(SOUTH, NOW, 2).forecasts);
  const v3 = parsePeriods(forecastAnswer(SOUTH, NOW, 2, { format: 'v3' }).forecasts);
  assert.deepEqual(legacy, v3);
  assert.equal(legacy.length, 5, 'one period more than asked, like Solcast');
  assert.deepEqual(legacy[0], {
    end: Date.UTC(2026, 9, 16, 4, 30),
    length: PERIOD,
    p50: 0,
    p10: 0,
    p90: 0,
  });
  const repaired = parsePeriods([
    { pv_estimate: 1.5, period_end: '2026-10-16T12:00:00.0000000Z', period: 'PT30M' },
    {
      pv_estimate: -0.2,
      pv_estimate10: -1,
      pv_estimate90: 0.3,
      period_end: '2026-10-16T11:30:00Z',
    },
    { pv_estimate: 'n/a', period_end: '2026-10-16T12:30:00Z' },
    { pv_estimate: 1, period_end: 'soon' },
    null,
  ]);
  assert.deepEqual(repaired, [
    { end: Date.UTC(2026, 9, 16, 11, 30), length: PERIOD, p50: 0, p10: 0, p90: 0.3 },
    { end: Date.UTC(2026, 9, 16, 12), length: PERIOD, p50: 1.5, p10: 1.5, p90: 1.5 },
  ]);
  assert.deepEqual(parsePeriods(undefined), []);
  assert.deepEqual(normalizePeriods([...repaired, { end: 'x' }, null]), repaired);
});

test('a new forecast replaces the stored one from its first period on, the past stays', () => {
  const morning = periodsAt(SOUTH, NOW);
  const noon = Date.UTC(2026, 9, 16, 10, 10);
  const fresh = periodsAt(SOUTH, noon).map((p) => ({ ...p, p50: p.p50 + 1 }));
  const merged = mergePeriods(morning, fresh);
  const firstFresh = Date.UTC(2026, 9, 16, 10, 30);
  assert.equal(merged[0].end, morning[0].end, 'the morning is kept');
  assert.equal(merged.find((p) => p.end === firstFresh).p50, fresh[0].p50);
  assert.equal(merged.at(-1).end, fresh.at(-1).end);
  assert.equal(new Set(merged.map((p) => p.end)).size, merged.length, 'no period twice');
  assert.ok(covers(merged, morning[0].end - PERIOD, fresh.at(-1).end));
  // Yesterday is dropped; an empty answer keeps what was stored.
  const kept = mergePeriods(morning, [], Date.UTC(2026, 9, 17));
  assert.ok(kept.every((p) => p.end > Date.UTC(2026, 9, 17)));
  // A shorter new forecast drops the older periods after it.
  const short = periodsAt(SOUTH, noon, 2);
  assert.equal(mergePeriods(morning, short).at(-1).end, short.at(-1).end);
});

test('energies integrate the period averages, the power follows the curve', () => {
  const periods = periodsAt(SOUTH, NOW);
  const day = PARIS_DAYS['2026-10-16'];
  close(energyBetween(periods, NOW, day.end), expectedEnergy(SOUTH, NOW, day.end), 1e-9);
  // Half a period is half its energy.
  const end = Date.UTC(2026, 9, 16, 11, 30);
  close(energyBetween(periods, end - 15 * MINUTE, end), pvValue(SOUTH, end) * 0.25, 1e-9);
  // At the middle of a period: its average; between two middles: in between.
  const mid = end - 15 * MINUTE;
  assert.equal(powerAt(periods, mid), Math.round(pvValue(SOUTH, end) * 1000));
  const boundary = Date.UTC(2026, 9, 16, 8);
  assert.equal(
    powerAt(periods, boundary),
    Math.round(((pvValue(SOUTH, boundary) + pvValue(SOUTH, boundary + PERIOD)) / 2) * 1000),
  );
  assert.equal(powerAt(periods, NOW - MINUTE), undefined, 'before the forecast');
  assert.equal(powerAt(periods, periods.at(-1).end), undefined, 'after the forecast');
  assert.ok(
    powerAt(periods, Date.UTC(2026, 9, 16, 9), 'p10') < powerAt(periods, Date.UTC(2026, 9, 16, 9)),
  );
});

test('a forecast downloaded before sunrise knows the whole day', () => {
  const periods = periodsAt(SOUTH, NOW);
  const today = PARIS_DAYS['2026-10-16'];
  const tomorrow = PARIS_DAYS['2026-10-17'];
  const values = computeValues(periods, NOW, TZ);
  assert.deepEqual(values.power, { p50: 0, p10: 0, p90: 0 });
  for (const estimate of ['p50', 'p10', 'p90']) {
    close(values.today[estimate], expectedEnergy(SOUTH, NOW, today.end, estimate));
    close(values.remaining[estimate], expectedEnergy(SOUTH, NOW, today.end, estimate));
    close(values.tomorrow[estimate], expectedEnergy(SOUTH, tomorrow.start, tomorrow.end, estimate));
  }
  assert.ok(values.today.p10 < values.today.p50 && values.today.p50 < values.today.p90);
  assert.ok(values.tomorrow.p50 < values.today.p50, 'tomorrow is cloudy');
  // Later in the day: the remaining part shrinks, today stays.
  const later = computeValues(periods, Date.UTC(2026, 9, 16, 11), TZ);
  assert.equal(later.today.p50, values.today.p50);
  close(later.remaining.p50, expectedEnergy(SOUTH, Date.UTC(2026, 9, 16, 11), today.end));
  assert.ok(later.power.p50 > 1500);
});

test('a forecast first downloaded at noon does not know the morning', () => {
  const noon = Date.UTC(2026, 9, 16, 10, 10);
  const periods = periodsAt(SOUTH, noon);
  const values = computeValues(periods, noon, TZ);
  assert.equal(values.today, null);
  assert.ok(values.remaining.p50 > 0);
  assert.ok(values.tomorrow.p50 > 0);
  assert.equal(knowsWholeDay(periods, PARIS_DAYS['2026-10-16']), false);
  // After sunset nothing tells whether there was production in the morning.
  const evening = periodsAt(SOUTH, Date.UTC(2026, 9, 16, 18));
  assert.equal(knowsWholeDay(evening, PARIS_DAYS['2026-10-16']), false);
  // The next day is known from the start.
  assert.equal(knowsWholeDay(periods, PARIS_DAYS['2026-10-17']), true);
  // Outside the forecast, nothing is known.
  assert.deepEqual(computeValues([], noon, TZ), {
    power: null,
    today: null,
    remaining: null,
    tomorrow: null,
  });
});

test('the total of two sites adds them up where both are known', () => {
  const south = periodsAt(SOUTH, NOW);
  const west = periodsAt(WEST, NOW);
  const total = sumPeriods([south, west]);
  assert.equal(total.length, south.length);
  const values = computeValues(total, NOW, TZ);
  const day = PARIS_DAYS['2026-10-16'];
  close(values.today.p50, expectedEnergy(SOUTH, NOW, day.end) + expectedEnergy(WEST, NOW, day.end));
  assert.equal(sumPeriods([south, []]).length, 0, 'a site without forecast: unknown');
  assert.equal(sumPeriods([south]), south);
  assert.deepEqual(sumPeriods([]), []);
});

test('the production profile of a day: start, peak and end', () => {
  const periods = periodsAt(SOUTH, NOW);
  const profile = dayProfile(periods, PARIS_DAYS['2026-10-16']);
  assert.deepEqual(profile, {
    start: Date.UTC(2026, 9, 16, 5),
    end: Date.UTC(2026, 9, 16, 17),
    peakTime: Date.UTC(2026, 9, 16, 11, 15),
    peakPower: Math.round(pvValue(SOUTH, Date.UTC(2026, 9, 16, 11, 30)) * 1000),
  });
  // Downloaded at noon: the start is unknown, so is the peak; the end is known.
  const noon = periodsAt(SOUTH, Date.UTC(2026, 9, 16, 10, 10));
  assert.deepEqual(dayProfile(noon, PARIS_DAYS['2026-10-16']), {
    start: null,
    end: Date.UTC(2026, 9, 16, 17),
    peakTime: null,
    peakPower: null,
  });
  // A dark day.
  const dark = periods.map((p) => ({ ...p, p50: 0 }));
  assert.equal(dayProfile(dark, PARIS_DAYS['2026-10-16']).start, null);
});
