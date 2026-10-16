// -----------------------------------------------------------------------------
// Solcast periods -> the values published in Gladys (pure, no I/O).
//
// A Solcast forecast is a list of periods: `period_end`, `period` (PT30M) and
// the average PV power over the period, in kW: `pv_estimate` (P50, the most
// likely), `pv_estimate10` (P10, a dull day: 9 chances in 10 to do better)
// and `pv_estimate90` (P90, a bright day). It starts at the current period,
// so the morning of today only survives in what was stored before: new
// periods replace the stored ones from their first period on, the older ones
// stay.
//
// Energies integrate the period averages exactly (kW × hours of the period
// inside the range); the power "now" interpolates between the middles of the
// periods, so it follows the curve between two downloads.
// -----------------------------------------------------------------------------

import { PERIOD_MS } from './constants.js';
import { dayOf, nextDayOf } from './time.js';

export const ESTIMATES = ['p50', 'p10', 'p90'];

const HOUR = 3600_000;

/**
 * An ISO date of Solcast -> ms. Both formats of the docs: the legacy one with
 * seven decimals ("2026-10-16T12:30:00.0000000Z") and version 3
 * ("2026-10-16T12:30:00+00:00"). A date without a zone is refused (NaN).
 */
export function parseDate(value) {
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?)(\.\d+)?(Z|[+-]\d{2}:?\d{2})$/.exec(
    String(value ?? '').trim(),
  );
  if (!match) {
    return Number.NaN;
  }
  const fraction = match[2] ? match[2].slice(0, 4) : '';
  return Date.parse(`${match[1]}${fraction}${match[3]}`);
}

/** "PT30M", "PT1H", "PT15M" -> ms; undefined when unreadable. */
export function parseDuration(value) {
  const match = /^PT(?:(\d+)H)?(?:(\d+)M)?$/.exec(String(value ?? '').trim());
  if (!match || (match[1] === undefined && match[2] === undefined)) {
    return undefined;
  }
  const ms = (Number(match[1] ?? 0) * 60 + Number(match[2] ?? 0)) * 60_000;
  return ms > 0 ? ms : undefined;
}

const kw = (value) => {
  const n = Number(value);
  return Number.isFinite(n) && value !== null && value !== '' ? Math.max(0, n) : undefined;
};

/**
 * The `forecasts` of an answer -> periods `{ end, length, p50, p10, p90 }`
 * sorted by end (ms, kW). Entries without a readable end or P50 are skipped;
 * a missing P10 or P90 takes the P50.
 */
export function parsePeriods(forecasts) {
  const periods = new Map();
  for (const entry of Array.isArray(forecasts) ? forecasts : []) {
    const end = parseDate(entry?.period_end);
    const p50 = kw(entry?.pv_estimate);
    if (!Number.isFinite(end) || p50 === undefined) {
      continue;
    }
    periods.set(end, {
      end,
      length: parseDuration(entry.period) ?? PERIOD_MS,
      p50,
      p10: kw(entry.pv_estimate10) ?? p50,
      p90: kw(entry.pv_estimate90) ?? p50,
    });
  }
  return [...periods.values()].sort((a, b) => a.end - b.end);
}

/** Stored periods, repaired (read back from /data). */
export function normalizePeriods(raw) {
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw
    .filter(
      (p) =>
        Number.isFinite(p?.end) &&
        Number.isFinite(p.length) &&
        p.length > 0 &&
        ESTIMATES.every((k) => Number.isFinite(p[k]) && p[k] >= 0),
    )
    .map(({ end, length, p50, p10, p90 }) => ({ end, length, p50, p10, p90 }))
    .sort((a, b) => a.end - b.end);
}

/**
 * The stored periods before the new forecast, then the new forecast: from its
 * first period on, the new one is the truth. Periods ending before `keepFrom`
 * are dropped (yesterday is of no use).
 */
