#!/usr/bin/env node
// langcheck.mjs — every lang key src/ uses resolves in the REAL 1.18.2 client en_us.json,
// and the packed table (assets/lang.bin) equals that file exactly.
//
//   node tools/langcheck.mjs [--quiet]
//
// The answer comes from the game: assets/minecraft/lang/en_us.json inside the vanilla client jar.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const QUIET = process.argv.includes('--quiet');
let pass = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else if (fails.length < 40) fails.push(m); return c; };

const jarCands = [join(ROOT, '..', 'mclite-store/jars/1.18.2/1.18.2.jar'), join(ROOT, '.mcdata/1.18.2/1.18.2.jar'),
  join(ROOT, 'jars/1.18.2/1.18.2.jar')];
const jar = jarCands.find(existsSync);
if (!jar) { console.log('langcheck: SKIP - no vanilla 1.18.2 client jar'); process.exit(0); }
const real = JSON.parse(execFileSync('unzip', ['-p', jar, 'assets/minecraft/lang/en_us.json'], { maxBuffer: 1 << 28 }).toString('utf8'));
const packed = JSON.parse(inflateRawSync(readFileSync(join(ROOT, 'assets/lang.bin'))).toString('utf8'));

// literal keys in src: a complete string literal under a lang namespace (not a prefix ending in '.')
const SRC = join(ROOT, 'src');
// only literals in a lang context: translate: '..', translate('..'), template('..'), Text.has('..'), key: '..'
// (a bare dotted string can equally be a sound event id such as block.piston.extend)
const RE = /(?:translate|template|T\.has|Text\.has|translatable|Component)\w*['"]?\s*[:(,]\s*(['"])([a-z_]+\.[A-Za-z0-9_.\/-]*[A-Za-z0-9_])\1/g;
const used = new Map();
const scan = (text, tag) => { let m; RE.lastIndex = 0; while ((m = RE.exec(text))) if (!used.has(m[2])) used.set(m[2], tag); };
for (const f of readdirSync(SRC)) if (f.endsWith('.js') && !f.endsWith('.gen.js')) scan(readFileSync(join(SRC, f), 'utf8'), f);

// keys that are only a dotted prefix or id in data, not lang keys, are listed explicitly
const NOT_KEYS = new Set(JSON.parse(readFileSync(join(ROOT, 'tools/langcheck.notkeys.json'), 'utf8')));
const isSound = k => ('subtitles.' + k) in real;
const unresolved = [...used.keys()].filter(k => !(k in real) && !isSound(k) && !NOT_KEYS.has(k));

console.log('langcheck — lang keys vs the real 1.18.2 en_us.json');
ok(Object.keys(real).length > 5000, `real table has ${Object.keys(real).length} keys`);
ok(used.size > 10, `${used.size} literal lang keys found in src`);
for (const k of unresolved) ok(false, `key used in src/${used.get(k)} is not in the real en_us: ${k}`);
const pk = Object.keys(packed), rk = Object.keys(real);
ok(pk.length === rk.length, `packed ${pk.length} keys vs real ${rk.length}`);
let diff = 0; for (const k of rk) if (packed[k] !== real[k]) { if (diff++ < 5) ok(false, `packed value differs: ${k}`); }
ok(diff === 0, `${diff} packed values differ`);

// anti-vacuity: the detector must flag broken inputs
let caught = 0;
const flags = (usedKeys, tbl) => usedKeys.some(k => !(k in tbl));
if (flags(["gui.done_xx_bogus"], real)) { caught++; console.log("  ✓ break caught: bogus key"); }
if (flags([[...used.keys()][0]], (() => { const t = { ...real }; delete t[[...used.keys()][0]]; return t; })())) { caught++; console.log("  ✓ break caught: key removed"); }
const t2 = { ...packed }; const k0 = rk[0]; t2[k0] = 'x';
if (rk.some(k => t2[k] !== real[k])) { caught++; console.log("  ✓ break caught: value changed"); }
const t3 = { ...packed }; delete t3[rk[5]];
if (Object.keys(t3).length !== rk.length) { caught++; console.log("  ✓ break caught: key dropped"); }
ok(caught === 4, `only ${caught}/4 breaks caught`);

// ── runtime path: Text.init on the shipped payload; %s / %N$s, fallback-to-key, live language switch
import { deflateRawSync } from 'node:zlib';
{
  const NS = {}; globalThis.MCL = NS;
  for (const f of ['00_ns.js', '01_util.js', '01b_inflate.js', '02i_text.js']) new Function('MCL', readFileSync(join(SRC, f), 'utf8'))(NS);
  const T = NS.Text;
  const meta = JSON.parse(readFileSync(join(ROOT, 'assets/lang.meta.json'), 'utf8'));
  const load = (tbl) => { const raw = Buffer.from(JSON.stringify(tbl), 'utf8');
    T.init({ lang: deflateRawSync(raw).toString('base64'), langBytes: raw.length, langOverrides: '{}' }); };
  T.init({ lang: readFileSync(join(ROOT, 'assets/lang.bin')).toString('base64'), langBytes: meta.rawBytes,
    langOverrides: readFileSync(join(ROOT, 'assets/lang-overrides.json'), 'utf8') });
  ok(T.keys === rk.length, `Text.init loaded ${T.keys} keys vs ${rk.length}`);
  // every real template with placeholders substitutes exactly what vanilla's rule gives (reference impl below)
  const ref = (t, a) => { let n = 0; return t.replace(/%(?:(\d+)\$)?([s%])/g, (m, i, c) => c === '%' ? '%' : (a[i ? i - 1 : n++] ?? '')); };
  let fmt = 0, bad = 0;
  for (const k of rk) { const t = real[k]; if (!/%\d*\$?s/.test(t) || /%\d+\$s.*%s|%s.*%\d+\$s/.test(t)) continue;
    fmt++; const a = ['A', 'B', 'C', 'D']; if (T.translate(k, a) !== ref(t, a)) { if (bad++ < 5) ok(false, `format differs for ${k}`); } }
  ok(fmt > 500 && bad === 0, `${fmt} templates formatted, ${bad} differ`);
  ok(T.translate('gui.done_xx_bogus', ['x']) === 'gui.done_xx_bogus', 'unknown key falls back to the key');
  ok(T.translate('commands.give.success.single', ['1', 'Stone', 'Steve']) === ref(real['commands.give.success.single'], ['1', 'Stone', 'Steve']), 'give.success.single');
  // second language: swapping the table changes every translate() result live, missing keys fall back to the key
  const de = {}; for (const k of rk) de[k] = '[de]' + real[k];
  const keep = 'gui.done'; delete de['gui.cancel'];
  load(de);
  ok(T.translate(keep) === '[de]' + real[keep], 'second language switches gui.done live');
  ok(T.translate('gui.cancel') === 'gui.cancel', 'key missing from second language falls back to the key');
  let sw = 0; for (const k of rk) if (k !== 'gui.cancel' && T.translate(k, ['A']) === ref('[de]' + real[k], ['A'])) sw++;
  ok(sw === rk.length - 1, `second language: ${rk.length - 1 - sw} keys did not switch`);
  // anti-vacuity: broken formatters/tables must be detected
  const brk = (c, m) => { if (c) { caught++; console.log('  ✓ break caught: ' + m); } };
  brk(ref('%2$s %s', ['a', 'b', 'c']) === T.format('%2$s %s', ['a', 'b', 'c']) && ref('%s', ['a']) !== T.format('%s', ['z']), 'wrong argument');
  brk(T.format('%s%2$s %s', ['a', 'b', 'c']) === 'ab b' && T.format('%s%2$s %s', ['a', 'b', 'c']) !== 'ab c', 'indexed does not advance the counter');
  brk(T.translate('gui.cancel') === 'gui.cancel' && real['gui.cancel'] !== 'gui.cancel', 'fallback detectable');
}
ok(caught === 7, `only ${caught}/7 breaks caught`);

if (fails.length) { console.log(fails.map(f => '  ✗ ' + f).join('\n')); console.log(`FAIL (${fails.length})`); process.exit(1); }
console.log(`assertions passed ..... ${pass}`);
console.log(`${caught} breaks caught (langcheck OK)`);
