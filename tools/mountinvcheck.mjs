#!/usr/bin/env node
// mountinvcheck.mjs — D-550: a dying mount's INVENTORY drop, the horse anger timer, Jump Boost on a
// charged jump, the pig's saddle drop, and the horse screen's geometry (backpack y, per-strength
// llama chest grid, llama carpet icon) — every number off `.decomp/` (HorseBaseEntity,
// AbstractDonkeyEntity, PigEntity, LivingEntity.drop/getJumpBoostVelocityModifier,
// HorseScreenHandler, HorseScreen), each with a break that must be caught (D-30).
//
//   node tools/mountinvcheck.mjs [--verbose]
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEngine } from './loadsrc.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ASSETS = join(ROOT, 'assets');
const VERBOSE = process.argv.includes('--verbose');
let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else if (fails.length < 40) fails.push(m); return c; };
const okAv = (c, m) => { breaks++; if (c) pass++; else fails.push('anti-vacuity: ' + m); };
console.log('mountinvcheck — D-550 mount inventory drop / anger timer / jump boost / pig saddle / horse screen');

const M = loadEngine({
  extra: ['02f_tags.js', '02g_items.js', '07b_behaviour.js', '07_world.js', '07h_entities.js',
          '14b_physics.js', '07i_entitylist.js', '07k_goals.js', '07l_spawn.js', '07m_breed.js',
          '07n_tame.js', '07q_effects.js', '07r_mount.js', '07ze_llama.js', '07w_passive.js', '14f_inventory.js', '14g_menu.js',
          '14l_use.js', '14j_combat.js', '14d_survival.js', '14_player.js', '15b_gui.js'],
});
{
  const meta = JSON.parse(readFileSync(join(ASSETS, 'items.meta.json'), 'utf8'));
  M.Items.init({ items: readFileSync(join(ASSETS, 'items.bin')).toString('base64'), itemsBytes: meta.rawBytes });
}
M.DATA = Object.assign({}, M.DATA, { entities: JSON.parse(readFileSync(join(ASSETS, 'entities.json'), 'utf8')) });
M.Entities.init(); M.EntityList.init(); M.Ai.init(); M.Breed.init(); M.Tame.init(); M.Mount.init(); M.Combat.init();
if (M.Passive.init) M.Passive.init();
M.World.init(1);
for (let cx = -2; cx <= 2; cx++) for (let cz = -2; cz <= 2; cz++) {
  const c = M.World.makeChunk(cx, cz); c.state = M.CH.GENERATED; M.World.chunks.set(M.World.key(cx, cz), c);
}
const STONE = M.States.stateOf('stone') | 0;
for (let x = -20; x <= 20; x++) for (let z = -20; z <= 20; z++) M.World.setBlock(x, 63, z, STONE);
const Mnt = M.Mount, EL = M.EntityList, I = M.Inventory, IT = M.Items, G = M.Gui, Cb = M.Combat, ES = M.Effects;
const st = (name, n, tag) => I.stack(IT.of(name), n, 0, tag);
const names = (list) => list.map((d) => d.item + 'x' + d.count).sort().join(',');

