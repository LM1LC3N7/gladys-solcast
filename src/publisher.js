// -----------------------------------------------------------------------------
// What goes to Gladys, within its limits: 300 states and 300 scene events per
// minute.
//
// - push(): the current value of a feature. The last one wins; unchanged
//   values are skipped by publishChangedStates and sent again every 30
//   minutes (the heartbeat), so a forecast recomputed every 5 minutes only
//   sends what moved.
// - pushSceneEvent(): a scene trigger. Queued and all sent, never merged.
// Everything left over (budget spent, Gladys unreachable) waits for the next
// flush, every 5 seconds.
// -----------------------------------------------------------------------------

import { LIMITS, TIMINGS } from './constants.js';

const MINUTE = 60_000;

/**
 * Gladys refused the event itself (undeclared key, invalid data, the SDK's own
 * check before any request): retrying will not help.
 */
const refusedForGood = (err) =>
  (err?.status !== undefined && err.status !== 429 && err.status < 500) ||
  /^publishSceneEvent:/.test(String(err?.message));

export class StatePublisher {
  constructor({
    gladys,
    logger,
    now = Date.now,
    timers = globalThis,
    statesPerMinute = LIMITS.statesPerMinute,
    sceneEventsPerMinute = LIMITS.sceneEventsPerMinute,
  }) {
    this.gladys = gladys;
    this.logger = logger;
    this.now = now;
    this.timers = timers;
    this.statesPerMinute = statesPerMinute;
    this.sceneEventsPerMinute = sceneEventsPerMinute;
    /** featureId -> { state } */
    this.pending = new Map();
    /** Scene events, in order: { key, data }. */
    this.sceneEvents = [];
    /** Send times of the last minute. */
    this.stateWindow = [];
    this.sceneWindow = [];
    this.timer = undefined;
    this.flushing = undefined;
  }

  start() {
    this.stop();
    this.timer = this.timers.setInterval(() => {
      this.flush().catch((err) => this.logger.warn(`Sending to Gladys failed: ${err.message}`));
    }, TIMINGS.flushInterval);
  }

  stop() {
    if (this.timer) {
      this.timers.clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  push(featureId, value) {
    this.pending.set(featureId, value);
  }

  pushSceneEvent(key, data) {
    this.sceneEvents.push({ key, data });
    if (this.sceneEvents.length > LIMITS.queuedEvents) {
      this.sceneEvents.shift();
    }
  }

  /** Forgets what is pending for a device (deleted): `ext:…:site:x` and its features. */
  forget(deviceId) {
    for (const id of [...this.pending.keys()]) {
      if (id === deviceId || id.startsWith(`${deviceId}:`)) {
        this.pending.delete(id);
      }
    }
  }

  flush() {
    if (!this.flushing) {
      this.flushing = this.doFlush().finally(() => {
        this.flushing = undefined;
      });
    }
    return this.flushing;
  }

  async doFlush() {
    await this.flushSceneEvents();
    await this.flushStates();
  }

  async flushSceneEvents() {
    const now = this.now();
    this.sceneWindow = this.sceneWindow.filter((t) => now - t < MINUTE);
    while (this.sceneEvents.length > 0 && this.sceneWindow.length < this.sceneEventsPerMinute) {
      const { key, data } = this.sceneEvents[0];
      try {
        await this.gladys.publishSceneEvent(key, data);
      } catch (err) {
        if (!refusedForGood(err)) {
          throw err;
        }
        this.logger.warn(`Gladys refused the scene event ${key}: ${err.message}`);
      }
      this.sceneEvents.shift();
      this.sceneWindow.push(now);
    }
  }

  async flushStates() {
    const now = this.now();
    this.stateWindow = this.stateWindow.filter((t) => now - t < MINUTE);
    const room = Math.min(this.statesPerMinute - this.stateWindow.length, this.pending.size);
    if (room <= 0) {
      return;
    }
    const batch = [];
    for (const [featureId, value] of this.pending) {
      if (batch.length >= room) {
        break;
      }
      this.pending.delete(featureId);
      batch.push({ device_feature_external_id: featureId, ...value });
    }
    try {
      const result = await this.gladys.publishChangedStates(batch, {
        heartbeat: TIMINGS.stateHeartbeat,
      });
      for (let i = 0; i < (result?.count ?? batch.length); i += 1) {
        this.stateWindow.push(now);
      }
    } catch (err) {
      // Kept for the next round, unless a newer value arrived meanwhile.
      for (const { device_feature_external_id: id, ...value } of batch) {
        if (!this.pending.has(id)) {
          this.pending.set(id, value);
        }
      }
      throw err;
    }
  }
}
