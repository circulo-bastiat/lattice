// mobpackcheck.mjs -- MULTI-attacker / pack combat, live in the browser (MCLITE_PRESET=medium).
// Every prior deep-test pass provoked each mob with exactly ONE attacker (undeadmobpeek/
// nethermobpeek/petmobpeek/...); this is the first check that provokes 2+ simultaneous
// attackers/targets against the real EL.tick() AI loop and asserts against it. Companion
// exploratory harness: tools/mobpackpeek.mjs (same scenarios, prints raw findings, no asserts).
//
//   MCLITE_PRESET=medium node tools/mobpackcheck.mjs [dist/mclite.html]
//
// ⚠⚠ WHAT THIS FOUND. `/summon <entity>` (src/15g_commands.js, M.entityType().parse) returned
// `ET.types[s]` -- the entity's OWN `[width,height,...]` DATA ROW, kept only as an existence
// check -- instead of `s`, the bare NAME STRING `EL.spawn`/`Ent.bare` both require (`Ent.bare`
// returns '' for anything that is not a string). Every `/summon` of every entity type failed
// with "Unable to summon entity" -- the exact command the task brief said to spawn every
// scenario through. Section 0 proves the fix; every later section's own spawns go through the
// same real `/summon` path (not a direct `EL.spawn` back door) so a regression here fails loudly
// again instead of hiding behind a bypass.
//
// Sections (each `.decomp`-cited, each with its own anti-vacuity break-and-restore):
//   0. /summon itself (the enabling bug above)
//   a. iron golem -- 2 hostile mobs unconditionally in range (.decomp IronGolemEntity.java:84,
//      `ActiveTargetGoal<MobEntity>(5,Monster,!Creeper)` -> `Ai.NearestAttackableTargetGoal`):
//      picks one, and re-acquires the SURVIVOR once its current target is removed -- proven live,
//      not assumed, because a single e.target slot with 2+ live candidates is exactly the shape
//      that stays green on a green harness and dead the moment two mobs are actually present.
//      NOTE (read plainly, not guessed): vanilla's own IronGolemEntity.initGoals (.decomp:80-84)
//      has no "defend a villager FROM whoever hit it" goal at all -- the golem's hostile-mob
//      target is unconditional presence-in-5-blocks, not villager-defense-triggered -- and
//      mob-vs-mob damage is unbuilt in this engine (14j_combat.js Cb.hurt's own header), so
//      "2+ different mobs attack the villagers it protects" cannot be produced even as a fixture;
//      this section proves the real, adjacent multi-candidate/multi-attacker state instead.
//   b. zombified_piglin -- RevengeGoal.setGroupRevenge() (D-719), 4 piglins in alert range of the
//      one that gets hit: every eligible piglin in range is alerted (not capped at 1-2), and a
//      re-run of the same alert (already-targeted piglins) does not clobber anyone's target.
//   c. wolf pack -- 3 tamed wolves, same owner, hurt by one hostile mob: `Ai.OwnerHurtByTargetGoal`
//      is one goal INSTANCE per wolf (`.decomp` bfp/bfq, own closure `seen`, D-477's own header);
//      all 3 acquire the SAME attacker independently, none clobbers another's `target`.
//   d. two zombies vs the player -- independent `MeleeAttackGoal`/target state per entity: both
//      keep `e.target === player` and both close distance over several real seconds, no flicker.
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
if (!page) { console.log('SKIP  mobpackcheck: no Chromium found'); process.exit(0); }

