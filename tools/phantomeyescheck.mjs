// #1539 -- a phantom draws a second, full-bright pass from phantom_eyes.png (PhantomEyesFeatureRenderer).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const rd = (f) => readFileSync(fileURLToPath(new URL('../' + f, import.meta.url)), 'utf8');
const src = rd('src/07j_entityrender.js'), ext = rd('tools/extract-mob-textures.mjs'), pk = rd('tools/pack-mobtex.mjs');
let bad = 0, n = 0, quiet = false;
const ok = (c, m) => { if (!quiet) n++; if (!c) { bad++; if (!quiet) console.log('FAIL ' + m); } };
function run(s, e, p) {
  ok(/e\.type === 'phantom'[^]{0,500}texKey: 'phantom_eyes', eyes: true/.test(s), 'phantom eyes pass pushed, full-bright');
  ok(/phantom_eyes: P\('phantom_eyes\.png'\)/.test(e), 'phantom_eyes texture extracted');
  ok(/phantom_eyes: 'phantom'/.test(p), 'phantom_eyes borrows the phantom box list');
}
run(src, ext, pk);
const base = bad; bad = 0;
const breaks = [
  [(s) => s.replace("texKey: 'phantom_eyes', eyes: true", "texKey: 'phantom_eyes'"), 0],
  [(s) => s.replace("e.type === 'phantom' &&", "e.type === 'phantomx' &&"), 0],
  [(s) => s.replace("phantom_eyes: P('phantom_eyes.png')", ''), 1],
  [(s) => s.replace("phantom_eyes: 'phantom'", ''), 2],
];
let caught = 0; quiet = true;
for (const [b, w] of breaks) { bad = 0; const a = [src, ext, pk]; a[w] = b(a[w]); run(...a); if (bad) caught++; }
bad = base; quiet = false;
console.log(n + ' assertions, ' + bad + ' failures, ' + caught + ' breaks caught');
if (caught !== breaks.length) bad++;
console.log(bad ? 'FAIL' : 'ok');
process.exit(bad ? 1 : 0);
