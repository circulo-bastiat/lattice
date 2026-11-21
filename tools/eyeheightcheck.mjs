#!/usr/bin/env node
// eyeheightcheck.mjs -- #1973: Cb.eyeHeightOf vs every .decomp getActiveEyeHeight override (adult + baby).
// Expected values are the literals/factors of each .decomp class (cited per row); the check also breaks its own
// table and the engine's to prove it can fail.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, initRegistry, ASSETS } from './loadsrc.mjs';
const M = loadEngine({ extra: ['07m_breed.js', '07h_entities.js', '07j_entityrender.js', '14j_combat.js'], dom: false });
const Cb = M.Combat;
const f = Math.fround;
// #8758 ER.eyeHeightStanding (nameplate) must equal Cb.eyeHeightOf for every entity type
initRegistry(M);
M.DATA = Object.assign({}, M.DATA, { entities: JSON.parse(readFileSync(join(ASSETS, 'entities.json'), 'utf8')) });
M.Entities.init();
const erFails = []; let erN = 0;
const erCmp = (ER) => { erFails.length = 0; erN = 0;
  for (const t of Object.keys(M.Entities.types || {})) {
    const h = M.Entities.height(t); if (h == null) continue; erN++;
    const a = ER.eyeHeightStanding(t), b = M.Combat.eyeHeightOf({ type: t, height: h, growAge: 0 });
    if (Math.abs(a - b) > 1e-6) erFails.push(`ER.eyeHeightStanding(${t}) ${a} != Cb ${b}`);
  } };
// [type, height, adult expected, baby height, baby expected]  (f(h*k) where the .decomp says height*k)
const T = [
  ['cave_spider', 0.5, 0.45], ['spider', 0.9, 0.65], ['enderman', 2.9, 2.55], ['ghast', 4, 2.6], ['shulker', 1, 0.5],
  ['witch', 1.95, 1.62], ['silverfish', 0.3, 0.13], ['endermite', 0.3, 0.13],
  ['piglin', 1.95, 1.74, 0.99, 0.93], ['piglin_brute', 1.95, f(1.95 * 0.85)],
  ['villager', 1.95, 1.62, 0.975, 0.81], ['wandering_trader', 1.95, 1.62, 0.975, 0.81],
  ['fox', 0.7, 0.4, 0.35, f(0.35 * 0.85)], ['cow', 1.4, 1.3, 0.7, f(0.7 * 0.95)], ['mooshroom', 1.4, 1.3, 0.7, f(0.7 * 0.95)],
  ['chicken', 0.7, f(0.7 * 0.92), 0.35, f(0.35 * 0.85)],
  ['cod', 0.3, f(0.3 * 0.65)], ['salmon', 0.4, f(0.4 * 0.65)], ['pufferfish', 0.7, f(0.7 * 0.65)], ['tropical_fish', 0.4, f(0.4 * 0.65)],
  ['slime', 2.04, f(2.04 * 0.625)], ['magma_cube', 2.04, f(2.04 * 0.625)],
  ['squid', 0.8, f(0.8 * 0.5)], ['glow_squid', 0.8, f(0.8 * 0.5)], ['guardian', 0.85, f(0.85 * 0.5)], ['elder_guardian', 1.9975, f(1.9975 * 0.5)],
  ['bee', 0.6, f(0.6 * 0.5)], ['wolf', 0.85, f(0.85 * 0.8)], ['sheep', 1.3, f(1.3 * 0.95)], ['axolotl', 0.42, f(0.42 * 0.655)],
  ['bat', 0.9, f(0.9 / 2)], ['parrot', 0.9, f(0.9 * 0.6)],
  ['horse', 1.6, f(1.6 * 0.95)], ['donkey', 1.5, f(1.5 * 0.95)], ['mule', 1.6, f(1.6 * 0.95)], ['llama', 1.87, f(1.87 * 0.95)],
  ['skeleton_horse', 1.6, f(1.6 * 0.95)], ['zombie_horse', 1.6, f(1.6 * 0.95)],
  ['zombie', 1.95, 1.74, 0.975, 0.93], ['skeleton', 1.99, 1.74], ['wither_skeleton', 2.4, 2.1], ['phantom', 0.5, f(0.5 * 0.35)],
  ['pig', 0.9, f(0.9 * 0.85)],   // no override: Entity default
];
let pass = 0, breaks = 0; const fails = [];
const run = (name, h, want, baby) => {
  const got = Cb.eyeHeightOf({ type: name, height: h, growAge: baby ? -24000 : 0 });
  if (Math.abs(got - f(want)) < 1e-6) pass++; else fails.push(`${name}${baby ? ' (baby)' : ''}: ${got} != ${f(want)}`);
};
for (const [n, h, w, bh, bw] of T) { run(n, h, w, false); if (bw !== undefined) run(n, bh, bw, true); }
// anti-vacuity: perturbed engine table / expectation must be seen
const saved = Cb.EYE_FIXED.spider; Cb.EYE_FIXED.spider = 0.765;
const g = Cb.eyeHeightOf({ type: 'spider', height: 0.9, growAge: 0 });
if (Math.abs(g - 0.65) > 1e-6) { breaks++; console.log("  ✓ mutant caught: broken spider row"); } else fails.push('anti-vacuity: broken spider row not caught');
Cb.EYE_FIXED.spider = saved;
if (Math.abs(Cb.eyeHeightOf({ type: 'cave_spider', height: 0.5, growAge: 0 }) - 0.425) > 1e-6) { breaks++; console.log("  ✓ mutant caught: height*0.85 fallback"); } else fails.push('anti-vacuity: height*0.85 would pass');
erCmp(M.EntityRender);
if (erN < 80) fails.push('ER compare covered only ' + erN + ' types');
erFails.forEach((x) => fails.push(x));
{ const orig = M.EntityRender.eyeHeightStanding; M.EntityRender.eyeHeightStanding = (t) => M.Entities.height(t) * 0.85;
  erCmp({ eyeHeightStanding: M.EntityRender.eyeHeightStanding }); M.EntityRender.eyeHeightStanding = orig;
  if (erFails.length) { breaks++; console.log('  ✓ mutant caught: ER height*0.85 formula'); } else fails.push('anti-vacuity: ER 0.85 formula passes'); }
console.log(`OK  ${pass} checks passed, ${fails.length} failures; eyeHeightOf matches every .decomp getActiveEyeHeight; ${breaks} breaks caught`);
if (fails.length) { fails.forEach((x) => console.log('  ✗ ' + x)); process.exit(1); }