export function mergePeriods(stored, fresh, keepFrom = -Infinity) {
  if (fresh.length === 0) {
    return stored.filter((p) => p.end > keepFrom);
  }
  const firstStart = fresh[0].end - fresh[0].length;
  const past = stored.filter((p) => p.end <= firstStart && p.end > keepFrom);
  return [...past, ...fresh.filter((p) => p.end > keepFrom)];
}

const startOf = (p) => p.end - p.length;
const overlap = (p, from, to) => Math.max(0, Math.min(p.end, to) - Math.max(startOf(p), from));

/** Time of [from, to) covered by the periods, in ms. */
export function coveredTime(periods, from, to) {
  let covered = 0;
  for (const p of periods) {
    covered += overlap(p, from, to);
  }
  return covered;
}

/** Whether the periods cover all of [from, to). */
export function covers(periods, from, to) {
  return to <= from || coveredTime(periods, from, to) >= to - from - 1000;
}

/** Energy over [from, to), in kWh, for one estimate. */
export function energyBetween(periods, from, to, estimate = 'p50') {
  let kwh = 0;
  for (const p of periods) {
    const ms = overlap(p, from, to);
    if (ms > 0) {
      kwh += (p[estimate] * ms) / HOUR;
    }
  }
  return kwh;
}

/** The period holding an instant, and its index. */
function periodAt(periods, time) {
  const index = periods.findIndex((p) => startOf(p) <= time && time < p.end);
  return index < 0 ? undefined : { index, period: periods[index] };
}

/**
 * Power at an instant, in W: linear between the middles of the periods (a
 * neighbour must touch the period), the period average otherwise. Undefined
 * outside the forecast.
 */
export function powerAt(periods, time, estimate = 'p50') {
  const found = periodAt(periods, time);
  if (!found) {
    return undefined;
  }
  const { index, period } = found;
  const mid = startOf(period) + period.length / 2;
  const before = periods[index - 1];
  const after = periods[index + 1];
  let neighbour;
  if (time < mid && before && before.end === startOf(period)) {
    neighbour = before;
  } else if (time >= mid && after && startOf(after) === period.end) {
    neighbour = after;
  }
  let kwNow = period[estimate];
  if (neighbour) {
    const otherMid = startOf(neighbour) + neighbour.length / 2;
    const weight = (time - mid) / (otherMid - mid);
    kwNow = period[estimate] + (neighbour[estimate] - period[estimate]) * weight;
  }
  return Math.max(0, Math.round(kwNow * 1000));
}

const round2 = (value) => Math.round(value * 100) / 100;

const triple = (fn) => Object.fromEntries(ESTIMATES.map((estimate) => [estimate, fn(estimate)]));

/** A period without any production (P50 and P90 at 0): the night. */
const dark = (p) => p.p90 === 0 && p.p50 === 0;

/** The periods of a local day, in order. */
const periodsOfDay = (periods, day) =>
  periods.filter((p) => startOf(p) >= day.start && p.end <= day.end);

/**
 * Whether what comes before `inDay[index]` is known: the periods go back
 * without a gap to a dark one (the night before the sunrise), or to the start
 * of the day.
 */
function knownBefore(inDay, index, day) {
  for (let i = index - 1; i >= 0; i -= 1) {
    if (inDay[i].end !== startOf(inDay[i + 1])) {
      return false;
    }
    if (dark(inDay[i])) {
      return true;
    }
  }
  return inDay.length > 0 && startOf(inDay[0]) <= day.start;
}

/** The same after `inDay[index]`: to a dark period, or to the end of the day. */
function knownAfter(inDay, index, day) {
  for (let i = index + 1; i < inDay.length; i += 1) {
    if (startOf(inDay[i]) !== inDay[i - 1].end) {
      return false;
    }
    if (dark(inDay[i])) {
      return true;
    }
  }
  return inDay.length > 0 && inDay.at(-1).end >= day.end;
}

