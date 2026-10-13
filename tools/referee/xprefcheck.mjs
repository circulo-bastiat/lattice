#!/usr/bin/env node
// xprefcheck.mjs — infra I6 (24 Sept 2026): MOB XP vs the real 1.18.2 server (golden: runxp.mjs, mob-xp.json).
// Per variant (xpscen.mjs: mob + NBT equipment/baby/size), the server's 100 per-kill sums (player-owned arrow kills, every
// orb's Value x Count in a glass well) against 400 engine kills through the engine's own death-xp path (`Cb.dropLoot` ->
// `Xp.dropMobXp`, 07zz_xporb.js, with playerHitTimer/attackingPlayer set exactly as Cb.notePlayerHit leaves them). A constant golden must be
// matched exactly; a spread golden by the SAME support (min..max, every value seen) and a mean within 4 standard errors.
// A variant the engine cannot spawn is NAMED, not asserted (mobdefaultscheck owns "can it spawn"). No golden -> SKIP.
// Anti-vacuity (D-30/D-305): +1 on the engine's zombie base, equipment made invisible, and a husk golden shifted +1 are
// each caught.
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { loadEngine, MCLITE_ROOT } from '../loadsrc.mjs';
import { VARIANTS, ENGINE_N } from './xpscen.mjs';

const refDir = process.env.MCLITE_REFEREE_DIR || join(homedir(), '.mclite-referee', '1.18.2');
const GOLDEN = [join(refDir, 'golden', 'mob-xp.json'), join(MCLITE_ROOT, '..', 'mclite-store', 'golden', 'mob-xp.json')].find((f) => existsSync(f));
if (!GOLDEN) { console.log('xprefcheck: SKIP (golden not generated -- run node tools/referee/runxp.mjs)'); process.exit(0); }
const golden = JSON.parse(readFileSync(GOLDEN, 'utf8'));
const ASSETS = join(MCLITE_ROOT, 'assets');

const M = loadEngine({
  extra: ['02f_tags.js', '02g_items.js', '14f_inventory.js', '07h_entities.js', '14b_physics.js',
    '07d_mining.js', '07e_loot.js', '07i_entitylist.js', '07y_equip.js', '07m_breed.js',
    '07w_passive.js', '07zd_slime.js', '14d_survival.js', '14j_combat.js', '07ox_enchhelper.js',
    '07p_trade.js', '07zz_xporb.js'],
  initReg: false,
});
M.DATA = Object.assign({}, M.DATA, { entities: JSON.parse(readFileSync(join(ASSETS, 'entities.json'), 'utf8')) });
M.Entities.init();
{ const meta = JSON.parse(readFileSync(join(ASSETS, 'items.meta.json'), 'utf8'));
  M.Items.init({ items: readFileSync(join(ASSETS, 'items.bin')).toString('base64'), itemsBytes: meta.rawBytes }); }
{ const lm = JSON.parse(readFileSync(join(ASSETS, 'loot.meta.json'), 'utf8'));
  M.Loot.init({ loot: readFileSync(join(ASSETS, 'loot.bin')).toString('base64'), lootBytes: lm.jsonBytes }); }
const FLOOR_Y = 64;
M.Physics.shapeAt = (x, y, z) => (y < FLOOR_Y ? M.Physics.FULL_CUBE : null);
M.Physics.solidAt = (x, y, z) => M.Physics.shapeAt(x, y, z) !== null;
M.Physics.grounded = (x, y, z, d) => y - d < FLOOR_Y;
M.EntityList.init(); M.Equip.init(); M.Breed.init(); M.Passive.init(); M.Xp.init();
const { EntityList: EL, Items: IT, Equip: Eq, Xp, Combat: Cb } = M;

