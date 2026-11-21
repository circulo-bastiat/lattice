// sheepgrasslockstepcheck.mjs -- #6301 (G17-L53): lockstep scenario 'sheepgrass': a sheared sheep (adult and baby) on grass_block, and an adult on the short grass plant, 20 salts.
// Reference = .decomp EatGrassGoal written out in the jar's own GOAL ticks (a goal not overriding shouldRunEveryTick is evaluated/ticked every OTHER tick): canStart = nextInt(baby ? 50 : 1000) == 0
// and grass at the feet or grass_block below, drawn only while idle; start() timer = 40 raw (getTickCount: 20 goal ticks) then tick() the same update; tick(): timer-1, at getTickCount(4) = 2
// goal ticks the grass is eaten (plant removed / grass_block -> dirt, mobGriefing) and SheepEntity.onEatingGrass clears sheared; canContinue = timer > 0.
// Per tick sheared, goals and blocks go through lockstep/trace.mjs compareTraces. The entity Random is scripted: the engine, which runs the goal every tick, is fed 0.99 on odd ticks and (ri+0.25)/N_engine on goal ticks.
import { loadEngine } from '../loadsrc.mjs';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MCLITE_ROOT } from '../loadsrc.mjs';
import { serverRow, engineRow, compareTraces, blocksDiff } from './lockstep/trace.mjs';
const M = loadEngine({ extra: ['02f_tags.js', '02g_items.js', '07b_behaviour.js', '07_world.js', '07h_entities.js', '14b_physics.js', '07i_entitylist.js', '07k_goals.js', '07m_breed.js', '07w_passive.js'], dom: false, initReg: true });
M.DATA = Object.assign({}, M.DATA, { entities: JSON.parse(readFileSync(join(MCLITE_ROOT, 'assets', 'entities.json'), 'utf8')) });
M.Entities.init();
const { Ai, Passive: Ps, Reg: R, States: St } = M;
let fails = 0, breaks = 0, n = 0;
const ok = (c, m) => { n++; if (!c) { fails++; console.log('  FAIL ' + m); } };
const TICKS = 200, salts = Array.from({ length: 20 }, (_, i) => i);
const GRASS_BLOCK = St.stateOf('grass_block'), DIRT = St.stateOf('dirt'), PLANT = R.realFirst[R.id.grass] + R.defaultState[R.id.grass];
const NAME = { [GRASS_BLOCK]: 'grass_block[snowy=false]', [DIRT]: 'dirt', [PLANT]: 'grass', 0: 'air' };
const F = { fields: ['sheared', 'goals', 'blocks'] };
const stream = (salt) => { let s = (salt * 2654435761 + 977) >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; };
// the scripted draw per goal tick: a decoy just above 1/1000 (nextInt(999) would take it), then the trigger u = 0
function script(salt, N) {   // N: 1000 adult, 50 baby (decoy = 1/N + a hair)
  const r = stream(salt), trig = 6 + (salt * 7) % 40, out = [];
  for (let g = 0; g < TICKS; g++) out.push(g === trig - 1 ? 1.0005 / N : g === trig ? 0 : 0.1 + 0.88 * r());
  return out;
}
const cases = [['grass_block', false], ['grass_plant', false], ['grass_block', true]];   // [ground, baby]
function reference(ground, baby, salt, Nroll, griefing) {
  const N = baby ? 50 : 1000, U = script(salt, N), rows = [];
  let sheared = true, timer = 0, running = false, gi = 0, plant = ground === 'grass_plant', block = 'grass_block[snowy=false]';
  for (let t = 0; t < TICKS; t++) {
    const bl = [];
    if (t % 2 === 0) {   // goal tick
      if (running && !(timer > 0)) running = false;
      if (!running) {
        const u = U[gi++];
        if (Math.floor(u * (Nroll || N)) === 0 && (plant || block === 'grass_block[snowy=false]')) { running = true; timer = 20; }
      }
      if (running) {
        timer = Math.max(0, timer - 1);
        if (timer === 2) {
          if (plant) { if (griefing) { plant = false; bl.push([0, 64, 0, 'grass', 'air']); } sheared = false; }
          else if (block === 'grass_block[snowy=false]') { if (griefing) { block = 'dirt'; bl.push([0, 63, 0, 'grass_block[snowy=false]', 'dirt']); } sheared = false; }
        }
      }
    }
    rows.push({ sheared, goals: running ? [[5, 'EatGrassGoal']] : [], blocks: bl });
  }
  return rows;
}
function engine(ground, baby, salt, griefing) {
  const N = baby ? 50 : 1000, U = script(salt, N), cells = new Map();
  cells.set('0,63,0', GRASS_BLOCK); if (ground === 'grass_plant') cells.set('0,64,0', PLANT);
  const snap = () => new Map([...cells].map(([k, v]) => [k, NAME[v]]));
  M.World = { getBlock: (x, y, z) => cells.get(x + ',' + y + ',' + z) || 0, setBlock: (x, y, z, s) => { if (s) cells.set(x + ',' + y + ',' + z, s); else cells.delete(x + ',' + y + ',' + z); }, getLight: () => 0 };
  const e = { type: 'sheep', x: 0.5, y: 64, z: 0.5, sheared: true, growAge: baby ? -24000 : 0, isBaby: baby };
  let tick = 0, gi = 0;
  const rand = () => (tick % 2 === 0 ? (Math.floor(U[gi++] * N) + 0.25) / (baby ? 100 : 2000) : 0.99);
  const goal = new Ps.EatGrassGoal(e, { random: rand, mobGriefing: () => griefing });
  goal.__goalName = 'EatGrassGoal';
  const gs = new Ai.GoalSelector(); gs.add(5, Ai.MOVE | Ai.LOOK | Ai.JUMP, goal); e.ai = gs;
  let prev = snap(); const rows = [];
  for (tick = 0; tick < TICKS; tick++) {
    gs.tick();
    const cur = snap();
    rows.push({ sheared: !!e.sheared, goals: Ai.runningGoals(e), blocks: blocksDiff(prev, cur) }); prev = cur;
  }
  return rows;
}
const DBG = process.env.DBG;
const run = (ground, baby, salt, Nroll, griefing = true) => {
  const Rr = reference(ground, baby, salt, Nroll, griefing), E = engine(ground, baby, salt, griefing);
  const S = Rr.map((r, t) => Object.assign(serverRow(t, {}), r)), G = E.map((r, t) => Object.assign(engineRow(t, {}), r));
  const d = compareTraces(S, G, F); if (DBG && d) console.log(JSON.stringify(d));
  return { d, Rr };
};
for (const [ground, baby] of cases) {
  const bad = salts.map((s) => ({ s, r: run(ground, baby, s) })).filter((x) => x.r.d);
  ok(!bad.length, `${ground}${baby ? ' baby' : ''}: ${bad.slice(0, 2).map((x) => `salt ${x.s} tick ${x.r.d.tick} ${x.r.d.field}`)}`);
}
ok(run('grass_block', false, 3).Rr.some((r) => r.blocks.length) && run('grass_plant', false, 3).Rr.some((r) => !r.sheared), 'eating happens (not vacuous)');
ok(run('grass_block', false, 3, undefined, false).Rr.every((r) => !r.blocks.length) && !run('grass_block', false, 3, undefined, false).d, 'mobGriefing false: no block change, sheared still clears');
const brk = (c, m) => { if (c) { breaks++; console.log('   ✓ break caught: ' + m); } else { fails++; console.log('  ✗ break NOT caught: ' + m); } };
const dirty = (g, b, Nroll) => salts.some((s) => run(g, b, s, Nroll).d);
brk(dirty('grass_block', false, 999), 'roll 1000 -> 999 caught');
{ const o = Ps.EAT_GRASS_ADULT_ROLL; Ps.EAT_GRASS_ADULT_ROLL = 1000; brk(dirty('grass_block', false), 'engine roll 2000 -> 1000 caught'); Ps.EAT_GRASS_ADULT_ROLL = o; }
{ const o = Ps.onEatingGrass; Ps.onEatingGrass = () => {}; brk(dirty('grass_plant', false), 'sheared flag never cleared caught'); Ps.onEatingGrass = o; }
{ const o = Ps.EAT_GRASS_TRIGGER; Ps.EAT_GRASS_TRIGGER = o + 2; brk(dirty('grass_block', false), 'eat tick shifted caught'); Ps.EAT_GRASS_TRIGGER = o; }
console.log(`sheepgrasslockstepcheck: ${n + breaks} assertions, ${fails} failures, ${breaks} breaks caught`);
process.exit(fails ? 1 : 0);