// ── §1. HorseBaseEntity.dropInventory + AbstractDonkeyEntity.dropInventory
{
  const d = EL.spawn('donkey', 0, 64, 0); d.tamed = true; d.hasChest = true; d.saddled = true;
  Mnt.menu(d, { main: new Array(36).fill(null) });
  d.mountItems[0] = st('saddle', 1); d.mountItems[4] = st('diamond', 7); d.mountItems[16] = st('stick', 3);
  d.mountItems[9] = st('iron_ingot', 2, { Enchantments: [{ id: 'minecraft:vanishing_curse', lvl: 1 }] });
  const out = Mnt.dropInventory(d);
  ok(names(out) === 'chestx1,diamondx7,saddlex1,stickx3', 'a chested saddled donkey drops saddle + every chest stack + the chest, not the vanishing-cursed one: ' + names(out));
  ok(!d.hasChest && d.mountItems.every((s) => !s), 'dropInventory empties the bank and clears hasChest (AbstractDonkeyEntity.setHasChest(false))');
  okAv(Mnt.dropInventory(d).length === 0, 'a second call drops NOTHING — the first really emptied it (no double drop)');
  const h = EL.spawn('horse', 2, 64, 0); h.tamed = true; Mnt.saddle(h);
  ok(names(Mnt.dropInventory(h)) === 'saddlex1', 'a horse saddled by right-click (flag only, empty slot 0) still drops its saddle');
  const h2 = EL.spawn('horse', 4, 64, 0); h2.tamed = true; Mnt.menu(h2, { main: new Array(36).fill(null) });
  h2.mountItems[0] = st('saddle', 1); h2.saddled = true; h2.mountItems[1] = st('iron_horse_armor', 1);
  ok(names(Mnt.dropInventory(h2)) === 'iron_horse_armorx1,saddlex1', 'a menu-saddled armoured horse drops ONE saddle (slot 0, not also the flag) + its armour');
  const h3 = EL.spawn('horse', 6, 64, 0);
  okAv(Mnt.dropInventory(h3).length === 0, 'a bare horse drops nothing — the drops above are conditional');
}
// ── §2. the join: Cb.dropLoot (LivingEntity.drop) spawns them, loot gate or not
{
  const realLoot = M.Loot;
  M.Loot = { ready: true, entityDrops: () => [] };
  const count = () => EL.list.filter((e) => e.type === 'item' && !e.removed).length;
  const d = EL.spawn('donkey', 0, 64, 4); d.tamed = true; d.hasChest = true;
  const before = count(); Cb.dropLoot(d);
  ok(count() - before === 1, 'Cb.dropLoot spawns the chested donkey\'s chest as an item entity (the dropInventory join)');
  const pig = EL.spawn('pig', 0, 64, 6); pig.saddled = true;
  const b2 = count(); Cb.dropLoot(pig);
  ok(count() - b2 === 1, 'Cb.dropLoot spawns a saddled pig\'s saddle (PigEntity.dropInventory)');
  const pig2 = EL.spawn('pig', 0, 64, 8);
  const b3 = count(); Cb.dropLoot(pig2);
  okAv(count() - b3 === 0, 'an unsaddled pig drops no saddle — the pig drop is conditional');
  M.Loot = realLoot;
}
// ── §3. playAngrySound -> angryTicks; HorseBaseEntity.tick clears it after 20
{
  const h = EL.spawn('horse', 0, 64, -4);
  const r = Mnt.interact(h, 'stick', {});
  ok(r && r.consumed === false && h.angry === true && h.angryTicks === 1, 'an untamed horse refusing a non-food item turns angry (playAngrySound -> updateAnger)');
  let t = 0; while (h.angry && t < 100) { Mnt.tickAnger(h); t++; }
  ok(t === 20, `the anger clears after exactly 20 ticks (angryTicks > 20), took ${t}`);
  h.eatingGrass = true; Mnt.playAngrySound(h);
  ok(h.angry && h.eatingGrass === false, 'setAngry(true) also clears the eat-grass flag');
  const saved = Mnt.ANGRY_TICKS; Mnt.ANGRY_TICKS = 5;
  const h2 = EL.spawn('horse', 2, 64, -4); Mnt.playAngrySound(h2);
  let t2 = 0; while (h2.angry && t2 < 100) { Mnt.tickAnger(h2); t2++; }
  Mnt.ANGRY_TICKS = saved;
  okAv(t2 !== 20, 'break: a 5-tick window is visibly different — the 20 above is the constant, not the loop cap');
  const hc = EL.spawn('horse', 4, 64, -4);
  const ra = Mnt.interact(hc, 'wheat', {});
  ok(!hc.angry, 'FOOD is not refused: feeding an untamed horse wheat does not anger it (both directions)');
}
// ── §4. getJumpBoostVelocityModifier on the charged jump
{
  const f = Math.fround;
  const h = EL.spawn('horse', 0, 64, -8);
  ok(Mnt.jumpBoostVelocityModifier(h) === 0, 'no Jump Boost -> modifier 0');
  ES.addStatusEffect(h, 'jump_boost', 200, 1);
  ok(Mnt.jumpBoostVelocityModifier(h) === f(f(0.1) * 2), 'Jump Boost II -> 0.1F * 2 in float, widened');
  okAv(Mnt.jumpBoostVelocityModifier(h) !== 0.2, 'break: the float product is NOT the double 0.2 — the fround is real');
}
// ── §5. the horse screen (HorseScreenHandler / HorseScreen, .decomp)
{
  ok(G.HORSE.main[1] === 84, 'backpack row 0 at y = 102 + 0*18 + -18 = 84 (was 102, the -18 dropped)');
  ok(G.horseSlotXY(2)[1] === 84 && G.horseSlotXY(29)[1] === 142, 'no chest: slot 2 at y 84, hotbar slot 29 at y 142');
  const p = G.horseSlotXY(2, 5);
  ok(p[0] === 80 && p[1] === 18, `first chest slot at (80,18) (80 + col*18, 18 + row*18), got ${p}`);
  const q = G.horseSlotXY(2 + 3 * 5 - 1, 5);
  ok(q[0] === 80 + 4 * 18 && q[1] === 18 + 2 * 18, 'donkey: last chest slot at column 4, row 2');
  const l3 = G.horseSlotXY(2 + 3, 3);
  ok(l3[0] === 80 && l3[1] === 36, 'strength-3 llama: slot 5 is row 1 col 0 (3 columns, not 5)');
  ok(G.horseSlotXY(2 + 9, 3)[1] === 84, 'strength-3 llama: backpack begins at slot 11 (2 + 3*3)');
  okAv(G.horseSlotXY(2 + 3, 5)[0] !== 80, 'break: the same index with 5 columns lands elsewhere — the column count is honoured');
  ok(G.horseSlotAt(81, 19, 3) === 2 && G.horseSlotAt(81 + 3 * 18, 19, 3) === -1, 'hit-test: a 3-column llama has no 4th column');
  ok(G.horseSlotXY(2, true)[0] === 80, '`true` still means donkey/mule\'s 5 columns');
  ok(G.HORSE.llamaDecorIcon && G.HORSE.llamaDecorIcon.u === 36 && G.HORSE.armourIcon.u === 0, 'llama carpet-slot icon u=36, horse armour u=0 (HorseScreen.drawBackground)');
}

console.log(`   ${pass} assertions · ${breaks} deliberate breaks caught · ${fails.length} failures`);
for (const f of fails) console.log('   ✗ ' + f);
process.exit(fails.length ? 1 : 0);
