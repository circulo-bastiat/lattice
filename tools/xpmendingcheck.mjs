#!/usr/bin/env node
// xpmendingcheck.mjs — G21: EXPERIENCE ORBS (src/07zz_xporb.js).
//

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEngine } from './loadsrc.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ASSETS = join(ROOT, 'assets');
const VERBOSE = process.argv.includes('--verbose');

let pass = 0, breaks = 0;
const fails = [];
const ok = (c, m) => { if (c) pass++; else if (fails.length < 60) fails.push(m); return c; };
const okAv = (c, m) => { breaks++; if (c) { pass++; console.log('   ✓ ' + m); } else fails.push('anti-vacuity: ' + m); };
const say = (...a) => { if (VERBOSE) console.log(...a); };

console.log('xpmendingcheck — G21, Mending on orb pickup (07zz_xporb.js)');

const M = loadEngine({
  extra: ['02f_tags.js', '02g_items.js', '14f_inventory.js', '07h_entities.js', '14b_physics.js',
          '07d_mining.js', '07e_loot.js', '07i_entitylist.js', '07y_equip.js', '07m_breed.js',
          '07w_passive.js', '07zd_slime.js', '14d_survival.js', '14j_combat.js', '07ox_enchhelper.js',
          '07p_trade.js', '07zz_xporb.js'],
  initReg: false
});
M.DATA = Object.assign({}, M.DATA, {
  entities: JSON.parse(readFileSync(join(ASSETS, 'entities.json'), 'utf8'))
});
M.Entities.init();
{
  const meta = JSON.parse(readFileSync(join(ASSETS, 'items.meta.json'), 'utf8'));
  M.Items.init({ items: readFileSync(join(ASSETS, 'items.bin')).toString('base64'), itemsBytes: meta.rawBytes });
}
{
  const lootMeta = JSON.parse(readFileSync(join(ASSETS, 'loot.meta.json'), 'utf8'));
  M.Loot.init({ loot: readFileSync(join(ASSETS, 'loot.bin')).toString('base64'), lootBytes: lootMeta.jsonBytes });
}
// a floor at y=64, the entlistcheck/tamecheck idiom -- motion is arithmetic, not terrain
const FLOOR_Y = 64;
M.Physics.shapeAt = (x, y, z) => (y < FLOOR_Y ? M.Physics.FULL_CUBE : null);
M.Physics.solidAt = (x, y, z) => M.Physics.shapeAt(x, y, z) !== null;
M.Physics.grounded = (x, y, z, d) => y - d < FLOOR_Y;
M.EntityList.init();
M.Equip.init();
M.Breed.init();
M.Passive.init();
M.Xp.init();


// ── mending on pickup: Xp.repairPlayerGears ─────────────────────────────────────────────
const EL = M.EntityList, Xp = M.Xp;
const Iv = M.Inventory, Cb = M.Combat;
const MEND = { Enchantments: [{ id: 'minecraft:mending', lvl: 1 }] };
let n = 0;
function scenario(orbValue, damage, tag, slot) {
  const BASE = 1200 + (n++) * 50;
  const P = { x: BASE, y: 70, z: BASE, width: 0.6, height: 1.8, dead: false, PICKUP_INFLATE: [1.0, 0.5, 1.0], slot: 0 };
  M.Survival.init(P); M.Player = P;
  P.inventory = Iv.create();
  const st = Iv.stack('iron_pickaxe', 1, damage, tag);
  Iv.setItem(P.inventory, slot === undefined ? 0 : slot, st);
  const orb = EL.spawn('experience_orb', BASE, 70, BASE); orb.value = orbValue; orb.pickingCount = 1; orb.orbAge = 0;
  Xp.pickupTick();
  return { P, st };
}
{
  const r = scenario(5, 100, MEND);
  ok(r.st.d === 90, `mending pickaxe repairs 2 durability per xp: 5xp heals 10 of 100, damage ${r.st.d}`);
  ok(r.P.xpTotal === 0, `all 5 xp spent on repair, bar got ${r.P.xpTotal}`);
  const l = scenario(5, 4, MEND, 0);
  ok(l.st.d === 0 && l.P.xpTotal === 3, `damage 4 costs 2 xp, 3 xp leftover reaches the bar (d=${l.st.d}, xp=${l.P.xpTotal})`);
  const off = scenario(5, 100, MEND, Iv.OFFHAND);
  ok(off.st.d === 90, `offhand mending item is repaired too, damage ${off.st.d}`);
  const arm = scenario(3, 100, MEND, Iv.ARMOR_START + 2);
  ok(arm.st.d === 94, `armour slot mending item is repaired, damage ${arm.st.d}`);
  const plain = scenario(5, 100, undefined, 0);
  ok(plain.st.d === 100 && plain.P.xpTotal === 5, `unenchanted damaged item gets no repair and the full xp (d=${plain.st.d}, xp=${plain.P.xpTotal})`);
  const full = scenario(5, 0, MEND, 0);
  ok(full.st.d === 0 && full.P.xpTotal === 5, `undamaged mending item is not a candidate: full xp to the bar (${full.P.xpTotal})`);

  // anti-vacuity: each broken expectation must be caught by the same measurement
  const ratio = (100 - r.st.d) / 5;
  okAv(ratio !== 3, `broken ratio (expect 3 durability/xp) is caught; real ratio ${ratio}`);
  okAv(ratio !== 1, `broken ratio (expect 1 durability/xp) is caught; real ratio ${ratio}`);
  okAv(!(plain.st.d < 100), 'mending stripped from the item: repair does not happen (a repair claim on it is caught)');
  okAv(!(l.P.xpTotal === 0), 'leftover-to-bar expectation broken (expect 0 at bar) is caught');
}

console.log('\n' + (fails.length ? 'FAIL' : 'PASS') + '  xpmendingcheck: ' + pass + ' assertions, ' +
  fails.length + ' failures, ' + breaks + ' breaks caught');
for (const f of fails) console.log('   x ' + f);
process.exit(fails.length ? 1 : 0);
