#!/usr/bin/env node
// mobaicheck.mjs — #212 (G18b-1): the engine's mob melee reach/interval, BreakDoorGoal threshold and
// fire/cactus/berry/door node-type mapping, compared with the jar-bytecode golden
// (tools/golden/mobai-1.18.2.tsv, written by tools/extract-mobai.mjs off .decomp).
//
//   node tools/mobaicheck.mjs [--verbose]
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEngine } from './loadsrc.mjs';
import { derive, NODE_NAMES } from './extract-mobai.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const VERBOSE = process.argv.includes('--verbose');
let pass = 0, breaks = 0;
const fails = [];
const ok = (c, m) => { if (c) pass++; else if (fails.length < 40) fails.push(m); if (VERBOSE) console.log((c ? '   ✓ ' : '   ✗ ') + m); return c; };

console.log('mobaicheck — melee reach/interval, BreakDoorGoal, node-type mapping vs the jar golden');
const G = {};
for (const line of readFileSync(join(ROOT, 'tools', 'golden', 'mobai-1.18.2.tsv'), 'utf8').split(/\r?\n/)) {
  if (!line || line.startsWith('#')) continue;
  const c = line.split('\t'); G[c[0]] = c[1];
}
ok(Object.keys(G).length >= 50, 'the golden has its rows (' + Object.keys(G).length + ')');

const M = loadEngine({
  extra: ['02f_tags.js', '07b_behaviour.js', '07_world.js', '07h_entities.js', '14b_physics.js',
          '07i_entitylist.js', '07k_goals.js', '07l_spawn.js', '14c_raycast.js']
});
M.DATA = Object.assign({}, M.DATA, { entities: JSON.parse(readFileSync(join(ROOT, 'assets', 'entities.json'), 'utf8')) });
M.Entities.init(); M.EntityList.init(); M.Behave.init(M.World); M.Ai.init();
const Ai = M.Ai, W = M.World, CH = M.CH, T = Ai.NodeType;
const stateOf = (n) => M.States.stateOf(n) | 0;
const PLAT_Y = 8, Y = PLAT_Y + 1;
function fresh() {
  W.init(1);
  for (let cx = -2; cx <= 2; cx++) for (let cz = -2; cz <= 2; cz++) {
    const c = W.makeChunk(cx, cz); c.state = CH.GENERATED; W.chunks.set(W.key(cx, cz), c);
  }
  for (let x = -8; x <= 8; x++) for (let z = -8; z <= 8; z++) W.setBlock(x, PLAT_Y, z, stateOf('stone'));
}
// put `name` at (x, Y, 0) with whatever survival support it needs (setBlock refuses an unsupported cactus/berry/cocoa)
const SUPPORT = { cactus: 'sand', sweet_berry_bush: 'dirt' };
function place(name, x) {
  if (SUPPORT[name]) W.setBlock(x, PLAT_Y, 0, stateOf(SUPPORT[name]));
  if (name === 'cocoa') W.setBlock(x, Y, -1, stateOf('jungle_log'));
  W.setBlock(x, Y, 0, stateOf(name));
}
const doorState = (name, open) => {
  const b = stateOf(name);
  for (let st = b; st < b + 32 && M.States.block[st] === M.States.block[b]; st++) {
    if (M.Behave.propName(st, 'open') === String(open) && M.Behave.propName(st, 'half') === 'lower') return st;
  }
  return -1;
};

