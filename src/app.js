// -----------------------------------------------------------------------------
// The integration: the Solcast key and its rooftop sites, the forecast
// downloads within the daily limit, the values recomputed from the stored
// forecast, the Gladys devices and states, the scene events, the buttons and
// the badges. index.js only wires the SDK handlers to it.
//
// Every minute: the plan says whether a download is due (budget.js), the
// values are recomputed every 5 minutes from the stored forecast (the power
// follows the curve between two downloads), and the production events are
// checked. Only the sites of the devices created in Gladys are downloaded.
// -----------------------------------------------------------------------------

import { randomInt } from 'node:crypto';
import { DEVICE_TRANSPORTS, createLogger } from '@gladysassistant/integration-sdk';
import { backoffAfter, callsLeft, currentUsage, limitOf, planNext } from './budget.js';
import { SolcastClient } from './client.js';
import { normalizeConfig } from './config.js';
import { LIMITS, SCENE_TRIGGERS, TIMINGS } from './constants.js';
import { buildDevices, buildStates, siteIds, siteName, totalIds, totalName } from './devices.js';
import { productionEvents } from './events.js';
import { computeValues, dayProfile, mergePeriods, sumPeriods } from './forecast.js';
import { T } from './i18n.js';
import { StatePublisher } from './publisher.js';
import { ANSWERED, errorReason } from './solcast.js';
import { fileStore, normalizeMemory } from './store.js';
import { dayAndTime, dayOf, hhmm, resolveTimeZone, utcDayEnd } from './time.js';

const DAY = 24 * 3600_000;

const cut = (text, max = LIMITS.eventText) => (text.length > max ? text.slice(0, max) : text);

/** Failures meaning Solcast could not be reached at all. */
const OFFLINE = new Set(['network', 'timeout', 'unavailable']);

export class SolcastApp {
  constructor({
    gladys,
    logger = createLogger({ name: 'solcast' }),
    transport,
    now = Date.now,
    timers = globalThis,
    store = fileStore(),
    timeZone = resolveTimeZone(process.env.TZ),
    random = randomInt,
    userAgent,
  }) {
    this.gladys = gladys;
    this.logger = logger;
    this.now = now;
    this.timers = timers;
    this.store = store;
    this.timeZone = timeZone;
    this.random = random;
    this.client = new SolcastClient({ transport, userAgent, now });
    this.publisher = new StatePublisher({ gladys, logger, now, timers });
    this.config = normalizeConfig();
    this.memory = normalizeMemory(null);
    /** The rooftop sites in use (the configured ones among those of the key). */
    this.sites = [];
    /** The last failed read of the sites, and when to read them again. */
    this.sitesError = undefined;
    this.sitesRetryAt = 0;
    /** Sites Solcast answered 404 for, until the sites are read again. */
    this.gone = new Set();
    /** The last failed download, until a download succeeds. */
    this.lastFailure = undefined;
    /** deviceId -> the values last computed */
    this.values = new Map();
    /** deviceId -> Set of `<day>:<event key>` already fired */
    this.fired = new Map();
    this.lastComputeAt = -Infinity;
    this.lastEventCheck = 0;
    this.lastTestAt = -Infinity;
    this.published = undefined;
    /** deviceId -> badge last published (JSON) */
    this.transports = new Map();
    this.timer = undefined;
    this.running = undefined;
    this.generation = 0;
    this.refused = false;
    this.started = false;
    this.lastStatus = undefined;
  }

  // --- Lifecycle -------------------------------------------------------------

  async start(raw = {}) {
    this.stop();
    await this.running;
    this.config = normalizeConfig(raw);
    this.reset();
    const memory = normalizeMemory(await this.store.load().catch(() => null));
    const { account } = this.config;
    // Another key is another account: its calls, sites and forecasts are not these.
    this.memory =
      account === '' || memory.account === account
        ? memory
        : { ...normalizeMemory(null), account, offset: memory.offset };
    if (this.memory.offset === null) {
      this.memory.offset = this.random(TIMINGS.offset.min, TIMINGS.offset.max);
    }
    await this.saveMemory();
    this.client.configure({ apiKey: this.config.apiKey });
    this.publisher.start();
    if (!this.client.hasKey) {
      await this.setStatus(false, T.noKey);
      return;
    }
    this.useSites(this.memory.sites?.list ?? []);
    if (this.sites.length === 0) {
      await this.setStatus(false, T.connecting);
    }
    this.lastEventCheck = this.now();
    this.schedule();
    await this.tick();
  }

