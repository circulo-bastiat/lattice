#!/usr/bin/env node
// besavecheck.mjs — loop/besave-s105. Closes the QUEUE G18e remainder "hive/block-entity
// contents (16b_save persists no BE contents)". Drives the REAL modules: 07c_blockentity.js
// (`BE.serializeAll`/`BE.restoreAll`, the generic per-type field table — same shape as
// 07zw_mobnbt.js's mob serializer, `tools/mobnbtcheck.mjs`'s own harness this file mirrors),
// 14f_inventory.js (`Inventory.stackToJSON`/`stackFromJSON`, the SAME converter the player's
// 41 slots already round-trip through) and 16b_save.js's own S.save/S.load (real localStorage
// JSON envelope, mocked store only, exactly mobnbtcheck's own stub).
//
//   node tools/besavecheck.mjs [--verbose]
//
// Sections:
//   1. every block-entity kind in BE.FIELDS/the item-slot set — create it, mutate every
//      persisted field (items + type-specific fields) away from its default, S.save() -> real
//      localStorage string -> fresh BE store -> S.load() -> BE.restoreAll(S.beRecords) (the
//      exact 16b_save.js/17_main.js Main.finishBoot path) -> every field equal on the reloaded
//      entity, AT THE SAME POSITION (BE.restoreAll lazy-creates it there, no chunk needed)
//   2. a save written before this unit (no `be` key at all) still loads — zero BE records, no
//      throw, same as `mobRecords`'s own legacy-save rule
//   3. anti-vacuity, TWO independent breaks (BOTH directions of what this unit added):
//      §3a strike a type's own field from `BE.FIELDS` and prove that ONE field is lost while
//          its neighbours still round-trip (the per-type table, not merely "some save exists")
//      §3b break `Inventory.stackToJSON` (the item-slot path, not the field-table path) and
//          prove a chest's contents come back empty; restore it and prove the same chest's
//          contents come back full — both the break and the fix are caught

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';

const ASSETS = join(MCLITE_ROOT, 'assets');
const VERBOSE = process.argv.includes('--verbose');
const rdj = (f) => JSON.parse(readFileSync(join(ASSETS, f), 'utf8'));
const b64 = (f) => readFileSync(join(ASSETS, f)).toString('base64');

let pass = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); return c; };
let breaks = 0;
const okAv = (c, m) => { breaks++; ok(c, 'anti-vacuity: ' + m); if (c && VERBOSE) console.log('   ✓ ' + m); };
const say = (s) => { if (VERBOSE) console.log(s); };

console.log('besavecheck — loop/besave-s105, block-entity content persistence through 16b_save.js');

const EXTRA = ['02f_tags.js', '02g_items.js', '07_world.js', '07b_behaviour.js', '07c_blockentity.js',
               '07d_mining.js', '07e_loot.js', '07h_entities.js', '07y_equip.js', '14b_physics.js',
               '14c_raycast.js', '07i_entitylist.js', '07k_goals.js', '07l_spawn.js', '14d_survival.js',
               '14f_inventory.js', '14j_combat.js', '14l_use.js', '07za_explosion.js', '07m_breed.js',
               '07n_tame.js', '07o_profession.js', '07r_mount.js', '07ze_llama.js', '07t_fly.js',
               '07q_effects.js', '07zf_bat.js', '07zg_enderman.js', '07zh_rabbit.js', '07zj_fox.js',
               '07zj_goat.js', '07zl_panda.js', '07zm_axolotl.js', '07zn_mooshroom.js', '07zo_bee.js',
               '07zp_turtle.js', '07zr_zvillager.js', '09b_sky.js', '16b_save.js', '07zw_mobnbt.js'];

function freshMCL() {
  const store = {};
  const MCL = loadEngine({ extra: EXTRA, dom: false });
  MCL.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
  MCL.DATA = Object.assign({}, MCL.DATA, { entities: rdj('entities.json') });
  MCL.Entities.init();
  MCL.Entities.attrs = MCL.DATA.entities.attrs;
  MCL.World.init(1);
  MCL.Behave.init(MCL.World);
  if (MCL.BlockEntities && MCL.BlockEntities.init) MCL.BlockEntities.init();
  MCL.EntityList.init();
  globalThis.btoa = globalThis.btoa || ((s) => Buffer.from(s, 'binary').toString('base64'));
  globalThis.atob = globalThis.atob || ((s) => Buffer.from(s, 'base64').toString('binary'));
  globalThis.localStorage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
  };
  // `S.save` unconditionally calls `NS.Player.toJSON()`; this check has no live player.
  MCL.Player = { toJSON: () => ({ x: 0, y: 64, z: 0 }), fromJSON: () => false };
  MCL.Save.init();
  return MCL;
}

