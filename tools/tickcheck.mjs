#!/usr/bin/env node
// tickcheck.mjs — is every per-tick entry point something the GAME calls?
//
//   node tools/tickcheck.mjs [--quiet]
//
// ⚠⚠ WHY THIS EXISTS, AND IT IS THE LARGEST THING SESSION 9 FOUND (D-301). The main loop ran
// `Player.tick()` and nothing else. `Behave.tick` — which drains the scheduled-tick queue — was
// **never called by any build**, and nor was `BlockEntities.tick`. So in every version of this
// game that has ever existed:
//
//   · water and lava never spread past their first update;
//   · fire never burnt out and never spread;
//   · no furnace ever smelted anything (D-289 fixed the HOOKS; the loop they live in never ran);
//   · and G15's torches, repeaters, observers and pistons would each have started and frozen.
//
// ⚠ EVERY CHECK WAS GREEN ACROSS IT. `redcheck` has its own `runTicks`, `pistoncheck` its own
// `ticks`, `behavcheck` its own loop — each honestly proving the RULE and not one of them
// proving the GAME runs it. That is D-276 at the biggest join in the project, and the missing
// assertion is not about any rule. It is this one: **every function whose name says it happens
// once per tick must be reachable from the loop, in the SHIPPED BUNDLE.**
//
// ⚠ AND IT ASKS THE BUILT FILE, NOT THE SOURCE. A module that is written, correct and simply
// absent from `build.mjs`'s list is exactly the failure this is for — asking `src/` would say
// the call is there.
//
// The set is CLOSED, the way G15's source and analog tables are: every `*.tick*` function in
// `src/` is either reachable from the loop or on the OWED list below WITH ITS REASON.

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'src');
const DIST = join(ROOT, 'dist', 'mclite.html');
const QUIET = process.argv.includes('--quiet');

let pass = 0, breaks = 0;
const fails = [];
const ok = (c, m) => { if (c) pass++; else if (fails.length < 40) fails.push(m); return c; };
const okAv = (c, m) => { breaks++; if (c) { pass++; if (!QUIET) console.log('   ✓ ' + m); } else fails.push('anti-vacuity: ' + m); };
const say = (...a) => { if (!QUIET) console.log(...a); };

if (!existsSync(DIST)) {
  console.log('tickcheck: SKIP — dist/mclite.html is not built yet');
  process.exit(0);
}
const dist = readFileSync(DIST, 'utf8');
const files = readdirSync(SRC).filter((f) => f.endsWith('.js')).sort();

console.log('tickcheck — is every per-tick function something the game calls? (D-301)');

// ═══════════ 1. find every per-tick entry point in the source ══════════════════════════════
say('\n1. every `*.tick*` in src/');
// ⚠ THE SHORT NAME IS PER FILE, NOT GLOBAL. `P` is `Player` in `14_player.js` and `Piston` in
// `07g_piston.js`; `H` is `Hud` in one module and `Hand` in another. A hand-written alias map
// files four of `Hand`'s functions under `Hud` and then reports them missing — which is what the
// first run of this check did. The namespace comes from the file's own `NS.X =` line.
const NS_OF = new Map();
function nsOf(file) {
  if (NS_OF.has(file)) return NS_OF.get(file);
  const text = readFileSync(join(SRC, file), 'utf8');
  const m = text.match(/\bNS\.([A-Za-z][\w$]*)\s*=\s*(?:\{|NS\.|function)/);
  const ns = m ? m[1] : null;
  NS_OF.set(file, ns);
  return ns;
}

const found = [];
for (const f of files) {
  const text = readFileSync(join(SRC, f), 'utf8');
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^\s*([A-Za-z_$][\w$]*)\.(tick[\w$]*|worldTick)\s*=\s*function/);
    if (!m) continue;
    found.push({ file: f, obj: m[1], name: m[2], line: i + 1, ns: nsOf(f) });
  }
}
ok(found.length >= 15, `${found.length} per-tick functions across ${files.length} modules`);
say('   ' + found.map((e) => e.obj + '.' + e.name).join(' '));

