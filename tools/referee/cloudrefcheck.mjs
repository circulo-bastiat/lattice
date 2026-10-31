#!/usr/bin/env node
// cloudrefcheck.mjs — #6081: the LINGERING area_effect_cloud's lifecycle vs the real 1.18.2 server (golden: runcloud.mjs, cloud.json;
// scenario: cloudscen.mjs). Per tick the engine logs the cloud's radius (floor*10000), each victim's poison duration and health,
// and compares them with the server's tick-function log (age-aligned) up to and including the tick the server discards the cloud.
// Anti-vacuity (D-30): reapplication delay 10, no radius decay, and poison duration x1 (not /4) each differ from the server.
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { loadEngine, MCLITE_ROOT } from '../loadsrc.mjs';
import { VICTIMS, DURATION, WAIT, RADIUS, TICKS } from './cloudscen.mjs';

const VERBOSE = process.argv.includes('--verbose');
const refDir = process.env.MCLITE_REFEREE_DIR || join(homedir(), '.mclite-referee', '1.18.2');
const GOLDEN = [join(refDir, 'golden', 'cloud.json'), join(MCLITE_ROOT, '..', 'mclite-store', 'golden', 'cloud.json')].find((f) => existsSync(f));
if (!GOLDEN) { console.log('cloudrefcheck: golden not generated -- run node tools/referee/runarmor.mjs (skipped)'); process.exit(0); }
const golden = JSON.parse(readFileSync(GOLDEN, 'utf8'));
const rdj = (f) => JSON.parse(readFileSync(join(MCLITE_ROOT, 'assets', f), 'utf8'));
const b64 = (f) => readFileSync(join(MCLITE_ROOT, 'assets', f)).toString('base64');
let seed = 0x0a4a0125;
const rng = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
// The engine as the game builds it (the fallrefcheck loader): every 07*.js mob module.
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
M.Diff = { get: () => 'normal' }; M.Player = { x: 0, y: 300, z: 60 };
if (M.Goat && M.Goat.init) M.Goat.init();
M.EntityList.random = rng;
Math.random = rng;
const { EntityList: EL, Items: IT, Equip: Eq, States: S } = M;
const SLOTS = [IT.FEET, IT.LEGS, IT.CHEST, IT.HEAD];
const PAD = 0;
const reapplyOf = (e) => e;
function engineLog(hook) {
  cells.clear(); EL.list.length = 0;
  const stone = S.stateOf('stone');
  for (let x = -6; x <= 6; x++) for (let z = -6; z <= 6; z++) w.set(x, PAD, z, stone);
  const vs = VICTIMS.map((v) => { const e = EL.spawn(v.mob, 0.5 + v.dx, PAD + 1, 0.5); e.persistent = true; e.aiDisabled = true; e.vx = e.vy = e.vz = 0; return e; });
  const cl = EL.spawn('area_effect_cloud', 0.5, PAD + 1, 0.5, { radius: RADIUS, radiusOnUse: -0.5, waitTime: WAIT, duration: DURATION,
    reapplicationDelay: 20, radiusGrowth: Math.fround(-RADIUS / DURATION), potionId: 'poison' });
  if (!cl) throw new Error('EL.spawn(area_effect_cloud) gives nothing');
  if (hook) hook(cl);
  const log = [];
  const snap = () => {
    const o = { age: cl.age, r: Math.floor(cl.radius * 10000) };
    VICTIMS.forEach((v, i) => { o[v.id + 'h'] = vs[i].health; const p = M.Effects.getStatusEffect(vs[i], 'poison'); if (p) o[v.id + 'd'] = p.duration; });
    return o;
  };
  log.push(snap());
  for (let t = 0; t < TICKS && !cl.removed; t++) { EL.tick(); if (!cl.removed) log.push(snap()); }
  return log;
}
const gl = golden.log.map((o) => { const q = { age: o.age, r: Math.floor(Math.fround(o.r) * 10000 + 1e-3) }; for (const k in o) if (/[hd]$/.test(k) && k !== 'age') q[k] = o[k]; return q; });
function diff(log, G) {
  if (log.length !== G.length) return [`cloud lives ${log.length} logged ticks, server ${G.length}`];
  for (let i = 0; i < G.length; i++) {
    const a = log[i], b = G[i];
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
      if (k === 'r' ? Math.abs((a.r || 0) - (b.r || 0)) > 1 : a[k] !== b[k]) return [`age ${b.age}: ${k} engine ${a[k]} server ${b[k]}`];
    }
  }
  return [];
}
const reds = [];
let pass = 0, breaks = 0, caught = 0;
const brk = (name, fired) => { breaks++; if (fired) { caught++; console.log('  ✓ break caught: ' + name); } else reds.push(`anti-vacuity: break "${name}" was NOT caught`); };
console.log(`cloudrefcheck — lingering cloud lifecycle vs the real 1.18.2 server (${gl.length} ticks, ${golden.generatedAt})`);
const base = diff(engineLog(), gl);
if (base.length) reds.push(...base); else pass++;
if (gl.length < 20 || !gl.some((o) => o.cowd !== undefined) || !gl.some((o) => o.cowh < 10)) reds.push('golden too thin (no poison / no health loss / <20 ticks)');
brk('reapplication delay 10', diff(engineLog((c) => { c.reapplicationDelay = 10; }), gl).length > 0);
brk('radius not shrinking', diff(engineLog((c) => { c.radiusGrowth = 0; }), gl).length > 0);
{ const P = M.Potion.POTIONS.poison, d0 = P.effects.map((q) => q.duration); P.effects.forEach((q) => { q.duration *= 4; });
  const bad = diff(engineLog(), gl).length > 0; P.effects.forEach((q, i) => { q.duration = d0[i]; }); brk('effect duration x1 (not /4)', bad); }
for (const r of reds) console.log('  ✗ ' + r);
console.log(`cloudrefcheck: ${pass ? 'agrees' : 'DIFFERS'} on ${gl.length} ticks, ${reds.length} red · anti-vacuity ${caught}/${breaks}`);
console.log(` assertions passed .... ${pass + caught}`);
console.log(` failures ........... ${reds.length}`);
console.log(`${caught} breaks caught`);
process.exit(reds.length ? 1 : 0);
