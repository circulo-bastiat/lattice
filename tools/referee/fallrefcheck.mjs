#!/usr/bin/env node
// fallrefcheck.mjs — infra I6 (25 Sept 2026): MOB FALL DAMAGE vs the real 1.18.2 server (golden: runfall.mjs, fall.json;
// scenarios: fallscen.mjs). Per scenario the engine builds the same glass shaft + 3x3 landing pad in a cell map, spawns the
// mob (EL.spawn, the engine's own equipment slots for the armour cases) h blocks above the pad and runs T ticks of
// `EL.tick` (physics -> Ph.landed -> whatever the engine does with a mob's landing), then compares the health lost with the
// server's (constant over REPS reps; x100 fixed point, exact). -1 on the server = the mob died (and is gone).
// Anti-vacuity (D-30/D-305): a golden damage shifted by 1, the hay multiplier made 1 in the golden, and the engine's health
// forced down by 1 are each caught. Mismatches are FINDINGS (red, exit 1).
// KW-34 (s136) -- the golden-comparison section above still needs `runfall.mjs` against a real server jar, which this
// worker's box does not have. SO IT IS NOT THE ONLY SECTION ANY MORE: a SELFCHECK section (below, always runs, no golden,
// no server) proves the actual fix -- `EL.spawn`'s `living:false` gate (07i_entitylist.js, KW-34) never let `Ph.landed`
// fire for a mob, and even when it did nothing ever spent `e.pendingFallDamage` the way `14_player.js:525` spends the
// player's -- against the engine's OWN formula, so this check can go red on its own machine and does not silently pass
// just because no golden is checked in yet.
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { loadEngine, MCLITE_ROOT } from '../loadsrc.mjs';
import { SCEN, T } from './fallscen.mjs';

const VERBOSE = process.argv.includes('--verbose');
const refDir = process.env.MCLITE_REFEREE_DIR || join(homedir(), '.mclite-referee', '1.18.2');
const GOLDEN = [join(refDir, 'golden', 'fall.json'), join(MCLITE_ROOT, '..', 'mclite-store', 'golden', 'fall.json')].find((f) => existsSync(f));
const HAVE_GOLDEN = !!GOLDEN;
const golden = HAVE_GOLDEN ? JSON.parse(readFileSync(GOLDEN, 'utf8')) : null;
const rdj = (f) => JSON.parse(readFileSync(join(MCLITE_ROOT, 'assets', f), 'utf8'));
const b64 = (f) => readFileSync(join(MCLITE_ROOT, 'assets', f)).toString('base64');

let seed = 0x0fa11234;
const rng = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };

// The engine as the game builds it (25 Sept: was a hand-picked list, which left mobs without `e.ai` -- a different tick path
// from the live game's; the finding below held either way): every 07*.js mob module, so rostered mobs run EL.tickMob.
const BASE_MODS = ['02f_tags.js', '02g_items.js', '14f_inventory.js', '07b_behaviour.js', '07_world.js', '07h_entities.js',
  '14b_physics.js', '07i_entitylist.js', '07k_goals.js', '07l_spawn.js', '07m_breed.js', '07n_tame.js', '07q_effects.js',
  '07y_equip.js', '10_gfx.js', '15h_bemodel.js', '07j_entityrender.js', '14d_survival.js', '14j_combat.js', '07zw_mobnbt.js',
  '07w_passive.js', '07d_mining.js', '07e_loot.js'];
const MOB_MODS = readdirSync(join(MCLITE_ROOT, 'src')).filter((f) => /^07.*\.js$/.test(f) && !BASE_MODS.includes(f)).sort();
const M = loadEngine({ extra: BASE_MODS.concat(MOB_MODS), dom: false, initReg: true });
M.DATA = Object.assign({}, M.DATA, { entities: rdj('entities.json') });
M.Entities.init();
M.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
M.Loot.init({ loot: b64('loot.bin'), lootBytes: rdj('loot.meta.json').jsonBytes });
const cells = new Map();
const key = (x, y, z) => x + ',' + y + ',' + z;
const w = { get: (x, y, z) => cells.get(key(x, y, z)) || 0, set: (x, y, z, s) => { if (s) cells.set(key(x, y, z), s); else cells.delete(key(x, y, z)); } };
w.getBlock = w.get; w.setBlock = w.set; w.getLight = () => 0; w.tickingAt = () => true;
M.World = Object.assign(M.World || {}, w);
if (M.Behave && M.Behave.init) M.Behave.init(w);
M.Physics.shapeAt = (x, y, z) => { const id = w.get(Math.floor(x), Math.floor(y), Math.floor(z)); return id && M.States.solid[id] === 1 ? M.Physics.shapesFor(id) : null; };
M.Physics.solidAt = (x, y, z) => M.Physics.shapeAt(x, y, z) !== null;
M.EntityList.init(); M.Ai.init(); M.Equip.init(); M.Breed.init(); M.Tame.init(); M.Passive.init();
M.Diff = { get: () => 'normal' }; M.Player = { x: 0, y: 300, z: 0 };
if (M.Goat && M.Goat.init) M.Goat.init();
M.EntityList.random = rng;
Math.random = rng;
const { EntityList: EL, Items: IT, Equip: Eq, States: S } = M;

