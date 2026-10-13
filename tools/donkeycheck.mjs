#!/usr/bin/env node
// donkeycheck.mjs — loop/donkey-s96 (QUEUE 0.2 G18e remainder close): DONKEY and MULE.
//
//   node tools/donkeycheck.mjs [--verbose]
//
// ⚠ WHAT THIS PROVES, ON TOP OF mountcheck.mjs (which already proves the SHARED
// horse-family machinery: feed/temper, saddling, mounting, travel). This file proves the
// parts that are genuinely donkey/mule-shaped: the placement-tier goal selector existing at
// all (`Ai.ROSTER.donkey`/`.mule`), the attribute roll's OWN branch (health rolled, jump/speed
// flat — `AbstractDonkeyEntity.initAttributes`, .decomp), the chest (`e.hasChest`,
// `Mnt.interact`'s attach branch, `Mnt.menu`'s 2->17 resize, the real screen geometry), and
// horse x donkey -> mule breeding (`Breed.CHILD_SPECIES`, mule's own infertility).

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEngine } from './loadsrc.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ASSETS = join(ROOT, 'assets');

const VERBOSE = process.argv.includes('--verbose');
let pass = 0, breaks = 0;
const fails = [];
const ok = (c, m) => { if (c) pass++; else if (fails.length < 40) fails.push(m); return c; };
const okAv = (c, m) => { breaks++; if (c) { pass++; if (VERBOSE) console.log('   ✓ ' + m); } else fails.push('anti-vacuity: ' + m); };
const say = (...a) => { if (VERBOSE) console.log(...a); };

console.log('donkeycheck — loop/donkey-s96, donkey/mule placement/chest/mule-breeding');

const M = loadEngine({
  extra: ['02f_tags.js', '02g_items.js', '07b_behaviour.js', '07_world.js', '07h_entities.js',
          '14b_physics.js', '07i_entitylist.js', '07k_goals.js', '07l_spawn.js', '07m_breed.js',
          '07n_tame.js', '07r_mount.js', '14f_inventory.js', '14g_menu.js', '14l_use.js',
          '14j_combat.js', '14d_survival.js', '14_player.js', '15b_gui.js', '15g_commands.js']
});
{
  const meta = JSON.parse(readFileSync(join(ASSETS, 'items.meta.json'), 'utf8'));
  M.Items.init({ items: readFileSync(join(ASSETS, 'items.bin')).toString('base64'), itemsBytes: meta.rawBytes });
}
M.DATA = Object.assign({}, M.DATA, {
  entities: JSON.parse(readFileSync(join(ASSETS, 'entities.json'), 'utf8'))
});
M.Entities.init();
M.EntityList.init();
M.Ai.init();
M.Breed.init();
M.Tame.init();
M.Mount.init();

const Mnt = M.Mount, Br = M.Breed, EL = M.EntityList, Ai = M.Ai;
ok(Mnt.ready && Br.ready, 'Mount/Breed both report ready');

M.World.init(1);
const PLAT_Y = 63;
for (let cx = -2; cx <= 2; cx++) for (let cz = -2; cz <= 2; cz++) {
  const c = M.World.makeChunk(cx, cz);
  c.state = M.CH.GENERATED;
  M.World.chunks.set(M.World.key(cx, cz), c);
}
const STONE = M.States.stateOf('stone') | 0;
for (let x = -16; x <= 16; x++) for (let z = -16; z <= 16; z++) M.World.setBlock(x, PLAT_Y, z, STONE);

function mkDonkey(x, z) { return EL.spawn('donkey', x === undefined ? 0 : x, PLAT_Y + 1, z === undefined ? 0 : z); }
function mkMule(x, z) { return EL.spawn('mule', x === undefined ? 0 : x, PLAT_Y + 1, z === undefined ? 0 : z); }
function mkHorse(x, z) { return EL.spawn('horse', x === undefined ? 0 : x, PLAT_Y + 1, z === undefined ? 0 : z); }

