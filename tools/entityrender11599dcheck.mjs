#!/usr/bin/env node
// entityrender11599dcheck.mjs — #11599 (AUDIT-MAP) part 4: EndCrystalEntityRenderer.getYOffset, ExperienceOrbEntityRenderer
// crop (orbUV) and colour pulse (orbColorAt) driven through their real entry points, then re-run against source mutants:
// every cut must be noticed.
import { loadEngine, initRegistry } from './loadsrc.mjs';

const near = (a, b) => Math.abs(a - b) < 1e-9;
let N = 0;
function run(patch) {
  const M = loadEngine({ extra: ['02g_items.js', '07h_entities.js', '14b_physics.js', '07i_entitylist.js', '07j_entityrender.js'], dom: false,
    ...(patch ? { patch: (f, t) => (f === '07j_entityrender.js' ? patch(t) : t) } : {}) });
  initRegistry(M);
  const ER = M.EntityRender, f = [];
  const ok = (c, m) => { N++; if (!c) f.push(m); };
  try {
    ER.init();
    const yo = (age, p) => { const s = Math.sin((age + p) * 0.2) / 2 + 0.5; return ((s * s + s) * 0.4) - 1.4; };
    ok(near(ER.crystalYOffset({ endCrystalAge: 0 }, 0), -1.4 + 0.4 * (0.25 + 0.5)) && near(ER.crystalYOffset({ endCrystalAge: 7 }, 0.5), yo(7, 0.5)) && near(ER.crystalYOffset({}, 2), yo(0, 2)), 'EndCrystalEntityRenderer.getYOffset');
    const a = ER.orbUV(0), b = ER.orbUV(5);
    ok(near(a[0], 0) && near(a[1], 0) && near(a[2], 0.25) && near(a[3], 0.25) && near(b[0], 0.25) && near(b[1], 0.25) && near(b[2], 0.5) && near(b[3], 0.5) && near(ER.orbUV(3)[0], 0.75) && near(ER.orbUV(4)[1], 0.25) && near(ER.orbUV(4)[0], 0), 'ExperienceOrbEntityRenderer crop');
    const c = ER.orbColorAt(0, 0), d = ER.orbColorAt(3, 0.5);
    ok(c[0] === 127 && c[1] === 255 && c[3] === 128 && c[2] === Math.floor((Math.sin(Math.PI * 4 / 3) + 1) * 0.1 * 255) && d[0] === Math.floor((Math.sin(1.75) + 1) * 127.5) && d[2] === Math.floor((Math.sin(1.75 + Math.PI * 4 / 3) + 1) * 25.5) && ER.orbColorAt(undefined, undefined)[0] === 127, 'ExperienceOrbEntityRenderer colour pulse');
    ok(ER.rodTileName(true) === 'item/fishing_rod_cast' && ER.rodTileName(false) === 'item/fishing_rod', 'FishingBobber rod tile');
  } catch (e) { f.push('threw: ' + e.message); }
  return f;
}
const base = run(null);
if (base.length) { console.log('FAIL baseline: ' + base.join('; ')); process.exit(1); }
const muts = [
  ['crystal bob scale', (t) => t.replace('s = (s * s + s) * 0.4;', 's = (s * s + s) * 0.5;')],
  ['crystal bob offset', (t) => t.replace('return s - 1.4;', 'return s - 1.5;')],
  ['crystal bob freq', (t) => t.replace('Math.sin(t * 0.2) / 2 + 0.5;\n    s = (s * s', 'Math.sin(t * 0.1) / 2 + 0.5;\n    s = (s * s')],
  ['crystal partial', (t) => t.replace('(e.endCrystalAge || 0) + partial;\n    var s = Math.sin(t * 0.2)', '(e.endCrystalAge || 0);\n    var s = Math.sin(t * 0.2)')],
  ['orb col', (t) => t.replace('var col = index % cols, row', 'var col = index % 4 + 1, row')],
  ['orb row', (t) => t.replace('row = Math.floor(index / cols);', 'row = 0;')],
  ['orb u1', (t) => t.replace('u1 = (col * tile + tile) / sheet', 'u1 = (col * tile) / sheet')],
  ['orb v1', (t) => t.replace('v1 = (row * tile + tile) / sheet', 'v1 = (row * tile + tile) / tile')],
  ['orb t half', (t) => t.replace('(partial || 0)) / 2;\n    var r', '(partial || 0));\n    var r')],
  ['orb blue phase', (t) => t.replace('t + Math.PI * 4 / 3) + 1) * 0.1', 't + Math.PI * 2 / 3) + 1) * 0.1')],
  ['orb green', (t) => t.replace('var g = 255;\n    var b', 'var g = 128;\n    var b')],
  ['orb alpha', (t) => t.replace('return [r, g, b, 128];', 'return [r, g, b, 255];')],
  ['rod cast tile', (t) => t.replace("cast ? 'item/fishing_rod_cast'", "cast ? 'item/fishing_rod'")],
];
let caught = 0; const missed = [];
for (const [name, fn] of muts) {
  const probe = (t) => { const o = fn(t); if (o === t) throw new Error('mutant did not change source: ' + name); return o; };
  let f; try { f = run(probe); } catch (e) { if (/did not change/.test(e.message)) { console.log('FAIL ' + e.message); process.exit(1); } f = ['threw']; }
  if (f.length) { caught++; console.log('   ✓ cutting ' + name + ' fails: ' + f[0].slice(0, 70)); } else { missed.push(name); console.log('  FAIL cutting ' + name + ' went unnoticed'); }
}
console.log(` assertions passed .. ${N / (muts.length + 1) | 0}`);
console.log(` failures ........... ${missed.length}`);
console.log(` breaks caught ...... ${caught}`);
process.exit(missed.length ? 1 : 0);
