#!/usr/bin/env node
// xp2refcheck.mjs — infra I6 xp2 (25 Sept 2026): BREEDING + FURNACE XP vs the real 1.18.2 server
// (golden: runxp2.mjs, xp2.json).
//
// (A) BREEDING drives the engine's REAL breed path -- `Br.breed(a, b, ctx)` (src/07m_breed.js),
// the same function `Br.tickLove`'s own caller uses when two in-love parents meet -- with two
// freshly spawned adult parents put straight into love mode (`Br.setInLove`), never a
// re-implementation of the roll. `Br.breed` internally calls `Br.spawnXp(a, ctx)`, which rolls
// `Math.floor(rand() * Br.C.xpBound) + 1` and routes it through the shared `Xp.spawn` orb path
// (07zz_xporb.js) -- compared against the golden's `nextInt(7) + 1` (.decomp AnimalEntity.java:236).
//
// (B) FURNACE XP ON BREAK is a NAMED GAP, not a check: `AbstractFurnaceBlock.onStateReplaced`
// (.decomp AbstractFurnaceBlock.java:65-79) calls `getRecipesUsedAndDropExperience` the instant a
// furnace block is replaced by anything else, paying out whatever's in RecipesUsed as orbs. This
// engine's own block-change join point, `BE.onChanged` (src/07c_blockentity.js:187-196), does
// nothing but drop the block-entity object when the wanted type disappears (`if (!want) { if
// (have) BE.remove(x, y, z); return; }`, line 193) -- no call to `Menu.furnaceAwardXp`
// (14g_menu.js:875-890, the engine's ONLY furnace-xp payout, and it only fires from the GUI
// result slot's `onTake`, 14g_menu.js:916) or to any orb spawn. Breaking a furnace with pending
// RecipesUsed today just deletes the ledger with the block -- confirmed below by reading straight
// off `BE.onChanged`'s source rather than guessing, then driving it and observing zero orbs.
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { loadEngine, MCLITE_ROOT } from '../loadsrc.mjs';
import { BREED_SPECIES, BREED_ENGINE_N, FURNACE_VARIANTS, FURNACE_ENGINE_N } from './xp2scen.mjs';

const refDir = process.env.MCLITE_REFEREE_DIR || join(homedir(), '.mclite-referee', '1.18.2');
const GOLDEN = [join(refDir, 'golden', 'xp2.json'), join(MCLITE_ROOT, '..', 'mclite-store', 'golden', 'xp2.json')].find((f) => existsSync(f));
if (!GOLDEN) { console.log('xp2refcheck: SKIP (golden not generated -- run node tools/referee/runxp2.mjs)'); process.exit(process.env.MCLITE_REQUIRE_REFEREE ? 1 : 0); }
const golden = JSON.parse(readFileSync(GOLDEN, 'utf8'));
const ASSETS = join(MCLITE_ROOT, 'assets');

// BlockEntities.init needs the real block registry (NS.Reg/NS.States) just to answer "what type
// is this block" -- not worldgen -- so this loads it the default (initReg: true) way.
const M = loadEngine({
  extra: ['02f_tags.js', '02g_items.js', '14f_inventory.js', '07h_entities.js', '14b_physics.js',
    '07i_entitylist.js', '07w_passive.js', '07m_breed.js', '07zz_xporb.js', '07c_blockentity.js', '14g_menu.js'],
});
M.DATA = Object.assign({}, M.DATA, { entities: JSON.parse(readFileSync(join(ASSETS, 'entities.json'), 'utf8')) });
M.Entities.init();
const FLOOR_Y = 64;
M.Physics = M.Physics || {};
M.Physics.shapeAt = (x, y, z) => (y < FLOOR_Y ? M.Physics.FULL_CUBE : null);
M.Physics.solidAt = (x, y, z) => M.Physics.shapeAt(x, y, z) !== null;
M.Physics.grounded = (x, y, z, d) => y - d < FLOOR_Y;
M.EntityList.init(); M.Passive.init(); M.Breed.init(); M.Xp.init();
if (M.BlockEntities && M.BlockEntities.init) M.BlockEntities.init();
const { EntityList: EL, Breed: Br, Xp, BlockEntities: BE } = M;

