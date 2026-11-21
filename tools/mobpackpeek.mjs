// mobpackpeek.mjs -- live-browser DIAGNOSTIC driver for MULTI-attacker / pack combat scenarios.
// Every prior deep-test pass (undeadmobpeek/nethermobpeek/petmobpeek/...) provoked each mob with
// exactly ONE attacker; this probes the same live AI with 2+ simultaneous attackers/targets and
// prints raw findings. Pattern follows tools/undeadmobpeek.mjs (spawn via MCL.Commands/EL.spawn,
// read real entity state off the real EL.tick() loop, screenshots optional/omitted here since
// this is a behaviour probe, not a pixel probe).
//
//   MCLITE_PRESET=medium node tools/mobpackpeek.mjs [a,b,c,d]
//
// Scenarios (letters match the ones mobpackcheck.mjs turns into assertions):
//   a. iron golem -- HurtByTargetGoal's single e.lastHurtByEntity slot vs 2 different simulated
//      attackers in sequence, and NearestAttackableTargetGoal's own re-acquire once the current
//      hostile-mob target is removed while a second one is still nearby (.decomp
//      IronGolemEntity.java:80-84: TrackIronGolemTargetGoal / RevengeGoal(no alert varargs) /
//      angry-player / ActiveTargetGoal<MobEntity>(5, Monster, !Creeper) / UniversalAngerGoal).
//      NOTE -- there is no vanilla "golem retaliates against whoever hit a villager it guards"
//      goal at all (golem's own hostile-mob target is UNCONDITIONAL presence-in-5-blocks, not
//      villager-defense-triggered) and mob-vs-mob damage is unbuilt in this engine (14j_combat.js
//      Cb.hurt's own header), so villagers cannot really be "attacked" by another mob here --
//      this probes the golem's own real multi-target-candidate + multi-simulated-attacker state
//      instead, which is what D-486's "shared anger timer" line actually touches.
//   b. zombified_piglin -- HurtByTargetGoal's pack alert (RevengeGoal.setGroupRevenge(), D-719)
//      with 4 piglins in range of the one that gets hit: does EVERY eligible piglin in range get
//      alerted, or does it stop early / double-set?
//   c. wolf pack -- 3 tamed wolves, same owner, one hostile mob hurts the owner:
//      Ai.OwnerHurtByTargetGoal is built as one goal INSTANCE per wolf (own closure `seen`) --
//      does each of the 3 independently acquire e.target === attacker?
//   d. two zombies vs the player -- independent MeleeAttackGoal/target state per entity: do both
//      keep e.target === player and keep closing distance over several seconds, no flicker/stall?
import { open, sleep } from './cdp.mjs';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const FILE = ROOT + 'dist/mclite.html';
const argScenarios = process.argv[2] && !process.argv[2].startsWith('-') ? process.argv[2].split(',') : null;
const SCEN = argScenarios || ['a', 'b', 'c', 'd'];

function mkFn(body) { return { toString: function () { return 'function(){' + body + '}'; } }; }

const page = await open(FILE, { width: 960, height: 540 });
if (!page) { console.log('SKIP -- no Chromium'); process.exit(0); }

await sleep(1200);
await page.evaluate(function () { if (window.MCL && MCL.Main && !MCL.Main.ready) MCL.Main.play({}); });
const ready = await page.waitFor(function () {
  return !!(window.MCL && MCL.Main.ready && MCL.Hud.mode === 'game' && MCL.World.chunks.size > 20);
}, 60000);
console.log('spawn ready:', ready);
if (!ready) { console.log('FATAL'); process.exit(1); }
await sleep(1000);
await page.settleWorld();

const PX = 7000, PZ = 7000, PY = 90;
const buildInfo = await page.evaluate(mkFn(
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
));
console.log('platform:', JSON.stringify(buildInfo));

async function ev(body) { return page.evaluate(mkFn(body)); }

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
    'if (MCL.Commands) { MCL.Commands.run("/gamemode survival", P, {name:"Dan"}); }' +
    'return 1;'
  );
  await sleep(200);
}

async function spawn(type, dx, dy, dz) {
  return ev(
    'var P = MCL.Player;' +
    'var x = ' + PX + ' + (' + dx + '), y = ' + PY + ' + (' + dy + '), z = ' + PZ + ' + (' + dz + ');' +
    'MCL.Commands.run("/summon ' + type + ' " + x + " " + y + " " + z, P, {name:"Dan"});' +
    'var EL = MCL.EntityList, best = null;' +
    'for (var i = EL.list.length - 1; i >= 0; i--) { if (EL.list[i].type === "' + type + '" && !best) { best = EL.list[i]; break; } }' +
    'return best ? { id: best.id, x: best.x, y: best.y, z: best.z } : null;'
  );
}

