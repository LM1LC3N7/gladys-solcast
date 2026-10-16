// -----------------------------------------------------------------------------
// The rooftop sites -> Gladys devices, and their states (pure).
//
// One device per Solcast rooftop site, `ext:<selector>:site:<resource id>`,
// and, with two sites or more, one for their total, `ext:<selector>:total:all`.
// The features mirror the Forecast.Solar integration (same keys, names,
// categories and units), so both can be compared side by side, plus the P10
// and P90 of each value. They are `energy-production-sensor` power and
// daily-production features: the Gladys energy monitoring only reads
// production indexes, so a forecast is never counted as a production.
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES as C,
  DEVICE_FEATURE_TYPES as T,
  DEVICE_FEATURE_UNITS as U,
} from '@gladysassistant/integration-sdk';
import { ESTIMATES } from './forecast.js';
import { DEVICE_NAMES, FEATURE_NAMES, word } from './i18n.js';

/** The values of computeValues, by feature base key. */
export const VALUES = {
  'power-now': 'power',
  'energy-today': 'today',
  'energy-remaining-today': 'remaining',
  'energy-tomorrow': 'tomorrow',
};

/** Feature key of a base key and an estimate: `energy-today`, `energy-today-p10`… */
export const featureKey = (base, estimate) => (estimate === 'p50' ? base : `${base}-${estimate}`);

export const siteIds = (gladys, resourceId) => gladys.externalIds('site', String(resourceId));
export const totalIds = (gladys) => gladys.externalIds('total', 'all');

/** The kind ('site' or 'total') and the id of a device external id. */
export function parseDeviceId(externalId) {
  const match = /:(site|total):([^:]+)$/.exec(String(externalId ?? ''));
  return match ? { kind: match[1], id: match[2] } : undefined;
}

export const siteName = (site, language) => word(DEVICE_NAMES.site(site.name), language);
export const totalName = (language) => word(DEVICE_NAMES.total, language);

function feature(ids, base, estimate, language) {
  const power = base === 'power-now';
  const suffix = estimate === 'p50' ? '' : ` (${estimate.toUpperCase()})`;
  return {
    name: `${word(FEATURE_NAMES[base], language)}${suffix}`,
    external_id: ids.feature(featureKey(base, estimate)),
    category: C.ENERGY_PRODUCTION_SENSOR,
    type: power ? T.ENERGY_PRODUCTION_SENSOR.POWER : T.ENERGY_PRODUCTION_SENSOR.DAILY_PRODUCTION,
    unit: power ? U.WATT : U.KILOWATT_HOUR,
    min: 0,
    max: power ? 10000000 : 100000,
    read_only: true,
    has_feedback: false,
    keep_history: true,
  };
}

function features(ids, language) {
  return Object.keys(VALUES).flatMap((base) =>
    ESTIMATES.map((estimate) => feature(ids, base, estimate, language)),
  );
}

function params(entries) {
  return entries
    .filter(([, value]) => value !== undefined && value !== null && String(value) !== '')
    .map(([name, value]) => ({ name, value: String(value) }));
}

/** The Gladys devices of the sites: one per site, and their total with two sites or more. */
export function buildDevices(gladys, sites, language) {
  const devices = sites.map((site) => {
    const ids = siteIds(gladys, site.id);
    return {
      name: siteName(site, language),
      external_id: ids.device,
      features: features(ids, language),
      params: params([
        ['resource_id', site.id],
        ['capacity_kw', site.capacity],
        ['capacity_dc_kw', site.capacityDc],
        ['azimuth', site.azimuth],
        ['tilt', site.tilt],
        ['install_date', site.installDate],
      ]),
    };
  });
  if (sites.length >= 2) {
    const ids = totalIds(gladys);
    devices.push({
      name: totalName(language),
      external_id: ids.device,
      features: features(ids, language),
      params: params([['resource_ids', sites.map((s) => s.id).join(',')]]),
    });
  }
  return devices;
}

/** The states of the known values (an unknown value is not published). */
export function buildStates(ids, values) {
  const states = [];
  for (const [base, name] of Object.entries(VALUES)) {
    const value = values[name];
    if (!value) {
      continue;
    }
    for (const estimate of ESTIMATES) {
      states.push({
        device_feature_external_id: ids.feature(featureKey(base, estimate)),
        state: value[estimate],
      });
    }
  }
  return states;
}
