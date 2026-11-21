#!/usr/bin/env node
// barterrefcheck.mjs — infra I6 (s138): PIGLIN BARTERING vs the real 1.18.2 server (golden: runbarter.mjs -> barter.json;
// scenarios + why: barterscen.mjs). Every number compared is the SERVER's (D-329).
//   (a) table: every item the server's `gameplay/piglin_bartering` gives, its rate over ROLLS rolls vs `Pg.rollBarter`
//       (07zzf_piglin.js) over 20x as many (two-proportion z, red at |z| > 4.42 = P < 1e-5), each count range the
//       server saw inside the engine's, the mean count within 5 sigma; an item only one side gives = red.
//   (b) live: a piglin + a gold stack on the ground. Per rep the ticks the ground stack shrinks (pickups) and the
//       ticks a new barter drop appears. Compared: pickups per rep (vanilla takes ONE ingot each time, :348-358),
//       the ingots each pickup takes, pickup -> drop gap (ADMIRE 120), first pickup no later than the server's
//       slowest + 20 ticks.
// Anti-vacuity (D-30/D-305): golden rate of the most common item x0.5, engine table with one weight x3, golden
// admire gap +40 -- each caught. Mismatches are FINDINGS (red, exit 1). No golden -> SKIP.
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { loadEngine, MCLITE_ROOT } from '../loadsrc.mjs';
import { SCEN, T, R } from './barterscen.mjs';

const VERBOSE = process.argv.includes('--verbose');
const refDir = process.env.MCLITE_REFEREE_DIR || join(homedir(), '.mclite-referee', '1.18.2');
const GOLDEN = [join(refDir, 'golden', 'barter.json'), join(MCLITE_ROOT, '..', 'mclite-store', 'golden', 'barter.json')].find((f) => existsSync(f));
if (!GOLDEN) { console.log('barterrefcheck: SKIP (golden not generated -- run node tools/referee/runbarter.mjs)'); process.exit(process.env.MCLITE_REQUIRE_REFEREE ? 1 : 0); }
const golden = JSON.parse(readFileSync(GOLDEN, 'utf8'));
const rdj = (f) => JSON.parse(readFileSync(join(MCLITE_ROOT, 'assets', f), 'utf8'));
const b64 = (f) => readFileSync(join(MCLITE_ROOT, 'assets', f)).toString('base64');

let seed = 0x0a41c001;
const rng = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };

// The engine as the game builds it: every 07*.js mob module (rostered mobs run EL.tickMob) + the real player.
const BASE_MODS = ['02f_tags.js', '02g_items.js', '14f_inventory.js', '07b_behaviour.js', '07_world.js', '07h_entities.js',
  '14b_physics.js', '07i_entitylist.js', '07k_goals.js', '07l_spawn.js', '07m_breed.js', '07n_tame.js', '07q_effects.js',
  '07y_equip.js', '10_gfx.js', '15h_bemodel.js', '07j_entityrender.js', '14d_survival.js', '14j_combat.js', '07zw_mobnbt.js',
  '07w_passive.js', '07d_mining.js', '07e_loot.js', '14e_gamemode.js', '14i_hand.js', '14_player.js'];
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
if (M.Goat && M.Goat.init) M.Goat.init();
if (M.Piglin && M.Piglin.init) M.Piglin.init();
M.Player.init();
M.Gamemode.set(M.Player, M.Gamemode.SURVIVAL);
if (M.Diff && M.Diff.set) M.Diff.set('normal');
M.EntityList.random = rng;
Math.random = rng;
const { EntityList: EL, States: S } = M;
const P = M.Player;

