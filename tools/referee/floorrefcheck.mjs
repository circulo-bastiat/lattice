#!/usr/bin/env node
// floorrefcheck.mjs — infra I6 (s150): which FLOOR blocks a monster may NATURALLY spawn on, vs the real 1.18.2 server
// (golden: runfloor.mjs, floor.json; boxes: floorscen.mjs). A set question: the server's verdict for a floor is
// "some monster spawned in a sealed dark box floored with it" (a legal floor draws ~300-600 spawns per box in 2000
// ticks; an illegal one exactly 0 — nothing in between was ever seen). The engine's verdict: `Spawn.checkPlacement`
// (07l_spawn.js — the ON_GROUND clearance, then the per-type rule: isDarkEnoughToSpawn + checkMobSpawnRules, reason
// 'natural') accepts SOME cell of the same box (the 14x14 interior at y -61..-58, i.e. standing on the floor or
// inside a non-full floor block over the flat world's dirt) for zombie, skeleton, spider or creeper (the monster
// list's box-fitting types), rolls forced to their most permissive value (a dark box: the rolls cannot refuse).
// Anti-vacuity (D-30/D-305): `Spawn.NO_SPAWN_BLOCKS` emptied, and Behave.faceSturdy forced true, must each flip a
// floor that matches today.
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { loadEngine, MCLITE_ROOT } from '../loadsrc.mjs';
import { FLOORS, FLOOR_Y, W } from './floorscen.mjs';

const VERBOSE = process.argv.includes('--verbose');
const refDir = process.env.MCLITE_REFEREE_DIR || join(homedir(), '.mclite-referee', '1.18.2');
const GOLDEN = [join(refDir, 'golden', 'floor.json'), join(MCLITE_ROOT, '..', 'mclite-store', 'golden', 'floor.json')].find((f) => existsSync(f));
if (!GOLDEN) { console.log('floorrefcheck: SKIP (golden not generated -- run node tools/referee/runfloor.mjs)'); process.exit(0); }
const golden = JSON.parse(readFileSync(GOLDEN, 'utf8'));
const rdj = (f) => JSON.parse(readFileSync(join(MCLITE_ROOT, 'assets', f), 'utf8'));

const MODS = ['02f_tags.js', '07b_behaviour.js', '07_world.js', '07h_entities.js', '14b_physics.js', '07i_entitylist.js', '07k_goals.js', '07l_spawn.js'];
const M = loadEngine({ extra: MODS.concat(readdirSync(join(MCLITE_ROOT, 'src')).filter((f) => /^07.*\.js$/.test(f) && !MODS.includes(f)).sort()), dom: false, initReg: true });
M.DATA = Object.assign({}, M.DATA, { entities: rdj('entities.json') });
M.Entities.init();
const { States: S, Reg: R, Spawn: Sp } = M;

// "name[k=v,...]" -> the real state, through the engine's own registry (S.withProp)
function stateOf(spec) {
  const m = /^([a-z_]+)(?:\[(.*)\])?$/.exec(spec);
  let st = S.stateOf(m[1]);
  if (m[2]) for (const kv of m[2].split(',')) {
    const [k, v] = kv.split('=');
    const pid = R.PROP[k], vid = R.valueNames.indexOf(v);
    if (pid === undefined || vid < 0) throw new Error(`floorrefcheck: no property ${k}=${v} for ${spec}`);
    st = S.withProp(st, pid, vid);
  }
  return st;
}
const cells = new Map();
const key = (x, y, z) => x + ',' + y + ',' + z;
const w = { get: (x, y, z) => cells.get(key(x, y, z)) || 0, set: (x, y, z, s) => { if (s) cells.set(key(x, y, z), s); else cells.delete(key(x, y, z)); } };
w.getBlock = w.get; w.setBlock = w.set; w.getLight = () => 0; w.tickingAt = () => true; w.loadedAt = () => true;
w.canSeeSky = () => false;
M.World = Object.assign(M.World || {}, w);
if (M.Behave && M.Behave.init) M.Behave.init(M.World);
M.Physics.shapeAt = (x, y, z) => { const id = w.get(Math.floor(x), Math.floor(y), Math.floor(z)); if (!id) return null; const sh = M.Physics.shapesForState(id); return sh && sh.length ? sh : null; };
M.EntityList.init(); M.Ai.init();
if (M.Diff && M.Diff.set) M.Diff.set('normal');
if (M.Sky) { M.Sky.darknessNow = () => 0; M.Sky.isThundering = () => false; }
M.Spawn.init();
const TYPES = ['zombie', 'skeleton', 'spider', 'creeper'];
const rnd0 = () => 0;