/** Every comparison of engine vs golden; returns the number of disagreements found for `g`. */
const nameOf = (v) => Object.keys(T).find((k) => T[k] === v);
function compare(g, engine, record) {
  let bad = 0;
  const eq = (a, b, m) => { if (!(a === b)) { bad++; if (fails.length < 40 && record) fails.push(m + ' (engine ' + a + ', golden ' + b + ')'); } else if (record) pass++; };
  const f = +g['melee.reach_self_factor'];
  const e = { width: 0.9 }, t = { width: 0.6 };
  eq(engine.reach(e, t), f * 0.9 * f * 0.9 + 0.6, 'attackReachSqr formula');
  eq(engine.reach({ width: 0.6 }, { width: 0.6 }), f * 0.6 * f * 0.6 + 0.6, 'attackReachSqr for a zombie');
  eq(engine.interval, +g['melee.attack_interval'], 'MOB_ATTACK_INTERVAL');
  eq(engine.doorTicks, +g['breakdoor.min_max_progress'], 'DOOR_BREAK_TICKS');
  for (const n of NODE_NAMES) eq(engine.penalty[T[n]], +g['nodetype.penalty.' + n], 'default penalty ' + n);
  for (const [k, v] of Object.entries(g)) {
    if (['cactus', 'sweet_berry_bush', 'honey_block', 'cocoa', 'powder_snow'].includes(k.slice(7)) && k.startsWith('common.')) {
      const name = k.slice(7);
      const st = stateOf(name); if (st <= 0) { bad++; continue; }
      fresh(); place(name, 0);
      eq(nameOf(engine.common(0, Y, 0)), v, 'common ' + name);
    }
  }
  // fire family
  for (const b of g['fire_damage.blocks'].split(',').filter((n) => n !== 'lava')) {   // lava is caught earlier, as LAVA (fluid tag)
    fresh(); W.setBlock(0, Y, 0, stateOf(b));
    eq(nameOf(engine.common(0, Y, 0)), g['common.inflicts_fire_damage'], 'inflicts fire damage: ' + b);
  }
  fresh(); W.setBlock(0, Y, 0, stateOf('fire'));
  eq(nameOf(engine.common(0, Y, 0)), g['common.inflicts_fire_damage'], 'fire (fire tag)');
  fresh(); W.setBlock(0, Y, 0, stateOf('lava'));
  eq(nameOf(engine.common(0, Y, 0)), g['common.fluid:lava'], 'lava');
  // doors
  fresh(); W.setBlock(0, Y, 0, doorState('oak_door', false));
  eq(nameOf(engine.common(0, Y, 0)), g['common.door:wooden_closed'], 'closed wooden door');
  fresh(); W.setBlock(0, Y, 0, doorState('iron_door', false));
  eq(nameOf(engine.common(0, Y, 0)), g['common.door:metal_closed'], 'closed iron door');
  fresh(); W.setBlock(0, Y, 0, doorState('oak_door', true));
  eq(nameOf(engine.common(0, Y, 0)), g['common.door:open'], 'open door');
  // neighbour scan (a walkable cell beside the hazard)
  for (const [k, v] of Object.entries(g)) {
    if (!k.startsWith('neighbour.') || k === 'neighbour.range' || k.includes('inflicts') || k.includes('fluid')) continue;
    const name = k.slice(10);
    fresh(); place(name, 2);
    eq(nameOf(engine.path(1, Y, 0)), v, 'neighbour ' + name);
  }
  fresh(); W.setBlock(2, Y, 0, stateOf('magma_block'));
  eq(nameOf(engine.path(1, Y, 0)), g['neighbour.inflicts_fire_damage'], 'neighbour of magma');
  fresh(); W.setBlock(2, PLAT_Y, 0, stateOf('water')); W.setBlock(2, Y, 0, stateOf('water'));
  eq(nameOf(engine.path(1, Y, 0)), g['neighbour.fluid:water'], 'neighbour of water');
  return bad;
}
const engine = () => ({
  reach: Ai.attackReachSqr, interval: Ai.MOB_ATTACK_INTERVAL, doorTicks: Ai.DOOR_BREAK_TICKS,
  penalty: Ai.DEFAULT_PENALTY, common: Ai.commonNodeType, path: Ai.pathTypeAt
});

console.log(' 1. engine constants and node-type mapping equal the golden');
const bad = compare(G, engine(), true);
ok(bad === 0, 'no disagreement between the engine and the golden (' + bad + ')');

