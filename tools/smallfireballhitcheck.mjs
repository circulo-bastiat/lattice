#!/usr/bin/env node
// smallfireballhitcheck.mjs — #1866: small fireball hits a side wall / floor and ignites the NEIGHBOUR of the hit face.
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

console.log('smallfireballhitcheck — #1866: wall hit ignites the hit-face neighbour');
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
const FIRE = M.States.stateOf('fire');
const o = { x: 0, y: 200, z: 0, removed: false, width: 0.6, height: 1.8 };
const STONE = M.States.stateOf('stone');
// fireball flies +x at y=100.5 toward a stone wall at x=8; vertical variant flies down onto a floor at y=99
function shot(dir, wall, n) {
  freshWorld();
  for (const [x, y, z] of wall) W.setBlock(x, y, z, STONE);
  const e = EL.spawn('small_fireball', 5.5, 100.5, 0.5, { shooter: o, power: [dir[0], dir[1], dir[2]] });
  for (let i = 0; i < (n || 80) && !e.removed; i++) { EL.tick(); if (process.env.DBG) console.log(i, e.x, e.y, e.z, e.vx, e.removed); }
  const r = { removed: !!e.removed, fire: [] };
  for (let x = 0; x <= 12; x++) for (let y = 95; y <= 105; y++) for (let z = -3; z <= 3; z++) if (W.getBlock(x, y, z) === FIRE) r.fire.push([x, y, z].join());
  EL.clear();
  return r;
}
const wallX = []; for (let x = 0; x <= 12; x++) for (let z = -3; z <= 3; z++) wallX.push([x, 99, z]);   // floor so the fire survives
const floor0 = wallX.length;
 for (let y = 98; y <= 103; y++) for (let z = -3; z <= 3; z++) wallX.push([8, y, z]);
const floor = []; for (let x = 0; x <= 12; x++) for (let z = -3; z <= 3; z++) floor.push([x, 99, z]);
{
  const a = shot([1, 0, 0], wallX);
  ok(a.removed, 'side wall: fireball discarded on hit');
  ok(a.fire.join('|') === '7,100,0', 'side wall: fire in the cell in front of the hit face (got ' + a.fire + ')');
  const b = shot([0, -1, 0], floor);
  ok(b.removed && b.fire.join('|') === '5,100,0', 'floor: fire on top of the hit block (got ' + b.fire + ')');
  const c = shot([1, 0, 0], [], 10);
  ok(!c.removed && c.fire.length === 0, 'open air: fireball keeps flying');
  okAv(a.fire.join('|') !== '8,100,0' && a.fire.join('|') !== '', 'fire is not inside the wall');
  okAv(!(c.removed), 'no wall -> not removed (check can fail)');
}
console.log(`\n${pass} checks passed, ${fails.length} failed, ${breaks} breaks caught`);
for (const f of fails) console.log('  ✗ ' + f);
if (fails.length) process.exit(1);
