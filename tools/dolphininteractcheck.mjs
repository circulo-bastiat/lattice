#!/usr/bin/env node
// dolphininteractcheck.mjs — #719 (copy of dolphincheck's harness): DolphinEntity.initGoals is built (src/07zj2_dolphin.js + Ai.ROSTER.dolphin). Headless trace of the
// real goals through Ai.GoalSelector + Dolphin.travelMob against .decomp DolphinEntity/BreatheAirGoal/DolphinJumpGoal.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';

const ASSETS = join(MCLITE_ROOT, 'assets');
let pass = 0, breaks = 0;
const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const okAv = (c, m) => { breaks++; if (c) { pass++; console.log('   ✓ ' + m); } else fails.push('anti-vacuity: ' + m); };

const MODS = []; for (const m of readFileSync(join(MCLITE_ROOT, 'build.mjs'), 'utf8').matchAll(/'(07[0-9a-z_]+\.js)'/g)) if (!MODS.includes(m[1])) MODS.push(m[1]);
const M = loadEngine({ extra: ['02f_tags.js', '02g_items.js', '14b_physics.js', '14c_raycast.js', '14d_survival.js', '14f_inventory.js', '14j_combat.js', '14l_use.js', '07_world.js'].concat(MODS.filter((f) => f !== '07_world.js')) });
M.Items.init({ items: readFileSync(join(ASSETS, 'items.bin')).toString('base64'), itemsBytes: JSON.parse(readFileSync(join(ASSETS, 'items.meta.json'), 'utf8')).rawBytes });
M.DATA = Object.assign({}, M.DATA, { entities: JSON.parse(readFileSync(join(ASSETS, 'entities.json'), 'utf8')) });
M.Entities.init(); M.EntityList.init(); M.Breed.init && M.Breed.init(); M.Mount.init(); M.World.init(1); M.Behave.init(M.World); M.Ai.init();
if (M.Combat && M.Combat.init) M.Combat.init();
M.Dolphin.init(); if (M.Use && M.Use.init) M.Use.init(M.World);
const EL = M.EntityList, W = M.World, S = M.States, Dol = M.Dolphin;
for (let cx = -1; cx <= 2; cx++) for (let cz = -1; cz <= 2; cz++) {
  const c = W.makeChunk(cx, cz); c.state = M.CH.GENERATED; W.chunks.set(W.key(cx, cz), c);
}
const stone = S.stateOf('stone') | 0, water = S.stateOf('water') | 0;
// a pool: water y 1..10 inside stone walls, air above (y 11..14), open roof
for (let x = -12; x <= 12; x++) for (let z = -12; z <= 12; z++) for (let y = 0; y <= 14; y++) {
  const wall = Math.abs(x) === 12 || Math.abs(z) === 12 || y === 0;
  W.setBlock(x, y, z, wall ? stone : (y <= 10 ? water : 0));
}
M.Player = { x: 100, y: 100, z: 100, EYE: 1.62 };
let seed = 777;
const rng = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
EL.random = rng;
const fresh = (y) => { EL.list.length = 0; const e = EL.spawn('dolphin', 0.5, y, 0.5); e.inWater = true; return e; };

console.log('dolphininteractcheck — #719: fish feeding, treasure lead, grace');
const Goal = (n, e) => e.ai.entries.find((x) => x.goal instanceof Dol[n]).goal;
// §1 interactMob: fish sets hasFish, non-fish does not
for (const f of ['cod', 'cooked_cod', 'salmon', 'cooked_salmon', 'pufferfish', 'tropical_fish']) {
  const e = fresh(5.5); e.hasFish = false;
  okAv(Dol.interact(e, f, false) === true && e.hasFish === true, `${f} feeds the dolphin`);
}
{ const e = fresh(5.5); e.hasFish = false;
  okAv(Dol.interact(e, 'kelp', false) === false && !e.hasFish, 'kelp does not feed it'); }
// §2 Use.entityUse shrinks the stack (survival) / not in creative
{
  const Iv = M.Inventory, It = M.Items;
  for (const creative of [false, true]) {
    const e = fresh(5.5); e.hasFish = false;
    const inv = Iv.create(); const st = { i: It.of('cod'), n: 2 }; Iv.setItem(inv, 0, st);
    const P = { instabuild: creative, inventory: inv, slot: 0, x: 3, y: 5, z: 3, crouching: false };
    const r = M.Use.entityUse(P, e, st);
    ok(r === true && e.hasFish, `entityUse(cod) on dolphin handled (creative=${creative}): ${r}`);
    okAv(creative ? st.n === 2 : st.n === 1, `stack ${creative ? 'kept' : 'shrunk'} (count ${st.n})`);
  }
}
// §3 LeadToNearbyTreasureGoal.start: structure found -> treasure pos + 7 particles; none -> noPath, fish spent
{
  const St = M.Structures; const orig = St.locateStructure; let asked = null;
  St.locateStructure = (tag, x, z, r) => { asked = [tag, r]; return { x: 100, z: 40, y: 7, cx: 6, cz: 2, name: 'shipwreck' }; };
  const e = fresh(5.5); e.hasFish = true; e.air = 4800;
  const g = Goal('LeadToNearbyTreasureGoal', e); const p0 = (M.Particle.list || M.Particle.parts || []).length;
  ok(g.canUse(), 'canUse with fish and air');
  g.start();
  ok(asked && /dolphin_located/.test(asked[0]) && asked[1] === 50, `locates dolphin_located within 50 (${asked})`);
  okAv(e.dolTreasure && e.dolTreasure.x === 100 && e.dolTreasure.z === 40 && e.dolTreasure.y === 7, 'treasure pos stored incl. locate Y');
  ok(e.treasureHearts === 7, `status 38 -> 7 particles (${e.treasureHearts})`);
  St.locateStructure = () => null;
  const e2 = fresh(5.5); e2.hasFish = true; e2.air = 4800; e2.dolTreasure = null;
  const g2 = Goal('LeadToNearbyTreasureGoal', e2); g2.start();
  ok(g2.canContinueToUse() === false, 'no structure -> stops');
  g2.stop(); okAv(e2.hasFish === false, 'no structure -> fish spent');
  St.locateStructure = orig;
}
// §4 SwimWithPlayerGoal: Dolphin's Grace 100 ticks
{
  const e = fresh(5.5); const given = [];
  M.Effects = M.Effects || {}; const oe = M.Effects.addStatusEffect;
  M.Effects.addStatusEffect = (P, id, dur, amp) => { given.push([id, dur, amp]); };
  M.Player = { x: 3, y: 5.5, z: 3, swimming: true, EYE: 1.62 };
  const g = Goal('SwimWithPlayerGoal', e);
  ok(g.canUse(), 'swimming player within 10 -> canUse'); g.start();
  okAv(given.length === 1 && given[0][0] === 'dolphins_grace' && given[0][1] === 100, `grace 100 ticks (${JSON.stringify(given)})`);
  M.Player.swimming = false; ok(!g.canUse(), 'not swimming -> no');
  M.Player = { x: 100, y: 100, z: 100, EYE: 1.62 }; M.Effects.addStatusEffect = oe;
}

console.log('================ dolphininteractcheck ================');
console.log(` assertions passed .. ${pass}\n failures ........... ${fails.length}`);
for (const f of fails) console.log('   ✗ ' + f);
console.log(` breaks caught ...... ${breaks}`);
console.log('======================================================');
process.exit(fails.length ? 1 : 0);
