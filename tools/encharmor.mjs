#!/usr/bin/env node
// encharmor.mjs — G22: armour-side enchantments on the PLAYER and mobs. Feather Falling / Fire / Blast
// protection (ProtectionEnchantment.getProtectionAmount), Respiration (LivingEntity.getNextAirUnderwater),
// Aqua Affinity (mining context), Depth Strider (LivingEntity.travel), Frost Walker (freezeWater).
//   node tools/encharmor.mjs
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEngine } from './loadsrc.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, breaks = 0;
const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const okAv = (c, m) => { breaks++; if (c) { pass++; console.log('   ✓ ' + m); } else fails.push('anti-vacuity: ' + m); };

const M = loadEngine({
  extra: ['02f_tags.js', '02g_items.js', '14f_inventory.js', '07_world.js', '07h_entities.js', '09b_sky.js',
          '14b_physics.js', '07y_equip.js', '07i_entitylist.js', '07l_spawn.js', '14i_hand.js',
          '14j_combat.js', '14d_survival.js']
});
{
  const meta = JSON.parse(readFileSync(join(ROOT, 'assets', 'items.meta.json'), 'utf8'));
  M.Items.init({ items: readFileSync(join(ROOT, 'assets', 'items.bin')).toString('base64'), itemsBytes: meta.rawBytes });
}
M.DATA = Object.assign({}, M.DATA, { entities: JSON.parse(readFileSync(join(ROOT, 'assets', 'entities.json'), 'utf8')) });
M.Entities.init(); M.EntityList.init(); M.Equip.init(); M.Hand.init(); M.Combat.init();
const { Survival: Sv, Equip: Eq, Inventory: Iv, Items: IT, World: W, Physics: Ph } = M;
const AS = Iv.ARMOR_START;

function player(ench) {   // ench: { feet:[id,lvl], head:[..] }
  const slots = [];
  const put = (idx, name, e) => { const s = Eq.stackOf(name); if (e) s.t = { Enchantments: [{ id: 'minecraft:' + e[0], lvl: e[1] }] }; slots[AS + idx] = s; };
  put(0, 'diamond_boots', ench.feet); put(1, 'diamond_leggings', ench.legs);
  put(2, 'diamond_chestplate', ench.chest); put(3, 'diamond_helmet', ench.head);
  const e = { inventory: { slots }, air: 300, health: 20, absorption: 0, food: 20, invulnerable: 0, lastHurt: 0 };
  Sv.init(e); e.inventory = { slots };
  Sv.updateArmor(e, e.inventory);
  return e;
}
const dmg = (e, type, n) => { const h = e.health; Sv.hurt(e, type, n); return h - e.health; };

// 1. Feather Falling only reduces FALL damage; Fire Protection only fire; Blast only explosion.
{
  const plain = player({});
  const ff = player({ feet: ['feather_falling', 4] });
  const fp = player({ chest: ['fire_protection', 4] });
  const bp = player({ chest: ['blast_protection', 4] });
  okAv(dmg(ff, 'fall', 10) < dmg(plain, 'fall', 10), 'Feather Falling IV lowers fall damage');
  ok(Math.abs(dmg(player({ feet: ['feather_falling', 4] }), 'fall', 10) - 10 * (1 - 12 / 25)) < 1e-5, 'FF IV = 12 protection points');
  okAv(dmg(fp, 'lava', 10) < dmg(player({}), 'lava', 10), 'Fire Protection lowers lava damage');
  okAv(dmg(bp, 'explosion', 10) < dmg(player({}), 'explosion', 10), 'Blast Protection lowers explosion damage');
  ok(dmg(player({ feet: ['feather_falling', 4] }), 'generic', 10) === dmg(player({}), 'generic', 10), 'FF does nothing for generic damage');
  ok(dmg(player({ chest: ['fire_protection', 4] }), 'fall', 10) === dmg(player({}), 'fall', 10), 'Fire Protection does nothing for a fall');
  ok(dmg(player({ chest: ['blast_protection', 4] }), 'lava', 10) === dmg(player({}), 'lava', 10), 'Blast does nothing for lava');
  // mob path
  const z = { type: 'zombie', equip: [] };
  const boots = Eq.stackOf('iron_boots'); boots.t = { Enchantments: [{ id: 'minecraft:feather_falling', lvl: 3 }] };
  Eq.setEquipped(z, IT.FEET, boots);
  okAv(Eq.armorOf(z, 'fall').protection === 9 && Eq.armorOf(z, 'projectile').protection === 0, 'mob armorOf: FF III = 9 for fall, 0 otherwise');
}