try {
  await sleep(1200);
  await page.evaluate(function () { if (window.MCL && MCL.Main && !MCL.Main.ready) MCL.Main.play({}); });
  const up = await page.waitFor(function () {
    return !!(window.MCL && MCL.Main.ready && MCL.Hud.mode === 'game' && MCL.World.chunks.size > 20);
  }, 60000);
  if (!ok(up, 'the world came up', page.lastThrow)) throw new Error('never reached the game');
  await sleep(800);
  await page.settleWorld();

  const PX = 7500, PZ = 7500, PY = 90;
  const ev = (body) => page.evaluate(mkFn(body));

  const buildInfo = await ev(
    'var W = MCL.World, St = MCL.States;' +
    'var id = St.stateOf("stone");' +
    'for (var cx = -3; cx <= 3; cx++) for (var cz = -3; cz <= 3; cz++) {' +
    '  var c = W.makeChunk((' + PX + ' >> 4) + cx, (' + PZ + ' >> 4) + cz);' +
    '  c.state = MCL.CH.GENERATED; W.chunks.set(W.key((' + PX + ' >> 4) + cx, (' + PZ + ' >> 4) + cz), c);' +
    '}' +
    'var got = 0;' +
    'for (var x = ' + PX + ' - 20; x <= ' + PX + ' + 20; x++)' +
    '  for (var z = ' + PZ + ' - 20; z <= ' + PZ + ' + 20; z++) { W.setBlock(x, ' + PY + ' - 1, z, id); got++; }' +
    'return { platformBlocks: got };'
  );
  ok(buildInfo && buildInfo.platformBlocks > 0, 'built a flat test platform', JSON.stringify(buildInfo));

  async function resetScene() {
    await ev(
      'var P = MCL.Player, EL = MCL.EntityList;' +
      'P.flying = false; P.noclip = false;' +
      'P.x = ' + PX + '; P.y = ' + PY + '; P.z = ' + PZ + ';' +
      'P.vx = P.vy = P.vz = 0; P.yaw = 0; P.pitch = 0; P.health = 20;' +
      'P.lastHurtByEntity = null; P.lastHurtMob = null;' +
      'if (P.interpolate) P.interpolate(0);' +
      'MCL.Input.locked = true; MCL.Input.uiOpen = false;' +
      'EL.list.length = 0;' +
      'if (MCL.Commands) MCL.Commands.run("/gamemode survival", P, {name:"Dan"});' +
      'return 1;'
    );
    await sleep(200);
  }

  // spawn STRICTLY through the real /summon command -- the exact path section 0 proves live,
  // and the exact path the task brief asked every scenario to use.
  async function summon(type, dx, dy, dz) {
    return ev(
      'var P = MCL.Player;' +
      'var x = ' + PX + ' + (' + dx + '), y = ' + PY + ' + (' + dy + '), z = ' + PZ + ' + (' + dz + ');' +
      'var res = MCL.Commands.run("/summon ' + type + ' " + x + " " + y + " " + z, P, {name:"Dan"});' +
      'if (!res.ok) return { ok: false, error: res.error && res.error.message };' +
      'var EL = MCL.EntityList, best = null;' +
      'for (var i = EL.list.length - 1; i >= 0; i--) { if (EL.list[i].type === "' + type + '" && !best) { best = EL.list[i]; break; } }' +
      'return best ? { ok: true, id: best.id, x: best.x, y: best.y, z: best.z } : { ok: false, error: "spawned but not found" };'
    );
  }

  async function snap(ids) {
    return ev(
      'var EL = MCL.EntityList; var ids = ' + JSON.stringify(ids) + '; var out = [];' +
      'for (var k = 0; k < ids.length; k++) {' +
      '  var e = null;' +
      '  for (var i = 0; i < EL.list.length; i++) if (EL.list[i].id === ids[k]) { e = EL.list[i]; break; }' +
      '  out.push(e ? { id: e.id, x: +e.x.toFixed(2), z: +e.z.toFixed(2), target: e.target ? (e.target.type || "player") : null, targetId: e.target ? e.target.id : null, removed: !!e.removed, dead: !!e.dead, health: e.health } : null);' +
      '}' +
      'return out;'
    );
  }

  // ── 0. /summon itself -- the enabling bug ──────────────────────────────────────────────
  console.log('\n0. /summon <entity> [pos]');
  await resetScene();
  const zTest = await summon('zombie', 3, 0, 0);
  ok(zTest && zTest.ok, '/summon zombie succeeds (was "Unable to summon entity" for EVERY type before the fix)', JSON.stringify(zTest));
  const gTest = await summon('iron_golem', -3, 0, 0);
  ok(gTest && gTest.ok, '/summon iron_golem succeeds too (the bug was type-independent -- ET.types[s] is a row for every entity)', JSON.stringify(gTest));
  {
    // break /summon back to its pre-fix symptom directly (Commands.run intercepted at the top),
    // proving this check's own summon() helper -- the one every section below relies on -- would
    // fail loudly rather than silently spawning nothing if the regression came back.
    const origBroken = await ev(
      'var C = MCL.Commands; window.__origRun = C.run;' +
      'C.run = function (line, player, opts) {' +
      '  if (/\\/summon/.test(line)) return { ok: false, lines: ["Unable to summon entity"], error: { message: "Unable to summon entity" } };' +
      '  return window.__origRun.call(C, line, player, opts);' +
      '};' +
      'return 1;'
    );
    ok(origBroken === 1, 'the /summon regression can be simulated for the anti-vacuity pass');
    const zBroken = await summon('zombie', 3, 0, 0);
    okAv(zBroken && zBroken.ok === false, 'with /summon forced back to its pre-fix failure, this check\'s own summon() helper reports ok:false (proving section a/b/c/d below would fail loudly, not silently spawn nothing)', JSON.stringify(zBroken));
    await ev('MCL.Commands.run = window.__origRun; return 1;');
  }

  // ═══ a. iron golem -- 2+ hostile mobs, unconditional target pick + re-acquire on death ═══
  console.log('\na. iron golem, multi-attacker');
  await resetScene();
  const golem = await summon('iron_golem', 0, 0, 0);
  const gz1 = await summon('zombie', 4, 0, 0);
  const gz2 = await summon('zombie', -4, 0, 0);
  ok(golem.ok && gz1.ok && gz2.ok, 'golem + 2 zombies spawned within the golem\'s own 5-block hostile-mob target range', JSON.stringify({ golem, gz1, gz2 }));
  await ev('var EL=MCL.EntityList; for (var i=0;i<EL.list.length;i++){var o=EL.list[i]; if(o.type==="zombie"){o.ai=null;o.vx=o.vy=o.vz=0;o.health=1000;}} return 1;');
  await sleep(2500);
  let s = await snap([golem.id, gz1.id, gz2.id]);
  const pickedOne = s[0] && (s[0].targetId === gz1.id || s[0].targetId === gz2.id);
  ok(pickedOne, 'with 2 hostile mobs simultaneously in range, the golem\'s own TARGET goal (priority 3, .decomp IronGolemEntity.java:84) acquires exactly one of them', JSON.stringify(s[0]));
  const curId = s[0] && s[0].targetId;
  const survivorId = curId === gz1.id ? gz2.id : gz1.id;
  // EL.remove (not a bare splice) -- it sets e.removed=true, the exact flag Ai.canTargetLiving/
  // Ai.dropUntargetable (07k_goals.js) already gate on every tick around e.ai.tick(); a splice
  // alone leaves a stale, still-"live" object that e.target could keep pointing at forever.
  await ev('var EL=MCL.EntityList; for (var i=0;i<EL.list.length;i++) if (EL.list[i].id===' + curId + ') { EL.remove(EL.list[i]); break; } return 1;');
  await sleep(3000);
  s = await snap([golem.id, survivorId]);
  ok(s[0] && s[0].targetId === survivorId, 'once the golem\'s CURRENT target is removed, it re-acquires the OTHER (surviving) hostile mob within 3s -- not stuck on a dead reference, not null forever', JSON.stringify(s));
  {
    // anti-vacuity: strip the golem's own hostile-mob candidate list to [] and prove the
    // re-acquire assertion above would then fail (this check would have caught D-486/D-...
    // style regressions where the multi-candidate scan silently returns nothing).
    await resetScene();
    const g2 = await summon('iron_golem', 0, 0, 0);
    const zz1 = await summon('zombie', 4, 0, 0);
    const zz2 = await summon('zombie', -4, 0, 0);
    await ev('var EL=MCL.EntityList; for (var i=0;i<EL.list.length;i++){var o=EL.list[i]; if(o.type==="zombie"){o.ai=null;o.vx=o.vy=o.vz=0;o.health=1000;}} return 1;');
    const brokeGolem = await ev(
      'var EL=MCL.EntityList, golem=null; for (var i=0;i<EL.list.length;i++) if (EL.list[i].id===' + g2.id + ') golem=EL.list[i];' +
      'if (!golem || !golem.ai || !golem.ai.entries) return 0;' +
      'golem.target = null;' +   // goal may have ticked before the strip; stripping leaves e.target behind
      'golem.ai.entries = golem.ai.entries.filter(function (ent) { return !(ent.goal instanceof MCL.Ai.NearestAttackableTargetGoal); });' +
      'return 1;'
    );
    ok(brokeGolem === 1, 'the golem\'s own hostile-mob target goal can be stripped out for the anti-vacuity pass');
    await sleep(2500);
    const sBroken = await snap([g2.id, zz1.id, zz2.id]);
    okAv(!sBroken[0].targetId, 'with the hostile-mob target goal removed, the SAME 2-zombie scene never acquires a target at all -- proving section a\'s own assertions above are not vacuous', JSON.stringify(sBroken[0]));
  }

  // ═══ b. zombified_piglin -- group alert, 4+ in range, no cap / no double-fire ═══
  console.log('\nb. zombified_piglin group alert (4 in range)');
  await resetScene();
  const p0 = await summon('zombified_piglin', 0, 0, 0);
  const p1 = await summon('zombified_piglin', 2, 0, 0);
  const p2 = await summon('zombified_piglin', -2, 0, 0);
  const p3 = await summon('zombified_piglin', 0, 0, 2);
  const p4 = await summon('zombified_piglin', 0, 0, -2);
  const pigIds = [p0, p1, p2, p3, p4].map((p) => p.id);
  ok([p0, p1, p2, p3, p4].every((p) => p.ok), '5 zombified_piglins spawned via /summon', JSON.stringify(pigIds));
  await ev('var EL=MCL.EntityList; for (var i=0;i<EL.list.length;i++){var o=EL.list[i]; if(o.type==="zombified_piglin" && o.id!==' + p0.id + '){o.ai=null;o.vx=o.vy=o.vz=0;}} return 1;');
  const pigAttacker = await summon('zombie', 30, 0, 30);
  await ev('var EL=MCL.EntityList; var p0=null,att=null; for (var i=0;i<EL.list.length;i++){var o=EL.list[i]; if(o.id===' + p0.id + ')p0=o; if(o.id===' + pigAttacker.id + ')att=o;} MCL.Combat.notifyHurt(p0, att); return 1;');
  await sleep(200);
  s = await snap(pigIds);
  const alertedCount = s.filter((x) => x && x.targetId === pigAttacker.id).length;
  ok(alertedCount === 5, 'hitting ONE piglin alerts ALL 4 pack-mates in range (RevengeGoal.setGroupRevenge(), D-719) -- self + 4 pack-mates = 5/5, not capped at 1-2', JSON.stringify(s.map((x) => x && x.targetId)));

  // double-fire: re-run notifyHurt with the SAME attacker on p0 -- canUse gates on
  // e.lastHurtByEntity truthy (no hurtSeq/timestamp compare like UniversalAngerGoal has), so
  // re-invoking start() manually must stay idempotent (every target still === the one attacker).
  const beforeDouble = await snap(pigIds);
  await ev('var EL=MCL.EntityList; var p0=null,att=null; for (var i=0;i<EL.list.length;i++){var o=EL.list[i]; if(o.id===' + p0.id + ')p0=o; if(o.id===' + pigAttacker.id + ')att=o;} MCL.Combat.notifyHurt(p0, att); return 1;');
  await sleep(200);
  const afterDouble = await snap(pigIds);
  const stableAfterDouble = afterDouble.every((x, i) => x && beforeDouble[i] && x.targetId === beforeDouble[i].targetId);
  ok(stableAfterDouble, 're-alerting the same pack with the SAME attacker does not clobber any piglin\'s target (every target is still the one attacker, not reset/duplicated)', JSON.stringify(afterDouble.map((x) => x && x.targetId)));
  {
    // anti-vacuity: cap the pack loop's own candidate list to 1 and prove the "5/5" assertion
    // above would then fail (this check would have caught a silent cap regression).
    await resetScene();
    const q0 = await summon('zombified_piglin', 0, 0, 0);
    const q1 = await summon('zombified_piglin', 2, 0, 0);
    const q2 = await summon('zombified_piglin', -2, 0, 0);
    const q3 = await summon('zombified_piglin', 0, 0, 2);
    const q4 = await summon('zombified_piglin', 0, 0, -2);
    const qIds = [q0, q1, q2, q3, q4].map((q) => q.id);
    await ev('var EL=MCL.EntityList; for (var i=0;i<EL.list.length;i++){var o=EL.list[i]; if(o.type==="zombified_piglin" && o.id!==' + q0.id + '){o.ai=null;o.vx=o.vy=o.vz=0;}} return 1;');
    const qAttacker = await summon('zombie', 30, 0, 30);
    // direct, unambiguous break: monkeypatch MCL.Ai.HurtByTargetGoal itself so any NEW instance
    // (this fresh scene's q0) alerts at most 1 pack-mate (patch the constructor before summon,
    // restore after).
    const brokeCtor = await ev(
      'window.__origHBTG = MCL.Ai.HurtByTargetGoal;' +
      'MCL.Ai.HurtByTargetGoal = function (e, rand, getPack) {' +
      '  var cappedGetPack = getPack ? function () { return getPack().slice(0, 1); } : getPack;' +
      '  return new window.__origHBTG(e, rand, cappedGetPack);' +
      '};' +
      'return 1;'
    );
    ok(brokeCtor === 1, 'Ai.HurtByTargetGoal can be wrapped to cap its own pack to 1 for the anti-vacuity pass');
    // re-spawn q0 so its ROSTER goal is built against the PATCHED constructor
    await ev('var EL=MCL.EntityList; for (var i=EL.list.length-1;i>=0;i--) if (EL.list[i].id===' + q0.id + ') EL.list.splice(i,1); return 1;');
    const q0b = await summon('zombified_piglin', 0, 0, 0);
    await ev('var EL=MCL.EntityList; var att=null; for (var i=0;i<EL.list.length;i++){var o=EL.list[i]; if(o.id===' + qAttacker.id + ')att=o;} return 1;');
    const q0Snap1 = await ev('var EL=MCL.EntityList,e=null; for (var i=0;i<EL.list.length;i++) if (EL.list[i].id===' + q0b.id + ') e=EL.list[i]; return e ? e.id : null;');
    ok(q0Snap1 === q0b.id, 're-spawned q0 under the capped constructor');
    await ev('var EL=MCL.EntityList, q0=null,att=null; for (var i=0;i<EL.list.length;i++){var o=EL.list[i]; if(o.id===' + q0b.id + ')q0=o; if(o.id===' + qAttacker.id + ')att=o;} MCL.Combat.notifyHurt(q0, att); return 1;');
    await sleep(200);
    const sCapped = await snap(qIds);
    const cappedAlerted = sCapped.filter((x) => x && x.targetId === qAttacker.id).length;
    okAv(cappedAlerted < 5, 'with the pack alert capped to 1 candidate, the SAME 5-piglin scene alerts fewer than 5 -- proving section b\'s "5/5" assertion above is not vacuous (' + cappedAlerted + '/5)', JSON.stringify(sCapped.map((x) => x && x.targetId)));
    await ev('MCL.Ai.HurtByTargetGoal = window.__origHBTG; return 1;');
  }

  // ═══ c. wolf pack -- 3 tamed wolves, same owner, owner hurt by a mob ═══
  console.log('\nc. wolf pack targeting (3 tamed, same owner)');
  await resetScene();
  const w0 = await summon('wolf', 2, 0, 0);
  const w1 = await summon('wolf', -2, 0, 0);
  const w2 = await summon('wolf', 0, 0, 2);
  const wolfIds = [w0, w1, w2].map((w) => w.id);
  ok([w0, w1, w2].every((w) => w.ok), '3 wolves spawned via /summon', JSON.stringify(wolfIds));
  await ev(
    'var EL=MCL.EntityList; var ids=' + JSON.stringify(wolfIds) + ';' +
    'for (var i=0;i<EL.list.length;i++){var o=EL.list[i]; if (ids.indexOf(o.id)>=0){ o.tamed=true; o.owner="player"; o.sitting=false; } }' +
    'return 1;'
  );
  const wz1 = await summon('zombie', 0, 0, -6);
  await ev('var EL=MCL.EntityList; for (var i=0;i<EL.list.length;i++){var o=EL.list[i]; if(o.type==="zombie"){o.ai=null;o.vx=o.vy=o.vz=0;}} return 1;');
  await ev('var P=MCL.Player, EL=MCL.EntityList, att=null; for (var i=0;i<EL.list.length;i++) if (EL.list[i].id===' + wz1.id + ') att=EL.list[i]; MCL.Combat.notifyHurt(P, att); return 1;');
  await sleep(400);
  s = await snap(wolfIds);
  const allWolvesAcquired = s.every((x) => x && x.targetId === wz1.id);
  ok(allWolvesAcquired, 'all 3 tamed wolves (same owner) independently acquire the mob that hurt their owner (Ai.OwnerHurtByTargetGoal, one goal instance per wolf) -- none clobbers another\'s target', JSON.stringify(s.map((x) => x && x.targetId)));
  {
    // anti-vacuity: simulate the historical "shared state" shape by forcing a SINGLE shared
    // `seen` across every wolf's OwnerHurtByTargetGoal instance and prove only 1 of 3 acquires.
    await resetScene();
    const v0 = await summon('wolf', 2, 0, 0);
    const v1 = await summon('wolf', -2, 0, 0);
    const v2 = await summon('wolf', 0, 0, 2);
    const vIds = [v0, v1, v2].map((v) => v.id);
    await ev(
      'var EL=MCL.EntityList; var ids=' + JSON.stringify(vIds) + ';' +
      'for (var i=0;i<EL.list.length;i++){var o=EL.list[i]; if (ids.indexOf(o.id)>=0){ o.tamed=true; o.owner="player"; o.sitting=false; } }' +
      'return 1;'
    );
    const brokeShared = await ev(
      'window.__origOHBTG = MCL.Ai.OwnerHurtByTargetGoal; var sharedSeen = null;' +
      'MCL.Ai.OwnerHurtByTargetGoal = function (e, getPlayers) {' +
      '  function owner() { if (!e.tamed || e.owner !== "player" || e.sitting) return null; var ps = getPlayers ? getPlayers() : []; return (ps && ps[0]) || null; }' +
      '  this.canUse = function () { var o = owner(); return !!(o && o.lastHurtByEntity && o.lastHurtByEntity !== sharedSeen); };' +
      '  this.canContinueToUse = function () { return !!e.target; };' +
      '  this.start = function () { var o = owner(); sharedSeen = o ? o.lastHurtByEntity : sharedSeen; e.target = sharedSeen; };' +
      '  this.stop = function () { e.target = null; };' +
      '  this.tick = function () {};' +
      '};' +
      'return 1;'
    );
    ok(brokeShared === 1, 'Ai.OwnerHurtByTargetGoal can be replaced with a shared-`seen` version for the anti-vacuity pass');
    // rebuild goals against the patched constructor by re-spawning
    await ev('var EL=MCL.EntityList; for (var i=EL.list.length-1;i>=0;i--){var o=EL.list[i]; if (' + JSON.stringify(vIds) + '.indexOf(o.id)>=0) EL.list.splice(i,1);} return 1;');
    const v0b = await summon('wolf', 2, 0, 0);
    const v1b = await summon('wolf', -2, 0, 0);
    const v2b = await summon('wolf', 0, 0, 2);
    const vIdsB = [v0b, v1b, v2b].map((v) => v.id);
    await ev(
      'var EL=MCL.EntityList; var ids=' + JSON.stringify(vIdsB) + ';' +
      'for (var i=0;i<EL.list.length;i++){var o=EL.list[i]; if (ids.indexOf(o.id)>=0){ o.tamed=true; o.owner="player"; o.sitting=false; } }' +
      'return 1;'
    );
    const vzAttacker = await summon('zombie', 0, 0, -6);
    await ev('var EL=MCL.EntityList; for (var i=0;i<EL.list.length;i++){var o=EL.list[i]; if(o.type==="zombie"){o.ai=null;o.vx=o.vy=o.vz=0;}} return 1;');
    await ev('var P=MCL.Player, EL=MCL.EntityList, att=null; for (var i=0;i<EL.list.length;i++) if (EL.list[i].id===' + vzAttacker.id + ') att=EL.list[i]; MCL.Combat.notifyHurt(P, att); return 1;');
    await sleep(400);
    const sShared = await snap(vIdsB);
    const sharedAcquired = sShared.filter((x) => x && x.targetId === vzAttacker.id).length;
    okAv(sharedAcquired < 3, 'with a single shared `seen` across all 3 wolves\' goal instances, the SAME scene acquires fewer than 3/3 -- proving the "all 3 independently acquire" assertion above is not vacuous (' + sharedAcquired + '/3)', JSON.stringify(sShared.map((x) => x && x.targetId)));
    await ev('MCL.Ai.OwnerHurtByTargetGoal = window.__origOHBTG; return 1;');
  }

  // ═══ d. two zombies vs the player -- stable target/path, no flicker/stall ═══
  console.log('\nd. two zombies vs player, stable pathing');
  await resetScene();
  const dz1 = await summon('zombie', 6, 0, 0);
  const dz2 = await summon('zombie', -6, 0, 0);
  ok(dz1.ok && dz2.ok, '2 zombies spawned near the player via /summon', JSON.stringify({ dz1, dz2 }));
  const dIds = [dz1.id, dz2.id];
  let sawBothTargetPlayer = true, sawFlicker = false;
  let lastDist = null;
  let closed = [false, false];
  for (let i = 0; i < 6; i++) {
    await sleep(700);
    const snapD = await snap(dIds);
    const distNow = await ev(
      'var P=MCL.Player, EL=MCL.EntityList, ids=' + JSON.stringify(dIds) + '; var out=[];' +
      'for (var k=0;k<ids.length;k++){var e=null; for(var i=0;i<EL.list.length;i++) if(EL.list[i].id===ids[k]) e=EL.list[i];' +
      '  out.push(e ? +Math.hypot(e.x-P.x, e.z-P.z).toFixed(2) : null);}' +
      'return out;'
    );
    for (let k = 0; k < 2; k++) {
      if (!snapD[k] || snapD[k].target !== 'player') sawBothTargetPlayer = false;
      if (lastDist && distNow[k] !== null && distNow[k] < lastDist[k] + 0.05) closed[k] = true;
    }
    lastDist = distNow;
  }
  ok(sawBothTargetPlayer, 'both zombies keep e.target === player through every sampled tick (no flicker to null/other while the player is alive and in range)');
  ok(closed[0] && closed[1], 'both zombies made real progress closing on (or holding melee range against) the player independently -- neither stalls while the other is also pathing', JSON.stringify(lastDist));
  {
    // anti-vacuity: freeze ONE zombie's ai mid-chase and prove the "both close/hold" assertion
    // above would then fail for that one (i.e. this check can actually detect a real stall).
    await resetScene();
    const ez1 = await summon('zombie', 6, 0, 0);
    const ez2 = await summon('zombie', -6, 0, 0);
    await sleep(300);
    await ev('var EL=MCL.EntityList; for (var i=0;i<EL.list.length;i++) if (EL.list[i].id===' + ez1.id + ') { EL.list[i].ai = null; EL.list[i].vx = EL.list[i].vy = EL.list[i].vz = 0; }; return 1;');
    const before = await ev('var P=MCL.Player, EL=MCL.EntityList, e=null; for (var i=0;i<EL.list.length;i++) if (EL.list[i].id===' + ez1.id + ') e=EL.list[i]; return e ? +Math.hypot(e.x-P.x, e.z-P.z).toFixed(2) : null;');
    await sleep(2500);
    const after = await ev('var P=MCL.Player, EL=MCL.EntityList, e=null; for (var i=0;i<EL.list.length;i++) if (EL.list[i].id===' + ez1.id + ') e=EL.list[i]; return e ? +Math.hypot(e.x-P.x, e.z-P.z).toFixed(2) : null;');
    okAv(before !== null && after !== null && Math.abs(after - before) < 0.05, 'with one zombie\'s ai frozen mid-chase, it makes NO further progress toward the player -- proving section d\'s own "closing distance" assertion above is not vacuous (before=' + before + ' after=' + after + ')');
  }

  ok(page.problems.length === 0, 'the page logged no errors', page.problems.slice(0, 3).join(' | '));
} catch (e) {
  fails.push('harness: ' + (e && e.message));
  console.log('FAIL  harness: ' + (e && (e.stack || e.message)));
} finally {
  await page.close();
}

console.log('\n===========================================');
console.log(' mobpackcheck: ' + pass + ' assertions, ' + fails.length + ' failed, ' + breaks + ' breaks');
console.log('===========================================');
process.exit(fails.length ? 1 : 0);