  stop() {
    this.generation += 1;
    if (this.timer) {
      this.timers.clearInterval(this.timer);
      this.timer = undefined;
    }
    this.publisher.stop();
  }

  /** Forgets what belonged to the previous configuration. */
  reset() {
    this.sites = [];
    this.sitesError = undefined;
    this.sitesRetryAt = 0;
    this.gone.clear();
    this.lastFailure = undefined;
    this.values.clear();
    this.fired.clear();
    this.lastComputeAt = -Infinity;
    this.lastTestAt = -Infinity;
    this.published = undefined;
    this.transports.clear();
    this.refused = false;
  }

  schedule() {
    if (this.timer) {
      this.timers.clearInterval(this.timer);
    }
    this.timer = this.timers.setInterval(() => {
      this.tick().catch((err) => this.logger.error(`Solcast refresh failed: ${err.message}`));
    }, TIMINGS.tick);
  }

  /**
   * Connected to Gladys. The first time, start; after a reconnection (Gladys
   * restarted), resend what Gladys keeps in memory only (Discovery list,
   * status, badges), without any Solcast call.
   */
  async connected(raw = {}) {
    if (!this.started) {
      this.started = true;
      await this.start(raw);
      return;
    }
    await this.configUpdated(raw);
    this.published = undefined;
    this.transports.clear();
    const status = this.lastStatus;
    this.lastStatus = undefined;
    if (status) {
      const [connected, message] = JSON.parse(status);
      await this.setStatus(connected, message ?? undefined);
    }
    await this.publishDevices();
    await this.publishAllTransports();
  }

  /** A new key or new sites restart; a new limit replans; a new language renames. */
  async configUpdated(raw = {}) {
    const next = normalizeConfig(raw);
    const previous = this.config;
    if (next.apiKey !== previous.apiKey || next.siteIds.join() !== previous.siteIds.join()) {
      return this.start(raw);
    }
    this.config = next;
    if (next.language !== previous.language) {
      await this.publishDevices();
    }
    if (next.dailyLimit !== previous.dailyLimit) {
      await this.tick();
    }
  }

  async setStatus(connected, message) {
    const key = JSON.stringify([connected, message ?? null]);
    if (key === this.lastStatus) {
      return;
    }
    this.lastStatus = key;
    await this.gladys
      .setConnectionStatus(connected, message)
      .catch((err) => this.logger.warn(`setConnectionStatus failed: ${err.message}`));
  }

  async saveMemory() {
    await this.store
      .save(this.memory)
      .catch((err) => this.logger.warn(`Saving the state to /data failed: ${err.message}`));
  }

  // --- Budget ----------------------------------------------------------------

  get usage() {
    return currentUsage(this.memory.usage, this.now());
  }

  get left() {
    return callsLeft(this.usage, this.config.dailyLimit);
  }

  get limit() {
    return limitOf(this.usage, this.config.dailyLimit);
  }

  plan(now = this.now(), left = this.left) {
    return planNext({
      now,
      sites: this.neededSites(),
      forecasts: this.memory.forecasts,
      left,
      attempt: this.memory.attempt,
      offset: this.memory.offset ?? 0,
    });
  }

  /**
   * The next download for a status message: a time, or "after the UTC
   * midnight" when the limit is spent. At night, the plan of the next UTC
   * day tells the time.
   */
  nextOf(plan = this.plan()) {
    if (plan.at === Infinity) {
      return { kind: 'none' };
    }
    const now = this.now();
    const dayEnd = utcDayEnd(now);
    if (plan.reason === 'budget' && this.usage.exhausted) {
      return { kind: 'reset', time: hhmm(dayEnd, this.timeZone) };
    }
    let at = Math.max(plan.at, now);
    if (at >= dayEnd) {
      at = Math.max(this.plan(at, this.config.dailyLimit).at, at);
    }
    return { kind: 'at', time: hhmm(at, this.timeZone) };
  }

  // --- Sites -----------------------------------------------------------------

  /** The sites in use: the configured resource ids among the sites, or all of them. */
  useSites(list) {
    const wanted = this.config.siteIds;
    this.sites = wanted.length === 0 ? list : list.filter((site) => wanted.includes(site.id));
  }

