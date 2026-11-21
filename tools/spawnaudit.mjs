#!/usr/bin/env node
// spawnaudit.mjs — GATE M (#1535), class SPAWN RULES. Every spawn-list entry the vanilla server data carries (biome
// `spawners` per category, structure `spawn_overrides`) against what the engine holds (`Biomes.spawners`,
// `Structures.defs[*].spawnOverrides`: type, weight, minCount, maxCount), and every mob those lists can name against
// the placement rule table (`Spawn.RULES` via `Spawn.canPlace`) and its `Spawn.LOCATION` (vs SpawnRestriction in .decomp).
//
//   node tools/spawnaudit.mjs [--print] [--write]   (--write regenerates the ledger: only to LOWER it)
//
// Keys `where|status|detail`: missing/extra (entry), value (weight/min/max), norule (listed mob has no Spawn.RULES),
// loc (Spawn.LOCATION differs from the decomp). Ledger tools/spawnaudit-known.json may only shrink.
import { readFileSync, existsSync, readdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEngine } from './loadsrc.mjs';
import { MCDATA } from './paths.mjs';
import { parseSpawnLocations, readDecomp, decompPresent } from './spawnloc-decomp.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PRINT = process.argv.includes('--print');
console.log('spawnaudit — GATE M spawn rules: vanilla spawn lists + SpawnRestriction vs the engine (ratchet)');
const WG = join(MCDATA, '1.18.2', 'data', 'minecraft', 'worldgen');
if (!existsSync(join(ROOT, 'assets', 'entities.json')) || !existsSync(join(WG, 'biome')) || !decompPresent()) { console.log('spawnaudit: SKIP — assets, .mcdata or .decomp missing'); process.exit(process.env.MCLITE_REQUIRE_REFEREE ? 1 : 0); }

const MODS = []; for (const m of readFileSync(join(ROOT, 'build.mjs'), 'utf8').matchAll(/'(07[0-9a-z_]+\.js)'/g)) if (!MODS.includes(m[1])) MODS.push(m[1]);
const M = loadEngine({ dom: true, extra: ['14b_physics.js', '07_world.js'].concat(MODS.filter((f) => f !== '07_world.js')) });
const ENT = JSON.parse(readFileSync(join(ROOT, 'assets', 'entities.json'), 'utf8'));
M.DATA = Object.assign({}, M.DATA, { entities: ENT });
M.Entities.init(); M.EntityList.init();
M.Gen.init(1, Object.assign(M.Gen.defaults(), { climate: 'vanilla' }));
const B = M.Biomes, ST = M.Structures;
const jd = (d) => Object.fromEntries(readdirSync(join(WG, d)).filter((f) => f.endsWith('.json')).map((f) => [f.slice(0, -5), JSON.parse(readFileSync(join(WG, d, f), 'utf8'))]));
const bare = (t) => String(t).replace(/^minecraft:/, '');
// a spawn list -> Map "category|type|weight|min|max" signature rows
const flat = (sp) => { const o = {}; for (const c of Object.keys(sp || {})) for (const e of (Array.isArray(sp[c]) ? sp[c] : (sp[c].spawns || []))) { const k = `${c}|${bare(e.type)}`; o[k] = `${e.weight}/${e.minCount}/${e.maxCount}`; } return o; };

// ── golden ───────────────────────────────────────────────────────────────────────────────────
const gBiome = jd('biome'), gStruct = jd('configured_structure_feature');
const golden = new Map();   // "where|category|type" -> w/min/max
for (const [n, j] of Object.entries(gBiome)) { const f = flat(j.spawners); for (const k in f) golden.set(`biome:${n}|${k}`, f[k]); }
for (const [n, j] of Object.entries(gStruct)) for (const c of Object.keys(j.spawn_overrides || {})) {
  golden.set(`struct:${n}|${c}|-`, '-');   // marks the override itself (an empty list still wins)
  for (const e of j.spawn_overrides[c].spawns) golden.set(`struct:${n}|${c}|${bare(e.type)}`, `${e.weight}/${e.minCount}/${e.maxCount}`);
}
const locG = parseSpawnLocations(readDecomp()).table;

// ── engine ───────────────────────────────────────────────────────────────────────────────────
const engine = new Map();
for (let i = 0; i < B.count; i++) { const f = flat(B.spawners(i)); for (const k in f) engine.set(`biome:${bare(B.name(i))}|${k}`, f[k]); }
for (const n of Object.keys(ST.defs)) { const ov = ST.defs[n].spawnOverrides; if (!ov) continue;
  for (const c of Object.keys(ov)) { engine.set(`struct:${n}|${c}|-`, '-'); for (const e of ov[c].spawns) engine.set(`struct:${n}|${c}|${bare(e.type)}`, `${e.weight}/${e.minCount}/${e.maxCount}`); } }
