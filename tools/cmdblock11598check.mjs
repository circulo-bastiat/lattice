#!/usr/bin/env node
// cmdblock11598check.mjs — #11598: proves 07zzz_cmdblock.js (CommandBlockBlockEntity: updateConditionMet,
// successCount, executor) through the real entry points (World.setBlock -> Behave.changed -> Behave.tick),
// with SOURCE-level breaks (patched copies of the module) that must each be caught.
import { loadEngine } from './loadsrc.mjs';
const EXTRA = ['02f_tags.js', '02g_items.js', '07b_behaviour.js', '07c_blockentity.js', '07f_redstone.js', '07zzz_cmdblock.js'];
const F = '07zzz_cmdblock.js';
let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
function trial(patch) {
  const M = loadEngine({ extra: EXTRA, dom: false, ...(patch ? { patch } : {}) });
  const S = M.States, B = M.Behave, N = 32, MID = 16, cells = new Uint16Array(N * N * N);
  const idx = (x, y, z) => (((y + MID) * N + (z + MID)) * N + (x + MID));
  const W = { getBlock: (x, y, z) => cells[idx(x, y, z)], blockLightAt: () => 15,
    setBlock(x, y, z, id) { cells[idx(x, y, z)] = id; if (B.ready) B.changed(x, y, z); return true; } };
  M.World = W; B.init(W); M.BlockEntities.init(); B.clearSchedule(); M.Redstone.init();
  let ran = 0, res = 1; const sent = [];
  M.Commands = { ruleGet: () => 'true', run() { ran++; return { ok: res > 0, result: res, lines: ['hi'] }; } };
  M.Chat = { add: (s) => sent.push(s) };
  const tick = (n) => { for (let t = 0; t < n; t++) B.tick(); };
  const st = (name, facing, cond) => { for (let s = 1; s < 20344; s++) if (M.Reg.names[S.block[s]] === name && B.propName(s, 'conditional') === String(!!cond) && B.propName(s, 'facing') === facing) return s; return 0; };
  const mk = (x, y, z, s, cmd) => { W.setBlock(x, y, z, s); const e = M.BlockEntities.get(x, y, z) || M.BlockEntities.create(x, y, z, M.Reg.names[S.block[s]]); e.command = cmd; return e; };
  const o = {};
  const run = (kind, behindCount, cond) => {
    cells.fill(0); B.clearSchedule(); ran = 0; res = 1;
    const a = mk(0, 0, 0, st(kind, 'east', false), 'a'); a.successCount = behindCount;
    const b = mk(1, 0, 0, st(kind, 'east', cond), 'b');
    ran = 0; W.setBlock(1, 1, 0, S.stateOf('redstone_block') | 0); tick(5); return { ran, b };
  };
  o.condBehindOk = run('command_block', 1, true).ran === 1;
  o.condBehindFail = run('command_block', 0, true).ran === 0;
  o.uncondBehindFail = run('command_block', 0, false).ran === 1;
  { const r = run('command_block', 0, true); o.failResets = r.b.successCount === 0 && r.b.conditionMet === false; }
  { cells.fill(0); B.clearSchedule(); ran = 0; res = 1; sent.length = 0;     // executor: success count, chat, comparator
    const e = mk(0, 0, 0, st('command_block', 'east', false), 'x'); W.setBlock(0, 1, 0, S.stateOf('redstone_block') | 0); tick(5);
    o.success = e.successCount === 1; o.chat = sent.length === 1 && sent[0].indexOf('hi') >= 0; o.comparator = M.CmdBlock.comparator(0, 0, 0) === 1;
    res = 0; e.powered = false; W.setBlock(0, 1, 0, 0); tick(2); W.setBlock(0, 1, 0, S.stateOf('redstone_block') | 0); tick(5);
    o.failZero = e.successCount === 0; }
  o.noBe = M.CmdBlock.comparator(9, 9, 9) === 0;
  return o;
}
const A = trial(null);
for (const k of Object.keys(A)) ok(A[k], 'scenario ' + k + ' ' + JSON.stringify(A));
const BR = [
  ['alwaysmet', 'if (!conditional(st)) return true;', 'return true;', ['condBehindFail', 'failResets']],
  ['ignoreparent', 'e.conditionMet = !!pe && (pe.successCount | 0) > 0;', 'e.conditionMet = true;', ['condBehindFail']],
  ['parentcount', '(pe.successCount | 0) > 0', '!!pe', ['condBehindFail']],
  ['success', 'e.successCount = 1;', '', ['success', 'comparator', 'condBehindOk']],
  ['chat', "C.ruleGet('commandBlockOutput') !== 'false' && NS.Chat", 'false && NS.Chat', ['chat']],
  ['comparator', 'return e ? (e.successCount | 0) : 0;', 'return 0;', ['comparator']],
];
for (const [key, a, b, expect] of BR) {
  breaks++; let hit = false, X;
  try { X = trial((f, s) => { if (f === F && s.includes(a)) { hit = true; return s.replace(a, b); } return s; }); } catch (e) { X = {}; }
  if (!hit) { fails.push('no-op break: ' + key); continue; }
  const caught = expect.some((q) => !X[q]);
  ok(caught, 'anti-vacuity: break ' + key + ' ' + JSON.stringify(X));
  if (caught) console.log('  ✓ break caught: ' + key);
}
console.log(fails.length ? 'FAIL\n' + fails.join('\n') : `cmdblock11598check: ${pass} assertions, 0 failures, ${breaks} breaks caught`);
process.exit(fails.length ? 1 : 0);