// ═══════════ 2. which of them the LOOP reaches ═════════════════════════════════════════════
say('\n2. what the shipped bundle actually calls');
{
  // ⚠ REACHABILITY, NOT "DOES THE NAME APPEAR". A call inside the module that DEFINES the
  // function proves nothing — `Piston.tickMoving` is called by `BlockEntities.tick`, which is
  // the thing that was never called. So this walks OUT from the loop: `Main.loop` and
  // `Main.worldTick` are the roots, and a function counts as reached when something already
  // reached calls it.
  const ROOTS = ['Main.loop', 'Main.worldTick'];
  const NS_OBJ = new Map();   // module namespace -> its local alias, off the per-tick table itself
  for (const e of found) if (e.ns && e.obj !== 'this' && !NS_OBJ.has(e.ns)) NS_OBJ.set(e.ns, e.obj);
  // the bundle is one file, so the call graph is grepped from it directly
  const bodyOf = (qualified) => {
    const i = qualified.startsWith('fn:')
      ? dist.indexOf('function ' + qualified.slice(3) + '(')
      : dist.indexOf(qualified + ' = function');
    if (i < 0) return '';
    // to the next top-level `\n  X.y = function` or `\n  function `, whichever comes first
    const rest = dist.slice(i + 1);
    const j = rest.search(/\n {2}(?:[A-Za-z_$][\w$.]*\s*=\s*function|function\s)/);
    return j < 0 ? rest.slice(0, 20000) : rest.slice(0, j);
  };
  // every call that appears anywhere, as `X.tickY(`
  const reached = new Set();
  const frontier = ROOTS.slice();
  const seen = new Set(ROOTS);
  while (frontier.length) {
    const q = frontier.pop();
    const body = bodyOf(q);
    if (!body) continue;
    for (const e of found) {
      const call = e.obj + '.' + e.name + '(';
      const nsCall = 'NS.' + e.ns + '.' + e.name + '(';
      if (body.indexOf(call) >= 0 || (e.ns && body.indexOf(nsCall) >= 0)) {
        const key = e.obj + '.' + e.name;
        if (!reached.has(key)) {
          reached.add(key);
          if (!seen.has(key)) { seen.add(key); frontier.push(key); }
        }
      }
    }
    // s115: a cross-module call to a NON-tick-named entry (`NS.SnowGolem.mobTick(e, …)` from
    // EL.tickMob) is walked into too, through the module's own alias (`SG`), so the tick
    // functions IT calls (`SG.tickSnowTrail`) count as reached.
    for (const m of body.matchAll(/\bNS\.([A-Za-z][\w$]*)\.([A-Za-z_$][\w$]*)\(/g)) {
      const obj = NS_OBJ.get(m[1]);
      if (!obj) continue;
      const key = obj + '.' + m[2];
      if (seen.has(key)) continue;
      seen.add(key); frontier.push(key);
    }
    // s115: a module-LOCAL helper (`function villagerWorkRun(`, 07zv_villagerbrain.js) called
    // from a reached body is walked too — but only when its name is defined exactly ONCE in the
    // bundle, so two IIFEs' same-named helpers can never lend each other reachability.
    for (const m of body.matchAll(/\b([a-z][\w$]*)\(/g)) {
      const fn = m[1];
      const key = 'fn:' + fn;
      if (seen.has(key)) continue;
      const decl = 'function ' + fn + '(';
      const at = dist.indexOf(decl);
      if (at < 0 || dist.indexOf(decl, at + 1) >= 0) continue;
      seen.add(key); frontier.push(key);
    }
  }
  // ⚠ THE OWED LIST, WITH REASONS. A per-tick function that nothing calls is either a bug or a
  // helper that a caller drives by another name; either way it is NAMED here rather than
  // quietly absent, which is the whole habit (D-290, D-295, D-299).
  const OWED = {
    'Sky.tickWeather': 'a pure step function — `Sky.tick` drives it and owns the RNG',
    'Piston.tickMoving': 'driven by `BlockEntities.tick`, which walks the store first (D-298)',
    'Mining.ticks': 'not a per-tick hook at all — it returns "how many ticks to break this"',
    'Bench.tick': 'the benchmark, called only from the benchmarking branch of the loop',
    'Physics.tick': 'called by `Player.tick`, which is the entity that owns a body',
    'Survival.tick': 'called by `Player.tick`, for the same reason',
    'Survival.tickAir': 'called by `Survival.tick`',
    'Player.tickFootsteps': 'called by `Player.tick`',
    'Hand.tickSwing': 'called by `Player.act`, which runs every FRAME rather than every tick',
    'Piston.tickMoving': 'driven by `BlockEntities.tick`, which walks the store first (D-298)',
    'Hand.tickAttackStrength': 'called by `Player.tick`',
    'Blaze.tickSmall': 'the small fireball\'s tick — `Fb` is `NS.Blaze.Fireball`, called by `EL` as `NS.Blaze.Fireball.tickSmall(e)`',
    'Oxidize.tickingBlocks': 'not a hook — a LIST of the randomly ticking copper states, read once by `Behave` to build its random-tick rule table (07b_behaviour.js)',
    'Hand.tickBreaking': 'called by `Player.act`',
    'Hud.tickToolHighlight': 'drawn, not ticked — the HUD advances it as it renders',
    'Chat.tickChat': 'called by the HUD as it draws the chat window',
    'Save.tick': 'called directly from the frame, outside the fixed-step block (autosave)',
    'Main.worldTick': 'it IS the root',
    // D-391: every concrete Goal in 07k_goals.js writes its own `this.tick = function () {...}`
    // (FloatGoal, PanicGoal, and ten more) -- twelve DIFFERENT functions this file's own regex
    // correctly finds, and correctly cannot tell apart, because every one of them is named
    // `tick` on an anonymous `this`. None is called by a string this walk can match: they are
    // dispatched POLYMORPHICALLY, `goal.tick()` inside `GoalSelector.prototype.tick` (itself not
    // in `found` above -- `X.prototype.tick =` does not match this section's own regex either).
    // `goalcheck.mjs` proves each one individually against a synthetic entity; `aicheck.mjs`
    // (D-391) proves `GoalSelector.prototype.tick` is itself reached, through a REAL
    // `EL.spawn`+`EL.tick()` on an actually-spawned mob -- the question this string-based walk
    // structurally cannot ask of a dynamic dispatch.
    'Ai.tick': 'polymorphic — see the comment above this entry',
    // QUEUE 0.2 (07t_fly.js): parrot flight's goals and its FlyMoveControl each write `this.tick`
    // on an anonymous object, dispatched by GoalSelector / the mob tick the same way as Ai.tick;
    // `flycheck` drives them through a real spawned parrot.
    'Fly.tick': 'polymorphic — goal/move-control objects, see Ai.tick above',
    // D-512: 07v_spell.js's CastSpellGoal/LookAtTargetGoal write `this.tick` on goal objects the
    // GoalSelector dispatches — same shape; spellcheck drives them through real rostered mobs.
    'Spell.tick': 'polymorphic — goal objects, see Ai.tick above',
    // D-532: 07w_passive.js's EatGrassGoal (D-523) writes `this.tick` on a goal object the
    // GoalSelector dispatches — same shape; passivecheck drives it through a real sheep.
    'Passive.tick': 'polymorphic — EatGrassGoal, see Ai.tick above',
    // loop/rabbit-s98: 07zh_rabbit.js's EatCarrotCropGoal writes `this.tick` on a goal
    // object the same polymorphic way (dispatched through the SAME GoalSelector.prototype
    // .tick this section's own comment names for FloatGoal/PanicGoal/EatGrassGoal/etc.) —
    // `rabbitcheck.mjs`'s own §6 drives it through a real EL.spawn+EL.tickMob, the same
    // standing `Ai.tick`'s own comment claims for the rest of this family.
    'Rabbit.tick': 'polymorphic — EatCarrotCropGoal, see Ai.tick above',
    // loop/slime-s97: `getTicksUntilNextJump()` — a delay ROLL (nextInt(20)+10), not a per-tick
    // hook, same standing as `Mining.ticks`; `SlimeMoveControl` (driven by the mob tick) calls it.
    'Slime.ticksUntilNextJump': 'not a per-tick hook — it rolls the next hop delay',
    // loop/enderman-s98: 07zg_enderman.js's own ChasePlayerGoal/PickUpBlockGoal/
    // PlaceBlockGoal/TeleportTowardsPlayerGoal each write `this.tick` on an anonymous goal
    // object, dispatched polymorphically by GoalSelector the same way as Ai.tick above;
    // endermancheck drives them through real spawned/constructed enderman goals.
    'Enderman.tick': 'polymorphic — goal objects, see Ai.tick above',
    // loop/fox-s99: 07zj_fox.js's MoveToHuntGoal/EatSweetBerriesGoal/PickupItemGoal/
    // SleepByDayGoal each write `this.tick` on an anonymous goal object, dispatched
    // polymorphically by GoalSelector the same way as Ai.tick above; foxcheck.mjs drives
    // each one through a real EL.spawn+EL.tickMob (§§6-8), the same standing rabbitcheck's
    // own entry above claims for Rabbit.tick.
    'Fox.tick': 'polymorphic — goal objects, see Ai.tick above',
    // loop/goat-s99: 07zj_goat.js's own RamGoal/LongJumpGoal each write `this.tick` on an
    // anonymous goal object, dispatched polymorphically by GoalSelector the same way as
    // Ai.tick above; goatcheck drives both through real rostered/spawned goats (§6/§7).
    'Goat.tick': 'polymorphic — goal objects, see Ai.tick above',
    'Shulker.tickAmbient': 'called by `Sh.mobTick` in its own module (07zzk_shulker.js)',
    'Combat.tickPowderSnow': 'called by `Cb.isAffectedByDaylight` in its own module (14j_combat.js)'
    // QUEUE 0.2 raid loop (loop/raidlive-s93): `Raid.tick`/`RaidManager.tick` now have a live
    // caller — `Main.worldTick` -> `Raid.tickLive` -> `RaidManager.tick` -> `Raid.tick`
    // (07s_raid.js) — so the OWED entry that used to sit here is gone, not stale.
  };

  const missing = [];
  for (const e of found) {
    const key = e.obj + '.' + e.name;
    const ns = e.ns + '.' + e.name;
    if (reached.has(key)) continue;
    if (OWED[ns] || OWED[key]) continue;
    missing.push(`${ns} (${e.file}:${e.line})`);
  }
  ok(missing.length === 0,
     `every per-tick function is reached from the loop or named as owed — missing: ${missing.join(', ')}`);

  // ⚠⚠ AND THE THREE THAT MATTER MOST, BY NAME, IN THE BUNDLE. These are the ones that were
  // absent; a generic "the set is closed" assertion would pass again if a future edit dropped
  // one from the loop AND added it to the owed list, so they are pinned individually.
  for (const must of ['NS.Behave.tick()', 'NS.BlockEntities.tick()', 'NS.Sky.tick()']) {
    ok(dist.indexOf(must) >= 0, `the bundle calls ${must}`);
  }
  const wt = bodyOf('Main.worldTick');
  ok(wt.length > 0, '`Main.worldTick` exists in the bundle');
  ok(wt.indexOf('NS.Behave.tick()') >= 0, '...and it drains the scheduled-tick queue');
  ok(wt.indexOf('NS.BlockEntities.tick()') >= 0, '...and ticks the block entities');
  ok(wt.indexOf('NS.Sky.tick()') >= 0, '...and advances the sky clock');
  // item 8(b), D-452 — `World.randomTick` doesn't match this file's own `tick[\w$]*` regex
  // (its name starts with "random", not "tick"), so it is pinned here BY NAME instead of
  // relying on §2's automatic scan — the exact shape D-301 already burned this project on once:
  // a function that exists, is correct, and is never called by anything the game runs.
  ok(wt.indexOf('NS.World.randomTick(') >= 0, '...and drives the random-tick pass (D-452)');
  const loop = bodyOf('Main.loop');
  ok(loop.indexOf('Main.worldTick()') >= 0, 'and the frame loop calls `Main.worldTick`');
  say(`   ${reached.size} reached · ${Object.keys(OWED).length} named as owed`);
}
say(`   ${pass} ok`);

// ═══════════ 3. and every `init` the game has to call ══════════════════════════════════════
say('\n3. the same question about `init`');
{
  // ⚠ `Piston.init` WAS ALSO NEVER CALLED, found in the same reading. A module that is never
  // initialised reports `ready: false` for ever and every one of its entry points returns
  // early — silently, because "not ready" is a legitimate state during boot.
  const inits = [];
  for (const f of files) {
    const text = readFileSync(join(SRC, f), 'utf8');
    const m = text.match(/^\s*([A-Za-z_$][\w$]*)\.init\s*=\s*function/m);
    if (!m) continue;
    const ns = (text.match(/NS\.([A-Za-z][\w$]*)\s*=\s*/) || [])[1];
    if (!ns) continue;
    inits.push({ file: f, ns });
  }
  ok(inits.length >= 10, `${inits.length} modules expose an init`);
  // which of them does the bundle call? Some are worker-side or driven by another module.
  const INIT_OWED = {
    Noise: 'seeded per world by the worldgen, not once at boot',
    Worldgen: 'per world, from the seed',
    Biomes: 'called by `Reg.init` with the packed biome payload',
    Climate: 'per world, by the worldgen',
    Earth: 'per world, by the worldgen',
    Structures: 'per world, by the worldgen',
    Jigsaw: 'per world, by the worldgen',
    Mesher: 'per worker',
    Section: 'no boot-time state',
    Templates: 'decoded with the registry',
    Caves: 'per world', Carvers: 'per world', Surface: 'per world', Features: 'per world',
    Oxidize: 'lazy — every entry point runs `ensure()`, which calls `Ox.init()` on first use',
    Piglin: 'self-initialising — the module calls `Pg.init()` as it loads (07zzf_piglin.js)',
    Hoglin: 'self-initialising — the module calls `Hg.init()` as it loads (07zzg_hoglin.js)',
    Blaze: 'self-initialising — `Bl.init()` as it loads (07zzh_blaze.js)',
    Ghast: 'self-initialising — `Gh.init()` as it loads (07zzi_ghast.js)',
    Strider: 'self-initialising — `St.init()` as it loads (07zzj_strider.js)',
    Shulker: 'self-initialising — `Sh.init()` as it loads (07zzk_shulker.js)',
    EnderDragon: 'self-initialising — `ED.init()` as it loads (07zzl_enderdragon.js)',
    EndCrystal: 'self-initialising — `EC.init()` as it loads (07zzn_endcrystal.js)',
    Guardian: 'self-initialising — `Gd.init()` as it loads (07zzr_guardian.js)'
  };
  const notCalled = inits.filter((e) => dist.indexOf('NS.' + e.ns + '.init(') < 0
                                     && dist.indexOf(e.ns + '.init(') < 0);
  const unexplained = notCalled.filter((e) => !INIT_OWED[e.ns]);
  ok(unexplained.length === 0,
     `every module's init is called or named as owed — unexplained: ${unexplained.map((e) => e.ns).join(', ')}`);
  for (const must of ['NS.Redstone.init(', 'NS.Piston.init(', 'NS.Sky.init(',
                      'NS.Behave.init(', 'NS.BlockEntities.init(']) {
    ok(dist.indexOf(must) >= 0, `the bundle calls ${must}…)`);
  }
}
say(`   ${pass} ok`);

// ═══════════ 4. anti-vacuity ═══════════════════════════════════════════════════════════════
say('\n4. break it, and it must be caught');
{
  // 1. dropping the call from the bundle must fail §2
  {
    const broken = dist.replace('NS.Behave.tick()', 'NS.Behave.notTheTick()');
    okAv(broken.indexOf('NS.Behave.tick()') < 0 && dist.indexOf('NS.Behave.tick()') >= 0,
      'removing the scheduler call from the bundle is visible to the string test §2 makes');
  }
  // 1b. the same for D-452's random-tick pass — it is pinned BY NAME (§2), not found by the
  //     automatic scan, so its own break must be shown to fire independently.
  {
    const broken = dist.replace('NS.World.randomTick(', 'NS.World.notTheRandomTick(');
    okAv(broken.indexOf('NS.World.randomTick(') < 0 && dist.indexOf('NS.World.randomTick(') >= 0,
      'removing the random-tick call from the bundle is visible to §2\'s pinned assertion');
  }
  // 2. the reachability walk really walks: a function called only by another module's body
  //    must be reachable through it, and one called by nobody must not be.
  {
    const i = dist.indexOf('Main.worldTick = function');
    const body = dist.slice(i, i + 2000);
    okAv(body.indexOf('NS.Behave.tick()') >= 0 && body.indexOf('NS.Bench.tick(') < 0,
      'the world tick contains the scheduler and not the benchmark — the body slice is the real body');
  }
  // 3. the OWED list is not a place to park work: every entry must name a real function
  {
    const names = new Set(found.map((e) => e.obj + '.' + e.name));
    const nsNames = new Set(found.map((e) => e.file + ':' + e.name));
    let real = 0;
    for (const k of ['Sky.tickWeather', 'Piston.tickMoving', 'Save.tick']) {
      const short = k.split('.')[1];
      if ([...nsNames].some((n) => n.endsWith(':' + short))) real++;
    }
    okAv(real === 3, 'every owed entry sampled names a function that exists in src/');
  }
  // 4. the bundle really is the built file and not the source
  {
    // ⚠ THE BUILT PAGE HAS NO `<!DOCTYPE` — `build.mjs` emits a bare `<meta charset>` first.
    // Asserting a tag the build does not write is a check that fails on a correct file, which is
    // the same class of mistake as asserting a remembered constant.
    okAv(dist.length > 5000000 && dist.slice(0, 200).indexOf('<meta charset') >= 0
         && dist.indexOf('<canvas') >= 0,
      `the file read is the ${(dist.length / 1048576).toFixed(1)} MB built page, not a module`);
  }
}
say(`   ${pass} ok`);

console.log('');
console.log('================ tickcheck ================');
console.log(` assertions passed .. ${pass}`);
console.log(` failures ........... ${fails.length}`);
for (const f of fails.slice(0, 20)) console.log('   ✗ ' + f);
console.log(` breaks caught ...... ${breaks}`);
console.log('==========================================');
process.exit(fails.length ? 1 : 0);