const { Combat: Cb, Survival: Sv, Piglin: Pg, Items: IT } = M;
const bare = (id) => id.replace(/^minecraft:/, '');
// ── (a) the table ──
function engineTable(n) {
  const t = { rolls: n, items: {} };
  for (let i = 0; i < n; i++) {
    const d = Pg.rollBarter(rng);
    const q = t.items[d.name] || (t.items[d.name] = { total: 0, sq: 0, hits: 0, min: Infinity, max: 0 });
    q.total += d.count; q.sq += d.count * d.count; q.hits++; q.min = Math.min(q.min, d.count); q.max = Math.max(q.max, d.count);
  }
  return t;
}
function cmpTable(g, e) {
  const out = [];
  const names = new Set([...Object.keys(g.items).map(bare), ...Object.keys(e.items)]);
  for (const n of names) {
    const gq = g.items[n] || g.items['minecraft:' + n], eq = e.items[n];
    if (!gq) { out.push(`table: the engine barters ${n}, the server never did in ${g.rolls} rolls`); continue; }
    if (!eq) { out.push(`table: the server barters ${n} (${gq.hits}/${g.rolls}), the engine never does`); continue; }
    const p1 = gq.hits / g.rolls, p2 = eq.hits / e.rolls, p = (gq.hits + eq.hits) / (g.rolls + e.rolls);
    const z = (p1 - p2) / Math.sqrt(p * (1 - p) * (1 / g.rolls + 1 / e.rolls));
    if (Math.abs(z) > 4.42) out.push(`table: ${n} rate server ${(p1 * 100).toFixed(2)}%, engine ${(p2 * 100).toFixed(2)}% (z ${z.toFixed(1)})`);
    if (gq.min < eq.min || gq.max > eq.max) out.push(`table: ${n} count server saw ${gq.min}..${gq.max}, engine ${eq.min}..${eq.max}`);
    const gm = gq.total / gq.hits, em = eq.total / eq.hits, gv = Math.max(1e-9, gq.sq / gq.hits - gm * gm);
    if (Math.abs(gm - em) > 5 * Math.sqrt(gv / gq.hits) + 1e-9) out.push(`table: ${n} mean count server ${gm.toFixed(2)}, engine ${em.toFixed(2)}`);
  }
  return out;
}
// ── (b) live ──
function buildPen() {
  cells.clear();
  const stone = S.stateOf('stone');
  for (let x = -R - 1; x <= R + 1; x++) for (let z = -R - 1; z <= R + 1; z++) {
    w.set(x, -1, z, stone);
    if (Math.abs(x) === R + 1 || Math.abs(z) === R + 1) for (let y = 0; y < 3; y++) w.set(x, y, z, stone);
  }
}
const GOLD = IT.of('gold_ingot');
function engineLive(s) {
  buildPen(); EL.list.length = 0;
  M.Gamemode.set(P, M.Gamemode.CREATIVE);
  P.x = 0.5; P.y = 200; P.z = 40.5;                       // far away: no player in the piglin's senses
  const e = EL.spawn('piglin', 0.5, 0, 0.5);
  if (!e) return { err: 'EL.spawn gives nothing' };
  e.persistent = true; e.isBaby = false; e.immuneToZombification = true; e.yaw = -Math.PI / 2;
  if (M.Equip && M.Equip.setEquipped) { M.Equip.setEquipped(e, IT.MAINHAND, null); M.Equip.setEquipped(e, IT.OFFHAND, null); }   // NBT form: empty-handed
  for (let t = 0; t < 10; t++) EL.tick();                 // runbarter's 500 ms landing
  const it = EL.dropStack(0.5 + s.dist, 0, 0.5, GOLD, s.count, { vx: 0, vy: 0, vz: 0, pickupDelay: 0 });
  if (!it) return { err: 'EL.dropStack gives nothing' };
  const gold = [], other = [];
  for (let t = 0; t < T; t++) {
    let g = 0, o = 0;
    for (const q of EL.list) if (q && !q.removed && q.type === 'item') { if (q.item === GOLD) g += q.count | 0; else o++; }
    gold.push(g); other.push(o);
    EL.tick();
  }
  return { gold, other };
}
function events(G, O, count) {
  const pick = [], take = [], drop = [];
  for (let i = 0; i < G.length; i++) {
    const gp = i ? G[i - 1] : count, op = i ? O[i - 1] : O[0];   // entry 0 can already be after a pickup
    if (G[i] < gp) { pick.push(i); take.push(gp - G[i]); }
    if (O[i] > op) drop.push(i);
  }
  return { pick, take, drop, gap: pick.length && drop.length ? drop[0] - pick[0] : null };
}
function cmpLive(s, g, e) {
  if (e.err) return [`${s.id}: ${e.err}`];
  const ge = g.gold.map((G, i) => events(G, g.other[i], s.count)), ee = events(e.gold, e.other, s.count);
  const out = [];
  const gp = ge.map((q) => q.pick.length);
  if (!gp.includes(ee.pick.length)) out.push(`${s.id}: the server piglin picks from the ground ${gp.join('/')} times, the engine ${ee.pick.length}`);
  const gt = new Set(ge.flatMap((q) => q.take)), bad = ee.take.filter((n) => !gt.has(n));
  if (bad.length) out.push(`${s.id}: each server pickup takes ${[...gt].join('/')} ingot(s), the engine takes ${ee.take.join('/')}`);
  const gg = new Set(ge.map((q) => q.gap).filter((v) => v !== null));
  if (gg.size && !gg.has(ee.gap)) out.push(`${s.id}: pickup -> first barter drop takes ${[...gg].join('/')} ticks on the server, ${ee.gap === null ? 'never' : ee.gap} in the engine`);
  const slow = Math.max(...ge.map((q) => q.pick[0] || 0));
  if (!ee.pick.length || ee.pick[0] > slow + 20) out.push(`${s.id}: first pickup at tick ${ge.map((q) => q.pick[0]).join('/')} on the server, ${ee.pick[0] === undefined ? 'never' : ee.pick[0]} in the engine`);
  return out;
}

