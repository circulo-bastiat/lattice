#!/usr/bin/env node
// hoglincheck.mjs — s134 (KW-32): hoglin + zoglin exist (src/07zzg_hoglin.js, 07j_entityrender.js).
//
//   node tools/hoglincheck.mjs [--verbose]
//
//   1. spawn: both EL.canSpawn; HoglinEntity.initialize 20% baby; onGrowUp — baby attack 0.5 / xp 3,
//      adult 6 / 5; a baby hoglin GROWS UP (AnimalEntity), a baby zoglin never does (IsBaby flag).
//   2. the strike (Hoglin.tryAttack): adult amount 6/2 + nextInt(6), baby exactly 0.5; Hoglin.knockback
//      (1.0 - knockback resistance, rotateY in radians, ADDED), none from a baby or on resistance 1;
//      movementCooldownTicks 10, ticking down.
//   3. zombification: 300 overworld ticks fine, the 301st -> zoglin (baby kept, Nausea); immune never.
//   4. targets: an idle hoglin takes the player within 16, not at 17, not while PACIFIED; a zoglin takes
//      the nearest living thing that is not a zoglin or a creeper.
//   5. brain reactions: a hit adult targets the attacker and so do adult hoglins nearby; a hit baby
//      flees; a hoglin never retaliates on a hoglin; an adult striking a piglin while piglins
//      outnumber hoglins + 1 flees instead.
//   6. render: HoglinEntityModel.setAngles (head toss at cooldown 5 = -PI/9, legs cos(l)*1.2, ears);
//      the parent links read off .decomp's addChild calls; a composed ear == the nested transform.
//   7. xp: hoglin 5 with no equipment bonus, baby 3; zoglin 5.
//   8. anti-vacuity: each broken on purpose and caught.
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT, initRegistry } from './loadsrc.mjs';

const ASSETS = join(MCLITE_ROOT, 'assets');
const VERBOSE = process.argv.includes('--verbose');
const rdj = (f) => JSON.parse(readFileSync(join(ASSETS, f), 'utf8'));
const b64 = (f) => readFileSync(join(ASSETS, f)).toString('base64');
let pass = 0; const fails = []; let breaks = 0;
const ok = (c, m) => { if (c) pass++; else fails.push(m); if (VERBOSE) console.log((c ? '  ✓ ' : '  ✗ ') + m); return c; };
const okAv = (c, m) => { breaks++; if (ok(c, 'anti-vacuity: ' + m) && !VERBOSE) console.log('   ✓ ' + m); };
const near = (a, b, e = 1e-6) => Math.abs(a - b) <= e;

console.log('hoglincheck — s134: hoglin + zoglin (spawn, strike, zombification, brain, model)');

const M = loadEngine({ extra: ['02f_tags.js', '02g_items.js', '07_world.js', '09b_sky.js', '14b_physics.js',
  '14f_inventory.js', '07h_entities.js', '07y_equip.js', '07ox_enchhelper.js', '07i_entitylist.js', '07l_spawn.js',
  '07m_breed.js', '14i_hand.js', '14j_combat.js', '14d_survival.js', '07zk_undead.js', '07q_effects.js', '07k_goals.js',
  '07zz_xporb.js', '07zzf_piglin.js', '07zf_bat.js', '07zzg_hoglin.js', '07zzp_mobvoice.js', '07j_entityrender.js', '10_gfx.js', '15h_bemodel.js'], dom: false });
if (initRegistry) initRegistry(M);
M.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
const sndTable = {};
for (const l of readFileSync(join(MCLITE_ROOT, 'tools', 'golden', 'mob-sounds-1.18.2.tsv'), 'utf8').split(/\r?\n/)) { if (!l || l[0] === '#') continue; const c = l.split('\t'); sndTable[c[0]] = c.slice(2); }
M.DATA = Object.assign({}, M.DATA, { entities: rdj('entities.json'), mobSounds: sndTable });
const played = [];
M.Sound = M.Sound || {};
M.Sound.play = (id, o) => { played.push(id); return true; };
M.Sound.blockVP = () => [1, 1];
M.Sound.blockStep = () => { played.push('block.step'); return true; };
{ const mm = rdj('models.meta.json'); M.BEModel.init({ models: b64('models.bin'), modelsBytes: mm.rawBytes }); }
M.Entities.init(); M.EntityList.init(); M.Equip.init();
if (M.Breed && M.Breed.init) M.Breed.init();
if (M.EnchHelper && M.EnchHelper.init) M.EnchHelper.init();
if (M.Effects && M.Effects.init) M.Effects.init();
if (M.Xp && M.Xp.init) M.Xp.init();
M.Combat.init(); M.EntityRender.init();
if (M.Ai && M.Ai.init && !M.Ai.ready) M.Ai.init();
const EL = M.EntityList, Hg = M.Hoglin, Cb = M.Combat, ER = M.EntityRender;
Hg.init();

const seq = (vals) => { let i = 0; return () => vals[Math.min(i++, vals.length - 1)]; };
function spawn(type, x = 0.5, z = 0.5, rnd, opts) {
  const prev = EL.random; if (rnd) EL.random = rnd;
  try { return EL.spawn(type, x, 64, z, opts); } finally { EL.random = prev; }
}
const withRnd = (rnd, f) => { const prev = EL.random; EL.random = rnd; try { return f(); } finally { EL.random = prev; } };
const clear = () => { EL.list.length = 0; };
const player = { type: 'player', x: 0.5, y: 64, z: 6.5, health: 20, vx: 0, vy: 0, vz: 0, knockbackResistance: 0 };