async function snap(ids) {
  return ev(
    'var EL = MCL.EntityList; var ids = ' + JSON.stringify(ids) + '; var out = [];' +
    'for (var k = 0; k < ids.length; k++) {' +
    '  var e = null;' +
    '  for (var i = 0; i < EL.list.length; i++) if (EL.list[i].id === ids[k]) { e = EL.list[i]; break; }' +
    '  out.push(e ? { id: e.id, x: +e.x.toFixed(2), z: +e.z.toFixed(2), target: e.target ? (e.target.type || "player") : null, targetId: e.target ? e.target.id : null, angerTime: e.angerTime||0, removed: !!e.removed, dead: !!e.dead, health: e.health } : null);' +
    '}' +
    'return out;'
  );
}

// ── a. iron golem: single-slot lastHurtByEntity vs 2 attackers, + re-acquire on target death ──
if (SCEN.includes('a')) {
  console.log('\n=== a. iron golem, multi-attacker ===');
  await resetScene();
  const g = await spawn('iron_golem', 0, 0, 0);
  const z1 = await spawn('zombie', 4, 0, 0);
  const z2 = await spawn('zombie', -4, 0, 0);
  console.log('spawned golem=' + JSON.stringify(g) + ' z1=' + JSON.stringify(z1) + ' z2=' + JSON.stringify(z2));
  // freeze the zombies so they do not wander off the platform mid-probe
  await ev('var EL=MCL.EntityList; for (var i=0;i<EL.list.length;i++){var o=EL.list[i]; if(o.type==="zombie"){o.ai=null;o.vx=o.vy=o.vz=0;}} return 1;');
  await sleep(2500);
  let s = await snap([g.id, z1.id, z2.id]);
  console.log('after 2.5s (unconditional hostile-mob target pick): ' + JSON.stringify(s));

  // simulate the golem being hit by z1, then by z2 -- HurtByTargetGoal.start() re-target each time
  await ev('var EL=MCL.EntityList; var golem=null,z1=null; for (var i=0;i<EL.list.length;i++){var o=EL.list[i]; if(o.id===' + g.id + ')golem=o; if(o.id===' + z1.id + ')z1=o;} MCL.Combat.notifyHurt(golem, z1); return 1;');
  await sleep(200);
  s = await snap([g.id, z1.id, z2.id]);
  console.log('after notifyHurt(golem, z1): golem.target should be z1: ' + JSON.stringify(s[0]));

  await ev('var EL=MCL.EntityList; var golem=null,z2=null; for (var i=0;i<EL.list.length;i++){var o=EL.list[i]; if(o.id===' + g.id + ')golem=o; if(o.id===' + z2.id + ')z2=o;} MCL.Combat.notifyHurt(golem, z2); return 1;');
  await sleep(200);
  s = await snap([g.id, z1.id, z2.id]);
  console.log('after notifyHurt(golem, z2) -- LATEST attacker should now be the target: ' + JSON.stringify(s[0]));

  // remove whichever zombie is currently targeted, verify re-acquire of the surviving one
  const cur = s[0].targetId;
  const survivorId = cur === z1.id ? z2.id : z1.id;
  await ev('var EL=MCL.EntityList; for (var i=0;i<EL.list.length;i++) if (EL.list[i].id===' + cur + ') { EL.remove(EL.list[i]); break; } return 1;');
  await sleep(3000);
  s = await snap([g.id, survivorId]);
  console.log('3s after removing golem\'s current target -- did it re-acquire the survivor? ' + JSON.stringify(s));
}

// ── b. zombified_piglin group alert with 4 piglins in range ──
if (SCEN.includes('b')) {
  console.log('\n=== b. zombified_piglin group alert (4 in range) ===');
  await resetScene();
  const p0 = await spawn('zombified_piglin', 0, 0, 0);
  const p1 = await spawn('zombified_piglin', 2, 0, 0);
  const p2 = await spawn('zombified_piglin', -2, 0, 0);
  const p3 = await spawn('zombified_piglin', 0, 0, 2);
  const p4 = await spawn('zombified_piglin', 0, 0, -2);
  const ids = [p0, p1, p2, p3, p4].map((p) => p.id);
  console.log('spawned 5 piglins: ' + JSON.stringify(ids));
  await ev('var EL=MCL.EntityList; for (var i=0;i<EL.list.length;i++){var o=EL.list[i]; if(o.type==="zombified_piglin" && o.id!==' + p0.id + '){o.ai=null;o.vx=o.vy=o.vz=0;}} return 1;');
  const zombie = await spawn('zombie', 30, 0, 30);
  await ev('var EL=MCL.EntityList; var p0=null,att=null; for (var i=0;i<EL.list.length;i++){var o=EL.list[i]; if(o.id===' + p0.id + ')p0=o; if(o.id===' + zombie.id + ')att=o;} MCL.Combat.notifyHurt(p0, att); return 1;');
  await sleep(200);
  const s = await snap(ids);
  console.log('after hitting p0 (attacker id=' + zombie.id + '): all 5 piglins: ' + JSON.stringify(s));
  const alerted = s.filter((x) => x.targetId === zombie.id).length;
  console.log('alerted count (target===attacker): ' + alerted + ' / 5 (self + 4 pack-mates)');
}