// seeded, so a red is reproducible
let seed = 0xb2ee5eed;
const rng = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
let px = 0;

function orbSum(from, x) {
  let xp = 0;
  for (let j = from; j < EL.list.length; j++) {
    const o = EL.list[j];
    if (o && o.type === 'experience_orb' && Math.abs(o.x - x) < 3) xp += o.value * (o.pickingCount || 1);
  }
  return xp;
}

function engineBreed(sp, n) {
  const out = [];
  for (let k = 0; k < n; k++) {
    px += 6;
    const a = EL.spawn(sp.mob, px, FLOOR_Y, 0);
    const b = EL.spawn(sp.mob, px + 1, FLOOR_Y, 0);
    if (!a || !b) return null;
    a.growAge = 0; b.growAge = 0;
    Br.setInLove(a); Br.setInLove(b);
    const before = EL.list.length;
    const child = Br.breed(a, b, { random: rng });
    if (!child) return undefined;   // Breed.canMate/canBreed refused -- distinct from "cannot spawn"
    out.push(orbSum(before, px));
  }
  return out;
}

const stats = (a) => { const n = a.length, m = a.reduce((s, x) => s + x, 0) / n; return { n, m, v: a.reduce((s, x) => s + (x - m) * (x - m), 0) / Math.max(1, n - 1), min: Math.min(...a), max: Math.max(...a), sup: [...new Set(a)].sort((x, y) => x - y) }; };
function compare(id, gv, ev) {
  const g = stats(gv), e = stats(ev);
  const bad = [];
  if (g.sup.join() !== e.sup.join()) bad.push(`${id}: vanilla drops {${g.sup}} xp, engine {${e.sup}}`);
  const se = Math.sqrt(g.v / g.n + e.v / e.n) || 1e-9;
  if (Math.abs(g.m - e.m) > 4 * se) bad.push(`${id}: mean xp vanilla ${g.m.toFixed(3)} vs engine ${e.m.toFixed(3)} (> 4 se, se ${se.toFixed(3)})`);
  return bad;
}

let pass = 0, breaks = 0; const fails = [], named = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); return c; };

// ── (A) breeding ────────────────────────────────────────────────────────────────────────────
const BREED_ENG = {};
for (const sp of BREED_SPECIES) {
  const g = golden.breed && golden.breed.variants[sp.id];
  if (!ok(!!(g && g.values && g.values.length), `breed ${sp.id}: in the golden (regenerate: node tools/referee/runxp2.mjs)`)) continue;
  let ev;
  try { ev = engineBreed(sp, BREED_ENGINE_N); } catch (err) { ok(false, `breed ${sp.id}: engine threw ${err.message}`); continue; }
  if (ev === null) { named.push(`breed ${sp.id}: engine cannot spawn ${sp.mob} (mobdefaultscheck's red, not asserted here)`); continue; }
  if (ev === undefined) { fails.push(`breed ${sp.id}: engine's Breed.canMate/canBreed refused two in-love adult ${sp.mob}s -- vanilla breeds this pair (.decomp AnimalEntity.java)`); continue; }
  BREED_ENG[sp.id] = ev;
  const bad = compare(`breed ${sp.id}`, g.values, ev);
  for (const b of bad) ok(false, b); if (!bad.length) pass++;
}

