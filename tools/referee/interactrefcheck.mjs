#!/usr/bin/env node
// interactrefcheck.mjs — infra I6 (s145, 25 Sept 2026): MOB RIGHT-CLICK INTERACTIONS vs the real 1.18.2 server (golden:
// runinteract.mjs, interact.json; scenarios: interactscen.mjs) — milking, stew, shearing, dyeing, saddling, bucketing. Engine side,
// the join a right-click on a mob takes: Use.entityUse(P, mob, the held stack) with the inventory holding exactly `n` of the item in
// hotbar slot 0. Judged per click (exact): the main-hand stack after (id x count @damage, as a distribution), the `gets` item count
// in the inventory, SUM(flag) of the clicked mobs, mobs still there, `becomes` mobs, and the dropped totals (exact, except wool:
// 1 + nextInt(3) per shear, mean compared at |z| > 4.5). Anti-vacuity (D-30/D-305): the golden cow_bucket held item swapped to a
// plain bucket, the engine's Use.entityUse no-op'd for sheep_shears, the golden mooshroom_shears drops halved.
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { loadEngine, MCLITE_ROOT } from '../loadsrc.mjs';
import { SCEN, DYE } from './interactscen.mjs';
const VERBOSE = process.argv.includes('--verbose');
const refDir = process.env.MCLITE_REFEREE_DIR || join(homedir(), '.mclite-referee', '1.18.2');
const GOLDEN = [join(refDir, 'golden', 'interact.json'), join(MCLITE_ROOT, '..', 'mclite-store', 'golden', 'interact.json')].find((f) => existsSync(f));
if (!GOLDEN) { console.log('interactrefcheck: golden not generated -- run node tools/referee/runinteract.mjs (skipped)'); process.exit(0); }
const golden = JSON.parse(readFileSync(GOLDEN, 'utf8'));
const rdj = (f) => JSON.parse(readFileSync(join(MCLITE_ROOT, 'assets', f), 'utf8'));
const b64 = (f) => readFileSync(join(MCLITE_ROOT, 'assets', f)).toString('base64');
let seed = 0x1a7e2ac7;
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
  if (!(M.Hand.bindAttrs(table) > 0)) { console.log('interactrefcheck: empty item attribute table'); process.exit(1); }
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
if (!Sv || !Iv) { console.log('interactrefcheck: engine has no Survival/Inventory module loaded'); process.exit(1); }
const N_ENG = 200;
const nameOf = (st) => (st && st.i !== undefined && (st.n | 0) > 0 ? IT.nameOf(st.i) || '' : '');
const FLAG = {
  Sheared: (e) => (e.sheared ? 1 : 0),
  Color: (e) => Math.max(0, DYE.indexOf(e.woolColor || 'white')),
  Pumpkin: (e) => (e.hasPumpkin === false ? 0 : 1),
  Saddle: (e) => (e.saddled ? 1 : 0),
};
function applyNbt(e, nbt) {
  // an NBT summon has NO finalizeSpawn roll: an adult, white, unsheared, unsaddled, red -- the engine's EL.spawn may roll a baby /
  // a natural wool colour / a jockey saddle, so the server's defaults are put back first (a harness false red on the first run).
  M.Breed.setAge(e, 0); e.sheared = false; e.saddled = false;
  if (e.type === 'sheep') e.woolColor = 'white';
  if (e.type === 'mooshroom') e.mooshroomType = 'red';
  for (const part of String(nbt || '').split(',').filter(Boolean)) {
    const [k, v] = part.split(':');
    if (k === 'Age') M.Breed.setAge(e, +v);
    else if (k === 'Type') e.mooshroomType = v.replace(/"/g, '');
    else if (k === 'Color') e.woolColor = DYE[parseInt(v, 10)];
    else if (k === 'Sheared') e.sheared = true;
    else if (k === 'Saddle') e.saddled = true;
    else throw new Error('interactrefcheck: no engine mapping for NBT ' + part);
  }
}
function engineRun(s, hook) {
  const out = { attempts: 0, held: {}, gets: 0, drops: {}, flag: 0, alive: 0, becomes: 0 };
  for (const d of s.drops || []) out.drops[d] = 0;
  const P = { x: 0.5, y: 1, z: 0.5, vx: 0, vy: 0, vz: 0, yaw: 0, pitch: 0, onGround: true, width: 0.6, height: 1.8, type: 'player',
    slot: 0, instabuild: false, inventory: { slots: new Array(46).fill(null), selected: 0 } };
  Sv.init(P);
  M.Player = P;
  for (let n = 0; n < N_ENG; n++) {
    cells.clear(); EL.list.length = 0;
    const e = EL.spawn(s.mob, 0.5, 1, 4.5);
    if (!e) return { err: `EL.spawn(${s.mob}) gives nothing` };
    e.persistent = true; e.noAI = true;
    try { applyNbt(e, s.nbt); } catch (err) { return { err: err.message }; }
    P.inventory.slots.fill(null);
    const stack = { i: IT.of(s.item), n: s.n };
    if (!(stack.i >= 0)) return { err: `no engine item ${s.item}` };
    P.inventory.slots[0] = stack;
    if (hook) hook(P, e, stack); else M.Use.entityUse(P, e, stack);
    out.attempts++;
    const h = P.inventory.slots[0];
    const hn = nameOf(h);
    const k = `${hn}x${hn ? h.n : 0}${hn && h.d ? '@' + h.d : ''}`;
    out.held[k] = (out.held[k] || 0) + 1;
    if (s.gets) for (const st of P.inventory.slots) if (nameOf(st) === s.gets) out.gets += st.n;
    for (const q of EL.list) {
      if (q.type === 'item') { const nm = typeof q.item === 'string' ? q.item.replace('minecraft:', '') : IT.nameOf(q.item); if (nm in out.drops) out.drops[nm] += q.count | 0; }
      if (s.becomes && q.type === s.becomes && !q.removed) out.becomes++;
    }
    const alive = !e.removed && !e.dead;
    if (alive) out.alive++;
    if (s.flag && alive) out.flag += FLAG[s.flag](e);
  }
  return out;
}
const reds = [];
let pass = 0;
const fmt = (m, n) => Object.entries(m).map(([k, v]) => `${k || 'empty'} ${(100 * v / n).toFixed(0)}%`).join(', ') || '-';
function compare(s, g, e) {
  if (e.err) return [`${s.id}: ${e.err}`];
  const out = [], what = `right-click ${s.nbt ? `a ${s.mob} {${s.nbt}}` : `a ${s.mob}`} holding ${s.n} ${s.item}`;
  const keys = new Set([...Object.keys(g.held), ...Object.keys(e.held)]);
  for (const k of keys) if (Math.abs((g.held[k] || 0) / g.attempts - (e.held[k] || 0) / e.attempts) > 1e-9) {
    out.push(`${s.id}: ${what}: main hand after — server ${fmt(g.held, g.attempts)} · engine ${fmt(e.held, e.attempts)}`); break;
  }
  const per = (a, n) => a / n;
  if (s.gets && Math.abs(per(g.gets, g.attempts) - per(e.gets, e.attempts)) > 1e-9) out.push(`${s.id}: ${what}: ${per(g.gets, g.attempts).toFixed(2)} ${s.gets} per click in the inventory on the server, ${per(e.gets, e.attempts).toFixed(2)} in the engine`);
  if (s.flag && Math.abs(per(g.flag, g.attempts) - per(e.flag, e.attempts)) > 1e-9) out.push(`${s.id}: ${what}: ${s.flag} ${per(g.flag, g.attempts).toFixed(2)} per mob on the server, ${per(e.flag, e.attempts).toFixed(2)} in the engine`);
  for (const k of ['alive', 'becomes']) if (Math.abs(per(g[k], g.attempts) - per(e[k], e.attempts)) > 1e-9) out.push(`${s.id}: ${what}: ${k} ${per(g[k], g.attempts).toFixed(2)} per click on the server, ${per(e[k], e.attempts).toFixed(2)} in the engine`);
  for (const d of s.drops || []) {
    const a = per(g.drops[d] || 0, g.attempts), b = per(e.drops[d] || 0, e.attempts);
    const lim = /_wool$/.test(d) && a > 0 && b > 0 ? 4.5 * Math.sqrt(2 / 3) / Math.sqrt(g.attempts) : 1e-9;   // 1+nextInt(3): sd sqrt(2/3)
    if (Math.abs(a - b) > lim) out.push(`${s.id}: ${what}: ${a.toFixed(2)} ${d} dropped per click on the server, ${b.toFixed(2)} in the engine`);
  }
  return out;
}
let breaks = 0, caught = 0;
const brk = (name, fired) => { breaks++; if (fired) caught++; else reds.push(`anti-vacuity: break "${name}" was NOT caught`); };
console.log(`interactrefcheck — mob right-click interactions vs the real 1.18.2 server (${SCEN.length} scenarios, ${golden.generatedAt})`);
for (const s of SCEN) {
  const g = golden.cases[s.id];
  if (!g || !g.attempts) { reds.push(`${s.id}: no golden case`); continue; }
  const e = engineRun(s);
  const bad = compare(s, g, e);
  if (bad.length) reds.push(...bad); else pass++;
  if (VERBOSE) console.log(`  ${s.id.padEnd(28)} server ${fmt(g.held, g.attempts)} | engine ${e.err || fmt(e.held, e.attempts)}`);
}
{ const s = SCEN.find((q) => q.id === 'cow_bucket'); const g = Object.assign({}, golden.cases[s.id], { held: { bucketx1: golden.cases[s.id].attempts } });
  brk('golden cow_bucket main hand swapped to a plain bucket', compare(s, g, golden.cases[s.id]).length > 0); }
{ const s = SCEN.find((q) => q.id === 'sheep_shears');
  brk('engine Use.entityUse no-op (sheep_shears)', compare(s, golden.cases[s.id], engineRun(s, () => {})).length > 0); }
{ const s = SCEN.find((q) => q.id === 'mooshroom_shears'); const g0 = golden.cases[s.id];
  const g = Object.assign({}, g0, { drops: { red_mushroom: Math.floor((g0.drops.red_mushroom || 0) / 2) } });
  brk('golden mooshroom_shears drops halved', compare(s, g, g0).length > 0); }
// stored-flower stew (engine-only: the golden pack has no flower scene): survival keeps 7 bowls + 1 stew WITH Effects; creative keeps the tag
function stewRun(creative, hook) {
  const P = { x: 0.5, y: 1, z: 0.5, vx: 0, vy: 0, vz: 0, yaw: 0, pitch: 0, onGround: true, width: 0.6, height: 1.8, type: 'player',
    slot: 0, instabuild: creative, inventory: { slots: new Array(46).fill(null), selected: 0 } };
  Sv.init(P); M.Player = P; cells.clear(); EL.list.length = 0;
  const e = EL.spawn('mooshroom', 0.5, 1, 4.5); e.persistent = true; e.noAI = true; applyNbt(e, 'Type:"brown"');
  e.stewEffect = { id: 16, ticks: 160 };
  const stack = { i: IT.of('bowl'), n: 8 }; P.inventory.slots[0] = stack;
  (hook || M.Use.entityUse)(P, e, stack);
  const all = P.inventory.slots.filter((x) => x && (x.n | 0) > 0);
  const stew = all.find((x) => nameOf(x) === 'suspicious_stew');
  const bowls = all.reduce((a, x) => a + (nameOf(x) === 'bowl' ? x.n : 0), 0);
  return { bowls, hasEffect: !!(stew && JSON.stringify(stew).includes('Effects')) };
}
const stewBad = (creative, r) => creative ? !r.hasEffect : !(r.bowls === 7 && r.hasEffect);
for (const c of [false, true]) { const r = stewRun(c); if (stewBad(c, r)) reds.push(`mooshroom_stew_effect_stack8 (${c ? 'creative' : 'survival'}): bowls ${r.bowls}, effect ${r.hasEffect}`); else pass++; }
brk('stew branch destroys the stack / drops the tag', stewBad(false, stewRun(false, (P, e, st) => { M.Use.entityUse(P, e, st); P.inventory.slots[0] = { i: IT.of('suspicious_stew'), n: 1 }; })));
// stew-effect mooshroom (no server golden): ItemUsage.exchangeStack spends ONE of 8 bowls, the suspicious stew goes elsewhere (#2400)
{ const s = { id: 'mooshroom_bowl_stack8_stew', mob: 'mooshroom', item: 'bowl', n: 8, gets: 'suspicious_stew' };
  const eff = (P, e, st) => { e.stewEffect = { id: 8, ticks: 100 }; M.Use.entityUse(P, e, st); };
  const ok = (r) => !r.err && r.held['bowlx7'] === r.attempts && r.gets === r.attempts;
  const e = engineRun(s, eff);
  if (ok(e)) pass++; else reds.push(`${s.id}: stack of 8 bowls on a stew-effect mooshroom: engine held ${fmt(e.held || {}, e.attempts)}, ${e.gets} stew`);
  brk('stew-effect case: old overwrite-the-slot behaviour', !ok(engineRun(s, (P, e2, st) => { P.inventory.slots[0] = { i: IT.of('suspicious_stew'), n: 1 }; }))); }
// #3557 cat taming/heal feed (engine-only): cod plays entity.cat.eat; a FAILED taming roll still setPersistent()s the cat
function catRun(tamed, hook) {
  const P = { x: 0.5, y: 1, z: 0.5, vx: 0, vy: 0, vz: 0, yaw: 0, pitch: 0, onGround: true, width: 0.6, height: 1.8, type: 'player',
    slot: 0, instabuild: false, inventory: { slots: new Array(46).fill(null), selected: 0 } };
  Sv.init(P); M.Player = P; cells.clear(); EL.list.length = 0;
  const e = EL.spawn('cat', 0.5, 1, 4.5); e.noAI = true; e.persistent = false; M.Breed.setAge(e, 0);
  if (tamed) { e.tamed = true; e.owner = 'player'; e.health = 1; }
  const stack = { i: IT.of('cod'), n: 4 }; P.inventory.slots[0] = stack;
  const sounds = [], old = M.MobVoice; M.MobVoice = { emit: (q, n) => sounds.push(n) };
  const oldRand = Math.random; Math.random = () => 0.5;   // taming roll != 0: fails
  const oldPR = M.Player.random; M.Player.random = { nextDouble: () => 0.5 };   // Use.pRand draws from Player.random (since the per-stream rngs)
  try { (hook || M.Use.entityUse)(P, e, stack); } finally { M.MobVoice = old; Math.random = oldRand; M.Player.random = oldPR; }
  return { persistent: !!e.persistent, ate: sounds.includes('entity.cat.eat'), tamed: !!e.tamed };
}
const catBad = (tamed, r) => !r.ate || (!tamed && (!r.persistent || r.tamed));
for (const t of [false, true]) { const r = catRun(t); if (catBad(t, r)) reds.push(`cat_${t ? 'heal_sound' : 'tame_fail_persistent'}: ${JSON.stringify(r)}`); else pass++; }
brk('cat feed does nothing (no sound, not persistent)', catBad(false, catRun(false, () => {})));
// #3957 parrot_tamed_sit_with_item (ParrotEntity.interactMob last branch): tamed + grounded toggles with ANY held item, seeds not consumed; airborne never
function parrotRun(item, onGround, hook) {
  const P = { x: 0.5, y: 1, z: 0.5, vx: 0, vy: 0, vz: 0, yaw: 0, pitch: 0, onGround: true, width: 0.6, height: 1.8, type: 'player',
    slot: 0, instabuild: false, inventory: { slots: new Array(46).fill(null), selected: 0 } };
  Sv.init(P); M.Player = P; cells.clear(); EL.list.length = 0;
  const e = EL.spawn('parrot', 0.5, 1, 4.5); e.noAI = true; e.tamed = true; e.owner = 'player'; e.onGround = onGround; e.sitting = false;
  const stack = { i: IT.of(item), n: 4 }; P.inventory.slots[0] = stack;
  (hook || M.Use.entityUse)(P, e, stack);
  return { sitting: !!e.sitting, n: stack.n };
}
const parrotBad = (item, ground, r) => r.sitting !== ground || r.n !== 4;
for (const [item, ground] of [['stick', true], ['wheat_seeds', true], ['stick', false], ['wheat_seeds', false]]) {
  const r = parrotRun(item, ground); if (parrotBad(item, ground, r)) reds.push(`parrot_tamed_sit_with_item (${item}, ${ground ? 'grounded' : 'airborne'}): ${JSON.stringify(r)}`); else pass++;
}
brk('parrot non-empty click ignored', parrotBad('stick', true, parrotRun('stick', true, () => {})));
// #4312 MooshroomEntity.interactMob: sheared(SoundCategory.PLAYERS) -> the shear sound is on the PLAYERS slider
function shearSrc(hook) {
  const P = { x: 0.5, y: 1, z: 0.5, vx: 0, vy: 0, vz: 0, yaw: 0, pitch: 0, onGround: true, width: 0.6, height: 1.8, type: 'player',
    slot: 0, instabuild: false, inventory: { slots: new Array(46).fill(null), selected: 0 } };
  Sv.init(P); M.Player = P; cells.clear(); EL.list.length = 0;
  const e = EL.spawn('mooshroom', 0.5, 1, 4.5); e.persistent = true; e.noAI = true;
  const stack = { i: IT.of('shears'), n: 1 }; P.inventory.slots[0] = stack;
  const plays = [], old = M.Sound; M.Sound = { play: (ev, o) => { plays.push([ev, o && o.source]); }, entitySound: (ev, x, y, z, v, p, src) => { plays.push([ev, src]); } };
  try { (hook || M.Use.entityUse)(P, e, stack); } finally { M.Sound = old; }
  return plays.filter((p) => p[0] === 'entity.mooshroom.shear').map((p) => p[1]);
}
const shearBad = (r) => r.length !== 1 || r[0] !== 'player';
{ const r = shearSrc(); if (shearBad(r)) reds.push(`mooshroom_shear_sound_category: ${JSON.stringify(r)}`); else pass++;
  brk('shear sound neutral category', shearBad(shearSrc((P, e, st) => { M.Sound.entitySound('entity.mooshroom.shear', 0, 0, 0, 1, 1, 'neutral'); }))); }
for (const r of reds) console.log('  ✗ ' + r);
console.log(`interactrefcheck: ${pass}/${SCEN.length + 1} scenarios agree, ${reds.length} red · anti-vacuity ${caught}/${breaks}`);
console.log(` assertions passed .... ${pass + caught}`);
console.log(` failures ........... ${reds.length}`);
console.log(` breaks caught ...... ${caught}`);
process.exit(reds.length ? 1 : 0);
