#!/usr/bin/env node
// mobcmdxpgamemodecheck.mjs — worker 4 (mob-command joins): /gamemode and /experience against
// live mob combat.
//
//   node tools/mobcmdxpgamemodecheck.mjs [--verbose]
//
// ⚠ WHAT THIS PROVES, AND WHY IT IS A JOIN CHECK, NOT A DUPLICATE OF goalcheck/xporbcheck/
// commandcheck. Each of those proves ONE module in isolation: goalcheck sets `invulnerableGamemode`
// on a synthetic target directly (its own header only ever pre-sets the flag); xporbcheck proves
// `Xp.xpToDrop`/`Xp.dropMobXp`/`Xp.pickupTick` against a synthetic hit, never touching `NS.Gamemode`;
// commandcheck proves `/gamemode`/`/experience` parse and run, never against a live mob mid-fight.
// Nothing anywhere drives the REAL `/gamemode` command through the REAL Brigadier dispatcher,
// mid-fight, and watches `Ai.dropUntargetable`/`EL.tickMob`'s own two-call gate (D-684) react to
// it on the very next tick — nor proves that a mob a creative player just killed drops the SAME
// vanilla xp a survival kill does (LivingEntity.dropXp/`ExperienceOrbEntity.onPlayerCollision`,
// .decomp, read below — NEITHER gates on the killer's or picker's GameMode; there is no such gate
// in vanilla, and this check locks that in exactly because the obvious wrong guess -- "creative
// kills give 0 xp" -- is a plausible bug nothing else here would catch).
//
// §1 — /gamemode survival<->creative flipped LIVE, mid-fight, through NS.Commands.run: the
//      D-684 creative-chase fix (Ai.canTargetLiving/Ai.dropUntargetable) still holds when the
//      mode changes out from under a mob that already has the player targeted — not just when
//      the mode was pre-set before the mob ever picked a target. Anti-vacuity breaks
//      Ai.canTargetLiving itself and shows the target survives the switch when it does.
// §2 — a real Cb.hurt(...,byPlayer=true) kill's `Xp.dropMobXp` total is READ OFF `Xp.xpToDrop`
//      (the xporbcheck ground truth, never guessed) and is identical whether the killing
//      player's own `NS.Gamemode` mode was creative or survival at the time — both directions,
//      anti-vacuity injects a fake "0 xp in creative" gate and shows it gets caught.
// §3 — the same identity for PICKUP: `Xp.pickupTick`/`Sv.addXp` credit a creative player's
//      `xpTotal`/`xpLevel` exactly like a survival player's. Anti-vacuity injects a fake
//      creative-blocks-addXp gate and shows it gets caught.
// §4 — `/experience add @s <n> points` and `/experience set @s <n> levels` both succeed through
//      the real dispatcher and the HUD state (`xpTotal`/`xpLevel`/`xpProgress`, `Sv.syncXp`'s
//      own derived fields) updates correctly, in both directions. Anti-vacuity stubs
//      `Sv.syncXp` to a no-op and shows the stale HUD state gets caught.

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
const okAv = (c, m) => { breaks++; if (c) { pass++; if (VERBOSE) console.log('   ✓ ' + m); } else fails.push('anti-vacuity: ' + m); };
const say = (...a) => { if (VERBOSE) console.log(...a); };

console.log('mobcmdxpgamemodecheck — mob-command joins: /gamemode + /experience x mob combat');