console.log(`barterrefcheck — piglin bartering vs the real 1.18.2 server (${golden.table.rolls} table rolls, ${SCEN.length} live scenes, ${golden.generatedAt})`);
const reds = []; let pass = 0;
const ET = engineTable(golden.table.rolls * 20);
const tb = cmpTable(golden.table, ET);
if (tb.length) reds.push(...tb); else pass++;
const ENG = {};
for (const s of SCEN) {
  const g = golden.cases[s.id];
  if (!g) { reds.push(`${s.id}: no golden case`); continue; }
  const e = engineLive(s); ENG[s.id] = e;
  const bad = cmpLive(s, g, e);
  if (bad.length) reds.push(...bad); else pass++;
  if (VERBOSE) {
    const f = (q) => `pick ${q.pick.join(',')} take ${q.take.join(',')} drop ${q.drop.join(',')}`;
    console.log(`  ${s.id.padEnd(8)} server ${g.gold.map((G, i) => f(events(G, g.other[i], s.count))).join(' | ')}\n           engine ${e.err || f(events(e.gold, e.other, s.count))}`);
  }
}
let breaks = 0, caught = 0;
const brk = (name, fired) => { breaks++; if (fired) caught++; else reds.push(`anti-vacuity: break "${name}" was NOT caught`); };
{ const g = JSON.parse(JSON.stringify(golden.table)); const top = Object.entries(g.items).sort((a, b) => b[1].hits - a[1].hits)[0][1]; top.hits = Math.round(top.hits / 2);
  brk('golden top item rate x0.5', cmpTable(g, ET).join() !== tb.join()); }
{ const row = Pg.BARTER_TABLE.find((q) => q.item === 'obsidian'); const w0 = row.weight; row.weight *= 3; Pg.BARTER_WEIGHT += 2 * w0;
  const e = engineTable(golden.table.rolls * 20); row.weight = w0; Pg.BARTER_WEIGHT -= 2 * w0;
  brk('engine obsidian weight x3', cmpTable(golden.table, e).join() !== tb.join()); }
{ const s = SCEN[0], g = JSON.parse(JSON.stringify(golden.cases[s.id]));
  g.other = g.other.map((O) => O.map((v, i) => O[Math.max(0, i - 40)]));
  brk('golden admire gap +40', cmpLive(s, g, ENG[s.id]).join() !== cmpLive(s, golden.cases[s.id], ENG[s.id]).join()); }
for (const r of reds) console.log('  ✗ ' + r);
console.log(`barterrefcheck: ${pass}/${SCEN.length + 1} parts match, ${reds.length} red · anti-vacuity ${caught}/${breaks}`);
console.log(` assertions passed .... ${pass + caught}`);
console.log(` failures ........... ${reds.length}`);
console.log(` breaks caught ...... ${caught}`);
process.exit(reds.length ? 1 : 0);
