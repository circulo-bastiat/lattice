// mobinteractpeek.mjs -- deep live-browser driver for CROSS-MOB interactions (predator/prey,
// fear, ownership) that the existing per-mob isolation harnesses (passivemobpeek.mjs,
// undeadmobpeek.mjs, hostilemobpeek-equivalent) cannot catch by construction -- rule 7, "the
// bugs live in the JOINS". Pattern follows tools/undeadmobpeek.mjs (D-712/D-713): fixed
// platform anchor at a far-away chunk, MCL.Commands/EL.spawn for real entities, real ticked AI
// (no synthetic loadEngine harness), results dumped to tools/out/mobinteract/results.json.
//
// Scenarios probed (see docs/archive/QUEUE.md 0.0 rule 8 -- MCLITE_PRESET=medium, survival mode):
//   a) hostile-mob-vs-villager auto-target (undead should; skeleton/spider should not)
//   b) tamed wolf defends its owner against whatever last hurt the owner
//   c) creeper flees a nearby cat (AvoidEntityGoal, CreeperEntity.java:64)
//   d) iron golem retaliates against ANY nearby hostile mob, including one busy attacking a
//      villager rather than the golem itself (TrackIronGolemTargetGoal is priority 1 --
//      reputation-driven player targeting only; the MONSTER-proximity ActiveTargetGoal is a
//      SEPARATE priority-3 TARGET goal, IronGolemEntity.java:84)
//
// MCLITE_PRESET=medium node tools/mobinteractpeek.mjs [scenario1,scenario2,...]
import { open, sleep } from './cdp.mjs';
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'tools', 'out', 'mobinteract');
mkdirSync(OUT, { recursive: true });
function mkFn(body) { return { toString: function () { return 'function(){' + body + '}'; } }; }

const RESULTS_PATH = join(OUT, 'results.json');
let allResults = { results: {}, problems: [], warnings: [] };
if (existsSync(RESULTS_PATH)) {
  try { allResults = JSON.parse(readFileSync(RESULTS_PATH, 'utf8')); } catch (e) {}
}

const ALL_SCENARIOS = ['villagerAggro', 'wolfDefendsOwner', 'creeperFleesCat', 'golemDefendsVillager'];
const argScenarios = process.argv[2] ? process.argv[2].split(',') : null;
const SCENARIOS = argScenarios || ALL_SCENARIOS;

const page = await open(join(ROOT, 'dist', 'mclite.html'), { width: 900, height: 640 });
if (!page) { console.log('SKIP -- no Chromium'); process.exit(0); }

await page.evaluate(function () {
  window.__warnings = [];
  var orig = console.warn.bind(console);
  console.warn = function () { try { window.__warnings.push(Array.prototype.slice.call(arguments).join(' ')); } catch (e) {} return orig.apply(console, arguments); };
});
await sleep(1200);
await page.evaluate(function () { if (window.MCL && MCL.Main && !MCL.Main.ready) MCL.Main.play({}); });
const ready = await page.waitFor(function () {
  return !!(window.MCL && MCL.Main.ready && MCL.Hud.mode === 'game' && MCL.World.chunks.size > 20);
}, 60000);
console.log('spawn ready:', ready);
if (!ready) { console.log('FATAL'); process.exit(1); }
await sleep(1200);
await page.settleWorld();
// natural mob spawning on a wide-open platform can plant an unrelated hostile (or splash-damage
// event) that confounds a health-delta assertion -- pin it off for the whole run (D-30: this bug
// really hit two nearby villagers during authoring, identical simultaneous damage, no combat AI
// involved at all).
await page.evaluate(function () { if (window.MCL && MCL.Commands) MCL.Commands.run('/gamerule doMobSpawning false', MCL.Player, { name: 'Dan' }); });
// D-30 continued: a random thunderstorm mid-run is the OTHER confound this kind of harness can hit
// -- a lightning strike deals identical simultaneous damage to every nearby entity, which reads
// exactly like a false-positive combat hit. Freeze the sky, same idiom becheck.mjs already uses.
await page.evaluate(function () {
  if (window.MCL && MCL.Sky) {
    MCL.Sky.daylightCycle = false; MCL.Sky.weatherCycle = false;
    var wx = MCL.Sky.weather;
    if (wx) { wx.raining = wx.thundering = false; wx.rainLevel = wx.oRainLevel = wx.thunderLevel = wx.oThunderLevel = 0; }
  }
});