  /** Reads the sites of the key (free) when the stored list is older than `maxAge`. */
  async readSites({ maxAge }) {
    const now = this.now();
    const stored = this.memory.sites;
    if (stored && now - stored.at < maxAge) {
      this.useSites(stored.list);
      return;
    }
    try {
      const list = await this.client.sites();
      this.memory.sites = { at: this.now(), list };
      // The forecasts of the sites removed from the account are of no use.
      const ids = new Set(list.map((site) => site.id));
      for (const id of Object.keys(this.memory.forecasts)) {
        if (!ids.has(id)) {
          delete this.memory.forecasts[id];
        }
      }
      this.gone.clear();
      this.sitesError = undefined;
      this.useSites(list);
      await this.saveMemory();
    } catch (err) {
      if (err.kind === 'refused') {
        this.refused = true;
        this.logger.warn(`Solcast refused the API key: ${errorReason(err)}`);
        return;
      }
      this.sitesError = err;
      this.sitesRetryAt = now + TIMINGS.scanSites;
      this.logger.warn(`Reading the Solcast sites failed: ${errorReason(err)}`);
      if (!stored && this.config.siteIds.length > 0) {
        // The forecasts only need the resource ids.
        this.useSites(this.config.siteIds.map((id) => ({ id, name: id })));
      }
    }
  }

  sitesDue() {
    const stored = this.memory.sites;
    return (
      this.now() >= this.sitesRetryAt && (!stored || this.now() - stored.at >= TIMINGS.sitesMaxAge)
    );
  }

  /** The created devices of the sites in use: { externalId, ids, name, label, siteIds }. */
  createdDevices() {
    const created = new Set((this.gladys.devices ?? []).map((d) => d.external_id));
    const known = this.sites.filter((s) => !this.gone.has(s.id));
    const devices = [];
    for (const site of known) {
      const ids = siteIds(this.gladys, site.id);
      if (created.has(ids.device)) {
        devices.push({
          externalId: ids.device,
          ids,
          name: siteName(site, this.config.language),
          label: site.name,
          siteIds: [site.id],
        });
      }
    }
    const total = totalIds(this.gladys);
    if (this.sites.length >= 2 && created.has(total.device) && known.length > 0) {
      devices.push({
        externalId: total.device,
        ids: total,
        name: totalName(this.config.language),
        label: known.map((s) => s.name).join(' + '),
        siteIds: known.map((s) => s.id),
      });
    }
    return devices;
  }

  /** The sites to download: those of the created devices. */
  neededSites() {
    const ids = new Set(this.createdDevices().flatMap((d) => d.siteIds));
    return this.sites.map((s) => s.id).filter((id) => ids.has(id));
  }

  periodsOf(device) {
    const list = device.siteIds.map((id) => this.memory.forecasts[id]?.periods ?? []);
    return sumPeriods(list);
  }

  // --- Ticks -----------------------------------------------------------------

  /** One run at a time: a tick during a run joins it. */
  tick() {
    if (!this.running) {
      this.running = this.run().finally(() => {
        this.running = undefined;
      });
    }
    return this.running;
  }

  /** Runs `fn` alone, after the run in progress. */
  async exclusive(fn) {
    while (this.running) {
      await this.running;
    }
    this.running = fn().finally(() => {
      this.running = undefined;
    });
    return this.running;
  }

  async run() {
    const generation = this.generation;
    if (!this.client.hasKey) {
      return;
    }
    if (!this.refused && this.sitesDue()) {
      await this.readSites({ maxAge: TIMINGS.sitesMaxAge });
      if (generation !== this.generation) {
        return;
      }
    }
    await this.publishDevices();
    if (!this.refused && this.now() >= this.plan().at) {
      await this.download(this.dueSites());
      if (generation !== this.generation) {
        return;
      }
    }
    this.recompute();
    this.checkEvents();
    await this.publishAllTransports();
    await this.updateStatus();
    await this.publisher
      .flush()
      .catch((err) => this.logger.warn(`Sending to Gladys failed: ${err.message}`));
  }

  /** The needed sites, the least recently downloaded first, none twice within 20 minutes. */
  dueSites(gap = TIMINGS.minGap) {
    const now = this.now();
    const fetchedAt = (id) => this.memory.forecasts[id]?.fetchedAt ?? -Infinity;
    return this.neededSites()
      .filter((id) => now - fetchedAt(id) >= gap)
      .sort((a, b) => fetchedAt(a) - fetchedAt(b));
  }

