# TODO — Solcast v1

Handoff document: what is done, what was decided, what comes next. Keep it
up to date at the end of every milestone.

## Working method

- One milestone at a time, one commit per milestone, tests green before moving on.
- After each milestone: `npm run format:check`, `npm run lint`, `npm test`,
  `npm run audit`, then update README, `docs/en.md`, `docs/fr.md`,
  `CHANGELOG.md` and this file.
- The `gladys-assistant-integration` topic is added at the first real release
  only (before, the store would list an empty integration).
- No forum topic of its own, ever, and no forum post from a module session:
  the claim is in /t/10385 (post #211); the release goes in a recap message
  there, with a link to the repo.

## Status

- [x] **Milestone 1 — core** (2026-10-16): API key, rooftop sites read for
      free (`GET /rooftop_sites`, start / daily / scan / test button,
      optional resource ids), one device per site and the total of two;
      forecasts (`hours=72`) of the created devices only, merged in `/data`
      (the morning of today kept); 12 features per device (power now, energy
      today, remaining today, tomorrow, each P50/P10/P90) with the keys and
      units of Forecast.Solar; values recomputed every 5 minutes, published
      on change or every 30 minutes; daily budget counted per UTC day in
      `/data` before each request, downloads spread over the production
      hours (5 a day with 2 sites, 10 with 1), away from the quarter hours;
      busy 429 retried (no call used), daily-limit 429 until midnight UTC;
      degraded badge after 26 h without a download; scene triggers
      `forecast_updated`, `production_started`, `production_peak`,
      `production_ended`; buttons "Test the connection" (free) and "Refresh
      the forecast now" (cooldown 10 min, calls left); en/fr names; docs
      en/fr. Tested against simulated answers only.
- [ ] **Milestone 2 — real account**: run against a real hobbyist key (see
      "To check on a real account"), compare with the Solcast toolkit and
      with Forecast.Solar on the same roof; turn the answers (anonymized)
      into fixtures.
- [ ] **Milestone 3 — more, within the budget**:
  - scene actions like Forecast.Solar: `get_forecast`,
    `get_production_next_hours`, `find_best_window` (best slot for an
    appliance of N hours, today or tomorrow) — computed from the stored
    forecast, no call;
  - dashboard widgets: the forecast curve with its P10–P90 band, and the
    best time slot;
  - an option "calls kept for the button" (today the plan spends all the
    calls and the button shares them);
  - estimated actuals (`/rooftop_sites/{id}/estimated_actuals`, one call per
    site): only as an option that takes its calls from the plan, e.g. one a
    day after sunset, to show "forecast vs estimated" for the day.
- [ ] **Milestone 4 — first release**: cover image, Docker image build check,
      `npx github:GladysAssistant/integration-store .`, Release workflow,
      topic, GHCR package public (ask Louis first: Solcast is not in the
      publish authorization of batches 1 and 2).

## To check on a real account

- `GET /rooftop_sites` with the Bearer header (Home Assistant sends
  `api_key=` in the query; the docs allow both for the forecasts): does it
  answer, with which fields, and does it really use no call?
- The forecast answer: legacy dates with seven decimals or version 3
  ("+00:00")? Does `hours=72` cut it (Home Assistant asks for 168)? One
  extra period at the end, like the HA simulator?
- Does Solcast count a busy 429 as a call? (Home Assistant's long practice:
  no; only answered forecasts count.) Does a 429 carry `Retry-After`?
- `X-RateLimit-Limit` / `X-RateLimit-Remaining` on the hobbyist answers:
  present, and about the daily window? (Used only to lower the calls left.)
- The 10/50 limit of the account: does a new account really get 10?
- An invalid key: 401 or 403? An unknown site: 404 `SiteNotFound`?
- Compare a day of P50 with the real production, and with Forecast.Solar.

## Decisions

- **Not a duplicate, a complement** (checked 2026-10-16): the Gladys core
  master (165e0d94, 2026-10-16, after 5.2.1) has no Solcast service
  (`server/services/*`: airplay … zwavejs-ui, and `git grep -i solcast` over
  the whole repository is empty). The main session checked the store index
  (405 entries), GitHub and the forum the same day: no Solcast. The store
  has prohand/gladys-forecastsolar (Forecast.Solar, free, no account, one
  plane, weather models, 12 requests per hour). This integration adds what
  Forecast.Solar does not: Solcast's satellite nowcasting, two roof planes
  and their total, and the P10–P90 range. It keeps Forecast.Solar's feature
  keys, names, units and trigger variables so both read the same on a
  dashboard; its downside is the 10 calls a day.
- **Solcast still opens free accounts** (2026-10-16): the "Home User"
  registration of toolkit.solcast.com.au ("designed for solar hobbyists at
  home who only need Rooftop PV Power forecasts", one residential location
  under 50 kW); the docs (Rooftop Sites (Hobbyist)) give 10 requests per UTC
  day, up to 2 rooftop sites within 1 km, 30-minute periods, personal use.
  Home Assistant's README: older hobbyist accounts kept 50 calls. Hence the
  `daily_limit` option (10 by default, 1 to 50).
- **Own client, no dependency** (Louis's rule: reuse maintained work, rewrite
  dead or debt-heavy code). The candidates, 2026-10-16:
  - npm `solcast` (0.0.6, 2017, MIT): dead, `nodemon` and `joi` 10 as
    runtime dependencies, no hobbyist endpoints;
  - npm `solcast-unofficial` (1.0.1, 2018, MIT, `unirest` 0.5): dead;
  - `@slates-integrations/solcast` (0.3.0, 2026-10, no licence field, `zod` +
    the `slates` framework), `@keystrokehq/solcast` (no licence, no
    description), `@pipedream/solcast`: pieces of their platforms for the
    commercial endpoints, not libraries;
  - Solcast's own SDKs are Python and C#, for the commercial API;
  - BJReplay/ha-solcast-solar (Python, Apache-2.0, very active: commit of
    2026-10-15), the Home Assistant integration (no Solcast in the HA core):
    the reference, read as documentation only.
    Two GET requests are needed: ~200 lines on `node:https`. Runtime
    dependencies: the SDK only.
- **Key in the Authorization header**, never in the URL: the docs accept
  `Authorization: Bearer <key>` or `api_key=`; the header keeps it out of
  logs and proxies.
- **No `format=json;version=3`**: the version suffix is documented for the
  commercial rooftop PV endpoints; on the hobbyist ones, a refused parameter
  could cost a call. Both date formats are parsed instead.
- **The budget** (src/budget.js): one counter per UTC day in `/data`,
  incremented and saved before each forecast request, given back when
  Solcast did not answer or answered an error (it counts the forecasts it
  sends; Home Assistant counts only answered calls), never given back for a
  200 whose body was unusable. Downloads only for the sites of the created
  devices (like Forecast.Solar: add only the houses with panels). The plan is
  memoryless (recomputed every minute from the stored forecast, the counter
  and the last download), so a restart, a manual refresh or another tool
  spending calls just respreads what is left: the first download when the
  production of the UTC day starts (or one less than an hour before counts
  as it), then `production left / (downloads left + 1)` apart, so the last
  one stays well before sunset; a per-installation delay of 2 to 10 minutes
  and a nudge 3 minutes after any quarter hour (Solcast is swamped then,
  Home Assistant's README). A site whose forecast ends within 24 h is
  downloaded as soon as a call allows. 20 minutes at least between two
  downloads of a site; 10 for the button.
- **429**: `TooManyRequests` / "daily limit" / `X-RateLimit-Remaining: 0` /
  402 = the limit is spent until midnight UTC (the counter is marked
  exhausted); any other 429 is a busy server (Home Assistant: "try again
  later", no call used) retried after 5, 10, 20, 40, 60 minutes or
  `Retry-After`. 401/403 stop everything until the configuration changes or
  the test button; 404 marks the site gone until the sites are read again.
- **Forecast storage**: each download replaces the stored periods from its
  first period on; the earlier ones (the morning) stay; yesterday is
  dropped. "Energy today" is published only when the whole day is known:
  covered from midnight, or from a dark period before the first production
  (a download before sunrise). Added during the day, a site shows it the
  next day; remaining and tomorrow are there at once. No guess.
- **Maths**: energies integrate the 30-minute averages exactly (kW × hours
  inside the range, so P10/P50/P90 totals equal the sums of Solcast);
  the power now interpolates linearly between the middles of the periods
  (smooth between two downloads; Home Assistant uses splines). The total
  device adds the sites period by period, only where both are known.
- **Features**: `energy-production-sensor` `power` (W) and
  `daily-production` (kWh), like Forecast.Solar. The core's energy
  monitoring only reads `energy-production-sensor` **`index`** (deltas into
  `thirty-minutes-production`, `server/services/energy-monitoring/utils/
constants.js`), so these forecasts are never counted as production. No
  `should_poll`: the app has its own minute tick (the SDK allows it).
- **Time zone**: Gladys starts the container with `TZ=<its timezone
variable>` (`externalIntegration.buildContainerDescriptor.js`); local days
  come from Intl with that zone, the budget day is UTC.
- **Scene events**: `forecast_updated` per created device whose sites were
  downloaded; production start/peak/end from the P50 profile of the local
  day, fired once a day when the minute tick passes them, never more than 5
  minutes late (restart, outage). Same variables for the four triggers:
  Forecast.Solar's (`power_now`, `energy_today`, `energy_remaining_today`,
  `energy_tomorrow`, `peak_power`, `peak_time`) plus their `_p10`/`_p90`,
  `site` (the Solcast site name, "A + B" for the total) and `calls_left`.
- **Estimated actuals left out** of milestone 1: one more call per site and
  day (Home Assistant's dampening uses them), taken from 5 downloads a day
  with two sites. See milestone 3.
