// #1589 -- the dragon death dissolve pass: dragon_exploding.png packed, pushed at ticksSinceDeath>0 with entityAlpha = ticks/200.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const rd = (f) => readFileSync(fileURLToPath(new URL('../' + f, import.meta.url)), 'utf8');
const src = rd('src/07j_entityrender.js'), ext = rd('tools/extract-mob-textures.mjs'), pk = rd('tools/pack-mobtex.mjs');
let bad = 0, n = 0, quiet = false;
const ok = (c, m) => { if (!quiet) n++; if (!c) { bad++; if (!quiet) console.log('FAIL ' + m); } };
function run(s, e, p) {
  ok(/ticksSinceDeath > 0\) \{[^]{0,500}texKey: 'dragon_exploding', ea: ER\.dragonDissolveAlpha\(e\.dragon\.ticksSinceDeath\)/.test(s), 'exploding pass pushed with ea');
  ok(/dragonDissolveAlpha = function \(ticks\) \{ return Math\.max\(0, Math\.min\(1, Math\.fround\(ticks \/ 200\)\)\)/.test(s), 'alpha = ticks/200');
  ok(/var eyeA = texKey === 'dragon_exploding' \? ER\.entityAlpha/.test(s), 'ea reaches the packed vertex');
  ok(/ER\.entityAlpha = it\.ea;/.test(s), 'entry ea handed to the emitter');
  ok(/dragon_exploding: P\('enderdragon\/dragon_exploding\.png'\)/.test(e), 'texture extracted');
  ok(/dragon_exploding: 'ender_dragon'/.test(p), 'borrows the dragon box list');
}
run(src, ext, pk);
const base = bad; bad = 0;
const breaks = [
  [(s) => s.replace("ea: ER.dragonDissolveAlpha(", "eb: ER.dragonDissolveAlpha("), 0],
  [(s) => s.replace("ticks / 200)", "ticks / 100)"), 0],
  [(s) => s.replace("texKey === 'dragon_exploding' ? ER.entityAlpha", "texKey === 'x' ? ER.entityAlpha"), 0],
  [(s) => s.replace("ER.entityAlpha = it.ea;", ""), 0],
  [(s) => s.replace("dragon_exploding: P('enderdragon/dragon_exploding.png')", ''), 1],
  [(s) => s.replace("dragon_exploding: 'ender_dragon'", ''), 2],
];
let caught = 0; quiet = true;
for (const [b, w] of breaks) { bad = 0; const a = [src, ext, pk]; a[w] = b(a[w]); run(...a); if (bad) caught++; }
bad = base; quiet = false;
console.log(n + ' assertions, ' + bad + ' failures, ' + caught + ' breaks caught');
if (caught !== breaks.length) bad++;
process.exit(bad ? 1 : 0);
