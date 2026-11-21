#!/usr/bin/env node
// piston11604check.mjs — #11604: proves 07g_piston.js's PistonBehavior (reactionOf/isPushable: NORMAL, DESTROY, BLOCK)
// and BlockEvent queue (addEvent dedupe, processEvents, deferred extend/retract) through lever -> check -> tick, with SOURCE breaks.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEngine } from './loadsrc.mjs';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const F = '07g_piston.js';
const EXTRA = ['02f_tags.js', '02g_items.js', '07b_behaviour.js', '07c_blockentity.js', '14b_physics.js', '14f_inventory.js', '07f_redstone.js', '07g_piston.js'];
const b64 = (f) => readFileSync(join(ROOT, 'assets', f)).toString('base64');
function trial(patch) {
  const M = loadEngine({ extra: EXTRA, dom: false, ...(patch ? { patch } : {}) });
  M.Items.init({ items: b64('items.bin'), itemsBytes: JSON.parse(readFileSync(join(ROOT, 'assets', 'items.meta.json'), 'utf8')).rawBytes });
  const cells = new Map(); const k = (x, y, z) => x + ',' + y + ',' + z;
  const w = { get: (x, y, z) => cells.get(k(x, y, z)) || 0, set: (x, y, z, s) => cells.set(k(x, y, z), s) };
  w.getBlock = w.get; w.setBlock = w.set;
  M.Behave.init(w); M.BlockEntities.init(); M.Redstone.init(); M.Piston.init();
  const S = M.States, B = M.Behave, Rs = M.Redstone, P = M.Piston, BE = M.BlockEntities;
  const placed = [];
  const put = (x, y, z, n, props) => { let st = S.stateOf(n); for (const p of Object.keys(props || {})) st = B.setProp(st, p, props[p]); w.set(x, y, z, st); placed.push(x, y, z); };
  const name = (x, y, z) => { const s = w.get(x, y, z); return s === 0 ? 'air' : M.Reg.names[S.block[s]]; };
  const ticks = (n) => { const real = B.scheduledTick; B.scheduledTick = (x, y, z) => { if (!Rs.torchTick(x, y, z)) Rs.diodeTick(x, y, z); }; for (let t = 0; t < n; t++) { B.tick(); BE.tick(); } B.scheduledTick = real; };
  const rig = (ahead) => {
    cells.clear(); placed.length = 0;
    for (let i = -2; i < 8; i++) put(i, -1, 0, 'stone');
    put(0, 0, 0, 'piston', { facing: 'east' }); put(1, 0, 0, 'stone');
    if (ahead) put(2, 0, 0, ahead);
    put(-1, 0, 0, 'lever', { face: 'floor', facing: 'north' });
    for (let i = 0; i < placed.length; i += 3) Rs.update(placed[i], placed[i + 1], placed[i + 2]);
    Rs.setPowered(-1, 0, 0, true);
  };
  const o = {};
  // PistonBehavior
  o.reactNormal = P.reactionOf(S.stateOf('stone')) === P.NORMAL;
  o.reactDestroy = P.reactionOf(S.stateOf('torch')) === P.DESTROY;
  o.reactBlock = P.reactionOf(S.stateOf('anvil')) === P.BLOCK;
  o.reactAir = P.reactionOf(0) === P.NORMAL;
  o.pushStone = P.isPushable(S.stateOf('stone'), 5, 0, 0, 5, false, 5) === true;
  o.noPushObs = P.isPushable(S.stateOf('anvil'), 5, 0, 0, 5, false, 5) === false;
  o.torchNeedsDestroy = P.isPushable(S.stateOf('torch'), 5, 0, 0, 5, false, 5) === false && P.isPushable(S.stateOf('torch'), 5, 0, 0, 5, true, 5) === true;
  o.noBedrock = P.isPushable(S.stateOf('bedrock'), 5, 0, 0, 5, false, 5) === false;
  // BlockEvent
  rig();
  o.queued = P.pendingEvents() === 1 && name(1, 0, 0) === 'stone' && B.propName(w.get(0, 0, 0), 'extended') === 'false';
  P.check(0, 0, 0); P.check(0, 0, 0);
  o.deduped = P.pendingEvents() === 1;
  ticks(1);
  o.drained = P.pendingEvents() === 0;
  o.extended = B.propName(w.get(0, 0, 0), 'extended') === 'true' && name(1, 0, 0) === 'moving_piston';
  ticks(3);
  o.landed = name(1, 0, 0) === 'piston_head' && name(2, 0, 0) === 'stone';
  Rs.setPowered(-1, 0, 0, false);
  o.retractQueued = P.pendingEvents() === 1 && name(1, 0, 0) === 'piston_head';
  ticks(4);
  o.retracted = B.propName(w.get(0, 0, 0), 'extended') === 'false' && name(1, 0, 0) === 'air';
  rig('obsidian'); ticks(3);
  o.obsStops = name(1, 0, 0) === 'stone' && name(2, 0, 0) === 'obsidian' && B.propName(w.get(0, 0, 0), 'extended') === 'false';
  rig('torch'); ticks(3);
  o.torchBroken = name(1, 0, 0) === 'piston_head' && name(2, 0, 0) === 'stone';
  // a queued event for a piston that is gone does nothing (processBlockEvent re-checks the block)
  rig(); w.set(0, 0, 0, 0); ticks(2);
  o.goneNoop = name(1, 0, 0) === 'stone' && P.pendingEvents() === 0;
  return o;
}
const A = trial(null);
for (const key of Object.keys(A)) ok(A[key], 'scenario ' + key + ' ' + JSON.stringify(A));
const BR = [
  ['dedupe', 'if (eventKeys[k]) return;', '', ['deduped']],
  ['noQueue', 'addEvent(x, y, z, P.TRIGGER_EXTEND, facing);\n      return true;', 'return true;', ['queued', 'extended']],
  ['reDrain', 'delete eventKeys[e[5]];', '', ['retractQueued', 'retracted', 'drained', 'torchBroken']],
  ['inline', "if (!P.isPiston(st)) return false;\n    var facing = facingDir(st);\n    if (facing < 0) return false;\n    var powered = P.neighborSignal(x, y, z, facing);\n    if (powered && type !==", "var facing = facingDir(st);\n    var powered = P.neighborSignal(x, y, z, facing);\n    if (powered && type !==", ['goneNoop']],
  ['destroyRule', 'if (re === P.DESTROY) return !!allowDestroy;', 'if (re === P.DESTROY) return true;', ['torchNeedsDestroy']],
  ['blockRule', 'if (re === P.BLOCK) return false;', '', ['noPushObs']],
  ['noReaction', 'return pushReaction ? (pushReaction[S.block[state]] | 0) : P.NORMAL;', 'return P.NORMAL;', ['reactDestroy', 'reactBlock']],
  ['bedrock', 'if (!isFinite(h)) return false;', '', ['noBedrock']],
  ['constDestroy', 'P.DESTROY = 1; P.BLOCK = 2;', 'P.DESTROY = 2; P.BLOCK = 1;', ['reactDestroy', 'reactBlock']],
];
for (const [key, a, b, expect] of BR) {
  breaks++; let hit = false, X;
  try { X = trial((f, s) => { if (f === F && s.includes(a)) { hit = true; return s.replace(a, b); } return s; }); } catch (e) { X = {}; }
  if (!hit) { fails.push('no-op break: ' + key); continue; }
  const caught = expect.some((q) => !X[q]);
  ok(caught, 'anti-vacuity: break ' + key + ' ' + JSON.stringify(X));
  if (caught) console.log('  ✓ break caught: ' + key);
}
console.log(fails.length ? 'FAIL\n' + fails.join('\n') : `piston11604check: ${pass} assertions, 0 failures, ${breaks} breaks caught`);
process.exit(fails.length ? 1 : 0);
