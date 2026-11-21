// #384 B2: Main.parseSeed against a Java-semantics GeneratorOptions.parseSeed reference
// (Long.parseLong, else (long)String.hashCode) and the 32-char field cap. Node only.
import fs from 'node:fs';
import vm from 'node:vm';

const src = fs.readFileSync(new URL('../src/17_main.js', import.meta.url), 'utf8');
const hud = fs.readFileSync(new URL('../src/15_hud.js', import.meta.url), 'utf8');

function load(code) {
  const a = code.indexOf('Main.parseSeed64 = function');
  const b = code.indexOf('Main.skipTitle = false;');
  const Main = { seed: 777 };
  vm.runInNewContext(code.slice(a, b), { Main, BigInt, Math, String });
  return Main;
}

// independent Java reference
function javaHash(s) { let h = 0n; for (let i = 0; i < s.length; i++) h = BigInt.asIntN(32, h * 31n + BigInt(s.charCodeAt(i))); return h; }
function javaParseSeed(t, cur) {
  t = t.trim(); if (!t.length) return cur;
  if (/^[+-]?[0-9]+$/.test(t)) { const v = BigInt(t); if (v >= -(2n ** 63n) && v < 2n ** 63n) return v; }
  return javaHash(t);
}
const CASES = ['glacier', 'glacial', '+5', '-5', '12345', '  glacier  ', '4294967296', '9223372036854775807',
  '9223372036854775808', '-9223372036854775808', '12345678901234567890', '', '   ', '1.5', '0x10', 'héllo wörld ☃',
  'a'.repeat(32)];

let pass = 0; const fails = [];
function run(Main, tag) {
  const bad = [];
  for (const c of CASES) {
    const want = javaParseSeed(c, null);
    const got64 = Main.parseSeed64(c);
    const g = got64 === null ? null : got64;
    if (g !== want) bad.push(`parseSeed64(${JSON.stringify(c)}) = ${g}, vanilla ${want}`);
    const low = want === null ? 777 : Number(BigInt.asIntN(32, want));
    if (Main.parseSeed(c) !== low) bad.push(`parseSeed(${JSON.stringify(c)}) = ${Main.parseSeed(c)}, expected ${low}`);
  }
  if (Main.parseSeed('glacier') !== 108181935) bad.push('glacier is not 108181935');
  if (Main.parseSeed('+5') !== 5) bad.push("'+5' is not 5");
  return bad;
}

const good = run(load(src), 'real');
pass += CASES.length; fails.push(...good);
if (!/H\.titleSeed\.length < 32\b/.test(hud)) fails.push('title seed field is not capped at 32 characters');

// anti-vacuity: each mutation of the real source must be caught
let breaks = 0;
const muts = [
  ['FNV instead of hashCode', (s) => s.replace('Math.imul(h, 31)', 'Math.imul(h ^ 0x811c9dc5, 16777619)')],
  ['no + sign', (s) => s.replace('/^[+-]?\\d+$/', '/^-?\\d+$/')],
  ['32-bit truncated parseLong', (s) => s.replace('if (v >= -(1n << 63n) && v < (1n << 63n)) return v;', 'return BigInt.asIntN(32, v);')],
  ['no range check', (s) => s.replace('if (v >= -(1n << 63n) && v < (1n << 63n)) return v;', 'return v;')],
];
for (const [name, f] of muts) {
  const m = f(src);
  if (m === src) { fails.push(`mutation "${name}" did not apply`); continue; }
  if (run(load(m), name).length) { breaks++; console.log(`   ✓ break caught: ${name}`); } else fails.push(`mutation "${name}" was NOT caught`);
}
if (hud.replace('H.titleSeed.length < 32', 'H.titleSeed.length < 24') !== hud) { breaks++; console.log('   ✓ break caught: 24-char cap'); }

console.log('================ seedparsecheck ================');
console.log(` assertions passed .. ${pass - good.length}`);
console.log(` failures ........... ${fails.length}`);
for (const f of fails) console.log('   ✗ ' + f);
console.log(` breaks caught ...... ${breaks}`);
process.exit(fails.length ? 1 : 0);
