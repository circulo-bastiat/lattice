#!/usr/bin/env node
// thrownwatercheck.mjs — #1622: ThrownEntity.tick (.decomp ThrownEntity.java:76-87): touching water ->
// 4 bubble particles and velocity*0.8 instead of 0.99. Potion, snowball, egg, ender pearl.
//   node tools/thrownwatercheck.mjs [--verbose]
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEngine } from './loadsrc.mjs';

const ASSETS = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets');
let pass = 0, breaks = 0;
const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };

const M = loadEngine({
  extra: ['02f_tags.js', '07_world.js', '07b_behaviour.js', '07h_entities.js', '14b_physics.js', '07i_entitylist.js',
          '14i_hand.js', '14j_combat.js', '14d_survival.js', '07q_effects.js', '07z_potion.js', '07zzd_throw.js',
          '07v_spell.js', '07k_goals.js', '07zx_particle.js']
});
M.DATA = Object.assign({}, M.DATA, { entities: JSON.parse(readFileSync(join(ASSETS, 'entities.json'), 'utf8')) });
M.Entities.init(); M.EntityList.init(); M.Hand.init(); M.Combat.init(); M.Ai.init();
if (M.Tags && M.Tags.init && !M.Tags.ready) M.Tags.init();
M.Behave.init(M.World); M.Particle.init();
const EL = M.EntityList, W = M.World, CH = M.CH;
const st = (n) => M.States.stateOf(n) | 0;

function world(water) {
  EL.clear();
  W.init(1);
  for (let cx = -2; cx <= 2; cx++) for (let cz = -2; cz <= 2; cz++) {
    const c = W.makeChunk(cx, cz); c.state = CH.GENERATED; W.chunks.set(W.key(cx, cz), c);
  }
  for (let x = -3; x <= 3; x++) for (let z = -3; z <= 3; z++) {
    W.setBlock(x, 4, z, st('stone'));
    for (let y = 5; y <= 12; y++) W.setBlock(x, y, z, water ? st('water') : 0);
  }
}
const nBubbles = () => { const P = M.Particle; return (P.list || P.particles || []).filter((p) => p && p.type === 'bubble').length; };

// the drag one tick applies, read from the live velocity ratio (gravity is subtracted before the move, so
// compare two runs: the horizontal axis has no gravity)
function hDrag(type, water) {
  world(water);
  const e = EL.spawn(type, 0, 9, 0, type === 'potion' ? { vx: 1, vy: 0, vz: 0, shooter: null, potionId: 'poison' } : { vx: 1, vy: 0, vz: 0 });
  if (!e) return null;
  e.vx = 1; e.vy = 0; e.vz = 0;
  const b0 = nBubbles();
  EL.tick();
  return { f: e.vx, bubbles: nBubbles() - b0, removed: !!e.removed };
}

for (const t of ['potion', 'snowball', 'egg', 'ender_pearl']) {
  const air = hDrag(t, false), wet = hDrag(t, true);
  ok(air && Math.abs(air.f - 0.99) < 1e-6, `${t} in air keeps 0.99, got ${air && air.f}`);
  ok(air && air.bubbles === 0, `${t} in air emits no bubbles`);
  ok(wet && Math.abs(wet.f - 0.8) < 1e-6, `${t} in water drags 0.8, got ${wet && wet.f}`);
  ok(wet && wet.bubbles === 4, `${t} in water emits 4 bubbles, got ${wet && wet.bubbles}`);
}

// anti-vacuity: break the water factor and the bubble spawn; each must be caught
const saved = EL.THROWN_DRAG_WATER;
EL.THROWN_DRAG_WATER = 0.99;
let w = hDrag('potion', true);
breaks++; if (Math.abs(w.f - 0.8) < 1e-6) fails.push('anti-vacuity: water drag change not caught');
EL.THROWN_DRAG_WATER = saved;
const sp = M.Particle.spawn; M.Particle.spawn = () => null;
w = hDrag('potion', true);
breaks++; if (w.bubbles === 4) fails.push('anti-vacuity: bubble removal not caught');
M.Particle.spawn = sp;
const savedT = EL.THROWN; EL.THROWN = {};
w = hDrag('snowball', true);
breaks++; if (Math.abs(w.f - 0.8) < 1e-6) fails.push('anti-vacuity: thrown-set removal not caught');
EL.THROWN = savedT;

console.log(`thrownwatercheck: ${pass} passed, ${fails.length} failed, ${breaks} breaks caught`);
for (const f of fails) console.log('  FAIL ' + f);
process.exit(fails.length ? 1 : 0);
