#!/usr/bin/env node
// spawnproofcheck (#7525): spawn dimension of the mob proof. Per roster mob (tools/mobl3-mobs.json): every biome `spawners` row and
// structure `spawn_overrides` row naming it (weight, min/max group, category) from the vanilla worldgen data vs the engine's
// Biomes.spawners / Structures.defs, no engine-only rows, Spawn.canPlace rule present and Spawn.LOCATION == SpawnRestriction in .decomp.
// Oracle = .mcdata + .decomp. Writes tools/mobproof/out/spawn.json. Not covered (light/moon/y rules, caps, despawn, eggs/spawners,
// variants, equipment): other checks own those (spawnrulecheck, spawncapcheck, despawncheck, lockstep-spawn*) - listed per mob; ledger
// tools/spawnproof-known.json is shrink-only.
import { readFileSync, existsSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEngine } from './loadsrc.mjs';
import { MCDATA } from './paths.mjs';
import { parseSpawnLocations, readDecomp, decompPresent } from './spawnloc-decomp.mjs';

const T = dirname(fileURLToPath(import.meta.url)), ROOT = join(T, '..');
const WG = join(MCDATA, '1.18.2', 'data', 'minecraft', 'worldgen');
if (!existsSync(join(ROOT, 'assets', 'entities.json')) || !existsSync(join(WG, 'biome')) || !decompPresent()) { console.log('spawnproofcheck: SKIP — assets, .mcdata or .decomp missing'); process.exit(0); }
const roster = Object.keys(JSON.parse(readFileSync(join(T, 'mobl3-mobs.json'), 'utf8')).mobs);
const known = JSON.parse(readFileSync(join(T, 'spawnproof-known.json'), 'utf8'));

const MODS = []; for (const m of readFileSync(join(ROOT, 'build.mjs'), 'utf8').matchAll(/'(07[0-9a-z_]+\.js)'/g)) if (!MODS.includes(m[1])) MODS.push(m[1]);
const M = loadEngine({ dom: true, extra: ['14b_physics.js', '07_world.js'].concat(MODS.filter((f) => f !== '07_world.js')) });
M.DATA = Object.assign({}, M.DATA, { entities: JSON.parse(readFileSync(join(ROOT, 'assets', 'entities.json'), 'utf8')) });
M.Entities.init(); M.EntityList.init();
M.Gen.init(1, Object.assign(M.Gen.defaults(), { climate: 'vanilla' }));
const B = M.Biomes, ST = M.Structures;
const jd = (d) => Object.fromEntries(readdirSync(join(WG, d)).filter((f) => f.endsWith('.json')).map((f) => [f.slice(0, -5), JSON.parse(readFileSync(join(WG, d, f), 'utf8'))]));
const bare = (t) => String(t).replace(/^minecraft:/, '');
const flat = (sp) => { const o = {}; for (const c of Object.keys(sp || {})) for (const e of (Array.isArray(sp[c]) ? sp[c] : (sp[c].spawns || []))) o[`${c}|${bare(e.type)}`] = `${e.weight}/${e.minCount}/${e.maxCount}`; return o; };

const golden = new Map(), engine = new Map();
for (const [n, j] of Object.entries(jd('biome'))) { const f = flat(j.spawners); for (const k in f) golden.set(`biome:${n}|${k}`, f[k]); }
for (const [n, j] of Object.entries(jd('configured_structure_feature'))) for (const c of Object.keys(j.spawn_overrides || {}))
  for (const e of j.spawn_overrides[c].spawns) golden.set(`struct:${n}|${c}|${bare(e.type)}`, `${e.weight}/${e.minCount}/${e.maxCount}`);
for (let i = 0; i < B.count; i++) { const f = flat(B.spawners(i)); for (const k in f) engine.set(`biome:${bare(B.name(i))}|${k}`, f[k]); }
for (const n of Object.keys(ST.defs)) { const ov = ST.defs[n].spawnOverrides; if (!ov) continue;
  for (const c of Object.keys(ov)) for (const e of ov[c].spawns) engine.set(`struct:${n}|${c}|${bare(e.type)}`, `${e.weight}/${e.minCount}/${e.maxCount}`); }
