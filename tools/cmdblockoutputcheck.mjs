#!/usr/bin/env node
// cmdblockoutputcheck.mjs — #8303 (G17-CB4): CommandBlock.getComparatorOutput = successCount, and the
// commandBlockOutput game rule decides whether the command's feedback also reaches chat.
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

const rules = { commandBlockOutput: 'true', sendCommandFeedback: 'true' };
let succeed = true; const chat = [];
MCL.Chat = { add: (c) => chat.push(c) };
MCL.Commands = { ruleGet: (k) => rules[k], run: () => succeed ? { ok: true, result: 1, lines: ['Did it'] } : { ok: false, lines: ['Nope'] } };
const put = (x, y, z, n) => W.setBlock(x, y, z, S.stateOf(n) | 0);
function run(ok1) {
  cells.fill(0); B.clearSchedule(); chat.length = 0; succeed = ok1;
  put(0, 0, 0, 'command_block');
  const e = MCL.BlockEntities.get(0, 0, 0) || MCL.BlockEntities.create(0, 0, 0, 'command_block');
  e.command = 'x'; put(1, 0, 0, 'redstone_block');
  for (let t = 0; t < 5; t++) B.tick();
  return MCL.Redstone.analogOutput(0, 0, 0, W.getBlock(0, 0, 0));
}
ok(run(true) === 1, 'comparator reads 1 next to a succeeding command block');
ok(run(false) === 0, 'comparator reads 0 next to a failing command block');
run(true); ok(chat.length === 1, 'commandBlockOutput true: feedback in chat');
rules.commandBlockOutput = 'false'; run(true); ok(chat.length === 0, 'commandBlockOutput false: no chat line');
rules.commandBlockOutput = 'true';

// anti-vacuity
const g = MCL.CmdBlock.comparator; MCL.CmdBlock.comparator = () => 0;
breaks++; ok(run(true) === 0, 'anti-vacuity: comparator hook removed reads 0'); MCL.CmdBlock.comparator = g; console.log('  ✓ anti-vacuity: comparator hook removed');
rules.commandBlockOutput = 'false'; MCL.Commands.ruleGet = () => 'true';
breaks++; ok(run(true) === 1 && chat.length === 1, 'anti-vacuity: rule ignored -> chat line appears'); console.log('  ✓ anti-vacuity: rule ignored');

console.log(`cmdblockoutputcheck: ${pass} checks passed, ${fails.length} failures, ${breaks} breaks caught`);
if (fails.length) { fails.forEach((f) => console.log('  FAIL: ' + f)); process.exit(1); }
