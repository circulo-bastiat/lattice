#!/usr/bin/env node
// cmdblockcheck.mjs — #8300 (G17-CB1): the impulse command block executes its command
// (CommandBlock.neighborUpdate -> scheduledTick -> execute), once per rising edge, never unpowered.
import { loadEngine } from './loadsrc.mjs';

let pass = 0; const fails = []; let breaks = 0;
const ok = (c, m) => { if (c) pass++; else fails.push(m); };

const EXTRA = ['02f_tags.js', '02g_items.js', '07b_behaviour.js', '07c_blockentity.js', '07f_redstone.js', '07zzz_cmdblock.js'];
const MCL = loadEngine({ extra: EXTRA, dom: false });
const S = MCL.States, B = MCL.Behave;
const N = 32, MID = 16, cells = new Uint16Array(N * N * N);
const idx = (x, y, z) => (((y + MID) * N + (z + MID)) * N + (x + MID));
const W = {
  getBlock: (x, y, z) => cells[idx(x, y, z)],
  setBlock(x, y, z, id) { cells[idx(x, y, z)] = id; if (B.ready) B.changed(x, y, z); return true; },
  blockLightAt: () => 15,
};
MCL.World = W; B.init(W); MCL.BlockEntities.init(); B.clearSchedule(); MCL.Redstone.init();

let ran = 0;
MCL.Commands = { ruleGet: () => 'true', run(cmd, _p, src) {
  ran++; W.setBlock(5, 0, 5, S.stateOf('stone') | 0); return { ok: true, result: 1, lines: ['Changed the block'], src };
} };
const put = (x, y, z, n) => W.setBlock(x, y, z, S.stateOf(n) | 0);
const tick = (n) => { for (let t = 0; t < n; t++) B.tick(); };

function setup() {
  cells.fill(0); B.clearSchedule(); ran = 0;
  put(0, 0, 0, 'command_block');
  const e = MCL.BlockEntities.get(0, 0, 0) || MCL.BlockEntities.create(0, 0, 0, 'command_block');
  e.command = 'setblock 5 0 5 stone'; return e;
}
function scenario() {
  const out = {};
  let e = setup();
  tick(5); out.idle = ran;                                  // unpowered: nothing
  put(1, 0, 0, 'redstone_block'); tick(5); out.rise = ran; out.world = W.getBlock(5, 0, 5) === (S.stateOf('stone') | 0);
  out.powered = !!e.powered; out.success = e.successCount;
  tick(10); out.held = ran;                                 // still powered: no re-run
  put(1, 0, 0, 'air'); tick(5); put(1, 0, 0, 'redstone_block'); tick(5); out.second = ran;
  return out;
}
const r = scenario();
ok(r.idle === 0, 'unpowered command block does nothing');
ok(r.rise === 1 && r.world, 'rising edge runs the command once and the world changes');
ok(r.powered && r.success === 1, 'powered flag set, successCount 1');
ok(r.held === 1, 'staying powered does not re-run (impulse)');
ok(r.second === 2, 'a second rising edge runs it again');

// anti-vacuity: remove the neighborUpdate wiring
const upd = MCL.CmdBlock.update; MCL.CmdBlock.update = () => 0;
const r2 = scenario(); MCL.CmdBlock.update = upd;
breaks++; ok(r2.rise === 0, 'anti-vacuity: without neighborUpdate wiring the command never runs'); console.log('  ✓ ' + 'anti-vacuity: without neighborUpdate wiring the command never runs');
const tk = MCL.CmdBlock.tick; MCL.CmdBlock.tick = () => false;
const r3 = scenario(); MCL.CmdBlock.tick = tk;
breaks++; ok(r3.rise === 0, 'anti-vacuity: without the scheduledTick wiring the command never runs'); console.log('  ✓ ' + 'anti-vacuity: without the scheduledTick wiring the command never runs');

console.log(`cmdblockcheck: ${pass} checks passed, ${fails.length} failures, ${breaks} breaks caught`);
if (fails.length) { fails.forEach((f) => console.log('  FAIL: ' + f)); process.exit(1); }
