#!/usr/bin/env node
// poi11600check.mjs — #11600: proves 07zu_poi.js (BedPart head/foot filter; SerializingRegionBasedStorage-shaped
// POI store: add/remove via World.setBlock -> Poi.onChange, chunk rescan, tickets, in-circle search) with SOURCE breaks.
import { loadEngine } from './loadsrc.mjs';
const EXTRA = ['02f_tags.js', '07_world.js', '07zu_poi.js'];
const F = '07zu_poi.js';
let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
function trial(patch) {
  const M = loadEngine({ extra: EXTRA, ...(patch ? { patch } : {}) });
  const Poi = M.Poi, W = M.World, R = M.Reg, SR = M.States, CH = M.CH;
  W.init(1);
  for (let cx = -1; cx <= 1; cx++) for (let cz = -1; cz <= 1; cz++) { const c = W.makeChunk(cx, cz); c.state = CH.GENERATED; W.chunks.set(W.key(cx, cz), c); }
  Poi.init();
  const part = (name, p) => { const b = R.id[name], out = []; for (let s = R.realFirst[b]; s < R.realFirst[b + 1]; s++) if (SR.propValue(s, R.PROP.part) === R.PVAL[p]) out.push(s); return out[0]; };
  const head = part('red_bed', 'head'), foot = part('red_bed', 'foot');
  const bell = R.realFirst[R.id.bell] + R.defaultState[R.id.bell];
  const o = {};
  W.setBlock(0, 63, 0, SR.stateOf('stone')); W.setBlock(10, 63, 10, SR.stateOf('stone')); W.setBlock(3, 63, 3, SR.stateOf('stone'));
  W.setBlock(0, 64, 0, head); W.setBlock(10, 64, 10, bell); W.setBlock(3, 64, 3, foot);
  Poi.rescanNow();
  o.headHome = Poi.getType({ x: 0, y: 64, z: 0 }) === Poi.HOME;
  o.footNot = Poi.getType({ x: 3, y: 64, z: 3 }) === null;
  o.bell = Poi.getType({ x: 10, y: 64, z: 10 }) === Poi.MEETING;
  o.count = Poi.count() === 2;
  W.setBlock(0, 64, 0, 0);
  o.liveRemove = Poi.getType({ x: 0, y: 64, z: 0 }) === null && Poi.count() === 1;
  W.setBlock(0, 64, 0, head);
  o.liveAdd = Poi.getType({ x: 0, y: 64, z: 0 }) === Poi.HOME;
  o.tickets = Poi.reserveTicket({ x: 0, y: 64, z: 0 }) === true && Poi.reserveTicket({ x: 0, y: 64, z: 0 }) === false
    && Poi.isOccupied({ x: 0, y: 64, z: 0 }) && !Poi.hasSpace({ x: 0, y: 64, z: 0 }) && Poi.releaseTicket({ x: 0, y: 64, z: 0 }) && Poi.hasSpace({ x: 0, y: 64, z: 0 });
  const near = Poi.getInCircle(null, { x: 0, y: 64, z: 0 }, 5, Poi.STATUS.ANY);
  o.circle = near.length === 1 && Poi.getInCircle(null, { x: 0, y: 64, z: 0 }, 20, Poi.STATUS.ANY).length === 2;
  o.statusFilter = Poi.getInCircle(null, { x: 0, y: 64, z: 0 }, 20, Poi.STATUS.OCCUPIED).length === 0;
  Poi.reserveTicket({ x: 10, y: 64, z: 10 });
  o.occupied = Poi.occupiedPositions().length === 1 && Poi.getInCircle(null, { x: 0, y: 64, z: 0 }, 20, Poi.STATUS.OCCUPIED).length === 1;
  o.getPosition = Poi.getPosition((t) => t === Poi.MEETING, null, Poi.STATUS.ANY, { x: 0, y: 64, z: 0 }, 20, () => 0.5) !== null
    && Poi.getPosition((t) => t === Poi.MEETING, null, Poi.STATUS.ANY, { x: 0, y: 64, z: 0 }, 5, () => 0.5) === null;
  W.setBlock(0, 64, 0, 0); W.setBlock(0, 64, 0, head);   // type survives -> ticket kept check
  Poi.reserveTicket({ x: 0, y: 64, z: 0 }); Poi.live = false; W.setBlock(10, 64, 10, 0); Poi.live = true;
  o.staleUntilRescan = Poi.getType({ x: 10, y: 64, z: 10 }) === Poi.MEETING;
  Poi.rescanNow();
  o.rescanDrops = Poi.getType({ x: 10, y: 64, z: 10 }) === null;
  return o;
}
const A = trial(null);
for (const k of Object.keys(A)) ok(A[k], 'scenario ' + k + ' ' + JSON.stringify(A));
const BR = [
  ['headfilter', 'if (SR.propValue(s, P_.part) === V.head) homeStates[s] = true;', 'homeStates[s] = true;', ['footNot']],
  ['nobell', 'meetingStates[s2] = true;', '', ['bell']],
  ['noonchange', 'if (!Poi.live || !Poi.ready || !store) return;', 'return;', ['liveRemove', 'liveAdd']],
  ['ticketcap', 'if (!e || e.ticket >= ticketCountFor(e.type)) return false;', 'if (!e) return false;', ['tickets']],
  ['radius', 'if (dx * dx + dy * dy + dz * dz > r2) continue;', '', ['circle', 'getPosition']],
  ['status', 'if (!statusMatches(status, e)) continue;', '', ['statusFilter', 'occupied']],
  ['rescandrop', 'if (Object.prototype.hasOwnProperty.call(store, key) && !seen[key]) delete store[key];', '', ['rescanDrops']],
];
for (const [key, a, b, expect] of BR) {
  breaks++; let hit = false, X;
  try { X = trial((f, s) => { if (f === F && s.includes(a)) { hit = true; return s.replace(a, b); } return s; }); } catch (e) { X = {}; }
  if (!hit) { fails.push('no-op break: ' + key); continue; }
  const caught = expect.some((q) => !X[q]);
  ok(caught, 'anti-vacuity: break ' + key + ' ' + JSON.stringify(X));
  if (caught) console.log('  ✓ break caught: ' + key);
}
console.log(fails.length ? 'FAIL\n' + fails.join('\n') : `poi11600check: ${pass} assertions, 0 failures, ${breaks} breaks caught`);
process.exit(fails.length ? 1 : 0);
