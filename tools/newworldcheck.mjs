#!/usr/bin/env node
// newworldcheck.mjs — #2092: New world / Create world must start fresh; mobs saved by another
// generator must not be restored. Loads the real 16b_save.js (and reads 17_main.js) in node.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const rd = (f) => readFileSync(ROOT + 'src/' + f, 'utf8');

function run(saveSrc, mainSrc) {
  const fails = [];
  const ok = (c, m) => { if (!c) fails.push(m); };
  const NS = {}; const store = {};
  globalThis.localStorage = { getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } };
  for (const src of [rd('00_ns.js'), rd('01_util.js'), saveSrc]) new Function('MCL', src)(NS);
  const S = NS.Save; S.init();
  const env = (extra) => JSON.stringify(Object.assign({ v: S.VERSION, seed: 5, seed64: '5', climate: 'vanilla',
    worldType: 'amplified', worldScale: 4000, player: { x: 1 }, be: [{ t: 'chest' }],
    mobs: [{ type: 'cow', x: 1, y: 70, z: 1 }] }, extra));
  // 1. restore with the current generator keeps mobs; a missing or other `gen` drops them
  store[S.KEY] = env({ gen: S.GEN_VERSION }); S.load();
  ok(S.mobRecords.length === 1, 'same-generator save lost its mobs');
  store[S.KEY] = env({}); S.load();
  ok(S.mobRecords.length === 0, 'save with no gen restored its mobs');
  store[S.KEY] = env({ gen: S.GEN_VERSION + 1 }); S.load();
  ok(S.mobRecords.length === 0, 'save from another generator restored its mobs');
  // 2. save() records the generator
  S.mobRecords = null; S.playerState = null;
  NS.Player = { toJSON: () => ({}) }; NS.Hud = { say() {} };
  S.save(false);
  ok(JSON.parse(store[S.KEY]).gen === S.GEN_VERSION, 'save() does not record gen');
  // 3. reset() forgets everything load() stashed, and the world-creation choices
  store[S.KEY] = env({ gen: S.GEN_VERSION }); S.load(); S.reset();
  ok(!S.mobRecords, 'reset kept mobRecords');
  ok(!S.beRecords, 'reset kept beRecords');
  ok(S.playerState === null, 'reset kept playerState');
  ok(S.climate === 'earth' && S.worldType === 'default' && S.worldScale === 12000, 'reset kept old climate/type/scale');
  ok(store[S.KEY] === undefined, 'reset kept the storage key');
  // 4. a restored save with zero edits is still a save (title offers Continue, not Create)
  ok(/titleHasSave\s*=\s*!!restored;/.test(mainSrc), 'titleHasSave ignores 0-edit saves');
  return fails;
}

const good = run(rd('16b_save.js'), rd('17_main.js'));
good.forEach((m) => console.log('FAIL ' + m));
const bs = rd('16b_save.js'), bm = rd('17_main.js');
const breaks = [
  [bs.replace('&& o.gen === S.GEN_VERSION', ''), bm],
  [bs.replace("gen: S.GEN_VERSION,\n", ''), bm],
  [bs.replace('S.mobRecords = null; S.beRecords = null;', ''), bm],
  [bs.replace("S.climate = 'earth'; S.worldScale = 12000; S.worldType = 'default';", ''), bm],
  [bs, bm.replace('!!restored;', '!!(restored && NS.Save.count);')],
];
let caught = 0;
for (const [a, b] of breaks) if (run(a, b).length) caught++;
console.log('9 assertions, ' + good.length + ' failed · ' + caught + ' breaks caught');
process.exit(good.length || caught !== breaks.length ? 1 : 0);
