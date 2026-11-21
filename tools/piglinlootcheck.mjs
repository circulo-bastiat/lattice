#!/usr/bin/env node
// piglinlootcheck.mjs -- #3906: PiglinBrain.canGather/loot for EVERY item class, not just the gold ingot
// (gold nugget whole stack, golden item admired, piglin_food, equip/stash, baby/repellent refusals).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT, initRegistry } from './loadsrc.mjs';

const ASSETS = join(MCLITE_ROOT, 'assets');
const VERBOSE = process.argv.includes('--verbose');
const rdj = (f) => JSON.parse(readFileSync(join(ASSETS, f), 'utf8'));
const b64 = (f) => readFileSync(join(ASSETS, f)).toString('base64');
let pass = 0; const fails = []; let breaks = 0;
const ok = (c, m) => { if (c) pass++; else fails.push(m); if (VERBOSE) console.log((c ? '  ✓ ' : '  ✗ ') + m); return c; };
const okAv = (c, m) => { breaks++; if (ok(c, 'anti-vacuity: ' + m) && !VERBOSE) console.log('   ✓ ' + m); };


console.log('piglinlootcheck - #3906');
const M = loadEngine({ extra: ['02f_tags.js', '02g_items.js', '07_world.js', '09b_sky.js', '14b_physics.js',
  '14f_inventory.js', '07h_entities.js', '07y_equip.js', '07ox_enchhelper.js', '07i_entitylist.js', '07l_spawn.js',
  '07m_breed.js', '14i_hand.js', '14j_combat.js', '14d_survival.js', '07zk_undead.js', '07q_effects.js', '07k_goals.js',
  '07zz_xporb.js', '07zzf_piglin.js', '07zzg_hoglin.js', '14e_gamemode.js'], dom: false });
if (initRegistry) initRegistry(M);
M.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
M.DATA = Object.assign({}, M.DATA, { entities: rdj('entities.json') });
M.Entities.init(); M.EntityList.init(); M.Equip.init();
if (M.Breed && M.Breed.init) M.Breed.init();
if (M.EnchHelper && M.EnchHelper.init) M.EnchHelper.init();
if (M.Effects && M.Effects.init) M.Effects.init();
if (M.Xp && M.Xp.init) M.Xp.init();
M.Combat.init();
if (M.Ai && M.Ai.init && !M.Ai.ready) M.Ai.init();
const EL = M.EntityList, Eq = M.Equip, IT = M.Items, Pg = M.Piglin, Hg = M.Hoglin;
Pg.init();
if (Hg && Hg.init) Hg.init();

const clear = () => { EL.list.length = 0; };
const mk = (b) => { clear(); const p = EL.spawn('piglin', 0.5, 64, 0.5, { spawnReason: 'structure' }); p.pgClock = 0; Eq.setEquipped(p, IT.MAINHAND, null); if (b) p.isBaby = true; return p; };
const drop = (p, name, n) => EL.dropStack(p.x, p.y, p.z, IT.of(name), n, { pickupDelay: 0 });
const inv = (p, name) => ((p.pgInv || []).find((s) => s.name === name) || { n: 0 }).n;
const main = (p) => { const s = Eq.getEquipped(p, IT.MAINHAND); return s ? IT.nameOf(s.i) : null; };
function suite() {
  const out = [];
  let p = mk(); let d = drop(p, 'gold_nugget', 7); Pg.lootTick(p);
  out.push(['nugget: whole stack into inventory', inv(p, 'gold_nugget') === 7 && d.removed]);
  p = mk(); d = drop(p, 'golden_sword', 2); Pg.lootTick(p);
  out.push(['golden sword: one admired in offhand, one left', Pg.offhand(p) && IT.nameOf(Pg.offhand(p).i) === 'golden_sword' && Pg.isAdmiring(p) && d.count === 1]);
  for (let t = 0; t < Pg.ADMIRE_TICKS; t++) { p.pgClock++; Pg.tickAdmire(p); }
  out.push(['admired sword is equipped when the window closes (not barter-rolled)', main(p) === 'golden_sword' && !Pg.offhand(p)]);
  p = mk(); d = drop(p, 'cooked_porkchop', 1); Pg.lootTick(p);
  out.push(['food: eaten-recently set, item consumed', Pg.hasAteRecently(p) && d.removed]);
  d = drop(p, 'cooked_porkchop', 1); Pg.lootTick(p);
  out.push(['food: ignored while ate recently', !d.removed]);
  p = mk(); d = drop(p, 'crossbow', 1); Pg.lootTick(p);
  out.push(['crossbow: equipped in mainhand', main(p) === 'crossbow' && d.removed]);
  p = mk(true); d = drop(p, 'leather', 1); Pg.lootTick(p);
  out.push(['baby refuses ignored_by_piglin_babies (leather)', !d.removed]);
  p = mk(); d = drop(p, 'leather', 1); Pg.lootTick(p);
  out.push(['adult takes leather into the empty mainhand (MobEntity default slot)', d.removed && main(p) === 'leather']);
  p = mk(); d = drop(p, 'soul_torch', 1); Pg.lootTick(p);
  out.push(['piglin_repellents refused', !d.removed]);
  p = mk(); d = drop(p, 'golden_sword', 1); Pg.lootTick(p); d = drop(p, 'gold_ingot', 1); Pg.lootTick(p);
  out.push(['gold in offhand blocks further gold', !d.removed]);
  p = mk(); drop(p, 'cooked_porkchop', 1); p.pgClock = 0;
  out.push(['nearestWantedItem sees food now', !!Pg.nearestWantedItem(p, 9)]);
  p = mk(); p.pgHitByPlayerUntil = 400; p.target = null; d = drop(p, 'golden_sword', 1); Pg.lootTick(p);
  out.push(['#4538 hit by player but NO attack target: still gathers', d.removed || d.count === 0]);
  p = mk(); p.pgHitByPlayerUntil = 400; p.target = { x: 0, y: 64, z: 0 }; d = drop(p, 'golden_sword', 1); Pg.lootTick(p);
  out.push(['#4538 hit by player WITH attack target: refuses', !d.removed && d.count === 1]);
  return out;
}
let goodRes = suite();
for (const [m, c] of goodRes) ok(c, m);
// anti-vacuity: break canGatherItem -> must flip rows
const orig = Pg.canGatherItem;
Pg.canGatherItem = (e, n) => n === 'gold_ingot';
const bad = suite();
if (bad.some(([m, c], i) => c !== goodRes[i][1])) { breaks++; console.log('   ✓ break caught: ingot-only gather'); } else fails.push('anti-vacuity: ingot-only unnoticed');
Pg.canGatherItem = (e, n, c) => orig(e, n, c) || true;
const bad2 = suite();
if (bad2.some(([m, c], i) => c !== goodRes[i][1])) { breaks++; console.log('   ✓ break caught: gather everything'); } else fails.push('anti-vacuity: gather-all unnoticed');
Pg.canGatherItem = orig;
console.log('\n================ piglinlootcheck ================');
console.log(` assertions passed .. ${pass}`);
console.log(` failures ........... ${fails.length}`);
for (const f of fails) console.log('  ✗ ' + f);
console.log(` breaks caught ...... ${breaks}`);
process.exit(fails.length ? 1 : 0);
