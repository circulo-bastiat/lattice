#!/usr/bin/env node
// dripleaf11602check.mjs — #11602: proves 07zv_dripleaf.js's Tilt machinery (NONE/UNSTABLE/PARTIAL/FULL, delays 10/10/100)
// through the entry points onEntityCollision / scheduledTick / onProjectileHit / neighborUpdate, with SOURCE breaks.
import { loadEngine } from './loadsrc.mjs';
let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const F = '07zv_dripleaf.js';
function trial(patch) {
  const M = loadEngine({ extra: ['07zv_dripleaf.js'], dom: false, ...(patch ? { patch } : {}) });
  const S = M.States, R = M.Reg, Dl = M.Dripleaf, o = {};
  const cells = new Map(); const k = (x, y, z) => x + ',' + y + ',' + z;
  M.World = { getBlock: (x, y, z) => cells.get(k(x, y, z)) || 0, setBlock: (x, y, z, s) => cells.set(k(x, y, z), s) };
  const sched = [], sounds = []; let power = 0;
  M.Behave = { schedule: (x, y, z, d) => sched.push(d) };
  M.Sound = { play: (n) => sounds.push(n) };
  M.Redstone = { receivedPower: () => power };
  let leaf = 0; for (let i = 0; i < 20344; i++) if (S.name(i) === 'big_dripleaf') { leaf = i; break; }
  const put = (t) => cells.set(k(0, 0, 0), S.withProp(leaf, R.PROP.tilt, R.PVAL[t]));
  const rd = () => Dl.tilt(0, 0, 0);
  put('none');
  o.startNone = rd() === 'none';
  o.offGround = Dl.onEntityCollision(0, 0, 0, { onGround: false, y: 2 }) === false && rd() === 'none';
  o.tooLow = Dl.onEntityCollision(0, 0, 0, { onGround: true, y: 0.5 }) === false && rd() === 'none';
  power = 1; o.powered = Dl.onEntityCollision(0, 0, 0, { onGround: true, y: 2 }) === false && rd() === 'none'; power = 0;
  sched.length = 0; sounds.length = 0;
  o.collide = Dl.onEntityCollision(0, 0, 0, { onGround: true, y: 2 }) === true && rd() === 'unstable' && sched[0] === 10 && sounds.length === 0;
  o.noRetrigger = Dl.onEntityCollision(0, 0, 0, { onGround: true, y: 2 }) === false;
  sched.length = 0;
  Dl.scheduledTick(0, 0, 0); o.toPartial = rd() === 'partial' && sched[0] === 10 && sounds[0] === Dl.TILT_DOWN;
  sched.length = 0;
  Dl.scheduledTick(0, 0, 0); o.toFull = rd() === 'full' && sched[0] === 100;
  sounds.length = 0;
  Dl.scheduledTick(0, 0, 0); o.reset = rd() === 'none' && sounds[0] === Dl.TILT_UP;
  sounds.length = 0; Dl.resetTilt(0, 0, 0); o.noUpFromNone = sounds.length === 0;
  put('none'); sched.length = 0; sounds.length = 0;
  Dl.onProjectileHit(0, 0, 0); o.proj = rd() === 'full' && sched[0] === 100 && sounds[0] === Dl.TILT_DOWN;
  put('partial'); power = 1; Dl.scheduledTick(0, 0, 0); o.tickPowered = rd() === 'none'; 
  put('unstable'); Dl.neighborUpdate(0, 0, 0); o.neighborReset = rd() === 'none';
  power = 0; put('unstable'); o.neighborNoPower = Dl.neighborUpdate(0, 0, 0) === false && rd() === 'unstable';
  cells.set(k(0, 0, 0), S.stateOf('stone')); o.notLeaf = Dl.scheduledTick(0, 0, 0) === false && Dl.tilt(0, 0, 0) === null;
  return o;
}
const A = trial(null);
for (const k of Object.keys(A)) ok(A[k], 'scenario ' + k + ' ' + JSON.stringify(A));
const BR = [
  ['delayU', 'unstable: 10, partial: 10', 'unstable: 1, partial: 10', ['collide']],
  ['delayF', 'full: 100', 'full: 10', ['toFull', 'proj']],
  ['ground', 'e && e.onGround && e.y >', 'e && e.y >', ['offGround']],
  ['height', 'Math.fround(y + Dl.ABOVE)', 'Math.fround(y - 5)', ['tooLow']],
  ['partialStep', "else if (t === 'partial') Dl.changeTilt(x, y, z, 'full'", "else if (t === 'partial') Dl.changeTilt(x, y, z, 'partial'", ['toFull']],
  ['upsound', "if (was !== 'none') sound", 'if (true) sound', ['noUpFromNone']],
  ['powerTick', 'if (Dl.powered(x, y, z)) return Dl.resetTilt(x, y, z);', '', ['tickPowered']],
  ['projFull', "Dl.changeTilt(x, y, z, 'full', Dl.TILT_DOWN); };", "Dl.changeTilt(x, y, z, 'partial', Dl.TILT_DOWN); };", ['proj']],
];
for (const [key, a, b, expect] of BR) {
  breaks++; let hit = false, X;
  try { X = trial((f, s) => { if (f === F && s.includes(a)) { hit = true; return s.replace(a, b); } return s; }); } catch (e) { X = {}; }
  if (!hit) { fails.push('no-op break: ' + key); continue; }
  const caught = expect.some((q) => !X[q]);
  ok(caught, 'anti-vacuity: break ' + key + ' ' + JSON.stringify(X));
  if (caught) console.log('  ✓ break caught: ' + key);
}
console.log(fails.length ? 'FAIL\n' + fails.join('\n') : `dripleaf11602check: ${pass} assertions, 0 failures, ${breaks} breaks caught`);
process.exit(fails.length ? 1 : 0);
