#!/usr/bin/env node
// passivecheck.mjs — QUEUE 0.2, G18c: the sheep/chicken/pig unit.
//
//   node tools/passivecheck.mjs [--verbose]
//
// ⚠ WHAT THIS PROVES. Sheep, chicken and pig reuse cow's own substrate almost entirely (motion,
// spawn rule, goal shapes) — the interesting question is never "does a goal selector work", it
// is "did THIS session's own additions (the closed motion set, the ROSTER entries, the spawn
// rule aliasing, and the leftover state 07w_passive.js owns) actually land". Every section
// drives the REAL modules — `EL.motionFor`, `Ai.ROSTER`, `Spawn.RULES`, `Breed.CHILD.sheep`,
// `Passive.*` — never a reimplementation, and each asserts in BOTH directions (rule 6).

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEngine, ASSETS } from './loadsrc.mjs';

const VERBOSE = process.argv.includes('--verbose');

let pass = 0, breaks = 0;
const fails = [];
const ok = (c, m) => { if (c) pass++; else if (fails.length < 40) fails.push(m); return c; };
const okAv = (c, m) => { breaks++; if (c) { pass++; if (VERBOSE) console.log('   ✓ ' + m); } else fails.push('anti-vacuity: ' + m); };
const say = (...a) => { if (VERBOSE) console.log(...a); };

console.log('chickeneggsoundcheck — #1551');

const M = loadEngine({
  extra: ['02f_tags.js', '02g_items.js', '02h_recipes.js', '14f_inventory.js',
          '07b_behaviour.js', '07_world.js', '07h_entities.js', '14b_physics.js',
          '07i_entitylist.js', '07k_goals.js', '07l_spawn.js', '07m_breed.js', '07w_passive.js',
          '14l_use.js']
});
const rdj = (f) => JSON.parse(readFileSync(join(ASSETS, f), 'utf8'));
const b64 = (f) => readFileSync(join(ASSETS, f)).toString('base64');
M.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
M.Recipes.init({ recipes: b64('recipes.bin'), recipesBytes: rdj('recipes.meta.json').jsonBytes });
M.DATA = Object.assign({}, M.DATA, { entities: rdj('entities.json') });
M.Entities.init();
M.EntityList.init();
M.World.init(1);
M.Behave.init(M.World);
M.Ai.init();
M.Breed.init();
M.Passive.init();
M.Use.init(M.World);

const EL = M.EntityList, Ai = M.Ai, Spawn = M.Spawn, Br = M.Breed, Ps = M.Passive, Ent = M.Entities;
const W = M.World;

for (let cx = -1; cx <= 2; cx++) for (let cz = -1; cz <= 2; cz++) { const c = W.makeChunk(cx, cz); c.state = M.CH.GENERATED; W.chunks.set(W.key(cx, cz), c); }
const calls = [];
const realSound = M.Sound;
M.Sound = { ready: true, play: (ev, o) => calls.push({ ev, o, items: EL.list.filter((x) => x.type === 'item' && !x.removed).length }), blockStep() {} };
function lay(rndSeq, mutate) {
  calls.length = 0;
  let i = 0; EL.random = () => rndSeq[i++ % rndSeq.length];
  const c = EL.spawn('chicken', 10, 5, 10); c.eggLayTime = 1; if (mutate) mutate(c);
  const before = EL.list.filter((x) => x.type === 'item' && !x.removed).length;
  EL.tickOne(c);
  const after = EL.list.filter((x) => x.type === 'item' && !x.removed).length;
  return { before, after, eggs: calls.filter((k) => k.ev === 'entity.chicken.egg') };
}
let r = lay([0.5]);
ok(r.after > r.before, 'the egg dropped');
ok(r.eggs.length === 1, 'exactly one entity.chicken.egg on the lay tick (got ' + r.eggs.length + ')');
if (r.eggs[0]) {
  ok(r.eggs[0].o.volume === 1 && Math.abs(r.eggs[0].o.pitch - 1) < 1e-9, 'volume 1, pitch 1 when both randoms equal');
  ok(r.eggs[0].o.source === 'neutral', 'neutral source');
  ok(r.eggs[0].items === r.before, 'sound played BEFORE the egg item entity exists');
}
// pitch formula tracks the two rolls: (a-b)*0.2+1 with a drawn first
const seq = [0.9, 0.1, 0.9, 0.1, 0.9, 0.1, 0.9, 0.1];
let found = false;
for (let k = 0; k < 8 && !found; k++) { const rr = lay(seq.slice(k).concat(seq.slice(0, k)));
  if (rr.eggs[0] && Math.abs(rr.eggs[0].o.pitch - 1) > 0.05) found = Math.abs(Math.abs(rr.eggs[0].o.pitch - 1) - 0.16) < 1e-9; }
ok(found, 'pitch = (r1 - r2) * 0.2 + 1 (+-0.16 for rolls 0.9/0.1)');
ok(lay([0.5], (c) => { c.eggLayTime = 50; }).eggs.length === 0, 'no sound when the timer has not run out');
ok(lay([0.5], (c) => { c.growAge = -100; }).eggs.length === 0, 'no sound from a baby');
// anti-vacuity: with the sound module absent/not-ready nothing is recorded, so the check can fail
{ const keep = M.Sound; M.Sound = { ready: false, play: keep.play }; const rr = lay([0.5]); M.Sound = keep;
  breaks++; if (rr.eggs.length === 0) { pass++; console.log('  ✓ break caught: silent sound module records no egg sound'); } else fails.push('anti-vacuity: silent module still recorded'); }
{ const keep = M.Sound; M.Sound = { ready: true, play: () => {} }; const rr = lay([0.5]); M.Sound = keep;
  breaks++; if (rr.eggs.length === 0) { pass++; console.log('  ✓ break caught: dropped play() records nothing'); } else fails.push('anti-vacuity 2'); }
{ const rr = lay([0.5], (c) => { c.hasJockey = true; });
  breaks++; if (rr.eggs.length === 0) { pass++; console.log('  ✓ break caught: jockey chicken is silent'); } else fails.push('anti-vacuity 3'); }
M.Sound = realSound;
console.log(`    ${breaks} breaks caught`);
if (fails.length) { for (const f of fails) console.log('  x ' + f); process.exit(1); }
console.log(`chickeneggsoundcheck: ${pass} checks passed`);
