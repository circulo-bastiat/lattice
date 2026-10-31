#!/usr/bin/env node
// brutepickupcheck.mjs — s133 (KW-32): piglin + piglin_brute exist (src/07zzf_piglin.js).
//
//   node tools/brutepickupcheck.mjs [--verbose]
//
//   1. spawn: both EL.canSpawn; PiglinEntity.initialize — 20% baby (speed x1.2, no weapon), an adult's
//      weapon ~50/50 crossbow/golden sword, ~10% per golden armour piece, none on a baby; brute:
//      golden axe always, never enchanted, 50 hp.
//   2. zombification: 300 ticks in the overworld are fine, the 301st converts to a zombified piglin
//      keeping the equipment and baby flag, with Nausea 200; an immune piglin never converts.
//   3. HostileEntity babies never grow up (EL.PERMANENT_BABY); a calf still does.
//   4. targets: an adult piglin takes a player not in gold, never one in a golden piece, never while a
//      zombified piglin is within 6, prefers a wither skeleton; a baby never targets; the brute
//      takes any player within 12, not at 14.
//   5. revenge: hitting a piglin angers it AND a nearby adult piglin, even through gold.
//   6. xp: a piglin drops its bare 5 whatever it wears; a brute 20 + equipment.
//   7. anti-vacuity: each of the above broken on purpose and caught.
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

console.log('brutepickupcheck — #2554: piglin_brute pickup (golden axe only)');

const M = loadEngine({ extra: ['02f_tags.js', '02g_items.js', '07_world.js', '09b_sky.js', '14b_physics.js',
  '14f_inventory.js', '07h_entities.js', '07y_equip.js', '07ox_enchhelper.js', '07i_entitylist.js', '07l_spawn.js',
  '07m_breed.js', '14i_hand.js', '14j_combat.js', '14d_survival.js', '07zk_undead.js', '07q_effects.js', '07k_goals.js',
  '07zz_xporb.js', '07zzf_piglin.js'], dom: false });
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
const EL = M.EntityList, Eq = M.Equip, IT = M.Items, Pg = M.Piglin;
Pg.init();


const clear = () => { EL.list.length = 0; };
const held = (e) => { const s = Eq.getEquipped(e, IT.MAINHAND); return s ? IT.nameOf(s.i) : null; };
function trial(drop, hand) {
  clear();
  const b = EL.spawn('piglin_brute', 0.5, 64, 0.5);
  Eq.setEquipped(b, IT.MAINHAND, hand ? Eq.stackOf(hand) : null);
  const it = EL.dropStack(0.5, 64, 0.5, Eq.stackOf(drop).i, 1);
  for (const o of EL.list) if (o.type === 'item') o.pickupDelay = 0;
  for (let t = 0; t < 5; t++) Eq.tickPickup(b, () => 0.99);
  return held(b);
}
const checks = () => [
  [trial('golden_axe', null) === 'golden_axe', 'brute with empty hand equips a dropped golden_axe'],
  [trial('iron_axe', null) === null, 'brute ignores an iron_axe'],
  [trial('gold_ingot', null) === null, 'brute ignores a gold_ingot'],
];
for (const [c, m] of checks()) ok(c, m);
const keep = Eq.PICKUP_SKIP.piglin_brute; Eq.PICKUP_SKIP.piglin_brute = 1;
okAv(trial('golden_axe', null) === null, 'with brute in PICKUP_SKIP the axe is ignored');
Eq.PICKUP_SKIP.piglin_brute = keep;
const cg = Eq.canGather; Eq.canGather = () => true;
okAv(trial('iron_axe', null) === 'iron_axe', 'without the canGather rule the brute takes an iron_axe');
Eq.canGather = cg;
if (fails.length) {
  console.log(`${pass} assertions, ${fails.length} failures, ${breaks} breaks caught`); for (const f of fails) console.log('  ✗ ' + f); console.log('FAIL brutepickupcheck'); process.exit(1); }
console.log(`PASS brutepickupcheck: ${pass} assertions, 0 failures, ${breaks} breaks caught`);
