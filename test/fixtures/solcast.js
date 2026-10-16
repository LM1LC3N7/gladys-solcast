// -----------------------------------------------------------------------------
// Solcast answers for the tests, shaped after:
//   - the Solcast documentation, docs.solcast.com.au, pages "Rooftop Sites
//     (Hobbyist)", "Response formats" and "Errors" (read 2026-10-16): the
//     `forecasts` list of `pv_estimate`, `pv_estimate10`, `pv_estimate90` (kW),
//     `period_end` and `period` ("PT30M"), the legacy date format
//     "2026-10-16T04:30:00.0000000Z" and version 3 "…+00:00", the error
//     object `{ response_status: { error_code, message } }`;
//   - the `GET /rooftop_sites` answer of the simulator of BJReplay/
//     ha-solcast-solar (Apache-2.0, tests/simulator/simulate.py), the Home
//     Assistant integration: `sites` with `resource_id`, `name`, `capacity`,
//     `capacity_dc`, `azimuth`, `tilt`, `install_date`, `loss_factor`, plus
//     the paging fields. Like it, a forecast holds one period more than asked.
// The sites and the values are made up.
// -----------------------------------------------------------------------------

export const API_KEY = 'test-key-0123456789abcdef';
export const TZ = 'Europe/Paris';

export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;
export const PERIOD = 30 * MINUTE;

/** Friday 2026-10-16, 06:00 in Paris (04:00 UTC): before the sunrise of the curve. */
export const NOW = Date.UTC(2026, 9, 16, 4, 0, 0);
/** Paris is UTC+2 until 2026-10-25. */
const PARIS_OFFSET_HOURS = 2;

export const SOUTH = {
  resource_id: 'aaaa-1111-bbbb-2222',
  name: 'Toit sud',
  latitude: 48.8566,
  longitude: 2.3522,
  install_date: '2024-05-01T00:00:00.0000000Z',
  loss_factor: 0.9,
  capacity: 3,
  capacity_dc: 3.6,
  azimuth: 180,
  tilt: 30,
  tags: [],
};

export const WEST = {
  resource_id: 'cccc-3333-dddd-4444',
  name: 'Toit ouest',
  latitude: 48.8566,
  longitude: 2.3522,
  install_date: '2024-05-01T00:00:00.0000000Z',
  loss_factor: 0.9,
  capacity: 2,
  capacity_dc: 2.4,
  azimuth: 90,
  tilt: 30,
  tags: [],
};

export const sitesAnswer = (sites) => ({
  sites,
  page_count: 1,
  current_page: 1,
  total_records: sites.length,
});

/** How bright each day of the fixtures is (16 October sunny, 17 cloudy). */
const DAY_FACTORS = { '2026-10-16': 1, '2026-10-17': 0.5 };

/**
 * The made-up P50 of a site for the period ending at `end` (kW): a sine from
 * 07:12 to 19:12 Paris time, peaking at 13:12, so that the 13:00-13:30 period
 * is the highest of the day.
 */
export function pvValue(site, end) {
  const mid = end - PERIOD / 2;
  const local = new Date(mid + PARIS_OFFSET_HOURS * HOUR);
  const hours = local.getUTCHours() + local.getUTCMinutes() / 60;
  const x = (hours - 7.2) / 12;
  if (x <= 0 || x >= 1) {
    return 0;
  }
  const factor = DAY_FACTORS[local.toISOString().slice(0, 10)] ?? 0.8;
  return Math.round(site.capacity * 0.8 * factor * Math.sin(Math.PI * x) * 10000) / 10000;
}

const p10Of = (value) => Math.round(value * 0.6 * 10000) / 10000;
const p90Of = (value, site) => Math.min(site.capacity, Math.round(value * 1.15 * 10000) / 10000);

/** The legacy date format (seven decimals) or version 3 ("+00:00"). */
export const solcastDate = (ms, format = 'v1') =>
  format === 'v3'
    ? new Date(ms).toISOString().replace('.000Z', '+00:00')
    : new Date(ms).toISOString().replace('.000Z', '.0000000Z');

/** A forecast answer from the current period on, `hours` long (plus one period). */
export function forecastAnswer(site, now, hours = 72, { format = 'v1' } = {}) {
  const first = Math.floor(now / PERIOD) * PERIOD + PERIOD;
  const forecasts = [];
  for (let i = 0; i <= hours * 2; i += 1) {
    const end = first + i * PERIOD;
    const value = pvValue(site, end);
    forecasts.push({
      pv_estimate: value,
      pv_estimate10: p10Of(value),
      pv_estimate90: p90Of(value, site),
      period_end: solcastDate(end, format),
      period: 'PT30M',
    });
  }
  return { forecasts };
}

/**
 * The expected energy (kWh) of a site between two instants on the period
 * grid, computed straight from the curve (not with the code under test).
 */
export function expectedEnergy(site, from, to, estimate = 'p50') {
  let kwh = 0;
  for (let end = from + PERIOD; end <= to; end += PERIOD) {
    const value = pvValue(site, end);
    const kw = estimate === 'p10' ? p10Of(value) : estimate === 'p90' ? p90Of(value, site) : value;
    kwh += kw * 0.5;
  }
  return kwh;
}

/** The local days of the fixtures, in UTC instants. */
export const PARIS_DAYS = {
  '2026-10-16': { start: Date.UTC(2026, 9, 15, 22), end: Date.UTC(2026, 9, 16, 22) },
  '2026-10-17': { start: Date.UTC(2026, 9, 16, 22), end: Date.UTC(2026, 9, 17, 22) },
};
