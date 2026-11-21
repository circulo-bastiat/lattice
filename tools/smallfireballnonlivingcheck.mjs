#!/usr/bin/env node
// smallfireballnonlivingcheck.mjs — #3896: SmallFireballEntity hits any collides() entity (boat, minecart, end crystal), not only living ones.
//   5. anti-vacuity: break each and confirm the check notices
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEngine } from './loadsrc.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ASSETS = join(ROOT, 'assets');
const rdj = (f) => JSON.parse(readFileSync(join(ASSETS, f), 'utf8'));
const b64 = (f) => readFileSync(join(ASSETS, f)).toString('base64');
let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const okAv = (c, m) => { breaks++; if (c) { pass++; console.log('   ✓ ' + m); } else fails.push('anti-vacuity: ' + m); };

console.log('smallfireballnonlivingcheck — #3896: small fireball hits boat/minecart/end_crystal');
const M = loadEngine({
  extra: ['07_world.js', '02g_items.js', '14f_inventory.js', '07h_entities.js', '14b_physics.js',
          '07i_entitylist.js', '14i_hand.js', '14j_combat.js', '14d_survival.js', '14l_use.js',
          '07b_behaviour.js', '09c_weather.js', '07zzh_blaze.js', '07zzi_ghast.js', '07za_explosion.js']
});
M.DATA = Object.assign({}, M.DATA, { entities: rdj('entities.json') });
M.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
M.Entities.init(); M.EntityList.init(); M.Combat.init();
const EL = M.EntityList, W = M.World, CH = M.CH;
const WATER = M.States.stateOf('water') | 0;
function freshWorld() {
  W.init(1);
  for (let cx = -2; cx <= 2; cx++) for (let cz = -2; cz <= 2; cz++) {
    const c = W.makeChunk(cx, cz); c.state = CH.GENERATED; W.chunks.set(W.key(cx, cz), c);
  }
  const bw = { get: (x, y, z) => W.getBlock(x, y, z), set: (x, y, z, st) => W.setBlock(x, y, z, st), getLight: () => 15 << 4 };
  bw.getBlock = bw.get; bw.setBlock = bw.set;
  M.Behave.init(bw);
  EL.clear();
}
const floor = []; for (let x = 0; x <= 12; x++) for (let z = -3; z <= 3; z++) floor.push([x, 99, z]);
const o = { x: 0, y: 200, z: 0, removed: false, width: 0.6, height: 1.8 };
function shot(type) {
  freshWorld(); for (const [x, y, z] of floor) W.setBlock(x, y, z, M.States.stateOf('stone'));
  const t = type && EL.spawn(type, 8.5, 100, 0.5, {});
  const e = EL.spawn('small_fireball', 3.5, 100.5, 0.5, { shooter: o, power: [1, 0, 0] });
  let hitAt = -1;
  for (let i = 0; i < 40 && !e.removed; i++) { EL.tick(); if (e.removed) hitAt = e.x; }
  const r = { removed: !!e.removed, x: hitAt, t };
  EL.clear();
  return r;
}
for (const type of ['boat', 'minecart', 'end_crystal']) {
  const r = shot(type);
  ok(r.removed && r.x > 6 && r.x < 10, type + ': fireball hit it (removed near x=8, got ' + r.x + ')');
}
okAv(!shot(null).removed, 'no target -> fireball keeps flying (check can fail)');
console.log(`\n${pass} checks passed, ${fails.length} failed, ${breaks} breaks caught`);
for (const f of fails) console.log('  ✗ ' + f);
if (fails.length) process.exit(1);