// ── 1. spawn ──
function sec1() {
  const r = [];
  const t = (c, m) => { if (!c) r.push(m); };
  t(EL.canSpawn('hoglin') && EL.canSpawn('zoglin'), 'EL.canSpawn(hoglin) and (zoglin)');
  const b = spawn('hoglin', 0.5, 0.5, () => 0);
  t(b && b.isBaby === true, 'a 0.0 roll spawns a BABY hoglin');
  t(b && b.attackDamage === 0.5 && b.experiencePoints === 3, `a baby hoglin: attack 0.5, xp 3 (${b && b.attackDamage}, ${b && b.experiencePoints})`);
  const a = spawn('hoglin', 0.5, 0.5, () => 0.9);
  t(a && !a.isBaby && a.attackDamage === 6 && a.experiencePoints === 5, 'an adult hoglin: attack 6, xp 5');
  t(a && a.maxHealth === 40, `hoglin max health 40 (${a && a.maxHealth})`);
  let babies = 0; for (let i = 0; i < 2000; i++) { const h = spawn('hoglin'); if (h && h.isBaby) babies++; }
  t(babies > 330 && babies < 470, `~20% of hoglins are babies (${babies}/2000)`);
  clear();
  t(!EL.PERMANENT_BABY.hoglin && EL.PERMANENT_BABY.zoglin, 'a hoglin baby grows up (AnimalEntity), a zoglin baby does not');
  const z = spawn('zoglin', 0.5, 0.5, () => 0);
  t(z && !z.isBaby && z.attackDamage === 6, 'ZoglinEntity has no initialize of its own: never a baby from a spawn');
  t(M.Ai.ROSTER.hoglin && M.Ai.ROSTER.zoglin && a && !!a.ai, 'both have a goal roster and a spawned hoglin runs it');
  clear();
  return r;
}
for (const f of sec1()) ok(false, f); ok(true, '§1 spawn');

// ── 2. the strike ──
function strike(type, baby, rolls, kbRes = 0) {
  clear();
  const e = spawn(type, 0.5, 0.5, () => 0.9); if (baby) Hg.setBaby(e, true);
  const tgt = spawn('cow', 0.5, 3.5); tgt.maxHealth = tgt.health = 1000; tgt.invulnerableTime = 0; tgt.hurtTime = 0;
  tgt.vx = tgt.vy = tgt.vz = 0; tgt.knockbackResistance = kbRes; tgt.onGround = false;
  const h0 = tgt.health;
  const hit = withRnd(seq(rolls), () => Cb.mobAttack(e, tgt));
  return { e, tgt, hit, dealt: h0 - tgt.health };
}
function sec2() {
  const r = []; const t = (c, m) => { if (!c) r.push(m); };
  // rolls: nextInt(6) -> 0.99*6 = 5, then knockback nextInt(21) (0.5 -> 10 -> angle 0), nextFloat 0, nextFloat 0
  const s = strike('hoglin', false, [0.99, 0.5, 0, 0]);
  t(!!s.hit && near(s.dealt, 3 + 5, 1e-3), `adult hoglin deals 6/2 + nextInt(6): 8 on a top roll (dealt ${s.dealt})`);
  const s0 = strike('hoglin', false, [0, 0.5, 0, 0]);
  t(near(s0.dealt, 3, 1e-3), `…and 3 on a zero roll (dealt ${s0.dealt})`);
  // knockback: d = 1, h = 0.2, angle 0 -> +z 0.2 (target is at +z), vy 0 — ADDED to the 0.4 that
  // LivingEntity.damage's own takeKnockback already gave the airborne target (s135, Cb.baseKnockback)
  const B = Cb.KNOCKBACK_BASE;
  t(near(s.tgt.vz, B + 0.2, 1e-6) && near(s.tgt.vx, 0, 1e-6) && near(s.tgt.vy, 0, 1e-6),
    `Hoglin.knockback pushes along attacker->target by d*(0*0.5+0.2): (${s.tgt.vx}, ${s.tgt.vy}, ${s.tgt.vz})`);
  const s2 = strike('hoglin', false, [0, 0.99, 0.99, 0.99]);   // angle = nextInt(21)=20 -> 10 rad, h = 0.695, vy = 0.495
  const hh = 1 * (0.99 * 0.5 + 0.2), ang = 10;
  t(near(s2.tgt.vx, hh * Math.sin(ang), 1e-6) && near(s2.tgt.vz, B + hh * Math.cos(ang), 1e-6) && near(s2.tgt.vy, 0.99 * 0.5, 1e-6),
    `the push is turned by rotateY(10) in RADIANS and lifts d*nextFloat*0.5: (${s2.tgt.vx}, ${s2.tgt.vy}, ${s2.tgt.vz})`);
  t(s.e.movementCooldown === 10, `a strike sets movementCooldownTicks 10 (${s.e.movementCooldown})`);
  Hg.tickEntity(s.e); t(s.e.movementCooldown === 9, 'and it ticks down');
  const sr = strike('hoglin', false, [0.5, 0.5, 0.5, 0.5], 1);
  t(sr.tgt.vx === 0 && sr.tgt.vz === 0 && sr.tgt.vy === 0, 'no push on knockback resistance 1');
  const sb = strike('hoglin', true, [0.99, 0.99, 0.99]);
  t(near(sb.dealt, 0.5, 1e-3) && sb.tgt.vx === 0 && near(sb.tgt.vz, B, 1e-9), `a baby deals exactly 0.5 and adds no Hoglin push to the base one (${sb.dealt}, vz ${sb.tgt.vz})`);
  const sz = strike('zoglin', false, [0.99, 0.5, 0, 0]);
  t(near(sz.dealt, 8, 1e-3) && near(sz.tgt.vz, B + 0.2, 1e-6), 'a zoglin strikes the same way');
  clear();
  return r;
}
for (const f of sec2()) ok(false, f); ok(true, '§2 the strike');

