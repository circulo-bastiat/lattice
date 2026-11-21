#!/usr/bin/env node
// hand11645check.mjs — #11645: proves 14i_hand.js (HeldItemRenderer: tickEquip main/offhand equip progress,
// resetEquipProgress, swing guard), reached from 14_player.js's tick; source breaks caught.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';
let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const near = (a, b) => Math.abs(a - b) < 1e-9;
function trial(patch) {
  const MCL = loadEngine({ extra: ['14i_hand.js'], dom: false, patch: patch ? (f, s) => (f === '14i_hand.js' ? patch(s) : s) : undefined });
  const H = MCL.Hand, o = {};
  // stubs: items are {i,n}; empty = null
  MCL.Inventory = { OFFHAND: 40, isEmpty: (s) => !s || !s.n, getItem: (inv) => inv.off, isSameItemSameTags: (a, b) => a.i === b.i };
  MCL.Effects = null;
  const sword = { i: 5, n: 1 }, apple = { i: 9, n: 1 };
  const P = { inventory: { off: null }, held: sword, heldItem() { return this.held; } };
  H.reset();
  // fresh: drawn item -1 vs held 5 -> sinks 0.4/tick, swaps below 0.1, then climbs
  H.attackStrengthTicker = 100;
  const hs = [];
  if (process.env.DBG) globalThis.__H = H;
  for (let t = 0; t < 12; t++) { H.tickEquip(P); hs.push(H.mainHandHeight); }
  o.sink = near(hs[0], 0.6) && near(hs[1], 0.2) && near(hs[2], 0);
  o.swap = H.mainHandItem === 5;
  o.rise = near(hs[3], 0.4) && near(hs[4], 0.8) && near(hs[5], 1) ;
  H.attackStrengthTicker = 0;
  H.tickEquip(P);
  o.cube = near(H.mainHandHeight, 0.6);   // cooldown^3 target right after a swing
  // paddling sinks both hands
  H.reset(); P.paddling = true; H.tickEquip(P);
  o.paddle = near(H.mainHandHeight, 0.6) && near(H.offHandHeight, 0.6);
  P.paddling = false;
  // offhand swap
  H.reset(); P.inventory.off = apple;
  for (let t = 0; t < 10; t++) H.tickEquip(P);
  o.offswap = H.offHandItem === 9 && near(H.offHandHeight, 1);
  H.reset(); H.resetEquipProgress(1); o.resetOff = H.offHandHeight === 0 && H.mainHandHeight === 1;
  H.resetEquipProgress(0); o.resetMain = H.mainHandHeight === 0;
  // swing guard
  H.reset();
  o.sw1 = H.swing(null, 0) === true && H.swingTime === -1;
  H.tickSwing(null); o.sw2 = H.swing(null, 0) === false;
  H.tickSwing(null); H.tickSwing(null); H.tickSwing(null); o.sw3 = H.swing(null, 0) === true;
  return o;
}
const A0 = trial(null);
for (const k of Object.keys(A0)) ok(A0[k], 'scenario ' + k);
const p = readFileSync(join(MCLITE_ROOT, 'src', '14_player.js'), 'utf8');
ok(/NS\.Hand\.tickEquip\(P\)/.test(p) && /NS\.Hand\.tickSwing\(P\)/.test(p) && /NS\.Hand\.noteSelected\(P\)/.test(p), 'reach: 14_player ticks Hand');
const BR = [
  ['step', 'H.EQUIP_STEP = 0.4', 'H.EQUIP_STEP = 0.2', ['sink', 'rise']],
  ['swapbelow', 'H.mainHandHeight < H.EQUIP_SWAP_BELOW', 'H.mainHandHeight < -1', ['swap']],
  ['cube', 'f * f * f', '1', ['cube']],
  ['paddle', 'H.mainHandHeight = clamp(H.mainHandHeight - H.EQUIP_STEP, 0, 1)', 'H.mainHandHeight = 1', ['paddle']],
  ['offswap', 'H.offHandItem = H.indexOfStack(off)', 'H.offHandItem = -1', ['offswap']],
  ['resetoff', 'if (hand === 1) H.offHandHeight = 0', 'if (hand === 1) H.mainHandHeight = 0', ['resetOff']],
  ['guard', 'H.swingTime >= (d / 2 | 0) ||', 'true ||', ['sw2']],
  ['minus1', 'H.swingTime = -1;\n      H.swinging = true', 'H.swingTime = 0;\n      H.swinging = true', ['sw1']],
];
for (const [key, a, b, expect] of BR) {
  breaks++; let hit = false, X;
  try { X = trial((s) => { if (s.includes(a)) { hit = true; return s.split(a).join(b); } return s; }); } catch (e) { X = {}; }
  if (!hit) { fails.push('no-op break: ' + key); continue; }
  const caught = expect.some((q) => !X[q]);
  ok(caught, 'anti-vacuity: break ' + key);
  if (caught) console.log('  ✓ break caught: ' + key);
}
console.log(`hand11645check: ${pass} assertions, ${fails.length} failures, ${breaks} breaks caught`);
for (const f of fails) console.log('  FAIL ' + f);
process.exit(fails.length ? 1 : 0);