const PAD = 0;
function engineDamage(s, hook) {
  cells.clear(); EL.list.length = 0;
  const glass = S.stateOf('glass'), land = S.stateOf(s.land);
  if (!land) return { err: `no engine state ${s.land}` };
  for (let x = -2; x <= 2; x++) for (let z = -2; z <= 2; z++) for (let y = PAD; y <= PAD + s.h + 3; y++) {
    const inner = Math.abs(x) <= 1 && Math.abs(z) <= 1;
    if (y === PAD && inner) w.set(x, y, z, land); else if (!inner) w.set(x, y, z, glass);
  }
  for (let x = -2; x <= 2; x++) for (let z = -2; z <= 2; z++) w.set(x, PAD - 1, z, S.stateOf('grass_block'));
  const e = EL.spawn(s.mob, 0.5, PAD + 1 + s.h, 0.5);
  if (!e) return { err: 'EL.spawn gives nothing' };
  e.persistent = true; e.vx = e.vy = e.vz = 0;
  if (s.id === 'horse_h12') { e.maxHealth = 30; e.health = 30; }
  if (/diamond_boots/.test(s.nbt || '')) {
    const pieces = /diamond_leggings/.test(s.nbt) ? ['feet:diamond_boots', 'legs:diamond_leggings', 'chest:diamond_chestplate', 'head:diamond_helmet'] : ['feet:diamond_boots'];
    for (const p of pieces) {
      const [slot, item] = p.split(':');
      const st = { i: IT.of(item), n: 1 };
      if (/feather_falling/.test(s.nbt)) st.t = { Enchantments: [{ id: 'minecraft:feather_falling', lvl: 4 }] };
      Eq.setEquipped(e, IT[slot.toUpperCase()] !== undefined ? IT[slot.toUpperCase()] : IT[slot], st);
    }
  }
  if (hook) hook(e);
  const before = Math.round(e.health * 100);
  for (let t = 0; t < T; t++) EL.tick();
  const gone = e.removed || e.dead || !(e.health > 0);
  return { before, after: gone ? -1 : Math.floor(e.health) * 100 }; // golden reads `data get entity Health` unscaled: the server truncates to a whole number
}

const reds = [];
let pass = 0;
const lost = (b, a) => (a < 0 ? 'died' : String((b - a) / 100));
function compare(s, g, e) {
  if (e.err) return [`${s.id}: ${e.err}`];
  const gb = g.before[0], ga = g.after[0];
  if (g.after.some((v) => v !== ga) || g.before.some((v) => v !== gb)) return [`${s.id}: the server was not constant over reps (${g.after.join('/')}) -- harness`];
  const gl = ga <= 0 ? 'died' : lost(gb, ga), el = lost(e.before, e.after);
  return gl === el ? [] : [`${s.id}: ${s.mob} falling ${s.h} onto ${s.land}: server loses ${gl} health, engine ${el}`];
}
let breaks = 0, caught = 0;
const brk = (name, fired) => { breaks++; if (fired) caught++; else reds.push(`anti-vacuity: break "${name}" was NOT caught`); };

if (HAVE_GOLDEN) {
  console.log(`fallrefcheck — mob fall damage vs the real 1.18.2 server (${SCEN.length} scenarios, ${golden.generatedAt})`);
  const ENG = {};
  for (const s of SCEN) {
    const g = golden.cases[s.id];
    if (!g) { reds.push(`${s.id}: no golden case`); continue; }
    const e = engineDamage(s);
    ENG[s.id] = e;
    const bad = compare(s, g, e);
    if (bad.length) reds.push(...bad); else pass++;
    if (VERBOSE) console.log(`  ${s.id.padEnd(18)} server ${lost(g.before[0], g.after[0])}  engine ${e.err || lost(e.before, e.after)}`);
  }
  { const s = SCEN.find((q) => q.id === 'pig_h8'); const g = JSON.parse(JSON.stringify(golden.cases[s.id])); g.after = g.after.map((v) => v - 100);
    brk('golden pig_h8 damage +1', compare(s, g, ENG[s.id]).join() !== compare(s, golden.cases[s.id], ENG[s.id]).join()); }
  { const s = SCEN.find((q) => q.id === 'cow_h12_hay'); const g = JSON.parse(JSON.stringify(golden.cases[s.id])); g.after = golden.cases.cow_h12.after.slice();
    brk('golden hay multiplier 0.2 -> 1', compare(s, g, ENG[s.id]).join() !== compare(s, golden.cases[s.id], ENG[s.id]).join()); }
  { const s = SCEN.find((q) => q.id === 'cow_h12_slime'); const e = engineDamage(s, (m) => { m.health -= 1; });
    brk('engine health -1 on a slime landing', compare(s, golden.cases[s.id], { before: e.before + 100, after: e.after }).length > compare(s, golden.cases[s.id], ENG[s.id]).length); }
} else {
  console.log('fallrefcheck: golden not generated -- run node tools/referee/runfall.mjs for the real-server comparison; running SELFCHECK only');
}

