#!/usr/bin/env node
// extract-entity-static-src.mjs — G17b-6 (#206): entities with NO gravity, and the reason for each.
//
//   node tools/extract-entity-static-src.mjs [--selftest]  -> tools/golden/entity-motion-static-1.18.2.tsv
//
// Runs from `.decomp/` only (like extract-entity-motion-src.mjs). Each row is [0, 1] — "nothing pushes
// this down" — and its 5th column names WHICH proof admitted it, so EL.owed() can list these as
// "no motion" rather than "refused". D-309: override tests on name+descriptor and on the UNCONDITIONAL
// tick path, never a naive superclass walk. Three proofs:
//   entity-direct  chain reaches `Entity` without ever passing LivingEntity, and no class in it declares
//                  travel() or moves itself (`this.move(`/`setVelocity(`); the decorations' own move()/
//                  addVelocity() overrides only KILL the entity (AbstractDecorationEntity).
//   own-travel     LivingEntity subclass that DECLARES travel(Vec3d) (player): its motion is that law, not a
//                  generic gravity row, so it has none for EL to simulate.
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DECOMP = join(ROOT, '.decomp', 'net', 'minecraft', 'entity');
const OUT = join(ROOT, 'tools', 'golden', 'entity-motion-static-1.18.2.tsv');

export const TYPES = [
  ['painting', 'PaintingEntity', 'entity-direct'], ['item_frame', 'ItemFrameEntity', 'entity-direct'],
  ['glow_item_frame', 'GlowItemFrameEntity', 'entity-direct'], ['leash_knot', 'LeashKnotEntity', 'entity-direct'],
  ['area_effect_cloud', 'AreaEffectCloudEntity', 'entity-direct'], ['marker', 'MarkerEntity', 'entity-direct'],
  ['lightning_bolt', 'LightningEntity', 'entity-direct'], ['end_crystal', 'EndCrystalEntity', 'entity-direct'],
  ['evoker_fangs', 'EvokerFangsEntity', 'entity-direct'],
  ['player', 'PlayerEntity', 'own-travel'],
];

const files = new Map();
(function walk(d) {
  for (const f of readdirSync(d)) {
    const p = join(d, f);
    if (statSync(p).isDirectory()) walk(p); else if (f.endsWith('.java')) files.set(f.slice(0, -5), p);
  }
})(DECOMP);
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
const real = (c) => (files.has(c) ? strip(readFileSync(files.get(c), 'utf8')) : null);

const chainOf = (cls, read) => {
  const chain = [];
  for (let c = cls, h = 0; c && h < 24; h++) {
    chain.push(c);
    if (c === 'Entity') break;
    const src = read(c);
    if (src == null) return { chain, err: `no source for ${c}` };
    const m = /\bclass\s+\w+(?:<[^>]*>)?\s+extends\s+(\w+)/.exec(src);
    if (!m) return { chain, err: `${c} has no superclass` };
    c = m[1];
  }
  return { chain };
};

export function prove(cls, kind, read = real) {
  const { chain, err } = chainOf(cls, read);
  if (err) return { ok: false, reason: err };
  if (kind === 'entity-direct') {
    if (chain.includes('LivingEntity')) return { ok: false, reason: `${cls} reaches LivingEntity` };
    for (const c of chain) {
      if (c === 'Entity') continue;
      const s = read(c);
      if (/\bvoid\s+travel\s*\(\s*Vec3d\b/.test(s)) return { ok: false, reason: `${c} declares travel(Vec3d)` };
      if (/\bthis\.move\s*\(|\bsetVelocity\s*\(/.test(s)) return { ok: false, reason: `${c} moves itself` };
    }
    return { ok: true };
  }
  if (kind === 'own-travel') {
    if (!chain.includes('LivingEntity')) return { ok: false, reason: `${cls} is not a LivingEntity` };
    return /\bvoid\s+travel\s*\(\s*Vec3d\b/.test(read(cls)) ? { ok: true } : { ok: false, reason: `${cls} declares no travel(Vec3d)` };
  }
  return { ok: false, reason: 'unknown kind ' + kind };
}

export function run(types = TYPES, read = real) {
  const rows = [], refused = [];
  for (const [n, cls, kind] of types) {
    const r = prove(cls, kind, read);
    if (r.ok) rows.push([n, cls, 0, 1, `static:${kind}-G17b-6`]); else refused.push(`${n}: ${r.reason}`);
  }
  return { rows, refused };
}

function selftest() {
  let bad = 0, caught = 0;
  const mut = (cls, kind, fn, why) => {
    const r = prove(cls, kind, (c) => { const t = real(c); return c === cls && t != null ? fn(t) : t; });
    if (!r.ok) caught++; else { bad++; console.log('FAIL break not caught: ' + why); }
  };
  const inject = (code) => (t) => t.replace(/\{/, '{\n' + code + '\n');
  const base = run();
  if (base.refused.length) { bad++; console.log('FAIL baseline refused: ' + base.refused.join('; ')); }
  mut('PaintingEntity', 'entity-direct', inject('void x(){ this.move(null, null); }'), 'entity-direct: self move');
  mut('MarkerEntity', 'entity-direct', inject('public void travel(Vec3d $$0) { }'), 'entity-direct: travel override');
  mut('EndCrystalEntity', 'entity-direct', (t) => t.replace(/extends\s+Entity/, 'extends LivingEntity'), 'entity-direct: chain hits LivingEntity');
  mut('PlayerEntity', 'own-travel', (t) => t.replace(/void\s+travel\s*\(/, 'void trav('), 'own-travel: no travel decl');
  // the wrong kind for a type must be refused too
  if (prove('ZombieEntity', 'entity-direct').ok) { bad++; console.log('FAIL zombie is not entity-direct'); } else caught++;
  console.log(`${caught} breaks caught${bad ? `, ${bad} FAILURES` : ''}`);
  return bad ? 1 : 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (!existsSync(DECOMP)) { console.log('SKIP - no .decomp'); process.exit(0); }
  if (process.argv.includes('--selftest')) process.exit(selftest());
  const { rows, refused } = run();
  writeFileSync(OUT, ['# entity-motion-static-1.18.2.tsv — generated by tools/extract-entity-static-src.mjs from .decomp (G17b-6, #206).',
    '# name\tclass\tgravity\tdrag\tsource   — types with NO gravity (row is [0, 1] = "no motion", not "refused"); source names the proof.',
    ...(refused.length ? ['# refused: ' + refused.join('; ')] : []), ...rows.map((r) => r.join('\t'))].join('\n') + '\n');
  console.log(`${rows.length} static rows, ${refused.length} refused`);
  refused.forEach((r) => console.log('  refused ' + r));
}
// ender_dragon (own tickMovement, never reaches travel) and wither are NOT here: FlightMoveControl(_, _, false) CLEARS noGravity when idle (FlightMoveControl.tick, read whole), so
// it is not provably gravity-free; EL.motionFor carries it already (cloud unit) and this file does not re-decide it.