const locG = parseSpawnLocations(readDecomp()).table;
const ruleE = (t) => M.Spawn.canPlace(t), locE = (t) => M.Spawn.locationOf(t);
const mobOf = (k) => k.split('|')[2];

// failed rows + checked count for one mob
function proveMob(mob, g = golden, e = engine, rule = ruleE, loc = locE) {
  const f = []; let n = 0, listed = false;
  for (const [k, v] of g) if (mobOf(k) === mob) { listed = true; n++; const x = e.get(k); if (x === undefined) f.push(`${k} missing (vanilla ${v})`); else if (x !== v) f.push(`${k} engine ${x} vanilla ${v}`); }
  for (const k of e.keys()) if (mobOf(k) === mob && !g.has(k)) { n++; f.push(`${k} engine-only`); }
  if (listed) {
    if (!rule(mob)) f.push(`${mob}: listed in a spawn table but no Spawn.RULES`);
    if (loc(mob) !== (locG[mob] || 'none')) f.push(`${mob}: location ${loc(mob)} != SpawnRestriction ${locG[mob] || 'none'}`);
    n += 2;
  }
  return { f, n, listed };
}

const out = {}; let bad = 0;
for (const mob of roster) {
  const r = proveMob(mob);
  out[mob] = { pass: r.f.length === 0, checked: [r.listed ? `${r.n} spawn rows/rules (biome+structure weight, group, category; rule; location)` : 'no vanilla biome/structure spawn row: engine has none either'],
    notCovered: known.notCovered, failed: r.f };
  for (const x of r.f) if (!known.failedRows.includes(x)) { bad++; console.log('NEW RED ' + mob + ': ' + x); }
}
const seen = new Set(Object.values(out).flatMap((o) => o.failed));
for (const x of known.failedRows) if (!seen.has(x)) { bad++; console.log('STALE known row (fixed? remove it): ' + x); }
for (const mob of roster) if (!out[mob]) { bad++; console.log('no row ' + mob); }
if (known.notCovered.length > known.max) { bad++; console.log('notCovered ledger grew'); }
mkdirSync(join(T, 'mobproof', 'out'), { recursive: true });
writeFileSync(join(T, 'mobproof', 'out', 'spawn.json'), JSON.stringify(out, null, 1));

let caught = 0;
const brk = (c, w) => { if (c) caught++; else { bad++; console.log('NOT CAUGHT ' + w); } };
const cp = (m, fn) => { const n = new Map(m); fn(n); return n; };
brk(proveMob('zombie', golden, cp(engine, (n) => n.set('biome:plains|monster|zombie', '1/4/4'))).f.length > 0, 'weight');
brk(proveMob('horse', golden, cp(engine, (n) => n.delete('biome:plains|creature|horse'))).f.length > 0, 'entry removed');
brk(proveMob('ghast', golden, cp(engine, (n) => n.set('biome:plains|monster|ghast', '1/1/1'))).f.length > 0, 'engine-only');
brk(proveMob('horse', cp(golden, (n) => n.set('biome:plains|creature|horse', '5/2/7'))).f.length > 0, 'group max');
brk(proveMob('zombie', golden, engine, (t) => t !== 'zombie' && ruleE(t)).f.length > 0, 'rule lost');
brk(proveMob('cow', golden, engine, ruleE, (t) => t === 'cow' ? 'in_water' : locE(t)).f.length > 0, 'location');
brk(proveMob('guardian', golden, cp(engine, (n) => n.delete('struct:monument|monster|guardian'))).f.length > 0, 'structure override removed');
console.log(bad ? `FAIL ${bad} bad (${roster.length} mobs)` : `spawnproofcheck: ${roster.length} mobs, ${caught} breaks caught`);
process.exit(bad ? 1 : 0);
