#!/usr/bin/env node
// breedrefcheck.mjs — infra I6 (s145, 25 Sept 2026): FEEDING + BREEDING vs the real 1.18.2 server (golden: runbreed.mjs,
// breed.json; scenarios: breedscen.mjs). FEED — engine side, the join a right-click on an animal takes: Use.entityUse(P, mob, the
// held stack) on fresh EL.spawn'd mobs with the scene's Age: in love (exact rate), items used per click (exact), water buckets
// handed back (exact), mobs alive (exact), and the growUp step a baby gets — the server's own SUM(ForcedAge)/n (exact), which the
// engine must match in BOTH its Age change and its forcedAge. MATE — Breed.breed(a, b) on two in-love adults: one baby per pair,
// parents out of love, the invariant 2*babyAge + SUM(parentAge) (= 2*babyStartAge + 2*breedCooldownAge; the server reads 1 tick
// lower — the breeding parent has already ticked its Age that tick, AnimalEntity.tickMovement before the goal — so +-1 is
// allowed and said so), and the XP orb value's mean (|z| > 4.5 red). Anti-vacuity (D-30/D-305): the golden cow love count zeroed,
// the engine's Use.entityUse no-op'd for cow_wheat_baby, the golden cooldown scene made to use its wheat, the engine's
// Breed.breed made to skip the parents' cooldown.
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { loadEngine, MCLITE_ROOT } from '../loadsrc.mjs';
import { FEED, MATE } from './breedscen.mjs';
const VERBOSE = process.argv.includes('--verbose');
const refDir = process.env.MCLITE_REFEREE_DIR || join(homedir(), '.mclite-referee', '1.18.2');
const GOLDEN = [join(refDir, 'golden', 'breed.json'), join(MCLITE_ROOT, '..', 'mclite-store', 'golden', 'breed.json')].find((f) => existsSync(f));
if (!GOLDEN) { console.log('breedrefcheck: golden not generated -- run node tools/referee/runbreed.mjs (skipped)'); process.exit(process.env.MCLITE_REQUIRE_REFEREE ? 1 : 0); }
const golden = JSON.parse(readFileSync(GOLDEN, 'utf8'));
const rdj = (f) => JSON.parse(readFileSync(join(MCLITE_ROOT, 'assets', f), 'utf8'));
const b64 = (f) => readFileSync(join(MCLITE_ROOT, 'assets', f)).toString('base64');
let seed = 0x0b4eed01;
const rng = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
// The engine as the game builds it (the fallrefcheck loader): every 07*.js mob module.
const BASE_MODS = ['02f_tags.js', '02g_items.js', '14f_inventory.js', '07b_behaviour.js', '07_world.js', '07h_entities.js',
  '14b_physics.js', '07i_entitylist.js', '07k_goals.js', '07l_spawn.js', '07m_breed.js', '07n_tame.js', '07q_effects.js',
  '07y_equip.js', '10_gfx.js', '15h_bemodel.js', '07j_entityrender.js', '14d_survival.js', '14j_combat.js', '07zw_mobnbt.js',
  '07w_passive.js', '07d_mining.js', '07e_loot.js', '14i_hand.js', '14l_use.js'];