const PX = 7000, PZ = 7000, PY = 90;
const buildInfo = await page.evaluate(mkFn(
  'var W = MCL.World, St = MCL.States;' +
  'var id = St.stateOf("stone");' +
  'for (var cx = -5; cx <= 5; cx++) for (var cz = -5; cz <= 5; cz++) {' +
  '  var c = W.makeChunk((' + PX + ' >> 4) + cx, (' + PZ + ' >> 4) + cz);' +
  '  c.state = MCL.CH.GENERATED;' +
  '  W.chunks.set(W.key((' + PX + ' >> 4) + cx, (' + PZ + ' >> 4) + cz), c);' +
  '}' +
  'var got = 0;' +
  'for (var x = ' + PX + ' - 70; x <= ' + PX + ' + 70; x++)' +
  '  for (var z = ' + PZ + ' - 70; z <= ' + PZ + ' + 70; z++) {' +
  '    W.setBlock(x, ' + PY + ' - 1, z, id); got++;' +
  '  }' +
  'for (var x2 = ' + PX + ' - 70; x2 <= ' + PX + ' + 70; x2++)' +
  '  for (var z2 = ' + PZ + ' - 70; z2 <= ' + PZ + ' + 70; z2++)' +
  '    W.setBlock(x2, ' + PY + ' + 4, z2, id);' +   // roof: blocks seesSky, no daylight burn / fire-contagion confound
  'return { platformBlocks: got, loaded: W.loadedAt(' + PX + ', ' + PZ + ') };'
));
console.log('platform:', JSON.stringify(buildInfo));

async function resetPlayer(dx, dz) {
  await page.evaluate(mkFn(
    'var P = MCL.Player;' +
    'P.flying = false; P.noclip = false;' +
    'P.x = ' + PX + ' + (' + (dx || 0) + '); P.y = ' + PY + '; P.z = ' + PZ + ' + (' + (dz || 0) + ');' +
    'P.vx = P.vy = P.vz = 0; P.yaw = 0; P.pitch = 0; P.health = 20; P.dead = false; P.fallDistance = 0; P.onGround = true; P.invulnerable = 0; P.lastHurt = 0;' +
    'if (P.interpolate) P.interpolate(0);' +
    'MCL.Input.locked = true; MCL.Input.uiOpen = false;'
  ));
}
async function setMode(mode) {
  await page.evaluate(mkFn('MCL.Commands.run("/gamemode ' + mode + '", MCL.Player, {name:"Dan"});'));
}
async function clearMobs() {
  return page.evaluate(function () { var n = MCL.EntityList.list.length; MCL.EntityList.list.length = 0; return n; });
}
async function spawnMob(type, dx, dz, over) {
  return page.evaluate(mkFn(
    'var EL = MCL.EntityList;' +
    'var x = ' + PX + ' + (' + dx + '), z = ' + PZ + ' + (' + dz + ');' +
    'var e = EL.spawn("' + type + '", x, ' + PY + ', z);' +
    'if (!e) return null;' +
    (over ? 'Object.assign(e, ' + JSON.stringify(over) + ');' : '') +
    'return { id: e.id, x: e.x, y: e.y, z: e.z };'
  ));
}
async function entityById(id) {
  return page.evaluate(mkFn(
    'var EL = MCL.EntityList; var e = null;' +
    'for (var i=0;i<EL.list.length;i++) if (EL.list[i].id === ' + id + ') { e = EL.list[i]; break; }' +
    'if (!e) return null;' +
    'return { x: e.x, y: e.y, z: e.z, health: e.health, target: e.target ? (e.target.type||"player") : null, removed: !!e.removed, dead: !!e.dead, tamed: !!e.tamed, sitting: !!e.sitting };'
  ));
}
async function dist(idA, idB) {
  const a = await entityById(idA), b = await entityById(idB);
  if (!a || !b) return null;
  return Math.hypot(a.x - b.x, a.z - b.z);
}

