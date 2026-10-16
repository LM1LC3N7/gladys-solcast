// -----------------------------------------------------------------------------
// The Solcast account: the rooftop sites of the key (free) and the forecast
// of one site (one call of the daily limit). Every Solcast request goes
// through here; the key only travels in the Authorization header, never in a
// URL (logs, proxies).
// -----------------------------------------------------------------------------

import { API, FORECAST_HOURS, PATHS } from './constants.js';
import { parsePeriods } from './forecast.js';
import { SolcastError, errorFor, httpRequest, parseJson, rateLimitOf } from './solcast.js';

const text = (value) => (typeof value === 'string' ? value.trim() : '');

const number = (value) => {
  const n = Number(value);
  return value !== null && value !== '' && Number.isFinite(n) ? n : undefined;
};

/**
 * One rooftop site of the `GET /rooftop_sites` answer -> { id, name, capacity
 * (kW AC), capacityDc, azimuth, tilt, installDate }; undefined without a
 * resource id.
 */
export function readSite(raw) {
  const id = text(raw?.resource_id);
  if (id === '') {
    return undefined;
  }
  return {
    id,
    name: text(raw.name) || id,
    capacity: number(raw.capacity),
    capacityDc: number(raw.capacity_dc),
    azimuth: number(raw.azimuth),
    tilt: number(raw.tilt),
    installDate: text(raw.install_date).slice(0, 10) || undefined,
  };
}

export class SolcastClient {
  constructor({ transport = httpRequest, userAgent, now = Date.now, baseUrl = API.baseUrl } = {}) {
    this.transport = transport;
    this.userAgent = userAgent;
    this.now = now;
    this.baseUrl = baseUrl;
    this.apiKey = '';
  }

  configure({ apiKey }) {
    this.apiKey = String(apiKey ?? '').trim();
  }

  get hasKey() {
    return this.apiKey !== '';
  }

  async get(path, query = {}) {
    if (!this.hasKey) {
      throw new SolcastError('no_key', 'no API key');
    }
    const url = new URL(path, this.baseUrl);
    for (const [name, value] of Object.entries({ format: 'json', ...query })) {
      url.searchParams.set(name, String(value));
    }
    const headers = {
      Authorization: `Bearer ${this.apiKey}`,
      Accept: 'application/json',
      ...(this.userAgent ? { 'User-Agent': this.userAgent } : {}),
    };
    const answer = await this.transport(url.toString(), { method: 'GET', headers });
    if (answer.status < 200 || answer.status > 299) {
      throw errorFor(answer, { now: this.now() });
    }
    return { json: parseJson(answer.body), headers: answer.headers ?? {} };
  }

  /** The rooftop sites of the key. Free: no call of the daily limit. */
  async sites() {
    const { json } = await this.get(PATHS.sites());
    if (!Array.isArray(json.sites)) {
      throw new SolcastError('bad_response', 'Solcast sent no list of sites');
    }
    return json.sites.map(readSite).filter(Boolean);
  }

  /**
   * The forecast of one site: one call of the daily limit. Resolves the
   * periods and the X-RateLimit-* headers when Solcast sends them.
   */
  async forecasts(resourceId) {
    const { json, headers } = await this.get(PATHS.forecasts(resourceId), {
      hours: FORECAST_HOURS,
    });
    if (!Array.isArray(json.forecasts)) {
      throw new SolcastError('bad_response', 'Solcast sent no forecast');
    }
    return { periods: parsePeriods(json.forecasts), rateLimit: rateLimitOf(headers) };
  }
}