  /**
   * Downloads the forecast of the sites, one call each, while calls are
   * left. A call is counted in /data before its request: a restart during
   * it never gives it back. It is given back when Solcast did not answer, or
   * answered an error (Solcast counts the forecasts it sends).
   */
  async download(ids) {
    const fetched = [];
    let failure;
    for (const id of ids) {
      const usage = this.usage;
      if (callsLeft(usage, this.config.dailyLimit) <= 0) {
        break;
      }
      this.memory.usage = { ...usage, used: usage.used + 1 };
      await this.saveMemory();
      try {
        const { periods, rateLimit } = await this.client.forecasts(id);
        this.storeForecast(id, periods);
        this.syncRateLimit(rateLimit);
        this.memory.attempt = null;
        this.lastFailure = undefined;
        fetched.push(id);
        this.logger.info(`Solcast forecast of ${id}: ${periods.length} periods`);
      } catch (err) {
        failure = err;
        if (!ANSWERED.has(err.kind)) {
          const current = this.usage;
          this.memory.usage = { ...current, used: Math.max(0, current.used - 1) };
        }
        this.downloadFailed(id, err);
      }
      await this.saveMemory();
      if (failure && failure.kind !== 'not_found') {
        break;
      }
    }
    if (fetched.length > 0) {
      this.recompute({ force: true });
      for (const device of this.createdDevices()) {
        if (device.siteIds.some((id) => fetched.includes(id))) {
          this.publisher.pushSceneEvent(SCENE_TRIGGERS.FORECAST_UPDATED, this.eventData(device));
        }
      }
    }
    return { fetched, failure };
  }

  storeForecast(id, periods) {
    const now = this.now();
    const keepFrom = dayOf(now, this.timeZone).start - DAY;
    const stored = this.memory.forecasts[id]?.periods ?? [];
    this.memory.forecasts[id] = {
      fetchedAt: now,
      periods: mergePeriods(stored, periods, keepFrom),
    };
  }

  /** The X-RateLimit-* headers, when Solcast sends them, correct the counter. */
  syncRateLimit({ limit, remaining }) {
    const usage = { ...this.usage };
    if (limit !== undefined) {
      usage.limit = limit;
    }
    if (remaining !== undefined) {
      usage.used = Math.max(usage.used, limitOf(usage, this.config.dailyLimit) - remaining);
    }
    this.memory.usage = usage;
  }

  downloadFailed(id, err) {
    const reason = errorReason(err);
    if (err.kind === 'exhausted') {
      this.memory.usage = { ...this.usage, exhausted: true };
      this.logger.warn(`Solcast daily limit reached: no download until midnight UTC (${reason})`);
    } else if (err.kind === 'refused') {
      this.refused = true;
      this.logger.warn(`Solcast refused the API key: ${reason}`);
    } else if (err.kind === 'not_found') {
      this.gone.add(id);
      this.logger.warn(`Solcast does not know the site ${id}: ${reason}`);
    } else {
      const failures = (this.memory.attempt?.failures ?? 0) + 1;
      const wait = Math.max(backoffAfter(failures), err.retryAfter ?? 0);
      this.memory.attempt = { retryAt: this.now() + wait, failures };
      this.logger.warn(
        `Solcast forecast of ${id}: ${reason}; next try in ${Math.round(wait / 60_000)} min`,
      );
    }
    this.lastFailure = err;
  }

  // --- Values and events -----------------------------------------------------

  /** Recomputes the values of the created devices (every 5 minutes, or now). */
  recompute({ force = false } = {}) {
    const now = this.now();
    if (!force && now - this.lastComputeAt < TIMINGS.recompute) {
      return;
    }
    this.lastComputeAt = now;
    for (const device of this.createdDevices()) {
      const values = computeValues(this.periodsOf(device), now, this.timeZone);
      this.values.set(device.externalId, values);
      for (const { device_feature_external_id: id, ...value } of buildStates(device.ids, values)) {
        this.publisher.push(id, value);
      }
    }
  }

  /** The variables of the scene events of a device (flat, as Gladys wants them). */
  eventData(device) {
    const now = this.now();
    const periods = this.periodsOf(device);
    const values = computeValues(periods, now, this.timeZone);
    const profile = dayProfile(periods, dayOf(now, this.timeZone));
    const pick = (value, estimate) => (value ? value[estimate] : null);
    const data = { device: device.externalId, site: cut(device.label) };
    for (const [key, value] of [
      ['power_now', values.power],
      ['energy_today', values.today],
      ['energy_remaining_today', values.remaining],
      ['energy_tomorrow', values.tomorrow],
    ]) {
      data[key] = pick(value, 'p50');
      data[`${key}_p10`] = pick(value, 'p10');
      data[`${key}_p90`] = pick(value, 'p90');
    }
    data.peak_power = profile.peakPower;
    data.peak_time = profile.peakTime === null ? null : hhmm(profile.peakTime, this.timeZone);
    data.calls_left = this.left;
    return data;
  }

