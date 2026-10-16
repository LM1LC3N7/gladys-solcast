// -----------------------------------------------------------------------------
// Days and hours in the time zone of Gladys (pure).
//
// Gladys starts the container with `TZ=<its time zone>` (the timezone system
// variable, UTC otherwise). "Today" and "tomorrow" are the local days of that
// zone; the Solcast daily limit, though, resets at midnight UTC.
// -----------------------------------------------------------------------------

const DAY = 24 * 3600_000;

const formatters = new Map();

function partsFormatter(timeZone) {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatters.set(timeZone, formatter);
  }
  return formatter;
}

/** A valid IANA time zone (the `TZ` given by Gladys), UTC otherwise. */
export function resolveTimeZone(value) {
  const zone = String(value ?? '').trim();
  if (zone === '') {
    return 'UTC';
  }
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
    return zone;
  } catch {
    return 'UTC';
  }
}

/** { year, month, day, hour, minute, second } of an instant in a zone. */
export function zonedParts(ms, timeZone) {
  const parts = {};
  for (const { type, value } of partsFormatter(timeZone).formatToParts(new Date(ms))) {
    if (type !== 'literal') {
      parts[type] = Number(value);
    }
  }
  return parts;
}

/** Offset of the zone at an instant, in ms (Paris in summer: +2 h). */
export function offsetAt(ms, timeZone) {
  const p = zonedParts(ms, timeZone);
  const local = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return local - Math.floor(ms / 1000) * 1000;
}

const pad = (n) => String(n).padStart(2, '0');

/** "YYYY-MM-DD", the local day of an instant. */
export function dayKey(ms, timeZone) {
  const p = zonedParts(ms, timeZone);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

/**
 * The day after a "YYYY-MM-DD" key (calendar only, no DST trap). From
 * prohand/gladys-forecastsolar, src/forecast.js (Apache-2.0).
 */
export function nextDayKey(key) {
  const date = new Date(`${key}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

/** The instant of the local midnight that starts a day. */
export function startOfDay(key, timeZone) {
  const [year, month, day] = key.split('-').map(Number);
  const midnight = Date.UTC(year, month - 1, day);
  // The offset at UTC midnight, then at the local midnight it gives (DST).
  let start = midnight - offsetAt(midnight, timeZone);
  start = midnight - offsetAt(start, timeZone);
  return start;
}

/** The local day of an instant: { key, start, end } (end excluded). */
export function dayOf(ms, timeZone) {
  const key = dayKey(ms, timeZone);
  return { key, start: startOfDay(key, timeZone), end: startOfDay(nextDayKey(key), timeZone) };
}

/** The local day after the one of an instant. */
export function nextDayOf(ms, timeZone) {
  const key = nextDayKey(dayKey(ms, timeZone));
  return { key, start: startOfDay(key, timeZone), end: startOfDay(nextDayKey(key), timeZone) };
}

/** "HH:MM", local. */
export function hhmm(ms, timeZone) {
  const p = zonedParts(ms, timeZone);
  return `${pad(p.hour)}:${pad(p.minute)}`;
}

/** "DD/MM HH:MM", local. */
export function dayAndTime(ms, timeZone) {
  const p = zonedParts(ms, timeZone);
  return `${pad(p.day)}/${pad(p.month)} ${pad(p.hour)}:${pad(p.minute)}`;
}

/** "YYYY-MM-DD" of the UTC day: the day of the Solcast daily limit. */
export const utcDayKey = (ms) => new Date(ms).toISOString().slice(0, 10);

/** The UTC midnight that starts the UTC day of an instant. */
export const utcDayStart = (ms) => Math.floor(ms / DAY) * DAY;

/** The next UTC midnight: the daily limit resets then. */
export const utcDayEnd = (ms) => utcDayStart(ms) + DAY;