const MOB_MODS = readdirSync(join(MCLITE_ROOT, 'src')).filter((f) => /^07.*\.js$/.test(f) && !BASE_MODS.includes(f)).sort();
const M = loadEngine({ extra: BASE_MODS.concat(MOB_MODS), dom: false, initReg: true });
M.DATA = Object.assign({}, M.DATA, { entities: rdj('entities.json') });
M.Entities.init();
M.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
M.Loot.init({ loot: b64('loot.bin'), lootBytes: rdj('loot.meta.json').jsonBytes });
// the weapon attribute table from the SAME golden file gen-data.mjs inlines into DATA.itemAttrs (the mobpickupcheck recipe, D-335)
{
  const tsv = readFileSync(join(MCLITE_ROOT, 'tools', 'golden', 'item-attributes-1.18.2.tsv'), 'utf8');
  const table = {};
  for (const line of tsv.split(/\r?\n/)) {
    if (!line || line[0] === '#') continue;
    const c = line.split('\t');
    if (c[0] === 'item' || c.length < 9) continue;
    const r16 = (v) => Math.round(parseFloat(v) * 10000) / 10000;
    table[c[0]] = [r16(c[6]), r16(c[7]), +c[8]];
  }
  if (!(M.Hand.bindAttrs(table) > 0)) { console.log('breedrefcheck: empty item attribute table'); process.exit(1); }
}
if (M.Combat.init) M.Combat.init();
const cells = new Map();
const key = (x, y, z) => x + ',' + y + ',' + z;
const w = { get: (x, y, z) => cells.get(key(x, y, z)) || 0, set: (x, y, z, s) => { if (s) cells.set(key(x, y, z), s); else cells.delete(key(x, y, z)); } };
w.getBlock = w.get; w.setBlock = w.set; w.getLight = () => 0; w.tickingAt = () => true;
M.World = Object.assign(M.World || {}, w);
if (M.Behave && M.Behave.init) M.Behave.init(w);
M.Physics.shapeAt = (x, y, z) => { const id = w.get(Math.floor(x), Math.floor(y), Math.floor(z)); return id && M.States.solid[id] === 1 ? M.Physics.shapesFor(id) : null; };
M.Physics.solidAt = (x, y, z) => M.Physics.shapeAt(x, y, z) !== null;
M.EntityList.init(); M.Ai.init(); M.Equip.init(); M.Breed.init(); M.Tame.init(); M.Passive.init();
M.Diff = { get: () => 'normal' }; M.Player = { x: 0, y: 300, z: 60 };
if (M.Goat && M.Goat.init) M.Goat.init();
M.EntityList.random = rng;
Math.random = rng;
const { EntityList: EL, Items: IT, Equip: Eq, States: S } = M;
const { Survival: Sv, Inventory: Iv } = M;
if (!Sv || !Iv) { console.log('breedrefcheck: engine has no Survival/Inventory module loaded'); process.exit(1); }
const N_ENG = 20;
const itemName = (st) => (st && st.i !== undefined && st.n > 0 ? IT.nameOf(st.i) : '');
function feedRun(s, hook) {
  const out = { attempts: 0, love: 0, growSum: 0, forced: 0, alive: 0, used: 0, water: 0 };
  const P = { x: 0.5, y: 1, z: 0.5, vx: 0, vy: 0, vz: 0, yaw: 0, pitch: 0, onGround: true, width: 0.6, height: 1.8, type: 'player',
    slot: 0, instabuild: false, inventory: { slots: new Array(46).fill(null), selected: 0 } };
  Sv.init(P);
  M.Player = P;
  const single = /_bucket$/.test(s.item);
  for (let n = 0; n < N_ENG; n++) {
    cells.clear(); EL.list.length = 0;
    const e = EL.spawn(s.mob, 0.5, 1, 2.5);
    if (!e) return { err: `EL.spawn(${s.mob}) gives nothing` };
    e.persistent = true; e.noAI = true;
    M.Breed.setAge(e, s.age);
    const n0 = single ? 1 : 64;
    const stack = { i: IT.of(s.item), n: n0 };
    if (!stack.i) return { err: `no engine item ${s.item}` };
    P.inventory.slots[0] = stack;
    const age0 = M.Breed.getAge(e);
    if (hook) hook(P, e, stack); else M.Use.entityUse(P, e, stack);
    out.attempts++;
    if (M.Breed.isInLove(e)) out.love++;
    out.growSum += M.Breed.getAge(e) - age0;
    out.forced += e.forcedAge | 0;
    if (!e.removed && !e.dead && e.health > 0) out.alive++;
    const held = P.inventory.slots[0];
    const name = itemName(held);
    if (name === 'water_bucket') out.water++;
    const left = name === s.item ? held.n : 0;
    out.used += n0 - left;
  }
  return out;
}
const reds = [];
let pass = 0;
const pct = (a, n) => (n ? (100 * a / n).toFixed(1) + '%' : 'n/a');
function compareFeed(s, g, e) {
  if (e.err) return [`${s.id}: ${e.err}`];
  const out = [], what = `right-click a ${s.age < 0 ? 'baby' : s.age > 0 ? 'breeding-cooldown' : 'grown'} ${s.mob} (Age ${s.age}) holding ${s.item}`;
  const r = (k) => [g[k] / g.attempts, e[k] / e.attempts];
  for (const [k, label] of [['love', 'fell in love'], ['alive', 'still alive'], ['water', 'handed a water bucket back']]) {
    const [a, b] = r(k);
    if (Math.abs(a - b) > 1e-9) out.push(`${s.id}: ${what}: ${label} ${pct(g[k], g.attempts)} on the server, ${pct(e[k], e.attempts)} in the engine`);
  }
  { const [a, b] = r('used'); if (Math.abs(a - b) > 1e-9) out.push(`${s.id}: ${what}: ${a.toFixed(3)} item(s) used per click on the server, ${b.toFixed(3)} in the engine`); }
  const gGrow = g.forced / g.attempts;
  if (Math.abs(gGrow - e.forced / e.attempts) > 1e-9) out.push(`${s.id}: ${what}: ForcedAge +${gGrow} ticks on the server, ${e.forced / e.attempts} in the engine`);
  if (Math.abs(gGrow - e.growSum / e.attempts) > 1e-9) out.push(`${s.id}: ${what}: Age grows ${gGrow} ticks on the server, ${e.growSum / e.attempts} in the engine`);
  return out;
}
function mateRun(s, breakHook) {
  const out = { pairs: 0, babies: 0, invariant: [], parentsInLove: 0, xp: 0, xpN: 0 };
  let captured = null;
  const XP = M.Xp;
  const origXp = XP && XP.spawn;
  if (XP) XP.spawn = function (x, y, z, amount) { captured = amount; return origXp ? origXp.apply(this, arguments) : null; };
  try {
    for (let n = 0; n < 3000; n++) {
      cells.clear(); EL.list.length = 0;
      const a = EL.spawn(s.mob, 0.5, 1, 0.5), b = EL.spawn(s.mob, 1.5, 1, 0.5);
      if (!a || !b) return { err: `EL.spawn(${s.mob}) gives nothing` };
      M.Breed.setAge(a, 0); M.Breed.setAge(b, 0);
      M.Breed.setInLove(a, null); M.Breed.setInLove(b, null);
      captured = null;
      if (breakHook) breakHook(a, b);
      const child = M.Breed.breed(a, b, { random: rng });
      out.pairs++;
      if (child) {
        out.babies++;
        if (n < 50) out.invariant.push(2 * M.Breed.getAge(child) + M.Breed.getAge(a) + M.Breed.getAge(b));
      }
      if (M.Breed.isInLove(a)) out.parentsInLove++;
      if (M.Breed.isInLove(b)) out.parentsInLove++;
      if (captured === null) { const orb = EL.list.find((q) => q.type === 'experience_orb' || /experience_orb/.test(q.type)); if (orb) captured = orb.value; }
      if (captured !== null) { out.xp += captured; out.xpN++; }
    }
  } finally { if (XP) XP.spawn = origXp; }
  return out;
}
function compareMate(s, g, e) {
  if (e.err) return [`${s.id}: ${e.err}`];
  const out = [], what = `two in-love ${s.mob}s`;
  if (g.babies / g.pairs !== e.babies / e.pairs) out.push(`${s.id}: ${what}: ${g.babies}/${g.pairs} babies on the server, ${e.babies}/${e.pairs} in the engine`);
  if ((g.parentsInLove > 0) !== (e.parentsInLove > 0)) out.push(`${s.id}: ${what}: parents still in love after breeding: server ${g.parentsInLove}, engine ${e.parentsInLove}`);
  const gi = g.invariant, ei = e.invariant;
  if (!gi.length || !ei.length) out.push(`${s.id}: ${what}: no birth to measure (server ${gi.length}, engine ${ei.length})`);
  else for (const v of new Set(ei)) if (!gi.every((q) => Math.abs(q - v) <= 1)) { out.push(`${s.id}: ${what}: 2*babyAge + parents' Age = ${JSON.stringify([...new Set(gi)])} on the server (+-1 tick order), ${v} in the engine`); break; }
  return out;
}
let breaks = 0, caught = 0;
const brk = (name, fired) => { breaks++; if (fired) caught++; else reds.push(`anti-vacuity: break "${name}" was NOT caught`); };
console.log(`breedrefcheck — feeding + breeding vs the real 1.18.2 server (${FEED.length} feed + ${MATE.length} mate scenarios, ${golden.generatedAt})`);
for (const s of FEED) {
  const g = golden.cases[s.id];
  if (!g || !g.attempts) { reds.push(`${s.id}: no golden case`); continue; }
  const e = feedRun(s);
  const bad = compareFeed(s, g, e);
  if (bad.length) reds.push(...bad); else pass++;
  if (VERBOSE) console.log(`  ${s.id.padEnd(24)} server love ${pct(g.love, g.attempts)} used ${(g.used / g.attempts).toFixed(2)} grow ${g.forced / g.attempts}  |  engine ${e.err || `love ${pct(e.love, e.attempts)} used ${(e.used / e.attempts).toFixed(2)} grow ${e.growSum / e.attempts}/${e.forced / e.attempts}`}`);
}
let gx = 0, gxN = 0;
const engX = { xp: 0, xpN: 0 };
for (const s of MATE) {
  const g = golden.cases[s.id];
  if (!g || !g.pairs) { reds.push(`${s.id}: no golden case`); continue; }
  const e = mateRun(s);
  const bad = compareMate(s, g, e);
  if (bad.length) reds.push(...bad); else pass++;
  gx += g.xp; gxN += g.babies; engX.xp += e.xp || 0; engX.xpN += e.xpN || 0;
  if (VERBOSE) console.log(`  ${s.id.padEnd(24)} server babies ${g.babies}/${g.pairs} inv ${JSON.stringify(g.invariant)} xp ${g.xp}  |  engine ${e.err || `babies ${e.babies}/${e.pairs} inv ${[...new Set(e.invariant)]} xp mean ${(e.xp / e.xpN).toFixed(2)}`}`);
}
// XP: nextInt(7)+1 per birth -- sd 2 per birth; the server's orb values summed across every pen
function xpVerdict(gx, gxN, ex, exN) {
  if (!exN) return 'the engine spawned no breeding XP at all';
  const d = gx / gxN - ex / exN, lim = 4.5 * 2 / Math.sqrt(gxN);
  return Math.abs(d) > lim ? `breeding XP: mean ${(gx / gxN).toFixed(2)} per birth on the server (${gxN} births), ${(ex / exN).toFixed(2)} in the engine` : null;
}
{ const v = xpVerdict(gx, gxN, engX.xp, engX.xpN); if (v) reds.push(v); else pass++; }
const total = FEED.length + MATE.length + 1;
{ const s = FEED.find((q) => q.id === 'cow_wheat'); const g = Object.assign({}, golden.cases[s.id], { love: 0 });
  brk('golden cow_wheat love count zeroed', compareFeed(s, g, feedRun(s)).length > 0); }
{ const s = FEED.find((q) => q.id === 'cow_wheat_baby');
  brk('engine Use.entityUse no-op (cow_wheat_baby)', compareFeed(s, golden.cases[s.id], feedRun(s, () => {})).length > 0); }
{ const s = FEED.find((q) => q.id === 'cow_wheat_cooldown'); const g = Object.assign({}, golden.cases[s.id]); g.used = g.attempts;
  brk('golden cow_wheat_cooldown made to spend its wheat', compareFeed(s, g, feedRun(s)).length > 0); }
{ const s = MATE.find((q) => q.id === 'cow_mate'); const C0 = M.Breed.C.breedCooldownAge; M.Breed.C.breedCooldownAge = 0;
  let e; try { e = mateRun(s); } finally { M.Breed.C.breedCooldownAge = C0; }
  brk('engine Breed.breed skips the parents\' cooldown (cow_mate)', compareMate(s, golden.cases[s.id], e).length > 0); }
brk('breeding XP mean moved by 3', xpVerdict(gx + 3 * gxN, gxN, engX.xp, engX.xpN) !== null);
for (const r of reds) console.log('  ✗ ' + r);
console.log(`breedrefcheck: ${pass}/${total} verdicts agree, ${reds.length} red · anti-vacuity ${caught}/${breaks}`);
console.log(` assertions passed .... ${pass + caught}`);
console.log(` failures ........... ${reds.length}`);
console.log(` breaks caught ...... ${caught}`);
process.exit(reds.length ? 1 : 0);
