# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

### Added

- Solcast home user (hobbyist) account: the API key of the Solcast toolkit,
  and its rooftop sites read without using any call of the daily limit
  (optionally restricted to some resource ids).
- One device per rooftop site, and one for the total of two sites: estimated
  power now, energy today, remaining today and tomorrow, each with its P10
  and P90, with the names and units of the Forecast.Solar integration. They
  are forecasts: the energy monitoring does not count them.
- The 10 forecast calls per UTC day (configurable, 50 for some older
  accounts) spread over the daylight hours: 5 downloads a day with two sites,
  10 with one; only the added sites are downloaded; the calls are counted
  across restarts.
- The forecasts kept in `/data` (the morning of today included) and the
  values recomputed every 5 minutes between two downloads, sent when they
  change or every 30 minutes.
- Pauses when Solcast is busy (no call used) and until midnight UTC when the
  daily limit is reached; cloud badges marked degraded when the forecast is
  more than 26 hours old.
- Scene triggers "Solar forecast updated", "Solar production starts",
  "Solar production peak" and "Solar production ends", with the values, the
  peak and the calls left.
- "Test the connection" (no call used) and "Refresh the forecast now"
  buttons, both telling the calls left today.
- Device and feature names in French or English.

[Unreleased]: https://github.com/LM1LC3N7/gladys-solcast/commits/main