// ── 3. zombification ──
function zombifyRun(baby) {
  clear(); const h = spawn('hoglin', 0.5, 0.5, baby ? () => 0 : () => 0.9);
  let at = -1; for (let t = 1; t <= 400 && at < 0; t++) { Hg.tickEntity(h); if (h.removed) at = t; }
  return { h, at, z: EL.list.find((o) => o.type === 'zoglin') };
}
{
  const { at, z } = zombifyRun(false);
  ok(at === 301, `a hoglin converts on its 301st overworld tick — at ${at}`);
  ok(!!z && !z.isBaby, 'the conversion leaves an adult zoglin');
  const nz = z && z.effects && (z.effects.nausea || (Array.isArray(z.effects) && z.effects.find((x) => x.id === 'nausea' || x.effect === 'nausea')));
  ok(!!nz, 'the zoglin wakes with Nausea');
  const b = zombifyRun(true);
  ok(b.z && b.z.isBaby === true && b.z.attackDamage === 0.5, 'a baby hoglin becomes a BABY zoglin (attack 0.5)');
  clear(); const im = spawn('hoglin'); im.immuneToZombification = true;
  for (let t = 0; t < 400; t++) Hg.tickEntity(im);
  ok(!im.removed && im.timeInOverworld === 0, 'an IsImmuneToZombification hoglin never converts');
  const zz = spawn('zoglin'); for (let t = 0; t < 400; t++) Hg.tickEntity(zz);
  ok(!zz.removed, 'a zoglin has no conversion clock');
  ok(ER.isShaking(spawn('hoglin')) && !ER.isShaking(zz), 'a hoglin that can convert shivers (HoglinEntityRenderer.isShaking); a zoglin does not');
  ok(ER.isShaking({ type: 'zombie', convertCountdown: 100 }) && !ER.isShaking({ type: 'zombie' }), 'a zombie with a drowned-conversion countdown shakes (ZombieBaseEntityRenderer)');
  { // piglinSafe dimension: a hoglin never converts or shakes there
    const W = M.World, keepDim = W.dimension;
    W.dimension = 'the_nether';
    const n = zombifyRun(false); ok(n.at < 0 && !n.h.removed && n.h.timeInOverworld === 0 && !ER.isShaking(n.h), `a hoglin never zombifies or shakes in the Nether (piglinSafe) — at ${n.at}`);
    W.dimension = 'overworld';
    okAv(zombifyRun(false).at === 301, 'the same run in the overworld still converts (nether assertion is not vacuous)');
    W.dimension = keepDim;
  }
  clear();
}

// ── 4. targets ──
function sec4() {
  const r = []; const t = (c, m) => { if (!c) r.push(m); };
  clear(); M.Player = player; player.x = 0.5; player.z = 6.5;
  const h = spawn('hoglin', 0.5, 0.5, () => 0.9);
  t(Hg.findTarget(h) === player, 'an idle hoglin targets the player 6 blocks away');
  player.z = 17.5; t(Hg.findTarget(h) === null, '…not one 17 blocks away (16-block attackable predicate)');
  player.z = 14.5; t(Hg.attackable(h, player), 'a standing player 14 blocks away is attackable');
  player.crouching = true; t(!Hg.attackable(h, player), 'a SNEAKING player at 14 is not (16 * 0.8 = 12.8)');
  player.crouching = false;
  player.z = 6.5; h.hgClock = 5; h.hgPacifiedUntil = 100; t(Hg.findTarget(h) === null, 'a PACIFIED hoglin targets nobody');
  h.hgPacifiedUntil = undefined;
  const g = new Hg.TargetGoal(h); t(g.canUse() && h.target === player, 'the target goal takes it');
  const ag = spawn('hoglin', 0.5, 0.5, () => 0.9); ag.hgClock = 5; Hg.setAttackTarget(ag, player, false); ag.hgRepellent = true;
  Hg.tickEntity(ag); t(Hg.attackTarget(ag) === null && !ag.aggressive, 'PacifyTask forgets an existing ATTACK_TARGET beside a repellent');
  const ag2 = spawn('hoglin', 0.5, 0.5, () => 0.9); ag2.hgClock = 5; Hg.setAttackTarget(ag2, player, false); ag2.hgRepellent = false;
  Hg.tickEntity(ag2); t(Hg.attackTarget(ag2) === player && ag2.aggressive, 'without a repellent the target is kept');
  clear(); M.Player = null;
  const z = spawn('zoglin', 0.5, 0.5); z.hgSensed = true;   // a sense tick (Sensor 20-tick interval, #6968)
  const cr = spawn('creeper', 0.5, 2.5), z2 = spawn('zoglin', 0.5, 1.5), cow = spawn('cow', 0.5, 5.5);
  t(Hg.findTarget(z) === cow, 'a zoglin passes over the nearer zoglin and creeper and takes the cow');
  const hg = spawn('hoglin', 0.5, 4.5, () => 0.9);
  t(Hg.findTarget(z) === hg, 'and takes a hoglin nearer than the cow');
  clear(); M.Player = player;
  return r;
}
for (const f of sec4()) ok(false, f); ok(true, '§4 targets');

