#!/usr/bin/env node
// tamerefcheck.mjs — infra I6 (s143, 25 Sept 2026): TAMING by right-click vs the real 1.18.2 server (golden: runtame.mjs,
// tame.json — a growbot's own Interact packet on 300 fresh wild mobs per scene; scenarios: tamescen.mjs). Engine side, the join a
// right-click on a mob takes: Use.entityUse(P, mob, the held stack) on N_ENG fresh EL.spawn'd mobs (seeded). Judged: the tame
// RATE (two-proportion z-test, |z| > 4.5 red — both directions), items used per attempt (exact), mobs left alive (exact rate
// 0 or 1 when the server's is). Anti-vacuity (D-30/D-305): the golden wolf rate zeroed, the engine's Use.entityUse no-op'd for
// wolf_bone, the golden cookie-kill count flipped to all-alive.
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { loadEngine, MCLITE_ROOT } from '../loadsrc.mjs';
import { SCEN } from './tamescen.mjs';
const VERBOSE = process.argv.includes('--verbose');
const refDir = process.env.MCLITE_REFEREE_DIR || join(homedir(), '.mclite-referee', '1.18.2');
const GOLDEN = [join(refDir, 'golden', 'tame.json'), join(MCLITE_ROOT, '..', 'mclite-store', 'golden', 'tame.json')].find((f) => existsSync(f));
if (!GOLDEN) { console.log('tamerefcheck: golden not generated -- run node tools/referee/runtame.mjs (skipped)'); process.exit(0); }
const golden = JSON.parse(readFileSync(GOLDEN, 'utf8'));
const rdj = (f) => JSON.parse(readFileSync(join(MCLITE_ROOT, 'assets', f), 'utf8'));
const b64 = (f) => readFileSync(join(MCLITE_ROOT, 'assets', f)).toString('base64');
let seed = 0x0a4a0125;
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
  if (!(M.Hand.bindAttrs(table) > 0)) { console.log('tamerefcheck: empty item attribute table'); process.exit(1); }
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
if (!Sv || !Iv) { console.log('tamerefcheck: engine has no Survival/Inventory module loaded'); process.exit(1); }
const N_ENG = 3000;
function engineRun(s, hook) {
  const out = { attempts: 0, tamed: 0, alive: 0, used: 0 };
  const P = { x: 0.5, y: 1, z: 0.5, vx: 0, vy: 0, vz: 0, yaw: 0, pitch: 0, onGround: true, width: 0.6, height: 1.8, type: 'player',
    slot: 0, instabuild: false, inventory: { slots: new Array(46).fill(null), selected: 0 } };
  Sv.init(P);
  M.Player = P;
  for (let n = 0; n < N_ENG; n++) {
    cells.clear(); EL.list.length = 0;
    const e = EL.spawn(s.mob, 0.5, 1, 2.5);
    if (!e) return { err: `EL.spawn(${s.mob}) gives nothing` };
    e.persistent = true; e.noAI = true;
    const stack = { i: IT.of(s.item), n: 64 };
    if (!stack.i) return { err: `no engine item ${s.item}` };
    P.inventory.slots[0] = stack;
    if (hook) hook(P, e);
    else M.Use.entityUse(P, e, stack);
    out.attempts++;
    if (e.tamed || e.owner) out.tamed++;
    if (!e.removed && !e.dead && e.health > 0) out.alive++;
    const left = P.inventory.slots[0] && P.inventory.slots[0].n ? P.inventory.slots[0].n : 0;
    out.used += 64 - left;
  }
  return out;
}
const reds = [];
let pass = 0;
const pct = (a, n) => (n ? (100 * a / n).toFixed(1) + '%' : 'n/a');
function zOf(a, n, b, m) { const p = (a + b) / (n + m); if (p <= 0 || p >= 1) return a / n === b / m ? 0 : Infinity; return (a / n - b / m) / Math.sqrt(p * (1 - p) * (1 / n + 1 / m)); }
function compare(s, g, e) {
  if (e.err) return [`${s.id}: ${e.err}`];
  const out = [], what = `right-click a wild ${s.mob} holding ${s.item}`;
  const z = zOf(g.tamed, g.attempts, e.tamed, e.attempts);
  if (Math.abs(z) > 4.5) out.push(`${s.id}: ${what}: tamed ${pct(g.tamed, g.attempts)} on the server (${g.tamed}/${g.attempts}), ${pct(e.tamed, e.attempts)} in the engine`);
  const gu = g.used / g.attempts, eu = e.used / e.attempts;
  if (Math.abs(gu - eu) > 1e-9) out.push(`${s.id}: ${what}: ${gu.toFixed(3)} item(s) used per click on the server, ${eu.toFixed(3)} in the engine`);
  const ga = g.alive / g.attempts, ea = e.alive / e.attempts;
  if ((ga === 0 || ga === 1) ? ga !== ea : Math.abs(ga - ea) > 0.1) out.push(`${s.id}: ${what}: ${pct(g.alive, g.attempts)} of the mobs alive afterwards on the server, ${pct(e.alive, e.attempts)} in the engine`);
  return out;
}
let breaks = 0, caught = 0;
const brk = (name, fired) => { breaks++; if (fired) caught++; else reds.push(`anti-vacuity: break "${name}" was NOT caught`); };
console.log(`tamerefcheck — taming by right-click vs the real 1.18.2 server (${SCEN.length} scenarios, ${golden.generatedAt})`);
const ENG = {};
for (const s of SCEN) {
  const g = golden.cases[s.id];
  if (!g || !g.attempts) { reds.push(`${s.id}: no golden case`); continue; }
  const e = engineRun(s);
  ENG[s.id] = e;
  const bad = compare(s, g, e);
  if (bad.length) reds.push(...bad); else pass++;
  if (VERBOSE) console.log(`  ${s.id.padEnd(22)} server tamed ${pct(g.tamed, g.attempts)} used/click ${(g.used / g.attempts).toFixed(2)} alive ${pct(g.alive, g.attempts)}  |  engine ${e.err || `tamed ${pct(e.tamed, e.attempts)} used/click ${(e.used / e.attempts).toFixed(2)} alive ${pct(e.alive, e.attempts)}`}`);
}
{ const s = SCEN.find((q) => q.id === 'wolf_bone'); const g = Object.assign({}, golden.cases[s.id], { tamed: 0 });
  const e = Object.assign({}, golden.cases[s.id]);    // the server's own numbers as the "engine": only the zeroed golden differs
  brk('golden wolf_bone tame count zeroed', compare(s, g, e).length > 0); }
{ const s = SCEN.find((q) => q.id === 'wolf_bone'); const e = engineRun(s, () => {});
  brk('engine Use.entityUse no-op (wolf_bone)', compare(s, golden.cases[s.id], e).length > 0); }
{ const s = SCEN.find((q) => q.id === 'parrot_cookie'); const g = Object.assign({}, golden.cases[s.id]); g.alive = g.attempts;
  const e = Object.assign({}, golden.cases[s.id]);
  brk('golden parrot_cookie all alive', compare(s, g, e).length > 0); }
for (const r of reds) console.log('  ✗ ' + r);
console.log(`tamerefcheck: ${pass}/${SCEN.length} scenarios agree, ${reds.length} red · anti-vacuity ${caught}/${breaks}`);
console.log(` assertions passed .... ${pass + caught}`);
console.log(` failures ........... ${reds.length}`);
console.log(` breaks caught ...... ${caught}`);
process.exit(reds.length ? 1 : 0);