// 2. Respiration slows the air drain; aqua affinity flag; depth strider level read from worn gear.
{
  const drain = (e) => { e.eyeInWater = true; e.air = 300; for (let i = 0; i < 200; i++) Sv.tickAir(e); return 300 - e.air; };
  const plain = drain(player({}));
  const resp = drain(player({ head: ['respiration', 3] }));
  ok(plain === 200, 'no Respiration: one air per tick');
  okAv(resp < plain * 0.5, 'Respiration III drains air far slower (expected 1/4 rate), got ' + resp);
  okAv(player({ head: ['aqua_affinity', 1] }).aquaAffinity === true && player({}).aquaAffinity === false, 'Aqua Affinity flag follows the helmet');
  ok(player({ feet: ['depth_strider', 3] }).depthStrider === 3, 'Depth Strider level read');
}

// 3. Depth Strider makes the swimmer faster.
{
  // drive waterTick through Ph.tick with a stubbed world query
  const swim = (lvl) => {
    const e = { x: 0.5, y: 70, z: 0.5, vx: 0, vy: 0, vz: 0, yaw: 0, depthStrider: lvl, onGround: false, width: 0.6, height: 1.8, pitch: 0 };
    const oldF = Ph.updateFluids, oldM = Ph.move;
    Ph.updateFluids = (x) => { x.inWater = true; x.eyeInWater = true; return x; };
    Ph.move = function (x, dx, dy, dz) { x.z += dz; x.x += dx; x.y += dy; };
    for (let i = 0; i < 60; i++) { try { Ph.tick(e, { fwd: 1, strafe: 0, jump: false, sneak: false, sprint: false }); } catch (err) { break; } }
    Ph.updateFluids = oldF; Ph.move = oldM;
    return Math.hypot(e.x - 0.5, e.z - 0.5);
  };
  const a = swim(0), b = swim(3);
  okAv(b > a * 1.2, 'Depth Strider III swims farther in 3 s (' + a.toFixed(2) + ' vs ' + b.toFixed(2) + ')');
}

// 4. Frost Walker freezes a radius of source water, then melts it.
{
  W.init(1);
  for (let cx = -1; cx <= 1; cx++) for (let cz = -1; cz <= 1; cz++) { const c = W.makeChunk(cx, cz); c.state = M.CH.GENERATED; W.chunks.set(W.key(cx, cz), c); }
  const water = M.States.stateOf('water'), ice = M.States.stateOf('frosted_ice');
  for (let x = -6; x <= 6; x++) for (let z = -6; z <= 6; z++) W.setBlock(x, 59, z, water);
  const e = player({ feet: ['frost_walker', 2] }); e.x = 0.5; e.y = 60; e.z = 0.5; e.onGround = true;
  const n = Sv.freezeWater(e);
  ok(n > 20 && W.getBlock(0, 59, 0) === ice, 'Frost Walker II froze ' + n + ' cells, under the feet included');
  ok(W.getBlock(6, 59, 0) === water, 'water beyond radius 4 untouched');
  okAv(Sv.freezeWater(player({})) === 0, 'no Frost Walker, no ice');
  const off = player({ feet: ['frost_walker', 2] }); off.x = 0.5; off.y = 60; off.z = 0.5; off.onGround = false;
  okAv(Sv.freezeWater(off) === 0, 'airborne walker freezes nothing (isOnGround gate)');
  // the melt is FrostedIceBlock's age ladder now (#5721): proven in frostedicecheck, not here
}

console.log('\n=================== encharmor ===================');
console.log(` assertions passed .. ${pass}`);
console.log(` failures ........... ${fails.length}`);
console.log(` breaks caught ...... ${breaks}`);
if (fails.length) { console.log('\nFAIL'); for (const f of fails) console.log('  - ' + f); process.exit(1); }
console.log('encharmor: PASS');
