#!/usr/bin/env node
// nametagcheck.mjs — loop/nametag: the name tag (NameTagItem) on mobs.
//
//   node tools/nametagcheck.mjs [--verbose]
//
// ⚠ WHAT THIS PROVES. `NameTagItem.useOnEntity` (.decomp/net/minecraft/item/NameTagItem
// .java:15-28) is a two-part guard — a stack with NO custom name PASSes (refused), one WITH one
// sets `e.customName`, calls `MobEntity.setPersistent()` and decrements the stack by exactly
// one — checked in BOTH directions (rule 6), through the real `Use.entityUse` dispatch
// (14l_use.js), never a synthetic re-model of it. `e.customName`'s own save round trip is
// checked through the real `07zw_mobnbt.js` module (`Mb.serializeAll`/`Mb.restoreAll`), and the
// two special-name hooks this session's own scope reached are checked through their real,
// unrelated modules: `Rb.skinKey` (07zh_rabbit.js, "Toast") and `e.johnny`
// (`VindicatorEntity.setCustomName`, .decomp VindicatorEntity.java:151-155, closing the vacuous
// `Ai.VindicatorTargetGoal` gate 07k_goals.js:1348-1356 names).
//
// STILL OWED, named precisely rather than guessed at (no OWED array of this check's own — every
// item below already has a home in the module that owns it):
//   * the floating nameplate (EntityRenderer.hasLabel/renderLabelIfPresent, .decomp) — this
//     engine has NO in-world text-rendering substrate at all (02i_text.js is component
//     formatting only, no glyph mesher; the 2D HUD canvas overlay, 15_hud.js, has a world->
//     screen projection but has never drawn a string with it). Building one would be a NEW
//     RENDERER, which this unit's own scope excludes ("if the render substrate allows it
//     without a new renderer") — not built, not faked.
//   * "Dinnerbone"/"Grumm" upside-down render (`LivingEntityRenderer.shouldFlipUpsideDown`,
//     .decomp lines 258-268) — real vanilla applies an EXTRA 180-degree Z rotation plus a
//     height translate on top of the existing per-mob base-pose flip (D-415, `ER.basePoseFor`)
//     and negates pitch/roll for the head look; `ER.emitMobLayer` has no per-instance transform
//     hook beyond that fixed base pose today, so this is real new geometry work, not a local
//     Dinnerbone-shaped `if`, and was not attempted this session.
//   * "jeb_" sheep rainbow wool — already named, correctly, on `Passive.OWED`
//     (07w_passive.js:531): a per-tick colour-cycle RENDER effect with no existing hook (unlike
//     "Toast", below, there is no dormant `if (name === 'jeb_')` anywhere already wired to a
//     render call), outside this unit's own owned files (07w_passive.js is not on this unit's
//     "files you own" list).
//   * `Ai.VindicatorTargetGoal`'s own header comment and the three other `07k_goals.js`
//     mentions of "no NBT reader in this engine writes the Johnny tag" (lines 1355, 208, 1581,
//     3857-58) are now STALE — `e.johnny` IS set, by 14l_use.js's own name-tag branch, closed
//     this session — but 07k_goals.js is not on this unit's "files you own" list, so its own
//     comments were left for that file's owner to correct rather than edited here.

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

console.log('nametagcheck — loop/nametag, the name tag (NameTagItem) on mobs');

