#!/usr/bin/env node
// placerefcheck.mjs — infra I6 (s146, 25 Sept 2026): WHICH BLOCK STATE a right-click places vs the real 1.18.2 server (golden:
// runplace.mjs, place.json; scenarios + geometry: placescen.mjs). Engine side, the join a real right-click takes: the real
// NS.Player (14_player.js) at (0.5, F, 0.5) aimed along the exact eye->click-point vector (engine yaw = atan2(dx, -dz), pitch =
// atan2(dy, horizontal)), `P.retarget()` (the crosshair ray: the hit block, face and hit point the placement reads), then
// `Use.rightClick(P)` with 1 of the item in hotbar slot 0 (the BUCKET pack's harness, bucketrefcheck.mjs). Judged exactly: the full
// state string (every property, the same property list the runner probed, from .mcdata/pc/blocks.json) of each landing cell.
// Anti-vacuity (D-30/D-305): the golden stairs_side_high state rewritten to half=bottom; the engine's Use.rightClick no-op'd for
// log_side; the golden door_floor's upper half dropped.
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { loadEngine, MCLITE_ROOT } from '../loadsrc.mjs';
import { SCEN, cellsOf, clickOf, sideStoneOf, EYE } from './placescen.mjs';
const VERBOSE = process.argv.includes('--verbose');
const refDir = process.env.MCLITE_REFEREE_DIR || join(homedir(), '.mclite-referee', '1.18.2');
const GOLDEN = [join(refDir, 'golden', 'place.json'), join(MCLITE_ROOT, '..', 'mclite-store', 'golden', 'place.json')].find((f) => existsSync(f));
if (!GOLDEN) { console.log('placerefcheck: golden not generated -- run node tools/referee/runplace.mjs (skipped)'); process.exit(process.env.MCLITE_REQUIRE_REFEREE ? 1 : 0); }
const golden = JSON.parse(readFileSync(GOLDEN, 'utf8'));
const BLOCKS = new Map(JSON.parse(readFileSync(join(MCLITE_ROOT, '.mcdata', 'pc', 'blocks.json'), 'utf8')).map((b) => [b.name, b]));
const rdj = (f) => JSON.parse(readFileSync(join(MCLITE_ROOT, 'assets', f), 'utf8'));
const b64 = (f) => readFileSync(join(MCLITE_ROOT, 'assets', f)).toString('base64');
const BASE_MODS = ['02f_tags.js', '02g_items.js', '14f_inventory.js', '07b_behaviour.js', '07_world.js', '07h_entities.js',
  '14b_physics.js', '14c_raycast.js', '14e_gamemode.js', '07i_entitylist.js', '07k_goals.js', '07l_spawn.js', '07m_breed.js', '07n_tame.js',
  '07q_effects.js', '07y_equip.js', '10_gfx.js', '15h_bemodel.js', '07j_entityrender.js', '14d_survival.js', '14j_combat.js', '07zw_mobnbt.js',
  '07w_passive.js', '07d_mining.js', '07e_loot.js', '14i_hand.js', '14_player.js', '14l_use.js'];
