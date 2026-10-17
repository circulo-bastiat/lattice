// #1230 -- a spider / cave spider draws a second, full-bright pass from spider_eyes.png (spider_eyes).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const src = readFileSync(fileURLToPath(new URL('../src/07j_entityrender.js', import.meta.url)), 'utf8');
const geo = JSON.parse(readFileSync(fileURLToPath(new URL('../assets/mob-geometry.json', import.meta.url)), 'utf8'));
let bad = 0, n = 0;
let quiet = false;
const ok = (c, m) => { if (!quiet) n++; if (!c) { bad++; if (!quiet) console.log('FAIL ' + m); } };
function run(s) {
  ok(/texKey: 'spider_eyes', eyes: true/.test(s), 'eyes pass pushed with texKey spider_eyes');
  ok(/e\.type === 'spider' \|\| e\.type === 'cave_spider'/.test(s), 'gated on spider and cave_spider');
  ok(/it\.eyes \? 15 : lt >> 4,[^;]*?\(it\.eyes \|\| ER\.fullBrightBlockLight\(it\.e\)\) \? 15/.test(s), 'eyes pass drawn at light 15/15');
  return bad;
}
ok(!!geo.layers['spider_eyes'], 'spider_eyes baked in mob-geometry');
run(src);
const base = bad; bad = 0;
const breaks = [
  (s) => s.replace("texKey: 'spider_eyes', eyes: true", "texKey: 'spider_eyes'"),
  (s) => s.replace("|| e.type === 'cave_spider'", ''),
  (s) => s.replace('it.eyes ? 15 : lt >> 4', 'lt >> 4'),
];
let caught = 0; quiet = true;
for (const b of breaks) { bad = 0; run(b(src)); if (bad) caught++; }
bad = base; quiet = false;
console.log(n + ' assertions, ' + bad + ' failures, ' + caught + ' breaks caught');
if (caught !== breaks.length) bad++;
console.log(bad ? 'FAIL' : 'ok');
process.exit(bad ? 1 : 0);