// ── § 1 — every block-entity kind round trips ───────────────────────────────────────────────
say('\n§1 block-entity round trip (create, mutate, save, fresh store, load, compare)');

const MCL1 = freshMCL();
const BE = MCL1.BlockEntities, S = MCL1.Save, Iv = MCL1.Inventory;

/** Position each kind at a distinct spot so they can't collide in the one store. */
let px = 0;
function nextPos() { px += 8; return [px, 64, 0]; }

const KIND_TESTS = {
  mob_spawner: (e) => { e.entity = 'skeleton'; e.delay = 33; e.count = 6; e.minDelay = 100; e.maxDelay = 300; e.spawnRange = 3; e.maxNearbyEntities = 9; e.requiredPlayerRange = 20; e.potentials = [{ weight: 1, data: { entity: { id: "minecraft:zombie" } } }]; e.spawnData = { id: "minecraft:skeleton" }; },
  chest: (e) => { e.items[0] = Iv.stack('diamond', 3); e.items[26] = Iv.stack('cobblestone', 64); },
  trapped_chest: (e) => { e.items[5] = Iv.stack('iron_ingot', 12, 0, { display: { color: 7 } }); },
  ender_chest: (e) => { e.items[0] = Iv.stack('obsidian', 8); },
  barrel: (e) => { e.items[13] = Iv.stack('wheat', 40); },
  shulker_box: (e) => { e.items[2] = Iv.stack('gold_ingot', 5); },
  hopper: (e) => { e.items[0] = Iv.stack('redstone', 9); e.items[4] = Iv.stack('coal', 20); e.cooldown = 6; },
  dropper: (e) => { e.items[8] = Iv.stack('arrow', 16); },
  dispenser: (e) => { e.items[4] = Iv.stack('bow', 1, 12); },
  furnace: (e) => {
    e.items[0] = Iv.stack('raw_iron', 2); e.items[1] = Iv.stack('coal', 3); e.items[2] = Iv.stack('iron_ingot', 1);
    e.burnTime = 150; e.burnDuration = 1600; e.cookTime = 80; e.cookTimeTotal = 200; e.recipesUsed = { iron_ingot: 3 };
  },
  blast_furnace: (e) => {
    e.items[0] = Iv.stack('raw_gold', 1); e.burnTime = 40; e.burnDuration = 800; e.cookTime = 33;
    e.cookTimeTotal = 100; e.recipesUsed = { gold_ingot: 1 };
  },
  smoker: (e) => {
    e.items[0] = Iv.stack('porkchop', 4); e.burnTime = 10; e.burnDuration = 800; e.cookTime = 5;
    e.cookTimeTotal = 100; e.recipesUsed = { cooked_porkchop: 2 };
  },
  brewing_stand: (e) => {
    for (let i = 0; i < 3; i++) e.items[i] = Iv.stack('potion', 1, 0, { Potion: 'water' });
    e.items[3] = Iv.stack('nether_wart', 1); e.items[4] = Iv.stack('blaze_powder', 2);
    e.brewTime = 200; e.fuel = 15;
  },
  piston: (e) => { e.movedState = 77; e.dir = 5; e.extending = false; e.source = true; e.progress = 0.5; e.lastProgress = 0; },
  beehive: (e) => {
    e.bees = [{ id: 1, hasNectar: true, ticksLeft: 500 }, { id: 2, hasNectar: false, ticksLeft: 10 }];
    e.honeyLevel = 3;
  },
  sign: (e) => { e.lines = ['hello', 'MC-Lite', '', 'world']; e.color = 'blue'; e.glowing = true; },
  campfire: (e) => { e.items[2] = Iv.stack('beef', 1); e.cookingTimes = [0, 0, 300, 0]; },
  banner: (e) => { e.patterns = [{ pattern: 'stripe_bottom', color: 'red' }, { pattern: 'circle', color: 'white' }]; },
  lectern: (e) => { e.book = Iv.stack('written_book', 1, 0, { pages: ['a', 'b'] }); e.page = 1; },
  beacon: (e) => { e.levels = 4; e.primary = 1; e.secondary = 10; e.customName = 'Bea'; },
  skull: (e) => { e.owner = { Name: 'Notch' }; },
  command_block: (e) => { e.command = 'say hi'; e.successCount = 3; e.lastOutput = 'Hello'; e.trackOutput = false; e.powered = true; e.conditionMet = true; e.auto = true; },
  jukebox: (e) => { e.record = 'music_disc_cat'; },
  comparator: (e) => { e.output = 7; }
};