const MOB_MODS = readdirSync(join(MCLITE_ROOT, 'src')).filter((f) => /^07.*\.js$/.test(f) && !BASE_MODS.includes(f)).sort();
const M = loadEngine({ extra: BASE_MODS.concat(MOB_MODS), dom: true, initReg: true });
M.DATA = Object.assign({}, M.DATA, { entities: rdj('entities.json') });
M.Entities.init();
M.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
const cells = new Map();
const key = (x, y, z) => x + ',' + y + ',' + z;
const w = { get: (x, y, z) => cells.get(key(x, y, z)) || 0, set: (x, y, z, s) => { if (s) cells.set(key(x, y, z), s); else cells.delete(key(x, y, z)); return true; } };   // World.setBlock answers true (P.placeBlock's second cell reads it)
w.getBlock = w.get; w.setBlock = w.set; w.getLight = () => 15; w.tickingAt = () => true;
M.World = Object.assign(M.World || {}, w);
if (M.Behave && M.Behave.init) M.Behave.init(w);
M.Physics.shapeAt = (x, y, z) => { const id = w.get(Math.floor(x), Math.floor(y), Math.floor(z)); return id && M.States.solid[id] === 1 ? M.Physics.shapesFor(id) : null; };
M.Physics.solidAt = (x, y, z) => M.Physics.shapeAt(x, y, z) !== null;
M.EntityList.init(); M.Ai.init(); M.Equip.init(); M.Breed.init(); M.Tame.init(); M.Passive.init();
M.Diff = { get: () => 'normal' };
M.Use.init(w);
const { EntityList: EL, Items: IT, States: S, Behave: B, Gamemode: GM } = M;
const P = M.Player;
P.init();
const F = 64;
const nameOf = (st) => (st && st.i !== undefined && (st.n | 0) > 0 ? IT.nameOf(st.i) || '' : '');
function stateString(st) {
  if (!(st > 0)) return 'air';
  const name = S.name(st);
  const b = BLOCKS.get(name);
  const props = ((b && b.states) || []).map((p) => `${p.name}=${B.propName(st, p.name)}`);
  return props.length ? `${name}[${props.sort().join(',')}]` : name;
}
function engineRun(s, hook) {
  const out = { attempts: 0, states: {} };
  const k = clickOf(s);
  const dx = k.point[0] - 0.5, dy = k.point[1] - EYE, dz = k.point[2] - 0.5;
  for (let r = 0; r < golden.REPS; r++) {
    cells.clear(); EL.list.length = 0;
    const stone = S.stateOf('stone');
    for (let x = -3; x <= 4; x++) for (let z = -3; z <= 4; z++) w.set(x, F - 1, z, stone);
    if (s.at === 'side') { const [x, y, z] = sideStoneOf(s); w.set(x, F + y, z, stone); }
    if (GM && GM.set) GM.set(P, GM.SURVIVAL);
    P.x = P.px = 0.5; P.y = P.py = F; P.z = P.pz = 0.5; P.ex = 0.5; P.ey = F; P.ez = 0.5;
    P.yaw = Math.atan2(dx, -dz); P.pitch = Math.atan2(dy, Math.hypot(dx, dz)); P.crouching = false; P.targetEntity = null;
    P.inventory.slots.fill(null);
    const it = IT.of(s.item);
    if (!(it >= 0)) return { err: `no engine item ${s.item}` };
    P.inventory.slots[0] = { i: it, n: 1 };
    P.slot = 0; if (P.inventory.selected !== undefined) P.inventory.selected = 0;
    if (P.syncHotbar) P.syncHotbar();
    P.retarget();
    if (!P.hasTarget || P.tx !== k.block[0] || P.ty !== F + k.block[1] || P.tz !== k.block[2]) return { err: `the engine crosshair hit ${P.hasTarget ? [P.tx, P.ty - F, P.tz] : 'nothing'}, not the scene's block ${k.block} -- harness aim` };
    if (hook) hook(P); else M.Use.rightClick(P);
    out.attempts++;
    const key = cellsOf(s).map(([x, y, z]) => stateString(w.get(x, F + y, z))).join(' | ');
    out.states[key] = (out.states[key] || 0) + 1;
  }
  return out;
}
const reds = [];
let pass = 0;
const fmt = (m, n) => Object.entries(m).map(([k, v]) => `${k} ${(100 * v / n).toFixed(0)}%`).join(', ') || '-';
function compare(s, g, e) {
  if (e.err) return [`${s.id}: ${e.err}`];
  const keys = new Set([...Object.keys(g.states), ...Object.keys(e.states)]);
  for (const k of keys) if ((g.states[k] || 0) / g.attempts !== (e.states[k] || 0) / e.attempts)
    return [`${s.id}: place ${s.item} on the ${s.at === 'side' ? `${s.dir === 'east' ? 'west' : 'north'} face of a stone at height ${s.cy}` : 'floor 2 blocks ahead'}, facing ${s.dir === 'east' ? 'east' : 'south'} — server ${fmt(g.states, g.attempts)} · engine ${fmt(e.states, e.attempts)}`];
  return [];
}
let breaks = 0, caught = 0;
const brk = (name, fired) => { breaks++; if (fired) caught++; else reds.push(`anti-vacuity: break "${name}" was NOT caught`); };
console.log(`placerefcheck — the block state a right-click places vs the real 1.18.2 server (${SCEN.length} scenarios, ${golden.generatedAt})`);
for (const s of SCEN) {
  const g = golden.cases[s.id];
  if (!g || !g.attempts) { reds.push(`${s.id}: no golden case`); continue; }
  const e = engineRun(s);
  const bad = compare(s, g, e);
  if (bad.length) reds.push(...bad); else pass++;
  if (VERBOSE) console.log(`  ${s.id.padEnd(22)} server ${fmt(g.states, g.attempts)} | engine ${e.err || fmt(e.states, e.attempts)}`);
}
{ const s = SCEN.find((q) => q.id === 'stairs_side_high'); const g0 = golden.cases[s.id];
  const st = {}; for (const [k, v] of Object.entries(g0.states)) st[k.replace('half=top', 'half=bottom')] = v;
  brk('golden stairs_side_high rewritten to half=bottom', compare(s, Object.assign({}, g0, { states: st }), { attempts: g0.attempts, states: g0.states }).length > 0); }
{ const s = SCEN.find((q) => q.id === 'log_side');
  brk('engine Use.rightClick no-op (log_side)', compare(s, golden.cases[s.id], engineRun(s, () => {})).length > 0); }
{ const s = SCEN.find((q) => q.id === 'door_floor'); const g0 = golden.cases[s.id];
  const st = {}; for (const [k, v] of Object.entries(g0.states)) st[k.split(' | ')[0] + ' | air'] = v;
  brk('golden door_floor upper half dropped', compare(s, Object.assign({}, g0, { states: st }), { attempts: g0.attempts, states: g0.states }).length > 0); }
for (const r of reds) console.log('  ✗ ' + r);
console.log(`placerefcheck: ${pass}/${SCEN.length} scenarios agree, ${reds.length} red · anti-vacuity ${caught}/${breaks}`);
console.log(` assertions passed .... ${pass + caught}`);
console.log(` failures ........... ${reds.length}`);
console.log(` breaks caught ...... ${caught}`);
process.exit(reds.length ? 1 : 0);