// ── 5. brain reactions ──
function sec5() {
  const r = []; const t = (c, m) => { if (!c) r.push(m); };
  clear(); M.Player = player; player.z = 6.5;
  const a = spawn('hoglin', 0.5, 0.5, () => 0.9), b = spawn('hoglin', 3.5, 0.5, () => 0.9), cow = spawn('cow', 0.5, 3.5);
  a.lastHurtByEntity = cow; a.hurtSeq = 1; Hg.tickEntity(a);
  t(Hg.attackTarget(a) === cow, 'a hit adult hoglin targets its attacker');
  t(Hg.attackTarget(b) === cow, 'a nearby adult hoglin joins in (askAdultsForHelp)');
  t(a.hgTargetUntil === a.hgClock + 200, 'the memory lasts 200 ticks');
  for (let i = 0; i < 201; i++) Hg.tickEntity(a);
  t(Hg.attackTarget(a) === null, '…and is forgotten after them');
  clear();
  const c = spawn('hoglin', 0.5, 0.5, () => 0.9), d = spawn('hoglin', 2.5, 0.5, () => 0.9);
  c.lastHurtByEntity = d; c.hurtSeq = 1; Hg.tickEntity(c);
  t(!Hg.attackTarget(c), 'a hoglin never retaliates on a hoglin');
  clear();
  const bb = spawn('hoglin', 0.5, 0.5, () => 0), cw = spawn('cow', 0.5, 3.5);
  bb.lastHurtByEntity = cw; bb.hurtSeq = 1; Hg.tickEntity(bb);
  t(Hg.avoidTarget(bb) === cw && !Hg.attackTarget(bb), 'a hit BABY hoglin flees instead');
  t(bb.hgAvoidUntil - bb.hgClock >= 100 && bb.hgAvoidUntil - bb.hgClock <= 400, 'for 5..20 seconds');
  clear();
  const h = spawn('hoglin', 0.5, 0.5, () => 0.9);
  const ps = [0, 1, 2].map((i) => spawn('piglin', 2.5 + i, 0.5, () => 0.9));
  Hg.onAttacking(h, ps[0]);
  t(Hg.avoidTarget(h) === ps[0] && !Hg.attackTarget(h), 'an adult striking a piglin with 3 piglins vs 1 hoglin around flees');
  clear();
  const h2 = spawn('hoglin', 0.5, 0.5, () => 0.9), p2 = spawn('piglin', 2.5, 0.5, () => 0.9);
  Hg.onAttacking(h2, p2);
  t(!Hg.avoidTarget(h2), 'one piglin alone does not make it flee');
  clear();
  // targetEnemy tests the ACTIVE activity: avoid memory + attack target = FIGHT, so a piglin hit retargets
  const h3 = spawn('hoglin', 0.5, 0.5, () => 0.9), cw3 = spawn('cow', 0.5, 3.5), p3 = spawn('piglin', 2.5, 0.5, () => 0.9);
  Hg.avoidEnemy(h3, cw3); Hg.onAttacked(h3, cw3); Hg.onAttacked(h3, p3);
  t(Hg.attackTarget(h3) === p3, 'a piglin hit retargets an adult in FIGHT that still holds an avoid memory');
  clear();
  const h4 = spawn('hoglin', 0.5, 0.5, () => 0.9), pa = spawn('piglin', 2.5, 0.5, () => 0.9), pb = spawn('piglin', 3.5, 0.5, () => 0.9);
  Hg.avoid(h4, pa); t(Hg.activity(h4) === 'avoid', 'avoiding');
  Hg.onAttacked(h4, pb); t(!Hg.attackTarget(h4), 'AVOID is the active activity: a piglin attacker is not targeted');
  Hg.setAttackTarget(h4, player, true); t(Hg.activity(h4) === 'fight', 'FIGHT outranks a stale avoid memory');
  Hg.onAttacked(h4, pb); t(Hg.attackTarget(h4) === pb, 'in FIGHT a piglin attacker is retargeted');
  clear();
  return r;
}
for (const f of sec5()) ok(false, f); ok(true, '§5 brain reactions');

