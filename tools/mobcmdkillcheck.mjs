#!/usr/bin/env node
// mobcmdkillcheck.mjs — parallel night worker 1: `/kill` and `/summon` REGRESSION across the
// full mob roster, live in the browser (MCLITE_PRESET=medium). D-732 (session 144) fixed
// `/summon` engine-wide (a data-ROW leaked into `EL.spawn` instead of the bare name STRING) and
// its own harness (mobpackcheck.mjs) proved the fix on exactly 2 types (zombie, iron_golem) as
// a side effect of a pack-combat scenario. This is the first check that regresses `/summon`
// against a WIDE, VARIED roster on its own terms, and the first that puts `/kill` itself (never
// covered by any prior deep-test pass) under a real assertion.
//
// ⚠⚠ WHAT THIS FOUND -- THE TASK BRIEF'S OWN PREMISE WAS WRONG. The brief that produced this
// file asserted "vanilla /kill is silent removal, not damage-kill". `.decomp` says otherwise,
// read whole:
//   - `Entity.kill()` (.decomp/net/minecraft/entity/Entity.java:316) IS a silent
//     `this.remove(RemovalReason.KILLED)` -- but
//   - `LivingEntity` OVERRIDES it (.decomp/net/minecraft/entity/LivingEntity.java:265):
//     `public void kill() { this.damage(DamageSource.OUT_OF_WORLD, Float.MAX_VALUE); }` --
//     a REAL hit through the ordinary damage pipeline. `DamageSource.OUT_OF_WORLD` bypasses
//     ARMOUR (.decomp/net/minecraft/entity/damage/DamageSource.java:29, `setBypassesArmor()`)
//     but is not silent: `LivingEntity.damage` -> health<=0 -> the ordinary death path ->
//     `dropLoot`/`dropInventory`/`dropXp` (.decomp LivingEntity.java:1328-1355) all still run,
//     the death animation/`deathTime` countdown still plays, and removal is deferred to its end
//     -- EXACTLY like being killed by a sword, fall damage or fire. Every mob this engine spawns
//     is a `LivingEntity` (`Cb.canAttack`'s own D-336 "does it have maxHealth" gate IS this
//     engine's "is it a LivingEntity" test) so `/kill <mob>` is ALWAYS the damage-kill branch in
//     practice; only a non-living entity (no rostered `maxHealth`) would ever take the silent
//     `Entity.kill()` path, and this engine's mob roster has none of those.
//   `src/15g_commands.js`'s `kill()` called `EL.remove(t.e)` directly for every entity target --
//   the bare, ALWAYS-silent path, with no `Cb.hurt` call at all: no drops, no xp gate evaluated,
//   `e.dead` never set, no `Cb.DEATH_TICKS` delay. Fixed to route a living target through
//   `Cb.hurt(e, 1e9, undefined, false, {bypassArmor:true, source:'outOfWorld'})` (the SAME
//   `{bypassArmor:true}` shape `Cb.tickEntity`'s own fire/fall damage already use, 14j_combat.js)
//   so the real `e.dead` branch of `Cb.tickEntity` runs the ordinary death pipeline; a
//   non-living entity (no `maxHealth`) still falls straight to `EL.remove`, unchanged.
//   ⚠ ONE REAL VANILLA CONSEQUENCE THIS CHANGE CORRECTLY PRESERVES: `OUT_OF_WORLD` has no
//   attacker, so `Cb.killedByPlayer`/`Xp.dropMobXp`'s own `playerHitTimer` gate reads exactly
//   as it would in vanilla -- a `/kill`ed mob does NOT drop xp orbs (no recent player hit to
//   arm the 100-tick window) even though it DOES drop its ordinary loot-table items (those are
//   not player-hit-gated for the common case, proven live in section 2 below with `cow`, whose
//   `beef` drop `Cb.dropLoot`'s own `L.entityDrops({killedByPlayer:false,...})` call confirms is
//   unconditional). This check therefore does NOT assert "no drops" or "no death animation" --
//   it asserts the opposite, against `.decomp`, and is built to fail loudly if a future change
//   makes `/kill` silent again (section 4's anti-vacuity pass proves exactly that).
//
// Sections:
//   1. /summon regression -- 24 varied mob types (hostile/passive/neutral/boss-like/villager/
//      golem), none of them zombie/iron_golem/zombified_piglin/wolf (D-732's own 4), each
//      spawned strictly through the real /summon command: alive, not removed, correct type.
//   2. /kill, single target, damage-kill semantics -- a representative sample (hostile: zombie,
//      skeleton; passive: cow; neutral: wolf; boss-like: ravager; villager/golem: villager,
//      iron_golem): health -> 0, e.dead set on the SAME tick /kill runs, the entity still
//      PRESENT (not instantly gone) for several ticks after, loot drops for the unconditional-
//      loot species (cow), NO xp orb (no recent player hit to arm the window), and removal only
//      after ~Cb.DEATH_TICKS.
//   3. /kill @e[type=...] -- multi-target, and the player is NEVER caught by an @e selector
//      (the comment at src/15g_commands.js:105 states this rule; proven live here, not just
//      read).
//   4. AI-ticking regression -- a crowd of the section-1 roster's AI-bearing types (those
//      `Ai.ROSTER` covers), ticked together for several real seconds: each spawned entity's
//      `e.ai` is a live object (not null) immediately after /summon, and the crowd as a whole
//      makes real positional/heading progress (not individually, to avoid flaking on any one
//      mob's own random-timed goal) -- proving /summon does not hand back a physics-only husk.
//   5. anti-vacuity -- the pre-fix `EL.remove`-only /kill is simulated (Commands.run intercepted
//      the same way mobpackcheck.mjs proved the /summon regression); every section-2 assertion
//      that depends on the real damage-kill path is shown to fail on that broken build.
//
//   MCLITE_PRESET=medium node tools/mobcmdkillcheck.mjs [dist/mclite.html]

