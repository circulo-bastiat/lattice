// #8075 -- a flying firework_rocket draws as its item sprite (FireworkRocketEntityRenderer: FlyingItemEntityRenderer, scale 1).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const src = readFileSync(fileURLToPath(new URL('../src/07j_entityrender.js', import.meta.url)), 'utf8');
let bad = 0, n = 0, quiet = false;
const ok = (c, m) => { if (!quiet) n++; if (!c) { bad++; if (!quiet) console.log('FAIL ' + m); } };
function run(s) {
  ok(/ER\.SHAPE = \{[^}]*firework_rocket: 'item'/.test(s), 'firework_rocket has an item-sprite shape');
  ok(/THROWN_ITEM_NAME = \{[^}]*firework_rocket: 'firework_rocket'/.test(s), 'firework_rocket resolves to its own item');
}
run(src);
const base = bad; bad = 0;
const breaks = [
  (s) => s.replace("firework_rocket: 'item'", ''),
  (s) => s.replace("firework_rocket: 'firework_rocket'", ''),
];
let caught = 0; quiet = true;
for (const b of breaks) { bad = 0; run(b(src)); if (bad) caught++; }
bad = base; quiet = false;
console.log(n + ' assertions, ' + bad + ' failures, ' + caught + ' breaks caught');
if (caught !== breaks.length) bad++;
console.log(bad ? 'FAIL' : 'ok');
process.exit(bad ? 1 : 0);