// ═══ (a) hostile mob vs villager -- does it auto-target on sight? ═══
async function scenarioVillagerAggro() {
  console.log('\n=== villagerAggro ===');
  const res = { perMob: {} };
  const MOBS = ['zombie', 'husk', 'skeleton', 'spider'];
  for (const kind of MOBS) {
    await resetPlayer(-40, -40);   // player kept well outside every mob's own player-target range
    await clearMobs();
    await setMode('survival');
    const vil = await spawnMob('villager', 0, 0);
    const mob = await spawnMob(kind, 3, 0);
    if (!vil || !mob) { res.perMob[kind] = { SPAWN_REFUSED: true }; continue; }
    const before = await entityById(vil.id);
    await sleep(3500);
    const after = await entityById(vil.id);
    const mobAfter = await entityById(mob.id);
    res.perMob[kind] = {
      villagerHealthBefore: before && before.health, villagerHealthAfter: after && after.health,
      mobTarget: mobAfter && mobAfter.target,
      attacked: !!(before && after && after.health < before.health),
    };
    console.log('  ' + kind + ': target=' + (mobAfter && mobAfter.target) + ' villagerHP ' + (before && before.health) + '->' + (after && after.health));
  }
  return res;
}

// ═══ (b) tamed wolf defends its owner ═══
async function scenarioWolfDefendsOwner() {
  console.log('\n=== wolfDefendsOwner ===');
  const res = {};
  await resetPlayer(0, 0);
  await clearMobs();
  await setMode('survival');
  // positive: tamed wolf, owner just hurt by a zombie
  const wolf = await spawnMob('wolf', 2, 0, { tamed: true, owner: 'player', sitting: false });
  const zom = await spawnMob('zombie', -6, 0);
  await page.evaluate(mkFn(
    'var EL = MCL.EntityList, z = null;' +
    'for (var i=0;i<EL.list.length;i++) if (EL.list[i].id === ' + zom.id + ') z = EL.list[i];' +
    'if (z && MCL.Combat && MCL.Combat.mobAttack) MCL.Combat.mobAttack(z, MCL.Player);'
  ));
  await sleep(200);
  const justHurt = await page.evaluate(function () { return !!(MCL.Player.lastHurtByEntity); });
  await sleep(1500);
  const wolfAfter = await entityById(wolf.id);
  res.positive = { justHurt, wolfTarget: wolfAfter && wolfAfter.target };
  console.log('  positive: playerHurt=' + justHurt + ' wolfTarget=' + (wolfAfter && wolfAfter.target));

  // negative control: UNTAMED wolf near the same owner-hurt event should not retaliate
  await resetPlayer(0, 0);
  await clearMobs();
  const wolf2 = await spawnMob('wolf', 2, 0, { tamed: false });
  const zom2 = await spawnMob('zombie', -6, 0);
  await page.evaluate(mkFn(
    'var EL = MCL.EntityList, z = null;' +
    'for (var i=0;i<EL.list.length;i++) if (EL.list[i].id === ' + zom2.id + ') z = EL.list[i];' +
    'if (z && MCL.Combat && MCL.Combat.mobAttack) MCL.Combat.mobAttack(z, MCL.Player);'
  ));
  await sleep(1500);
  const wolf2After = await entityById(wolf2.id);
  res.negativeUntamed = { wolfTarget: wolf2After && wolf2After.target };
  console.log('  negative(untamed): wolfTarget=' + (wolf2After && wolf2After.target));
  return res;
}

// ═══ (c) creeper flees a nearby cat ═══
async function scenarioCreeperFleesCat() {
  console.log('\n=== creeperFleesCat ===');
  const res = {};
  await resetPlayer(-40, -40);
  await clearMobs();
  await setMode('survival');
  const creeper = await spawnMob('creeper', 0, 0);
  const cat = await spawnMob('cat', 3, 0, { tamed: false });
  const d0 = await dist(creeper.id, cat.id);
  await sleep(2500);
  const d1 = await dist(creeper.id, cat.id);
  res.withCat = { d0, d1, fled: d1 !== null && d0 !== null && d1 > d0 + 0.5 };
  console.log('  withCat: d0=' + d0 + ' d1=' + d1);

  // control: cat far away (outside the 6-block AvoidEntityGoal range) -- no flee signal
  await resetPlayer(-40, -40);
  await clearMobs();
  const creeper2 = await spawnMob('creeper', 0, 0);
  const cat2 = await spawnMob('cat', 30, 0, { tamed: false });
  const d0c = await dist(creeper2.id, cat2.id);
  await sleep(2500);
  const d1c = await dist(creeper2.id, cat2.id);
  res.farCatControl = { d0: d0c, d1: d1c, fled: d1c !== null && d0c !== null && d1c > d0c + 0.5 };
  console.log('  farCatControl: d0=' + d0c + ' d1=' + d1c);
  return res;
}

