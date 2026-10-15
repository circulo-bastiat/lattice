// #1766 -- every EyesFeatureRenderer in .decomp has an engine full-bright eyes pass, and the enderman carries its block.
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const rd = (f) => readFileSync(fileURLToPath(new URL('../' + f, import.meta.url)), 'utf8');
const dir = fileURLToPath(new URL('../.decomp/net/minecraft/client/render/entity/feature/', import.meta.url));
const eyes = readdirSync(dir).filter((f) => /EyesFeatureRenderer\.java$/.test(f) && f !== 'EyesFeatureRenderer.java')
  .map((f) => f.replace('EyesFeatureRenderer.java', '').toLowerCase());
const src = rd('src/07j_entityrender.js');
let bad = 0, n = 0, quiet = false;
const ok = (c, m) => { if (!quiet) n++; if (!c) { bad++; if (!quiet) console.log('FAIL ' + m); } };
function run(s) {
  ok(eyes.length >= 3, 'found the EyesFeatureRenderer subclasses in .decomp');
  for (const k of eyes) {
    const t = k === 'spider' ? "e\\.type === 'spider'" : "e\\.type === '" + k + "'";
    ok(new RegExp(t + '[^}]{0,700}eyes: true').test(s), k + ' has a full-bright eyes pass');
  }
  ok(/ER\.endermanCarried\(e, partial\)/.test(s), 'enderman carried-block pass pushed');
}
run(src);
const base = bad; bad = 0;
const breaks = [
  (s) => s.replace("texKey: 'spider_eyes', eyes: true", "texKey: 'spider_eyes'"),
  (s) => s.replaceAll("e.type === 'enderman'", "e.type === 'endermanx'"),
  (s) => s.replace("e.type === 'phantom' &&", "e.type === 'phantomx' &&"),
  (s) => s.replace('ER.endermanCarried(e, partial)', 'null'),
  (s) => s.replace("texKey: 'phantom_eyes', eyes: true", "texKey: 'phantom_eyes'"),
];
let caught = 0; quiet = true;
for (const b of breaks) { bad = 0; run(b(src)); if (bad) caught++; }
bad = base; quiet = false;
console.log(n + ' assertions, ' + bad + ' failures, ' + caught + ' breaks caught');
if (caught !== breaks.length) bad++;
console.log(bad ? 'FAIL' : 'ok');
process.exit(bad ? 1 : 0);