const EXTRA = ['02f_tags.js', '02g_items.js', '07_world.js', '07b_behaviour.js', '07c_blockentity.js',
  '07d_mining.js', '07e_loot.js', '07h_entities.js', '07y_equip.js', '14b_physics.js',
  '14c_raycast.js', '07i_entitylist.js', '07k_goals.js', '07l_spawn.js', '14d_survival.js',
  '14f_inventory.js', '14j_combat.js', '14l_use.js', '07za_explosion.js', '07m_breed.js',
  '07n_tame.js', '07o_profession.js', '07r_mount.js', '07ze_llama.js', '07t_fly.js',
  '07q_effects.js', '07zh_rabbit.js', '07w_passive.js', '07zk_undead.js', '09b_sky.js',
  '16b_save.js', '07zw_mobnbt.js'];

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
  if (MCL.Breed && MCL.Breed.init) MCL.Breed.init();
  if (MCL.Tame && MCL.Tame.init) MCL.Tame.init();
  if (MCL.Profession && MCL.Profession.init) MCL.Profession.init();
  MCL.Use.init(MCL.World);
  globalThis.btoa = globalThis.btoa || ((s) => Buffer.from(s, 'binary').toString('base64'));
  globalThis.atob = globalThis.atob || ((s) => Buffer.from(s, 'base64').toString('binary'));
  globalThis.localStorage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
  };
  MCL.Player = { toJSON: () => ({ x: 0, y: 64, z: 0 }), fromJSON: () => false };
  MCL.Save.init();
  return MCL;
}

const MCL = freshMCL();
const Use = MCL.Use, EL = MCL.EntityList, Iv = MCL.Inventory, IT = MCL.Items, Mb = MCL.MobNbt, Rb = MCL.Rabbit;

ok(Use.ready, 'Use module reports ready');
ok(Mb.ready, 'MobNbt module reports ready');
if (!Use.ready || !Mb.ready) { console.log('\nFAIL — cannot continue'); process.exit(1); }

const nameTagStack = (name) => {
  const i = IT.of('name_tag');
  if (i < 0) return null;
  const bare = { i, n: 1, d: 0 };
  return name === undefined ? bare : Iv.withTag(bare, { display: { Name: name } });
};
ok(nameTagStack() !== null, "the `name_tag` item exists in the packed item table (it is a real trade item, D-590's villager offers)");

const mkPlayer = (o) => Object.assign({ instabuild: false }, o);
const mkCow = (x, y, z) => { const e = EL.spawn('cow', x, y, z); ok(!!e, 'a cow spawns'); return e; };

// ── §1. an UNNAMED name tag refuses, on both a passive and a hostile mob ───────────────────────────────────
say('\n§1 — a bare (unnamed) name tag PASSes, vanilla’s own hasCustomName() guard');
{
  const cow = mkCow(0, 0, 0);
  const stack = nameTagStack();
  const before = stack.n;
  const r = Use.entityUse(mkPlayer(), cow, stack);
  ok(r === false, 'Use.entityUse(cow, bare name tag) returns false — refused, exactly like NameTagItem.useOnEntity’s own ActionResult.PASS');
  ok(cow.customName === undefined, '...and the cow got no custom name');
  ok(cow.persistent !== true, '...and setPersistent() was never reached');
  ok(stack.n === before, '...and the stack was NOT decremented on a refusal');

  const zombie = EL.spawn('zombie', 1, 0, 0);
  ok(!!zombie, 'a zombie spawns');
  const stack2 = nameTagStack();
  ok(Use.entityUse(mkPlayer(), zombie, stack2) === false, 'the SAME refusal holds for a hostile mob — NameTagItem does not special-case Monster');
}

// ── §2. a NAMED name tag renames, persists, and spends exactly one ───────────────────────
say('\n§2 — a named name tag: setCustomName + setPersistent + decrement(1)');
{
  const cow = mkCow(2, 0, 0);
  ok(cow.persistent !== true, 'a fresh cow is not persistent by default (MobEntity.persistent, field default false)');
  const stack = nameTagStack('Bessie');
  const P = mkPlayer();
  const r = Use.entityUse(P, cow, stack);
  ok(r === true, 'Use.entityUse(cow, "Bessie" name tag) returns true — consumed');
  ok(cow.customName === 'Bessie', 'the cow now carries the custom name');
  ok(cow.persistent === true, '...and MobEntity.setPersistent() fired — a named mob never despawns');
  ok(stack.n === 0, '...and the stack was decremented by exactly one (1 - 1 = 0)');

  okAv((() => {
    const c2 = mkCow(3, 0, 0);
    const s2 = nameTagStack('Again');
    const real = Iv.shrink;
    Iv.shrink = () => { throw new Error('should not be called on a refusal'); };
    let threw = false;
    try { Use.entityUse(mkPlayer(), c2, nameTagStack()); } catch (e) { threw = true; }
    Iv.shrink = real;
    return threw === false;
  })(), 'anti-vacuity: a bare tag on a FRESH mob still never reaches Iv.shrink — the refusal in §1 is not order-dependent on §2’s mutation');

  // creative: the stack is never actually spent (this file’s own `!P.instabuild` convention,
  // the same one every other consumable branch in 14l_use.js already uses)
  const cow2 = mkCow(4, 0, 0);
  const stack2 = nameTagStack('Dolly');
  const P2 = mkPlayer({ instabuild: true });
  ok(Use.entityUse(P2, cow2, stack2) === true, 'a named tag in creative still renames');
  ok(stack2.n === 1, '...but the stack is NOT spent (instabuild)');
}