function engineAllows(spec) {
  cells.clear();
  const stone = S.stateOf('stone'), dirt = S.stateOf('dirt'), floor = stateOf(spec);
  for (let x = -1; x <= W; x++) for (let z = -1; z <= W; z++) {
    w.set(x, FLOOR_Y - 3, z, S.stateOf('bedrock')); w.set(x, FLOOR_Y - 2, z, dirt); w.set(x, FLOOR_Y - 1, z, dirt);
    const shell = x < 0 || z < 0 || x >= W || z >= W;
    w.set(x, FLOOR_Y, z, shell ? stone : floor);
    for (let y = FLOOR_Y + 1; y <= FLOOR_Y + 3; y++) if (shell) w.set(x, y, z, stone);
    w.set(x, FLOOR_Y + 4, z, stone);
  }
  for (const t of TYPES) for (let x = 0; x < W; x++) for (let z = 0; z < W; z++) for (let y = FLOOR_Y; y <= FLOOR_Y + 3; y++)
    if (Sp.checkPlacement(t, x, y, z, 'natural', rnd0)) return { ok: true, at: `${t} at y${y}` };
  return { ok: false };
}
function evaluate() {
  return FLOORS.filter((f) => golden.floors[f]).map((f) => {
    const g = golden.floors[f], srv = g.some((n) => n > 0), eng = engineAllows(f);
    return { id: f, ok: srv === eng.ok, msg: `server ${srv ? 'spawns' : 'never'} (${g.join('/')}), engine ${eng.ok ? 'allows (' + eng.at + ')' : 'refuses'}` };
  });
}
let failed = 0;
const rows = evaluate();
for (const r of rows) { if (!r.ok) failed++; if (!r.ok || VERBOSE) console.log(`  ${r.ok ? 'ok  ' : 'FAIL'} ${r.id.padEnd(32)} ${r.msg}`); }
const okIds = rows.filter((r) => r.ok).map((r) => r.id);
let av = 0, avPass = 0;
function breakAndCatch(label, set, restore) {
  av++; set();
  const broke = evaluate().filter((r) => okIds.includes(r.id) && !r.ok).length;
  restore();
  if (broke > 0) avPass++; else { failed++; console.log(`  FAIL anti-vacuity ${label}: no matching floor flipped`); }
}
{ const k = Sp.NO_SPAWN_BLOCKS; breakAndCatch('NO_SPAWN_BLOCKS emptied', () => { Sp.NO_SPAWN_BLOCKS = {}; }, () => { Sp.NO_SPAWN_BLOCKS = k; }); }
{ const f = M.Behave.faceSturdy; breakAndCatch('faceSturdy always true', () => { M.Behave.faceSturdy = () => true; }, () => { M.Behave.faceSturdy = f; }); }
console.log(`floorrefcheck: ${okIds.length}/${rows.length} floors match the server, anti-vacuity ${avPass}/${av} -- ${failed} failed`);
console.log(` assertions passed .... ${okIds.length + avPass}`);
console.log(` failures ........... ${failed}`);
console.log(` breaks caught ...... ${avPass}`);
process.exit(failed ? 1 : 0);