// seeded, so a red is reproducible
let seed = 0x5eed1234;
const rng = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
let px = 0;
function engineKills(v, n) {
  const out = [];
  for (let k = 0; k < n; k++) {
    px += 8;
    const e = EL.spawn(v.mob, px, FLOOR_Y, 0);
    if (!e) return null;
    e.equip = [];
    e.growAge = v.baby ? -24000 : 0;
    if ('baby' in e || v.baby) e.baby = !!v.baby;
    e.hasJockey = false;
    if (v.size && M.Slime && M.Slime.setSize) M.Slime.setSize(e, v.size, true);
    for (const [slot, item] of v.equip || []) {
      Eq.setEquipped(e, IT[slot], { i: IT.of(item), n: 1 });
      Eq.setDropChance(e, IT[slot], 0.085);          // MobEntity's default hand/armor drop chance (NBT-summoned, no roll)
    }
    e.playerHitTimer = 100; e.attackingPlayer = true; e.lootDropped = false;
    // the REAL death path (Cb.dropLoot, 14j_combat.js): loot, then equipment, then xp -- LivingEntity.drop's own order
    // (.decomp LivingEntity.java:1328-1345), so an item that dropped is no longer there to add its xp bonus.
    const n0 = EL.list.length;
    Cb.dropLoot(e);
    let xp = 0;
    for (let j = n0; j < EL.list.length; j++) { const o = EL.list[j]; if (o && o.type === 'experience_orb' && Math.abs(o.x - px) < 2) xp += o.value * (o.pickingCount || 1); }
    out.push(xp);
  }
  return out;
}
const stats = (a) => { const n = a.length, m = a.reduce((s, x) => s + x, 0) / n; return { n, m, v: a.reduce((s, x) => s + (x - m) * (x - m), 0) / Math.max(1, n - 1), min: Math.min(...a), max: Math.max(...a), sup: [...new Set(a)].sort((x, y) => x - y) }; };
function compare(id, gv, ev) {
  const g = stats(gv), e = stats(ev);
  if (g.min === g.max) {
    const off = ev.filter((x) => x !== g.min).length;
    return off ? [`${id}: vanilla always drops ${g.min} xp; engine ${off}/${ev.length} kills differ (engine ${e.min}..${e.max}, mean ${e.m.toFixed(2)})`] : [];
  }
  const bad = [];
  if (g.sup.join() !== e.sup.join()) bad.push(`${id}: vanilla drops {${g.sup}} xp, engine {${e.sup}}`);
  const se = Math.sqrt(g.v / g.n + e.v / e.n) || 1e-9;
  if (Math.abs(g.m - e.m) > 4 * se) bad.push(`${id}: mean xp vanilla ${g.m.toFixed(2)} vs engine ${e.m.toFixed(2)} (> 4 se, se ${se.toFixed(3)})`);
  return bad;
}

let pass = 0, breaks = 0; const fails = [], named = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); return c; };
const ENG = {};
for (const v of VARIANTS) {
  const g = golden.variants[v.id];
  if (!ok(!!(g && g.values && g.values.length), `${v.id}: in the golden (regenerate: node tools/referee/runxp.mjs)`)) continue;
  // a size>1 slime/magma cube SPLITS on death (SlimeEntity.remove), so the golden's "still alive" count is its children
  if (!v.size || v.size === 1) ok(!g.alive, `${v.id}: every server mob died (golden says ${g.alive} survived)`);
  let ev;
  try { ev = engineKills(v, ENGINE_N); } catch (err) { ok(false, `${v.id}: engine threw ${err.message}`); continue; }
  if (!ev) { named.push(`${v.id}: engine cannot spawn ${v.mob} (mobdefaultscheck's red, not asserted here)`); continue; }
  ENG[v.id] = ev;
  const bad = compare(v.id, g.values, ev);
  for (const b of bad) ok(false, b);
  if (!bad.length) pass++;
}

const breakCaught = (m, c) => { breaks++; if (c) { pass++; console.log('   ✓ break caught: ' + m); } else fails.push('anti-vacuity: ' + m); };
{
  const v = VARIANTS.find((x) => x.id === 'zombie'), was = Xp.BASE.zombie;
  Xp.BASE.zombie = was + 1;
  const ev = engineKills(v, 50);
  Xp.BASE.zombie = was;
  breakCaught('a zombie base of 6 is a mismatch', compare('zombie', golden.variants.zombie.values, ev).length > 0);
}
{
  const v = VARIANTS.find((x) => x.id === 'zombie_sword_helmet'), was = Eq.getEquipped;
  Eq.getEquipped = () => null;
  const ev = engineKills(v, ENGINE_N);
  Eq.getEquipped = was;
  breakCaught('a zombie whose sword and helmet add no xp is a mismatch', compare('zombie_sword_helmet', golden.variants.zombie_sword_helmet.values, ev).length > 0);
}
{
  const gv = golden.variants.husk.values.map((x) => x + 1);
  breakCaught('a husk golden shifted +1 is a mismatch', compare('husk', gv, ENG.husk || engineKills(VARIANTS.find((x) => x.id === 'husk'), 50)).length > 0);
}

console.log(`xprefcheck: ${VARIANTS.length} variants, ${fails.length} fail, ${named.length} named, ${breaks} breaks (golden ${golden.generatedAt})`);
for (const n of named) console.log('  - ' + n);
for (const f of fails.slice(0, 60)) console.log('  ✗ ' + f);
console.log('');
console.log('================ xprefcheck (I6) ================');
console.log(` assertions passed .. ${pass}`);
console.log(` failures ........... ${fails.length}`);
console.log(` breaks caught ...... ${breaks - fails.filter((f) => f.startsWith('anti-vacuity')).length}`);
process.exit(fails.length ? 1 : 0);
