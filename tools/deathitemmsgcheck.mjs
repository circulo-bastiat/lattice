#!/usr/bin/env node
// deathitemmsgcheck.mjs — #8263. EntityDamageSource/ProjectileDamageSource.getDeathMessage `.item` variant.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const NS = {}; globalThis.MCL = NS;
for (const f of ['00_ns.js', '01_util.js', '01b_inflate.js', '02i_text.js']) new Function('MCL', readFileSync(join(ROOT, 'src', f), 'utf8'))(NS);
const T = NS.Text;
T.init({ lang: readFileSync(join(ROOT, 'assets/lang.bin')).toString('base64'),
  langBytes: JSON.parse(readFileSync(join(ROOT, 'assets/lang.meta.json'), 'utf8')).rawBytes,
  langOverrides: readFileSync(join(ROOT, 'assets/lang-overrides.json'), 'utf8') });
let bad = 0; const fails = [];
const eq = (got, want, m) => { if (got !== want) { bad++; fails.push(`${m}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`); } };
const msg = (cause, held) => T.plain(T.deathMessage('Steve', cause, 'Zombie', held));
function run(heldName) {
  const named = { i: 1, n: 1, nbt: { name: 'Named Sword' } }, plain = { i: 1, n: 1 };
  const bow = { i: 2, n: 1, t: { display: { Name: '{"text":"Named Bow"}' } } };
  return [
    msg('mob', heldName(named)), msg('mob', heldName(plain)),
    T.plain(T.deathMessage('Steve', 'arrow', 'Skeleton', heldName(bow))),
  ];
}
const real = (s) => T.heldItemName(s);
let [a, b, c] = run(real);
eq(a, 'Steve was slain by Zombie using [Named Sword]', 'named sword zombie');
eq(b, 'Steve was slain by Zombie', 'unnamed sword zombie');
eq(c, 'Steve was shot by Skeleton using [Named Bow]', 'named bow skeleton arrow');
// anti-vacuity: without the hasCustomName test every held stack is named, so the unnamed case must fail
let breaks = 0;
[a, b, c] = run((s) => T.translatable('chat.square_brackets', [T.literal('Iron Sword')]));
if (b !== 'Steve was slain by Zombie') breaks++;
if (bad) { console.log(fails.join('\n')); process.exit(1); }
if (breaks < 1) { console.log('anti-vacuity: broken test not caught'); process.exit(1); }
console.log(`deathitemmsgcheck: 3 cases ok, ${breaks} breaks caught`);