const canPlace = (t) => M.Spawn.canPlace(t);
const locE = (t) => M.Spawn.locationOf(t);

function audit(golden, engine, canPlace, locE, locG) {
  const keys = new Set(); let rows = 0, okRows = 0; const mobs = new Set();
  for (const [k, v] of golden) { rows++; const e = engine.get(k); if (e === undefined) keys.add(`${k}|missing`); else if (e !== v) keys.add(`${k}|value`); else okRows++; if (!k.endsWith('|-')) mobs.add(k.split('|')[2]); }
  for (const k of engine.keys()) if (!golden.has(k)) keys.add(`${k}|extra`);
  for (const t of [...mobs].sort()) {
    rows++; if (canPlace(t)) okRows++; else keys.add(`${t}|norule`);
    rows++; if (locE(t) === (locG[t] || 'none')) okRows++; else keys.add(`${t}|loc`);
  }
  return { keys, rows, okRows, mobs };
}
const R = audit(golden, engine, canPlace, locE, locG);
console.log(`${golden.size} golden spawn rows, ${R.mobs.size} listed mobs: ${R.rows} checks, ${R.okRows} ok, ${R.keys.size} ledger keys`);
if (PRINT) for (const k of [...R.keys].sort()) console.log('  ' + k);

// ── ratchet ──────────────────────────────────────────────────────────────────────────────────
let pass = 0, caught = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else if (fails.length < 80) fails.push(m); return c; };
const KP = join(ROOT, 'tools/spawnaudit-known.json');
const known = existsSync(KP) ? JSON.parse(readFileSync(KP, 'utf8')) : { keys: [] };
function ratchet(keys, K) {
  const out = [], ks = new Set(K.keys);
  for (const k of keys) if (!ks.has(k)) out.push('NEW ' + k);
  for (const k of ks) if (!keys.has(k)) out.push('GONE ' + k + ' — fixed: delete it from tools/spawnaudit-known.json');
  return out;
}
if (process.argv.includes('--write')) { writeFileSync(KP, JSON.stringify({ _: 'spawnaudit ledger (#1535): where|category|type|status keys that differ from vanilla; may only shrink', keys: [...R.keys].sort() }, null, 1) + '\n'); console.log('wrote ' + KP); process.exit(0); }
for (const f of ratchet(R.keys, known)) ok(false, f);
ok(golden.size >= 300, 'at least 300 golden spawn rows (got ' + golden.size + ')');
ok(golden.get('biome:plains|creature|horse') === '5/2/6' && golden.get('biome:plains|monster|zombie') === '95/4/4', 'golden anchors (plains horse 5/2/6, zombie 95/4/4)');
ok(golden.has('struct:monument|monster|guardian') && golden.has('struct:swamp_hut|creature|-'), 'golden structure overrides present');

// ── break proof ──────────────────────────────────────────────────────────────────────────────
const mm = (m, f) => { const n = new Map(m); f(n); return n; };
const A = (g, e, cp, le, lg) => ratchet(audit(g, e, cp || canPlace, le || locE, lg || locG).keys, known);
const BREAKS = [
  ['a biome weight changes', () => A(golden, mm(engine, (n) => n.set('biome:plains|monster|zombie', '1/4/4')))],
  ['a biome entry removed', () => A(golden, mm(engine, (n) => n.delete('biome:plains|creature|horse')))],
  ['an engine-only entry appears', () => A(golden, mm(engine, (n) => n.set('biome:plains|monster|ghast', '1/1/1')))],
  ['a structure override removed', () => A(golden, mm(engine, (n) => n.delete('struct:monument|monster|guardian')))],
  ['a listed mob loses its rule', () => A(golden, engine, (t) => t !== 'zombie' && canPlace(t))],
  ['a location differs', () => A(golden, engine, null, (t) => t === 'cow' ? 'in_water' : locE(t))],
  ['a golden group size changes', () => A(mm(golden, (n) => n.set('biome:plains|creature|horse', '5/2/7')), engine)],
  ['a stale ledger entry', () => ratchet(R.keys, { keys: known.keys.concat('biome:plains|monster|zombie|value') })],
];
for (const [label, f] of BREAKS) { const r = f(); if (ok(r.length > 0, 'break not caught: ' + label)) { caught++; console.log(' ✓ ' + label + ': ' + r[0]); } }

if (fails.length) { console.log('\nFAIL (' + fails.length + '):'); fails.slice(0, 40).forEach((f) => console.log(' x ' + f)); }
console.log(`\nspawnaudit: ${pass} assertions, ${fails.length} failures, ${caught} breaks caught`);
process.exit(fails.length ? 1 : 0);
