#!/usr/bin/env node
// cmdblockrepeatcheck.mjs — #8301 (G17-CB2): repeating command block reschedules every tick while auto/powered;
// a conditional block runs only if the block behind it succeeded (successCount > 0).
import { loadEngine } from './loadsrc.mjs';
let pass = 0; const fails = []; let breaks = 0;
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const EXTRA = ['02f_tags.js', '02g_items.js', '07b_behaviour.js', '07c_blockentity.js', '07f_redstone.js', '07zzz_cmdblock.js'];
const MCL = loadEngine({ extra: EXTRA, dom: false });
const S = MCL.States, B = MCL.Behave;
const N = 32, MID = 16, cells = new Uint16Array(N * N * N);
const idx = (x, y, z) => (((y + MID) * N + (z + MID)) * N + (x + MID));
const W = { getBlock: (x, y, z) => cells[idx(x, y, z)],
  setBlock(x, y, z, id) { cells[idx(x, y, z)] = id; if (B.ready) B.changed(x, y, z); return true; }, blockLightAt: () => 15 };
MCL.World = W; B.init(W); MCL.BlockEntities.init(); B.clearSchedule(); MCL.Redstone.init();
let ran = 0, okResult = 1;
MCL.Commands = { ruleGet: () => 'true', run() { ran++; return { ok: okResult > 0, result: okResult, lines: [] }; } };
const tick = (n) => { for (let t = 0; t < n; t++) B.tick(); };
const stateOf = (n, facing, cond) => { let s = S.stateOf(n) | 0;
  if (facing) for (let i = 0; i < 20344 && false; i++); return s; };
function mk(x, y, z, name, props) {
  const st = MCL.Reg.stateByProps ? 0 : 0; void st;
  W.setBlock(x, y, z, S.stateOf(name) | 0);
  return MCL.BlockEntities.get(x, y, z) || MCL.BlockEntities.create(x, y, z, name);
}
function repeat() {
  cells.fill(0); B.clearSchedule(); ran = 0; okResult = 1;
  const e = mk(0, 0, 0, 'repeating_command_block'); e.command = 'x'; e.auto = true;
  B.schedule(0, 0, 0, 1); tick(20); return ran;
}
const r = repeat();
ok(r === 20, 'repeating auto block runs once per tick for 20 ticks, got ' + r);
const tk = MCL.CmdBlock.tick;
MCL.CmdBlock.tick = function (x, y, z) { // reschedule removed
  const e = MCL.BlockEntities.get(x, y, z); if (!e) return true; MCL.CmdBlock.executeCommand(e, x, y, z, W.getBlock(x, y, z)); return true; };
const r2 = repeat(); MCL.CmdBlock.tick = tk;
breaks++; ok(r2 === 1, 'anti-vacuity: without reschedule it runs once, got ' + r2); console.log('  ✓ anti-vacuity: without reschedule it runs once');

// conditional: find a conditional=true state facing east (behind = x-1)
function condState(name) {
  const base = S.stateOf(name) | 0;
  for (let s = 1; s < 20344; s++) if (MCL.Reg.names[S.block[s]] === name && MCL.Behave.propName(s, 'conditional') === 'true' && MCL.Behave.propName(s, 'facing') === 'east') return s;
  return base;
}
function cond(behindOk) {
  cells.fill(0); B.clearSchedule(); ran = 0; okResult = 1;
  const a = mk(0, 0, 0, 'command_block'); a.command = 'a'; a.successCount = behindOk ? 1 : 0;
  W.setBlock(1, 0, 0, condState('command_block'));
  const b = MCL.BlockEntities.get(1, 0, 0) || MCL.BlockEntities.create(1, 0, 0, 'command_block'); b.command = 'b';
  W.setBlock(1, 1, 0, S.stateOf('redstone_block') | 0); tick(5); return ran;
}
ok(cond(true) === 1, 'conditional block behind a succeeding command runs');
ok(cond(false) === 0, 'conditional block behind a failing command does not run');
const uc = MCL.CmdBlock.executeCommand;
breaks++; { const save = MCL.Behave.propName; MCL.Behave.propName = (s, p) => p === 'conditional' ? 'false' : save(s, p);
  ok(cond(false) === 1, 'anti-vacuity: ignoring the conditional flag runs it anyway'); console.log('  ✓ anti-vacuity: ignoring the conditional flag runs it anyway'); MCL.Behave.propName = save; }
void uc; void stateOf;
console.log(`cmdblockrepeatcheck: ${pass} checks passed, ${fails.length} failures, ${breaks} breaks caught`);
if (fails.length) { fails.forEach((f) => console.log('  FAIL: ' + f)); process.exit(1); }