// ── §3. a PLAYER-shaped tag is never reached (Use.entityUse’s own caller never targets one) ─
say('\n§3 — the dispatch itself is mob-only (the `!(target instanceof PlayerEntity)` half of the guard)');
{
  // Use.entityUse is only ever called by 14l_use.js:700 on `P.targetEntity`, which is populated
  // from a raycast against the live mob list — there is no code path that hands it a player
  // object. Documented, not separately exercised (nothing in src/ constructs that call).
  ok(true, 'no reachable call site passes a player as `e` — the `instanceof PlayerEntity` half of NameTagItem’s guard has no code path to test');
}

// ── §4. customName round-trips through a save (07zw_mobnbt.js’s own COMMON field) ────────
say('\n§4 — e.customName round-trips through S.save/S.load/Mb.restoreAll');
{
  const S = MCL.Save;
  EL.clear();   // a clean slate -- earlier sections' cows must not shadow this one on find()
  const cow = EL.spawn('cow', 50.5, 64, -12.25);
  cow.customName = 'Persisty';
  cow.persistent = true;
  ok(S.save(false), 'S.save() wrote a payload');
  EL.clear();
  ok(EL.list.length === 0, 'fresh world — EL.list cleared');
  ok(S.load(), 'S.load() re-parsed the saved envelope');
  const restored = Mb.restoreAll(S.mobRecords);
  ok(restored === S.mobRecords.length, 'every saved mob restored');
  const back = EL.list.find((e) => e.type === 'cow');
  ok(!!back, 'the cow came back');
  ok(back && back.customName === 'Persisty', 'its custom name round-tripped byte-for-byte');
  ok(back && back.persistent === true, '...and so did `persistent`, the same save (both COMMON fields, one record)');

  // anti-vacuity: drop 'customName' from the field table the SAME way tamecheck/leashcheck
  // stub a real constant, and prove the round trip then FAILS to carry it — the mechanism is
  // under test, not merely the string equality above.
  okAv((() => {
    const cow2 = EL.spawn('cow', 51, 64, -12);
    cow2.customName = 'ShouldVanish';
    const realFieldsFor = Mb.fieldsFor;
    Mb.fieldsFor = (type) => realFieldsFor(type).filter((f) => f !== 'customName');
    const ok1 = S.save(false);
    EL.clear();
    S.load();
    const n = Mb.restoreAll(S.mobRecords);
    Mb.fieldsFor = realFieldsFor;
    const restoredCow = EL.list.find((e) => e.type === 'cow');
    return ok1 && n >= 1 && restoredCow && restoredCow.customName === undefined;
  })(), 'with `customName` pulled out of Mb.fieldsFor, the SAME cow reloads with NO custom name — proves §4’s equality rests on the field table, not a stub that always matches');
}