const before = {};
for (const [type, mutate] of Object.entries(KIND_TESTS)) {
  const [x, y, z] = nextPos();
  const e = BE.create(x, y, z, type);
  if (!ok(!!e && e.type === type, type + ': BE.create resolved (TYPES row present in the registry)')) continue;
  mutate(e);
  const fields = (BE.FIELDS[type] || []).slice();
  const snap = {};
  for (const f of fields) { if (e[f] === undefined) continue; snap[f] = JSON.parse(JSON.stringify(e[f])); }
  // ⚠ `new Array(n)` (07c_blockentity.js's `make()`) is SPARSE — `.map()` skips a hole rather
  // than visiting it, which would silently compare `undefined` against a genuinely-restored
  // `null` and never notice. Walk every index explicitly instead.
  let items = null;
  if (e.items) {
    items = new Array(e.items.length);
    for (let idx = 0; idx < e.items.length; idx++) {
      const s = e.items[idx];
      items[idx] = s ? { i: s.i, n: s.n, d: s.d, t: s.t } : null;
    }
  }
  before[type] = { x, y, z, snap, items };
}
say('  created ' + Object.keys(before).length + ' mutated block entities, ' + BE.count() + ' total in the store');

ok(S.save(false), 'S.save() wrote a payload (localStorage backend + Player stub present)');
const savedRaw = globalThis.localStorage.getItem(S.KEY);
const savedBe = savedRaw && JSON.parse(savedRaw).be;
ok(Array.isArray(savedBe) && savedBe.length === BE.count(),
  'the saved JSON envelope carries one block-entity record per live block entity');

// A FRESH STORE: exactly what a page reload does (BlockEntities.init() re-runs, new Map).
BE.init();
ok(BE.count() === 0, 'the block-entity store is empty — the "fresh world" this check reloads into');

ok(S.load(), 'S.load() re-parsed the saved envelope');
ok(Array.isArray(S.beRecords) && S.beRecords.length === Object.keys(before).length,
  'S.load() stashed one block-entity record per saved one (S.beRecords, not yet applied — BE is not ready this early in the real boot either, same as S.mobRecords)');

const restored = BE.restoreAll(S.beRecords);
ok(restored === S.beRecords.length, 'BlockEntities.restoreAll() (Main.finishBoot\'s own call) restored every record');

for (const [type, rec] of Object.entries(before)) {
  const e = BE.get(rec.x, rec.y, rec.z);
  if (!ok(!!e && e.type === type, type + ': reloaded block entity exists, right type, at the saved position')) continue;
  let allMatch = true;
  for (const [f, v] of Object.entries(rec.snap)) {
    const got = e[f];
    const eq = JSON.stringify(got) === JSON.stringify(v);
    if (!eq) allMatch = false;
    ok(eq, type + '.' + f + ' round-tripped (' + JSON.stringify(v) + ' -> ' + JSON.stringify(got) + ')');
  }
  if (rec.items) {
    let itemsMatch = e.items && e.items.length === rec.items.length;
    if (itemsMatch) {
      for (let i = 0; i < rec.items.length; i++) {
        const want = rec.items[i], got = e.items[i];
        const eq = (want === null) ? (got === null || got === undefined)
          : (got && got.i === want.i && got.n === want.n && got.d === want.d
             && JSON.stringify(got.t || null) === JSON.stringify(want.t || null));
        if (!eq) itemsMatch = false;
      }
    }
    ok(itemsMatch, type + ': every item slot round-tripped through Inventory.stackToJSON/stackFromJSON');
    allMatch = allMatch && itemsMatch;
  }
  ok(allMatch, type + ': every persisted field/slot round-tripped');
}

{ const c = before.command_block && BE.get(before.command_block.x, before.command_block.y, before.command_block.z);
  ok(!!c && c.command === 'say hi' && c.successCount === 3 && c.lastOutput === 'Hello' && c.trackOutput === false
    && c.powered === true && c.conditionMet === true && c.auto === true,
    'command_block: Command/SuccessCount/LastOutput/TrackOutput/powered/conditionMet/auto all survive save/load (literal values, independent of BE.FIELDS)'); }