// ═══ (d) iron golem retaliates against a mob attacking a nearby villager ═══
async function scenarioGolemDefendsVillager() {
  console.log('\n=== golemDefendsVillager ===');
  const res = {};
  await resetPlayer(-40, -40);
  await clearMobs();
  await setMode('survival');
  const golem = await spawnMob('iron_golem', 0, 0);
  const vil = await spawnMob('villager', 3, 0);
  const zom = await spawnMob('zombie', 4, 1);
  // the zombie's own villager-targeting is NOT wired in this engine (Ai.OWED, 07k_goals.js:205-212)
  // -- force the join under test (golem reacting to a mob near/attacking a villager) directly.
  await page.evaluate(mkFn(
    'var EL = MCL.EntityList, z = null, v = null;' +
    'for (var i=0;i<EL.list.length;i++) { if (EL.list[i].id === ' + zom.id + ') z = EL.list[i]; if (EL.list[i].id === ' + vil.id + ') v = EL.list[i]; }' +
    'if (z && v) z.target = v;'
  ));
  // ⚠ TIMING: the golem's own MeleeAttackGoal (dmg 15) kills a 20-hp zombie in under 2s once it
  // acquires the target, and a dead target resets e.target to null -- sampling too LATE reads as
  // a false negative (D-30 style: this bug bit this very harness during authoring). Sample at
  // ~700ms (target acquired, zombie still alive) AND confirm the zombie took real damage.
  await sleep(700);
  const golemMid = await entityById(golem.id);
  const zomMid = await entityById(zom.id);
  await sleep(1300);
  const zomFinal = await entityById(zom.id);
  res.positive = {
    golemTargetMid: golemMid && golemMid.target,
    zombieHealthMid: zomMid && zomMid.health,
    zombieDiedOrHurt: !!(zomFinal && (zomFinal.dead || zomFinal.health < 20)),
  };
  console.log('  positive: golemTargetMid=' + (golemMid && golemMid.target) + ' zombieHealthMid=' + (zomMid && zomMid.health) + ' zombieDiedOrHurt=' + res.positive.zombieDiedOrHurt);

  // anti-vacuity: a creeper doing the exact same thing must NOT be targeted (jar's own
  // !(instanceof CreeperEntity) exclusion, IronGolemEntity.java:84)
  await resetPlayer(-40, -40);
  await clearMobs();
  const golem2 = await spawnMob('iron_golem', 0, 0);
  const vil2 = await spawnMob('villager', 3, 0);
  const creep = await spawnMob('creeper', 4, 1);
  await page.evaluate(mkFn(
    'var EL = MCL.EntityList, c = null, v = null;' +
    'for (var i=0;i<EL.list.length;i++) { if (EL.list[i].id === ' + creep.id + ') c = EL.list[i]; if (EL.list[i].id === ' + vil2.id + ') v = EL.list[i]; }' +
    'if (c && v) c.target = v;'
  ));
  await sleep(700);
  const golem2After = await entityById(golem2.id);
  const creepAfter = await entityById(creep.id);
  res.creeperExclusion = { golemTarget: golem2After && golem2After.target, creeperUntouched: !!(creepAfter && creepAfter.health === 20) };
  console.log('  creeperExclusion: golemTarget=' + (golem2After && golem2After.target) + ' creeperHealth=' + (creepAfter && creepAfter.health));
  return res;
}

const RUN = {
  villagerAggro: scenarioVillagerAggro,
  wolfDefendsOwner: scenarioWolfDefendsOwner,
  creeperFleesCat: scenarioCreeperFleesCat,
  golemDefendsVillager: scenarioGolemDefendsVillager,
};

for (const name of SCENARIOS) {
  if (!RUN[name]) { console.log('unknown scenario: ' + name); continue; }
  allResults.results[name] = await RUN[name]();
  writeFileSync(RESULTS_PATH, JSON.stringify(allResults, null, 2));
}

const warnings = await page.evaluate(function () { return window.__warnings || []; });
console.log('\n=== console problems ===', JSON.stringify(page.problems));
console.log('=== console warnings ===', JSON.stringify(warnings));
allResults.problems = (allResults.problems || []).concat(page.problems || []);
allResults.warnings = (allResults.warnings || []).concat(warnings || []);
writeFileSync(RESULTS_PATH, JSON.stringify(allResults, null, 2));
await page.close?.();
process.exit(0);