// ── SELFCHECK (KW-34) -- no golden, no server; always runs. Proves the two wires the referee
// packs named as red: `Ph.landed` actually fires for a MOB (the `living:false` gate, D-308/KW-34)
// and the pendingFallDamage it sets actually reaches the mob's health (`Cb.tickEntity`, the same
// place the fire-damage-per-tick already does it), by comparing against the engine's OWN formula
// (`Ph.fallDamage`) rather than a copy of the number.
let selfPass = 0;
const selfCheck = (desc, cond) => { if (cond) { selfPass++; pass++; } else { reds.push(`selfcheck: ${desc}`); } };

{ // a real fall (>3 blocks, the vanilla no-damage threshold) onto hard ground must cost health,
  // and the amount lost must be EXACTLY the engine's own fallDamage(distance-fallen, mult=1, jumpBoost=0).
  const s = { id: 'selfcheck_cow_h10', mob: 'cow', h: 10, land: 'stone', nbt: '' };
  const e = engineDamage(s);
  const expected = Math.round(M.Physics.fallDamage(10, 1, 0) * 100);
  selfCheck('mob (cow) falling 10 onto stone loses health, matching Ph.fallDamage(10,1,0) exactly',
    !e.err && expected > 0 && e.after >= 0 && (e.before - e.after) === expected);
}
{ // under the 3-block threshold: no damage, so this cannot pass vacuously just because "some
  // number changed" -- it must be exactly zero.
  const s = { id: 'selfcheck_cow_h2', mob: 'cow', h: 2, land: 'stone', nbt: '' };
  const e = engineDamage(s);
  selfCheck('mob (cow) falling only 2 (under the no-damage threshold) loses no health',
    !e.err && e.after === e.before);
}
{ // a fatal fall actually kills the mob (pendingFallDamage reaches Cb.hurt's death branch, not
  // just decrements health silently forever).
  // pig, NOT chicken: vanilla's ChickenEntity.handleFallDamage returns false (ChickenEntity.java:108-110) -- a chicken never
  // takes fall damage, and the engine loaded as the game does (every 07*.js) rightly keeps it alive (infra s137 merge).
  const s = { id: 'selfcheck_pig_h40', mob: 'pig', h: 40, land: 'stone', nbt: '' };
  const e = engineDamage(s);
  selfCheck('mob (pig) falling 40 onto stone dies', !e.err && e.after === -1);
}
{ // anti-vacuity (D-30): reproduce the ACTUAL KW-34 symptom by no-opping `Ph.landed` for one
  // scenario (exactly what "EL.spawn builds living:false" caused -- the landing path never
  // ran) and confirm the selfcheck assertion above would have caught it.
  const s = { id: 'selfcheck_cow_h10_break', mob: 'cow', h: 10, land: 'stone', nbt: '' };
  const origLanded = M.Physics.landed;
  M.Physics.landed = function () {};
  const e = engineDamage(s);
  M.Physics.landed = origLanded;
  brk('Ph.landed no-op (the exact KW-34 symptom) on a real fall', !e.err && e.before === e.after);
}
{ // anti-vacuity: reproduce the OTHER half of KW-34 -- landed() runs and sets pendingFallDamage,
  // but nothing ever spends it (the state before this unit's Cb.tickEntity fix).
  const s = { id: 'selfcheck_cow_h10_break2', mob: 'cow', h: 10, land: 'stone', nbt: '' };
  const e = engineDamage(s, null);
  const origHurt = M.Combat.hurt;
  M.Combat.hurt = function (ent, amt, now, byPlayer, src) { if (src && src.source === 'fall') return false; return origHurt(ent, amt, now, byPlayer, src); };
  const e2 = engineDamage(s);
  M.Combat.hurt = origHurt;
  brk('Cb.hurt refusing the fall source (pendingFallDamage set but never spent)', !e2.err && e2.before === e2.after);
}

for (const r of reds) console.log('  ✗ ' + r);
console.log(`fallrefcheck: ${HAVE_GOLDEN ? pass - selfPass : 0}${HAVE_GOLDEN ? '/' + SCEN.length + ' golden scenarios, ' : ''}${selfPass}/4 selfcheck, ${reds.length} red · anti-vacuity ${caught}/${breaks}`);
console.log(` assertions passed .... ${pass + caught}`);
console.log(` failures ........... ${reds.length}`);
console.log(` breaks caught ...... ${caught}`);
process.exit(reds.length ? 1 : 0);
