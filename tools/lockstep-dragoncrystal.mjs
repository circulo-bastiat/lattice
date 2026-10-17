#!/usr/bin/env node
// lockstep-dragoncrystal -- #7081: end crystal heals the ender dragon, engine side x 20 salts. Per tick: health, nearestCrystal
// (index of connectedCrystal, -1 none), beam target (its x,y,z), after a scripted hit destroys the crystal the 10 head damage.
// Two crystals: one 20 blocks away (in the 32 box), one 60 away (out). compareTraces, exact doubles. Server comparison is the pilot's job.
import { loadEngine } from './loadsrc.mjs';
import { compareTraces } from './referee/lockstep/trace.mjs';

let bad = 0, breaks = 0;
const ok = (c, m) => { if (!c) { bad++; console.log('FAIL ' + m); } };
const caught = (c, m) => { if (c) breaks++; else { bad++; console.log('NOT CAUGHT ' + m); } };
const M = loadEngine({ extra: ['07_world.js', '07h_entities.js', '07zzl_enderdragon.js'] });
const ED = M.EnderDragon;
const T = 200, HIT = 120;
const proto = ED.EnderDragonEntity.prototype;
const origTick = proto.tickWithEndCrystals, origDest = proto.crystalDestroyed;

function lcg(seed) { // deterministic per-salt stream
  let s = (seed * 2654435761 + 12345) >>> 0;
  const n = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s; };
  return { nextInt: (b) => n() % b, nextFloat: () => n() / 4294967296 };
}
function trace(salt) {
  const d = new ED.EnderDragonEntity({ x: 0, y: 100, z: 0, random: lcg(salt) });
  const near = { type: 'end_crystal', x: 20, y: 100, z: 0, removed: false };
  const far = { type: 'end_crystal', x: 60, y: 100, z: 0, removed: false };
  const cs = [near, far];
  d.crystalsFn = () => cs;
  d.health = 100;
  d.phaseManager.setPhase(ED.PHASE_TYPES.byName.HoldingPattern);
  const R = [];
  for (let t = 0; t < T; t++) {
    d.age = t + 1;
    let dmg = 0;
    if (t === HIT) { const h = d.health; near.removed = false; d.crystalDestroyed(near, near, { explosive: true }); near.removed = true; dmg = h - d.health; }
    else d.tickWithEndCrystals();
    const c = d.connectedCrystal;
    R.push({ tick: t, health: d.health, nearestCrystal: c ? cs.indexOf(c) : -1, beam: c ? [c.x, c.y, c.z] : null, crystalDamage: dmg });
  }
  return R;
}
const F = ['health', 'nearestCrystal', 'beam', 'crystalDamage'];
const SALTS = Array.from({ length: 20 }, (_, i) => i);
const traces = SALTS.map(trace);
traces.forEach((R, i) => {
  ok(R.length === T, `salt ${i}: rows`);
  ok(R.every((r) => r.nearestCrystal !== 1), `salt ${i}: far crystal connected`);
  ok(R.some((r) => r.nearestCrystal === 0), `salt ${i}: near crystal never connected`);
  ok(R[HIT].crystalDamage > 0, `salt ${i}: destroyed crystal did no damage`);
  ok(R[HIT - 1].health > 100, `salt ${i}: no healing`);
});
ok(compareTraces(traces[3], trace(3), { fields: F }) === null, 'same salt, same trace');
const diverges = (patch) => {
  patch();
  try { return SALTS.some((s) => compareTraces(traces[s], trace(s), { fields: F }) !== null); }
  finally { proto.tickWithEndCrystals = origTick; proto.crystalDestroyed = origDest; }
};
caught(diverges(() => { // heal interval 10 -> 20
  proto.tickWithEndCrystals = function () { const a = this.age; this.age = (a % 20 === 0) ? a : a + 1; origTick.call(this); this.age = a; if (a % 10 === 0 && a % 20 !== 0 && this.connectedCrystal) this.health -= 1; };
}), 'heal interval 20');
caught(diverges(() => { // crystal damage 10 -> 5
  proto.crystalDestroyed = function (c, p, s) { const h = this.health; origDest.call(this, c, p, s); this.health = h - (h - this.health) / 2; };
}), 'crystal damage 5');
console.log(`${SALTS.length * 5 + 1} assertions, ${bad} failures, ${breaks} breaks caught (${SALTS.length} salts x ${T} ticks)`);
process.exit(bad ? 1 : 0);
