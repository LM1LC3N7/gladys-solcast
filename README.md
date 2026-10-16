# gladys-solcast

[Gladys Assistant](https://gladysassistant.com) external integration for
**Solcast** rooftop PV forecasts, with a free Solcast home user (hobbyist)
account: estimated power now, energy today, remaining today and tomorrow,
each with its P10 and P90, for up to two rooftop sites and their total, and
scene triggers when a forecast arrives and when production starts, peaks
and ends. A complement to the
[Forecast.Solar](https://github.com/prohand/gladys-forecastsolar)
integration (same sensors and units, for side-by-side comparison), within the
10 API calls a day of a free account. Unofficial, not affiliated with
Solcast.

User documentation: [docs/en.md](docs/en.md) · [docs/fr.md](docs/fr.md).

> **Work in progress.** First version, tested with simulated answers, not yet
> with a real Solcast account. Not in the Gladys store yet: install it with
> **Install from GitHub** and `https://github.com/LM1LC3N7/gladys-solcast`.
> Feedback and bug reports are welcome in the
> [GitHub issues](https://github.com/LM1LC3N7/gladys-solcast/issues).

## How it works

```
Gladys ⇄ SDK ⇄ src/handlers.js ⇄ src/app.js (SolcastApp) ⇄ src/client.js ⇄ src/solcast.js ⇄ api.solcast.com.au
                                   ├─ src/budget.js     calls left today, when to download (pure)
                                   ├─ src/forecast.js   periods -> power, energies, day profile (pure)
                                   ├─ src/devices.js    -> Gladys devices and states (pure)
                                   ├─ src/events.js     production start, peak, end (pure)
                                   ├─ src/publisher.js  300 states/min, scene events queued
                                   └─ src/store.js      counter, forecasts, sites (/data)
```

- **Key**: the API key of the Solcast toolkit (`secret` field), sent as
  `Authorization: Bearer <key>`, never in a URL.
- **Sites**: `GET /rooftop_sites` (free: it uses no call of the daily
  limit), at start, once a day, on a scan (10 minutes apart at most) and on
  "Test the connection". One Gladys device per site,
  `ext:<selector>:site:<resource id>`, and with two sites their total,
  `ext:<selector>:total:all`. An optional list of resource ids restricts
  them.
- **Forecasts**: `GET /rooftop_sites/{resource_id}/forecasts?format=json&hours=72`,
  one call per site, only for the sites of the created devices. 30-minute
  periods of `pv_estimate`, `pv_estimate10`, `pv_estimate90` (kW, average
  over the period ending at `period_end`; both the legacy and the version 3
  date formats are read). Solcast sends the forecast from the current period
  on: the new periods replace the stored ones from their first one, the
  earlier periods of the day stay, so "energy today" keeps its morning.
- **Budget**: the calls are counted per UTC day in `/data` before each
  request (given back when Solcast did not answer or answered an error), so a
  restart never makes one more. The downloads are spread over the production
  hours left in the UTC day, read on the stored forecast: the first when
  production starts, then evenly (`production left / (downloads left + 1)`),
  shifted by a per-installation delay and away from the quarter hours. 2
  sites and 10 calls: 5 downloads a day; 1 site: 10. A 429 with
  `TooManyRequests` ("free daily limit") stops the downloads until midnight
  UTC; another 429 is a busy server (no call used): retries after 5, 10, 20,
  40, 60 minutes. `X-RateLimit-*` headers, when sent, can only lower the calls
  left.
- **Values**: recomputed every 5 minutes from the stored forecast. Energies
  integrate the period averages exactly; the power interpolates between the
  middles of the periods. Published through `publishChangedStates` (30-minute
  heartbeat). The features are `energy-production-sensor` `power` (W) and
  `daily-production` (kWh), like Forecast.Solar: the Gladys energy monitoring
  only reads production indexes, so a forecast is never counted.
- **Scene triggers**: `forecast_updated` after each download, and
  `production_started`, `production_peak`, `production_ended` when the clock
  passes the estimated times (once a day, not fired more than 5 minutes
  late), with the values, the peak and the calls left as variables.

## Development

```bash
npm install
npm test                                        # node --test, no network
npm run lint && npm run format:check
npm run audit
npx github:GladysAssistant/integration-store .  # store admission checks
```

`test/fixtures/solcast.js` builds answers shaped after the Solcast
documentation and the simulator of the Home Assistant integration (made-up
sites and values); `test/helpers/fakeSolcast.js` serves them behind the
transport, with the daily limit, busy answers and errors. The HTTPS transport
itself is tested against a loopback server.

## Credits

No maintained JavaScript client of the Solcast hobbyist API exists (see
[TODO.md](TODO.md), Decisions): the client is our own, on `node:https`,
written from:

- the [Solcast API documentation](https://docs.solcast.com.au) (Rooftop
  Sites (Hobbyist), Response formats, Errors);
- [BJReplay/ha-solcast-solar](https://github.com/BJReplay/ha-solcast-solar)
  (Apache-2.0), the Home Assistant integration, read as documentation: the
  sites listing that uses no call, the two kinds of 429, the busy quarter
  hours, the shape of the answers (its simulator);
- [prohand/gladys-forecastsolar](https://github.com/prohand/gladys-forecastsolar)
  (Apache-2.0), the Forecast.Solar integration for Gladys: the feature keys,
  names, categories and units, the scene triggers and their variables, kept
  the same on purpose; `nextDayKey` in `src/time.js` comes from its
  `src/forecast.js`.

## Releasing

**Actions → Release → Run workflow** (patch / minor / major): bumps the
version in `package.json` and the manifest, rolls `CHANGELOG.md`, tags, builds
the multi-arch image to GHCR and publishes the GitHub Release. The
`gladys-assistant-integration` topic, added at the first release, lists the
repository in the Gladys store.

## License

Apache-2.0. Solcast is a trademark of its owner; this project is not
affiliated with Solcast.