// ── §1. the roster ────────────────────────────────────────────────────────────────────
say('\n§1 — MOUNTABLE/ROSTER: donkey and mule are real now, and so is llama (loop/llama-s97)');
{
  ok(Mnt.MOUNTABLE.donkey === true && Mnt.MOUNTABLE.mule === true, 'donkey/mule are MOUNTABLE');
  ok(Mnt.MOUNTABLE.llama === true, 'llama is now MOUNTABLE too (loop/llama-s97, llamacheck.mjs exercises it in full)');
  ok(typeof Ai.ROSTER.donkey === 'function' && typeof Ai.ROSTER.mule === 'function', 'Ai.ROSTER has a donkey/mule placement tier');
  const d = mkDonkey(), h = mkHorse(0, 5);
  ok(!!d.ai && !!h.ai, 'both a spawned donkey and a spawned horse got a real e.ai goal selector');
  ok(d.ai.entries.length === h.ai.entries.length, 'the donkey goal list is the SAME SHAPE as horse’s (Ai.ROSTER.donkey reuses Ai.ROSTER.horse verbatim)');
  okAv(d.ai.entries.length > 0, 'anti-vacuity: the goal list is not simply empty either way');
}

// ── §2. EL.spawn actually resolves donkey/mule (motion + dims + attrs) ──────────────────
say('\n§2 — EL.spawn resolves donkey/mule (motion/dims/attrs all closed-set, D-307’s own refusal rule)');
{
  const d = mkDonkey();
  ok(!!d, 'EL.spawn(\'donkey\', ...) returns a real entity, not null (EL.motionFor resolves it)');
  ok(d.width > 0 && d.height > 0, 'and it carries real dimensions off Entities.dimensions');
  ok(typeof d.maxHealth === 'number' && d.maxHealth > 0, 'and real health off Entities.attrsOf');
  okAv(EL.spawn('this_type_does_not_exist', 0, 0, 0) === null, 'anti-vacuity: an unknown type still refuses (EL.spawn is not simply "always succeeds now")');
}

// ── §3. attribute roll: health rolled, jump/speed FLAT (AbstractDonkeyEntity.initAttributes) ──
say('\n§3 — Mount.rollAttributes: donkey/mule roll ONLY health, jump/speed stay the jar’s flat literals');
{
  const seq = (vals) => { let i = 0; return () => vals[i++ % vals.length]; };
  const d1 = { type: 'donkey' }; Mnt.rollAttributes(d1, seq([0.1, 0.2, 0.3]));
  const d2 = { type: 'donkey' }; Mnt.rollAttributes(d2, seq([0.9, 0.8, 0.7]));
  ok(d1.jumpStrengthAttr === 0.5 && d2.jumpStrengthAttr === 0.5, 'jumpStrengthAttr is always the flat 0.5 literal (createAbstractDonkeyAttributes, .decomp), regardless of the rand sequence');
  ok(d1.movementSpeedAttr === 0.175 && d2.movementSpeedAttr === 0.175, 'movementSpeedAttr is always the flat 0.175 literal too');
  okAv(d1.maxHealthAttr !== d2.maxHealthAttr, 'anti-vacuity: health DOES still move with a different rand sequence — proves only jump/speed were pinned, not the whole roll frozen');
  ok(d1.maxHealthAttr >= 15 && d1.maxHealthAttr < 15 + 8 + 9, 'health stays inside getChildHealthBonus’s own 15..31 range');

  const h1 = { type: 'horse' }; Mnt.rollAttributes(h1, seq([0.1, 0.1, 0.1]));
  const h2 = { type: 'horse' }; Mnt.rollAttributes(h2, seq([0.9, 0.9, 0.9]));
  okAv(h1.jumpStrengthAttr !== h2.jumpStrengthAttr, 'anti-vacuity: a HORSE’s jump strength DOES still roll (proves the donkey/mule flat branch is a real branch, not the new default for everyone)');
}

