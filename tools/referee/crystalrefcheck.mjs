#!/usr/bin/env node
// crystalrefcheck.mjs — #6082: an end_crystal hit (EndCrystalEntity.damage: power 6.0, DESTROY) vs the real 1.18.2 server
// (golden: runcrystal.mjs -> crystal.json; scene: crystalscen.mjs). Server: an arrow into the crystal; engine: EC.damage with a
// non-explosive source. Compares per-cell destruction rates, the destroyed-count mean and the pigs' damage 3 and 8 blocks away
// (exact). Anti-vacuity: power 6 -> 5, fire/explosive flag inverted, golden pig health shifted, a golden cell flipped.
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { loadEngine, MCLITE_ROOT } from '../loadsrc.mjs';
import { R, W, ENGINE_N, PIGS, readCells } from './crystalscen.mjs';
const refDir = process.env.MCLITE_REFEREE_DIR || join(homedir(), '.mclite-referee', '1.18.2');
const GOLDEN = [join(refDir, 'golden', 'crystal.json'), join(MCLITE_ROOT, '..', 'mclite-store', 'golden', 'crystal.json')].find((f) => existsSync(f));
if (!GOLDEN) { console.log('crystalrefcheck: SKIP (golden not generated -- run node tools/referee/runcrystal.mjs)'); process.exit(0); }
const golden = JSON.parse(readFileSync(GOLDEN, 'utf8'));
const rdj = (f) => JSON.parse(readFileSync(join(MCLITE_ROOT, 'assets', f), 'utf8'));
const b64 = (f) => readFileSync(join(MCLITE_ROOT, 'assets', f)).toString('base64');
// The engine as the game builds it: tntrefcheck's list + every src/07*.js, so the creeper gets its goal selector (`e.ai`) and
// EL.tickOne reaches EL.tickMob, where Creeper.tick runs (07i_entitylist.js ~:1407).
const EXTRA0 = ['02f_tags.js', '02g_items.js', '02h_recipes.js', '14f_inventory.js', '07b_behaviour.js', '07c_blockentity.js',
  '14b_physics.js', '07f_redstone.js', '07h_entities.js', '07i_entitylist.js', '07d_mining.js', '07e_loot.js', '14l_use.js',
  '07za_explosion.js', '07zc_tnt.js', '07_world.js', '07k_goals.js', '07l_spawn.js', '07m_breed.js', '07n_tame.js', '07q_effects.js',
  '07y_equip.js', '10_gfx.js', '15h_bemodel.js', '07j_entityrender.js', '14d_survival.js', '14j_combat.js', '07zw_mobnbt.js', '07w_passive.js'];
const EXTRA = EXTRA0.concat(readdirSync(join(MCLITE_ROOT, 'src')).filter((f) => /^07.*\.js$/.test(f) && !EXTRA0.includes(f)).sort());

let seed = 0x7a7a1234;
const rng = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };

function makeEngine(hook) {
  const M = loadEngine({ extra: EXTRA, dom: false });
  M.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
  M.Recipes.init({ recipes: b64('recipes.bin'), recipesBytes: rdj('recipes.meta.json').jsonBytes });
  M.Loot.init({ loot: b64('loot.bin'), lootBytes: rdj('loot.meta.json').jsonBytes });
  M.DATA = Object.assign({}, M.DATA, { entities: rdj('entities.json') });
  const cells = new Map();
  const key = (x, y, z) => x + ',' + y + ',' + z;
  const w = { get: (x, y, z) => cells.get(key(x, y, z)) || 0, set: (x, y, z, s) => { if (s) cells.set(key(x, y, z), s); else cells.delete(key(x, y, z)); } };
  w.getBlock = w.get; w.setBlock = w.set; w.getLight = () => 15 << 4; w.clear = () => cells.clear();
  M.World = w;
  M.Behave.init(w);
  M.BlockEntities.init();
  M.Redstone.init();
  M.Entities.init();
  M.EntityList.init();
  M.Ai.init(); M.Breed.init(); M.Tame.init(); if (M.Equip && M.Equip.init) M.Equip.init();
  M.Diff = { get: () => 'easy' }; M.Player = { x: 0, y: 300, z: 0 };
  M.Use.init(w);
  M.Physics.shapeAt = (x, y, z) => { const id = w.get(Math.floor(x), Math.floor(y), Math.floor(z)); return id && M.States.solid[id] === 1 ? M.Physics.shapesFor(id) : null; };
  M.Physics.solidAt = (x, y, z) => M.Physics.shapeAt(x, y, z) !== null;
  M.Explosion.init();
  M.Tnt.init();
  M.EntityList.random = rng;
  const realRandom = Math.random;
  Math.random = rng;                      // Explosion's rays and the chain fuse default to Math.random: seed them (reproducible reds)
  if (hook) hook(M);
  return { M, w, restore: () => { Math.random = realRandom; } };
}


function engineHit(n, hook) {
  const { M, w, restore } = makeEngine(hook);
  const S_ = M.States, EL = M.EntityList, EC = M.EndCrystal;
  const dirt = S_.stateOf('dirt');
  const box = readCells();
  const air = new Array(box.length).fill(0), destroyed = [], pig = { p3: [], p8: [] };
  for (let t = 0; t < n; t++) {
    w.clear(); EL.list.length = 0;
    for (let x = -W; x <= W; x++) for (let y = -3; y <= -1; y++) for (let z = -W; z <= W; z++) w.set(x, y, z, dirt);
    const c = EL.spawn('end_crystal', 0.5, 0, 0.5);
    if (!c) { restore(); return { err: 'EL.spawn(end_crystal) returned null' }; }
    const pigs = PIGS.map((p) => { const e = EL.spawn('pig', 0.5, 0, 0.5 + p.dz); if (e) { e.maxHealth = 1000; e.health = 1000; e.noGravity = true; e.persistent = true; } return e; });
    if (pigs.some((e) => !e)) { restore(); return { err: 'EL.spawn(pig) returned null' }; }
    if (!EC.damage(c, { attacker: null })) { restore(); return { err: 'EC.damage refused a plain hit' }; }
    let a = 0;
    box.forEach(([x, y, z], i) => { if (w.get(x, y, z) === 0) { air[i]++; a++; } });
    destroyed.push(a);
    PIGS.forEach((p, i) => pig[p.tag].push(pigs[i].health));
  }
  restore();
  return { air, destroyed, pig, trials: n };
}