console.log(' 1b. BowAttackGoal strafe refuses a non-WALKABLE destination (MoveControl getDefaultNodeType)');
{
  const strafeOk = (name) => { fresh(); if (name) place(name, 1); return Ai.strafeWalkable({ x: 0.5, y: Y, z: 0.5 }, 1, 0); };
  ok(strafeOk(null) === true, 'open stone floor: strafe allowed');
  for (const n of ['cactus', 'lava', 'water', 'fire', 'oak_fence']) {
    ok(strafeOk(n) === false, n + ' at the strafe cell: strafe refused');
  }
}
console.log(' 2. anti-vacuity: corrupt the golden / the engine / the extractor input, the check must notice');
const corrupt = (k, v) => Object.assign({}, G, { [k]: v });
const cases = [
  ['melee.reach_self_factor', '3'], ['melee.attack_interval', '21'], ['breakdoor.min_max_progress', '241'],
  ['nodetype.penalty.DAMAGE_FIRE', '15'], ['common.cactus', 'DANGER_CACTUS'], ['common.sweet_berry_bush', 'BLOCKED'],
  ['common.honey_block', 'OPEN'], ['common.cocoa', 'BLOCKED'], ['common.inflicts_fire_damage', 'DANGER_FIRE'],
  ['common.door:wooden_closed', 'DOOR_OPEN'], ['common.door:metal_closed', 'DOOR_WOOD_CLOSED'], ['common.door:open', 'BLOCKED'],
  ['common.fluid:lava', 'WATER'], ['neighbour.cactus', 'DANGER_OTHER'], ['neighbour.sweet_berry_bush', 'DANGER_CACTUS'],
  ['neighbour.inflicts_fire_damage', 'DAMAGE_FIRE'], ['neighbour.fluid:water', 'WATER'],
];
let caught = 0;
for (const [k, v] of cases) { if (compare(corrupt(k, v), engine()) > 0) { caught++; console.log('   ✓ break caught: ' + k + ' = ' + v); } else fails.push('corrupting ' + k + ' went unnoticed'); breaks++; }
// engine-side corruption
{
  const e = engine(); e.interval = 19; breaks++;
  if (compare(G, e) > 0) { caught++; console.log('   ✓ break caught: engine interval'); } else fails.push('a wrong engine interval went unnoticed');
  const e2 = engine(); e2.reach = (a, b) => 4 * a.width * a.width; breaks++;
  if (compare(G, e2) > 0) { caught++; console.log('   ✓ break caught: engine reach'); } else fails.push('a wrong engine reach went unnoticed');
}
// strafe: the old "block under has a collision shape" test must be noticed (cactus has a shape)
{
  const real = Ai.strafeWalkable; breaks++;
  Ai.strafeWalkable = (e, wx, wz) => { const st = W.getBlock(Math.floor(e.x + wx), Math.floor(e.y) - 1, Math.floor(e.z + wz)); return st !== 0 && !!(M.Physics.shapesForState(st) || []).length; };
  fresh(); place('cactus', 1);
  if (Ai.strafeWalkable({ x: 0.5, y: Y, z: 0.5 }, 1, 0) === true) { caught++; console.log('   ✓ break caught: strafe by collision shape'); } else fails.push('shape-based strafe went unnoticed');
  Ai.strafeWalkable = real;
}
// extractor-side corruption: a decompile that no longer says what the regexes expect must fail the run
const ENT = join(ROOT, '.decomp', 'net', 'minecraft', 'entity');
if (existsSync(ENT)) {
  const blocks = readFileSync(join(ROOT, '.decomp', 'net', 'minecraft', 'block', 'Blocks.java'), 'utf8');
  const rows = derive(ENT, blocks);
  const fromJar = Object.fromEntries(rows);
  ok(Object.keys(fromJar).length === Object.keys(G).length && Object.entries(G).every(([k, v]) => fromJar[k] === v), 'the committed golden is what the extractor derives from .decomp now');
  const fs = await import('node:fs');
  const os = await import('node:os'); const path = await import('node:path');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mobai-'));
  const cp = (rel) => { const d = path.join(tmp, rel); fs.mkdirSync(path.dirname(d), { recursive: true }); fs.copyFileSync(join(ENT, rel), d); return d; };
  const rels = ['ai/goal/MeleeAttackGoal.java', 'ai/goal/BreakDoorGoal.java', 'ai/goal/DoorInteractGoal.java', 'ai/pathing/PathNodeType.java', 'ai/pathing/LandPathNodeMaker.java'];
  for (const r of rels) cp(r);
  const mut = [['ai/goal/MeleeAttackGoal.java', 'getTickCount(20)', 'getTickCount(10)'], ['ai/goal/MeleeAttackGoal.java', '* 2.0F * this.mob.getWidth() * 2.0F', '* 2.0F * this.mob.getWidth() * 3.0F'],
    ['ai/goal/BreakDoorGoal.java', 'MIN_MAX_PROGRESS = 240', 'MIN_MAX_PROGRESS = 200'], ['ai/goal/BreakDoorGoal.java', 'this.breakProgress == this.getMaxProgress()', 'this.breakProgress >= this.getMaxProgress()'],
    ['ai/goal/DoorInteractGoal.java', 'getCurrentNodeIndex() + 2', 'getCurrentNodeIndex() + 3'], ['ai/pathing/PathNodeType.java', '(16.0F)', '(15.0F)'],
    ['ai/pathing/LandPathNodeMaker.java', 'return PathNodeType.field_23;', 'return PathNodeType.field_8;']];
  for (const [rel, a, b] of mut) {
    const d = path.join(tmp, rel), src = fs.readFileSync(join(ENT, rel), 'utf8');
    breaks++;
    if (!src.includes(a)) { fails.push('mutation target missing: ' + a); continue; }
    fs.writeFileSync(d, src.replace(a, b));
    let threw = false, differs = false;
    try { const r = Object.fromEntries(derive(tmp, blocks)); differs = Object.entries(G).some(([k, v]) => r[k] !== v); } catch { threw = true; }
    fs.copyFileSync(join(ENT, rel), d);
    if (threw || differs) { caught++; console.log('   ✓ break caught: extractor ' + a); } else fails.push('extractor mutation went unnoticed: ' + a);
  }
  fs.rmSync(tmp, { recursive: true, force: true });
} else console.log('   (no .decomp here — extractor cross-check skipped)');
ok(caught === breaks, caught + ' of ' + breaks + ' corruptions caught');

console.log(fails.length ? fails.map((f) => ' ✗ ' + f).join('\n') : '');
console.log('mobaicheck: ' + pass + ' assertions, ' + caught + ' breaks caught' + (fails.length ? ', ' + fails.length + ' FAILED' : ''));
process.exit(fails.length ? 1 : 0);