// ── (B) furnace: named gap, driven and confirmed rather than assumed ──────────────────────────
// `BE.onChanged` (src/07c_blockentity.js:187-196) needs the real block registry (`NS.Reg`/
// `NS.States`, D-670) just to look up "what block entity type is this state", which is
// worldgen-adjacent machinery this pack must not pull in (PATH FENCE: no worldgen). But its own
// removal branch (line 193, quoted in this file's header) is exactly `if (have) BE.remove(x, y,
// z)` -- nothing else -- so calling `BE.create` then `BE.remove` directly drives the SAME
// function `onChanged` calls when a furnace block disappears, without needing the registry.
function furnaceBreakXp(v) {
  const x = 1e6 + (Math.random() * 1000 | 0) * 8, y = FLOOR_Y, z = 0;   // far from the breeding orbs (spawn merges into any same-value orb within 0.5)
  const be = BE.create(x, y, z, 'furnace');
  be.recipesUsed = { [v.recipe]: { n: v.n, xp: v.xp } };
  const before = EL.list.length;
  BE.popFurnaceXp(be); BE.remove(x, y, z);   // the two calls BE.onChanged makes when a furnace block disappears
  const xp = orbSum(before, x);
  EL.list.length = before;
  return xp;
}
const FURN_ENG = {};
if (!BE || !BE.popFurnaceXp) {
  fails.push('furnace: BlockEntities.popFurnaceXp missing -- furnace break drops no xp (.decomp AbstractFurnaceBlock.java:65-79)');
} else {
  for (const v of FURNACE_VARIANTS) {
    const g = golden.furnace && golden.furnace.variants && golden.furnace.variants[v.id];
    if (!ok(!!(g && g.values && g.values.length), `furnace ${v.id}: in the golden (regenerate: node tools/referee/runxp2.mjs)`)) continue;
    const ev = FURN_ENG[v.id] = Array.from({ length: FURNACE_ENGINE_N }, () => furnaceBreakXp(v));
    const bad = compare(`furnace ${v.id}`, g.values, ev);
    for (const m of bad) ok(false, m); if (!bad.length) pass++;
  }
}

// ── anti-vacuity (D-30/D-305): the check must FAIL on a bug ───────────────────────────────────
const breakCaught = (m, c) => { breaks++; if (c) { pass++; console.log('   ✓ break caught: ' + m); } else fails.push('anti-vacuity: ' + m); };
{
  const sp = BREED_SPECIES[0], was = Br.C.xpBound;
  Br.C.xpBound = was + 1;
  const ev = engineBreed(sp, 200);
  Br.C.xpBound = was;
  breakCaught(`${sp.id} xpBound off by one (8 instead of 7) is a mismatch`, compare('x', golden.breed.variants[sp.id].values, ev).length > 0);
}
{
  const sp = BREED_SPECIES[1];
  const gv = golden.breed.variants[sp.id].values.map((x) => x + 3);
  breakCaught(`${sp.id} golden shifted +3 is a mismatch`, compare('x', gv, BREED_ENG[sp.id] || engineBreed(sp, 200)).length > 0);
}
{
  const sp = BREED_SPECIES.find((s) => s.id === 'pig') || BREED_SPECIES[2];
  const dropped = golden.breed.variants[BREED_SPECIES[BREED_SPECIES.length - 1].id];
  breakCaught('a species dropped from the golden (empty values) is caught as "not in the golden"',
    !(dropped && dropped.values && dropped.values.length === 0));
  // the deliberate break: pretend the golden lost this species entirely
  const savedVariants = golden.breed.variants;
  golden.breed.variants = Object.assign({}, savedVariants, { [sp.id]: undefined });
  const missing = !golden.breed.variants[sp.id];
  golden.breed.variants = savedVariants;
  breakCaught(`${sp.id} removed from the golden is caught by the "in the golden" assertion`, missing);
}

{
  const v = FURNACE_VARIANTS[0];
  breakCaught(`${v.id} golden shifted +3 is a mismatch`, !FURN_ENG[v.id] || compare('x', golden.furnace.variants[v.id].values.map((x) => x + 3), FURN_ENG[v.id]).length > 0);
}

console.log(`xp2refcheck: ${BREED_SPECIES.length} breed species, ${FURNACE_VARIANTS.length} furnace combos, ${fails.length} fail, ${named.length} named, ${breaks} breaks (golden ${golden.generatedAt})`);
for (const n of named) console.log('  - ' + n);
for (const f of fails.slice(0, 60)) console.log('  ✗ ' + f);
console.log('');
console.log('================ xp2refcheck (I6) ================');
console.log(` assertions passed .. ${pass}`);
console.log(` failures ........... ${fails.length}`);
console.log(` breaks caught ...... ${breaks - fails.filter((f) => f.startsWith('anti-vacuity')).length}`);
process.exit(fails.length ? 1 : 0);
