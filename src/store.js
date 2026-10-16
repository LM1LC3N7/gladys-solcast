// -----------------------------------------------------------------------------
// What must survive a restart, in /data (the only writable place of the
// container), so that a restart never spends a Solcast call again:
//   - the account the data belongs to (a hash of the API key);
//   - the calls made in the current UTC day, and whether Solcast said the
//     daily limit was reached;
//   - the forecast of each site (its periods, merged download after
//     download: the morning of today is only there) and when it came;
//   - the last failure, for the pause after it;
//   - the rooftop sites read last (free, but read once a day only);
//   - the delay of this installation after the planned times.
// -----------------------------------------------------------------------------

import { readFile, rename, writeFile } from 'node:fs/promises';
import { normalizePeriods } from './forecast.js';

export const STATE_FILE = '/data/solcast-state.json';

export function fileStore(path = STATE_FILE) {
  return {
    async load() {
      try {
        return JSON.parse(await readFile(path, 'utf8'));
      } catch {
        return null;
      }
    },
    async save(data) {
      const temporary = `${path}.tmp`;
      await writeFile(temporary, JSON.stringify(data), { mode: 0o600 });
      await rename(temporary, path);
    },
  };
}

const finite = (value) => (Number.isFinite(value) ? value : undefined);

function normalizeSites(raw) {
  if (!raw || !Array.isArray(raw.list) || !Number.isFinite(raw.at)) {
    return null;
  }
  const list = raw.list.filter((s) => typeof s?.id === 'string' && s.id !== '');
  return { at: raw.at, list: list.map((s) => ({ ...s, name: String(s.name ?? s.id) })) };
}

/** The persisted state, repaired. */
export function normalizeMemory(raw) {
  const forecasts = {};
  for (const [id, entry] of Object.entries(raw?.forecasts ?? {})) {
    const periods = normalizePeriods(entry?.periods);
    if (Number.isFinite(entry?.fetchedAt) && periods.length > 0) {
      forecasts[id] = { fetchedAt: entry.fetchedAt, periods };
    }
  }
  const usage = raw?.usage && typeof raw.usage === 'object' ? { ...raw.usage } : null;
  const attempt =
    Number.isFinite(raw?.attempt?.retryAt) && Number.isInteger(raw.attempt.failures)
      ? { retryAt: raw.attempt.retryAt, failures: raw.attempt.failures }
      : null;
  return {
    account: typeof raw?.account === 'string' && raw.account !== '' ? raw.account : null,
    offset: finite(raw?.offset) ?? null,
    usage,
    forecasts,
    attempt,
    sites: normalizeSites(raw?.sites),
  };
}