const mean = (a) => a.reduce((s, x) => s + x, 0) / Math.max(1, a.length);
const vari = (a) => { const m = mean(a); return a.reduce((s, x) => s + (x - m) * (x - m), 0) / Math.max(1, a.length - 1); };
function compare(g, e) {
  const bad = [], box = readCells();
  let cellReds = 0; const worst = [];
  for (let i = 0; i < box.length; i++) {
    const pg = g.air[i] / g.trials, pe = e.air[i] / e.trials;
    if ((pg === 0 || pg === 1) && pg === pe) continue;
    const p = (g.air[i] + e.air[i]) / (g.trials + e.trials);
    const se = Math.sqrt(p * (1 - p) * (1 / g.trials + 1 / e.trials));
    const z = se > 0 ? (pe - pg) / se : (pe === pg ? 0 : Infinity);
    if (Math.abs(z) > 5) { cellReds++; worst.push([Math.abs(z), `(${box[i].join(',')}) server ${pg.toFixed(2)} engine ${pe.toFixed(2)}`]); }
  }
  if (cellReds) { worst.sort((a, b) => b[0] - a[0]); bad.push(`${cellReds}/${box.length} cells break at a different rate (worst ${worst.slice(0, 3).map((w) => w[1]).join('; ')})`); }
  const mg = mean(g.destroyed), me = mean(e.destroyed), se = Math.sqrt(vari(g.destroyed) / g.destroyed.length + vari(e.destroyed) / e.destroyed.length);
  if (Math.abs(me - mg) > Math.max(4 * se, 1)) bad.push(`destroyed cells mean server ${mg.toFixed(1)} engine ${me.toFixed(1)}`);
  for (const p of PIGS) {
    const gm = mean(g.pig[p.tag]), em = mean(e.pig[p.tag]);
    if (Math.abs(gm - em) > 0.01 + 4 * Math.sqrt(vari(g.pig[p.tag]) / g.trials + vari(e.pig[p.tag]) / e.trials)) bad.push(`pig ${p.dz} blocks away: health server ${gm.toFixed(2)} engine ${em.toFixed(2)}`);
  }
  return bad;
}

const reds = [];
console.log(`crystalrefcheck — end_crystal hit vs the real 1.18.2 server (${golden.blast.trials} trials, ${golden.generatedAt})`);
const eng = engineHit(ENGINE_N);
if (eng.err) { console.log('  ✗ ' + eng.err); process.exit(1); }
const base = compare(golden.blast, eng);
reds.push(...base);
console.log(`  destroyed mean server ${mean(golden.blast.destroyed).toFixed(1)} engine ${mean(eng.destroyed).toFixed(1)} · pig3 server ${mean(golden.blast.pig.p3).toFixed(1)} engine ${mean(eng.pig.p3).toFixed(1)} · pig8 server ${mean(golden.blast.pig.p8).toFixed(1)} engine ${mean(eng.pig.p8).toFixed(1)}`);
let breaks = 0, caught = 0;
const brk = (name, fired) => { breaks++; if (fired) { caught++; console.log(`  ✓ break caught: ${name}`); } else reds.push(`anti-vacuity: break "${name}" was NOT caught`); };
{ const e = engineHit(ENGINE_N, (M) => { const f = M.Explosion.explode; M.Explosion.explode = (s, x, y, z, p, ...r) => f(s, x, y, z, 5, ...r); });
  brk('power 6 -> 5', !!e.err || compare(golden.blast, e).length > base.length); }
{ const e = engineHit(ENGINE_N, (M) => { const f = M.Explosion.explode; M.Explosion.explode = (s, x, y, z, p, g, rn, d, rh, fire, dh) => f(s, x, y, z, p, g, rn, d, rh, true, dh); });
  brk('fire flag inverted', !!e.err || compare(golden.blast, e).length > base.length); }
{ const e = engineHit(ENGINE_N, (M) => { const f = M.EndCrystal.damage; M.EndCrystal.damage = (c, s) => f(c, Object.assign({}, s, { explosive: true })); });
  brk('explosive source (no blast)', !!e.err || compare(golden.blast, e).length > base.length); }
{ const g = JSON.parse(JSON.stringify(golden.blast)); g.pig.p3 = g.pig.p3.map((h) => h + 1);
  brk('golden pig health shifted', compare(g, eng).length > base.length); }
{ const g = JSON.parse(JSON.stringify(golden.blast)); const i = readCells().findIndex(([x, y, z]) => x === 1 && y === 0 && z === 0);
  g.air[i] = g.air[i] > g.trials / 2 ? 0 : g.trials;
  brk('golden cell flipped', compare(g, eng).length > base.length); }
for (const r of reds) console.log('  ✗ ' + r);
console.log(`crystalrefcheck: ${base.length ? 0 : 1} green comparison(s), ${reds.length} red · anti-vacuity ${caught}/${breaks}`);
console.log(` assertions passed .... ${(base.length ? 0 : 1) + caught}`);
console.log(` failures ........... ${reds.length}`);
console.log(` ${caught} breaks caught`);
process.exit(reds.length ? 1 : 0);
