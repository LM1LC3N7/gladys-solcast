// -----------------------------------------------------------------------------
// Manifest keys, Solcast API constants, limits and timings.
// -----------------------------------------------------------------------------

/** The Solcast API (docs.solcast.com.au, "Rooftop Sites (Hobbyist)"). */
export const API = {
  baseUrl: 'https://api.solcast.com.au',
};

/** API paths, relative to API.baseUrl. */
export const PATHS = {
  /** The rooftop sites of the key: free, it uses no call of the daily limit. */
  sites: () => '/rooftop_sites',
  /** The forecast of one site: one call of the daily limit. */
  forecasts: (resourceId) => `/rooftop_sites/${encodeURIComponent(resourceId)}/forecasts`,
};

/**
 * Hours asked per forecast: today, tomorrow and the rest of the UTC day the
 * refreshes are planned in, whatever the time zone (Solcast sends up to 14
 * days, Home Assistant asks for 168 hours).
 */
export const FORECAST_HOURS = 72;

/** Solcast periods last 30 minutes for hobbyists (`period: "PT30M"`). */
export const PERIOD_MS = 30 * 60_000;

export const ACTIONS = {
  TEST_CONNECTION: 'test_connection',
  REFRESH_FORECAST: 'refresh_forecast',
};

export const SCENE_TRIGGERS = {
  FORECAST_UPDATED: 'forecast_updated',
  PRODUCTION_STARTED: 'production_started',
  PRODUCTION_PEAK: 'production_peak',
  PRODUCTION_ENDED: 'production_ended',
};

/** Forecast calls per UTC day: 10 for the accounts made today, 50 for some older ones. */
export const DAILY_LIMIT = { min: 1, max: 50, default: 10 };

export const LIMITS = {
  /** Gladys: 300 states per minute, 300 scene events per minute. */
  statesPerMinute: 300,
  sceneEventsPerMinute: 300,
  statesPerRequest: 100,
  /** Largest answer read: a 72-hour forecast is about 15 KB. */
  responseBytes: 2 * 1024 * 1024,
  /** Scene event strings (Gladys accepts 1000 characters). */
  eventText: 200,
  /** Scene events kept while Gladys is unreachable. */
  queuedEvents: 200,
};

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

export const TIMINGS = {
  /** The app checks the plan, the values and the events every minute. */
  tick: MINUTE,
  requestTimeout: 30_000,
  /** The publisher sends what is pending every 5 seconds. */
  flushInterval: 5_000,
  /** The values are recomputed from the stored forecast every 5 minutes. */
  recompute: 5 * MINUTE,
  /** An unchanged state is sent again every 30 minutes. */
  stateHeartbeat: 30 * MINUTE,
  /** The sites are read again once a day (free), and on a scan at most every 10 minutes. */
  sitesMaxAge: 24 * HOUR,
  scanSites: 10 * MINUTE,
  /** Two downloads of the same site are at least this far apart. */
  minGap: 20 * MINUTE,
  /** "Refresh the forecast now" downloads again a site only after this long. */
  manualCooldown: 10 * MINUTE,
  /** "Test the connection" reads the sites at most this often. */
  testCooldown: 30_000,
  /** After a failed download (busy, unreachable): 5, 10, 20, 40, then 60 minutes. */
  backoff: [5 * MINUTE, 10 * MINUTE, 20 * MINUTE, 40 * MINUTE, 60 * MINUTE],
  /** A download this little before the production starts counts as the one of the sunrise. */
  sunriseWindow: HOUR,
  /** A stored forecast ending sooner than this is downloaded again as soon as possible. */
  coverAhead: 24 * HOUR,
  /** A device whose forecast is older than this gets a degraded badge. */
  staleAfter: 26 * HOUR,
  /** A production event found later than this (restart, outage) is not fired. */
  eventLate: 5 * MINUTE,
  /**
   * Planned downloads are shifted by a delay drawn once per installation:
   * Solcast is swamped on the quarter hours, and two installations should not
   * call at the same second.
   */
  offset: { min: 2 * MINUTE, max: 10 * MINUTE },
};
