// -----------------------------------------------------------------------------
// The production scene events of a device (pure): the estimated start, peak
// and end of the production of the day, fired when the clock passes them.
//
// Checked every minute between the previous check and now. Each kind fires
// once per local day and device; a time found too late (a restart, Gladys
// down) is not fired: a scene "at the peak" must not run an hour after it.
// -----------------------------------------------------------------------------

import { SCENE_TRIGGERS, TIMINGS } from './constants.js';

const KINDS = [
  ['start', SCENE_TRIGGERS.PRODUCTION_STARTED],
  ['peakTime', SCENE_TRIGGERS.PRODUCTION_PEAK],
  ['end', SCENE_TRIGGERS.PRODUCTION_ENDED],
];

/**
 * The events between `since` (excluded) and `now` (included).
 * @param {{ start, peakTime, end }} profile  dayProfile of today (times or null)
 * @param {{ since: number, now: number, day: string, fired: Set<string> }} context
 *   `fired` holds `<day>:<key>` of the events already fired for this device.
 * @returns {{ key: string, at: number }[]}
 */
export function productionEvents(profile, { since, now, day, fired }) {
  const events = [];
  for (const [field, key] of KINDS) {
    const at = profile?.[field];
    const id = `${day}:${key}`;
    if (at === null || at === undefined || fired.has(id)) {
      continue;
    }
    if (at > since && at <= now && now - at <= TIMINGS.eventLate) {
      fired.add(id);
      events.push({ key, at });
    }
  }
  return events;
}