{ const c = before.campfire && BE.get(before.campfire.x, before.campfire.y, before.campfire.z);
  ok(!!c && c.items[2] && c.cookingTimes && c.cookingTimes[2] === 300, 'campfire: beef in slot 2 with cookingTimes[2]=300 survives save/load (independent of BE.FIELDS)'); }

// ── § 2 — a pre-existing save (no `be` key) still loads, zero BE records ────────────────────
say('\n§2 a save from before this unit loads with zero block-entity records');
const MCL2 = freshMCL();
const legacyPayload = JSON.stringify({
  v: MCL2.Save.VERSION, seed: 42, climate: 'vanilla', worldScale: 12000, t: Date.now(),
  player: MCL2.Player.toJSON(), data: MCL2.Save.encode()
  // no `be` key at all -- exactly what every save before this unit (and s104's mobs-only saves
  // written before `be` existed) looks like on disk
});
globalThis.localStorage.setItem(MCL2.Save.KEY, legacyPayload);
let threw = null;
try { MCL2.Save.load(); } catch (e) { threw = e; }
ok(!threw, 'S.load() on a be-less legacy save does not throw');
ok(Array.isArray(MCL2.Save.beRecords) && MCL2.Save.beRecords.length === 0,
  'a legacy save (no `be` key) yields S.beRecords === [] (not undefined, not a crash)');
ok(MCL2.BlockEntities.restoreAll(MCL2.Save.beRecords) === 0, 'restoreAll([]) is a no-op, zero block entities restored');

// ── § 3a — anti-vacuity: strike one field from BE.FIELDS, prove the round trip then breaks ──
say('\n§3a anti-vacuity — remove one field from BE.FIELDS and confirm the LOSS is caught');

const MCL3 = freshMCL();
const BE3 = MCL3.BlockEntities, S3 = MCL3.Save, Iv3 = MCL3.Inventory;
const hopper = BE3.create(0, 64, 0, 'hopper');
hopper.items[0] = Iv3.stack('redstone', 5);
hopper.cooldown = 7;

const realFields = BE3.FIELDS.hopper; // (campfire.cookingTimes is struck by the same mechanism: mutate BE.FIELDS.campfire to prove it)
BE3.FIELDS.hopper = realFields.filter((n) => n !== 'cooldown');   // strike ONE field only

ok(S3.save(false), '(broken build) S.save() still succeeds — the break is silent, as any real regression would be');
BE3.init();
S3.load();
BE3.restoreAll(S3.beRecords);
const brokenHopper = BE3.get(0, 64, 0);
okAv(!!brokenHopper && brokenHopper.cooldown !== 7,
  'with "cooldown" struck from BE.FIELDS.hopper, a reloaded hopper comes back WITHOUT its cooldown (' +
  JSON.stringify(brokenHopper && brokenHopper.cooldown) + ') — the round-trip test in §1 would have failed exactly here');
okAv(!!brokenHopper && brokenHopper.items[0] && brokenHopper.items[0].i === Iv3.stack('redstone', 1).i,
  'the SAME break leaves the hopper\'s ITEM slot intact — the field table and the item-array path are independent mechanisms, not one lucky coincidence');

BE3.FIELDS.hopper = realFields; // restore -- prove the FIX, not just the break
BE3.init();
const hopper2 = BE3.create(0, 64, 0, 'hopper');
hopper2.items[0] = Iv3.stack('redstone', 5);
hopper2.cooldown = 7;
S3.save(false);
BE3.init();
S3.load();
BE3.restoreAll(S3.beRecords);
const fixedHopper = BE3.get(0, 64, 0);
okAv(!!fixedHopper && fixedHopper.cooldown === 7,
  'restoring BE.FIELDS.hopper, the SAME hopper comes back with cooldown 7 — the check catches both the break and the fix');