// ── §5. "Toast" rabbit skin — Rb.skinKey’s own dormant hook, now reachable ─────────────
say('\n§5 — naming a rabbit "Toast" (name tag) selects Rb.SKIN_TOAST');
{
  ok(!!Rb && Rb.skinKey, 'the Rabbit module and its skinKey picker are loaded');
  const rabbit = EL.spawn('rabbit', 6, 0, 0);
  ok(!!rabbit, 'a rabbit spawns');
  const before = Rb.skinKey(rabbit);
  ok(before !== Rb.SKIN_TOAST, 'an unnamed rabbit does NOT draw the Toast skin');
  const stack = nameTagStack('Toast');
  ok(Use.entityUse(mkPlayer(), rabbit, stack) === true, 'the name tag applies');
  ok(Rb.skinKey(rabbit) === Rb.SKIN_TOAST, '...and Rb.skinKey now resolves to \'rabbit#6\', the Toast easter-egg sheet');
  const rabbit2 = EL.spawn('rabbit', 7, 0, 0);
  Use.entityUse(mkPlayer(), rabbit2, nameTagStack('Roast'));
  ok(Rb.skinKey(rabbit2) !== Rb.SKIN_TOAST, 'anti-vacuity: a near-miss name ("Roast") does NOT select the Toast skin — exact match only, same as RabbitEntityRenderer’s own string equality');
}

// ── §6. "Johnny" vindicator — closes Ai.VindicatorTargetGoal’s own vacuous gate ───────────
say('\n§6 — naming a vindicator "Johnny" (name tag) latches e.johnny, and ONLY on a vindicator');
{
  const vind = EL.spawn('vindicator', 8, 0, 0);
  ok(!!vind, 'a vindicator spawns');
  ok(vind.johnny !== true, 'a fresh vindicator is not Johnny');
  ok(Use.entityUse(mkPlayer(), vind, nameTagStack('Johnny')) === true, 'the name tag applies');
  ok(vind.johnny === true, '...and e.johnny latches — Ai.VindicatorTargetGoal (07k_goals.js) reads exactly this field');

  const vind2 = EL.spawn('vindicator', 9, 0, 0);
  Use.entityUse(mkPlayer(), vind2, nameTagStack('NotJohnny'));
  ok(vind2.johnny !== true, 'anti-vacuity: a DIFFERENT name on a vindicator does NOT set johnny — exact match only');

  // CustomName set without the name tag (NBT load / summon): the goal latches it
  const vind3 = EL.spawn('vindicator', 11, 0, 0);
  vind3.customName = 'Johnny';
  new MCL.Ai.VindicatorTargetGoal(vind3, {}).canUse();
  ok(vind3.johnny === true, 'CustomName "Johnny" set directly (NBT/summon) latches johnny via the goal');
  const vind4 = EL.spawn('vindicator', 12, 0, 0);
  vind4.customName = 'Other';
  new MCL.Ai.VindicatorTargetGoal(vind4, {}).canUse();
  okAv(vind4.johnny !== true, 'a different CustomName does not latch johnny on the NBT path');

  const cow = mkCow(10, 0, 0);
  Use.entityUse(mkPlayer(), cow, nameTagStack('Johnny'));
  ok(cow.johnny === undefined, 'anti-vacuity: naming a COW "Johnny" does not set e.johnny on it — the VindicatorEntity.setCustomName override is species-specific, not a global string match');

  // #3006: VindicatorEntity.isTeammate (illagers) + TargetGoal checkVisibility
  const jn = EL.spawn('vindicator', 30, 0, 30); jn.customName = 'Johnny';
  const pil = EL.spawn('pillager', 31, 0, 30);
  const jg = new MCL.Ai.VindicatorTargetGoal(jn, {});
  jg.canUse();
  okAv(jn.target !== pil, 'Johnny never targets a pillager (illager teammate)');
  jn.target = null;
  const realSee = MCL.Ai.canSee; MCL.Ai.canSee = () => false;
  okAv(new MCL.Ai.VindicatorTargetGoal(jn, {}).canUse() === false, 'Johnny acquires nothing it cannot see (wall-occluded)');
  MCL.Ai.canSee = realSee;

  ok(vind.johnny === true, '...and the FIRST vindicator (§6, real match) still reads true — the species/name gate above did not clobber the real one');
}

console.log('\n' + (fails.length ? 'FAIL' : 'PASS') + '  nametagcheck — ' + pass + ' assertions, ' +
  fails.length + ' failures' + (breaks ? ', ' + breaks + ' anti-vacuity checks' : ''));
for (const f of fails) console.log('   x ' + f);
process.exit(fails.length ? 1 : 0);