// ── c. wolf pack: 3 tamed wolves, same owner, owner hurt by a mob ──
if (SCEN.includes('c')) {
  console.log('\n=== c. wolf pack targeting (3 tamed, same owner) ===');
  await resetScene();
  const w0 = await spawn('wolf', 2, 0, 0);
  const w1 = await spawn('wolf', -2, 0, 0);
  const w2 = await spawn('wolf', 0, 0, 2);
  const ids = [w0, w1, w2].map((w) => w.id);
  await ev(
    'var EL=MCL.EntityList; var ids=' + JSON.stringify(ids) + ';' +
    'for (var i=0;i<EL.list.length;i++){var o=EL.list[i]; if (ids.indexOf(o.id)>=0){ o.tamed=true; o.owner="player"; o.sitting=false; o.ai_freeze_attackonly=true; } }' +
    'return 1;'
  );
  const zombie = await spawn('zombie', 0, 0, -6);
  await ev('var EL=MCL.EntityList; for (var i=0;i<EL.list.length;i++){var o=EL.list[i]; if(o.type==="zombie"){o.ai=null;o.vx=o.vy=o.vz=0;}} return 1;');
  await ev('var P=MCL.Player, EL=MCL.EntityList, att=null; for (var i=0;i<EL.list.length;i++) if (EL.list[i].id===' + zombie.id + ') att=EL.list[i]; MCL.Combat.notifyHurt(P, att); return 1;');
  await sleep(400);
  const s = await snap(ids);
  console.log('owner hurt by zombie(id=' + zombie.id + ') -- all 3 wolves target it? ' + JSON.stringify(s));
  const allAcquired = s.every((x) => x && x.targetId === zombie.id);
  console.log('all 3 wolves independently acquired target: ' + allAcquired);

  // second attacker -- confirm each wolf independently re-fires (per-instance `seen`, not shared)
  const zombie2 = await spawn('zombie', 0, 0, -8);
  await ev('var EL=MCL.EntityList; for (var i=0;i<EL.list.length;i++){var o=EL.list[i]; if(o.type==="zombie"){o.ai=null;o.vx=o.vy=o.vz=0;}} return 1;');
  await ev('var P=MCL.Player, EL=MCL.EntityList, att=null; for (var i=0;i<EL.list.length;i++) if (EL.list[i].id===' + zombie2.id + ') att=EL.list[i]; MCL.Combat.notifyHurt(P, att); return 1;');
  await sleep(400);
  const s2 = await snap(ids);
  console.log('owner hurt by SECOND zombie(id=' + zombie2.id + ') -- all 3 wolves re-target? ' + JSON.stringify(s2));
}

// ── d. two zombies vs the player, stable target/path ──
if (SCEN.includes('d')) {
  console.log('\n=== d. two zombies vs player, stable pathing ===');
  await resetScene();
  const z1 = await spawn('zombie', 6, 0, 0);
  const z2 = await spawn('zombie', -6, 0, 0);
  const ids = [z1.id, z2.id];
  for (let i = 0; i < 5; i++) {
    await sleep(1000);
    const s = await snap(ids);
    const pd = await ev(
      'var P=MCL.Player, EL=MCL.EntityList, ids=' + JSON.stringify(ids) + '; var out=[];' +
      'for (var k=0;k<ids.length;k++){var e=null; for(var i=0;i<EL.list.length;i++) if(EL.list[i].id===ids[k]) e=EL.list[i];' +
      '  out.push(e ? +Math.hypot(e.x-P.x, e.z-P.z).toFixed(2) : null);}' +
      'return out;'
    );
    console.log('t=' + (i + 1) + 's: ' + JSON.stringify(s) + ' distToPlayer=' + JSON.stringify(pd));
  }
}

console.log('\n=== console problems ===', JSON.stringify(page.problems));
await page.close?.();
process.exit(0);