  /** The production start, peak and end passed since the previous check. */
  checkEvents() {
    const now = this.now();
    const since = this.lastEventCheck;
    this.lastEventCheck = now;
    const day = dayOf(now, this.timeZone);
    for (const device of this.createdDevices()) {
      let fired = this.fired.get(device.externalId);
      if (!fired) {
        fired = new Set();
        this.fired.set(device.externalId, fired);
      }
      for (const id of fired) {
        if (!id.startsWith(`${day.key}:`)) {
          fired.delete(id);
        }
      }
      const profile = dayProfile(this.periodsOf(device), day);
      for (const event of productionEvents(profile, { since, now, day: day.key, fired })) {
        this.logger.info(`${device.name}: ${event.key}`);
        this.publisher.pushSceneEvent(event.key, this.eventData(device));
      }
    }
  }

  // --- Gladys ----------------------------------------------------------------

  async publishDevices() {
    if (!this.client.hasKey || this.refused) {
      return;
    }
    const devices = buildDevices(this.gladys, this.sites, this.config.language);
    const json = JSON.stringify(devices);
    if (json === this.published) {
      return;
    }
    try {
      await this.gladys.publishDiscoveredDevices(devices);
      this.published = json;
    } catch (err) {
      this.logger.warn(`Publishing the discovered devices failed: ${err.message}`);
    }
  }

  badge(device) {
    if (this.refused) {
      return { transport: DEVICE_TRANSPORTS.UNREACHABLE };
    }
    const fetchedAt = Math.min(
      ...device.siteIds.map((id) => this.memory.forecasts[id]?.fetchedAt ?? Infinity),
    );
    if (Number.isFinite(fetchedAt) && this.now() - fetchedAt > TIMINGS.staleAfter) {
      return {
        transport: DEVICE_TRANSPORTS.CLOUD,
        degraded: true,
        message: T.stale(dayAndTime(fetchedAt, this.timeZone)),
      };
    }
    return { transport: DEVICE_TRANSPORTS.CLOUD };
  }

  async publishAllTransports() {
    const entries = [];
    for (const device of this.createdDevices()) {
      const entry = { external_id: device.externalId, ...this.badge(device) };
      const json = JSON.stringify(entry);
      if (this.transports.get(device.externalId) !== json) {
        this.transports.set(device.externalId, json);
        entries.push(entry);
      }
    }
    if (entries.length > 0) {
      await this.gladys
        .publishTransports(entries)
        .catch((err) => this.logger.warn(`Transport badges failed: ${err.message}`));
    }
  }

  /** A device was created (or updated): its values now, and its first download if due. */
  async deviceCreated(device) {
    this.transports.delete(device?.external_id);
    this.fired.delete(device?.external_id);
    this.lastComputeAt = -Infinity;
    // A run of its own: one in progress planned without this device.
    await this.exclusive(() => this.run());
  }

  async deviceDeleted(device) {
    const id = device?.external_id;
    this.transports.delete(id);
    this.values.delete(id);
    this.fired.delete(id);
    if (id) {
      this.publisher.forget(id);
    }
  }

  /** The Discovery tab asks for a scan: the sites again (free) if read 10 minutes ago. */
  async scan() {
    if (this.client.hasKey && !this.refused) {
      await this.exclusive(async () => {
        await this.readSites({ maxAge: TIMINGS.scanSites });
        await this.publishDevices();
        await this.updateStatus();
      });
    }
  }

  // --- Status ----------------------------------------------------------------

