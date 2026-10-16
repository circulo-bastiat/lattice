#!/usr/bin/env node
// mobdropycheck — #1129: mob loot/equipment/head/inventory drops spawn at the entity's feet.
// Vanilla Entity.dropStack(stack, 0.0F) -> ItemEntity at (getX(), getY()+0, getZ()); MC-Lite used y + height*0.5.
// Source-level (no engine boot): every EL.dropStack in Cb.dropLoot must pass e.y unmodified.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MCLITE_ROOT } from './loadsrc.mjs';

let pass = 0, breaks = 0;
const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };

const src = readFileSync(join(MCLITE_ROOT, 'src', '14j_combat.js'), 'utf8');
const dropYs = (s) => {
  const a = s.indexOf('Cb.dropLoot = function');
  const body = s.slice(a, s.indexOf('\n  Cb.', a + 10));
  return [...body.matchAll(/EL\.dropStack\(([^,]+),\s*([^,]+),/g)].map((m) => m[2].trim());
};

console.log('mobdropycheck — mob drop y == mob y');
const ys = dropYs(src);
ok(ys.length >= 4, 'dropLoot has >= 4 dropStack sites (got ' + ys.length + ')');
ok(ys.every((y) => y === 'e.y'), 'every dropLoot dropStack uses e.y (got ' + ys.join(' | ') + ')');
// anti-vacuity: the old mid-height offset must be rejected by the same predicate
const broken = src.replace('EL.dropStack(e.x, e.y, e.z, idx', 'EL.dropStack(e.x, e.y + e.height * 0.5, e.z, idx');
if (!dropYs(broken).every((y) => y === 'e.y')) { breaks++; console.log('  ✓ break caught: height*0.5 offset'); }
ok(breaks === 1, 'anti-vacuity: height*0.5 offset not detected');
console.log(fails.length ? fails.join('\n') : 'ok');
console.log(`assertions passed ........ ${pass}`);
console.log(`failures ................. ${fails.length}`);
console.log(`breaks caught ............ ${breaks}`);
process.exit(fails.length ? 1 : 0);
