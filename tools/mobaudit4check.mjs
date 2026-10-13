#!/usr/bin/env node
// mobaudit4check.mjs — GATE M, layer L4 (COVERAGE RATCHET), #1506: every entity type of the roster must have an entry
// in the L1 (texl1check), L2 (uvl2check) and L3 (mobl3check) audit tables, or be counted as UNMAPPED.
//
//   node tools/mobaudit4check.mjs [--print]
//
// ROSTER  assets/entities.json `types` (every entity type the engine knows, 113 in 1.18.2).
// LAYERS  the engine model layers a type is drawn with: its own name if models.bin has that layer, the ALIAS list for
//         types whose layers are named per variant (pufferfish_*, tropical_fish_*), none for the sprite/particle/block
//         entities (arrow, item, painting, ...) which have no mob model at all.
// ENTRY   L1: every layer has a sheet in mob-tex.bin (texl1check compares every shipped sheet to the jar).
//         L2: every layer is in mob-geometry.json and not in tools/uvl2-known.json `unjoined` (uvl2check joins it).
//         L3: every layer is drawn by mobl3check (listed in a group of tools/mobl3-mobs.json).
// RATCHET tools/mobaudit4-known.json: `roster` is every type seen so far (a NEW type fails until it is added there,
//         i.e. until someone decides its audit entry); `maxUnmapped` per level may only go DOWN (a lower live count
//         fails until the ledger is lowered). Breaks (D-30): each corrupts one table and must be caught.
import { readFileSync, existsSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url)), A = join(ROOT, 'assets');
const PRINT = process.argv.includes('--print');
let pass = 0, caught = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else if (fails.length < 60) fails.push(m); return c; };
console.log('mobaudit4check — GATE M L4: every roster entity type has an L1/L2/L3 audit entry (ratchet)');
if (!existsSync(join(A, 'mob-tex.bin')) || !existsSync(join(A, 'entities.json'))) { console.log('mobaudit4check: SKIP — assets missing, run the build stages'); process.exit(0); }

const J = (p) => JSON.parse(readFileSync(p, 'utf8'));
const whole = inflateRawSync(readFileSync(join(A, 'mob-tex.bin')));
const H = JSON.parse(whole.subarray(4, 4 + whole.readUInt32LE(0)).toString('utf8'));
const geom = J(join(A, 'mob-geometry.json')).layers;
const models = JSON.parse(inflateRawSync(readFileSync(join(A, 'models.bin'))).toString('utf8')).layers;
const roster = Object.keys(J(join(A, 'entities.json')).types);
const uvKnown = J(join(ROOT, 'tools', 'uvl2-known.json')), l3 = J(join(ROOT, 'tools', 'mobl3-mobs.json')).mobs;
const known = J(join(ROOT, 'tools', 'mobaudit4-known.json'));
const ALIAS = { pufferfish: ['pufferfish_small', 'pufferfish_medium', 'pufferfish_big'], tropical_fish: ['tropical_fish_small', 'tropical_fish_large'] };

function audit(roster, T) {
  const res = { l1: [], l2: [], l3: [], nomodel: [], unmapped: { l1: [], l2: [], l3: [] } };
  for (const t of roster) {
    const layers = (ALIAS[t] || [t]).filter((l) => T.models[l]);
    if (!layers.length) res.nomodel.push(t);
    const e1 = layers.length > 0 && layers.every((l) => T.H.layers[l] != null);
    const e2 = layers.length > 0 && layers.every((l) => T.geom[l] && !(l in T.uvKnown.unjoined));
    const e3 = layers.length > 0 && layers.every((l) => Object.values(T.l3).some((g) => g.includes(l)));
    for (const [k, e] of [['l1', e1], ['l2', e2], ['l3', e3]]) (e ? res[k] : res.unmapped[k]).push(t);
  }
  return res;
}
const T0 = { H, geom, models, uvKnown, l3 };
const R = audit(roster, T0);
console.log(`roster ${roster.length} types: ${R.nomodel.length} without a mob model; unmapped L1 ${R.unmapped.l1.length}, L2 ${R.unmapped.l2.length}, L3 ${R.unmapped.l3.length}`);
if (PRINT) for (const k of ['l1', 'l2', 'l3']) console.log(`  unmapped ${k}: ${R.unmapped[k].join(' ')}`);

