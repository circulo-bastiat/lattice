#!/usr/bin/env node
// hurtwindowcheck.mjs — #426. LivingEntity.hurt (1.18.2): a hit is blocked only while
// invulnerableTime > 10 (set to 20 by a landed hit, -1 per tick); at <= 10 a full hit lands again.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const SRC = fileURLToPath(new URL('..', import.meta.url)) + 'src';
const NS = {}; globalThis.MCL = NS;
for (const f of ['00_ns.js', '01_util.js', '01b_inflate.js', '02g_items.js', '14f_inventory.js', '14d_survival.js'])
  new Function('MCL', readFileSync(join(SRC, f), 'utf8'))(NS);
NS.Items.init({ items: readFileSync(join(SRC, '..', 'assets', 'items.bin')).toString('base64'),
  itemsBytes: JSON.parse(readFileSync(join(SRC, '..', 'assets', 'items.meta.json'), 'utf8')).rawBytes });
const Sv = NS.Survival;
let pass = 0; const fails = []; let breaks = 0;
const run = () => {
  const out = [];
  const P = Sv.init({ x: 0, y: 0, z: 0 });
  out.push([Sv.hurt(P, 'cactus', 1), true, 'first hit lands']);
  for (let t = 1; t <= 10; t++) { Sv.tick(P); }   // invulnerable 20 -> 10
  out.push([Sv.hurt(P, 'cactus', 1), true, 'equal hit lands once invulnerableTime is 10 (tick 10)']);
  const Q = Sv.init({ x: 0, y: 0, z: 0 });
  Sv.hurt(Q, 'cactus', 1);
  for (let t = 1; t <= 9; t++) Sv.tick(Q);        // 11 left
  out.push([Sv.hurt(Q, 'cactus', 1), false, 'equal hit blocked while invulnerableTime is 11']);
  const R = Sv.init({ x: 0, y: 0, z: 0 });
  Sv.hurt(R, 'cactus', 1);
  for (let t = 1; t <= 11; t++) Sv.tick(R);
  out.push([Sv.hurt(R, 'cactus', 1), true, 'hit lands again at tick 11']);
  return out;
};
for (const [got, want, m] of run()) { if (got === want) pass++; else fails.push(m + ` (got ${got})`); }
const save = Sv.INVULN_STRONGER_ABOVE;
for (const [label, v] of [['window 20 (old bug)', 0], ['window never opens', 1e9]]) {
  Sv.INVULN_STRONGER_ABOVE = v;
  const bad = run().some(([g, w]) => g !== w);
  Sv.INVULN_STRONGER_ABOVE = save;
  if (bad) { breaks++; console.log('   ✓ break caught: ' + label); } else fails.push('anti-vacuity: ' + label + ' went unnoticed');
}
console.log('\n================ hurtwindowcheck ================');
console.log(` assertions passed .. ${pass}`);
console.log(` failures ........... ${fails.length}`);
for (const f of fails) console.log('  ✗ ' + f);
console.log(` breaks caught ...... ${breaks}`);
process.exit(fails.length ? 1 : 0);