// ── §4. taming/riding/saddle are the SAME generic code horse already exercises ────────────
say('\n§4 — Mount.interact: donkey reuses the whole horse taming/riding/saddle state machine');
{
  const d = mkDonkey(); d.tamed = false;
  ok(Mnt.interact(d, '', {}).mounted === true, 'an empty-hand right-click still mounts an untamed donkey (same as horse)');
  const d2 = mkDonkey(); d2.tamed = true;
  const sad = Mnt.interact(d2, 'saddle', {});
  ok(sad && sad.consumed === true && d2.saddled === true, 'a saddle on a tame donkey equips directly, same SaddleItem.useOnEntity fast path as horse');
  ok(!Mnt.hasArmorSlot(d2), 'Mnt.hasArmorSlot is false for a donkey (AbstractDonkeyEntity never overrides it)');
  const armourTry = Mnt.interact(mkDonkey(), 'golden_horse_armor', {});
  ok(armourTry === null || armourTry.opened !== true, 'horse armour in hand does NOT open a screen on a donkey (no armour slot at all)');
}

// ── §5. the chest: attach, resize, screen geometry, drop-on-death ──────────────────────
say('\n§5 — the chest: AbstractDonkeyEntity.interactMob’s attach branch, getInventorySize() 2->17, HorseScreenHandler’s grid');
{
  ok(!Mnt.isChestable(mkHorse(0, 6)), 'a horse is never Mnt.isChestable (no CHEST tracked data at all on HorseEntity)');
  ok(Mnt.isChestable(mkDonkey()) && Mnt.isChestable(mkMule()), 'donkey and mule both are');

  const untamed = mkDonkey(); untamed.tamed = false;
  const r0 = Mnt.interact(untamed, 'chest', {});
  ok(!untamed.hasChest, 'an UNTAMED donkey refuses a chest (playAngrySound branch, .decomp’s own earlier !isTame() check)');
  ok(r0 && r0.consumed === false, 'and does not consume the chest item either');

  const d = mkDonkey(); d.tamed = true;
  const r1 = Mnt.interact(d, 'chest', {});
  ok(r1 && r1.consumed === true, 'a TAME, chestless donkey holding a chest consumes it');
  ok(d.hasChest === true, 'and sets e.hasChest');
  {
    M.Sound = M.Sound || {}; const S = M.Sound; const orig = S.play; const evs = [];
    S.play = (ev) => evs.push(ev);
    const dd = mkDonkey(); dd.tamed = true; Mnt.interact(dd, 'chest', {});
    const mm = mkMule(); mm.tamed = true; Mnt.interact(mm, 'chest', {});
    const un = mkMule(); un.tamed = false; Mnt.interact(un, 'chest', {});
    S.play = orig;
    ok(evs.includes('entity.donkey.chest') && evs.includes('entity.mule.chest'), 'placing a chest emits entity.donkey.chest / entity.mule.chest (playAddChestSound, #1357)');
    ok(evs.length === 2, 'anti-vacuity: the untamed refusal emits no chest sound');
  }
  const r2 = Mnt.interact(d, 'chest', {});
  ok(r2 && r2.mounted === true, 'a SECOND chest on an ALREADY-chested donkey does nothing special — falls through to the ordinary mount branch (the attach branch is guarded on !hasChest, .decomp)');

  const Inv = M.Inventory, inventory = Inv.create();
  const m0 = Mnt.menu(d, inventory);
  ok(m0.slots.length === 17 + 27 + 9, 'Mount.menu on a chested donkey has 17 mount slots (2 + 3x5 grid) + 27 backpack + 9 hotbar');
  const dirt = Inv.stack('dirt', 1);
  ok(M.Menu.slotSet(m0.slots[2], dirt) !== false, 'slot 2 (first chest cell) accepts an ordinary item — HorseScreenHandler’s own chest Slot has no canInsert restriction at all');

  const noChest = mkDonkey();
  const m1 = Mnt.menu(noChest, inventory);
  ok(m1.slots.length === 2 + 27 + 9, 'Mount.menu on a CHESTLESS donkey stays at the horse-shaped 2+27+9 (no grid)');
  okAv(m0.slots.length !== m1.slots.length, 'anti-vacuity: the two donkeys really do get different-sized menus, not the same fixed count either way');

  // GUI geometry — Gui.horseSlotXY with the chest flag actually threaded through
  const G = M.Gui;
  ok(G.HORSE.chest.cols === 5 && G.HORSE.chest.rows === 3, 'Gui.HORSE.chest is a 5x3 grid (getInventoryColumns()==5, 3 rows — HorseScreenHandler, .decomp)');
  const p2 = G.horseSlotXY(2, true);
  ok(p2[0] === 80 && p2[1] === 18, 'slot 2 (first chest cell) at (80,18) — HorseScreenHandler\'s `80 + col*18, 18 + row*18` (D-550; the (79,17) blit origin is not a slot)');
  const p17 = G.horseSlotXY(17, true);
  ok(p17[0] === G.HORSE.main[0] && p17[1] === G.HORSE.main[1], 'slot 17 (first backpack cell) starts right after the 15-cell grid, with chest=true');
  const p2NoChest = G.horseSlotXY(2, false);
  ok(p2NoChest[0] === G.HORSE.main[0] && p2NoChest[1] === G.HORSE.main[1], 'the SAME index 2 lands on the first backpack cell when chest=false — proves the flag actually changes the layout, not just accepted and ignored');
  ok(G.horseSlotAt(G.HORSE.chest.x + 1, G.HORSE.chest.y + 1, true) === 2, 'horseSlotAt hit-tests INTO the chest grid when chest=true');
  ok(G.horseSlotAt(G.HORSE.chest.x + 1, G.HORSE.chest.y + 1, false) === -1, 'and hits NOTHING at that same point when chest=false (grid is not drawn at all)');

  // drop-on-death
  const d3 = mkDonkey(); d3.hasChest = true;
  const drops = Mnt.dropInventory(d3);
  ok(drops.length === 1 && drops[0].item === 'chest' && drops[0].count === 1, 'Mount.dropInventory reports exactly one chest item for a chested donkey');
  ok(d3.hasChest === false, 'and clears the flag (AbstractDonkeyEntity.dropInventory, .decomp)');
  const d4 = mkDonkey();
  okAv(Mnt.dropInventory(d4).length === 0, 'anti-vacuity: a CHESTLESS donkey drops nothing (proves the length-1 result above is conditional, not a constant)');
}

