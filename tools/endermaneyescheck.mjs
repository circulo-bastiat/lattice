// #1748 -- an enderman draws a second, full-bright pass from enderman_eyes.png (enderman_eyes).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const src = readFileSync(fileURLToPath(new URL('../src/07j_entityrender.js', import.meta.url)), 'utf8');
let bad = 0, n = 0;
let quiet = false;
const ok = (c, m) => { if (!quiet) n++; if (!c) { bad++; if (!quiet) console.log('FAIL ' + m); } };
function run(s) {
  ok(/texKey: 'enderman_eyes', eyes: true/.test(s), 'eyes pass pushed with texKey enderman_eyes');
  ok(/e\.type === 'enderman' && !\(ST[^]{0,400}texKey: 'enderman_eyes', eyes/.test(s), 'gated on enderman');
  ok(/it\.eyes \? 15 : lt >> 4/.test(s) && /\(it\.eyes \|\| /.test(s), "eyes pass drawn at light 15/15");
  return bad;
}
run(src);
const base = bad; bad = 0;
const breaks = [
  (s) => s.replace("texKey: 'enderman_eyes', eyes: true", "texKey: 'enderman_eyes'"),
  (s) => s.replace("e.type === 'enderman' && !(ST", "e.type === 'endermanx' && !(ST"),
  (s) => s.replace('it.eyes ? 15 : lt >> 4', 'lt >> 4'),
];
let caught = 0; quiet = true;
for (const b of breaks) { bad = 0; run(b(src)); if (bad) caught++; }
bad = base; quiet = false;
console.log(n + ' assertions, ' + bad + ' failures, ' + caught + ' breaks caught');
if (caught !== breaks.length) bad++;
console.log(bad ? 'FAIL' : 'ok');
process.exit(bad ? 1 : 0);
