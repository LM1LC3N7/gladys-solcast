// -----------------------------------------------------------------------------
// The manifest is the contract with Gladys and the store: these tests tie it
// to the code, so a key renamed on one side only fails here.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createLogger } from '@gladysassistant/integration-sdk';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { SolcastApp } from '../src/app.js';
import { DEFAULTS, LANGUAGES } from '../src/config.js';
import { ACTIONS, DAILY_LIMIT, SCENE_TRIGGERS } from '../src/constants.js';
import { memoryStore } from './helpers/fakeSolcast.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const manifest = JSON.parse(read('gladys-assistant-integration.json'));
const handlers = read('src/handlers.js');

function* texts(node, path = '') {
  if (Array.isArray(node)) {
    for (const [i, entry] of node.entries()) {
      yield* texts(entry, `${path}[${i}]`);
    }
  } else if (node && typeof node === 'object') {
    if ('en' in node || 'fr' in node) {
      yield [path, node];
      return;
    }
    for (const [key, value] of Object.entries(node)) {
      yield* texts(value, `${path}.${key}`);
    }
  }
}

const allFields = [
  ...manifest.config_schema,
  ...[...manifest.actions, ...manifest.scene_triggers].flatMap((item) => item.fields ?? []),
];

test('the store basics', () => {
  assert.equal(manifest.manifest_version, 1);
  assert.equal(manifest.type, 'device');
  assert.ok(manifest.name.length >= 3 && manifest.name.length <= 30);
  assert.match(manifest.gladys_version, /^>=5\.1\.0$/, 'scene triggers need Gladys 5.1');
  assert.equal(manifest.docker_image, `ghcr.io/lm1lc3n7/gladys-solcast:${manifest.version}`);
  assert.equal(manifest.version, JSON.parse(read('package.json')).version);
  assert.deepEqual(manifest.transports, ['cloud']);
  assert.deepEqual(manifest.categories, ['energy']);
  assert.equal(manifest.location, undefined, 'the sites carry their own location');
  for (const lang of ['en', 'fr']) {
    const length = manifest.description[lang].length;
    assert.ok(length >= 10 && length <= 100, `description.${lang}: ${length} characters`);
    const docs = read(`docs/${lang}.md`);
    assert.ok(docs.length >= 300, `docs/${lang}.md is too short for the store`);
    assert.match(docs, /not\s+affiliated\s+with\s+Solcast|sans\s+lien\s+avec\s+Solcast/i);
  }
});

test('every text is in English and French', () => {
  for (const [path, text] of texts(manifest)) {
    for (const lang of ['en', 'fr']) {
      assert.ok(text[lang]?.trim(), `${path} needs ${lang}`);
    }
  }
});

test('the configuration matches the code', () => {
  const fields = Object.fromEntries(manifest.config_schema.map((f) => [f.key, f]));
  for (const [key, value] of Object.entries(DEFAULTS)) {
    assert.ok(fields[key], `${key} is not in the config_schema`);
    assert.deepEqual(fields[key].default, value, key);
  }
  assert.deepEqual(
    fields.language.options.map((o) => o.value),
    LANGUAGES,
  );
  assert.equal(fields.api_key.type, 'secret', 'the key is never sent back to the browser');
  assert.equal(fields.api_key.required, true);
  assert.equal(fields.sites.required, false);
  assert.deepEqual(
    [fields.daily_limit.min, fields.daily_limit.max],
    [DAILY_LIMIT.min, DAILY_LIMIT.max],
  );
  const intro = fields.intro;
  assert.equal(intro.type, 'section');
  assert.equal(intro.required ?? intro.default ?? intro.placeholder, undefined);
  for (const lang of ['en', 'fr']) {
    assert.ok(intro.description[lang].length <= 1000, `intro.${lang} over 1000 characters`);
    assert.match(intro.description[lang], /10/, 'the daily limit is told up front');
  }
  assert.ok(intro.links.length <= 5 && intro.links.every((l) => l.url.startsWith('https://')));
  for (const field of allFields.filter((f) => f.placeholder !== undefined)) {
    assert.equal(typeof field.placeholder, 'object', `${field.key}: placeholder`);
  }
  for (const key of Object.keys(fields)) {
    assert.match(key, /^[a-z0-9_]+$/);
  }
});

test('the keys of the manifest are the keys of the code', () => {
  assert.deepEqual(manifest.actions.map((a) => a.key).sort(), Object.values(ACTIONS).sort());
  for (const name of Object.keys(ACTIONS)) {
    assert.ok(handlers.includes(`onAction(ACTIONS.${name}`), `ACTIONS.${name} has no handler`);
  }
  for (const action of manifest.actions) {
    assert.ok(action.timeout_seconds >= 5 && action.timeout_seconds <= 120);
  }
  assert.deepEqual(
    manifest.scene_triggers.map((t) => t.key).sort(),
    Object.values(SCENE_TRIGGERS).sort(),
  );
});

test('the trigger fields and variables are what the events carry', () => {
  const gladys = createFakeGladys();
  const app = new SolcastApp({
    gladys,
    logger: createLogger({ level: 'silent' }),
    store: memoryStore(),
    timeZone: 'Europe/Paris',
  });
  const device = {
    externalId: 'ext:test-integration:site:x',
    label: 'Toit sud',
    siteIds: ['x'],
  };
  const sent = Object.keys(app.eventData(device)).sort();
  for (const trigger of manifest.scene_triggers) {
    const declared = [...trigger.fields, ...trigger.variables].map((f) => f.key).sort();
    assert.deepEqual(declared, sent, trigger.key);
    assert.ok(declared.length <= 30, 'Gladys takes 30 keys at most');
    for (const field of trigger.fields) {
      assert.equal(field.source, 'devices');
      assert.equal(field.options, undefined);
    }
  }
});