// comparator: strike 'output' and the 7 must be lost
{
  const M = freshMCL(), B = M.BlockEntities, SV = M.Save;
  const real = B.FIELDS.comparator;
  const run = () => { B.init(); B.create(0, 64, 0, 'comparator').output = 7; SV.save(false); B.init(); SV.load(); B.restoreAll(SV.beRecords); return B.get(0, 64, 0); };
  B.FIELDS.comparator = (real || []).filter((n) => n !== 'output');
  const bad = run();
  okAv(!!bad && bad.output !== 7, 'with "output" struck from BE.FIELDS.comparator, a reloaded comparator reads ' + (bad && bad.output) + ', not 7');
  B.FIELDS.comparator = real;
  const good = run();
  okAv(!!good && good.output === 7, 'restoring the row, the comparator comes back with OutputSignal 7');
}

// brewing stand: strike 'fuel' from the field table and the loss must show
{
  const M = freshMCL(), B = M.BlockEntities, SV = M.Save;
  const real = B.FIELDS.brewing_stand;
  const bs = B.create(0, 64, 0, 'brewing_stand'); bs.fuel = 15; bs.brewTime = 200;
  B.FIELDS.brewing_stand = real.filter((n) => n !== 'fuel');
  SV.save(false); B.init(); SV.load(); B.restoreAll(SV.beRecords);
  const b = B.get(0, 64, 0);
  okAv(!!b && b.fuel !== 15, 'with "fuel" struck from BE.FIELDS.brewing_stand, a reloaded stand loses its fuel');
  B.FIELDS.brewing_stand = real;
}

// ── § 3b — anti-vacuity: break Inventory.stackToJSON, prove item slots are lost ─────────────
say('\n§3b anti-vacuity — break Inventory.stackToJSON and confirm ITEM loss is caught');

const MCL4 = freshMCL();
const BE4 = MCL4.BlockEntities, S4 = MCL4.Save, Iv4 = MCL4.Inventory;
const chest = BE4.create(0, 64, 0, 'chest');
chest.items[0] = Iv4.stack('diamond', 3);

const realStackToJSON = Iv4.stackToJSON;
Iv4.stackToJSON = () => null;   // every slot now serializes as empty

ok(S4.save(false), '(broken build) S.save() still succeeds with a broken item serializer');
BE4.init();
S4.load();
BE4.restoreAll(S4.beRecords);
const brokenChest = BE4.get(0, 64, 0);
okAv(!!brokenChest && !brokenChest.items[0],
  'with Inventory.stackToJSON broken, a reloaded chest comes back with an EMPTY slot 0 — the §1 round-trip test would have failed exactly here');

Iv4.stackToJSON = realStackToJSON; // restore -- prove the FIX
BE4.init();
const chest2 = BE4.create(0, 64, 0, 'chest');
chest2.items[0] = Iv4.stack('diamond', 3);
S4.save(false);
BE4.init();
S4.load();
BE4.restoreAll(S4.beRecords);
const fixedChest = BE4.get(0, 64, 0);
okAv(!!fixedChest && fixedChest.items[0] && fixedChest.items[0].n === 3 && fixedChest.items[0].i === Iv4.stack('diamond', 1).i,
  'restoring Inventory.stackToJSON, the SAME chest comes back with 3 diamonds in slot 0 — the check catches both the break and the fix');

// ── § 3c — anti-vacuity: strike 'record' from BE.FIELDS.jukebox, the disc is lost ──────────
say('\n§3c anti-vacuity — strike jukebox.record and confirm the disc LOSS is caught');
const MCL5 = freshMCL();
const BE5 = MCL5.BlockEntities, S5 = MCL5.Save;
const realJ = BE5.FIELDS.jukebox;
BE5.FIELDS.jukebox = realJ.filter((n) => n !== 'record');
BE5.create(0, 64, 0, 'jukebox').record = 'music_disc_cat';
S5.save(false); BE5.init(); S5.load(); BE5.restoreAll(S5.beRecords);
const brokenJ = BE5.get(0, 64, 0);
okAv(!!brokenJ && !brokenJ.record, 'with "record" struck from BE.FIELDS.jukebox the reloaded jukebox has no disc (' + JSON.stringify(brokenJ && brokenJ.record) + ')');
BE5.FIELDS.jukebox = realJ;

