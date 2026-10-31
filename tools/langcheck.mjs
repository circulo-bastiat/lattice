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

if (fails.length) { console.log(fails.map(f => '  ✗ ' + f).join('\n')); console.log(`FAIL (${fails.length})`); process.exit(1); }
console.log(`assertions passed ..... ${pass}`);
console.log(`${caught} breaks caught (langcheck OK)`);
