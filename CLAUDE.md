# CLAUDE.md

Project rules for coding assistants (Claude Code reads this file) and for
human contributors. Read **[TODO.md](./TODO.md) first**: status, decisions
already taken and the next milestones.

## What this is

A Gladys Assistant **external integration** of type `device`: a Node.js
service (Node 22+, ESM, no build step) in its own sandboxed Docker container,
talking to Gladys through `@gladysassistant/integration-sdk` (v0.15), its only
runtime dependency (HTTPS goes through `node:https`). It reads the rooftop
sites of a free Solcast home user (hobbyist) API key, downloads their PV
forecasts within the 10 calls per UTC day of the account, keeps them in
`/data`, and publishes, per site and for their total, the estimated power
now and the energy today, remaining today and tomorrow with their P10 and
P90, plus scene events. A complement to the Forecast.Solar integration, with
the same feature keys and units. Unofficial, not affiliated with Solcast.

## Commands

```bash
npm install
npm test                                  # node --test, the built-in runner
node --test test/app.test.js              # one file
npm run lint                              # ESLint
npm run format:check                      # Prettier, as the CI runs it
npm run format                            # Prettier, fix in place
npm run audit                             # npm audit --omit=dev
npx github:GladysAssistant/integration-store .   # store admission checks
```

Run `format:check`, `lint`, `test` and `audit` before every commit.

## Architecture

```
index.js            SDK bootstrap only (TZ: the time zone of Gladys)
src/handlers.js     every SDK handler -> the app (shared with the tests)
src/app.js          SolcastApp: the minute tick, downloads and the call counter,
                    values, scene events, badges, status, the two buttons
src/budget.js       calls left in the UTC day, when to download next (pure)
src/forecast.js     Solcast periods: parse, merge, energies, power, profile (pure)
src/devices.js      sites -> Gladys devices and states (pure)
src/events.js       production start, peak and end crossings (pure)
src/publisher.js    states within 300/min (publishChangedStates), scene events queued
src/client.js       the two Solcast calls: GET /rooftop_sites, GET .../forecasts
src/solcast.js      the only network access (node:https, settles once), errors
src/store.js        /data/solcast-state.json: counter, forecasts, sites, offset
src/time.js         local days of the Gladys time zone, the UTC day (pure)
src/config.js       config_schema normalized, account key (hash of the API key)
src/constants.js    API host and paths, manifest keys, limits, timings
src/i18n.js         runtime texts, device and feature names (en/fr)
test/fixtures/      answers shaped after the Solcast docs and the HA simulator
test/helpers/       a fake Solcast behind the transport; Gladys is the SDK's fake
```

## Rules

- **The daily limit is the whole point.** 10 forecast calls per UTC day for
  the whole account (all sites), a 429 "TooManyRequests" past it. Every
  forecast request goes through `SolcastApp.download()`, which counts it in
  `/data` before sending it; never add a forecast request anywhere else, and
  never download a site without a created device. Listing the sites is free,
  but keep it rare (start, once a day, scan, test button).
- **External ids are forever**: device = `site:<resource id>` or `total:all`,
  feature = `<device>:<key>` with the keys of Forecast.Solar (`power-now`,
  `energy-today`, `energy-remaining-today`, `energy-tomorrow`) and their
  `-p10` / `-p90`. Never change how they are built.
- Manifest keys (`api_key`, `sites`, `daily_limit`, `language`,
  `test_connection`, `refresh_forecast`, the four scene triggers and their
  fields and variables) are frozen: users store them in scenes.
- Values: energies in kWh (2 decimals), power in W (integer), P50 unsuffixed.
  A value the stored forecast does not cover is not published (null in the
  scene variables), never 0. Never publish a production `index` or
  `thirty-minutes-production`: the energy monitoring would count a forecast.
- "Today" is the local day of `TZ` (given by Gladys); the limit resets at
  midnight UTC. Keep the two apart (`src/time.js`).
- Never log or put in a status message the API key: it only travels in the
  Authorization header.
- Container limits: 256 MB RAM, 0.5 CPU, read-only rootfs, only `/data`
  writable, bridge network. Gladys rate limits: 300 states/min, 300 scene
  events/min.
- Tests never touch the network: the transport is injected
  (`test/solcast.test.js` uses a loopback server for the real one).
- Code, comments, README in English; `docs/en.md` and `docs/fr.md` kept in sync.
- Every user-visible change adds a line under `## [Unreleased]` in
  `CHANGELOG.md`; versions belong to the Release workflow.
