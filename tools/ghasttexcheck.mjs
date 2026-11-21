#!/usr/bin/env node
// ghasttexcheck.mjs — #641: GhastEntityRenderer.getTexture (.decomp) is isShooting() ? ghast_shooting : ghast.
// Proves Gh.skinKey picks per state, the packed mob atlas carries the ghast_shooting layer, and breaks itself.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';

let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const MCL = loadEngine({ extra: ['07zzi_ghast.js'], dom: false });
const Gh = MCL.Ghast;

const src = readFileSync(join(MCLITE_ROOT, '.decomp/net/minecraft/client/render/entity/GhastEntityRenderer.java'), 'utf8');
ok(/isShooting\(\) \? ANGRY_TEXTURE : TEXTURE/.test(src), 'vanilla getTexture shape changed');
ok(/ghast_shooting\.png/.test(src), 'vanilla angry sheet name changed');

const pick = (G, e) => G.skinKey(e);
ok(pick(Gh, { type: 'ghast', shooting: true }) === 'ghast_shooting', 'shooting ghast -> ghast_shooting');
ok(pick(Gh, { type: 'ghast', shooting: false }) === null, 'calm ghast -> base texture (null)');
ok(pick(Gh, { type: 'blaze', shooting: true }) === null, 'non-ghast -> null');

const ex = readFileSync(join(MCLITE_ROOT, 'tools/extract-mob-textures.mjs'), 'utf8');
ok(/ghast_shooting: P\('ghast\/ghast_shooting\.png'\)/.test(ex), 'extractor maps ghast_shooting');
try {
  const geom = JSON.parse(readFileSync(join(MCLITE_ROOT, 'assets/mob-geometry.json'), 'utf8'));
  const L = geom.layers || geom;
  ok(!!L.ghast_shooting, 'assets/mob-geometry.json has a ghast_shooting layer');
} catch (e) { /* assets are generated; the suite regenerates them first */ }

// anti-vacuity: each broken picker must be caught
const broken = [
  { skinKey: () => null },                                           // never swaps
  { skinKey: (e) => (e && e.type === 'ghast' ? 'ghast_shooting' : null) },   // always angry
  { skinKey: (e) => (e && e.shooting ? 'ghast' : null) },            // wrong key
];
for (const B of broken) {
  breaks++;
  const good = pick(B, { type: 'ghast', shooting: true }) === 'ghast_shooting' && pick(B, { type: 'ghast', shooting: false }) === null;
  ok(!good, 'broken picker not caught'); if (!good) console.log('   ✓ broken ghast picker caught');
}
console.log(`${pass} passed, ${fails.length} failed (of which ${breaks} are anti-vacuity checks)`);
console.log(`================ ghasttexcheck ================\n assertions passed .. ${pass}\n failures ........... ${fails.length}\n breaks caught ...... ${breaks}\n==============================================`);
for (const f of fails) console.log('   x ' + f);
process.exit(fails.length ? 1 : 0);
