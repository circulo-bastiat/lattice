#!/usr/bin/env node
// parrotimitatecheck.mjs - #8756: ParrotEntity.MOB_SOUNDS -> chosen imitation sound id equals vanilla for every key, 20 salts.
// Vanilla map is parsed from .decomp (ParrotEntity, EntityType, SoundEvents). ANTI-VACUITY: a map with one wrong entry must fail.
import fs from 'node:fs';
import { loadEngine, initRegistry } from './loadsrc.mjs';
const D = '.decomp/net/minecraft/';
const rd = (p) => fs.readFileSync(D + p, 'utf8');
const par = rd('entity/passive/ParrotEntity.java'), et = rd('entity/EntityType.java'), se = rd('sound/SoundEvents.java');
const etName = {}, seName = {};
for (const m of et.matchAll(/(field_\d+) = register\(\s*"([a-z_]+)"/g)) etName[m[1]] = m[2];
for (const m of se.matchAll(/(field_\d+) = register\("([a-z_.0-9]+)"\)/g)) seName[m[1]] = m[2];
const vanilla = {};
for (const m of par.matchAll(/\$\$0\.put\(EntityType\.(field_\d+), SoundEvents\.(field_\d+)\)/g)) vanilla[etName[m[1]]] = seName[m[2]];

function scenario(brk) {
  const M = loadEngine({ extra: ['02f_tags.js', '07l_spawn.js', '07zzp_mobvoice.js'], dom: false });
  initRegistry(M);
  const MV = M.MobVoice, out = [];
  if (brk === 'wrong') MV.PARROT_IMITATE.zombie = 0, MV.PARROT_IMITATE.creeper = 1, delete MV.PARROT_IMITATE.husk;
  const plays = [];
  M.Sound = { play: (ev, o) => { plays.push({ ev, vol: o.volume, pitch: o.pitch }); return true; } };
  M.Physics = { blockAt: () => 0 };
  const keys = Object.keys(vanilla);
  if (keys.length !== 33) out.push('decomp parse gave ' + keys.length + ' entries, want 33');
  const real = Math.random;
  try {
    for (let salt = 1; salt <= 20; salt++) {
      for (const k of keys) {
        let s = salt * 7919 + 13; const r = () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648;
        M.EntityList = { list: [{ type: k, x: 5, y: 64, z: 0 }] };
        Math.random = () => 0;   // nextInt(2)==0, only candidate
        plays.length = 0;
        const p = { type: 'parrot', x: 0, y: 64, z: 0, health: 6 };
        MV.parrotImitate(p);
        if (plays.length !== 1 || plays[0].ev !== vanilla[k] || plays[0].vol !== 0.7) out.push(`${k}: got ${JSON.stringify(plays)} want ${vanilla[k]} @0.7`);
        r();
      }
      // getRandomSound picks only from the 33 keys, every result a vanilla value
      Math.random = (() => { let s = salt; const q = [0, 0]; return () => (q.length ? q.shift() : (s = (s * 16807) % 2147483647) / 2147483647); })();
      const got = MV.parrotRandomSound();
      if (!Object.values(vanilla).includes(got)) out.push('random sound not in vanilla map: ' + got);
    }
  } finally { Math.random = real; }
  return [...new Set(out)];
}
const fails = scenario(null);
let caught = 0;
const BR = ['wrong'];
for (const b of BR) { if (scenario(b).length) { caught++; console.log('  ✓ break caught: ' + b); } else fails.push('break NOT caught: ' + b); }
for (const f of fails) console.log('  ✗ ' + f);
console.log(`parrotimitatecheck: ${fails.length ? 'FAIL' : 'PASS'}`);
console.log(`parrotimitatecheck: ${caught} breaks caught (of ${BR.length})`);
process.exit(fails.length ? 1 : 0);
