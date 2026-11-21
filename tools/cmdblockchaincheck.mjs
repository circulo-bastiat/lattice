#!/usr/bin/env node
// cmdblockchaincheck.mjs — #8302 (G17-CB3): CommandBlock.executeCommandChain.
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

let limit = '65536', order = [], failAt = -1;
MCL.Commands = { ruleGet: (r) => (r === 'maxCommandChainLength' ? limit : 'true'), run(cmd) {
  order.push(cmd); return { ok: order.length - 1 !== failAt, result: order.length - 1 !== failAt ? 1 : 0, lines: [] };
} };
const tick = (n) => { for (let t = 0; t < n; t++) B.tick(); };
function build(cond) {
  cells.fill(0); B.clearSchedule(); order = [];
  W.setBlock(0, 0, 0, S.withLocal('command_block', 6 + 1) | 0);
  MCL.BlockEntities.get(0, 0, 0).command = 'c0';
  for (let i = 1; i <= 5; i++) {
    W.setBlock(i, 0, 0, S.withLocal('chain_command_block', (cond ? 0 : 6) + 1) | 0);
    const e = MCL.BlockEntities.get(i, 0, 0) || MCL.BlockEntities.create(i, 0, 0, 'chain_command_block');
    e.command = 'c' + i; e.auto = true;
  }
  W.setBlock(0, 1, 0, S.stateOf('redstone_block') | 0);
  tick(6);
  return order.join(',');
}
const full = 'c0,c1,c2,c3,c4,c5';
ok(build(false) === full, 'chain of 5 runs all in order in one go: ' + order);
failAt = 2; ok(build(true) === 'c0,c1,c2', 'conditional chain stops after a failed link: ' + order); failAt = -1;
limit = '3'; ok(build(false) === 'c0,c1,c2,c3', 'limit 3 runs only 3 links: ' + order);
limit = '65536';
const lim = MCL.CmdBlock.chainLimit; MCL.CmdBlock.chainLimit = () => 65536; limit = '3';
const brk = build(false) === full; MCL.CmdBlock.chainLimit = lim;
breaks++; ok(brk, 'anti-vacuity: without the limit read all run'); console.log('  ✓ anti-vacuity: without the limit read all links run');
console.log(`cmdblockchaincheck: ${pass} checks passed, ${fails.length} failures, ${breaks} breaks caught`);
if (fails.length) { fails.forEach((f) => console.log('  FAIL: ' + f)); process.exit(1); }
