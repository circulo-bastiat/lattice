#!/usr/bin/env node
// hoglin11661check.mjs — #11661: proves 07zzg_hoglin.js's HoglinSpecificSensor (nearestRepellent 8/4, adult
// piglin/hoglin counts), ForgetAttackTargetTask (attackTarget dead/expiry, cantReachTick 200) and PacifyTask
// (tickEntity: repellent + ATTACK_TARGET -> PACIFIED 200) are REACHED from EntityList's mob dispatch
// (07i_entitylist.js -> Hoglin.tickEntity) and that cutting each breaks a scenario.
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT, initRegistry } from './loadsrc.mjs';
const ASSETS = join(MCLITE_ROOT, 'assets');
const rdj = (f) => JSON.parse(readFileSync(join(ASSETS, f), 'utf8'));
const b64 = (f) => readFileSync(join(ASSETS, f)).toString('base64');
let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };

function trial(patch) {
  const M = loadEngine({ extra: ['02f_tags.js', '02g_items.js', '07_world.js', '09b_sky.js', '14b_physics.js',
    '14f_inventory.js', '07h_entities.js', '07y_equip.js', '07ox_enchhelper.js', '07i_entitylist.js', '07l_spawn.js',
    '07m_breed.js', '14i_hand.js', '14j_combat.js', '14d_survival.js', '07zk_undead.js', '07q_effects.js', '07k_goals.js',
    '07zz_xporb.js', '07zzf_piglin.js', '07zf_bat.js', '07zzg_hoglin.js', '07zzp_mobvoice.js', '07j_entityrender.js', '10_gfx.js', '15h_bemodel.js', '14l_use.js'], dom: false, patch: patch ? (f, s) => (f === '07zzg_hoglin.js' ? patch(s) : s) : undefined });
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
  const o = {};
  const REP = 777;
  const cells = {};
  M.World = { getBlock: (x, y, z) => cells[x + ',' + y + ',' + z] || 0 };
  M.Tags.stateIn = (tag, st) => tag === 'hoglin_repellents' && st === REP;
  const clear = () => { EL.list.length = 0; for (const k in cells) delete cells[k]; };
  const mk = (type, x, z, r) => { const p = EL.random; EL.random = () => r; try { return EL.spawn(type, x, 64, z); } finally { EL.random = p; } };
  // HoglinSpecificSensor: nearest repellent within 8 across / 4 vertically
  clear(); const h = mk('hoglin', 0.5, 0.5, 0.9);
  cells['8,64,0'] = REP; const r1 = Hg.nearestRepellent(h);
  o.repIn = !!r1 && r1.x === 8.5 && r1.z === 0.5;
  clear(); cells['9,64,0'] = REP; o.repFarH = Hg.nearestRepellent(h) === null;
  clear(); cells['0,69,0'] = REP; o.repFarV = Hg.nearestRepellent(h) === null;
  clear(); cells['0,68,0'] = REP; cells['3,64,0'] = REP; o.repNearest = Hg.nearestRepellent(h).x === 3.5;
  // adult piglin / adult hoglin counts (piglins outnumber hoglins + 1 -> true; babies never count)
  clear(); const a = mk('hoglin', 0.5, 0.5, 0.9);
  const p1 = mk('piglin', 2.5, 2.5, 0.9); o.one = Hg.piglinsOutnumber(a) === false && Hg.isLoneAdult(a) === true; const p2 = mk('piglin', 3.5, 2.5, 0.9);
  o.cntPig = Hg.adultPiglinsAround(a).length === 2;
  o.outnumber = Hg.piglinsOutnumber(a) === true && Hg.isLoneAdult(a) === false;
  const p3 = mk('piglin', 4.5, 2.5, 0.9);
  o.outnumber3 = Hg.piglinsOutnumber(a) === true;
  const hb = mk('hoglin', 1.5, 2.5, 0.9); p3.isBaby = false;
  o.cntHog = Hg.adultHoglinsAround(a).length === 1 && Hg.piglinsOutnumber(a) === true;
  p3.isBaby = true; hb.isBaby = true;
  o.babyNoCount = Hg.adultPiglinsAround(a).length === 2 && Hg.adultHoglinsAround(a).length === 0;
  o.babyNever = Hg.piglinsOutnumber(hb) === false;
  // ForgetAttackTargetTask
  clear(); const f = mk('hoglin', 0.5, 0.5, 0.9);
  const cow = mk('cow', 0.5, 3.5, 0.9);
  Hg.setAttackTarget(f, cow, false); o.keepAlive = Hg.attackTarget(f) === cow;
  cow.dead = true; cow.health = 0; o.forgetDead = Hg.attackTarget(f) === null && f.hgTarget === null;
  const cow2 = mk('cow', 0.5, 3.5, 0.9);
  Hg.setAttackTarget(f, cow2, true); f.hgClock = 10; f.hgTargetUntil = 5;
  o.forgetExpiry = Hg.attackTarget(f) === null;
  Hg.setAttackTarget(f, cow2, false); f.hgClock = 100; f.hgTargetUntil = undefined;
  M.Ai.findPath = () => null;
  cow2.x = 0.5; cow2.z = 40.5;
  let n = 0; while (f.hgTarget && n < 400) { f.hgClock++; Hg.cantReachTick(f); n++; }
  o.cantReach = !f.hgTarget && n > 200 && n < 230;
  Hg.setAttackTarget(f, cow2, false); f.hgClock = 100; f.hgCantReachSince = undefined; f.hgCantReachTarget = null;
  M.Ai.findPath = () => ({});
  for (let i = 0; i < 400; i++) { f.hgClock++; Hg.cantReachTick(f); }
  o.reachable = f.hgTarget === cow2;
  // PacifyTask via the real per-tick entry point
  clear(); const pz = mk('hoglin', 0.5, 0.5, 0.9);
  cells['2,64,0'] = REP;
  const pc = mk('cow', 0.5, 3.5, 0.9);
  Hg.setAttackTarget(pz, pc, false);
  Hg.tickEntity(pz);
  o.pacified = Hg.pacified(pz) && pz.hgPacifiedUntil === pz.hgClock + 200;
  o.pacForget = pz.hgTarget === null && !pz.aggressive;
  const until = pz.hgPacifiedUntil; Hg.setAttackTarget(pz, pc, false); pz.hgRepellent = { x: 2.5, y: 64, z: 0.5 }; Hg.tickEntity(pz);
  o.pacOnce = pz.hgPacifiedUntil === until && pz.hgTarget === pc;
  clear(); const nz = mk('hoglin', 0.5, 0.5, 0.9); cells['2,64,0'] = REP;
  Hg.tickEntity(nz); o.pacNeedsTarget = nz.hgPacifiedUntil === undefined;
  clear(); const ez = mk('hoglin', 0.5, 0.5, 0.9);
  Hg.tickEntity(ez); o.noRepNoPacify = ez.hgPacifiedUntil === undefined;
  return o;
}
const A0 = trial(null);
for (const k of Object.keys(A0)) ok(A0[k], 'scenario ' + k);
const el = readFileSync(join(MCLITE_ROOT, 'src', '07i_entitylist.js'), 'utf8');
ok(/NS\.Hoglin\.tickEntity\(e\)/.test(el), 'reach: EntityList mob dispatch -> Hoglin.tickEntity');
const hg = readFileSync(join(MCLITE_ROOT, 'src', '07zzg_hoglin.js'), 'utf8');
ok(/Hg\.nearestRepellent\(e\)/.test(hg) && /Hg\.cantReachTick\(e\)/.test(hg) && /Hg\.pacified\(e\)/.test(hg), 'reach: tickEntity -> sensor / cantReach / PacifyTask');
const BR = [
  ['reph', 'Hg.REPEL_H; dx <= Hg.REPEL_H', 'Hg.REPEL_H + 1; dx <= Hg.REPEL_H + 1', ['repFarH']],
  ['repv', 'dy = -Hg.REPEL_V; dy <= Hg.REPEL_V', 'dy = -Hg.REPEL_V - 1; dy <= Hg.REPEL_V + 1', ['repFarV']],
  ['repnear', 'if (d2 < bd)', 'if (d2 > bd || best === null)', ['repNearest']],
  ['pigadult', "o.type === 'piglin' && !isBaby(o)", "o.type === 'piglin'", ['babyNoCount']],
  ['hogadult', "o.type === 'hoglin' && !isBaby(o)", "o.type === 'hoglin'", ['babyNoCount']],
  ['outnum', 'Hg.adultHoglinsAround(e).length + 1', 'Hg.adultHoglinsAround(e).length', ['one']],
  ['forgetdead', '!alive(t) || !NS.Ai.canTargetLiving(t, e) ||', '', ['forgetDead']],
  ['forgetexp', '(e.hgTargetUntil !== undefined && clock(e) > e.hgTargetUntil)', 'false', ['forgetExpiry']],
  ['reach200', 'now - e.hgCantReachSince > Hg.CANT_REACH_TICKS', 'false', ['cantReach']],
  ['pacticks', 'e.hgClock + Hg.PACIFY_TICKS', 'e.hgClock + 1', ['pacified']],
  ['pacforget', 'Hg.PACIFY_TICKS; Hg.forgetTarget(e); }', 'Hg.PACIFY_TICKS; }', ['pacForget']],
  ['pacneeds', 'e.hgRepellent && Hg.attackTarget(e) && !Hg.pacified(e)', 'e.hgRepellent && !Hg.pacified(e)', ['pacNeedsTarget']],
  ['pacagain', 'Hg.attackTarget(e) && !Hg.pacified(e)', 'Hg.attackTarget(e)', ['pacOnce']],
];
for (const [key, a, b, expect] of BR) {
  breaks++; let hit = false, X;
  const pf = (s) => { if (s.includes(a)) { hit = true; return s.split(a).join(b); } return s; };
  try { X = trial(pf); } catch (e) { X = {}; }
  if (!hit) { fails.push('no-op break: ' + key); continue; }
  const caught = expect.some((q) => !X[q]);
  ok(caught, 'anti-vacuity: break ' + key);
  if (caught) console.log('  ✓ break caught: ' + key);
}
for (const f of fails) console.log('FAIL', f);
console.log(`hoglin11661check: ${pass} assertions, ${fails.length} failures, ${breaks} breaks caught`);
process.exit(fails.length ? 1 : 0);