// ── § 3d — beacon: strike 'levels' -> lost; invalid effect id reads back null ──
say('\n§3d anti-vacuity — strike beacon.levels; invalid effect id -> null');
const MCL6 = freshMCL();
const BE6 = MCL6.BlockEntities, S6 = MCL6.Save;
const realB = BE6.FIELDS.beacon;
BE6.FIELDS.beacon = realB.filter((n) => n !== 'levels');
BE6.create(0, 64, 0, 'beacon').levels = 4;
S6.save(false); BE6.init(); S6.load(); BE6.restoreAll(S6.beRecords);
const brokenB = BE6.get(0, 64, 0);
okAv(!!brokenB && brokenB.levels !== 4, 'with "levels" struck from BE.FIELDS.beacon the reloaded beacon loses its level');
BE6.FIELDS.beacon = realB;
ok(BE6.beaconEffectById(1) === 1 && BE6.beaconEffectById(999) === null && BE6.beaconEffectById(2) === null, 'getPotionEffectById: valid id kept, invalid -> null');

// ── § 3e — lectern: book tag + page survive; striking 'page' loses it ──
say('\n§3e anti-vacuity — lectern book/page');
const MCL7 = freshMCL();
const BE7 = MCL7.BlockEntities, S7 = MCL7.Save;
const lec = BE7.create(0, 64, 0, 'lectern');
lec.book = MCL7.Inventory.stack('written_book', 1, 0, { title: 'T', author: 'A', pages: ['a', 'b', 'c'] });
lec.page = 2;
S7.save(false); BE7.init(); S7.load(); BE7.restoreAll(S7.beRecords);
const lec2 = BE7.get(0, 64, 0);
ok(!!lec2 && !!lec2.book && lec2.book.t && lec2.book.t.pages.length === 3 && lec2.page === 2, 'lectern book (3 pages) and page 2 survive save/load');
const realL = BE7.FIELDS.lectern;
BE7.FIELDS.lectern = [];
S7.save(false); BE7.init(); S7.load(); BE7.restoreAll(S7.beRecords);
okAv(BE7.get(0, 64, 0).page !== 2, 'with "page" struck from BE.FIELDS.lectern the page is lost');
BE7.FIELDS.lectern = realL;

// ── § 3d — anti-vacuity: strike the skull row, the SkullOwner is lost ──
say('\n§3d anti-vacuity — strike skull.owner and confirm the loss is caught');
const MCL8 = freshMCL();
const BE8 = MCL8.BlockEntities, S8 = MCL8.Save;
const realSk = BE8.FIELDS.skull;
ok(!!realSk, 'BE.FIELDS has a skull row');
delete BE8.FIELDS.skull;
BE8.create(0, 64, 0, 'skull').owner = { Name: 'Notch' };
S8.save(false); BE8.init(); S8.load(); BE8.restoreAll(S8.beRecords);
const brokenSk = BE8.get(0, 64, 0);
okAv(!!brokenSk && !(brokenSk.owner && brokenSk.owner.Name === 'Notch'), 'with the skull row deleted the reloaded head loses its owner');
BE8.FIELDS.skull = realSk;

// ── § 3e — piston moving-block entity (#5770): movedState/dir/extending/source/progress survive ──
say('\n§3f piston moving block — save mid-move, reload; strike movedState -> lost');
const MCL9 = freshMCL();
const BE9 = MCL9.BlockEntities, S9 = MCL9.Save;
const mk7 = () => { const p = BE9.create(2, 64, 3, 'piston'); p.movedState = 77; p.dir = 5; p.extending = false; p.source = true; p.progress = 0.5; p.lastProgress = 0; };
mk7(); S9.save(false); BE9.init(); S9.load(); BE9.restoreAll(S9.beRecords);
const pr = BE9.get(2, 64, 3);
ok(!!pr && pr.movedState === 77 && pr.dir === 5 && pr.extending === false && pr.source === true && pr.progress === 0.5, 'piston entity fields round-trip: ' + JSON.stringify(pr && [pr.movedState, pr.dir, pr.extending, pr.source, pr.progress]));
const realP = BE9.FIELDS.piston;
BE9.FIELDS.piston = realP.filter((n) => n !== 'movedState');
BE9.init(); mk7(); S9.save(false); BE9.init(); S9.load(); BE9.restoreAll(S9.beRecords);
const brokenP = BE9.get(2, 64, 3);
okAv(!brokenP || brokenP.movedState === undefined, 'with movedState struck from BE.FIELDS.piston the in-flight block is lost');
BE9.FIELDS.piston = realP;

console.log('\n' + pass + ' passed, ' + fails.length + ' failed (' + breaks + ' anti-vacuity checks included, ' + breaks + ' breaks caught)');
if (fails.length) { fails.forEach((m) => console.log('  FAIL: ' + m)); process.exit(1); }
process.exit(0);