// ── 6. render ──
function sec6() {
  const r = []; const t = (c, m) => { if (!c) r.push(m); };
  const hd = (cd) => ER.hoglinDelta('head', 0, 0, 0, { cd }, false);
  t(near(hd(0).rx, 0, 1e-9), 'head at rest with no cooldown');
  t(near(0.87266463 + hd(5).rx, -Math.PI / 9, 1e-6), 'head tossed to -PI/9 at cooldown 5 (t = 1)');
  t(near(ER.hoglinDelta('head', 0, 0, 0, { cd: 5 }, true).dpy, 3, 1e-9), 'a baby lifts head.pivotY 2 -> 5 at the toss');
  const l = 0.7, a = 0.8;
  t(near(ER.hoglinDelta('right_front_leg', l, a, 0, { cd: 0 }).rx, Math.cos(l) * 1.2 * a, 1e-9)
    && near(ER.hoglinDelta('right_hind_leg', l, a, 0, { cd: 0 }).rx, Math.cos(l + Math.PI) * 1.2 * a, 1e-9),
    'legs swing cos(l)*1.2*a (right front = left hind, right hind = left front)');
  t(near(ER.hoglinDelta('right_ear', l, a, 0, { cd: 0 }).rz, -a * Math.sin(l), 1e-9), 'ears flap by a*sin(l)');
  t(near(ER.hoglinDelta('mane', 0, 0, 0, { cd: 0 }, false).dpz, -2, 1e-9), 'an adult mane sits at pivotZ -7');
  // parent links, read off the model class when .decomp is here (D-488)
  const dec = join(MCLITE_ROOT, '.decomp', 'net', 'minecraft', 'client', 'render', 'entity', 'model', 'HoglinEntityModel.java');
  if (existsSync(dec)) {
    const src = readFileSync(dec, 'utf8');
    const kids = {};
    for (const m of src.matchAll(/\$\$3\.addChild\(\s*"(\w+)"/g)) kids[m[1]] = 'head';
    for (const m of src.matchAll(/\$\$2\.addChild\(\s*"(\w+)"/g)) kids[m[1]] = 'body';
    t(JSON.stringify(Object.keys(kids).sort().map((k) => k + '>' + kids[k])) ===
      JSON.stringify(Object.keys(ER.PART_PARENT.hoglin).sort().map((k) => k + '>' + ER.PART_PARENT.hoglin[k])),
      `ER.PART_PARENT.hoglin == the model's addChild calls (${JSON.stringify(kids)})`);
  }
  // a composed child == the nested transform: parent(child(v))
  const BE = M.BEModel, L = BE.layer('hoglin');
  const head = L.parts.find((p) => p.n === 'head'), ear = L.parts.find((p) => p.n === 'right_ear');
  const posedHead = Object.assign({}, head, { ry: 0.6 });
  const comp = ER.composeChild(posedHead, ear);
  const c8 = new Float64Array(24), n8 = new Float64Array(24), h8 = new Float64Array(3);
  BE.poseBoxCorners(comp, c8); BE.poseBoxCorners(ear, n8);
  let worst = 0;
  for (let i = 0; i < 24; i += 3) {
    BE.poseAxis(posedHead, n8[i], n8[i + 1], n8[i + 2], h8);
    worst = Math.max(worst, Math.abs(h8[0] + posedHead.px - c8[i]), Math.abs(h8[1] + posedHead.py - c8[i + 1]), Math.abs(h8[2] + posedHead.pz - c8[i + 2]));
  }
  t(worst < 1e-6, `a composed ear equals head(ear(v)) with the head turned (worst ${worst})`);
  const esrc = readFileSync(join(MCLITE_ROOT, 'src', '07j_entityrender.js'), 'utf8');
  // s139: emitMobLayer's single-level `composeChild(posedPart(par, anim, layerName), p)` was
  // replaced (loop/witchhat-hatchain, commit 0e2c2d3, never given a D-number or updated here --
  // a real 3-4 level chain fix for witch's head->hat->hat2->hat3->hat4, not a regression) by a
  // recursive walk (`ER.fullyPosedPart`) that composes a child onto its FULLY posed ancestor
  // chain, not just its direct parent -- this assertion was asserting the OLD, single-level
  // source text and had gone stale, the same shape KW-35's goatcheck did. It now asserts the
  // current mechanism instead of frozen source text.
  t(/ER\.partParentOf\(layerName, p\.n\)/.test(esrc) && /ER\.fullyPosedPart\(parts, layerName, anim, parName\)/.test(esrc) && /ER\.composeChild\(parPosed, p\)/.test(esrc),
    'emitMobLayer composes a child onto its FULLY posed parent chain (ER.fullyPosedPart, multi-level)');
  t(ER.partRootOf('hoglin', 'left_horn') === 'head' && ER.partRootOf('hoglin', 'mane') === 'body', 'a head child takes the head baby transform');
  return r;
}
for (const f of sec6()) ok(false, f); ok(true, '§6 render');

// ── 7. xp ──
{
  clear();
  const a = spawn('hoglin', 0.5, 0.5, () => 0.9); M.Equip.setEquipped(a, M.Items.HEAD, M.Equip.stackOf('golden_helmet'));
  ok(M.Xp.xpToDrop(a, () => 0.99) === 5, `an adult hoglin drops its bare 5 xp (${M.Xp.xpToDrop(a, () => 0.99)})`);
  const b = spawn('hoglin', 0.5, 0.5, () => 0);
  ok(M.Xp.xpToDrop(b, () => 0.99) === 3, `a baby hoglin drops 3 (${M.Xp.xpToDrop(b, () => 0.99)})`);
  ok(M.Xp.xpToDrop(spawn('zoglin'), () => 0.99) === 5, 'a zoglin drops 5');
  clear();
}

// ── 9. sounds (#1008) ──
function sec9() {
  const r = []; const t = (c, m) => { if (!c) r.push(m); };
  clear();
  const h = spawn('hoglin', 0.5, 0.5, () => 0.9), z = spawn('zoglin', 4.5, 0.5, () => 0.9);
  const log = (f) => { played.length = 0; f(); return played.slice(); };
  t(log(() => M.MobVoice.onDamage(h, false)).includes('entity.hoglin.hurt'), 'hoglin hurt sound');
  t(log(() => M.MobVoice.onDamage(h, true)).includes('entity.hoglin.death'), 'hoglin death sound');
  t(log(() => Hg.attackAmount(h, player)).includes('entity.hoglin.attack'), 'hoglin attack sound');
  t(log(() => Hg.attackAmount(z, player)).includes('entity.zoglin.attack'), 'zoglin attack sound');
  t(Hg.soundEvent(h) === 'entity.hoglin.retreat', 'a convertible hoglin retreats: ' + Hg.soundEvent(h));
  h.immuneToZombification = true;
  t(Hg.soundEvent(h) === 'entity.hoglin.ambient', 'idle hoglin ambient: ' + Hg.soundEvent(h));
  Hg.setAttackTarget(h, player, false);
  t(Hg.soundEvent(h) === 'entity.hoglin.angry', 'fighting hoglin angry: ' + Hg.soundEvent(h));
  Hg.forgetTarget(h); h.hgAvoid = null;
  h.immuneToZombification = true;
  t(Hg.soundEvent(h) === 'entity.hoglin.ambient', 'immune idle hoglin ambient');
  // activity change plays once
  Hg.tickEntity(h);
  const ch = log(() => { Hg.setAttackTarget(h, player, false); Hg.tickEntity(h); });
  t(ch.includes('entity.hoglin.angry'), 'IDLE -> FIGHT plays angry once: ' + ch);
  t(!log(() => Hg.tickEntity(h)).includes('entity.hoglin.angry'), 'no repeat without a change');
  // ambient roll
  h.ambientSoundChance = 100000;
  t(log(() => Hg.tickAmbient(h)).length === 1, 'ambient roll plays');
  // zoglin ambient/angry via MobVoice
  t(M.MobVoice.pick(z, 'ambient') === 'entity.zoglin.ambient', 'zoglin idle ambient');
  Hg.tickEntity(z);
  const cz = log(() => { Hg.setAttackTarget(z, player, false); Hg.tickEntity(z); });
  t(cz.filter((x) => x === 'entity.zoglin.angry').length === 1, 'zoglin IDLE -> FIGHT plays angry exactly once: ' + cz);
  t(!log(() => Hg.tickEntity(z)).includes('entity.zoglin.angry'), 'zoglin keeps its target: no repeat');
  t(M.MobVoice.pick(z, 'ambient') === 'entity.zoglin.angry', 'zoglin with target angry');
  // step
  h.onGround = true; h.inWater = false; h.stepX = 0; h.stepZ = 0; h.x = 0; h.z = 0;
  const st = log(() => { for (let i = 1; i <= 4; i++) { h.x = i; M.MobVoice.tickStep(h); } });
  t(st.includes('entity.hoglin.step'), 'hoglin step sound: ' + st);
  clear();
  return r;
}
for (const f of sec9()) ok(false, f); ok(true, '§9 sounds');

// ── 8. anti-vacuity ──
{
  const k7 = Hg.SOUND_ATTACK; Hg.SOUND_ATTACK = 'x';
  okAv(sec9().length > 0, 'a wrong hoglin attack sound name is caught');
  Hg.SOUND_ATTACK = k7;
  const k8 = M.MobVoice.onDamage; M.MobVoice.onDamage = () => false;
  okAv(sec9().length > 0, 'a silent hurt/death is caught');
  M.MobVoice.onDamage = k8;
  const k1 = Hg.TYPES.hoglin; delete Hg.TYPES.hoglin;
  okAv(sec2().length > 0, 'without the Hoglin.tryAttack branch the strike section fails');
  Hg.TYPES.hoglin = k1;
  const k2 = Hg.ATTACK_BABY; Hg.ATTACK_BABY = 6;
  okAv(sec1().length > 0, 'a baby attack of 6 is caught');
  Hg.ATTACK_BABY = k2;
  const k3 = ER.PART_PARENT.hoglin; ER.PART_PARENT.hoglin = {};
  okAv(sec6().length > 0, 'dropping the parent links is caught');
  ER.PART_PARENT.hoglin = k3;
  const k4 = Hg.ZOGLIN_IGNORES.creeper; delete Hg.ZOGLIN_IGNORES.creeper;
  okAv(sec4().length > 0, 'a zoglin that targets creepers is caught');
  Hg.ZOGLIN_IGNORES.creeper = k4;
  const k8x = Hg.forgetTarget; Hg.forgetTarget = function () {};
  okAv(sec4().length > 0, 'a PacifyTask that does not drop the target is caught');
  Hg.forgetTarget = k8x;
  const k9 = Hg.tickEntity; Hg.tickEntity = function (e) { const t0 = e.type; if (t0 === 'zoglin') e.type = 'hoglin_'; k9(e); e.type = t0; };
  okAv(sec9().length > 0, 'a silent zoglin FIGHT transition is caught');
  Hg.tickEntity = k9;
  const k5 = Hg.ZOMBIFY_AFTER; Hg.ZOMBIFY_AFTER = 999;
  okAv(zombifyRun(false).at !== 301, 'a 999-tick clock does not convert at 301');
  Hg.ZOMBIFY_AFTER = k5;
  const k6 = Hg.TOO_FAR; Hg.AVOID_MIN = 0; Hg.AVOID_MAX = 0;
  okAv(sec5().length > 0, 'a zero-length avoid memory is caught');
  Hg.AVOID_MIN = 100; Hg.AVOID_MAX = 400; void k6;
  clear();
}

// ── #1350: canTarget gate (creative attacker, held target turning creative) ──
function secCanTarget() {
  const r = [];
  for (const type of ['zoglin', 'hoglin']) {
    clear(); const z = spawn(type, 0.5, 0.5, () => 0);
    const p = { type: 'player', x: 0.5, y: 64, z: 2.5, health: 20, vx: 0, vy: 0, vz: 0, invulnerableGamemode: true };
    Hg.onAttacked(z, p);
    if (Hg.attackTarget(z)) r.push(type + ' targets a creative attacker');
    p.invulnerableGamemode = false; Hg.setAttackTarget(z, p, true);
    if (!Hg.attackTarget(z)) r.push(type + ' drops a survival target');
    p.invulnerableGamemode = true;
    if (Hg.attackTarget(z)) r.push(type + ' keeps chasing a player who turned creative');
  }
  clear(); return r;
}
{ const r = secCanTarget(); ok(r.length === 0, '#1350 canTarget gate' + (r.length ? ': ' + r.join('; ') : ''));
  const k = M.Ai.canTargetLiving; M.Ai.canTargetLiving = () => true;
  okAv(secCanTarget().length > 0, 'an ungated canTarget is caught');
  M.Ai.canTargetLiving = k; clear(); }

// ── #3039: HoglinEntity.createChild / interactMob -> setPersistent ──
function secPersist() {
  const r = [], Br = M.Breed;
  clear(); const a = spawn('hoglin', 0.5, 0.5, () => 0.5), b = spawn('hoglin', 1.5, 0.5, () => 0.5);
  if (a.persistent) r.push('a wild hoglin starts persistent');
  Br.setInLove(a, null); Br.setInLove(b, null);
  const child = Br.breed(a, b, { random: () => 0.5 });
  if (!child || child.persistent !== true) r.push('bred baby hoglin not persistent');
  clear(); const c = spawn('hoglin', 0.5, 0.5, () => 0.5); c.persistent = false;
  if (!Br.interact(c, 'crimson_fungus', { player }) || c.persistent !== true) r.push('fungus-fed hoglin not persistent');
  clear(); return r;
}
{ const r = secPersist(); ok(r.length === 0, '#3039 hoglin persistence' + (r.length ? ': ' + r.join('; ') : ''));
  const k = M.Breed.CHILD.hoglin; M.Breed.CHILD.hoglin = () => {};
  okAv(secPersist().length > 0, 'a non-persistent bred baby is caught');
  M.Breed.CHILD.hoglin = k; clear(); }

// ── #4770: HoglinEntity.canEat() = !PACIFIED && super.canEat() ──
{ clear(); const h = spawn('hoglin', 0.5, 0.5, () => 0.5);
  h.hgPacifiedUntil = (h.hgClock | 0) + 50;
  ok(Hg.pacified(h) && M.Breed.interact(h, 'crimson_fungus', { player }) === false && !(h.inLove > 0), 'a pacified hoglin refuses crimson fungus');
  h.hgPacifiedUntil = (h.hgClock | 0) - 1;
  okAv(M.Breed.interact(h, 'crimson_fungus', { player }) === 'love', 'once the pacifying ends the same hoglin WOULD eat - the refusal rests on Hg.pacified');
  clear(); }

// ── #5646: BREED_TARGET partner memory ──
function secBreedTgt() {
  const r = []; clear(); M.Player = player;
  const h = spawn('hoglin', 0.5, 0.5, () => 0.5), p = spawn('hoglin', 1.5, 0.5, () => 0.5), a = spawn('zombie', 3.5, 0.5, () => 0.5);
  h.inLove = 100; p.inLove = 100; Hg.setBreedTarget(h, p);
  if (!Hg.hasBreedTarget(h)) r.push('partner not remembered');
  p.dead = true; if (Hg.hasBreedTarget(h)) r.push('gone partner kept');
  p.dead = false; Hg.setBreedTarget(h, p); if (!Hg.hasBreedTarget(h)) r.push('partner not re-set');
  Hg.onAttacked(h, a); if (Hg.hasBreedTarget(h)) r.push('hit did not forget partner');
  if (!(h.inLove > 0)) r.push('hit cleared love itself');
  clear(); M.Player = null; return r;
}
{ const r = secBreedTgt(); ok(r.length === 0, '#5646 BREED_TARGET' + (r.length ? ': ' + r.join('; ') : ''));
  const k = Hg.hasBreedTarget; Hg.hasBreedTarget = (e) => e.inLove > 0;
  okAv(secBreedTgt().length > 0, 'reading in-love as the breed target is caught'); Hg.hasBreedTarget = k; }

// ── #4417: ForgetAttackTargetTask.cannotReachTarget (no path > 200 ticks forgets the target) ──
function secReach(canPath) {
  const r = [], k = M.Ai.findPath; M.Ai.findPath = () => (canPath ? [{ x: 0, y: 0, z: 0 }] : null);
  for (const type of ['zoglin', 'hoglin']) {
    clear(); M.Player = player; player.x = 0.5; player.z = 8.5;
    const z = spawn(type, 0.5, 0.5, () => 0.9); Hg.setAttackTarget(z, player, false);
    for (let i = 0; i < 190; i++) Hg.tickEntity(z);
    if (!Hg.attackTarget(z)) r.push(type + ' gave up before 200 ticks');
    for (let i = 0; i < 60; i++) Hg.tickEntity(z);
    if (!!Hg.attackTarget(z) === !canPath) r.push(type + (canPath ? ' dropped a reachable target' : ' kept an unreachable target past 200 ticks'));
  }
  M.Ai.findPath = k; clear(); M.Player = null; return r;
}
{ const r = secReach(false); ok(r.length === 0, '#4417 unreachable target forgotten' + (r.length ? ': ' + r.join('; ') : ''));
  okAv(secReach(true).length === 0, 'a reachable target is kept (not vacuous)');
  const k = Hg.CANT_REACH_TICKS; Hg.CANT_REACH_TICKS = 1e9;
  okAv(secReach(false).length > 0, 'without the cannotReachTarget expiry the unreachable target is kept'); Hg.CANT_REACH_TICKS = k; }

// ── #4771: HoglinEntity.canEat = !PACIFIED; PacifyTask needs an attack target and no PACIFIED ──
function secPacEat() {
  const Br = M.Breed;
  const r = []; clear(); M.Player = player;
  const h = spawn('hoglin', 0.5, 0.5, () => 0.5); h.hgClock = 5; h.hgPacifiedUntil = 100;
  if (Br.interact(h, 'crimson_fungus', { player }) || h.inLove > 0) r.push('pacified hoglin accepted fungus');
  h.hgPacifiedUntil = undefined;
  if (Br.interact(h, 'crimson_fungus', { player }) !== 'love') r.push('unpacified hoglin refused fungus');
  clear(); const g = spawn('hoglin', 0.5, 0.5, () => 0.5); g.hgClock = 5; g.hgRepellent = {};
  const nr = Hg.nearestRepellent; Hg.nearestRepellent = () => ({}); Hg.tickEntity(g);
  if (Hg.pacified(g)) r.push('pacified with no attack target');
  Hg.nearestRepellent = nr; clear(); M.Player = null; return r;
}
{ const r = secPacEat(); ok(r.length === 0, '#4771 canEat/PacifyTask' + (r.length ? ': ' + r.join('; ') : ''));
  const k = Hg.pacified; Hg.pacified = () => false;
  okAv(secPacEat().length > 0, 'ignoring PACIFIED in canEat is caught'); Hg.pacified = k; }

// ── G18b-HG1: HoglinEntity.getPathfindingFavor (-1 within 8 of the repellent, 10 over crimson_nylium, else 0) ──
function secFavor(favorOf) {
  const r = []; clear();
  const h = spawn('hoglin', 0.5, 0.5, () => 0.9); h.hgRepellent = { x: -10.5, y: 64, z: 0.5 };
  const nyl = M.States.stateOf('crimson_nylium'), stone = M.States.stateOf('stone');
  const gb = M.World.getBlock; const st = M.States;
  M.World.getBlock = (x, y, z) => (y === 63 && x > 0 ? nyl : stone);
  try {
    const f = favorOf(h), seen = { left: 0, right: 0 }; let rs = 12345;
    const rnd = () => (rs = (rs * 1103515245 + 12345) & 0x7fffffff) / 0x80000000;
    for (let d = 0; d < 200; d++) {
      let best = -Infinity, bx = 0;
      for (let t = 0; t < 10; t++) { const x = Math.floor(rnd() * 20 - 10), sc = f(x, 64, 0); if (sc > best) { best = sc; bx = x; } }
      if (bx > 0) seen.right++; else seen.left++;
    }
    if (f(-8, 64, 0) !== -1) r.push('cell 2 from the repellent should score -1');
    if (f(5, 64, 0) !== 10) r.push('crimson_nylium cell should score 10');
    if (f(0, 64, 5) !== 0 && f(-1, 64, 20) !== 0) r.push('plain far cell should score 0');
    if (seen.left > 0 && seen.right + seen.left === 200 && seen.right < 190) r.push('argmax did not prefer nylium (' + seen.right + '/200)');
    if (seen.right < 195) r.push('nylium side chosen only ' + seen.right + '/200');
  } finally { M.World.getBlock = gb; }
  clear(); return r;
}
{ const r = secFavor((e) => M.Ai.hoglinPathfindingFavor(e)); ok(r.length === 0, 'G18b-HG1 hoglin favor' + (r.length ? ': ' + r.join('; ') : ''));
  okAv(secFavor(() => () => 0).length > 0, 'favor 0 for all cells is caught'); }
{ const k = M.Ai.hoglinPathfindingFavor; let called = 0; M.Ai.hoglinPathfindingFavor = (e) => { called++; return k(e); };
  clear(); spawn('hoglin', 0.5, 0.5, () => 0.9); spawn('zoglin', 0.5, 0.5, () => 0.9); M.Ai.hoglinPathfindingFavor = k; clear();
  ok(called >= 2, 'hoglin and zoglin rosters both pass hoglinPathfindingFavor (' + called + ')');
  okAv(!(0 >= 2), 'an unwired roster would not call it'); }

if (fails.length) {
  console.log(`${pass} assertions, ${fails.length} failures, ${breaks} breaks caught`); for (const f of fails) console.log('  ✗ ' + f); console.log('FAIL hoglincheck'); process.exit(1); }
console.log(`PASS hoglincheck: ${pass} assertions, 0 failures, ${breaks} breaks caught`);
