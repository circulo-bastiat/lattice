// #1566 -- a dragon draws a second, full-bright pass from dragon_eyes.png (PhantomEyesFeatureRenderer).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const rd = (f) => readFileSync(fileURLToPath(new URL('../' + f, import.meta.url)), 'utf8');
const src = rd('src/07j_entityrender.js'), ext = rd('tools/extract-mob-textures.mjs'), pk = rd('tools/pack-mobtex.mjs');
let bad = 0, n = 0, quiet = false;
const ok = (c, m) => { if (!quiet) n++; if (!c) { bad++; if (!quiet) console.log('FAIL ' + m); } };
function run(s, e, p) {
  ok(/e\.type === 'ender_dragon'[^]{0,500}texKey: 'dragon_eyes', eyes: true/.test(s), 'dragon eyes pass pushed, full-bright');
  ok(/dragon_eyes: P\('enderdragon\/dragon_eyes\.png'\)/.test(e), 'dragon_eyes texture extracted');
  ok(/dragon_eyes: 'ender_dragon'/.test(p), 'dragon_eyes borrows the dragon box list');
}
run(src, ext, pk);
const base = bad; bad = 0;
const breaks = [
  [(s) => s.replace("texKey: 'dragon_eyes', eyes: true", "texKey: 'dragon_eyes'"), 0],
  [(s) => s.replace("e.type === 'ender_dragon' && !(ST", "e.type === 'ender_dragonx' && !(ST"), 0],
  [(s) => s.replace("dragon_eyes: P('enderdragon/dragon_eyes.png')", ''), 1],
  [(s) => s.replace("dragon_eyes: 'ender_dragon'", ''), 2],
];
let caught = 0; quiet = true;
for (const [b, w] of breaks) { bad = 0; const a = [src, ext, pk]; a[w] = b(a[w]); run(...a); if (bad) caught++; }
bad = base; quiet = false;
console.log(n + ' assertions, ' + bad + ' failures, ' + caught + ' breaks caught');
if (caught !== breaks.length) bad++;
console.log(bad ? 'FAIL' : 'ok');
process.exit(bad ? 1 : 0);
