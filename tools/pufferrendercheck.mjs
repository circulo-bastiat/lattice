import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT, initRegistry } from './loadsrc.mjs';
const near = (a, b, e = 1e-4) => Math.abs(a - b) <= e;
const M = loadEngine({ extra: ['02f_tags.js', '02g_items.js', '07_world.js', '07h_entities.js', '07j_entityrender.js'], dom: false });
if (initRegistry) initRegistry(M);
const ER = M.EntityRender;
const src = readFileSync(join(MCLITE_ROOT, '.decomp/net/minecraft/client/render/entity/PufferfishEntityRenderer.java'), 'utf8');
let breaks = 0; const fails = [];
let n = 0;
const chk = (c, m) => { n++; if (!c) fails.push(m); };
const brk = (c, m) => { breaks++; chk(c, 'anti-vacuity: ' + m); };
chk(/MathHelper\.cos\(\$\$\d\s*\*\s*0\.05F\)\s*\*\s*0\.08F/.test(src), 'decomp bob formula');
chk(/0\.1F\s*\+\s*0\.1F\s*\*/.test(src), 'decomp shadow formula');
const bob = (age, w) => ER.setupAnimDelta('body', 0, 0, 0, 0, false, 'fish', { ageInTicks: age, fish: { water: w, puffer: true } });
const want = (age) => Math.cos(age * 0.05) * 0.08 * 16;
for (const age of [0, 31.4, 100, 7.3]) for (const w of [true, false]) {
  const d = bob(age, w);
  chk(d && near(d.dpy, want(age)), 'bob y @' + age + ' -> ' + JSON.stringify(d));
}
const cod = ER.setupAnimDelta('tail_fin', 0, 0, 0, 0, false, 'fish', { ageInTicks: 5, fish: { water: true, puffer: false } });
chk(cod && !cod.dpy, 'cod does not bob');
const tf = ER.setupAnimDelta('tail_fin', 0, 0, 0, 0, false, 'fish', { ageInTicks: 5, fish: { water: true, puffer: true } });
chk(tf && near(tf.ry, -0.45 * Math.sin(3)), 'puffer still gets fin anims via base');
[0.1, 0.2, 0.3].forEach((r, s) => chk(near(ER.pufferShadowRadius(s), r), 'shadow ' + s));
brk(!near(bob(11.4, true).dpy, want(31.4), 1e-3), 'wrong age gives wrong bob');
brk(!near(ER.pufferShadowRadius(1), 0.3), 'wrong shadow value rejected');
brk(!/0\.2F\s*\+\s*0\.1F/.test(src), 'mutated decomp formula rejected');
brk(!(ER.setupAnimDelta('body', 0, 0, 0, 0, false, 'fish', { ageInTicks: 0, fish: { water: true, puffer: false } }) || {}).dpy, 'non-puffer lacks bob');
if (fails.length) { fails.forEach((f) => console.log('   ✗ ' + f)); process.exit(1); }
console.log(n + ' assertions, 0 failures, ' + breaks + ' breaks caught');
