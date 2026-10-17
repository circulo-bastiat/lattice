#!/usr/bin/env node
// damagetrackercheck.mjs -- #8264: DamageTracker.getDeathMessage (death.fell.*, death.attack.<id>.player).
// Anti-vacuity: window 0 must break the assist case ('<n> breaks caught').
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { inflateRawSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const FILES = ['00_ns.js', '01_util.js', '01b_inflate.js', '02i_text.js', '14d2_damagetracker.js'];
console.log('damagetrackercheck -- #8264');

function run(window) {
  const NS = {}; globalThis.MCL = NS;
  for (const f of FILES) new Function('MCL', readFileSync(join(ROOT, 'src', f), 'utf8'))(NS);
  const raw = readFileSync(join(ROOT, 'assets/lang.bin'));
  NS.Text.init({ lang: raw.toString('base64'), langBytes: inflateRawSync(raw).length });
  const DT = NS.DamageTracker;
  if (window !== undefined) { DT.WINDOW = window; DT.COMBAT = window; }
  const blocks = { ladder: 1 };
  NS.Reg = { names: ['air', 'ladder'] };
  let climbing = false;
  NS.Physics = { onClimbable: () => climbing, blockIdAt: () => 1 };
  const out = {};
  const mk = () => ({ name: 'Steve', age: 1000, x: 0, y: 0, z: 0, inWater: false });
  const skel = { type: 'skeleton' }, zomb = { type: 'zombie' };
  const kill = (e, key, d, fall) => { DT.onDamage(e, key, null, d, fall); return NS.Text.plain(DT.message(e, key)); };
  let e = mk(); climbing = true; out.ladder = kill(e, 'fall', 10, 8); climbing = false;
  e = mk(); e.inWater = true; out.water = kill(e, 'fall', 10, 8);
  e = mk(); out.plain = kill(e, 'fall', 10, 8);
  e = mk(); DT.onDamage(e, 'arrow', skel, 3, 0); e.age += 60; out.assist = kill(e, 'fall', 10, 8);
  e = mk(); DT.onDamage(e, 'mob', zomb, 3, 0); e.age += 120; out.zombie6s = kill(e, 'fall', 10, 8);
  e = mk(); DT.onDamage(e, 'mob', zomb, 3, 0); e.age += 400; out.expired = kill(e, 'fall', 10, 8);
  e = mk(); DT.onDamage(e, 'mob', zomb, 3, 0); e.age += 20; out.burn = kill(e, 'onFire', 1, 0);
  return out;
}
const want = {
  ladder: 'Steve fell off a ladder', water: 'death.fell.accident.water', plain: 'Steve fell from a high place',
  assist: 'Steve was doomed to fall by Skeleton', zombie6s: 'Steve was doomed to fall by Zombie',
  expired: 'Steve fell from a high place', burn: 'Steve was burnt to a crisp whilst fighting Zombie',
};
let bad = 0;
const got = run();
for (const k in want) { const ok = got[k] === want[k]; if (!ok) bad++; console.log((ok ? '  ok ' : '  FAIL ') + k + ': ' + got[k]); }
const broken = run(0);
const caught = broken.assist !== want.assist ? 1 : 0;
if (!caught) bad++;
console.log(' assertions passed .. ' + (Object.keys(want).length - bad + caught));
console.log(' failures ........... ' + bad);
console.log('   ✓ window 0 breaks the assist case (' + caught + ' breaks caught)');
process.exit(bad ? 1 : 0);