// ── §6. horse x donkey -> mule breeding, and mule’s own infertility ────────────────────────
say('\n§6 — Breed.CHILD_SPECIES: horse x donkey -> mule, mule is infertile, donkey x donkey stays donkey');
{
  ok(Br.canBreed('donkey') && Br.canBreed('horse'), 'donkey/mule left Breed.SPECIAL — Breed.canBreed now says yes for both families');
  ok(!Br.SPECIAL.donkey && !Br.SPECIAL.mule, 'and Breed.SPECIAL itself no longer lists them (only trader_llama does — llama itself closed loop/llama-s97)');

  ok(Br.CHILD_SPECIES('horse', 'donkey') === 'mule', 'horse x donkey -> mule (HorseEntity.createChild, .decomp)');
  ok(Br.CHILD_SPECIES('donkey', 'horse') === 'mule', 'donkey x horse -> mule too (DonkeyEntity.createChild, the mirror)');
  ok(Br.CHILD_SPECIES('donkey', 'donkey') === 'donkey', 'donkey x donkey -> donkey (DonkeyEntity.createChild’s "else donkey" branch)');
  ok(Br.CHILD_SPECIES('horse', 'horse') === 'horse', 'horse x horse -> horse, unchanged from before this pass');
  okAv(Br.CHILD_SPECIES('mule', 'horse') === 'mule', 'anti-vacuity: a mule parent (unreachable through canMate, but named the same way MuleEntity.createChild names it) still answers mule, not horse’s own type');

  ok(Br.MATE.mule(mkMule(), mkMule()) === false, 'Breed.MATE.mule refuses unconditionally (HorseBaseEntity’s own un-overridden canBreedWith == false)');

  const h = mkHorse(20, 20); h.tamed = true; h.growAge = 0; Br.setInLove(h, null);
  const d = mkDonkey(20.1, 20); d.tamed = true; d.growAge = 0; Br.setInLove(d, null);
  ok(Br.canMate(h, d) === true, 'Breed.canMate now allows a tame, in-love horse+donkey pair (the one named cross-type exception)');
  const mule = Br.breed(h, d, { random: Math.random });
  ok(!!mule && mule.type === 'mule', 'Breed.breed actually spawns a MULE from a horse x donkey pair, not another horse or donkey');
  ok(Br.isBaby(mule), 'and the mule is born a baby, same as every other bred child');
  ok(mule.maxHealthAttr > 0 && mule.jumpStrengthAttr !== undefined, 'the mule child carries averaged attributes (Mount.setChildAttributes, shared with horse’s own averaging)');
  ok(mule.variant === undefined, 'and NO variant at all — the colour/marking roll is horse-only (Breed.CHILD.horse), Breed.CHILD.mule never touches e.variant');

  const h2 = mkHorse(21, 20); h2.tamed = false; h2.growAge = 0;
  const d2 = mkDonkey(21.1, 20); d2.tamed = true; d2.growAge = 0; Br.setInLove(d2, null);
  ok(Br.canMate(h2, d2) === false, 'an UNTAMED horse partner still refuses (golden-carrot love requires tame, Mount.feed’s own gate, unchanged)');

  const w = { type: 'wolf' }, d3 = mkDonkey(22, 20);
  ok(Br.canMate(w, d3) === false, 'a wolf x donkey pair is refused — the cross-type exception is EXACTLY horse<->donkey, nothing wider');

  const d4 = mkDonkey(23, 20); d4.tamed = true; d4.growAge = 0; Br.setInLove(d4, null);
  const d5 = mkDonkey(23.1, 20); d5.tamed = true; d5.growAge = 0; Br.setInLove(d5, null);
  ok(Br.canMate(d4, d5) === true, 'donkey x donkey (same type) still mates normally');
  const babyDonkey = Br.breed(d4, d5, { random: Math.random });
  ok(!!babyDonkey && babyDonkey.type === 'donkey', 'and produces another donkey, not a mule');
}

