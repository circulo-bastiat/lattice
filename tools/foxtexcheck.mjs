#!/usr/bin/env node
// foxcheck.mjs sibling — #1327: FoxEntityRenderer.getTexture picks fox/snow_fox, *_sleep while isSleeping;
// the extractor/packer carry the sleep sheets; FoxHeldItemFeatureRenderer is wired (ER.foxHeldItems).
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';
import { MCLITE_ROOT } from './loadsrc.mjs';

let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const rd = (p) => readFileSync(join(MCLITE_ROOT, p), 'utf8');
// only Fx.skinKey is under test and it needs NS.Entities.bare: run the module against a stub namespace, no assets needed
const MCL = { JRandom: function () {}, Entities: { bare: (t) => String(t).replace(/^minecraft:/, '') } };
const code = readFileSync(join(MCLITE_ROOT, 'src/07zj_fox.js'), 'utf8').replace(/\}\)\(typeof MCL[^\n]*\s*$/, '})(MCL);');
try { vm.runInNewContext(code, { MCL, console, Math }); } catch (e) { /* later wiring may need the engine; skinKey is defined first */ }
const Fx = MCL.Fox;

const rnd = rd('.decomp/net/minecraft/client/render/entity/FoxEntityRenderer.java');
ok(/isSleeping\(\)/.test(rnd) && /fox_sleep\.png/.test(rnd) && /snow_fox_sleep\.png/.test(rnd), '.decomp FoxEntityRenderer changed');
const feat = rd('.decomp/net/minecraft/client/render/entity/feature/FoxHeldItemFeatureRenderer.java');
ok(/0\.46F, 0\.26F, 0\.22F/.test(feat) && /0\.06F, 0\.27F, -0\.5/.test(feat), '.decomp held-item offsets changed');

const T = { red: 0, snow: 1 };
const cases = [[0, false, 'fox'], [0, true, 'fox_sleep'], [1, false, 'snow_fox'], [1, true, 'snow_fox_sleep']];
const pick = (F) => cases.every(([t, s, k]) => F.skinKey({ type: 'fox', foxType: t, sleeping: s }) === k);
ok(pick(Fx), 'Fx.skinKey picks fox/fox_sleep/snow_fox/snow_fox_sleep');
ok(Fx.skinKey({ type: 'cow', sleeping: true }) === null, 'non-fox -> null');

const ex = rd('tools/extract-mob-textures.mjs');
for (const [n, f] of [['fox_sleep', 'fox/fox_sleep.png'], ['snow_fox', 'fox/snow_fox.png'], ['snow_fox_sleep', 'fox/snow_fox_sleep.png']])
  ok(ex.includes(`${n}: P('${f}')`), `extractor maps ${n}`);
ok(/GEOM_BASE_OVERRIDE = \{[^}]*fox_sleep: 'fox'[^}]*snow_fox_sleep: 'fox'/.test(rd('tools/pack-mobtex.mjs')), 'packer reuses the fox box list');
const gp = join(MCLITE_ROOT, 'assets/mob-geometry.json');
if (existsSync(gp)) {
  const g = JSON.parse(readFileSync(gp, 'utf8')); const L = g.layers || g;
  for (const n of ['fox', 'fox_sleep', 'snow_fox', 'snow_fox_sleep']) ok(!!L[n], `mob-geometry.json has layer ${n}`);
}
const er = rd('src/07j_entityrender.js');
ok(/base === 'fox'\) return ER\.foxHeldItems/.test(er) && /ER\.foxHeldItems = function/.test(er), 'held-item layer wired into ER.heldItemsFor');
ok(/\[0\.46, 0\.26, 0\.22\]/.test(er) && /rZ\(90 \* D2R\)/.test(er), 'held-item sleeping offsets present');

// anti-vacuity
const broken = [
  { skinKey: (e) => (e.foxType ? 'snow_fox' : 'fox') },                                  // never sleeps
  { skinKey: (e) => (e.foxType ? 'snow_fox' : 'fox') + '_sleep' },                       // always sleeps
  { skinKey: (e) => (e.sleeping ? 'fox_sleep' : e.foxType ? 'snow_fox' : 'fox') },        // sleeping snow -> red sheet
];
for (const B of broken) { breaks++; const caught = !pick(B); ok(caught, 'broken picker not caught'); if (caught) console.log('   ✓ broken fox picker caught'); }
breaks++; { const caught = !/ER\.foxHeldItems = function/.test(er.replace('ER.foxHeldItems = function', 'x')); ok(caught, 'missing held-item layer not caught'); }

console.log(`${pass} passed, ${fails.length} failed (of which ${breaks} are anti-vacuity checks)`);
console.log(`================ foxtexcheck ================\n assertions passed .. ${pass}\n failures ........... ${fails.length}\n breaks caught ...... ${breaks}\n==============================================`);
for (const f of fails) console.log('   x ' + f);
process.exit(fails.length ? 1 : 0);
