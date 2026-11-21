#!/usr/bin/env node
// lockstep-strayfreeze -- #8640 (G18b-L31): a skeleton standing in powder snow for 400 ticks, 20 salts, plus a lane that steps out at tick 100.
// Per tick: inPowderSnowTime / strayConversionTime; the stray at the end (equipment, drop chances, health, name). Vanilla SkeletonEntity.tick:
// inPowderSnowTime >= 140 -> setConversionTime(300) -> convertToStray. Expected: conversion starts at tick 141, stray at 141+300+1 (past 400 is
// not reached: 140 + 300 > 400, so the 400-tick lane ends mid-countdown; the stray appears in the 460-tick run).
import { harness, buildLane } from './referee/lockstep/zombielane.mjs';
import { compareTraces } from './referee/lockstep/trace.mjs';

const { M, w, cells } = harness();
const EL = M.EntityList, P = M.Player, U = M.Undead;
let bad = 0, breaks = 0;
const ok = (c, m) => { if (!c) { bad++; console.log('FAIL ' + m); } };
const caught = (c, m) => { if (c) breaks++; else { bad++; console.log('NOT CAUGHT ' + m); } };
const stream = (s) => { let a = (s + 1) * 2654435761 >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; };
const POW = 140;

function run(salt, { ticks = 400, outAt = -1, threshold = POW } = {}) {
  const r = stream(salt); EL.random = r; Math.random = r;
  buildLane({ w, cells, M });
  const snow = M.States.stateOf('powder_snow');
  for (let y = 0; y <= 1; y++) w.set(5, y, 0, snow);
  EL.list.length = 0; EL.nextId = 1; EL.spawnCounter = 0; EL.ticks = 0;
  P.x = 20.5; P.y = 0; P.z = 0.5; P.dead = false;
  let e = EL.spawn('skeleton', 5.5, 0, 0.5);
  e.persistent = true; e.customName = 'Rattles'; e.canPickUpLoot = true;
  const Eq = M.Equip; Eq.setEquipped(e, 0, Eq.stackOf('bow')); Eq.setEquipped(e, 5, Eq.stackOf('iron_helmet')); Eq.setDropChance(e, 0, 1); Eq.setDropChance(e, 5, 0.33);
  const rows = []; let stray = null, spawnHealth;
  for (let t = 0; t < ticks; t++) {
    rows.push({ tick: t, inSnow: e.inPowderSnowTime ?? 0, conv: e.strayConversionTime ?? -1, type: e.type });
    if (t === outAt) { w.set(5, 0, 0, 0); w.set(5, 1, 0, 0); }
    if (t === 0) e.aiDisabled = false;
    e.x = 5.5; e.z = 0.5; e.vx = e.vz = 0; P.x = 20.5; P.health = 20; P.dead = false;
    EL.tick();
    if (e.removed || e.dead) { stray = EL.list.find((x) => x.type === 'stray'); spawnHealth = stray && stray.health; rows.push({ tick: t + 1, inSnow: 0, conv: -1, type: stray ? 'stray' : 'gone' }); break; }
  }
  return { rows, e, spawnHealth, stray: stray || EL.list.find((x) => x.type === 'stray') };
}
const F = ['inSnow', 'conv', 'type'];
const first = run(0, { ticks: 460 });
const conv0 = first.rows.findIndex((r) => r.conv > -1), strayAt = first.rows.findIndex((r) => r.type === 'stray');
for (let s = 0; s < 20; s++) {
  const a = run(s, { ticks: 460 }), b = run(s, { ticks: 460 });
  ok(compareTraces(a.rows, b.rows, { fields: F }) === null, `salt ${s}: repeatable`);
  const c = a.rows.findIndex((r) => r.conv > -1), z = a.rows.findIndex((r) => r.type === 'stray');
  ok(c === POW + 2 || c === POW + 1, `salt ${s}: conversion countdown starts at row ${c}`);
  ok(z === c + 301 || z === c + 300, `salt ${s}: stray at row ${z} (countdown start ${c})`);
  ok(a.stray && a.stray.customName === 'Rattles' && a.spawnHealth > 0 && a.spawnHealth <= a.stray.maxHealth, `salt ${s}: stray name/health`);
  ok(a.stray && a.stray.equip && a.stray.equip[0] && a.stray.equip[0].i === first.e.equip[0].i && a.stray.equip[5] && a.stray.equip[5].i === first.e.equip[5].i && a.stray.equip[0] !== first.e.equip[0], `salt ${s}: stray keeps equipment`);
  ok(a.stray && a.stray.equipDropChance && a.stray.equipDropChance[0] === 1 && a.stray.equipDropChance[5] === 0.33, `salt ${s}: drop chances carried`);
  const o = run(s, { ticks: 400, outAt: 100 });
  ok(o.rows.every((r) => r.conv === -1 && r.type === 'skeleton'), `salt ${s}: stepping out at tick 100 never converts`);
  ok(o.rows[399].inSnow === -1, `salt ${s}: timer reset after stepping out (${o.rows[399].inSnow})`);
}
const base = first.rows;
const mut = (f, fn) => base.map((r, t) => (t === 200 ? { ...r, [f]: fn(r[f]) } : r));
caught(compareTraces(base, mut('inSnow', (v) => v + 1), { fields: F })?.field === 'inSnow', 'inSnow +1');
caught(compareTraces(base, mut('conv', (v) => v + 1), { fields: F })?.field === 'conv', 'conv +1');
const cur = U.POWDER_SNOW_TICKS; U.POWDER_SNOW_TICKS = 100;
const alt = run(0, { ticks: 460 }); U.POWDER_SNOW_TICKS = cur;
caught(compareTraces(base, alt.rows, { fields: F }) !== null, '140 changed to 100');
caught(compareTraces(base, base.slice(1), { fields: F }) !== null, 'row shift');
console.log(`${20 * 8 + 4} assertions, ${bad} failures, ${breaks} breaks caught (20 salts x 460 ticks; countdown row ${first.rows.findIndex((r) => r.conv > -1)}, stray row ${strayAt})`);
process.exit(bad ? 1 : 0);