/**
 * Whether "energy today" is known: the periods cover the rest of the day, and
 * the part missing in the morning, if any, is the night (a period without
 * production precedes the first one with production).
 */
export function knowsWholeDay(periods, day) {
  const inDay = periodsOfDay(periods, day);
  if (inDay.length === 0 || !covers(periods, startOf(inDay[0]), day.end)) {
    return false;
  }
  if (startOf(inDay[0]) <= day.start) {
    return true;
  }
  const firstPositive = inDay.findIndex((p) => p.p50 > 0);
  return firstPositive > 0 && knownBefore(inDay, firstPositive, day);
}

/**
 * The values of a device at an instant. Each is `{ p50, p10, p90 }`, or null
 * when the stored forecast does not cover it (then nothing is published):
 * - power: W now;
 * - today: kWh of the whole local day;
 * - remaining: kWh from now to the end of the local day;
 * - tomorrow: kWh of the next local day.
 */
export function computeValues(periods, now, timeZone) {
  const today = dayOf(now, timeZone);
  const tomorrow = nextDayOf(now, timeZone);
  const powerNow = periodAt(periods, now) ? triple((e) => powerAt(periods, now, e)) : null;
  const energy = (from, to) => triple((e) => round2(energyBetween(periods, from, to, e)));
  return {
    power: powerNow,
    today: knowsWholeDay(periods, today) ? energy(today.start, today.end) : null,
    remaining: covers(periods, now, today.end) ? energy(now, today.end) : null,
    tomorrow: covers(periods, tomorrow.start, tomorrow.end)
      ? energy(tomorrow.start, tomorrow.end)
      : null,
  };
}

/**
 * The periods of several sites added up (the "all sites" device). Only the
 * periods every site has: a site without a period makes the total unknown
 * there.
 */
export function sumPeriods(list) {
  if (list.length === 0) {
    return [];
  }
  if (list.length === 1) {
    return list[0];
  }
  const [first, ...others] = list;
  const maps = others.map((periods) => new Map(periods.map((p) => [p.end, p])));
  const total = [];
  for (const p of first) {
    const same = maps.map((m) => m.get(p.end));
    if (same.every((q) => q && q.length === p.length)) {
      total.push({
        end: p.end,
        length: p.length,
        ...triple((e) => same.reduce((sum, q) => sum + q[e], p[e])),
      });
    }
  }
  return total;
}

/**
 * The P50 production of a local day: start (beginning of the first period
 * with production), end (end of the last one), peak (middle of the highest
 * period) and its power in W. A time the forecast cannot tell (the morning
 * missing, the evening missing) is null; the peak needs the whole production.
 */
export function dayProfile(periods, day) {
  const inDay = periodsOfDay(periods, day);
  const firstPositive = inDay.findIndex((p) => p.p50 > 0);
  if (firstPositive < 0) {
    return { start: null, end: null, peakTime: null, peakPower: null };
  }
  const lastPositive = inDay.findLastIndex((p) => p.p50 > 0);
  const startKnown = knownBefore(inDay, firstPositive, day);
  const endKnown = knownAfter(inDay, lastPositive, day);
  // The peak needs every period in between.
  const between = inDay.slice(firstPositive, lastPositive + 1);
  const contiguous = between.every((p, i) => i === 0 || startOf(p) === between[i - 1].end);
  let peak = between[0];
  for (const p of between) {
    if (p.p50 > peak.p50) {
      peak = p;
    }
  }
  const whole = startKnown && endKnown && contiguous;
  return {
    start: startKnown ? startOf(inDay[firstPositive]) : null,
    end: endKnown ? inDay[lastPositive].end : null,
    peakTime: whole ? startOf(peak) + peak.length / 2 : null,
    peakPower: whole ? Math.round(peak.p50 * 1000) : null,
  };
}

/** The end of the stored forecast (ms), -Infinity when empty. */
export const lastEnd = (periods) => (periods.length === 0 ? -Infinity : periods.at(-1).end);
