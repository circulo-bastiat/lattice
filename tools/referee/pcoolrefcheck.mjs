#!/usr/bin/env node
// pcoolrefcheck.mjs — infra I6 (25 Sept 2026): PLAYER ATTACK COOLDOWN vs the real 1.18.2 server (golden: runpcool.mjs,
// player-cooldown.json — a growbot's own packets; scenarios: pcoolscen.mjs). Engine side, through the joins the game uses:
// Combat.attack(P, A) for a first blow (14_player.js's left-click on a mob), Hand.swing(P, 0) alone for a click at the air
// (14_player.js:673 — the miss path), P.slot for a hotbar switch, Hand.tickAttackStrength() once per tick (14_player.js:423),
// then Combat.attack(P, B). The server's tick count between the packets jitters, so a scene's pcoolscen `window` of ticks is
// tried and every server rep must equal the engine at SOME t in it (the t found is printed); a partial scene's server value must
// also be BELOW the full-charge blow (else the harness never emptied the cooldown). A's (full) loss and the sweep neighbour's
// are compared exactly (0.001). Anti-vacuity (D-30/D-305): golden B +0.5; the engine ramp off (RAMP_BASE 1, RAMP_SCALE 0);
// the engine's full-strength gate off (FULL_STRENGTH -1: crit/sweep at any charge).
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { loadEngine, MCLITE_ROOT } from '../loadsrc.mjs';
import { SCEN, DZ, AX, BX, NX, window } from './pcoolscen.mjs';
const VERBOSE = process.argv.includes('--verbose');
const refDir = process.env.MCLITE_REFEREE_DIR || join(homedir(), '.mclite-referee', '1.18.2');
const GOLDEN = [join(refDir, 'golden', 'player-cooldown.json'), join(MCLITE_ROOT, '..', 'mclite-store', 'golden', 'player-cooldown.json')].find((f) => existsSync(f));
if (!GOLDEN) { console.log('pcoolrefcheck: golden not generated -- run node tools/referee/runpcool.mjs (skipped)'); process.exit(0); }
const golden = JSON.parse(readFileSync(GOLDEN, 'utf8'));
const rdj = (f) => JSON.parse(readFileSync(join(MCLITE_ROOT, 'assets', f), 'utf8'));
const b64 = (f) => readFileSync(join(MCLITE_ROOT, 'assets', f)).toString('base64');
let seed = 0x0c0010d5;
const rng = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
// The engine as the game builds it (the fallrefcheck loader): every 07*.js mob module.
const BASE_MODS = ['02f_tags.js', '02g_items.js', '14f_inventory.js', '07b_behaviour.js', '07_world.js', '07h_entities.js',
  '14b_physics.js', '07i_entitylist.js', '07k_goals.js', '07l_spawn.js', '07m_breed.js', '07n_tame.js', '07q_effects.js',
  '07y_equip.js', '10_gfx.js', '15h_bemodel.js', '07j_entityrender.js', '14d_survival.js', '14j_combat.js', '07zw_mobnbt.js',
  '07w_passive.js', '07d_mining.js', '07e_loot.js', '14i_hand.js'];
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
  if (!(M.Hand.bindAttrs(table) > 0)) { console.log('pcoolrefcheck: empty item attribute table'); process.exit(1); }
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
if (!Sv || !Iv) { console.log('pcoolrefcheck: engine has no Survival/Inventory module loaded'); process.exit(1); }
const PAD = 0;
const mkStack = (w) => { if (!w) return null; const st = { i: IT.of(w.item), n: 1 }; if (w.ench) st.t = { Enchantments: w.ench.map(([id, l]) => ({ id: 'minecraft:' + id, lvl: l })) }; return st; };
// one engine run: empty the cooldown the scene's way, `t` player ticks, the blow on B. Returns losses.
function engineRun(s, t) {
  cells.clear(); EL.list.length = 0;
  const stone = S.stateOf('stone');
  for (let x = -5; x <= 5; x++) for (let z = -4; z <= 6; z++) w.set(x, PAD, z, stone);
  const P = { x: 0.5, y: PAD + 1, z: 0.5, vx: 0, vy: 0, vz: 0, yaw: 0, pitch: 0, onGround: true, fallDistance: 0, width: 0.6, height: 1.8,
    type: 'player', slot: 0, heldItem() { return this.inventory.slots[this.inventory.selected]; }, sprinting: false, inventory: { slots: new Array(46).fill(null), selected: 0 } };
  Sv.init(P);
  P.inventory.slots[0] = mkStack(s.weapon); P.inventory.slots[1] = mkStack(s.weapon2);
  if ((s.weapon && !P.inventory.slots[0].i) || (s.weapon2 && !P.inventory.slots[1].i)) return { err: 'no engine item' };
  M.Player = P;
  const mk = (x) => { const e = EL.spawn('zombie', x, PAD + 1, 0.5 + DZ); if (!e) return null; e.persistent = true; e.noAI = true; e.vx = e.vy = e.vz = 0;
    for (const sl of [IT.FEET, IT.LEGS, IT.CHEST, IT.HEAD]) Eq.setEquipped(e, sl, null); e.maxHealth = 100; e.health = 100; return e; };
  const A = mk(0.5 + AX), B = mk(0.5 + BX), N = s.sweep ? mk(0.5 + NX) : null;
  if (!A || !B || (s.sweep && !N)) return { err: 'EL.spawn(zombie) gives nothing' };
  if (s.crit) { P.onGround = false; P.fallDistance = 0.1; }
  M.Hand.attackStrengthTicker = 1000;
  if (s.empty === 'hit') M.Combat.attack(P, A);
  else if (s.empty === 'swing') { M.Hand.swing(P, 0); M.Hand.resetAttackStrength(); }   // 14_player.js's miss branch
  else if (s.empty === 'switch') { M.Hand.noteSelected(P); P.slot = 1; P.inventory.selected = 1; }   // the reset lands on the next tick
  for (let k = 0; k < t; k++) { M.Hand.tickAttackStrength(); M.Hand.noteSelected(P); }   // 14_player.js:435-437
  M.Combat.attack(P, B);
  return { lostA: 100 - A.health, lostB: 100 - B.health, lostN: N ? 100 - N.health : null };
}
const reds = [];
let pass = 0;
const f3 = (v) => (Math.round(v * 10000) / 10000).toString();
const near = (a, b) => Math.abs(a - b) <= 0.001;
function compare(s, g) {
  const out = [];
  for (const k of ['lostA', 'lostB', 'lostN']) if (g[k].length && g[k].some((v) => v !== g[k][0])) return { out: [`${s.id}: the server was not constant over reps (${k} ${g[k].join('/')}) -- harness`] };
  const full = engineRun(s, 1000);
  if (full.err) return { out: [`${s.id}: ${full.err}`] };
  const ts = window(s), tried = ts.map((t) => ({ t, r: engineRun(s, t) }));
  const hit = tried.find((q) => near(q.r.lostB, g.lostB[0]) && (!s.sweep || near(q.r.lostN, g.lostN[0])));
  const partial = !(s.empty === 'switch' && !s.gap);
  if (partial && !(g.lostB[0] < full.lostB - 0.001)) out.push(`${s.id}: the server's blow on B (${f3(g.lostB[0])}) is not below a full-charge blow (${f3(full.lostB)}) -- harness never emptied the cooldown`);
  if (!hit) out.push(`${s.id}: server B loses ${f3(g.lostB[0])}${s.sweep ? ' (neighbour ' + f3(g.lostN[0]) + ')' : ''}; engine at t=${ts[0]}..${ts[ts.length - 1] === 1000 ? 'full' : ts[ts.length - 1]} ticks gives ${[...new Set(tried.map((q) => f3(q.r.lostB) + (s.sweep ? '/' + f3(q.r.lostN) : '')))].join(', ')}`);
  if (s.empty === 'hit' && !near(tried[0].r.lostA, g.lostA[0])) out.push(`${s.id}: the first (full) blow on A: server ${f3(g.lostA[0])}, engine ${f3(tried[0].r.lostA)}`);
  return { out, t: hit ? hit.t : null, eng: tried };
}
let breaks = 0, caught = 0;
const brk = (name, fired) => { breaks++; if (fired) caught++; else reds.push(`anti-vacuity: break "${name}" was NOT caught`); };
console.log(`pcoolrefcheck — the player attack cooldown vs the real 1.18.2 server (${SCEN.length} scenarios, ${golden.generatedAt})`);
for (const s of SCEN) {
  const g = golden.cases[s.id];
  if (!g || !g.lostB.length) { reds.push(`${s.id}: no golden case`); continue; }
  const r = compare(s, g);
  if (r.out.length) reds.push(...r.out); else pass++;
  if (VERBOSE || !r.out.length) console.log(`  ${r.out.length ? '✗' : '✓'} ${s.id.padEnd(28)} server B ${f3(g.lostB[0])}${r.t !== null && r.t !== undefined ? '  = engine at t=' + r.t : ''}`);
}
const S1 = SCEN.find((q) => q.id === 'iron_sword_after_hit');
{ const g = JSON.parse(JSON.stringify(golden.cases[S1.id])); g.lostB = g.lostB.map((v) => v + 0.5); brk('golden iron_sword_after_hit B +0.5', compare(S1, g).out.length > 0); }
{ const a = M.Combat.RAMP_BASE, b = M.Combat.RAMP_SCALE; M.Combat.RAMP_BASE = 1; M.Combat.RAMP_SCALE = 0;
  const bad = compare(S1, golden.cases[S1.id]).out.length > 0; M.Combat.RAMP_BASE = a; M.Combat.RAMP_SCALE = b; brk('engine cooldown ramp off (iron_sword_after_hit)', bad); }
{ const s = SCEN.find((q) => q.id === 'crit_after_hit'); const a = M.Combat.FULL_STRENGTH; M.Combat.FULL_STRENGTH = -1;
  const bad = compare(s, golden.cases[s.id]).out.length > 0; M.Combat.FULL_STRENGTH = a; brk('engine full-strength gate off (crit_after_hit)', bad); }
for (const r of reds) console.log('  ✗ ' + r);
console.log(`pcoolrefcheck: ${pass}/${SCEN.length} scenarios agree, ${reds.length} red · anti-vacuity ${caught}/${breaks}`);
console.log(` assertions passed .... ${pass + caught}`);
console.log(` failures ........... ${reds.length}`);
console.log(` breaks caught ...... ${caught}`);
process.exit(reds.length ? 1 : 0);