// #4415: /summon NBT + /data get round-trip the horse-family keys
{
  const C = M.Commands;
  const mk = (t) => M.EntityList.spawn(t, 0, 0, 0);
  const m = mk('mule');
  C.applyNbt(m, { Tame: 1, ChestedHorse: 1, Temper: 7, Bred: 1, SaddleItem: { id: 'minecraft:saddle', Count: 1 }, Items: [{ Slot: 2, id: 'minecraft:diamond', Count: 5 }, { Slot: 0, id: 'minecraft:dirt', Count: 1 }] });
  ok(m.tamed && m.hasChest && m.saddled && m.temper === 7 && m.bred, 'applyNbt sets Tame/ChestedHorse/SaddleItem/Temper/Bred');
  const o = C.entityNbt({ kind: 'mob', e: m });
  ok(o.Tame === true && o.ChestedHorse === true && o.Temper === 7 && o.Bred === true && o.SaddleItem && o.SaddleItem.id === 'minecraft:saddle', 'entityNbt writes them back');
  ok(o.Items && o.Items.length === 1 && o.Items[0].Slot === 2 && o.Items[0].Count === 5, 'Items keeps slot >= 2 only');
  const m2 = mk('mule'), o2 = C.entityNbt({ kind: 'mob', e: m2 });
  okAv(!m2.hasChest && o2.ChestedHorse === false && o2.Items === undefined, 'anti-vacuity: an untouched mule is chestless and writes no Items');
  const h = mk('horse'); C.applyNbt(h, { ChestedHorse: 1 });
  okAv(!h.hasChest, 'anti-vacuity: a horse ignores ChestedHorse (not chestable)');
}
console.log(`\n${pass} assertions passed, ${breaks} breaks caught, ${fails.length} failed`);
if (fails.length) {
  console.log('\nFAILURES:');
  for (const f of fails) console.log('  - ' + f);
  process.exit(1);
}
console.log('donkeycheck: PASS');