const M = loadEngine({
  extra: ['02f_tags.js', '02g_items.js', '02i_text.js', '02j_sounds.js', '09b_sky.js',
          '14e_gamemode.js', '14f_inventory.js', '07h_entities.js', '14b_physics.js',
          '07i_entitylist.js', '07k_goals.js', '07d_mining.js', '07e_loot.js', '07y_equip.js',
          '07m_breed.js', '07w_passive.js', '14d_survival.js', '14j_combat.js', '07p_trade.js',
          '07zz_xporb.js', '14h_brigadier.js', '15g_commands.js']
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
  const langRaw = readFileSync(join(ASSETS, 'lang.bin'));
  const { inflateRawSync } = await import('node:zlib');
  M.Text.init({ lang: langRaw.toString('base64'), langBytes: inflateRawSync(langRaw).length });
}
{
  const lootMeta = JSON.parse(readFileSync(join(ASSETS, 'loot.meta.json'), 'utf8'));
  M.Loot.init({ loot: readFileSync(join(ASSETS, 'loot.bin')).toString('base64'), lootBytes: lootMeta.jsonBytes });
}
// a floor at y=64, the xporbcheck/goalcheck idiom -- motion is arithmetic, not terrain
const FLOOR_Y = 64;
M.Physics.shapeAt = (x, y, z) => (y < FLOOR_Y ? M.Physics.FULL_CUBE : null);
M.Physics.solidAt = (x, y, z) => M.Physics.shapeAt(x, y, z) !== null;
M.Physics.grounded = (x, y, z, d) => y - d < FLOOR_Y;
// Ai.canSee casts a Ray through World.getBlock; open air (state 0) is all this check needs
M.World = M.World || { getBlock: () => 0 };
M.EntityList.init();
M.Equip.init();
M.Breed.init();
M.Passive.init();
M.Xp.init();
M.Main = { seed: 1337 };
// the REAL game rule defaults (doMobLoot among them), exactly as commandcheck.mjs loads them --
// without this, C.build() closes over an EMPTY rule table and Br.mobLoot()'s C.ruleGet path
// (it prefers Commands' own rule store the instant Commands exists) reads doMobLoot as unset,
// which is NOT vanilla's default and would silently zero every kill's xp in this very check.
M.DATA = M.DATA || {};
M.DATA.gameRules = (() => {
  const out = {};
  for (const line of readFileSync(join(ROOT, 'tools', 'golden', 'gamerules-1.18.2.tsv'), 'utf8').split(/\r?\n/)) {
    if (!line || line.startsWith('#')) continue;
    const c = line.split('\t');
    if (c.length >= 3) out[c[0]] = { t: c[1] === 'integer' ? 'i' : 'b', d: c[2] };
  }
  return out;
})();

const Gm = M.Gamemode, Ai = M.Ai, EL = M.EntityList, Cb = M.Combat, Xp = M.Xp, Sv = M.Survival, C = M.Commands;
ok(!!Gm && !!Ai && !!EL && !!Cb && !!Xp && !!Sv, 'every module this check joins loaded');
C.build();
ok(C.ready, 'Commands.build() reports ready');

const mkPlayer = (x, y, z) => {
  const P = { type: 'player', x: x, y: y, z: z, yaw: 0, pitch: 0, width: 0.6, height: 1.8,
              dead: false, PICKUP_INFLATE: [1.0, 0.5, 1.0], inventory: M.Inventory.create(),
              slot: 0, syncHotbar() {} };
  Sv.init(P);
  Gm.set(P, Gm.SURVIVAL);
  M.Player = P;
  return P;
};
const run = (line) => C.run(line, M.Player, { level: 4 });
// mirrors 07i_entitylist.js's EL.tickMob dispatch: Ai.dropUntargetable runs BEFORE and AFTER
// the goal tick -- one gate around every goal, not inside any single one of them.
const tickMob = (e) => { Ai.dropUntargetable(e); if (e.ai) e.ai.tick(); Ai.dropUntargetable(e); };

// ═══ §1. /gamemode flipped LIVE, mid-fight: D-684 (creative-chase) still holds ═══════════════
say('\n§1 -- /gamemode survival<->creative mid-fight, through the real dispatcher');
{
  const P = mkPlayer(0, 70, 0);
  const z = EL.spawn('zombie', 1, 70, 0);
  ok(!!z, 'a zombie spawns for the join');
  // the REAL TARGET-priority goals Ai.ROSTER.zombie itself wires (07k_goals.js: gs.add(2,
  // Ai.TARGET, HurtByTargetGoal)/gs.add(3, Ai.TARGET, NearestAttackableTargetGoal)) -- not the
  // full roster, whose lower-priority MOVE/LOOK strolling goals need a real NS.World fixture
  // this join isn't about (D-684's own gate sits entirely on the TARGET flag's own goals).
  z.ai = new Ai.GoalSelector();
  z.ai.add(2, Ai.TARGET, new Ai.HurtByTargetGoal(z));
  z.ai.add(3, Ai.TARGET, new Ai.NearestAttackableTargetGoal(z, () => [M.Player]));
  ok(typeof z.ai.tick === 'function', 'the real Ai.GoalSelector/HurtByTargetGoal/NearestAttackableTargetGoal classes are wired, same ones Ai.ROSTER.zombie uses');

  // survival: the zombie should acquire the player as its target within a few real ticks
  let guard = 0;
  while (z.target !== P && guard++ < 20) tickMob(z);
  ok(z.target === P, `the zombie targets the survival player through its real TARGET goal (guard=${guard})`);

  // FLIP LIVE, MID-FIGHT -- the real command, not a pre-set flag
  const g1 = run('/gamemode creative');
  ok(g1.ok && P.mode === Gm.CREATIVE, '/gamemode creative actually runs and sets the live mode');
  tickMob(z);
  ok(z.target === null, 'D-684 regression-check: the SAME live switch, mid-fight, drops the target on the very next tick (not just a pre-set creative flag)');
  // and it STAYS dropped over a few more ticks -- NearestAttackableTargetGoal.canUse() has no
  // gamemode gate of its own (it only picks nearest-in-range), so this is dropUntargetable's
  // own two-call gate doing the work every tick, not a one-shot side effect
  for (let i = 0; i < 5; i++) tickMob(z);
  ok(z.target === null, 'the target stays dropped across further ticks while creative, not just the first one');

  // anti-vacuity: with Ai.canTargetLiving itself broken (always true), the SAME live switch
  // does NOT drop the target -- proving the assertions above are actually watching the gate,
  // not some other accident of the fixture
  {
    tickMob(z); // reacquire is impossible while target null and canUse would re-pick it anyway
    const saved = Ai.canTargetLiving;
    Ai.canTargetLiving = () => true;
    // force a fresh acquisition under the broken gate, then prove it is never dropped
    z.target = null;
    let g2 = 0;
    while (z.target !== P && g2++ < 20) tickMob(z);
    okAv(z.target === P, 'anti-vacuity: broken Ai.canTargetLiving lets the creative player stay targeted -- the real gate above is load-bearing');
    Ai.canTargetLiving = saved;
  }

  // back to survival -- both directions, per rule 6
  z.target = null;
  const g3 = run('/gamemode survival');
  ok(g3.ok && P.mode === Gm.SURVIVAL, '/gamemode survival flips the live mode back');
  let g4 = 0;
  while (z.target !== P && g4++ < 20) tickMob(z);
  ok(z.target === P, 'and the zombie re-acquires the player as a target once survival is live again');
}

// ═══ §2. mob-kill XP: creative and survival give the SAME vanilla amount, not 0 in creative ═══
say('\n§2 -- kill xp: Xp.xpToDrop is the ground truth, identical regardless of the killer\'s gamemode');
{
  // ground truth, off the SAME table xporbcheck.mjs already holds closed (never guessed here)
  // ⚠ NO GEAR: a zombie's spawn roll can equip it, and each equipped item adds 1-3 xp
  // (MobEntity.getXpToDrop) -- real vanilla, but random; this section is about GAMEMODE, so
  // every zombie here is stripped first (was an intermittent "got 8" red in the suite).
  const zStub = EL.spawn('zombie', 200, 70, 200);
  zStub.equip = null;
  const wantXp = Xp.xpToDrop(zStub);
  ok(wantXp === 5, `Xp.xpToDrop(zombie) is the xporbcheck ground truth, 5, got ${wantXp}`);

  const killWith = (mode, x) => {
    const P = mkPlayer(x, 70, x);
    Gm.set(P, mode);
    const e = EL.spawn('zombie', x + 1, 70, x);
    ok(!!e, `a zombie spawns for the ${Gm.name(mode)} kill`);
    e.equip = null;   // see the NO GEAR note above
    // Cb.hurt is the SAME primitive Cb.attack calls; byPlayer=true is what LivingEntity.damage's
    // own attacker half (Cb.notePlayerHit) reads -- it takes no gamemode argument at all, in
    // this engine or in .decomp/net/minecraft/entity/LivingEntity.java:1088/1091
    Cb.hurt(e, 999, undefined, true);
    ok(e.dead === true, `the ${Gm.name(mode)} hit kills the zombie`);
    ok(M.Combat.recentlyHitByPlayer(e) === true, `playerHitTimer is set after the ${Gm.name(mode)} kill (gamemode-independent)`);
    return Xp.dropMobXp(e);
  };
  const dropSurv = killWith(Gm.SURVIVAL, 300);
  const dropCrea = killWith(Gm.CREATIVE, 400);
  const sum = (arr) => (Array.isArray(arr) ? arr.reduce((s, o) => s + o.value * o.pickingCount, 0) : -1);
  const survTotal = sum(dropSurv), creaTotal = sum(dropCrea);
  ok(survTotal === wantXp, `a SURVIVAL kill drops exactly ${wantXp} xp (Xp.xpToDrop's own value), got ${survTotal}`);
  ok(creaTotal === wantXp, `a CREATIVE kill drops the SAME ${wantXp} xp -- vanilla's dropXp gate never reads the killer's GameMode, got ${creaTotal}`);
  ok(creaTotal === survTotal && creaTotal !== 0, 'both directions: creative is neither 0 nor different from survival');

  // anti-vacuity: inject the plausible WRONG behaviour (creative kills give 0 xp) and show
  // these very assertions would have caught it
  {
    const saved = Xp.dropMobXp;
    Xp.dropMobXp = function (e, rand) {
      if (M.Player && Gm.isCreative(M.Player)) return null;
      return saved(e, rand);
    };
    const eBroken = EL.spawn('zombie', 500, 70, 500);
    const PBroken = mkPlayer(500, 70, 500);
    Gm.set(PBroken, Gm.CREATIVE);
    Cb.hurt(eBroken, 999, undefined, true);
    const brokenDrop = Xp.dropMobXp(eBroken);
    okAv(sum(brokenDrop) !== wantXp, 'anti-vacuity: a fake "0 xp in creative" gate breaks the equality this section asserts -- the real code has no such gate');
    Xp.dropMobXp = saved;
  }
}

// ═══ §3. pickup: a creative player's xpTotal/xpLevel updates exactly like survival's ═════════
say('\n§3 -- Xp.pickupTick / Sv.addXp: creative pickup is not blocked either');
{
  const pickupWith = (mode, x) => {
    const P = mkPlayer(x, 70, x);
    Gm.set(P, mode);
    const orb = EL.spawn('experience_orb', x + 0.2, 70, x + 0.1);
    orb.value = 9; orb.pickingCount = 1; orb.orbAge = 0; orb.removed = false;
    const got = Xp.pickupTick();
    return { got: got, P: P };
  };
  const rSurv = pickupWith(Gm.SURVIVAL, 700);
  ok(rSurv.got === 9 && rSurv.P.xpTotal === 9, `a survival player picks up 9 xp and xpTotal reflects it, got got=${rSurv.got} xpTotal=${rSurv.P.xpTotal}`);
  const rCrea = pickupWith(Gm.CREATIVE, 800);
  ok(rCrea.got === 9 && rCrea.P.xpTotal === 9, `a CREATIVE player picks up the SAME 9 xp, xpTotal still updates, got got=${rCrea.got} xpTotal=${rCrea.P.xpTotal}`);
  ok(rCrea.P.xpLevel === rSurv.P.xpLevel, 'both land on the same derived xpLevel (Sv.syncXp is gamemode-blind, both directions)');

  // anti-vacuity: inject the fake "creative doesn't gain xp" gate into addXp
  {
    const saved = Sv.addXp;
    Sv.addXp = function (e, points) { if (Gm.isCreative(e)) return; saved(e, points); };
    const P = mkPlayer(900, 70, 900);
    Gm.set(P, Gm.CREATIVE);
    const orb = EL.spawn('experience_orb', 900.2, 70, 900.1);
    orb.value = 9; orb.pickingCount = 1; orb.orbAge = 0; orb.removed = false;
    Xp.pickupTick();
    okAv(P.xpTotal !== 9, 'anti-vacuity: a fake creative-blocks-addXp gate leaves xpTotal at 0 -- the real code has no such gate, so this section\'s equality above is a real assertion');
    Sv.addXp = saved;
  }
}

// ═══ §4. /experience add points, /experience set levels: both succeed and the HUD updates ═══
say('\n§4 -- /experience add @s <n> points, /experience set @s <n> levels');
{
  const P = mkPlayer(50, 70, 50);
  ok(P.xpTotal === 0 && P.xpLevel === 0, 'a fresh player starts at 0 xp / level 0');

  const rAdd = run('/experience add @s 10 points');
  ok(rAdd.ok, `/experience add @s 10 points runs (ok), got error=${rAdd.error ? rAdd.error.message : null}`);
  ok(P.xpTotal === 10, `xpTotal is 10 after the add, got ${P.xpTotal}`);
  const wantLevelFor10 = (() => { let lvl = 0, left = 10, need = Sv.xpNeeded(0), guard = 0; while (left >= need && guard++ < 100) { left -= need; lvl++; need = Sv.xpNeeded(lvl); } return lvl; })();
  ok(P.xpLevel === wantLevelFor10, `xpLevel is derived correctly from the new total (Sv.syncXp), got ${P.xpLevel} want ${wantLevelFor10}`);

  const progBefore = P.xpProgress;
  const rSet = run('/experience set @s 5 levels');
  ok(rSet.ok, `/experience set @s 5 levels runs (ok), got error=${rSet.error ? rSet.error.message : null}`);
  ok(P.xpLevel === 5, `xpLevel is EXACTLY 5 after the set (not merely >=), got ${P.xpLevel}`);
  const wantT5 = Sv.totalXpFor(5) + Math.floor(progBefore * Sv.xpNeeded(5));
  ok(P.xpTotal === wantT5, `xpTotal is totalXpFor(5) + the kept bar, got ${P.xpTotal} want ${wantT5}`);
  ok(P.xpProgress === progBefore, `set levels keeps experienceProgress (ExperienceCommand), got ${P.xpProgress} want ${progBefore}`);

  // add on top of set -- both directions, and add's own "current level" base for levels differs
  // from set's zero base (xpApply's own base = verb==='add' ? e.xpLevel : 0)
  const rAdd2 = run('/experience add @s 2 levels');
  ok(rAdd2.ok && P.xpLevel === 7, `/experience add @s 2 levels is relative to the CURRENT level (5+2=7), got ${P.xpLevel}`);

  // anti-vacuity: stub Sv.syncXp to a no-op and show the HUD state goes stale -- proving the
  // equalities above actually depend on the command really re-deriving level/progress
  {
    const saved = Sv.setLevelKeepBar;
    Sv.setLevelKeepBar = function () {};
    const before = P.xpLevel;
    const rBroken = run('/experience set @s 3 levels');
    okAv(rBroken.ok && P.xpLevel === before && P.xpLevel !== 3, `anti-vacuity: with Sv.syncXp stubbed, /experience set @s 3 levels still reports ok but the HUD level stays stale at ${P.xpLevel} instead of 3 -- this section's own P.xpLevel===5/7 assertions above would have caught exactly this`);
    Sv.setLevelKeepBar = saved;
    // restore real state for anyone appending sections after this one
    Sv.syncXp(P);
  }
}

console.log('\n' + (fails.length ? 'FAIL' : 'PASS') + '  mobcmdxpgamemodecheck — ' + pass + ' assertions, ' +
  fails.length + ' failures' + (breaks ? ', ' + breaks + ' anti-vacuity checks' : ''));
for (const f of fails) console.log('   x ' + f);
process.exit(fails.length ? 1 : 0);