  async updateStatus() {
    if (!this.client.hasKey) {
      await this.setStatus(false, T.noKey);
      return;
    }
    if (this.refused) {
      await this.setStatus(false, T.refused);
      return;
    }
    if (this.sites.length === 0) {
      if (this.sitesError) {
        await this.setStatus(false, T.sitesUnreachable(errorReason(this.sitesError)));
      } else if (this.config.siteIds.length > 0 && this.memory.sites?.list.length > 0) {
        await this.setStatus(false, T.unknownSites(this.config.siteIds));
      } else {
        await this.setStatus(false, T.noSites);
      }
      return;
    }
    const gone = this.sites.find((s) => this.gone.has(s.id));
    if (gone) {
      await this.setStatus(true, T.notFound(gone.name));
      return;
    }
    const needed = this.neededSites();
    if (needed.length === 0) {
      await this.setStatus(true, T.discover(this.sites.length));
      return;
    }
    const next = this.nextOf();
    const counts = { left: this.left, limit: this.limit };
    if (this.usage.exhausted) {
      await this.setStatus(true, T.exhausted(next));
      return;
    }
    const failure = this.lastFailure;
    if (failure?.kind === 'busy') {
      await this.setStatus(true, T.busy(next));
      return;
    }
    if (failure && OFFLINE.has(failure.kind)) {
      await this.setStatus(false, T.unreachable(errorReason(failure), next));
      return;
    }
    const newest = Math.max(
      ...needed.map((id) => this.memory.forecasts[id]?.fetchedAt ?? -Infinity),
    );
    await this.setStatus(
      true,
      T.status({
        forecastAt: Number.isFinite(newest) ? hhmm(newest, this.timeZone) : null,
        sites: needed.length,
        next,
        ...counts,
      }),
    );
  }

  // --- Buttons ---------------------------------------------------------------

  /** "Test the connection": the sites of the key (free) and the calls left. */
  async testConnection() {
    if (!this.client.hasKey) {
      return T.noKey;
    }
    const recent = this.now() - this.lastTestAt < TIMINGS.testCooldown;
    if (!recent) {
      this.lastTestAt = this.now();
      // The button is how a refused key is tried again.
      this.refused = false;
      await this.exclusive(async () => {
        await this.readSites({ maxAge: 0 });
        await this.publishDevices();
        await this.updateStatus();
      });
    }
    if (this.refused) {
      return T.refused;
    }
    if (this.sites.length === 0) {
      const [, message] = JSON.parse(this.lastStatus ?? '[false,null]');
      return message ?? T.noSites;
    }
    const summary = T.test.summary({
      sites: this.sites,
      next: this.nextOf(),
      left: this.left,
      limit: this.limit,
    });
    if (!recent) {
      return summary;
    }
    return {
      en: `${T.test.cooldown.en} ${summary.en}`,
      fr: `${T.test.cooldown.fr} ${summary.fr}`,
    };
  }

  /** "Refresh the forecast now": within the calls left, never twice within 10 minutes. */
  async refreshForecast() {
    if (!this.client.hasKey) {
      return T.noKey;
    }
    if (this.refused) {
      this.refused = false;
      await this.exclusive(() => this.readSites({ maxAge: 0 }));
      if (this.refused) {
        await this.updateStatus();
        return T.refused;
      }
    }
    return this.exclusive(async () => {
      const needed = this.neededSites();
      if (needed.length === 0) {
        return T.refresh.noDevice;
      }
      const counts = () => ({ left: this.left, limit: this.limit });
      const due = this.dueSites(TIMINGS.manualCooldown);
      if (due.length === 0) {
        const newest = Math.max(...needed.map((id) => this.memory.forecasts[id].fetchedAt));
        const minutes = Math.max(1, Math.round((this.now() - newest) / 60_000));
        return T.refresh.cooldown(minutes, counts());
      }
      if (this.left === 0) {
        const time = hhmm(utcDayEnd(this.now()), this.timeZone);
        return T.refresh.noCall({ kind: 'reset', time }, counts());
      }
      const { fetched, failure } = await this.download(due);
      this.checkEvents();
      await this.publishAllTransports();
      await this.updateStatus();
      await this.publisher
        .flush()
        .catch((err) => this.logger.warn(`Sending to Gladys failed: ${err.message}`));
      if (fetched.length === 0) {
        if (failure?.kind === 'exhausted') {
          const time = hhmm(utcDayEnd(this.now()), this.timeZone);
          return T.refresh.noCall({ kind: 'reset', time }, counts());
        }
        if (failure?.kind === 'refused') {
          return T.refused;
        }
        return T.refresh.failed(errorReason(failure), counts());
      }
      const periods = sumPeriods(needed.map((id) => this.memory.forecasts[id]?.periods ?? []));
      const values = computeValues(periods, this.now(), this.timeZone);
      return T.refresh.done({
        sites: fetched.length,
        calls: fetched.length,
        today: values.today,
        tomorrow: values.tomorrow,
        next: this.nextOf(),
        ...counts(),
      });
    });
  }
}