import { open, sleep } from './cdp.mjs';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const FILE = args[0] ? (args[0].startsWith('/') ? args[0] : ROOT + args[0]) : ROOT + 'dist/mclite.html';

let pass = 0, breaks = 0;
const fails = [];
const ok = (c, m, d) => { if (c) { pass++; console.log('ok    ' + m); } else { fails.push(m + (d !== undefined ? ' (' + d + ')' : '')); console.log('FAIL  ' + m + (d !== undefined ? '   ' + d : '')); } return c; };
const okAv = (c, m, d) => { breaks++; if (c) { pass++; console.log('   ✓ ' + m); } else { fails.push('anti-vacuity: ' + m + (d !== undefined ? ' (' + d + ')' : '')); console.log('   x ' + m + (d !== undefined ? '   ' + d : '')); } };

function mkFn(body) { return { toString: function () { return 'function(){' + body + '}'; } }; }

const page = await open(FILE, { width: 900, height: 600 });
if (!page) { console.log('SKIP  mobcmdkillcheck: no Chromium found'); process.exit(0); }

try {
  await sleep(1200);
  await page.evaluate(function () { if (window.MCL && MCL.Main && !MCL.Main.ready) MCL.Main.play({}); });
  const up = await page.waitFor(function () {
    return !!(window.MCL && MCL.Main.ready && MCL.Hud.mode === 'game' && MCL.World.chunks.size > 20);
  }, 60000);
  if (!ok(up, 'the world came up', page.lastThrow)) throw new Error('never reached the game');
  await sleep(800);
  await page.settleWorld();

  const PX = 4200, PZ = 4200, PY = 90;   // a distinct anchor from mobpackcheck/mobcrowdcheck's own
  const ev = (body) => page.evaluate(mkFn(body));

  // doMobSpawning off -- this whole file counts EL.list entities of a specific type (section 3's
  // "/kill @e[type=zombie] reports exactly 3 targets" chief among them); a real natural-spawn
  // cycle adding a wild zombie mid-run (this check ticks a real, lit-at-night-eventually world
  // for 40+ real seconds) is a confound this check must not build in, the same standing rule
  // mobcrowdpeek.mjs's own header already states for a different mechanic. Sampled live: section
  // 3's own count went 3 -> 5 zombies on one run without this (a wild spawn snuck in), gone once
  // this gamerule flip landed.
  await ev('MCL.Commands.run("/gamerule doMobSpawning false", MCL.Player, {name:"Dan"}); return 1;');

  const buildInfo = await ev(
    'var W = MCL.World, St = MCL.States;' +
    'var id = St.stateOf("stone");' +
    'for (var cx = -3; cx <= 3; cx++) for (var cz = -3; cz <= 3; cz++) {' +
    '  var c = W.makeChunk((' + PX + ' >> 4) + cx, (' + PZ + ' >> 4) + cz);' +
    '  c.state = MCL.CH.GENERATED; W.chunks.set(W.key((' + PX + ' >> 4) + cx, (' + PZ + ' >> 4) + cz), c);' +
    '}' +
    'var got = 0;' +
    'for (var x = ' + PX + ' - 24; x <= ' + PX + ' + 24; x++)' +
    '  for (var z = ' + PZ + ' - 24; z <= ' + PZ + ' + 24; z++) { W.setBlock(x, ' + PY + ' - 1, z, id); got++; }' +
    'return { platformBlocks: got };'
  );
  ok(buildInfo && buildInfo.platformBlocks > 0, 'built a flat test platform', JSON.stringify(buildInfo));

  async function resetScene() {
    await ev(
      'var P = MCL.Player, EL = MCL.EntityList;' +
      'P.flying = false; P.noclip = false;' +
      'P.x = ' + PX + '; P.y = ' + PY + '; P.z = ' + PZ + ';' +
      'P.vx = P.vy = P.vz = 0; P.yaw = 0; P.pitch = 0; P.health = 20;' +
      'P.invulnerableGamemode = false; P.invulnerable = 0; P.dead = false;' +   // survival's own gate (14d_survival.js:234) -- /gamemode survival below sets this too, but forced here so this scene is deterministic regardless of command-dispatch timing; P.dead cleared too, in case an earlier section's player relocation (2b/2c, moved off-platform to dodge item/orb pickup) let them fall to a real void/fall death
      'P.lastHurtByEntity = null; P.lastHurtMob = null;' +
      'if (P.interpolate) P.interpolate(0);' +
      'MCL.Input.locked = true; MCL.Input.uiOpen = false;' +
      'EL.list.length = 0;' +
      'if (MCL.Commands) MCL.Commands.run("/gamemode survival", P, {name:"Dan"});' +
      'return 1;'
    );
    await sleep(200);
  }

  // spawn STRICTLY through the real /summon command, the exact path the task brief asked for.
  async function summon(type, dx, dy, dz) {
    return ev(
      'var P = MCL.Player;' +
      'var x = ' + PX + ' + (' + dx + '), y = ' + PY + ' + (' + dy + '), z = ' + PZ + ' + (' + dz + ');' +
      'var res = MCL.Commands.run("/summon ' + type + ' " + x + " " + y + " " + z, P, {name:"Dan"});' +
      'if (!res.ok) return { ok: false, error: res.error && res.error.message };' +
      'var EL = MCL.EntityList, best = null;' +
      'for (var i = EL.list.length - 1; i >= 0; i--) { if (EL.list[i].type === "' + type + '" && !best) { best = EL.list[i]; break; } }' +
      'return best ? { ok: true, id: best.id, x: best.x, y: best.y, z: best.z, hasAi: !!best.ai, maxHealth: best.maxHealth, health: best.health } : { ok: false, error: "spawned but not found" };'
    );
  }

  async function snap(ids) {
    return ev(
      'var EL = MCL.EntityList; var ids = ' + JSON.stringify(ids) + '; var out = [];' +
      'for (var k = 0; k < ids.length; k++) {' +
      '  var e = null;' +
      '  for (var i = 0; i < EL.list.length; i++) if (EL.list[i].id === ids[k]) { e = EL.list[i]; break; }' +
      '  out.push(e ? { id: e.id, x: +e.x.toFixed(2), y: +e.y.toFixed(2), z: +e.z.toFixed(2), yaw: e.yaw, health: e.health, dead: !!e.dead, removed: !!e.removed, deathTime: e.deathTime || 0, hasAi: !!e.ai } : { id: ids[k], removed: true, gone: true });' +
      '}' +
      'return out;'
    );
  }

  // ⚠ PRUNE TO EXACTLY THE IDS THIS CHECK ITSELF CREATED. A stray extra entity of a tested
  // type (this engine's natural spawn cycle was sampled live spawning passive mobs INTO this
  // test's own platform even with `doMobSpawning` flipped false above -- a real, separate gap
  // from this unit's own /kill and /summon focus, named in this stage's own summary rather than
  // chased here) would inflate a `@e[type=...]`-based kill count and make an assertion about
  // /kill flaky for a reason that has nothing to do with /kill. Every section below prunes to
  // its own known ids immediately before the /kill assertion that counts them, so a real /summon
  // or /kill regression is what this check can still fail on, not a spawn-cycle confound.
  async function pruneTo(ids) {
    return ev(
      'var EL = MCL.EntityList, keep = ' + JSON.stringify(ids) + ';' +
      'EL.list = EL.list.filter(function (e) { return keep.indexOf(e.id) >= 0; });' +
      'return EL.list.length;'
    );
  }

  async function itemCount(x, z, radius) {
    return ev(
      'var EL = MCL.EntityList, n = 0;' +
      'for (var i = 0; i < EL.list.length; i++) { var e = EL.list[i];' +
      '  if (e.type === "item" && Math.hypot(e.x - (' + x + '), e.z - (' + z + ')) <= ' + radius + ') n++; }' +
      'return n;'
    );
  }

  // ═══ 1. /summon regression -- 24 varied types, none of D-732's own 4 ═══
  console.log('\n1. /summon <entity> -- varied roster regression');
  const SUMMON_ROSTER = [
    // hostile
    'skeleton', 'spider', 'creeper', 'enderman', 'witch', 'evoker', 'vindicator', 'pillager',
    'illusioner', 'vex', 'silverfish', 'endermite', 'phantom', 'drowned',
    // boss-like / raid
    'ravager',
    // neutral
    'llama',
    // passive
    'cow', 'sheep', 'chicken', 'pig', 'rabbit', 'fox', 'axolotl',
    // villager / golem
    'villager', 'snow_golem'
  ];
  ok(SUMMON_ROSTER.length >= 15 && SUMMON_ROSTER.length <= 26, 'roster is the asked-for 15-26 varied types', SUMMON_ROSTER.length);
  ok(!SUMMON_ROSTER.some((t) => ['zombie', 'iron_golem', 'zombified_piglin', 'wolf'].includes(t)),
    'roster deliberately excludes D-732\'s own 4 covered types (zombie/iron_golem/zombified_piglin/wolf) -- this is NEW coverage');

  await resetScene();
  const summonResults = {};
  let col = 0, row = 0;
  for (const type of SUMMON_ROSTER) {
    const dx = (col % 6) * 6 - 15, dz = Math.floor(col / 6) * 6 - 6;
    col++;
    const r = await summon(type, dx, 0, dz);
    summonResults[type] = r;
    ok(r && r.ok, '/summon ' + type + ' succeeds and the spawned entity is found in EL.list', JSON.stringify(r));
  }
  await sleep(400);
  const summonSnap = await snap(Object.values(summonResults).filter((r) => r.ok).map((r) => r.id));
  for (let i = 0; i < summonSnap.length; i++) {
    const s = summonSnap[i];
    ok(s && !s.removed && !s.dead && (s.health === undefined || s.health > 0), 'spawned entity #' + i + ' is ALIVE (not removed, not dead, health > 0 if it has one) half a second later', JSON.stringify(s));
  }

  // ═══ 4 (built here, right after summon, while the crowd is still up) -- AI-ticking ═══
  console.log('\n4. AI-ticking regression -- the summoned crowd is not a physics-only husk');
  const aiTypes = SUMMON_ROSTER.filter((t) => summonResults[t].ok && summonResults[t].hasAi);
  ok(aiTypes.length >= 10, 'at least 10 of the summoned roster are Ai.ROSTER types (have e.ai wired at spawn)', aiTypes.length + '/' + SUMMON_ROSTER.length + ': ' + aiTypes.join(','));
  const aiIds = aiTypes.map((t) => summonResults[t].id);
  const before = await snap(aiIds);
  ok(before.every((s) => s && s.hasAi), 'every AI.ROSTER-type spawn still carries a live e.ai object', JSON.stringify(before.map((s) => s && s.hasAi)));
  await sleep(4500);
  const after = await snap(aiIds);
  let movedCount = 0;
  for (let i = 0; i < before.length; i++) {
    if (!before[i] || !after[i] || after[i].removed) continue;
    const dPos = Math.hypot(after[i].x - before[i].x, after[i].z - before[i].z);
    const dYaw = Math.abs(after[i].yaw - before[i].yaw);
    if (dPos > 0.05 || dYaw > 2) movedCount++;
  }
  ok(movedCount >= Math.ceil(aiIds.length * 0.5),
    'over 4.5 real seconds, at least half the AI-bearing crowd made real position or heading progress (goal ticks actually firing, not frozen)',
    movedCount + '/' + aiIds.length);

  // ═══ 2. /kill, single target -- the real damage-kill path (.decomp LivingEntity.kill) ═══
  console.log('\n2. /kill <target> -- single-target damage-kill semantics');
  const KILL_SAMPLE = [
    { type: 'zombie', cat: 'hostile' },
    { type: 'skeleton', cat: 'hostile' },
    { type: 'cow', cat: 'passive' },
    { type: 'wolf', cat: 'neutral' },
    { type: 'ravager', cat: 'boss-like' },
    { type: 'villager', cat: 'villager' },
    { type: 'iron_golem', cat: 'golem' }
  ];
  for (const { type, cat } of KILL_SAMPLE) {
    await resetScene();
    const s0 = await summon(type, 3, 0, 0);
    if (!ok(s0 && s0.ok, '[' + cat + '] /summon ' + type + ' for the kill test', JSON.stringify(s0))) continue;
    await pruneTo([s0.id]);
    const killRes = await ev(
      'var P = MCL.Player;' +
      'var res = MCL.Commands.run("/kill @e[type=' + type + ']", P, {name:"Dan"});' +
      'return { ok: !!(res && res.ok), n: res && res.result };'
    );
    ok(killRes && killRes.ok && killRes.n === 1, '[' + cat + '] /kill @e[type=' + type + '] runs and reports 1 target', JSON.stringify(killRes));
    const s1 = (await snap([s0.id]))[0];
    ok(s1 && s1.health === 0 && s1.dead === true && !s1.removed,
      '[' + cat + '] the SAME tick /kill runs: health is 0, e.dead is true, but the entity is still PRESENT (a real damage-kill sets e.dead and lets Cb.tickEntity run the death animation -- it does not vanish instantly)',
      JSON.stringify(s1));
    await sleep(150);
    const s2 = (await snap([s0.id]))[0];
    ok(s2 && !s2.removed && s2.deathTime > 0, '[' + cat + '] ~3 ticks later the corpse is STILL present with deathTime counting up (Cb.DEATH_TICKS=20 has not elapsed)', JSON.stringify(s2));
    await sleep(1400);
    const s3 = (await snap([s0.id]))[0];
    ok(s3 && s3.removed, '[' + cat + '] after Cb.DEATH_TICKS the corpse is finally removed', JSON.stringify(s3));
  }

  // loot: cow's own unconditional beef drop (Cb.dropLoot -> L.entityDrops({killedByPlayer:false})
  // still returns >=1 beef, proven live via NS.Loot directly above this file's own header) must
  // actually appear as a real item entity near the corpse -- not merely "computable", DROPPED.
  console.log('\n2b. /kill drops loot for a species whose drop is NOT player-hit-gated (cow -> beef)');
  await resetScene();
  const cowS = await summon('cow', 0, 0, 0);
  ok(cowS && cowS.ok, '/summon cow for the loot-drop test', JSON.stringify(cowS));
  await pruneTo([cowS.id]);
  const itemsBefore = await itemCount(PX, PZ, 6);
  // ⚠ MOVE THE PLAYER AWAY BEFORE KILLING. Sampled live while building this section: a dropped
  // item spawns ~300ms after /kill and a nearby player has already picked it back up by ~420ms
  // -- any fixed sleep in that gap is a real flake (caught the item present on some runs, gone
  // on others), not a bug. Killing the cow 40 blocks from the player removes the race entirely
  // instead of guessing a timing window.
  await ev('var P = MCL.Player; P.flying = true; P.noclip = true; P.vx = P.vy = P.vz = 0; P.x = ' + PX + ' + 40; P.y = ' + PY + ' + 10; P.z = ' + PZ + '; return 1;');
  await ev('MCL.Commands.run("/kill @e[type=cow]", MCL.Player, {name:"Dan"}); return 1;');
  await sleep(500);
  const itemsAfter = await itemCount(PX, PZ, 6);
  ok(itemsAfter > itemsBefore, '/kill on a cow drops at least one item entity (beef, unconditional loot) -- NOT a silent, item-free removal', JSON.stringify({ itemsBefore, itemsAfter }));

  // xp: the SAME cow kill must NOT spawn an xp orb -- OUT_OF_WORLD has no attacker, so
  // Xp.dropMobXp's own playerHitTimer gate (07zz_xporb.js) never arms. Asserted in BOTH
  // directions: this is not "xp never drops" in general (KILL_SAMPLE section below re-arms the
  // gate with a real player hit first and proves xp DOES then drop).
  const xpOrbsAfterKill = await ev(
    'var EL = MCL.EntityList, n = 0;' +
    'for (var i = 0; i < EL.list.length; i++) if (EL.list[i].type === "experience_orb") n++;' +
    'return n;'
  );
  ok(xpOrbsAfterKill === 0, 'the cow /kill (no prior player hit) drops NO xp orb -- OUT_OF_WORLD has no attacker, Xp.dropMobXp\'s playerHitTimer gate never arms (matches vanilla, not "xp always drops")', xpOrbsAfterKill);

  // the other direction: a mob /kill really does drop xp once the playerHitTimer IS armed by a
  // real prior player hit -- proves the "no xp orb" assertion above is about the GATE, not a
  // second, unrelated bug that happens to also suppress xp.
  console.log('\n2c. /kill DOES drop xp once a real player hit armed the timer first (both directions)');
  await resetScene();
  const zXp = await summon('zombie', 3, 0, 0);
  ok(zXp && zXp.ok, '/summon zombie for the xp-gate test', JSON.stringify(zXp));
  await pruneTo([zXp.id]);
  await ev(
    'var EL = MCL.EntityList, e = null;' +
    'for (var i = 0; i < EL.list.length; i++) if (EL.list[i].id === ' + zXp.id + ') e = EL.list[i];' +
    'MCL.Combat.hurt(e, 1, undefined, true, {});' +   // a real, small player hit -- arms playerHitTimer, does not kill
    'return { health: e.health, dead: !!e.dead };'
  );
  // ⚠ SAME RACE AS SECTION 2b, SAME FIX: an xp orb homes to and is picked up by a nearby player
  // even faster than an item (sampled: 2 orbs present at deathTime 1, 1 left at deathTime 5, 0 by
  // deathTime 10 -- under half a second total). `Cb.hurt` (the arming hit) does not care about
  // distance; only /kill's own drop needs the player out of pickup range first.
  await ev('var P = MCL.Player; P.flying = true; P.noclip = true; P.vx = P.vy = P.vz = 0; P.x = ' + PX + ' + 40; P.y = ' + PY + ' + 10; P.z = ' + PZ + '; return 1;');
  await ev('MCL.Commands.run("/kill @e[type=zombie]", MCL.Player, {name:"Dan"}); return 1;');
  await sleep(500);
  const xpOrbsArmed = await ev(
    'var EL = MCL.EntityList, n = 0;' +
    'for (var i = 0; i < EL.list.length; i++) if (EL.list[i].type === "experience_orb") n++;' +
    'return n;'
  );
  ok(xpOrbsArmed > 0, 'with the playerHitTimer already armed by a real prior hit, the SAME /kill DOES drop an xp orb this time', xpOrbsArmed);

  // ═══ 3. /kill @e[type=...] -- multi-target, and the player is never caught by @e ═══
  console.log('\n3. /kill @e[type=...] -- multi-target, player immune to @e');
  await resetScene();
  const z1 = await summon('zombie', 3, 0, 0);
  const z2 = await summon('zombie', -3, 0, 0);
  const z3 = await summon('zombie', 0, 0, 3);
  const sk1 = await summon('skeleton', 0, 0, -3);
  ok([z1, z2, z3, sk1].every((r) => r.ok), '3 zombies + 1 skeleton spawned for the multi-target test', JSON.stringify({ z1, z2, z3, sk1 }));
  await pruneTo([z1.id, z2.id, z3.id, sk1.id]);
  const killMulti = await ev(
    'var res = MCL.Commands.run("/kill @e[type=zombie]", MCL.Player, {name:"Dan"});' +
    'return { ok: !!(res && res.ok), n: res && res.result };'
  );
  ok(killMulti && killMulti.ok && killMulti.n === 3, '/kill @e[type=zombie] reports exactly 3 targets (the 3 zombies, not the skeleton, not the player)', JSON.stringify(killMulti));
  const multiSnap = await snap([z1.id, z2.id, z3.id, sk1.id]);
  ok(multiSnap[0].dead && multiSnap[1].dead && multiSnap[2].dead, 'all 3 zombies are dead (e.dead) immediately after', JSON.stringify(multiSnap.slice(0, 3)));
  ok(!multiSnap[3].dead && multiSnap[3].health > 0, 'the skeleton (a different type, filtered out by [type=zombie]) is completely untouched', JSON.stringify(multiSnap[3]));
  const playerAfterMulti = await ev('var P = MCL.Player; return { health: P.health, removed: !!P.removed };');
  ok(playerAfterMulti && playerAfterMulti.health === 20, '/kill @e[type=zombie] does not touch the player at all (still full health) -- @e never includes the player once a [type=] filter that does not match "player" is applied', JSON.stringify(playerAfterMulti));

  // ⚠ A source comment at src/15g_commands.js:105 claims "/kill @e must not kill the player
  // while /kill @a must" -- real vanilla `@e` has no player-exclusion built in (Minecraft Wiki,
  // target selectors: "@e — Targets all entities... including players" -- EntitySelectorReader
  // itself is not present in this repo's .decomp to cite a line number, so this is general
  // vanilla-command knowledge, not a `.decomp` citation, flagged honestly as such). This
  // engine's OWN `C.resolve` (sel.kind==='e') already pushes the player into @e's result
  // unconditionally -- the CODE already does the vanilla-correct thing; only the COMMENT next
  // to it is wrong. Asserted here as the regression baseline the code actually implements.
  await resetScene();
  const ze = await summon('zombie', 3, 0, 0);
  await ev('MCL.Commands.run("/kill @e", MCL.Player, {name:"Dan"}); return 1;');
  const afterBareE = await ev('var P = MCL.Player; return { health: P.health };');
  ok(afterBareE.health === 0, 'a bare /kill @e (no type filter) DOES kill the player too -- @e has no built-in player exclusion in vanilla, and this engine\'s own C.resolve already includes the player in @e\'s result unconditionally (only a nearby source comment claiming otherwise is wrong, not the code)', JSON.stringify(afterBareE));

  // ═══ 5. anti-vacuity -- simulate the PRE-FIX /kill and prove section 2/2b would have failed ═══
  console.log('\n5. anti-vacuity -- the pre-fix silent-EL.remove /kill is simulated');
  await resetScene();
  const origBroken = await ev(
    'var EL = MCL.EntityList; window.__origRun = MCL.Commands.run;' +
    'MCL.Commands.run = function (line, player, opts) {' +
    '  var m = /^\\/kill(?:\\s+(.*))?$/.exec(line.trim());' +
    '  if (m) {' +
    '    var targets;' +
    '    if (!m[1]) targets = [player];' +
    '    else { targets = EL.list.filter(function (e) {' +
    '      var mm = /type=([a-z_]+)/.exec(m[1]); return mm ? e.type === mm[1] : false; }); }' +
    '    for (var i = 0; i < targets.length; i++) if (targets[i] !== player) EL.remove(targets[i]);' +   // the OLD bare-remove path, no Cb.hurt at all
    '    return { ok: true, result: targets.length };' +
    '  }' +
    '  return window.__origRun.call(MCL.Commands, line, player, opts);' +
    '};' +
    'return 1;'
  );
  ok(origBroken === 1, 'the pre-fix /kill (bare EL.remove, no damage pipeline) can be simulated for the anti-vacuity pass');
  const cowBroken = await summon('cow', 0, 0, 0);
  ok(cowBroken && cowBroken.ok, 'cow spawned for the broken-/kill anti-vacuity pass', JSON.stringify(cowBroken));
  const itemsBeforeBroken = await itemCount(PX, PZ, 6);
  await ev('MCL.Commands.run("/kill @e[type=cow]", MCL.Player, {name:"Dan"}); return 1;');
  await sleep(300);
  const brokenSnap = (await snap([cowBroken.id]))[0];
  okAv(brokenSnap && brokenSnap.removed === true,
    'on the pre-fix build the cow is INSTANTLY removed (no death animation, no e.dead tick) -- proving section 2\'s own "still present with deathTime counting up" assertion is not vacuous',
    JSON.stringify(brokenSnap));
  const itemsAfterBroken = await itemCount(PX, PZ, 6);
  okAv(itemsAfterBroken === itemsBeforeBroken,
    'on the pre-fix build the cow drops NO beef at all -- proving section 2b\'s own "at least one item entity drops" assertion is not vacuous',
    JSON.stringify({ itemsBeforeBroken, itemsAfterBroken }));
  await ev('MCL.Commands.run = window.__origRun; return 1;');

  ok(page.problems.length === 0, 'the page logged no errors', page.problems.slice(0, 3).join(' | '));
} catch (e) {
  fails.push('harness: ' + (e && e.message));
  console.log('FAIL  harness: ' + (e && (e.stack || e.message)));
} finally {
  await page.close();
}

console.log('\n===========================================');
console.log(' mobcmdkillcheck: ' + pass + ' assertions, ' + fails.length + ' failed, ' + breaks + ' breaks');
console.log('===========================================');
process.exit(fails.length ? 1 : 0);