function ratchet(R, roster, K, tag) {
  const out = [];
  const seen = new Set(K.roster);
  for (const t of roster) if (!seen.has(t)) out.push(`${tag}NEW roster type ${t}: it has no L1/L2/L3 audit entry — give it one (tools/texl1check, uvl2check, tools/mobl3-mobs.json) or add it to tools/mobaudit4-known.json roster if it has no mob model`);
  for (const t of K.roster) if (!roster.includes(t)) out.push(`${tag}${t} left the roster — remove it from tools/mobaudit4-known.json`);
  for (const k of ['l1', 'l2', 'l3']) {
    const n = R.unmapped[k].length, max = K.maxUnmapped[k];
    if (n > max) out.push(`${tag}${n} roster types unmapped at ${k.toUpperCase()} (ratchet ${max}): ${R.unmapped[k].filter((t) => !K.unmappedAt[k].includes(t)).join(', ')}`);
    if (n < max) out.push(`${tag}only ${n} roster types unmapped at ${k.toUpperCase()}, ratchet is ${max} — lower maxUnmapped.${k} (and unmappedAt.${k}) in tools/mobaudit4-known.json`);
    for (const t of R.unmapped[k]) if (!K.unmappedAt[k].includes(t)) out.push(`${tag}${t} newly unmapped at ${k.toUpperCase()}`);
  }
  return out;
}
for (const f of ratchet(R, roster, known, '')) ok(false, f);
// the tables are the engine's: the complained mobs are audited at L1+L2 and the L3 groups resolve to roster types
for (const t of ['chicken', 'sheep', 'wolf', 'pig', 'cat', 'fox', 'panda', 'squid']) ok(!R.unmapped.l1.includes(t) && !R.unmapped.l2.includes(t), `${t} lost its L1/L2 entry`);
for (const t of ['chicken', 'sheep', 'wolf', 'pig', 'cat', 'fox', 'panda', 'squid', 'strider', 'cod', 'salmon', 'pufferfish', 'tropical_fish']) ok(R.l3.includes(t), `${t} is not resolved by the L3 table`);

// ── anti-vacuity: corrupt one input, the ratchet must report
const clone = (x) => JSON.parse(JSON.stringify(x));
const BREAKS = [
  ['a new mob type with no entry', () => ratchet(audit([...roster, 'warden'], T0), [...roster, 'warden'], known, '')],
  ['a roster type dropped from the L3 table', () => { const l = clone(l3); delete l.sheep; return ratchet(audit(roster, { ...T0, l3: l }), roster, known, ''); }],
  ['a layer dropped from the L2 geometry', () => { const g = clone(geom); delete g.wolf; return ratchet(audit(roster, { ...T0, geom: g }), roster, known, ''); }],
  ['a layer whose sheet is missing at L1', () => { const h = { layers: { ...H.layers } }; delete h.layers.cow; return ratchet(audit(roster, { ...T0, H: h }), roster, known, ''); }],
  ['a stale ratchet (an audited mob still listed unmapped)', () => { const k = clone(known); k.maxUnmapped.l3 += 1; k.unmappedAt.l3.push('sheep'); return ratchet(R, roster, k, ''); }],
  ['a type removed from the roster', () => ratchet(audit(roster.slice(1), T0), roster.slice(1), known, '')],
];
for (const [name, fn] of BREAKS) { const r = fn(); if (r.length) { caught++; console.log(`  ✓ break caught: ${name}`); } else ok(false, `break NOT caught: ${name}`); }
console.log(`${caught} breaks caught`);
for (const f of fails) console.log(`  ✗ ${f}`);
console.log(` assertions passed .... ${pass}`);
console.log(` failures ........... ${fails.length}`);
process.exit(fails.length ? 1 : 0);
