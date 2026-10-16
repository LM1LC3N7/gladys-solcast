// -----------------------------------------------------------------------------
// The daily limit of Solcast and when to download (pure).
//
// A hobbyist key has 10 forecast calls per UTC day (50 on some older
// accounts), for all its sites together; listing the sites is free. The
// calls made are counted in /data, so a restart never makes more.
//
// The downloads of the day are spread over the production hours left in the
// UTC day, read on the stored forecast: the first one when production starts
// (a fresh forecast for the day), then evenly, the last one well before
// sunset. With 2 sites and 10 calls, that is 5 downloads of both sites a day;
// with 1 site, 10. A manual refresh spends from the same calls: the plan
// spreads what is left.
// -----------------------------------------------------------------------------

import { TIMINGS } from './constants.js';
import { lastEnd } from './forecast.js';
import { utcDayEnd, utcDayKey, utcDayStart } from './time.js';

const MINUTE = 60_000;
const QUARTER = 15 * MINUTE;

/** The usage counter, repaired, and reset when the UTC day changed. */
export function currentUsage(raw, now) {
  const day = utcDayKey(now);
  if (raw?.day !== day) {
    return { day, used: 0, exhausted: false };
  }
  const used = Number.isInteger(raw.used) && raw.used > 0 ? raw.used : 0;
  const usage = { day, used, exhausted: raw.exhausted === true };
  if (Number.isInteger(raw.limit) && raw.limit >= 0) {
    usage.limit = raw.limit;
  }
  return usage;
}

/** The calls left today: the configured limit, or the one Solcast sent if lower. */
export function callsLeft(usage, limit) {
  if (usage.exhausted) {
    return 0;
  }
  const effective = Math.min(limit, usage.limit ?? Infinity);
  return Math.max(0, effective - usage.used);
}

/** The limit in force today (the configured one, or the one Solcast sent if lower). */
export const limitOf = (usage, limit) => Math.min(limit, usage.limit ?? Infinity);

/**
 * The intervals [start, end) with production (P90 above 0) of the sites,
 * merged, inside [from, to).
 */
export function productionIntervals(periodsList, from, to) {
  const spans = [];
  for (const periods of periodsList) {
    for (const p of periods) {
      const start = Math.max(p.end - p.length, from);
      const end = Math.min(p.end, to);
      if (end > start && p.p90 > 0) {
        spans.push([start, end]);
      }
    }
  }
  spans.sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const [start, end] of spans) {
    const last = merged.at(-1);
    if (last && start <= last[1]) {
      last[1] = Math.max(last[1], end);
    } else {
      merged.push([start, end]);
    }
  }
  return merged;
}

/** The instant reached after `ms` of production time from the start of the intervals. */
function afterProduction(intervals, ms) {
  let left = ms;
  for (const [start, end] of intervals) {
    if (left <= end - start) {
      return start + left;
    }
    left -= end - start;
  }
  return intervals.at(-1)[1];
}

/**
 * Solcast is swamped on the quarter hours, the full hours most (Home
 * Assistant integration, README): a planned time within 2 minutes of one
 * moves 3 minutes after it.
 */
export function offQuarter(ms) {
  const into = ((ms % QUARTER) + QUARTER) % QUARTER;
  if (into < 2 * MINUTE) {
    return ms - into + 3 * MINUTE;
  }
  if (into > QUARTER - 2 * MINUTE) {
    return ms - into + QUARTER + 3 * MINUTE;
  }
  return ms;
}

/** The pause after `failures` failed downloads in a row. */
export function backoffAfter(failures) {
  return TIMINGS.backoff[Math.min(Math.max(failures, 1), TIMINGS.backoff.length) - 1];
}

/**
 * When to download next.
 * @param {object} input
 * @param {number} input.now
 * @param {string[]} input.sites  the sites to download (those of the created devices)
 * @param {object} input.forecasts  id -> { fetchedAt, periods }
 * @param {number} input.left  calls left today
 * @param {{ retryAt: number }} [input.attempt]  the last failure: no download before retryAt
 * @param {number} [input.offset]  the delay of this installation (ms)
 * @returns {{ at: number, reason: string }}  `at` may be in the past: download now
 */
export function planNext({ now, sites, forecasts, left, attempt, offset = 0 }) {
  if (sites.length === 0) {
    return { at: Infinity, reason: 'no_device' };
  }
  const dayEnd = utcDayEnd(now);
  const refreshes = Math.floor(left / sites.length);
  if (refreshes === 0) {
    return { at: dayEnd + offset, reason: 'budget' };
  }
  const retryAt = attempt?.retryAt ?? -Infinity;
  const stored = sites.map((id) => forecasts[id]);
  const oldest = Math.min(...stored.map((f) => f?.fetchedAt ?? -Infinity));
  const gapAt = oldest + TIMINGS.minGap;

  // A site never downloaded, or whose forecast ends within a day: now.
  if (stored.some((f) => !f || lastEnd(f.periods) < now + TIMINGS.coverAhead)) {
    return { at: Math.max(now, gapAt, retryAt), reason: 'missing' };
  }

  const from = Math.max(oldest, utcDayStart(now));
  const intervals = productionIntervals(
    stored.map((f) => f.periods),
    from,
    dayEnd,
  );
  if (intervals.length === 0) {
    // No production left in this UTC day: the next one plans again.
    return { at: dayEnd + offset, reason: 'night' };
  }
  const production = intervals.reduce((sum, [start, end]) => sum + end - start, 0);
  // Downloaded during this production, or just before it began (that was the
  // download of the sunrise): evenly over what is left of it. Otherwise
  // nothing was downloaded since it began: at its start.
  const start = intervals[0][0];
  const target =
    start - oldest <= TIMINGS.sunriseWindow
      ? afterProduction(intervals, production / (refreshes + 1))
      : start;
  return { at: offQuarter(Math.max(target + offset, gapAt, retryAt)), reason: 'plan' };
}
