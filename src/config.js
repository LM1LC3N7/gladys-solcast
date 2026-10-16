// -----------------------------------------------------------------------------
// The configuration of the manifest `config_schema`, normalized.
// -----------------------------------------------------------------------------

import { createHash } from 'node:crypto';
import { DAILY_LIMIT } from './constants.js';

/** Defaults, mirrored by the manifest (checked by test/manifest.test.js). */
export const DEFAULTS = {
  daily_limit: DAILY_LIMIT.default,
  language: 'fr',
};

export const LANGUAGES = ['fr', 'en'];

/** The account the stored data belongs to, without keeping the key itself. */
export const accountKey = (apiKey) =>
  createHash('sha256').update(apiKey.trim()).digest('hex').slice(0, 16);

/** "id-1, id-2" or one per line -> the resource ids, in order, without duplicates. */
export function parseSiteIds(value) {
  const ids = String(value ?? '')
    .split(/[\s,;]+/)
    .map((id) => id.trim())
    .filter(Boolean);
  return [...new Set(ids)];
}

export function normalizeConfig(raw = {}) {
  const apiKey = String(raw?.api_key ?? '').trim();
  const given = raw?.daily_limit;
  const limit = given === undefined || given === null || given === '' ? NaN : Number(given);
  const language = String(raw?.language ?? DEFAULTS.language)
    .trim()
    .toLowerCase();
  return {
    apiKey,
    account: apiKey === '' ? '' : accountKey(apiKey),
    siteIds: parseSiteIds(raw?.sites),
    dailyLimit: Number.isFinite(limit)
      ? Math.round(Math.max(DAILY_LIMIT.min, Math.min(DAILY_LIMIT.max, limit)))
      : DEFAULTS.daily_limit,
    language: LANGUAGES.includes(language) ? language : DEFAULTS.language,
  };
}
