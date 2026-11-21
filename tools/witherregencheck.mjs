#!/usr/bin/env node
// witherregencheck.mjs — #941: WitherEntity.mobTick() else-branch `if (age % 20 == 0) heal(1.0F)`.
//   node tools/witherregencheck.mjs [--verbose]
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';

const ASSETS = join(MCLITE_ROOT, 'assets');
const VERBOSE = process.argv.includes('--verbose');
const rdj = (f) => JSON.parse(readFileSync(join(ASSETS, f), 'utf8'));
const b64 = (f) => readFileSync(join(ASSETS, f)).toString('base64');

let pass = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); if (VERBOSE) console.log((c ? '  ✓ ' : '  ✗ ') + m); return c; };
let breaks = 0;
const okAv = (c, m) => { breaks++; if (c) console.log('  ✓ break caught: ' + m); ok(c, 'anti-vacuity: ' + m); };
const say = (s) => { if (VERBOSE) console.log(s); };
const near = (a, b, e = 1e-6) => Math.abs(a - b) <= e;

console.log('witherregencheck -- #941: wither mob-gate regen heal(1) every 20 ticks when not invulnerable');

const EXTRA = ['02f_tags.js', '02g_items.js', '07_world.js', '07b_behaviour.js', '07d_mining.js',
  '07e_loot.js', '07h_entities.js', '14b_physics.js', '14c_raycast.js',
  '07i_entitylist.js', '07k_goals.js', '07l_spawn.js', '14d_survival.js', '14j_combat.js',
  '07q_effects.js', '07t_fly.js', '07za_explosion.js', '07zzh_blaze.js', '07zzi_ghast.js',
  '07zzm_wither.js'];
const MCL = loadEngine({ extra: EXTRA, dom: false });
MCL.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
MCL.DATA = Object.assign({}, MCL.DATA, { entities: rdj('entities.json') });

const W = MCL.World, B = MCL.Behave, CH = MCL.CH, S = MCL.States;
const EL = MCL.EntityList, Ai = MCL.Ai, Ent = MCL.Entities, Cb = MCL.Combat;
const Ex = MCL.Explosion, ES = MCL.Effects, Wi = MCL.Wither;

B.init(W);
Ent.init();
EL.init();
Ai.init();
Cb.init();
Ex.init();

ok(Wi.ready === true, 'Wi.ready is true once loaded');

function freshWorld() {
  W.init(1);
  for (let cx = -1; cx <= 1; cx++) for (let cz = -1; cz <= 1; cz++) {
    const c = W.makeChunk(cx, cz);
    c.state = CH.GENERATED;
    W.chunks.set(W.key(cx, cz), c);
  }
  EL.init();
}
function put(x, y, z, name) { W.setBlock(x, y, z, S.stateOf(name) | 0); }
function spawn(type, x, y, z, opts) { return EL.spawn(type, x, y, z, opts); }


function run(hp, ticks, invul) {
  freshWorld();
  const w = EL.spawn('wither', 1100, 70, 1100, {});
  w.health = hp; w.maxHealth = 300; w.age = 0;
  Wi.setInvulTimer(w, invul);
  for (let i = 0; i < ticks; i++) { w.age++; Wi.tickMovement(w); }
  return w;
}
{
  const w = run(100, 200, 0);
  ok(near(w.health, 110), `200 ticks not invulnerable: 100 -> 110 (got ${w.health})`);
  const w2 = run(100, 19, 0);
  okAv(near(w2.health, 100), `19 ticks: no heal yet (got ${w2.health}; a heal-every-tick stub would fail)`);
  const w3 = run(100, 20, 0);
  ok(near(w3.health, 101), `20 ticks: +1 (got ${w3.health})`);
  const w4 = run(300, 200, 0);
  okAv(near(w4.health, 300), 'full health stays capped at 300');
  const w5 = run(100, 5, 220);
  okAv(w5.health !== 101, `invuln branch keeps its own regen, not the 1-per-20 (got ${w5.health})`);
}
console.log(`\npassed: ${pass}, ${breaks} breaks caught, failed: ${fails.length}`);
if (fails.length) { fails.forEach((m) => console.log('  FAIL: ' + m)); process.exit(1); }
