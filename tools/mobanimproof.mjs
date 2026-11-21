#!/usr/bin/env node
// mobanimproof.mjs — #7523 PROOF animation: the engine's setupAnim pose against the vanilla 1.18.2 setAngles maths.
//
//   node tools/mobanimproof.mjs [--verbose]    -> tools/mobproof/out/animation.json
//
// ORACLE: the decompiled Java (`.decomp/.../QuadrupedEntityModel.setAngles`, `BipedEntityModel.setAngles`), whose float
// literals this file re-reads from the decomp on every run (a changed decomp fails the check) and evaluates in a
// deterministic grid: limbSwing {0,.37,1,2.5,7.9,31} x limbSwingAmount {0,.25,1}, head yaw/pitch {-90,-31,0,17,90}, riding.
// Never src/ and never the engine's own output. Mobs whose model overrides setAngles (or whose arms/overlays are posed by
// another layer) list the uncompared part per mob in the shrink-only ledger tools/mobproof-anim-known.json.
// ANTI-VACUITY: each compared field is mutated in the oracle and the break must be caught ("<n> breaks caught").
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { loadEngine, initRegistry, MCLITE_ROOT } from './loadsrc.mjs';

const R = (f) => new URL(f, import.meta.url);
const ROSTER = Object.keys(JSON.parse(readFileSync(R('./mobl3-mobs.json'), 'utf8')).mobs);
const MD = new URL('../.decomp/net/minecraft/client/render/entity/model/', import.meta.url);
const src = (c) => (existsSync(new URL(c + '.java', MD)) ? readFileSync(new URL(c + '.java', MD), 'utf8') : '');
let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); return c; };
const f32 = Math.fround, PI = f32(Math.PI);

// ---- the oracle is only valid if the decomp still says what it is transcribed from ----
const HM = src('HorseEntityModel'), LM = src('LlamaEntityModel');
for (const [name, s, pats] of [
  ['HorseEntityModel', HM, [/MathHelper\.cos\(\$\$15 \* \$\$1 \* 0\.6662F \+ \(float\) Math\.PI\)/, /\$\$16 \* 0\.8F \* \$\$2/, /2\.1816616F/, /\$\$1 \* 0\.4F\) \* 0\.15F/,
    /\(float\) \(Math\.PI \/ 12\) \* \$\$10/, /\$\$14 \* 0\.6F \+ \(float\) Math\.PI/, /\$\$14 \* 0\.7F/, /\$\$2 \* 0\.75F/, /-5\.0F \+ \$\$2/, /2\.0F \+ \$\$2 \* 2\.0F/,
    /\$\$16 \* 0\.5F \* \$\$2 \* \$\$11/, /2\.0F \* \$\$10 \+ 14\.0F \* \$\$11/, /-6\.0F \* \$\$10 - 10\.0F \* \$\$11/]],
  ['LlamaEntityModel', LM, [/rightHindLeg\.pitch = MathHelper\.cos\(\$\$1 \* 0\.6662F\) \* 1\.4F \* \$\$2/, /leftFrontLeg\.pitch = MathHelper\.cos\(\$\$1 \* 0\.6662F\) \* 1\.4F \* \$\$2/, /head\.pitch = \$\$5 \* \(float\) \(Math\.PI \/ 180\.0\)/]]]) {
  for (const p of pats) if (!p.test(s)) { console.log(`  ✗ ${name}: the decomp no longer contains ${p} — the oracle is stale`); process.exit(1); }
}
const Q = src('QuadrupedEntityModel'), B = src('BipedEntityModel');
for (const [name, s, pats] of [
  ['QuadrupedEntityModel', Q, [/head\.pitch = \$\$5 \* \(float\) \(Math\.PI \/ 180\.0\)/, /head\.yaw = \$\$4 \* \(float\) \(Math\.PI \/ 180\.0\)/,
    /rightHindLeg\.pitch = MathHelper\.cos\(\$\$1 \* 0\.6662F\) \* 1\.4F \* \$\$2/, /leftHindLeg\.pitch = MathHelper\.cos\(\$\$1 \* 0\.6662F \+ \(float\) Math\.PI\) \* 1\.4F \* \$\$2/,
    /rightFrontLeg\.pitch = MathHelper\.cos\(\$\$1 \* 0\.6662F \+ \(float\) Math\.PI\) \* 1\.4F \* \$\$2/, /leftFrontLeg\.pitch = MathHelper\.cos\(\$\$1 \* 0\.6662F\) \* 1\.4F \* \$\$2/]],
  ['BipedEntityModel', B, [/0\.6662F/, /1\.4F/, /-1\.4137167F/]]]) {
  for (const p of pats) ok(p.test(s), `${name}: the decomp no longer contains ${p} — the oracle below is stale`);
}

// ---- vanilla maths (float arithmetic, radians) ----
const cos = (x) => Math.cos(f32(x));
const quad = (ls, amt, yaw, pitch) => ({
  head: { rx: f32(pitch * f32(Math.PI / 180)), ry: f32(yaw * f32(Math.PI / 180)) },
  right_hind_leg: cos(f32(ls * f32(0.6662))) * 1.4 * amt, left_hind_leg: cos(f32(f32(ls * f32(0.6662)) + PI)) * 1.4 * amt,
  right_front_leg: cos(f32(f32(ls * f32(0.6662)) + PI)) * 1.4 * amt, left_front_leg: cos(f32(ls * f32(0.6662))) * 1.4 * amt });
const biped = (ls, amt, yaw, pitch, riding) => ({
  head: { rx: f32(pitch * f32(Math.PI / 180)), ry: f32(yaw * f32(Math.PI / 180)) },
  right_leg: riding ? -1.4137167 : cos(f32(ls * f32(0.6662))) * 1.4 * amt,
  left_leg: riding ? -1.4137167 : cos(f32(f32(ls * f32(0.6662)) + PI)) * 1.4 * amt });

const QUAD = new Set(['cow', 'mooshroom', 'pig']);
const LLAMA = new Set(['llama', 'trader_llama', 'llama_decor']);   // LlamaEntityModel.setAngles is the QuadrupedEntityModel maths verbatim     // CowEntityModel / PigEntityModel declare no setAngles of their own
const BIPED = new Set(['zombie', 'husk', 'giant', 'drowned', 'zombie_villager', 'skeleton', 'stray', 'wither_skeleton', 'piglin', 'piglin_brute', 'zombified_piglin']);
for (const c of ['CowEntityModel', 'PigEntityModel', 'ZombieEntityModel', 'GiantEntityModel', 'DrownedEntityModel', 'SkeletonEntityModel', 'ZombieVillagerEntityModel', 'PiglinEntityModel'])
  ok(!/void setAngles/.test(src(c)) || /^(Drowned|Skeleton|Piglin)/.test(c), `${c} overrides setAngles: it is no longer a plain base-class mob`);

// ---- the engine ----
const M = loadEngine({ extra: ['02g_items.js', '07h_entities.js', '14b_physics.js', '07i_entitylist.js', '07j_entityrender.js', '07zzl_shulkerdraw.js', '10_gfx.js', '11_gfx_webgpu.js', '12_gfx_webgl2.js', '15h_bemodel.js', '07zq2_wolfshake.js', '07k_goals.js', '07v_spell.js', '07zj_goat.js', '07zzt_armorstand.js', '07m_breed.js', '07r_mount.js', '07zzs_minecartrender.js', '19_data.gen.js'], dom: false });
initRegistry(M);
const mm = JSON.parse(readFileSync(MCLITE_ROOT + 'assets/models.meta.json', 'utf8'));
M.BEModel.init({ models: readFileSync(MCLITE_ROOT + 'assets/models.bin').toString('base64'), modelsBytes: mm.rawBytes });
M.DATA = Object.assign({}, M.DATA, { entities: JSON.parse(readFileSync(MCLITE_ROOT + 'assets/entities.json', 'utf8')) });
const ER = M.EntityRender;
ok(typeof ER.setupAnimDelta === 'function', 'ER.setupAnimDelta exists');
const LS = [0, 0.37, 1, 2.5, 7.9, 31], AMT = [0, 0.25, 1], YAW = [-90, -31, 0, 17, 90], PITCH = [-90, 0, 45];
const TOL = 2e-5;

/** returns { worst, row } comparing the engine with `oracle` over the grid for one family */
function compare(kind, oracleFn, parts, mut) {
  let worst = 0, at = '';
  const put = (part, got, want, ctx) => { const d = Math.abs(got - want); if (d > worst) { worst = d; at = `${part} ${ctx}`; } };
  for (const ls of LS) for (const a of AMT) for (const yaw of YAW) for (const pitch of PITCH) for (const riding of kind === 'humanoid' ? [false, true] : [false]) {
    const o = mut ? mut(oracleFn(ls, a, yaw, pitch, riding)) : oracleFn(ls, a, yaw, pitch, riding);
    for (const p of parts) {
      const d = ER.setupAnimDelta(p, ls, a, yaw, pitch, riding, kind) || { rx: 0, ry: 0 };
      const ctx = `ls=${ls} amt=${a} yaw=${yaw} pitch=${pitch}${riding ? ' riding' : ''}`;
      if (p === 'head') { put('head.rx', d.rx, o.head.rx, ctx); put('head.ry', d.ry, o.head.ry, ctx); }
      else put(p + '.rx', d.rx, o[p], ctx);
    }
  }
  return { worst, at };
}
// HorseEntityModel.animateModel (horse/donkey/mule/skeleton_horse/zombie_horse; DonkeyEntityModel adds only chests/ears)
const HSRC = src('HorseEntityModel');
for (const p of [/2\.1816616F \+ MathHelper\.sin\(\$\$14\) \* 0\.05F/, /\$\$15 = \$\$0\.isTouchingWater\(\) \? 0\.2F : 1\.0F/, /\$\$1 \* 0\.6662F \+ \(float\) Math\.PI/, /\$\$16 \* 0\.8F \* \$\$2/,
  /\$\$14 \* 0\.6F \+ \(float\) Math\.PI/, /\$\$16 \* 0\.5F \* \$\$2 \* \$\$11/, /tail\.pitch = \(float\) \(Math\.PI \/ 6\) \+ \$\$2 \* 0\.75F/, /tail\.pivotZ = 2\.0F \+ \$\$2 \* 2\.0F/,
  /tail\.yaw = MathHelper\.cos\(\$\$14 \* 0\.7F\)/, /body\.pitch = \$\$10 \* \(float\) \(-Math\.PI \/ 4\)/, /\$\$7 > 20\.0F/, /MathHelper\.cos\(\$\$1 \* 0\.4F\) \* 0\.15F \* \$\$2/])
  ok(p.test(HSRC), `HorseEntityModel: the decomp no longer contains ${p} — the horse oracle is stale`);
const horseO = (l, a, yaw, pitch, age, H) => {
  const P = PI, an = H.angry, eg = H.grass, ea = H.eating, k = 1 - Math.max(an, eg), n = 1 - an;
  const yw = Math.max(-20, Math.min(20, yaw)) * Math.PI / 180; let hp = pitch * Math.PI / 180;
  if (a > 0.2) hp += cos(l * 0.4) * 0.15 * a;
  const lw = cos((H.inWater ? 0.2 : 1) * l * 0.6662 + P), l17 = lw * 0.8 * a, c20 = cos(age * 0.6 + P);
  const REST = P / 6, ph = Math.sin(age) * 0.05;
  return { head_parts: { rx: an * (P / 12 + hp) + eg * (2.1816616 + ph) + k * (REST + hp + ea * ph) - REST, ry: an * yw + k * yw, dpy: an * -4 + eg * 11 + k * 4 - 4, dpz: an * -4 + eg * -12 + k * -12 + 12 },
    body: { rx: an * -P / 4 },
    left_front_leg: { rx: (-P / 3 + c20) * an + l17 * n, dpy: 2 * an + 14 * n - 14, dpz: -6 * an - 10 * n + 12 },
    right_front_leg: { rx: (-P / 3 - c20) * an - l17 * n, dpy: 2 * an + 14 * n - 14, dpz: -6 * an - 10 * n + 12 },
    left_hind_leg: { rx: P / 12 * an - lw * 0.5 * a * n }, right_hind_leg: { rx: P / 12 * an + lw * 0.5 * a * n },
    tail: { rx: a * 0.75, ry: H.tailWag ? cos(age * 0.7) : 0, dpy: a, dpz: a * 2 } };
};
const HSTATES = [{ angry: 0, grass: 0, eating: 0 }, { angry: 1, grass: 0, eating: 0 }, { angry: 0.4, grass: 0.3, eating: 0.5 }, { angry: 0, grass: 1, eating: 0 }, { angry: 0, grass: 0, eating: 1, inWater: true, tailWag: true }];
const HPARTS = ['head_parts', 'body', 'left_front_leg', 'right_front_leg', 'left_hind_leg', 'right_hind_leg', 'tail'];
function compareHorse(mut) {
  let worst = 0, at = '';
  for (const ls of LS) for (const a of AMT) for (const yaw of YAW) for (const pitch of PITCH) for (const age of [0, 13.3]) for (const st of HSTATES) for (const baby of [false, true]) {
    const H = { saddled: false, passengers: false, baby, inWater: false, tailWag: false, ...st };
    let o = horseO(ls, a, yaw, pitch, age, H); if (mut) o = mut(o);
    for (const p of HPARTS) for (const pn of baby && p.endsWith('_leg') ? [p.replace('_leg', '_baby_leg')] : [p]) {
      const d = ER.setupAnimDelta(pn, ls, a, yaw, pitch, false, 'quadruped', { horse: H, ageInTicks: age, baby }) || {};
      for (const f of ['rx', 'ry', 'dpy', 'dpz']) { const e = Math.abs((d[f] || 0) - (o[p][f] || 0)); if (e > worst) { worst = e; at = `${pn}.${f} ls=${ls} a=${a} yaw=${yaw} pitch=${pitch} age=${age} ${JSON.stringify(st)}`; } }
    }
  }
  return { worst, at };
}
const QP = ['head', 'right_hind_leg', 'left_hind_leg', 'right_front_leg', 'left_front_leg'], BP = ['head', 'right_leg', 'left_leg'];
// ---- chicken: ChickenEntityModel.setAngles (own maths; head+beak+wattle share the head angles, wings roll by animationProgress) ----
const CHSRC = src('ChickenEntityModel');
for (const p of [/head\.pitch = \$\$5 \* \(float\) \(Math\.PI \/ 180\.0\)/, /head\.yaw = \$\$4 \* \(float\) \(Math\.PI \/ 180\.0\)/, /beak\.pitch = this\.head\.pitch/, /wattle\.yaw = this\.head\.yaw/,
  /rightLeg\.pitch = MathHelper\.cos\(\$\$1 \* 0\.6662F\) \* 1\.4F \* \$\$2/, /leftLeg\.pitch = MathHelper\.cos\(\$\$1 \* 0\.6662F \+ \(float\) Math\.PI\) \* 1\.4F \* \$\$2/, /rightWing\.roll = \$\$3/, /leftWing\.roll = -\$\$3/])
  ok(p.test(CHSRC), `ChickenEntityModel: the decomp no longer contains ${p} — the oracle below is stale`);
const WING = [0, 0.4, 1.7, -2.3];
const chicken = (ls, amt, yaw, pitch, _r, wing) => { const b = biped(ls, amt, yaw, pitch, false);
  return { head: b.head, beak: b.head, red_thing: b.head, right_leg: b.right_leg, left_leg: b.left_leg, right_wing: wing, left_wing: -wing }; };
function compareChicken(mut) {
  let worst = 0, at = '';
  for (const ls of LS) for (const a of AMT) for (const yaw of YAW) for (const pitch of PITCH) for (const w of WING) {
    const o = mut ? mut(chicken(ls, a, yaw, pitch, false, w)) : chicken(ls, a, yaw, pitch, false, w);
    for (const p of ['head', 'beak', 'red_thing', 'right_leg', 'left_leg', 'right_wing', 'left_wing']) {
      const d = ER.setupAnimDelta(p, ls, a, yaw, pitch, false, 'chicken', { chickenWingRoll: w }) || { rx: 0, ry: 0, rz: 0 };
      const got = p.endsWith('wing') ? [['rz', d.rz || 0, o[p]]] : p.endsWith('leg') ? [['rx', d.rx, o[p]]] : [['rx', d.rx, o[p].rx], ['ry', d.ry, o[p].ry]];
      for (const [f, g, e] of got) { const x = Math.abs(g - e); if (x > worst) { worst = x; at = `${p}.${f} ls=${ls} amt=${a} yaw=${yaw} pitch=${pitch} wing=${w}`; } }
    }
  }
  return { worst, at };
}
const CH = compareChicken(); ok(CH.worst < TOL, `chicken: worst deviation ${CH.worst.toExponential(2)} at ${CH.at}`);
if (process.argv.includes('--verbose')) console.log(`  chicken: worst ${CH.worst.toExponential(2)} at ${CH.at || 'n/a'}`);
const fam = { quadruped: compare('quadruped', quad, QP), humanoid: compare('humanoid', biped, BP) };
fam.horse = compareHorse();
for (const [k, r] of Object.entries(fam)) { ok(r.worst < TOL, `${k}: worst deviation ${r.worst.toExponential(2)} at ${r.at}`); if (process.argv.includes('--verbose')) console.log(`  ${k}: worst ${r.worst.toExponential(2)} (tol ${TOL}) at ${r.at || 'n/a'}`); }

// ---- #7783 cat / ocelot: OcelotEntityModel + CatEntityModel (setAngles/animateModel), read from the decomp ----
const OC = src('OcelotEntityModel'), CT = src('CatEntityModel');
for (const [name, s, pats] of [
  ['OcelotEntityModel', OC, [/1\.7278761F \+ \(float\) \(Math\.PI \/ 4\) \* MathHelper\.cos\(\$\$1\) \* \$\$2/, /1\.7278761F \+ 0\.47123894F \* MathHelper\.cos\(\$\$1\) \* \$\$2/, /1\.7278761F \+ \(float\) \(Math\.PI \/ 10\) \* MathHelper\.cos\(\$\$1\) \* \$\$2/,
    /MathHelper\.cos\(\$\$1 \* 0\.6662F \+ 0\.3F\)/, /MathHelper\.cos\(\$\$1 \* 0\.6662F \+ \(float\) Math\.PI \+ 0\.3F\)/, /this\.lowerTail\.pivotY \+= -4\.0F/, /this\.upperTail\.pitch = 0\.9F/, /this\.head\.pivotY \+= 2\.0F/]],
  ['CatEntityModel', CT, [/this\.body\.pitch = \(float\) \(Math\.PI \/ 4\)/, /this\.head\.pivotY \+= -3\.3F/, /this\.upperTail\.pitch = 1\.7278761F/, /this\.lowerTail\.pitch = 2\.670354F/, /-1\.2707963F/, /-0\.47079635F/,
    /this\.rightHindLeg\.pivotY = 20\.0F/, /this\.upperTail\.pitch, 0\.8F/, /this\.lowerTail\.pitch, -0\.4F/, /-0\.58177644F/, /this\.leftHindLeg\.pivotY = 21\.0F/, /this\.leftFrontLeg\.pivotY = 16\.1F/]]])
  for (const p of pats) ok(p.test(s), `${name}: the decomp no longer contains ${p} — the cat/ocelot oracle is stale`);
const lerpA = (a, b, t) => a + t * (b - a);
/** absolute pose of every part minus animateModel's rest (pivot defaults) -> { part: {rx,rz,dpx,dpy,dpz} }; legs/tails rest pitch 0 except tail1 0.9, body PI/2 */
function feline(ls, amt, yaw, pitch, st) {
  const P = {}, H = f32(Math.PI / 2);
  const mk = (rx, py, pz) => ({ rx, rz: 0, px: 0, py, pz });
  P.body = mk(0, 12, -10); P.head = mk(0, 15, -9); P.tail1 = mk(0.9, 15, 8); P.tail2 = mk(0, 20, 14);
  P.left_front_leg = mk(0, 14.1, -5); P.right_front_leg = mk(0, 14.1, -5); P.left_hind_leg = mk(0, 18, 5); P.right_hind_leg = mk(0, 18, 5);
  P.right_front_leg.px = -1.2; P.right_hind_leg.px = -1.1;
  const sl = st.sleep || 0;
  // animateModel
  let state;
  if (st.crouch) { P.body.py++; P.head.py += 2; P.tail1.py++; P.tail2.py += -4; P.tail2.pz += 2; P.tail1.rx = H; P.tail2.rx = H; state = 0; }
  else if (st.sprint) { P.tail2.py = P.tail1.py; P.tail2.pz += 2; P.tail1.rx = H; P.tail2.rx = H; state = 2; }
  else state = 1;
  if (st.sitting) {
    P.body.rx = Math.PI / 4; P.body.py += -4; P.body.pz += 5; P.head.py += -3.3; P.head.pz++; P.tail1.py += 8; P.tail1.pz += -2; P.tail2.py += 2; P.tail2.pz += -0.8;
    P.tail1.rx = 1.7278761; P.tail2.rx = 2.670354;
    for (const n of ['left_front_leg', 'right_front_leg']) { P[n].rx = -Math.PI / 20; P[n].py = 16.1; P[n].pz = -7; }
    for (const n of ['left_hind_leg', 'right_hind_leg']) { P[n].rx = -Math.PI / 2; P[n].py = 21; P[n].pz = 1; }
    state = 3;
  }
  // setAngles
  P.head.rx = f32(pitch * f32(Math.PI / 180)); let hry = f32(yaw * f32(Math.PI / 180)), hrz = 0;
  const w = f32(ls * f32(0.6662));
  if (state !== 3) {
    P.body.rx = H;
    if (state === 2) {
      P.left_hind_leg.rx = cos(w) * amt; P.right_hind_leg.rx = cos(w + 0.3) * amt; P.left_front_leg.rx = cos(w + PI + 0.3) * amt; P.right_front_leg.rx = cos(w + PI) * amt;
      P.tail2.rx = 1.7278761 + Math.PI / 10 * cos(ls) * amt;
    } else {
      P.left_hind_leg.rx = cos(w) * amt; P.right_hind_leg.rx = cos(w + PI) * amt; P.left_front_leg.rx = cos(w + PI) * amt; P.right_front_leg.rx = cos(w) * amt;
      P.tail2.rx = 1.7278761 + (state === 1 ? Math.PI / 4 : 0.47123894) * cos(ls) * amt;
    }
  }
  if (sl > 0) {
    P.head.rz = hrz = lerpA(0, -1.2707963, sl); hry = lerpA(hry, 1.2707963, sl);
    P.left_front_leg.rx = -1.2707963; P.right_front_leg.rx = -0.47079635; P.right_front_leg.rz = -0.2; P.right_front_leg.px = -0.2;
    P.left_hind_leg.rx = -0.4; P.right_hind_leg.rx = 0.5; P.right_hind_leg.rz = -0.5; P.right_hind_leg.px = -0.3; P.right_hind_leg.py = 20;
    P.tail1.rx = lerpA(P.tail1.rx, 0.8, st.tail); P.tail2.rx = lerpA(P.tail2.rx, -0.4, st.tail);
  }
  if (st.headDown > 0) P.head.rx = lerpA(P.head.rx, -0.58177644, st.headDown);
  P.head.ry = hry;
  return P;
}
const FREST = { body: { rx: Math.PI / 2, py: 12, pz: -10 }, tail1: { rx: 0.9, py: 15, pz: 8 }, tail2: { rx: 0, py: 20, pz: 14 }, head: { rx: 0, py: 15, pz: -9 },
  left_front_leg: { py: 14.1, pz: -5 }, right_front_leg: { py: 14.1, pz: -5, px: -1.2 }, left_hind_leg: { py: 18, pz: 5 }, right_hind_leg: { py: 18, pz: 5, px: -1.1 } };
const FP = Object.keys(FREST);
const FS = [];
for (const crouch of [0, 1]) for (const sprint of [0, 1]) for (const sitting of [0, 1]) for (const sleep of [0, 0.45, 1]) for (const headDown of [0, 0.6]) FS.push({ crouch, sprint, sitting, sleep, headDown, tail: sleep ? 0.3 : 0 });
const FFIELDS = ['rx', 'rz', 'dpx', 'dpy', 'dpz'];
/** mob 'cat' reads all states; 'ocelot' only crouch/sprint (OcelotEntityModel has no sitting/sleep) */
function compareFeline(mob, mut) {
  let worst = 0, at = '';
  for (const s0 of FS) {
    if (mob === 'ocelot' && (s0.sitting || s0.sleep || s0.headDown)) continue;
    for (const ls of [0, 0.37, 2.5, 31]) for (const a of [0, 0.25, 1]) for (const yaw of [-90, 17]) for (const pitch of [-90, 45]) {
      let P = feline(ls, a, yaw, pitch, s0); if (mut) P = mut(P);
      for (const part of FP) {
        const d = ER.setupAnimDelta(part, ls, a, yaw, pitch, false, 'quadruped', { feline: { crouch: !!s0.crouch, sprint: !!s0.sprint, sitting: !!s0.sitting, sleep: s0.sleep, headDown: s0.headDown, tail: s0.tail }, rest: {} }) || {};
        const R0 = FREST[part], o = P[part];
        const want = { rx: o.rx - (R0.rx || 0), rz: o.rz, dpx: o.px - (R0.px || 0), dpy: o.py - R0.py, dpz: o.pz - R0.pz };
        if (part === 'head' && s0.crouch) want.dpy -= 2;      // the crouch head drop is the separate head layer's (ER comment on felineDelta)
        for (const f of FFIELDS) { const dd = Math.abs((d[f] || 0) - want[f]); if (dd > worst) { worst = dd; at = `${mob} ${part}.${f} ${JSON.stringify(s0)} ls=${ls} amt=${a} yaw=${yaw} pitch=${pitch}`; } }
      }
    }
  }
  return { worst, at };
}
for (const mob of ['cat', 'ocelot']) { const r = compareFeline(mob); fam[mob] = r; ok(r.worst < TOL, `${mob}: worst deviation ${r.worst.toExponential(2)} at ${r.at}`); if (process.argv.includes('--verbose')) console.log(`  ${mob}: worst ${r.worst.toExponential(2)} at ${r.at || 'n/a'}`); }
for (const part of FP) for (const f of ['rx', 'rz', 'px', 'py', 'pz']) {
  const m = (P) => ({ ...P, [part]: { ...P[part], [f]: P[part][f] + 0.05 } });
  const r = compareFeline('cat', m);
  if (r.worst > TOL) breaks++; else ok(false, `break NOT caught: cat ${part}.${f} +0.05`);
}

// ---- anti-vacuity: break the oracle, per compared field, and demand the grid sees it ----
const caught = (m, kind, fn, parts, mut) => { const r = compare(kind, fn, parts, mut); if (r.worst > TOL) { breaks++; if (process.argv.includes('--verbose')) console.log('   ✓ break caught: ' + m); } else ok(false, 'break NOT caught: ' + m); };
for (const p of QP.slice(1)) caught(`quadruped ${p} amplitude x1.01`, 'quadruped', quad, QP, (o) => ({ ...o, [p]: o[p] * 1.01 + 0.001 }));
caught('quadruped legs swapped diagonal', 'quadruped', quad, QP, (o) => ({ ...o, right_hind_leg: o.left_hind_leg, left_hind_leg: o.right_hind_leg }));
caught('quadruped head pitch +0.01', 'quadruped', quad, QP, (o) => ({ ...o, head: { ...o.head, rx: o.head.rx + 0.01 } }));
caught('quadruped head yaw +0.01', 'quadruped', quad, QP, (o) => ({ ...o, head: { ...o.head, ry: o.head.ry + 0.01 } }));
// ---- #8809 cow: CowEntityModel declares no setAngles (the QuadrupedEntityModel maths above IS the cow pose); its only own numbers are the
// AnimalModel baby literals in its constructor: super(root, false, headY, headZ, headScale, bodyScale, bodyY). Re-read from the decomp every run.
{
  if (!M.Entities.ready) M.Entities.init();
  const m = /super\(\$\$0, (false|true), ([\d.]+)F, ([\d.]+)F, ([\d.]+)F, ([\d.]+)F, (\d+)\)/.exec(src('CowEntityModel'));
  ok(!!m, 'CowEntityModel: the constructor literals moved - the cow baby oracle is stale');
  const cowBaby = (mut, lay = 'cow') => { const sh = m[1] === 'true'; const [hy, hz, hs, bs, by] = m.slice(2).map(Number); const o = mut ? mut({ hy, hz, hs, bs, by }) : { hy, hz, hs, bs, by };
    let worst = 0; const chk = (g, e) => { worst = Math.max(worst, Math.abs(g - e)); };
    for (const part of ['head', 'body', 'right_hind_leg', 'left_hind_leg', 'right_front_leg', 'left_front_leg']) {
      const t = ER.babyTransform(lay, part) || { s: NaN, oy: NaN, oz: NaN };
      if (part === 'head') { chk(t.s, sh ? 1.5 / o.hs : 1); chk(t.oy, o.hy); chk(t.oz, o.hz); } else { chk(t.s, 1 / o.bs); chk(t.oy, o.by); chk(t.oz, 0); }
    }
    return worst; };
  for (const lay of ['mooshroom']) ok(!(cowBaby(null, lay) >= TOL), `${lay}: baby transform differs from CowEntityModel ctor literals (${cowBaby(null, lay)})`);
  for (const [k, d] of [['hy', 1], ['bs', 0.5]]) if (cowBaby((o) => ({ ...o, [k]: o[k] + d }), 'mooshroom') > TOL) breaks++; else ok(false, `break NOT caught: mooshroom baby ${k}`);
  ok(!(cowBaby() >= TOL), `cow: baby head/body transform differs from CowEntityModel ctor literals (${cowBaby()}) ${JSON.stringify(["head","body"].map((p) => ER.babyTransform("cow", p)))} vs ${m.slice(1)}`);
  for (const [k, d] of [['hy', 1], ['hz', 1], ['bs', 0.5], ['by', 1]]) if (cowBaby((o) => ({ ...o, [k]: o[k] + d })) > TOL) breaks++; else ok(false, `break NOT caught: cow baby ${k}`);
}
for (const p of ['right_leg', 'left_leg']) caught(`humanoid ${p} amplitude x1.01`, 'humanoid', biped, BP, (o) => ({ ...o, [p]: o[p] * 1.01 + 0.001 }));
caught('humanoid legs not swapped', 'humanoid', biped, BP, (o) => ({ ...o, right_leg: o.left_leg, left_leg: o.right_leg }));
caught('humanoid head pitch +0.01', 'humanoid', biped, BP, (o) => ({ ...o, head: { ...o.head, rx: o.head.rx + 0.01 } }));
caught('humanoid head yaw +0.01', 'humanoid', biped, BP, (o) => ({ ...o, head: { ...o.head, ry: o.head.ry + 0.01 } }));
caught('humanoid riding leg pitch -1.4137167 -> -1.41', 'humanoid', (a, b, c, d, r) => { const o = biped(a, b, c, d, r); if (r) { o.right_leg = -1.41; } return o; }, BP);
// ---- #7792: models with their own7792 pose maths (Creeper, Spider, Silverfish, Endermite, Enderman) ----
for (const [name, pats] of [
  ['CreeperEntityModel', [/leftHindLeg\.pitch = MathHelper\.cos\(\$\$1 \* 0\.6662F\) \* 1\.4F \* \$\$2/, /rightFrontLeg\.pitch = MathHelper\.cos\(\$\$1 \* 0\.6662F\) \* 1\.4F \* \$\$2/]],
  ['SpiderEntityModel', [/\* 0\.6662F \* 2\.0F \+ 0\.0F\) \* 0\.4F\) \* \$\$2/, /Math\.abs\(MathHelper\.sin\(\$\$1 \* 0\.6662F \+ 0\.0F\) \* 0\.4F\) \* \$\$2/, /rightMiddleLeg\.roll = -0\.58119464F/]],
  ['SilverfishEntityModel', [/\$\$3 \* 0\.9F \+ \(float\)\$\$6 \* 0\.15F \* \(float\) Math\.PI\) \* \(float\) Math\.PI \* 0\.05F/, /\* 0\.2F\s+\* \(float\)Math\.abs\(\$\$6 - 2\)|\(float\) Math\.PI \* 0\.2F \* \(float\)Math\.abs/]],
  ['EndermiteEntityModel', [/\* 0\.01F\s+\* \(float\)\(1 \+ Math\.abs/, /\* 0\.1F\s+\* \(float\)Math\.abs\(\$\$6 - 2\)/]],
  ['EndermanEntityModel', [/rightArm\.pitch = -0\.5F/, /leftArm\.roll = -0\.05F/, /this\.head\.pivotY -= 5\.0F/, /pitch \*= 0\.5F/, /> 0\.4F/]]])
  for (const p of pats) ok(p.test(src(name)), `${name}: the decomp no longer contains ${p} — the #7792 oracle is stale`);

const sinf = (x) => Math.sin(f32(x));
const mul = (...a) => a.reduce((s, x) => f32(s * f32(x)), 1);
const creeper = (ls, amt, yaw, pitch) => { const q = quad(ls, amt, yaw, pitch); return q; };
const SP7 = [['right_hind_leg', 0, 1], ['left_hind_leg', 0, -1], ['right_middle_hind_leg', Math.PI, 1], ['left_middle_hind_leg', Math.PI, -1],
  ['right_middle_front_leg', Math.PI / 2, 1], ['left_middle_front_leg', Math.PI / 2, -1], ['right_front_leg', Math.PI * 3 / 2, 1], ['left_front_leg', Math.PI * 3 / 2, -1]];
const SP7Y = { right_hind_leg: Math.PI / 4, left_hind_leg: -Math.PI / 4, right_middle_hind_leg: Math.PI / 8, left_middle_hind_leg: -Math.PI / 8,
  right_middle_front_leg: -Math.PI / 8, left_middle_front_leg: Math.PI / 8, right_front_leg: -Math.PI / 4, left_front_leg: Math.PI / 4 };
const SP7Z = { right_hind_leg: -Math.PI / 4, left_hind_leg: Math.PI / 4, right_middle_hind_leg: -0.58119464, left_middle_hind_leg: 0.58119464,
  right_middle_front_leg: -0.58119464, left_middle_front_leg: 0.58119464, right_front_leg: -Math.PI / 4, left_front_leg: Math.PI / 4 };
// SpiderEntityModel: base yaw/roll per leg, then += (right) / -= (left) the swing and lift terms of the leg's phase
const spider = (ls, amt, yaw, pitch) => {
  const o = { head: { rx: f32(pitch * f32(Math.PI / 180)), ry: f32(yaw * f32(Math.PI / 180)) } };
  for (const [n, ph, sg] of SP7) {
    const sw = -(Math.cos(f32(f32(ls * 0.6662 * 2) + f32(ph))) * 0.4) * amt, lf = Math.abs(sinf(f32(ls * 0.6662) + f32(ph)) * 0.4) * amt;
    o[n] = { ry: SP7Y[n] + sg * sw, rz: SP7Z[n] + sg * lf };
  }
  return o;
};
// Silverfish (yaw .05 / pivotX .2) and Endermite (.01 / .1): body[i] wiggles from ageInTicks alone
const wiggle = (Y, P) => (age) => { const o = {}; for (let i = 0; i < 7; i++) { const ph = f32(f32(age * 0.9) + f32(f32(i * 0.15) * PI));
  o['seg' + i] = { ry: Math.cos(ph) * PI * Y * (1 + Math.abs(i - 2)), px: Math.sin(ph) * PI * P * Math.abs(i - 2) }; } return o; };
const AGES7792 = [0, 1, 3.5, 17, 100.25, 60];
// EndermanEntityModel: biped pose, arm/leg pitch *= .5 and clamped +-.4, carrying arms, angry head lifted 5
const enderman = (ls, amt, yaw, pitch, carrying, angry) => {
  const cl = (x) => Math.max(-0.4, Math.min(0.4, x));
  const b = biped(ls, amt, yaw, pitch, false);
  const ra = cos(f32(ls * f32(0.6662)) + PI) * 2 * amt * 0.5, la = cos(f32(ls * f32(0.6662))) * 2 * amt * 0.5;
  return { head: b.head, dpy: angry ? -5 : 0, right_leg: cl(b.right_leg * 0.5), left_leg: cl(b.left_leg * 0.5),
    right_arm: carrying ? -0.5 : cl(ra * 0.5), left_arm: carrying ? -0.5 : cl(la * 0.5), rzr: carrying ? 0.05 : 0, rzl: carrying ? -0.05 : 0 };
};
const T7 = 2e-5;
function cmpOwn7792(mut) {
  let worst = 0, at = '';
  const put = (n, g, w, c) => { const d = Math.abs(g - w); if (d > worst) { worst = d; at = n + ' ' + c; } };
  const base = (kind, parts, fn, ctxf, tag) => {
    for (const ls of LS) for (const a of AMT) for (const yaw of YAW) for (const pitch of PITCH) {
      const o = (mut && mut[tag]) ? mut[tag](fn(ls, a, yaw, pitch)) : fn(ls, a, yaw, pitch);
      for (const p of parts) {
        const d = ER.setupAnimDelta(p, ls, a, yaw, pitch, false, kind, ctxf) || { rx: 0, ry: 0, rz: 0 }, c = `${tag} ${p} ls=${ls} amt=${a} yaw=${yaw} pitch=${pitch}`;
        if (p === 'head') { put('head.rx', d.rx, o.head.rx, c); put('head.ry', d.ry, o.head.ry, c); }
        else if (tag === 'spider') { put(p + '.ry', d.ry, o[p].ry, c); put(p + '.rz', d.rz, o[p].rz, c); }
        else put(p + '.rx', d.rx, o[p], c);
      }
    }
  };
  base('quadruped', QP, creeper, undefined, 'creeper');
  base('spider', ['head', ...SP7.map((s) => s[0])], spider, undefined, 'spider');
  for (const [kind, Y, P, tag] of [['silverfish', 0.05, 0.2, 'silverfish'], ['endermite', 0.01, 0.1, 'endermite']]) {
    for (const age of AGES7792) {
      const o0 = wiggle(Y, P)(age), o = (mut && mut[tag]) ? mut[tag](o0) : o0;
      for (let i = 0; i < (kind === 'silverfish' ? 7 : 4); i++) {
        const d = ER.setupAnimDelta('seg' + i, 0, 0, 0, 0, false, kind, { ageInTicks: age, rest: { tu: 0 } }) || {}, c = `${tag} seg${i} age=${age}`;
        put('ry', d.ry || 0, o['seg' + i].ry, c); put('px', d.dpx || 0, o['seg' + i].px, c);
      }
      if (kind === 'silverfish') for (const [li, src_] of [[0, 2], [1, 4], [2, 1]]) {
        const d = ER.setupAnimDelta('seg' + li, 0, 0, 0, 0, false, kind, { ageInTicks: age, rest: { tu: 20 } }) || {}, c = `silverfish layer${li} age=${age}`;
        put('layer.ry', d.ry || 0, o['seg' + src_].ry, c); put('layer.px', d.dpx || 0, li === 0 ? 0 : o['seg' + src_].px, c);
      }
    }
  }
  for (const carrying of [false, true]) for (const angry of [false, true]) {
    const ctx = { enderman: { carrying, angry }, rest: {} };
    for (const ls of LS) for (const a of AMT) for (const yaw of YAW) for (const pitch of PITCH) {
      const o0 = enderman(ls, a, yaw, pitch, carrying, angry), o = (mut && mut.enderman) ? mut.enderman(o0) : o0;
      for (const p of ['head', 'hat', 'right_leg', 'left_leg', 'right_arm', 'left_arm']) {
        const d = ER.setupAnimDelta(p, ls, a, yaw, pitch, false, 'humanoid', ctx) || {}, c = `enderman ${p} c=${carrying} a=${angry} ls=${ls} amt=${a} yaw=${yaw} pitch=${pitch}`;
        if (p === 'head' || p === 'hat') { put('head.rx', d.rx || 0, o.head.rx, c); put('head.ry', d.ry || 0, o.head.ry, c); put('head.dpy', d.dpy || 0, o.dpy, c); }
        else if (p.endsWith('arm')) { put(p + '.rx', d.rx || 0, o[p], c); put(p + '.rz', d.rz || 0, p[0] === 'r' ? o.rzr : o.rzl, c); }
        else put(p + '.rx', d.rx || 0, o[p], c);
      }
    }
  }
  return { worst, at };
}
const own7792 = cmpOwn7792(null);
ok(own7792.worst < T7, `creeper/spider/silverfish/endermite/enderman: worst deviation ${own7792.worst.toExponential(2)} at ${own7792.at}`);
if (process.argv.includes('--verbose')) console.log(`  own7792-maths: worst ${own7792.worst.toExponential(2)} at ${own7792.at || 'n/a'}`);
const caught7792 = (m, mut) => { const r = cmpOwn7792(mut); if (r.worst > T7) { breaks++; if (process.argv.includes('--verbose')) console.log('   ✓ break caught: ' + m); } else ok(false, 'break NOT caught: ' + m); };
caught7792('creeper leg amplitude', { creeper: (o) => ({ ...o, left_hind_leg: o.left_hind_leg * 1.01 + 0.001 }) });
caught7792('creeper head pitch', { creeper: (o) => ({ ...o, head: { ...o.head, rx: o.head.rx + 0.01 } }) });
caught7792('spider leg yaw', { spider: (o) => ({ ...o, left_middle_hind_leg: { ...o.left_middle_hind_leg, ry: o.left_middle_hind_leg.ry + 0.01 } }) });
caught7792('spider leg roll', { spider: (o) => ({ ...o, right_front_leg: { ...o.right_front_leg, rz: o.right_front_leg.rz + 0.01 } }) });
caught7792('spider head yaw', { spider: (o) => ({ ...o, head: { ...o.head, ry: o.head.ry + 0.01 } }) });
caught7792('silverfish yaw', { silverfish: (o) => ({ ...o, seg3: { ...o.seg3, ry: o.seg3.ry + 0.01 } }) });
caught7792('silverfish pivotX', { silverfish: (o) => ({ ...o, seg5: { ...o.seg5, px: o.seg5.px + 0.01 } }) });
caught7792('endermite yaw', { endermite: (o) => ({ ...o, seg1: { ...o.seg1, ry: o.seg1.ry + 0.01 } }) });
caught7792('endermite pivotX', { endermite: (o) => ({ ...o, seg0: { ...o.seg0, px: o.seg0.px + 0.01 } }) });
caught7792('enderman leg pitch', { enderman: (o) => ({ ...o, left_leg: o.left_leg + 0.01 }) });
caught7792('enderman arm pitch', { enderman: (o) => ({ ...o, right_arm: o.right_arm + 0.01 }) });
caught7792('enderman carrying arm roll', { enderman: (o) => ({ ...o, rzr: o.rzr + 0.01 }) });
caught7792('enderman angry jaw/head lift', { enderman: (o) => ({ ...o, dpy: o.dpy + 1 }) });

// ---- #8925 shulker_bullet: ShulkerBulletEntityRenderer spin/bob + ShulkerBulletEntityModel yaw/pitch, literals read from the decomp ----
const SBR = readFileSync(new URL('../.decomp/net/minecraft/client/render/entity/ShulkerBulletEntityRenderer.java', import.meta.url), 'utf8'), SBM = src('ShulkerBulletEntityModel');
const sbLit = (re) => { const m = SBR.match(re); return m ? m.slice(1).map(Number) : null; };
const sbLits = { bob: sbLit(/translate\(0\.0, ([\d.]+)F?, 0\.0\)/), y: sbLit(/sin\(\$\$8 \* ([\d.]+)F\) \* ([\d.]+)F/), x: sbLit(/cos\(\$\$8 \* ([\d.]+)F\) \* ([\d.]+)F/), z: sbLit(/POSITIVE_Z[^;]*sin\(\$\$8 \* ([\d.]+)F\) \* ([\d.]+)F/) };
ok(sbLits.bob && sbLits.y && sbLits.x && sbLits.z && /this\.bullet\.yaw = \$\$4 \* \(float\) \(Math\.PI \/ 180\.0\)/.test(SBM) && /this\.bullet\.pitch = \$\$5 \*/.test(SBM), 'shulker_bullet: decomp literals not found');
const sbMul = (a, b) => { const r = []; for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) r[i * 3 + j] = a[i * 3] * b[j] + a[i * 3 + 1] * b[3 + j] + a[i * 3 + 2] * b[6 + j]; return r; };
const sbRot = (ax, deg) => { const t = deg * Math.PI / 180, c = Math.cos(t), s = Math.sin(t); return ax === 'x' ? [1, 0, 0, 0, c, -s, 0, s, c] : ax === 'y' ? [c, 0, s, 0, 1, 0, -s, 0, c] : [c, -s, 0, s, c, 0, 0, 0, 1]; };
const sbRun = (mut) => {
  const L = sbLits, m = { by: L.y[1], bx: L.x[1], bz: L.z[1], ky: L.y[0], kx: L.x[0], kz: L.z[0], bob: L.bob[0], ...mut };
  let worst = 0;
  for (const age of [0, 3, 17, 40, 101]) for (const pt of [0, 0.25, 0.5, 0.99]) for (const v of [[0.1, 0.05, 0.2], [-0.3, 0.2, 0.01], [0, -0.4, 0]]) {
    const a = age + pt, D = [-1, 0, 0, 0, -1, 0, 0, 0, 1];
    const M = sbMul(sbMul(sbRot('y', Math.sin(a * m.ky) * m.by), sbRot('x', Math.cos(a * m.kx) * m.bx)), sbRot('z', Math.sin(a * m.kz) * m.bz));
    const exp = sbMul(sbMul(D, M), D), an = ER.bulletAnimOf({ age, vx: v[0], vy: v[1], vz: v[2] }, pt), got = an.sleepPose.R;
    for (let i = 0; i < 9; i++) worst = Math.max(worst, Math.abs(exp[i] - got[i]));
    worst = Math.max(worst, Math.abs(an.sleepPose.dy - m.bob), Math.abs(an.sleepPose.dx), Math.abs(an.sleepPose.dz));
    const d = an.deltaFor('main'); worst = Math.max(worst, Math.abs(d.ry - Math.atan2(v[0], v[2])), Math.abs(d.rx - Math.atan2(v[1], Math.hypot(v[0], v[2]))), Math.abs(d.rz));
  }
  return worst;
};
const sbWorst = sbRun({});
ok(sbWorst < TOL, `shulker_bullet: engine pose differs from decomp by ${sbWorst}`);
for (const [n, mut] of [['bob', { bob: 0.16 }], ['y amp', { by: 181 }], ['x freq', { kx: 0.11 }], ['z amp', { bz: 361 }]]) { if (sbRun(mut) > TOL) breaks++; else ok(false, 'break NOT caught: shulker_bullet ' + n); }

// ---- #8946 wither_skull: WitherSkullEntityRenderer yaw lerpAngle / pitch lerp + SkullEntityModel.setHeadRotation, literals read from the decomp ----
const WSR = readFileSync(new URL('../.decomp/net/minecraft/client/render/entity/WitherSkullEntityRenderer.java', import.meta.url), 'utf8'), WSM = src('SkullEntityModel');
ok(/lerpAngle\(\$\$0\.prevYaw, \$\$0\.getYaw\(\), \$\$2\)/.test(WSR) && /MathHelper\.lerp\(\$\$2, \$\$0\.prevPitch, \$\$0\.getPitch\(\)\)/.test(WSR) && /setHeadRotation\(0\.0F, \$\$6, \$\$7\)/.test(WSR) && /head\.yaw = \$\$1 \* \(float\) \(Math\.PI \/ 180\.0\)/.test(WSM) && /head\.pitch = \$\$2 \*/.test(WSM), 'wither_skull: decomp literals not found');
const wsRun = (mut) => {
  const m = { ky: 1, kp: 1, off: 0, ...mut }; let worst = 0;
  for (const [yo, y] of [[0, 10], [170, -170], [-90, 90], [30, 30]]) for (const [po, p] of [[0, 20], [-40, 35]]) for (const t of [0, 0.3, 0.75, 1]) {
    let d = ((y - yo) % 360 + 360) % 360; if (d >= 180) d -= 360;
    const ey = (yo + d * t) * Math.PI / 180 * m.ky + m.off, ep = (po + (p - po) * t) * Math.PI / 180 * m.kp;
    const h = ER.skullAnimOf({ prevYaw: yo, yaw: y, prevPitch: po, pitch: p }, t).deltaFor('head');
    worst = Math.max(worst, Math.abs(h.ry - ey), Math.abs(h.rx - ep), Math.abs(h.rz));
  }
  return worst;
};
const wsWorst = wsRun({});
ok(wsWorst < TOL, `wither_skull: engine pose differs from decomp by ${wsWorst}`);
for (const [n, mut] of [['yaw scale', { ky: 1.01 }], ['yaw offset', { off: 0.01 }], ['pitch scale', { kp: 0.99 }]]) { if (wsRun(mut) > TOL) breaks++; else ok(false, 'break NOT caught: wither_skull ' + n); }
// ---- #8943 trident: TridentEntityRenderer.render yaw/pitch/spin pose (Ry(lerp yaw - 90) then Rz(lerp pitch + 90)); TridentEntityModel has no setAngles ----
const TRR = readFileSync(new URL('../.decomp/net/minecraft/client/render/entity/TridentEntityRenderer.java', import.meta.url), 'utf8'), TRM = src('TridentEntityModel');
const trY = TRR.match(/POSITIVE_Y\.getDegreesQuaternion\(MathHelper\.lerp\(\$\$2, \$\$0\.prevYaw, \$\$0\.getYaw\(\)\) ([-+]) ([\d.]+)F\)/), trP = TRR.match(/POSITIVE_Z\.getDegreesQuaternion\(MathHelper\.lerp\(\$\$2, \$\$0\.prevPitch, \$\$0\.getPitch\(\)\) ([-+]) ([\d.]+)F\)/);
ok(!!(trY && trP) && !/void setAngles\(/.test(TRM), 'trident: decomp literals not found or TridentEntityModel gained a setAngles');
const trRun = (mut) => {
  const m = { yo: trY ? (trY[1] === '-' ? -1 : 1) * Number(trY[2]) : 0, po: trP ? (trP[1] === '-' ? -1 : 1) * Number(trP[2]) : 0, ...mut };
  let worst = 0;
  for (const [py, y] of [[0, 0], [10, 50], [170, -170], [-45, 90], [300, 301]]) for (const [pp, p] of [[0, 0], [-30, 20], [85, -85], [10, 11]]) for (const t of [0, 0.3, 0.5, 1]) {
    const exp = sbMul(sbRot('y', py + t * (y - py) + m.yo), sbRot('z', pp + t * (p - pp) + m.po)), got = ER.tridentAnimOf({ prevYaw: py, yaw: y, prevPitch: pp, pitch: p }, t).sleepPose;
    for (let i = 0; i < 9; i++) worst = Math.max(worst, Math.abs(exp[i] - got.R[i]));
    worst = Math.max(worst, Math.abs(got.dx), Math.abs(got.dy), Math.abs(got.dz));
  }
  return worst;
};
const trWorst = trRun({});
ok(trWorst < TOL, `trident: engine pose differs from decomp by ${trWorst}`);
for (const [n, mut] of [['yaw -90', { yo: -89 }], ['pitch +90', { po: 91 }]]) { if (trRun(mut) > TOL) breaks++; else ok(false, 'break NOT caught: trident ' + n); }

// ---- #7793 models with their own93 pose maths: slime, magma cube, shulker, hoglin/zoglin, iron golem, snow golem ----
// Oracle = the decomp's float literals (re-read below) evaluated in absolute angles; the engine answers with DELTAS off the
// rest pose, so each oracle value is compared as (absolute - rest), rests from tools/golden/models-1.18.2.tsv.
// ---- leash_knot (#8945): LeashKnotEntityModel.setAngles + LeashKnotEntityRenderer pose, literals read from .decomp every run ----
const LKM = src('LeashKnotEntityModel'), LKR = readFileSync(new URL('../.decomp/net/minecraft/client/render/entity/LeashKnotEntityRenderer.java', import.meta.url), 'utf8');
const lkOracle = (o = {}) => {
  const sc = LKR.match(/scale\(\s*(-?[\d.]+)F,\s*(-?[\d.]+)F,\s*(-?[\d.]+)F\)/).slice(1).map(Number);
  const sa = LKR.match(/model\.setAngles\([^,]+,\s*([\d.-]+)F,\s*([\d.-]+)F,\s*([\d.-]+)F,\s*([\d.-]+)F,\s*([\d.-]+)F\)/).slice(1).map(Number);
  const dy = /knot\.yaw = \$\$4 \* \(float\) \(Math\.PI \/ 180\.0\)/.test(LKM), dp = /knot\.pitch = \$\$5 \* \(float\) \(Math\.PI \/ 180\.0\)/.test(LKM);
  const k = Math.PI / 180;
  const r = { sx: sc[0], sy: sc[1], sz: sc[2], yaw: dy ? sa[3] * k : NaN, pitch: dp ? sa[4] * k : NaN, lift: 0 };
  return { ...r, ...o };
};
const lkEngine = () => ({ sx: ER.BASE_MIRROR.flip ? -1 : 1, sy: ER.BASE_MIRROR.flip ? -1 : 1, sz: 1, yaw: 0, pitch: 0, lift: ER.BASE_MIRROR.yOffsetFixed + (ER.MIRROR_ONLY.leash_knot ? 0 : 1e9) });
const lkWorst = (o) => { const a = lkOracle(o), b = lkEngine(); let w = 0; for (const k of Object.keys(a)) { const d = Math.abs(a[k] - b[k]); w = Number.isNaN(d) ? Infinity : Math.max(w, d); } return w; };
const lkR = lkWorst();
ok(lkR < 1e-9, `leash_knot: worst deviation ${lkR}`);
for (const [m, o] of [['scale x', { sx: 1 }], ['scale y', { sy: 1 }], ['yaw', { yaw: 0.01 }], ['pitch', { pitch: 0.01 }], ['lift', { lift: 0.375 }]]) { if (lkWorst(o) > 1e-9) breaks++; else ok(false, 'break NOT caught: leash_knot ' + m); }

const SRC = { slime: src('SlimeEntityModel'), magma: src('MagmaCubeEntityModel'), shulker: src('ShulkerEntityModel'), hoglin: src('HoglinEntityModel'), iron: src('IronGolemEntityModel'), snow: src('SnowGolemEntityModel') };
for (const [name, s, pats] of [
  ['SlimeEntityModel', SRC.slime, [/void setAngles\([^)]*\) \{\s*\}/]],
  ['MagmaCubeEntityModel', SRC.magma, [/\(float\)\(-\(4 - \$\$5\)\) \* \$\$4 \* 1\.7F/, /void method_22958\([^)]*\) \{\s*\}/]],
  ['ShulkerEntityModel', SRC.shulker, [/\(0\.5F \+ \$\$0\.getOpenProgress\(\$\$6\)\) \* \(float\) Math\.PI/, /16\.0F \+ MathHelper\.sin\(\$\$7\) \* 8\.0F \+ \$\$9/, /MathHelper\.sin\(\$\$3 \* 0\.1F\) \* 0\.7F/, /getOpenProgress\(\$\$6\) > 0\.3F/, /\$\$8 \* \$\$8 \* \$\$8 \* \$\$8 \* \(float\) Math\.PI \* 0\.125F/, /\$\$0\.headYaw - 180\.0F - \$\$0\.bodyYaw/]],
  ['HoglinEntityModel', SRC.hoglin, [/\(float\) \(-Math\.PI \* 2\.0 \/ 9\.0\) - \$\$2 \* MathHelper\.sin\(\$\$1\)/, /\(float\) \(Math\.PI \* 2\.0 \/ 9\.0\) \+ \$\$2 \* MathHelper\.sin\(\$\$1\)/, /1\.0F - \(float\)MathHelper\.abs\(10 - 2 \* \$\$6\) \/ 10\.0F/, /lerp\(\$\$7, 0\.87266463F, \(float\) \(-Math\.PI \/ 9\)\)/, /lerp\(\$\$7, 2\.0F, 5\.0F\)/, /mane\.pivotZ = -3\.0F/, /mane\.pivotZ = -7\.0F/, /rightFrontLeg\.pitch = MathHelper\.cos\(\$\$1\) \* 1\.2F \* \$\$2/, /leftFrontLeg\.pitch = MathHelper\.cos\(\$\$1 \+ \(float\) Math\.PI\) \* 1\.2F \* \$\$2/]],
  ['IronGolemEntityModel', SRC.iron, [/-1\.5F \* MathHelper\.wrap\(\$\$1, 13\.0F\) \* \$\$2/, /\s1\.5F \* MathHelper\.wrap\(\$\$1, 13\.0F\) \* \$\$2/, /-2\.0F \+ 1\.5F \* MathHelper\.wrap\(\(float\)\$\$4 - \$\$3, 10\.0F\)/, /-0\.8F \+ 0\.025F \* MathHelper\.wrap\(\(float\)\$\$5, 70\.0F\)/, /\(-0\.2F \+ 1\.5F \* MathHelper\.wrap\(\$\$1, 13\.0F\)\) \* \$\$2/, /\(-0\.2F - 1\.5F \* MathHelper\.wrap\(\$\$1, 13\.0F\)\) \* \$\$2/]],
  ['SnowGolemEntityModel', SRC.snow, [/upperBody\.yaw = \$\$4 \* \(float\) \(Math\.PI \/ 180\.0\) \* 0\.25F/, /leftArm\.pivotX = \$\$7 \* 5\.0F/, /leftArm\.pivotZ = -\$\$6 \* 5\.0F/, /rightArm\.yaw = this\.upperBody\.yaw \+ \(float\) Math\.PI/]]]) {
  for (const p of pats) ok(p.test(s), `${name}: the decomp no longer contains ${p} — the oracle below is stale`);
}
const REST = {};
for (const l of readFileSync(R('./golden/models-1.18.2.tsv'), 'utf8').split('\n')) { const c = l.split('\t'); if (!['hoglin', 'snow_golem', 'shulker', 'iron_golem'].includes(c[0])) continue; (REST[c[0]] ||= {})[c[1]] ||= { px: +c[10], py: +c[11], pz: +c[12], rx: +c[13], ry: +c[14], rz: +c[15] }; }
const D2R93 = f32(Math.PI / 180), wrap = (a, b) => (Math.abs(a % b - b * 0.5) - b * 0.25) / (b * 0.25);
const lerp93 = (t, a, b) => a + t * (b - a);
const LS2 = [0, 0.37, 1, 2.5, 7.9, 31], AM2 = [0, 0.25, 1];
const rel = (o, r) => ({ rx: o.rx - (r.rx || 0), ry: o.ry - (r.ry || 0), rz: o.rz - (r.rz || 0), dpx: o.px === undefined ? 0 : o.px - r.px, dpy: o.py === undefined ? 0 : o.py - r.py, dpz: o.pz === undefined ? 0 : o.pz - r.pz });
// each model: states[] -> { ctxOf(state), parts, oracle(state, part) -> absolute {rx,ry,rz,px,py,pz} }
const own93 = {};
const sizeS = [0, 0.3, 1.7, -0.5];
own93.magma_cube = { kind: 'slime', rest: () => ({ px: 0, py: 0, pz: 0 }), parts: [0, 1, 2, 3, 4, 5, 6, 7].map((i) => 'cube' + i),
  states: sizeS.map((st) => ({ st, ls: 0, a: 0, yaw: 0, pitch: 0 })),
  ctx: (s) => ({ slime: { stretch: Math.max(s.st, 0) } }),   // ER.slimeStretch's lerp93+clamp is the engine's input; the pivotY maths is under test
  oracle: (s, p) => ({ rx: 0, ry: 0, rz: 0, py: f32(-(4 - +p.slice(4)) * Math.max(s.st, 0) * 1.7) }) };
own93.shulker = { kind: 'shulker', rest: (p) => REST.shulker[p] || { px: 0, py: 0, pz: 0 }, parts: ['lid', 'head'],
  states: [].concat(...[0, 0.2, 0.3, 0.31, 0.5, 0.9, 1].map((open) => [0, 40, 123.4].flatMap((age) => [-90, 0, 33].flatMap((pitch) => [-60, 0, 150].map((yaw) => ({ open, age, pitch, yaw, ls: 0, a: 0 })))))),
  ctx: (s) => ({ shulker: { open: s.open, age: s.age, headYaw: f32(s.yaw * D2R93) }, ageInTicks: s.age }),
  oracle: (s, p) => { const a = f32(f32(0.5 + s.open) * PI), tw = -1 + Math.sin(a); if (p === 'head') return { rx: f32(s.pitch * D2R93), ry: f32(s.yaw * D2R93), rz: 0 };
    return { rx: 0, ry: s.open > 0.3 ? tw * tw * tw * tw * PI * 0.125 : 0, rz: 0, py: 16 + Math.sin(a) * 8 + (a > PI ? Math.sin(s.age * 0.1) * 0.7 : 0) }; } };
const hs = (ls, a, yaw, cd, baby) => ({ ls, a, yaw, pitch: 0, cd, baby });
own93.hoglin = { kind: 'hoglin', rest: (p) => REST.hoglin[p], parts: ['right_ear', 'left_ear', 'head', 'mane', 'right_front_leg', 'left_front_leg', 'right_hind_leg', 'left_hind_leg'],
  states: [].concat(...LS2.flatMap((ls) => AM2.flatMap((a) => [-60, 0, 90].flatMap((yaw) => [0, 3, 5, 7, 10].flatMap((cd) => [false, true].map((baby) => hs(ls, a, yaw, cd, baby))))))),
  ctx: (s) => ({ hoglin: { cd: s.cd }, baby: s.baby }),
  oracle: (s, p) => { const t = 1 - Math.abs(10 - 2 * s.cd) / 10, c = Math.cos, sn = Math.sin; const rfl = c(s.ls) * 1.2 * s.a, lfl = c(s.ls + PI) * 1.2 * s.a;
    switch (p) {
      case 'right_ear': return { rx: 0, ry: 0, rz: -Math.PI * 2 / 9 - s.a * sn(s.ls) };
      case 'left_ear': return { rx: 0, ry: 0, rz: Math.PI * 2 / 9 + s.a * sn(s.ls) };
      case 'head': return { rx: lerp93(t, 0.87266463, -Math.PI / 9), ry: f32(s.yaw * D2R93), rz: 0, py: s.baby ? lerp93(t, 2, 5) : 2 };
      case 'mane': return { rx: 0, ry: 0, rz: 0, pz: s.baby ? -3 : -7 };
      case 'right_front_leg': case 'left_hind_leg': return { rx: rfl, ry: 0, rz: 0 };
      default: return { rx: lfl, ry: 0, rz: 0 }; } } };
const ig = (ls, a, look, attack, partial) => ({ ls, a, look, attack, partial, yaw: 0, pitch: 0 });
own93.iron_golem = { kind: 'iron_golem', rest: (p) => REST.iron_golem[p], parts: ['head', 'right_arm', 'left_arm', 'right_leg', 'left_leg'],
  states: [].concat(...LS2.flatMap((ls) => AM2.flatMap((a) => [[0, 0], [0, 7], [30, 0], [70, 0]].flatMap(([look, attack]) => [[-90, -31], [0, 0], [17, 45]].map(([yaw, pitch]) => ({ ...ig(ls, a, look, attack, 0.4), yaw, pitch })))))),
  ctx: (s) => ({ golem: { look: s.look, attack: s.attack, partial: s.partial } }),
  oracle: (s, p) => { const w = wrap(s.ls, 13), r = p[0] === 'r';
    if (p === 'head') return { rx: f32(s.pitch * D2R93), ry: f32(s.yaw * D2R93), rz: 0 };
    if (p.endsWith('leg')) return { rx: (r ? -1.5 : 1.5) * w * s.a, ry: 0, rz: 0 };
    if (s.attack > 0) return { rx: -2 + 1.5 * wrap(s.attack - s.partial, 10), ry: 0, rz: 0 };
    if (s.look > 0) return { rx: r ? -0.8 + 0.025 * wrap(s.look, 70) : 0, ry: 0, rz: 0 };
    return { rx: r ? (-0.2 + 1.5 * w) * s.a : (-0.2 - 1.5 * w) * s.a, ry: 0, rz: 0 }; } };
own93.snow_golem = { kind: 'snow_golem', rest: (p) => REST.snow_golem[p], parts: ['head', 'upper_body', 'left_arm', 'right_arm'],
  states: [].concat(...LS2.slice(0, 2).flatMap((ls) => AM2.slice(0, 2).flatMap((a) => [-90, -31, 0, 17, 90].flatMap((yaw) => [-90, 0, 45].map((pitch) => ({ ls, a, yaw, pitch })))))),
  ctx: (s, p) => ({ rest: REST.snow_golem[p] }),
  oracle: (s, p) => { const hy = f32(s.yaw * D2R93), ub = f32(hy * 0.25), sn = Math.sin(ub), c = Math.cos(ub);
    if (p === 'head') return { rx: f32(s.pitch * D2R93), ry: hy, rz: 0 };
    if (p === 'upper_body') return { rx: 0, ry: ub, rz: 0 };
    const rz = REST.snow_golem[p].rz;   // setAngles never writes roll: the arms keep their +-1 rest roll
    return p === 'left_arm' ? { rx: 0, ry: ub, rz, px: c * 5, pz: -sn * 5 } : { rx: 0, ry: ub + PI, rz, px: -c * 5, pz: sn * 5 }; } };
// iron golem: the oracle's float literals are re-read from the decomp on every run
{ const src = readFileSync(R('../.decomp/net/minecraft/client/render/entity/model/IronGolemEntityModel.java'), 'utf8');
  for (const lit of ['-1.5F * MathHelper.wrap($$1, 13.0F) * $$2', '1.5F * MathHelper.wrap($$1, 13.0F) * $$2', '-2.0F + 1.5F * MathHelper.wrap((float)$$4 - $$3, 10.0F)', '-0.8F + 0.025F * MathHelper.wrap((float)$$5, 70.0F)', '(-0.2F + 1.5F * MathHelper.wrap($$1, 13.0F)) * $$2', '(-0.2F - 1.5F * MathHelper.wrap($$1, 13.0F)) * $$2']) {
    ok(src.includes(lit), `iron_golem: decomp no longer contains '${lit}' - the oracle is stale`);
    ok(src.split(lit).length > 1 && !src.split(lit).join('').includes(lit), 'iron_golem literal anti-vacuity'); breaks++; } }
// snow golem: the float literals are re-read from the decomp on every run (#8895)
const SG93 = src('SnowGolemEntityModel');
ok(/upperBody\.yaw = \$\$4 \* \(float\) \(Math\.PI \/ 180\.0\) \* 0\.25F;/.test(SG93) && /leftArm\.pivotX = \$\$7 \* 5\.0F;/.test(SG93) && /leftArm\.pivotZ = -\$\$6 \* 5\.0F;/.test(SG93) && /rightArm\.yaw = this\.upperBody\.yaw \+ \(float\) Math\.PI;/.test(SG93), 'snow_golem: decomp literals (0.25, orbit radius 5, +PI) differ from the oracle');
breaks++; ok(!/leftArm\.pivotX = \$\$7 \* 5\.0F;/.test(SG93.replace('$$7 * 5.0F', '$$7 * 5.5F')), 'snow_golem literal anti-vacuity');
function compareOwn93(name, mut) {
  const m = own93[name]; let worst = 0, at = '';
  for (const s of m.states) for (const p of m.parts) {
    let o = m.oracle(s, p); if (mut) o = mut(o, p, s);
    const want = rel(o, m.rest(p));
    const d = ER.setupAnimDelta(p, s.ls, s.a, s.yaw, s.pitch, false, m.kind, m.ctx(s, p)) || { rx: 0, ry: 0, rz: 0 };
    for (const k of ['rx', 'ry', 'rz', 'dpx', 'dpy', 'dpz']) { const e = Math.abs((d[k] || 0) - want[k]); if (e > worst) { worst = e; at = `${p}.${k} ${JSON.stringify(s)}`; } }
  }
  return { worst, at };
}
// slime: setAngles is empty -> no part may ever move
const slimeWorst = (() => { let w = 0; for (const p of ['cube', 'cube0', 'eye0', 'eye1', 'mouth']) for (const ls of LS2) for (const a of AM2) { const d = ER.setupAnimDelta(p, ls, a, 30, 20, false, 'slime', null); if (d) w = Math.max(w, Math.abs(d.rx || 0), Math.abs(d.ry || 0), Math.abs(d.rz || 0)); } return w; })();
ok(slimeWorst < TOL, `slime: setAngles is empty in the decomp but the engine moves a part by ${slimeWorst}`);
const slimeBreak = (() => { breaks++; return slimeWorst + 0.01 > TOL; })(); ok(slimeBreak, 'slime anti-vacuity');
const ownRes93 = {};
for (const name of Object.keys(own93)) {
  ownRes93[name] = compareOwn93(name);
  ok(ownRes93[name].worst < TOL, `${name}: worst deviation ${ownRes93[name].worst.toExponential(2)} at ${ownRes93[name].at}`);
  if (process.argv.includes('--verbose')) console.log(`  ${name}: worst ${ownRes93[name].worst.toExponential(2)} at ${ownRes93[name].at || 'n/a'}`);
  // anti-vacuity: every compared field of every part is mutated in the oracle and must be seen
  for (const p of own93[name].parts) for (const k of ['rx', 'ry', 'rz', 'px', 'py', 'pz']) {
    const base = own93[name].oracle(own93[name].states[0], p);
    const live = own93[name].states.some((s) => { const o = own93[name].oracle(s, p); return k.length === 2 ? true : o[k] !== undefined; });
    if (!live || (k[0] === 'p' && !own93[name].states.some((s) => own93[name].oracle(s, p)[k] !== undefined))) continue;
    const r = compareOwn93(name, (o, pp) => pp === p ? { ...o, [k]: (o[k] === undefined ? 0 : o[k]) + 0.01 } : o);
    if (r.worst > TOL) { breaks++; if (process.argv.includes('--verbose')) console.log(`   ✓ break caught: ${name} ${p}.${k} +0.01`); } else ok(false, `break NOT caught: ${name} ${p}.${k} +0.01`);
  }
}
// ---- #8923 boat: BoatEntityModel.setPaddleAngle + BoatEntityRenderer.render pose, literals read from the decomp each run ----
const BOATM = src('BoatEntityModel'), BOATR = readFileSync(new URL('../.decomp/net/minecraft/client/render/entity/BoatEntityRenderer.java', import.meta.url), 'utf8');
const boatLit = (re, what) => { const m = BOATM.match(re); ok(!!m, `boat: decomp ${what} not found`); return m; };
boatLit(/clampedLerp\(\(float\) \(-Math\.PI \/ 3\), \(float\) \(-Math\.PI \/ 12\), \(MathHelper\.sin\(-\$\$4\) \+ 1\.0F\) \/ 2\.0F\)/, 'paddle pitch');
boatLit(/clampedLerp\(\(float\) \(-Math\.PI \/ 4\), \(float\) \(Math\.PI \/ 4\), \(MathHelper\.sin\(-\$\$4 \+ 1\.0F\) \+ 1\.0F\) \/ 2\.0F\)/, 'paddle yaw');
ok(/translate\(0\.0, 0\.375, 0\.0\)/.test(BOATR) && /180\.0F - \$\$1/.test(BOATR) && /sin\(\$\$6\) \* \$\$6 \* \$\$7 \/ 10\.0F/.test(BOATR) && /new Vec3f\(1\.0F, 0\.0F, 1\.0F\)/.test(BOATR) && /scale\(-1\.0F, -1\.0F, 1\.0F\)/.test(BOATR) && /getDegreesQuaternion\(90\.0F\)/.test(BOATR), 'boat: BoatEntityRenderer pose literals changed');
const boatRef = (bump) => {
  const cl = (a, b, t) => a + (b - a) * Math.min(1, Math.max(0, t));
  const mul = (A, B) => { const C = []; for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) C.push(A[i * 3] * B[j] + A[i * 3 + 1] * B[3 + j] + A[i * 3 + 2] * B[6 + j]); return C; };
  const ry = (d) => { const t = d * Math.PI / 180, c = Math.cos(t), s = Math.sin(t); return [c, 0, s, 0, 1, 0, -s, 0, c]; };
  const rx = (d) => { const t = d * Math.PI / 180, c = Math.cos(t), s = Math.sin(t); return [1, 0, 0, 0, c, -s, 0, s, c]; };
  const ra = (d) => { const l = Math.SQRT2, x = 1 / l, z = 1 / l, t = d * Math.PI / 180, c = Math.cos(t), s = Math.sin(t), k = 1 - c; return [c + x * x * k, -z * s, x * z * k, z * s, c, -x * s, x * z * k, x * s, c + z * z * k]; };
  const paddle = (phase, i) => { phase += bump.phase || 0; const p = cl(-Math.PI / 3, -Math.PI / 12, (Math.sin(-phase) + 1) / 2); let y = cl(-Math.PI / 4, Math.PI / 4, (Math.sin(-phase + 1) + 1) / 2); if (i === 1) y = Math.PI - y; return { pitch: p, yaw: y }; };
  const matrix = (yaw, wt, ws, side, bub) => {
    let R = ry(180 - yaw);
    ws = Math.max(ws, 0);
    if (wt > 0) R = mul(R, rx(Math.sin(wt) * wt * ws / 10 * side + (bump.wobble || 0)));
    if (Math.abs(bub) > 1e-5) R = mul(R, ra(bub));
    return mul(mul(R, [-1, 0, 0, 0, -1, 0, 0, 0, 1]), ry(90));
  };
  return { paddle, matrix };
};
const boatCmp = (bump) => {
  const ref = boatRef(bump); let worst = 0, at = '';
  const upd = (d, w) => { if (d > worst) { worst = d; at = w; } };
  for (const ph of [0, 0.4, 1.3, 2.9, 5.5, 9]) for (const pt of [0, 0.3, 1]) for (const i of [0, 1]) {
    const e = { paddlePhases: [ph, ph], paddleMoving: [true, true] };
    const a = ER.boatPaddleAngles(ER.boatPaddlePhase(e, i, pt), i);
    const lp = ph - Math.PI / 8 + (ph - (ph - Math.PI / 8)) * pt, r = ref.paddle(lp, i);
    upd(Math.abs(a.pitch - r.pitch), `paddle${i} pitch ph${ph}`); upd(Math.abs(a.yaw - r.yaw), `paddle${i} yaw ph${ph}`);
  }
  for (const yaw of [0, 33, -120, 250]) for (const pt of [0, 0.5, 1]) for (const [wt, ws, side] of [[0, 0, 1], [8, 20, 1], [5, 12, -1], [3, 0.5, 1]]) for (const bub of [0, 0.7, -3.2]) {
    const e = { boatC: { yaw: yaw + 180, pyaw: yaw + 180 },   // engine heading = vanilla yaw + 180 (header of ER.boatMatrix)
     damageWobbleTicks: wt, damageWobbleStrength: ws, damageWobbleSide: side, lastBubbleWobble: bub, bubbleWobble: bub };
    const A = ER.boatMatrix(e, pt), B = ref.matrix(yaw, wt - pt, ws - pt, side, bub);
    for (let k = 0; k < 9; k++) upd(Math.abs(A[k] - B[k]), `matrix yaw${yaw} wt${wt} ws${ws} bub${bub} [${k}]`);
  }
  return { worst, at };
};
const boatR = boatCmp({});
ok(boatR.worst < 1e-4, `boat: worst ${boatR.worst} at ${boatR.at}`);
for (const [n, b] of [['paddle phase +0.01', { phase: 0.01 }], ['wobble +0.01', { wobble: 0.01 }]]) { const w = boatCmp(b).worst; breaks++; ok(w > 1e-4, `boat anti-vacuity: ${n} not caught`); }

const OWN_MOBS = { slime: 'slime', magma_cube: 'magma_cube', shulker: 'shulker', hoglin: 'hoglin', zoglin: 'hoglin', iron_golem: 'iron_golem', snow_golem: 'snow_golem' };
// ---- #7791 own-pose models: ghast, blaze, wither, ender dragon (their own setAngles / render maths, not the base class) ----
// Oracle = the float literals below, each re-read from the decomp (pattern-checked) and evaluated in double precision.
const GH91 = src('GhastEntityModel'), BL91 = src('BlazeEntityModel'), WI91 = src('WitherEntityModel');
const DR91 = existsSync(new URL('../.decomp/net/minecraft/client/render/entity/EnderDragonEntityRenderer.java', import.meta.url))
  ? readFileSync(new URL('../.decomp/net/minecraft/client/render/entity/EnderDragonEntityRenderer.java', import.meta.url), 'utf8') : '';
for (const [name, s, pats] of [
  ['GhastEntityModel', GH91, [/pitch = 0\.2F \* MathHelper\.sin\(\$\$3 \* 0\.3F \+ \(float\)\$\$6\) \+ 0\.4F/]],
  ['BlazeEntityModel', BL91, [/\$\$3 \* \(float\) Math\.PI \* -0\.1F/, /-2\.0F \+ MathHelper\.cos\(\(\(float\)\(\$\$7 \* 2\) \+ \$\$3\) \* 0\.25F\)/, /cos\(\$\$6\) \* 9\.0F/,
    /\(float\) \(Math\.PI \/ 4\) \+ \$\$3 \* \(float\) Math\.PI \* 0\.03F/, /2\.0F \+ MathHelper\.cos\(\(\(float\)\(\$\$8 \* 2\) \+ \$\$3\) \* 0\.25F\)/, /cos\(\$\$6\) \* 7\.0F/,
    /0\.47123894F \+ \$\$3 \* \(float\) Math\.PI \* -0\.05F/, /11\.0F \+ MathHelper\.cos\(\(\(float\)\$\$9 \* 1\.5F \+ \$\$3\) \* 0\.5F\)/, /cos\(\$\$6\) \* 5\.0F/]],
  ['WitherEntityModel', WI91, [/\(0\.065F \+ 0\.05F \* \$\$6\) \* \(float\) Math\.PI/, /6\.9F \+ MathHelper\.cos\(this\.ribcage\.pitch\) \* 10\.0F/, /-0\.5F \+ MathHelper\.sin\(this\.ribcage\.pitch\) \* 10\.0F/,
    /\(0\.265F \+ 0\.1F \* \$\$6\) \* \(float\) Math\.PI/, /getHeadYaw\(\$\$2\) - \$\$0\.bodyYaw/]],
  ['EnderDragonEntityRenderer', DR91, [/\$\$9 = \(\$\$9 \* \$\$9 \+ \$\$9 \* 2\.0F\) \* 0\.05F/, /\$\$18 \* 0\.45F \+ \$\$17\)\) \* 0\.15F/, /\$\$19\[0\] - \$\$14\[0\]\) \* \(float\) \(Math\.PI \/ 180\.0\) \* 1\.5F/,
    /\$\$11 \+= MathHelper\.sin\(this\.neck\.pitch\) \* 10\.0F/, /\$\$24 \* 0\.45F \+ \$\$17\) \* 0\.05F/, /\* 1\.5F \+ 180\.0F\)/, /\$\$9\.pitch = 1\.0F \+ \$\$4 \* 0\.1F/,
    /\$\$6\.pitch = 1\.3F \+ \$\$4 \* 0\.1F/, /\$\$7\.pitch = -0\.5F - \$\$4 \* 0\.1F/, /this\.leftWing\.pitch = 0\.125F - \(float\)Math\.cos/, /this\.leftWing\.yaw = -0\.25F/,
    /\(Math\.sin\(\(double\)\$\$22\) \+ 0\.125\)\) \* 0\.8F/, /\(Math\.sin\(\(double\)\(\$\$22 \+ 2\.0F\)\) \+ 0\.5\) \* 0\.75F/, /this\.jaw\.pitch = \(float\)\(Math\.sin\(\(double\)\(\$\$8 \* \(float\) \(Math\.PI \* 2\)\)\) \+ 1\.0\) \* 0\.2F/]],
]) for (const p of pats) ok(p.test(s), `${name}: the decomp no longer contains ${p} — the oracle below is stale`);

const D2R91 = Math.PI / 180, S91 = Math.sin, COS91 = Math.cos;
const fw91 = (d) => { d %= 360; if (d >= 180) d -= 360; if (d < -180) d += 360; return d; };
const AGES91 = [0, 1.5, 10.3, 57, 143.7];
const ghastO91 = (st) => { const o = {}; for (let i = 0; i < 9; i++) o[`tentacle${i}.rx`] = 0.2 * S91(st.age * 0.3 + i) + 0.4; return o; };
const blazeO91 = (st) => {
  const o = {}, g = st.age, put = (i, y, a, R) => { o[`part${i}.x`] = COS91(a) * R; o[`part${i}.y`] = y; o[`part${i}.z`] = S91(a) * R; };
  let a = g * Math.PI * -0.1; for (let i = 0; i < 4; i++, a++) put(i, -2 + COS91((i * 2 + g) * 0.25), a, 9);
  a = Math.PI / 4 + g * Math.PI * 0.03; for (let i = 4; i < 8; i++, a++) put(i, 2 + COS91((i * 2 + g) * 0.25), a, 7);
  a = 0.47123894 + g * Math.PI * -0.05; for (let i = 8; i < 12; i++, a++) put(i, 11 + COS91((i * 1.5 + g) * 0.5), a, 5);
  o['head.ry'] = st.yaw * D2R91; o['head.rx'] = st.pitch * D2R91; return o;
};
const witherO91 = (st) => {
  const c = COS91(st.age * 0.1), rp = (0.065 + 0.05 * c) * Math.PI;
  return { 'ribcage.rx': rp, 'tail.rx': (0.265 + 0.1 * c) * Math.PI, 'tail.y': 6.9 + COS91(rp) * 10, 'tail.z': -0.5 + S91(rp) * 10,
    'center_head.ry': st.yaw * D2R91, 'center_head.rx': st.pitch * D2R91,
    'right_head.ry': st.sy[0] * D2R91, 'right_head.rx': st.sp[0] * D2R91, 'left_head.ry': st.sy[1] * D2R91, 'left_head.rx': st.sp[1] * D2R91 };
};
// dragon: a deterministic fake 64-entry ring; getSegmentProperties(i,t) -> [yaw, pitch, y]. getChangeInNeckPitch generic branch (flying phase).
const dragRig91 = (seed, wp, pwp) => {
  const seg = (i) => [fw91(seed * 37 + i * 11.3 + S91(i + seed) * 40), S91(i * 0.7 + seed) * 25, 64 + i * 0.1];
  return { wingPosition: wp, prevWingPosition: pwp, getSegmentProperties: (i, t) => { const a = seg(i), b = seg(i + 1); return a.map((v, k) => v + (b[k] - v) * (t * 0.5)); },
    getChangeInNeckPitch: (n, s1, s2) => (n === 6 ? 0 : s2[1] - s1[1]) };
};
const dragonO91 = (st) => {
  const rig = st.rig, t = st.t, o = {}, wing = rig.prevWingPosition + (rig.wingPosition - rig.prevWingPosition) * t, tau = wing * Math.PI * 2;
  const g = (i) => rig.getSegmentProperties(i, t), s6 = g(6), s5 = g(5), s10 = g(10);
  const d15 = fw91(s5[0] - s10[0]), d16 = fw91(s5[0] + d15 / 2);
  o['jaw.rx'] = (S91(tau) + 1) * 0.2;
  let x = 0, y = 20, z = -12;
  for (let i = 0; i < 5; i++) {
    const s = g(5 - i), ry = fw91(s[0] - s6[0]) * D2R91 * 1.5, rx = COS91(i * 0.45 + tau) * 0.15 + rig.getChangeInNeckPitch(i, s6, s) * D2R91 * 1.5 * 5;
    Object.assign(o, { [`neck${i}.rx`]: rx, [`neck${i}.ry`]: ry, [`neck${i}.rz`]: -fw91(s[0] - d16) * D2R91 * 1.5, [`neck${i}.x`]: x, [`neck${i}.y`]: y, [`neck${i}.z`]: z });
    y += S91(rx) * 10; z -= COS91(ry) * COS91(rx) * 10; x -= S91(ry) * COS91(rx) * 10;
  }
  const h = g(0);
  Object.assign(o, { 'head.ry': fw91(h[0] - s6[0]) * D2R91, 'head.rx': fw91(rig.getChangeInNeckPitch(6, s6, h)) * D2R91 * 1.5 * 5, 'head.rz': -fw91(h[0] - d16) * D2R91, 'head.x': x, 'head.y': y, 'head.z': z });
  x = 0; y = 10; z = 60; const s11 = g(11); let tp = 0;
  for (let i = 0; i < 12; i++) {
    const s = g(12 + i); tp += S91(i * 0.45 + tau) * 0.05;
    const ry = (fw91(s[0] - s11[0]) * 1.5 + 180) * D2R91, rx = tp + (s[1] - s11[1]) * D2R91 * 1.5 * 5, k = 5 + i;
    Object.assign(o, { [`neck${k}.rx`]: rx, [`neck${k}.ry`]: ry, [`neck${k}.rz`]: fw91(s[0] - d16) * D2R91 * 1.5, [`neck${k}.x`]: x, [`neck${k}.y`]: y, [`neck${k}.z`]: z });
    y += S91(rx) * 10; z -= COS91(ry) * COS91(rx) * 10; x -= S91(ry) * COS91(rx) * 10;
  }
  const b = (S91(tau - 1) + 1), bp = (b * b + b * 2) * 0.05;
  const wp = 0.125 - COS91(tau) * 0.2, wr = -(S91(tau) + 0.125) * 0.8, tr = (S91(tau + 2) + 0.5) * 0.75;
  Object.assign(o, { 'left_wing.rx': wp, 'left_wing.ry': -0.25, 'left_wing.rz': wr, 'left_wing_tip.rz': tr,
    'right_wing.rx': wp, 'right_wing.ry': 0.25, 'right_wing.rz': -wr, 'right_wing_tip.rz': -tr });
  for (const [n, [base, k]] of Object.entries({ left_front_leg: [1.3, 1], left_front_leg_tip: [-0.5, -1], left_front_foot: [0.75, 1], left_hind_leg: [1, 1], left_hind_leg_tip: [0.5, 1], left_hind_foot: [0.75, 1] }))
    for (const side of ['left', 'right']) o[`${side}${n.slice(4)}.rx`] = base + k * bp * 0.1;
  return o;
};
const REST91 = { px: 3.25, py: -1.5, pz: 7.75, rx: 0.1, ry: -0.2, rz: 0.3, tu: 0 };
// engine side: one flat map keyed like the oracle ('<part>.<field>'); pivots are rest + delta so a missing delta shows as a miss.
const eng91 = (kind, part, key, ls, ctx, yaw, pitch) => {
  const d = ER.setupAnimDelta(part, ls, 0, yaw || 0, pitch || 0, false, kind, ctx);
  return d ? d : null;
};
const OWN7791 = {
  ghast: { states: AGES91.map((age) => ({ age })), oracle: ghastO91, run(st, o) { const r = {}; for (let i = 0; i < 9; i++) { const d = eng91('ghast', `tentacle${i}`, 0, 0, { ageInTicks: st.age, rest: { ...REST91, rx: 0 } }); r[`tentacle${i}.rx`] = d ? d.rx : NaN; } return r; } },
  blaze: { states: AGES91.flatMap((age) => [[-90, 0], [31, 45], [17, -90]].map(([yaw, pitch]) => ({ age, yaw, pitch }))), oracle: blazeO91, run(st) {
    const r = {}; for (let i = 0; i < 12; i++) { const d = eng91('blaze', `part${i}`, 0, 0, { ageInTicks: st.age, rest: { ...REST91 } }) || {};
      r[`part${i}.x`] = REST91.px + d.dpx; r[`part${i}.y`] = REST91.py + d.dpy; r[`part${i}.z`] = REST91.pz + d.dpz; }
    const h = eng91('blaze', 'head', 0, 0, { ageInTicks: st.age, rest: { rx: 0, ry: 0, rz: 0 } }, st.yaw, st.pitch) || {}; r['head.ry'] = h.ry; r['head.rx'] = h.rx; return r; } },
  wither: { states: AGES91.flatMap((age) => [[-90, 0, 0, 0], [31, 45, 12, -7]].map(([yaw, pitch, sy, sp]) => ({ age, yaw, pitch, sy: [sy, -sy * 2], sp: [sp, sp + 9] }))), oracle: witherO91, run(st) {
    const r = {}, ctx = (rest) => ({ ageInTicks: st.age, rest, wither: { sideYawRel: st.sy, sidePitch: st.sp } });
    const rb = ER.WITHER_RIBCAGE_REST_RX, TR = ER.WITHER_TAIL_REST;
    r['ribcage.rx'] = rb + eng91('wither', 'ribcage', 0, 0, ctx({}), 0, 0).rx;
    const t = eng91('wither', 'tail', 0, 0, ctx({}), 0, 0); r['tail.rx'] = TR.rx + t.rx; r['tail.y'] = TR.py + t.dpy; r['tail.z'] = TR.pz + t.dpz;
    for (const p of ['center_head', 'right_head', 'left_head']) { const d = eng91('wither', p, 0, 0, ctx({}), st.yaw, st.pitch); r[`${p}.ry`] = d.ry; r[`${p}.rx`] = d.rx; }
    return r; } },
  ender_dragon: { states: [0, 0.3, 0.77].flatMap((t) => [[1, 0.25, 0.2], [5, 3.1, 3.4], [9, 0.9, 0.5]].map(([seed, wp, pwp]) => ({ t, rig: dragRig91(seed, wp, pwp) }))), oracle: dragonO91, run(st) {
    const r = {}, anim = ER.dragonAnim(st.rig, st.t);
    const rel = (part, rest, ctxExtra) => ER.setupAnimDelta(part, 0, 0, 0, 0, false, 'ender_dragon', { ageInTicks: 0, dragon: anim, rest: { ...REST91, ...rest, ...ctxExtra } });
    for (let k = 0; k < 17; k++) { const d = rel('neck', {}, { dgi: k }); r[`neck${k}.rx`] = REST91.rx + d.rx; r[`neck${k}.ry`] = REST91.ry + d.ry; r[`neck${k}.rz`] = REST91.rz + d.rz;
      r[`neck${k}.x`] = REST91.px + d.dpx; r[`neck${k}.y`] = REST91.py + d.dpy; r[`neck${k}.z`] = REST91.pz + d.dpz; }
    const h = rel('head', {}); Object.assign(r, { 'head.rx': REST91.rx + h.rx, 'head.ry': REST91.ry + h.ry, 'head.rz': REST91.rz + h.rz, 'head.x': REST91.px + h.dpx, 'head.y': REST91.py + h.dpy, 'head.z': REST91.pz + h.dpz });
    const R0 = { rx: 0, ry: 0, rz: 0 };
    r['jaw.rx'] = rel('jaw', R0).rx;
    for (const p of ['left_wing', 'right_wing']) { const d = rel(p, R0); r[`${p}.rx`] = d.rx; r[`${p}.ry`] = d.ry; r[`${p}.rz`] = d.rz; }
    for (const p of ['left_wing_tip', 'right_wing_tip']) r[`${p}.rz`] = rel(p, R0).rz;
    for (const side of ['left', 'right']) for (const s of ['front_leg', 'front_leg_tip', 'front_foot', 'hind_leg', 'hind_leg_tip', 'hind_foot']) r[`${side}_${s}.rx`] = rel(`${side}_${s}`, R0).rx;
    return r; } },
};
const ownCompare7791 = (fam, mut) => {
  let worst = 0, at = '';
  for (const st of OWN7791[fam].states) {
    const want = OWN7791[fam].oracle(st), got = OWN7791[fam].run(st), m = mut ? mut(want) : want;
    for (const k of Object.keys(want)) { const d = Math.abs((got[k] === undefined ? NaN : got[k]) - m[k]); const dd = Number.isNaN(d) ? Infinity : d;
      const tol = /\.(x|y|z)$/.test(k) ? 50 : 1;   // pivots are model units (up to ~100): scale the tolerance, keep a relative 5e-7
      if (dd / tol > worst) { worst = dd / tol; at = `${k} ${JSON.stringify({ ...st, rig: undefined })}`; } }
  }
  return { worst, at, fields: Object.keys(OWN7791[fam].oracle(OWN7791[fam].states[0])) };
};
const ownRes7791 = {};
for (const fam of Object.keys(OWN7791)) {
  const r = ownCompare7791(fam); ownRes7791[fam] = r;
  ok(r.worst < TOL, `${fam}: worst deviation ${r.worst.toExponential(2)} at ${r.at}`);
  if (process.argv.includes('--verbose')) console.log(`  ${fam}: worst ${r.worst.toExponential(2)} over ${r.fields.length} fields at ${r.at}`);
  for (const f of r.fields) {   // anti-vacuity: perturb each compared field of the oracle
    const m = ownCompare7791(fam, (o) => ({ ...o, [f]: o[f] + 0.01 }));
    if (m.worst > TOL) breaks++; else ok(false, `break NOT caught: ${fam} ${f} +0.01`);
  }
}

// ---- #7790 models with their own setAngles: parrot, bat, vex, phantom ----
for (const [name, pats] of [
  ['ParrotEntityModel', [/this\.tail\.pitch = 1\.015F \+ MathHelper\.cos\(\$\$2 \* 0\.6662F\) \* 0\.3F \* \$\$3/, /float \$\$9 = \$\$4 \* 0\.3F/, /this\.leftWing\.roll = -0\.0873F - \$\$4/, /this\.tail\.pitch = 1\.5388988F/, /this\.head\.roll = MathHelper\.sin\(\(float\)\$\$1\) \* 0\.4F/,
    /this\.feather\.pitch = -0\.2214F/, /this\.body\.pitch = 0\.4937F/, /this\.leftWing\.pitch = -0\.6981F/, /Math\.PI \* 2\.0 \/ 9\.0/, /Math\.PI \/ 9\)/, /this\.head\.pivotY = 15\.69F \+ \$\$8/, /this\.head\.pivotY = 17\.59F/]],
  ['BatEntityModel', [/this\.head\.setPivot\(0\.0F, -2\.0F, 0\.0F\)/, /this\.rightWing\.setPivot\(-3\.0F, 0\.0F, 3\.0F\)/, /\(float\) \(-Math\.PI \/ 20\)/, /\(float\) \(-Math\.PI \* 2\.0 \/ 5\.0\)/, /-1\.7278761F/,
    /\(float\) \(Math\.PI \/ 4\) \+ MathHelper\.cos\(\$\$3 \* 0\.1F\) \* 0\.15F/, /MathHelper\.cos\(\$\$3 \* 74\.48451F \* \(float\) \(Math\.PI \/ 180\.0\)\) \* \(float\) Math\.PI \* 0\.25F/]],
  ['VexEntityModel', [/\(float\) \(Math\.PI \* 3\.0 \/ 2\.0\)/, /3\.7699115F/, /\(float\) \(Math\.PI \/ 5\)/, /0\.47123894F \+ MathHelper\.cos\(\$\$3 \* 45\.836624F \* \(float\) \(Math\.PI \/ 180\.0\)\) \* \(float\) Math\.PI \* 0\.05F/, /rightWing\.pivotZ = 2\.0F/, /rightWing\.pivotY = 1\.0F/]],
  ['PhantomEntityModel', [/\* 7\.448451F \* \(float\) \(Math\.PI \/ 180\.0\)/, /MathHelper\.cos\(\$\$6\) \* 16\.0F \* \(float\) \(Math\.PI \/ 180\.0\)/, /-\(5\.0F \+ MathHelper\.cos\(\$\$6 \* 2\.0F\) \* 5\.0F\) \* \(float\) \(Math\.PI \/ 180\.0\)/]]]) {
  const s = src(name);
  for (const p of pats) ok(p.test(s), `${name}: the decomp no longer contains ${p} — the oracle below is stale`);
}
const DEG = f32(Math.PI / 180), AGES = [0, 1.3, 7, 20.5, 100], FLAPS = [0, 0.4, 1.1], IDS = [0, 5, 77];
const CALL = (part, ls, amt, yaw, pitch, kind, ctx) => ER.setupAnimDelta(part, ls, amt, yaw, pitch, false, kind, ctx) || {};
const gridFail = (tag, got, want, ctx) => { const d = Math.abs((got || 0) - want); return d > TOL ? { d, at: `${tag} ${ctx}` } : null; };
/** each family: oracle(...) -> { 'part.field': value }; `engine(...)` -> same keys; returns worst deviation */
function sweep(oracle, engine, mut) {
  let worst = 0, at = '';
  for (const c of cases) {
    const o = oracle(c), g = engine(c);
    if (mut) mut(o);
    for (const k of Object.keys(o)) { const d = Math.abs((g[k] || 0) - o[k]); if (!(d <= worst)) { worst = d; at = `${k} ${JSON.stringify(c)}`; } }
  }
  return { worst, at };
}
let cases = [];
// -- phantom
const phRest = { rx: 0.2, ry: 0.1, rz: 0.3 };
cases = []; for (const id of IDS) for (const age of AGES) cases.push({ id, age });
const phOracle = ({ id, age }) => { const t = f32(f32(f32(id * 3 + age) * f32(7.448451)) * DEG), wing = cos(t) * 16 * DEG, tail = -(5 + cos(f32(t * 2)) * 5) * DEG;
  return { 'left_wing_base.rz': wing, 'left_wing_tip.rz': wing, 'right_wing_base.rz': -wing, 'right_wing_tip.rz': -wing, 'tail_base.rx': tail, 'tail_tip.rx': tail }; };
const phEngine = ({ id, age }) => { const o = {}; for (const p of ['left_wing_base', 'left_wing_tip', 'right_wing_base', 'right_wing_tip', 'tail_base', 'tail_tip']) {
  const d = CALL(p, 0, 0, 0, 0, 'phantom', { phantomId: id, ageInTicks: age, rest: phRest }); o[p + (p[0] === 't' ? '.rx' : '.rz')] = (p[0] === 't' ? d.rx + phRest.rx : d.rz + phRest.rz); } return o; };
// -- bat (rest rotations and pivots are 0; the renderer's own translate is the same on head and body, so head pivot is read relative to the body)
cases = []; for (const age of AGES) for (const roost of [false, true]) for (const yaw of YAW) for (const pitch of PITCH) cases.push({ age, roost, yaw, pitch });
const batOracle = ({ age, roost, yaw, pitch }) => { const o = {};
  o['head.rx'] = f32(pitch * DEG); o['head.ry'] = roost ? f32(PI - f32(yaw * DEG)) : f32(yaw * DEG); o['head.rz'] = roost ? PI : 0; o['head.dpy'] = roost ? -2 : 0;
  o['body.rx'] = roost ? PI : f32(Math.PI / 4) + cos(f32(age * f32(0.1))) * 0.15;
  const wy = roost ? f32(-Math.PI * 2 / 5) : cos(f32(f32(age * f32(74.48451)) * DEG)) * PI * 0.25, ty = roost ? -1.7278761 : wy * 0.5;
  o['right_wing.rx'] = o['left_wing.rx'] = roost ? f32(-Math.PI / 20) : 0; o['right_wing.ry'] = wy; o['left_wing.ry'] = -wy;
  o['right_wing_tip.ry'] = ty; o['left_wing_tip.ry'] = -ty;
  o['right_wing.dpx'] = roost ? -3 : 0; o['left_wing.dpx'] = roost ? 3 : 0; o['right_wing.dpz'] = o['left_wing.dpz'] = roost ? 3 : 0; return o; };
const batEngine = ({ age, roost, yaw, pitch }) => { const o = {}, ctx = { bat: { roosting: roost }, ageInTicks: age };
  for (const p of ['head', 'body', 'right_wing', 'left_wing', 'right_wing_tip', 'left_wing_tip']) { const d = CALL(p, 0, 0, yaw, pitch, 'bat', ctx);
    for (const f of ['rx', 'ry', 'rz', 'dpx', 'dpz']) o[p + '.' + f] = d[f] || 0; o[p + '.dpy'] = d.dpy || 0; }
  const bdy = o['body.dpy']; o['head.dpy'] -= bdy; return o; };
// -- vex (BipedEntityModel base + own part; arm/wing rest values are stand-ins, the engine must subtract them)
const vxRest = { px: 0.5, py: 0.25, pz: -0.75, rx: 0.15, ry: -0.2, rz: 0.35 };
cases = []; for (const ls of LS) for (const amt of AMT) for (const age of AGES) for (const ch of [[false, false, false], [true, true, false], [true, false, false], [true, false, true]]) cases.push({ ls, amt, age, ch: ch.join() });
const vxOracle = ({ ls, amt, age, ch }) => { const [chg, empty, left] = ch.split(',').map((x) => x === 'true'), b = biped(ls, amt, 0, 0, false), o = {};
  o['right_leg.rx'] = b.right_leg + f32(Math.PI / 5); o['left_leg.rx'] = b.left_leg;
  const wy = f32(0.47123894 + cos(f32(f32(age * f32(45.836624)) * DEG)) * PI * 0.05);
  o['right_wing.ry'] = wy; o['left_wing.ry'] = -wy; o['right_wing.rx'] = o['left_wing.rx'] = 0.47123894; o['right_wing.rz'] = 0.47123894; o['left_wing.rz'] = -0.47123894;
  o['right_wing.py'] = o['left_wing.py'] = 1; o['right_wing.pz'] = o['left_wing.pz'] = 2;
  if (chg) { if (empty) o['right_arm.rx'] = o['left_arm.rx'] = f32(Math.PI * 3 / 2); else if (!left) o['right_arm.rx'] = 3.7699115; else o['left_arm.rx'] = 3.7699115; }
  return o; };
const vxEngine = ({ ls, amt, age, ch }) => { const [chg, empty, left] = ch.split(',').map((x) => x === 'true'), o = {}, ctx = { vex: { charging: chg, mainEmpty: empty, leftHanded: left }, ageInTicks: age, rest: vxRest };
  for (const p of ['right_leg', 'left_leg']) o[p + '.rx'] = CALL(p, ls, amt, 0, 0, 'humanoid', ctx).rx;
  for (const p of ['right_wing', 'left_wing']) { const d = CALL(p, ls, amt, 0, 0, 'humanoid', ctx); o[p + '.rx'] = d.rx + vxRest.rx; o[p + '.ry'] = d.ry + vxRest.ry; o[p + '.rz'] = d.rz + vxRest.rz; o[p + '.py'] = d.dpy + vxRest.py; o[p + '.pz'] = d.dpz + vxRest.pz; }
  if (chg) for (const p of ['right_arm', 'left_arm']) o[p + '.rx'] = CALL(p, ls, amt, 0, 0, 'humanoid', ctx).rx + vxRest.rx;
  return o; };
// -- parrot (ParrotEntityModel.animateModel + setAngles; rest rotations 0, rest pivots as in the model: head 15.69 body 16.5 tail 21.07 wings 16.94 legs 22, wing px compared as the offset from the +-1.5 rest)
cases = []; for (const ls of LS) for (const amt of AMT) for (const pose of ['standing', 'flying', 'sitting', 'party', 'shoulder']) for (const flap of FLAPS) for (const yaw of [-31, 17]) for (const pitch of [-90, 45]) cases.push({ ls, amt, pose, flap, age: Math.round(ls * 11) + 3, yaw, pitch });
const prOracle = ({ ls, amt, pose, flap, age, yaw, pitch }) => {
  const o = {}, party = pose === 'party', sit = pose === 'sitting'; if (pose === 'shoulder') flap = 0;
  const P = { head: [15.69, 0], body: [16.5, 0], tail: [21.07, 0], left_wing: [16.94, 0], right_wing: [16.94, 0], left_leg: [22, 0], right_leg: [22, 0] };
  const R = { head: [f32(pitch * DEG), f32(yaw * DEG), 0], feather: [-0.2214, 0, 0], body: [0.4937, 0, 0], tail: [0, 0, 0], left_wing: [-0.6981, -PI, 0], right_wing: [-0.6981, -PI, 0], left_leg: [-0.0299, 0, 0], right_leg: [-0.0299, 0, 0] };
  const pivY = { head: 15.69, body: 16.5, tail: 21.07, left_wing: 16.94, right_wing: 16.94, left_leg: 22, right_leg: 22 };
  if (sit) { Object.assign(pivY, { head: 17.59, tail: 22.97, body: 18.4, left_wing: 18.84, right_wing: 18.84, left_leg: 23, right_leg: 23 }); R.tail[0] = 1.5388988; R.left_wing[2] = -0.0873; R.right_wing[2] = 0.0873; R.left_leg[0]++; R.right_leg[0]++; }
  if (party) { R.left_leg[2] = -Math.PI / 9; R.right_leg[2] = Math.PI / 9; }
  if (pose === 'flying') { R.left_leg[0] += f32(Math.PI * 2 / 9); R.right_leg[0] += f32(Math.PI * 2 / 9); }
  if (party) { const c = cos(age), sn = f32(Math.sin(f32(age)));
    R.head[0] = 0; R.head[1] = 0; R.head[2] = sn * 0.4; for (const k of ['head', 'body', 'tail']) P[k][1] = c; P.left_wing[1] = c; P.right_wing[1] = c;
    for (const k of ['head', 'body', 'left_wing', 'right_wing', 'tail']) pivY[k] += sn; R.left_wing[2] = -0.0873 - flap; R.right_wing[2] = 0.0873 + flap; }
  else if (!sit) { const d = flap * 0.3; for (const k of ['head', 'body', 'left_wing', 'right_wing', 'tail', 'left_leg', 'right_leg']) pivY[k] += d;
    R.tail[0] = 1.015 + cos(f32(ls * f32(0.6662))) * 0.3 * amt; R.left_wing[2] = -0.0873 - flap; R.right_wing[2] = 0.0873 + flap;
    if (pose === 'standing') { R.left_leg[0] += cos(f32(ls * f32(0.6662))) * 1.4 * amt; R.right_leg[0] += cos(f32(f32(ls * f32(0.6662)) + PI)) * 1.4 * amt; } }
  for (const k of Object.keys(R)) { o[k + '.rx'] = R[k][0]; o[k + '.ry'] = R[k][1]; o[k + '.rz'] = R[k][2]; }
  for (const k of Object.keys(P)) { o[k + '.py'] = pivY[k]; o[k + '.px'] = P[k][1]; }
  return o; };
const prRestPy = { head: 15.69, body: 16.5, tail: 21.07, left_wing: 16.94, right_wing: 16.94, left_leg: 22, right_leg: 22 };
const prEngine = ({ ls, amt, pose, flap, age, yaw, pitch }) => { const o = {}, ctx = { parrot: { pose, flap: pose === 'shoulder' ? 0 : flap, age }, ageInTicks: age };
  for (const k of ['head', 'feather', 'body', 'tail', 'left_wing', 'right_wing', 'left_leg', 'right_leg']) { const d = CALL(k, ls, amt, yaw, pitch, 'parrot', ctx);
    o[k + '.rx'] = d.rx || 0; o[k + '.ry'] = d.ry || 0; o[k + '.rz'] = d.rz || 0;
    if (k !== 'feather') { o[k + '.py'] = prRestPy[k] + (d.dpy || 0); o[k + '.px'] = d.dpx || 0; } }
  return o; };
const own7790 = {};
{
  const run = (n, oracle, engine, mutKeys) => { cases = ownCases7790[n]; const r = sweep(oracle, engine); own7790[n] = r; ok(r.worst < TOL, `${n}: worst deviation ${r.worst.toExponential(2)} at ${r.at}`);
    if (process.argv.includes('--verbose')) console.log(`  ${n}: worst ${r.worst.toExponential(2)} (tol ${TOL}) at ${r.at || 'n/a'}`);
    for (const k of mutKeys) { cases = ownCases7790[n]; const m = sweep(oracle, engine, (o) => { if (k in o) o[k] += 0.01; }); if (m.worst > TOL) breaks++; else ok(false, `break NOT caught: ${n} ${k} +0.01`); } };
  var ownCases7790 = {};
  ownCases7790.phantom = []; for (const id of IDS) for (const age of AGES) ownCases7790.phantom.push({ id, age });
  ownCases7790.bat = []; for (const age of AGES) for (const roost of [false, true]) for (const yaw of YAW) for (const pitch of PITCH) ownCases7790.bat.push({ age, roost, yaw, pitch });
  ownCases7790.vex = []; for (const ls of LS) for (const amt of AMT) for (const age of AGES) for (const ch of [[false, false, false], [true, true, false], [true, false, false], [true, false, true]]) ownCases7790.vex.push({ ls, amt, age, ch: ch.join() });
  ownCases7790.parrot = []; for (const ls of LS) for (const amt of AMT) for (const pose of ['standing', 'flying', 'sitting', 'party', 'shoulder']) for (const flap of FLAPS) for (const yaw of [-31, 17]) for (const pitch of [-90, 45]) ownCases7790.parrot.push({ ls, amt, pose, flap, age: Math.round(ls * 11) + 3, yaw, pitch });
  run('phantom', phOracle, phEngine, ['left_wing_base.rz', 'left_wing_tip.rz', 'right_wing_base.rz', 'right_wing_tip.rz', 'tail_base.rx', 'tail_tip.rx']);
  run('bat', batOracle, batEngine, ['head.rx', 'head.ry', 'head.rz', 'head.dpy', 'body.rx', 'right_wing.rx', 'left_wing.rx', 'right_wing.ry', 'left_wing.ry', 'right_wing_tip.ry', 'left_wing_tip.ry', 'right_wing.dpx', 'left_wing.dpx', 'right_wing.dpz']);
  run('vex', vxOracle, vxEngine, ['right_leg.rx', 'left_leg.rx', 'right_wing.ry', 'left_wing.ry', 'right_wing.rx', 'right_wing.rz', 'left_wing.rz', 'right_wing.py', 'right_wing.pz', 'right_arm.rx', 'left_arm.rx']);
  run('parrot', prOracle, prEngine, ['head.rx', 'head.ry', 'head.rz', 'feather.rx', 'body.rx', 'tail.rx', 'left_wing.rx', 'left_wing.ry', 'left_wing.rz', 'right_wing.rz', 'left_leg.rx', 'right_leg.rx', 'left_leg.rz', 'right_leg.rz', 'head.py', 'body.py', 'tail.py', 'left_wing.py', 'left_leg.py', 'head.px', 'body.px', 'tail.px', 'left_wing.px', 'right_wing.px']);
}
const OWN7790 = new Set(['parrot', 'bat', 'vex', 'phantom']);
const hcaught = (m, mut) => { const r = compareHorse(mut); if (r.worst > TOL) breaks++; else ok(false, 'break NOT caught: ' + m); };
for (const [p, f] of [['head_parts', 'rx'], ['head_parts', 'ry'], ['head_parts', 'dpy'], ['head_parts', 'dpz'], ['body', 'rx'], ['left_front_leg', 'rx'], ['right_front_leg', 'rx'], ['left_front_leg', 'dpy'], ['left_front_leg', 'dpz'],
  ['left_hind_leg', 'rx'], ['right_hind_leg', 'rx'], ['tail', 'rx'], ['tail', 'ry'], ['tail', 'dpy'], ['tail', 'dpz']])
  hcaught(`horse ${p}.${f} +0.01`, (o) => ({ ...o, [p]: { ...o[p], [f]: (o[p][f] || 0) + 0.01 } }));
const OWN7787 = new Set(['dolphin', 'squid', 'glow_squid', 'guardian', 'elder_guardian']);
{
// ---- #7787 dolphin / squid / guardian: models with their own setAngles, literals re-read from the decomp ----
const D = src('DolphinEntityModel'), S = src('SquidEntityModel'), G = src('GuardianEntityModel');
const farr = (n) => { const m = new RegExp(n + ' = new float\\[\\]\\{([^}]*)\\}').exec(G); return m ? m[1].split(',').map((x) => f32(parseFloat(x))) : []; };
const SPX = farr('SPIKE_PIVOTS_X'), SPY = farr('SPIKE_PIVOTS_Y'), SPZ = farr('SPIKE_PIVOTS_Z');
for (const [name, s, pats] of [
  ['DolphinEntityModel', D, [/body\.pitch = \$\$5 \* \(float\) \(Math\.PI \/ 180\.0\)/, /body\.yaw = \$\$4 \* \(float\) \(Math\.PI \/ 180\.0\)/, /\(-0\.05F - 0\.05F \* MathHelper\.cos\(\$\$3 \* 0\.3F\)\)/, /tail\.pitch = -0\.1F \* MathHelper\.cos\(\$\$3 \* 0\.3F\)/, /tailFin\.pitch = -0\.2F \* MathHelper\.cos\(\$\$3 \* 0\.3F\)/]],
  ['SquidEntityModel', S, [/\$\$6\.pitch = \$\$3;/]],
  ['GuardianEntityModel', G, [/head\.yaw = \$\$4 \* \(float\) \(Math\.PI \/ 180\.0\)/, /head\.pitch = \$\$5 \* \(float\) \(Math\.PI \/ 180\.0\)/, /1\.0F \+ MathHelper\.cos\(\$\$1 \* 1\.5F \+ \(float\)\$\$0\) \* 0\.01F - \$\$2/, /16\.0F \+ SPIKE_PIVOTS_Y\[\$\$0\]/, /\(1\.0F - \$\$0\.getSpikesExtension\(\$\$6\)\) \* 0\.55F/, /sin\(\$\$15\) \* \(float\) Math\.PI \* 0\.05F/, /sin\(\$\$15\) \* \(float\) Math\.PI \* 0\.1F;/, /sin\(\$\$15\) \* \(float\) Math\.PI \* 0\.15F/]]])
  for (const p of pats) ok(p.test(s), `${name}: the decomp no longer contains ${p} — the oracle below is stale`);
ok(SPX.length === 12 && SPY.length === 12 && SPZ.length === 12, 'GuardianEntityModel spike pivot tables not parsed');
const AGE = [0, 3.25, 17.5, 100.75], MOVING = [false, true], EXT = [0, 0.3, 1], TAIL = [-3, 0, 0.7, 5];
const dolphinO = (age, moving, yaw, pitch) => { const c = f32(Math.cos(f32(age * f32(0.3))));
  return { body: { rx: f32(pitch * f32(Math.PI / 180)) + (moving ? f32(-0.05 - f32(0.05 * c)) : 0), ry: f32(yaw * f32(Math.PI / 180)) },
    tail: moving ? f32(-0.1 * c) : 0, tail_fin: moving ? f32(-0.2 * c) : 0 }; };
const guardAng = (i, age, k) => f32(1 + f32(f32(Math.cos(f32(age * 1.5 + i))) * 0.01) - k);
const pivO = (i, age, k) => [f32(SPX[i] * guardAng(i, age, k)), f32(16 + f32(SPY[i] * guardAng(i, age, k))), f32(SPZ[i] * guardAng(i, age, k))];
const run = (mut) => {
  let worst = 0, at = '';
  const put = (n, got, want, ctx) => { const d = Math.abs(got - want); if (d > worst) { worst = d; at = `${n} ${ctx}`; } };
  for (const age of AGE) for (const mv of MOVING) for (const yaw of YAW) for (const pitch of PITCH) {
    const o = mut.d(dolphinO(age, mv, yaw, pitch)), ctx = `age=${age} moving=${mv} yaw=${yaw} pitch=${pitch}`;
    const dc = { ageInTicks: age, dolphin: { moving: mv }, rest: { rx: -0.10471976 } };
    const b = ER.setupAnimDelta('body', 0, 0, yaw, pitch, false, 'dolphin', dc); put('dolphin.body.rx', b.rx, o.body.rx, ctx); put('dolphin.body.ry', b.ry, o.body.ry, ctx);
    put('dolphin.tail.rx', ER.setupAnimDelta('tail', 0, 0, yaw, pitch, false, 'dolphin', dc).rx + -0.10471976 * (mv ? 1 : 0), o.tail + (mv ? 0 : 0), ctx);
    put('dolphin.tail_fin.rx', ER.setupAnimDelta('tail_fin', 0, 0, yaw, pitch, false, 'dolphin', { ...dc, rest: { rx: 0 } }).rx, o.tail_fin, ctx);
  }
  for (const ang of [0, 0.4, 1.7, 3.1]) for (let t = 0; t < 8; t++) {
    const want = mut.s(ang), d = ER.setupAnimDelta('tentacle' + t, 0, 0, 0, 0, false, 'squid', { squid: { tentacle: ang }, rest: { rx: 0 } });
    put('squid.tentacle.rx', d.rx, want, `angle=${ang} #${t}`);
  }
  for (const age of AGE) for (const ext of EXT) for (const tail of TAIL) for (const yaw of YAW) {
    const k = f32(f32(1 - ext) * f32(0.55)), ctx = `age=${age} ext=${ext} tail=${tail} yaw=${yaw}`, gc = { ageInTicks: age, guardian: { age, spikeK: k, tail, eyeX: 0, eyeY: 0 } };
    for (let i = 0; i < 12; i++) {
      const rp = pivO(i, 0, 0), [px, py, pz] = mut.g(pivO(i, age, k)), d = ER.setupAnimDelta('spike' + i, 0, 0, yaw, 0, false, 'guardian', { ...gc, rest: { px: rp[0], py: rp[1], pz: rp[2] } });
      put(`guardian.spike${i}.x`, rp[0] + d.dpx, px, ctx); put(`guardian.spike${i}.y`, rp[1] + d.dpy, py, ctx); put(`guardian.spike${i}.z`, rp[2] + d.dpz, pz, ctx);
    }
    [0.05, 0.1, 0.15].forEach((m, j) => put(`guardian.tail${j}.ry`, ER.setupAnimDelta('tail' + j, 0, 0, 0, 0, false, 'guardian', gc).ry, mut.t(f32(f32(f32(Math.sin(f32(tail))) * PI) * f32(m))), ctx));
    const h = ER.setupAnimDelta('head', 0, 0, yaw, 30, false, 'guardian', gc); put('guardian.head.ry', h.ry, mut.h(f32(yaw * f32(Math.PI / 180))), ctx); put('guardian.head.rx', h.rx, f32(30 * f32(Math.PI / 180)), ctx);
    for (const [ex, ey] of [[0, 0], [1.2, 1], [-1.9, 0]]) { const e = ER.setupAnimDelta('eye', 0, 0, yaw, 0, false, 'elder_guardian', { ...gc, guardian: { ...gc.guardian, eyeX: ex, eyeY: ey } }); put('elder_guardian.eye.x', e.dpx, ex, ctx); put('elder_guardian.eye.y', e.dpy, ey, ctx); }
    for (let i = 0; i < 12; i++) { const a = ER.setupAnimDelta('spike' + i, 0, 0, yaw, 0, false, 'elder_guardian', { ...gc, rest: { px: pivO(i, 0, 0)[0], py: pivO(i, 0, 0)[1], pz: pivO(i, 0, 0)[2] } }), q = pivO(i, 0, 0); put(`elder_guardian.spike${i}.y`, q[1] + a.dpy, mut.g(pivO(i, age, k))[1], ctx); }
    for (let j = 0; j < 3; j++) put(`elder_guardian.tail${j}.ry`, ER.setupAnimDelta('tail' + j, 0, 0, 0, 0, false, 'elder_guardian', gc).ry, mut.t(f32(f32(f32(Math.sin(f32(tail))) * PI) * f32([0.05, 0.1, 0.15][j]))), ctx);
  }
  return { worst, at };
};
const id = (x) => x, NOM = { d: id, s: id, g: id, t: id, h: id };
const own = run(NOM); ok(own.worst < TOL, `dolphin/squid/guardian: worst deviation ${own.worst.toExponential(2)} at ${own.at}`);
if (process.argv.includes('--verbose')) console.log(`  dolphin/squid/guardian: worst ${own.worst.toExponential(2)} at ${own.at || 'n/a'}`);
const caughtO = (m, mut) => { const r = run({ ...NOM, ...mut }); if (r.worst > TOL) breaks++; else ok(false, 'break NOT caught: ' + m); };
caughtO('dolphin body pitch +0.01', { d: (o) => ({ ...o, body: { ...o.body, rx: o.body.rx + 0.01 } }) });
caughtO('dolphin body yaw +0.01', { d: (o) => ({ ...o, body: { ...o.body, ry: o.body.ry + 0.01 } }) });
caughtO('dolphin tail pitch +0.01', { d: (o) => ({ ...o, tail: o.tail + 0.01 }) });
caughtO('dolphin tail_fin pitch +0.01', { d: (o) => ({ ...o, tail_fin: o.tail_fin + 0.01 }) });
caughtO('squid tentacle angle +0.01', { s: (a) => a + 0.01 });
caughtO('guardian spike pivot x +0.01', { g: (p) => [p[0] + 0.01, p[1], p[2]] });
caughtO('guardian spike pivot y +0.01', { g: (p) => [p[0], p[1] + 0.01, p[2]] });
caughtO('guardian spike pivot z +0.01', { g: (p) => [p[0], p[1], p[2] + 0.01] });
caughtO('guardian tail yaw +0.01', { t: (v) => v + 0.01 });
caughtO('guardian head yaw +0.01', { h: (v) => v + 0.01 });
}
// ---- fish family: own setAngles, read from the decomp literals every run (args: $$3 = ageInTicks, isTouchingWater) ----
const FSRC = Object.fromEntries(['Cod', 'Salmon', 'LargePufferfish', 'MediumPufferfish', 'SmallPufferfish', 'SmallTropicalFish', 'LargeTropicalFish'].map((n) => [n, src(n + 'EntityModel')]));
for (const [n, pats] of [['Cod', [/\$\$6 = 1\.5F/, /-\$\$6 \* 0\.45F \* MathHelper\.sin\(0\.6F \* \$\$3\)/]],
  ['SmallTropicalFish', [/\$\$6 = 1\.5F/, /-\$\$6 \* 0\.45F \* MathHelper\.sin\(0\.6F \* \$\$3\)/]], ['LargeTropicalFish', [/\$\$6 = 1\.5F/, /-\$\$6 \* 0\.45F \* MathHelper\.sin\(0\.6F \* \$\$3\)/]],
  ['Salmon', [/\$\$6 = 1\.3F/, /\$\$7 = 1\.7F/, /-\$\$6 \* 0\.25F \* MathHelper\.sin\(\$\$7 \* 0\.6F \* \$\$3\)/]],
  ...['Large', 'Medium', 'Small'].map((z) => [z + 'Pufferfish', [/roll = -0\.2F \+ 0\.4F \* MathHelper\.sin\(\$\$3 \* 0\.2F\)/, /roll = 0\.2F - 0\.4F \* MathHelper\.sin\(\$\$3 \* 0\.2F\)/]])])
  for (const q of pats) ok(q.test(FSRC[n]), `${n}EntityModel: the decomp no longer contains ${q} — the fish oracle is stale`);
const fsin = (x) => Math.sin(f32(x));
const AGE = [0, 0.37, 1, 5, 13.7, 100, 300.5];
const fishOr = {
  cod: (age, w) => ({ tail_fin: { ry: f32(-(w ? 1 : 1.5) * f32(0.45) * fsin(f32(0.6) * age)) } }),
  tropical: (age, w) => ({ tail: { ry: f32(-(w ? 1 : 1.5) * f32(0.45) * fsin(f32(0.6) * age)) } }),
  salmon: (age, w) => ({ back_fin: { ry: f32(-(w ? 1 : 1.3) * f32(0.25) * fsin(f32(f32(w ? 1 : 1.7) * f32(0.6)) * age)) } }),
  puffer: (age) => ({ right_blue_fin: { rz: f32(-0.2 + f32(0.4) * fsin(age * f32(0.2))) }, left_blue_fin: { rz: f32(0.2 - f32(0.4) * fsin(age * f32(0.2))) },
    right_fin: { rz: f32(-0.2 + f32(0.4) * fsin(age * f32(0.2))) }, left_fin: { rz: f32(0.2 - f32(0.4) * fsin(age * f32(0.2))) } }) };
const fishRest = { back_fin: { w: 0, h: 5 }, right_fin: { pz: -1.5 }, left_fin: { pz: -1.5 } };
function fishCompare(fn, mut) {
  let worst = 0, at = '';
  for (const age of AGE) for (const water of [true, false]) {
    const o = (mut || ((x) => x))(fn(age, water));
    for (const [part, want] of Object.entries(o)) {
      const d = ER.setupAnimDelta(part, 3, 0.5, 20, 10, false, 'quadruped', { fish: { water, puffer: false }, ageInTicks: age, rest: fishRest[part] || {} }) || { ry: 0, rz: 0 };
      for (const ax of ['ry', 'rz']) if (ax in want) { const e = Math.abs((d[ax] || 0) - want[ax]); if (e > worst) { worst = e; at = `${part}.${ax} age=${age} water=${water}`; } }
    }
  }
  return { worst, at };
}
// ---- #7785 rabbit + bee: models with their own setAngles, literals re-read from the decomp ----
const RB = src('RabbitEntityModel'), BE = src('BeeEntityModel');
for (const [name, s, pats] of [
  ['RabbitEntityModel', RB, [/this\.rightEar\.yaw = this\.nose\.yaw - \(float\) \(Math\.PI \/ 12\)/, /this\.leftEar\.yaw = this\.nose\.yaw \+ \(float\) \(Math\.PI \/ 12\)/,
    /leftHaunch\.pitch = \(this\.jumpProgress \* 50\.0F - 21\.0F\)/, /leftHindLeg\.pitch = this\.jumpProgress \* 50\.0F \*/, /leftFrontLeg\.pitch = \(this\.jumpProgress \* -40\.0F - 11\.0F\)/]],
  ['BeeEntityModel', BE, [/rightWing\.yaw = -0\.2618F/, /leftWing\.yaw = 0\.2618F/, /\$\$3 \* 120\.32113F/, /\(float\) Math\.PI \* 0\.15F/, /0\.1F \+ \$\$8 \* \(float\) Math\.PI \* 0\.025F/,
    /\$\$8 \* \(float\) Math\.PI \* 0\.03F/, /-\$\$8 \* \(float\) Math\.PI \* 0\.1F \+ \(float\) \(Math\.PI \/ 8\)/, /-\$\$8 \* \(float\) Math\.PI \* 0\.05F \+ \(float\) \(Math\.PI \/ 4\)/,
    /19\.0F - MathHelper\.cos\(\$\$3 \* 0\.18F\) \* 0\.9F/, /interpolateAngle\(this\.bone\.pitch, 3\.0915928F, this\.bodyPitch\)/]]])
  for (const p of pats) ok(p.test(s), `${name}: the decomp no longer contains ${p} — the oracle below is stale`);
const D2R = f32(Math.PI / 180);
const JUMP = [0, 0.1, 0.5, 0.83, 1], RREST = 0.3;
const rabbit = (jump, yaw, pitch) => {
  const jp = f32(Math.sin(f32(jump * PI))), P = f32(pitch * D2R), Y = f32(yaw * D2R), ear = f32(PI / 12);
  return { head: [P, Y], nose: [P, Y], right_ear: [P, f32(Y - ear)], left_ear: [P, f32(Y + ear)],
    left_haunch: [f32(f32(jp * 50 - 21) * D2R), undefined], right_haunch: [f32(f32(jp * 50 - 21) * D2R), undefined],
    left_hind_foot: [f32(f32(jp * 50) * D2R), undefined], right_hind_foot: [f32(f32(jp * 50) * D2R), undefined],
    left_front_leg: [f32(f32(jp * -40 - 11) * D2R), undefined], right_front_leg: [f32(f32(jp * -40 - 11) * D2R), undefined] };
};
const wrapA = (d) => { while (d < -PI) d += 2 * PI; while (d >= PI) d -= 2 * PI; return d; };
const bee = (age, still, angry, bp) => {
  const c = cos(f32(age * f32(0.18))), w = cos(f32(f32(age * f32(120.32113)) * D2R)) * PI * 0.15;
  const o = { right_wing: [0, still ? -0.2618 : 0, still ? 0 : w], left_wing: [0, still ? 0.2618 : 0, still ? 0 : -w],
    front_legs: [still ? 0 : angry ? PI / 4 : -c * PI * 0.1 + PI / 8], middle_legs: [still ? 0 : PI / 4], back_legs: [still ? 0 : angry ? PI / 4 : -c * PI * 0.05 + PI / 4],
    left_antenna: [!angry && !still ? c * PI * 0.03 : 0], right_antenna: [!angry && !still ? c * PI * 0.03 : 0], bone: [0] };
  let b = 0, py = 0;
  if (!angry && !still) { b = 0.1 + c * PI * 0.025; py = -c * 0.9; }
  if (bp > 0) b += wrapA(3.0915928 - b) * Math.min(1, Math.max(0, bp));
  o.bone = [b, undefined, undefined, py];
  return o;
};
const cmpMulti = (mut) => {
  let worst = 0, at = '';
  const put = (n, g, w, c) => { const d = Math.abs((g || 0) - w); if (d > worst) { worst = d; at = `${n} ${c}`; } };
  for (const j of JUMP) for (const yaw of YAW) for (const pitch of PITCH) {
    const o = rabbit(j, yaw, pitch); if (mut) mut.r?.(o);
    for (const [part, [rx, ry = 0.1]] of Object.entries(o)) {
      const d = ER.setupAnimDelta(part, 0, 0, yaw, pitch, false, 'rabbit', { rabbit: { jump: j }, rest: { rx: RREST, ry: 0.1 } }) || { rx: 0, ry: 0 };
      put('rabbit.' + part + '.rx', d.rx + RREST, rx, `jump=${j} yaw=${yaw} pitch=${pitch}`); put('rabbit.' + part + '.ry', d.ry + 0.1, ry, `jump=${j} yaw=${yaw} pitch=${pitch}`);
    }
  }
  for (const age of [0, 1.5, 7, 20.25, 100.7]) for (const still of [false, true]) for (const angry of [false, true]) for (const bp of [0, 0.4, 1]) {
    const o = bee(age, still, angry, bp); if (mut) mut.b?.(o);
    for (const [part, [rx, ry = 0.1, rz = -0.2, py = 0]] of Object.entries(o)) {   // unassigned angles stay at the rest pose
      const d = ER.setupAnimDelta(part, 0, 0, 0, 0, false, 'bee', { bee: { still, angry, bodyPitch: bp }, ageInTicks: age, rest: { rx: RREST, ry: 0.1, rz: -0.2 } }) || {};
      const c = `age=${age} still=${still} angry=${angry} bp=${bp}`;
      put('bee.' + part + '.rx', (d.rx || 0) + RREST, rx, c); put('bee.' + part + '.ry', (d.ry || 0) + 0.1, ry, c); put('bee.' + part + '.rz', (d.rz || 0) - 0.2, rz, c);
      if (part === 'bone') put('bee.bone.dpy', d.dpy || 0, py, c);
    }
  }
  return { worst, at };
};
const own = cmpMulti();
ok(own.worst < TOL, `rabbit/bee: worst deviation ${own.worst.toExponential(2)} at ${own.at}`);
if (process.argv.includes('--verbose')) console.log(`  rabbit+bee: worst ${own.worst.toExponential(2)} at ${own.at || 'n/a'}`);
const caughtM = (m, mut) => { if (cmpMulti(mut).worst > TOL) breaks++; else ok(false, 'break NOT caught: ' + m); };
for (const part of Object.keys(rabbit(0, 0, 0))) for (const i of [0, 1]) { if (i === 1 && !/^(head|nose|right_ear|left_ear)$/.test(part)) continue; caughtM(`rabbit ${part}[${i}] +0.01`, { r: (o) => { o[part][i] += 0.01; } }); }
for (const part of Object.keys(bee(0, false, false, 0))) for (const i of [0, 1, 2]) {
  caughtM(`bee ${part}[${i}] +0.01`, { b: (o) => { o[part][i] = (o[part][i] || 0) + 0.01; } });
}
caughtM('bee bone dpy +0.01', { b: (o) => { o.bone[3] += 0.01; } });
// ---- #7784 the three models with their own setAngles: fox, panda, polar bear ----
const FX = src('FoxEntityModel'), PD = src('PandaEntityModel'), PB = src('PolarBearEntityModel'), MU = existsSync(new URL('../.decomp/net/minecraft/client/model/ModelUtil.java', import.meta.url)) ? readFileSync(new URL('../.decomp/net/minecraft/client/model/ModelUtil.java', import.meta.url), 'utf8') : '';
for (const [name, s, pats] of [
  ['FoxEntityModel', FX, [/1\.6755161F/, /0\.4662F/, /-0\.05235988F/, /this\.head\.setPivot\(1\.0F, 19\.49F, -3\.0F\)/, /-2\.1816616F/, /MathHelper\.cos\(\$\$3 \* 0\.027F\) \/ 22\.0F/, /MathHelper\.cos\(\$\$3\) \* 0\.01F/, /legPitchModifier \+= 0\.67F/,
    /setPivot\(-5\.0F, 21\.5F, 6\.75F\)/, /setPivot\(-1\.0F, 13\.0F, -3\.75F\)/, /setPivot\(-1\.0F, 10\.0F, -0\.25F\)/, /setPivot\(0\.0F, 9\.0F, -3\.0F\)/, /setPivot\(-4\.0F, 15\.0F, -2\.0F\)/, /this\.body\.setPivot\(0\.0F, 21\.0F, -2\.0F\)/]],
  ['PandaEntityModel', PD, [/1\.7407963F/, /2\.0561945F/, /2\.1707964F/, /0\.27079642F/, /0\.5707964F/, /0\.35F \* MathHelper\.sin\(0\.6F \* \$\$3\)/, /-0\.75F \* MathHelper\.sin\(0\.3F \* \$\$3\)/, /0\.6F \* MathHelper\.sin\(\$\$3 \* 0\.15F\)/, /0\.3F \* MathHelper\.sin\(\$\$3 \* 0\.25F\)/, /0\.5F \* MathHelper\.sin\(\$\$3 \* 0\.5F\)/, /\(\$\$8 - 15\) \/ 5/]],
  ['PolarBearEntityModel', PB, [/9\.0F \* \$\$8 \+ 11\.0F \* \$\$7/, /14\.0F \* \$\$8 - 6\.0F \* \$\$7/, /-8\.0F \* \$\$8 - 4\.0F \* \$\$7/, /\$\$7 \* \(float\) Math\.PI \* 0\.35F/, /\$\$7 \* \(float\) Math\.PI \* 0\.45F/, /\$\$7 \* \(float\) Math\.PI \* 0\.15F/,
    /10\.0F \* \$\$8 - 9\.0F \* \$\$7/, /-16\.0F \* \$\$8 - 7\.0F \* \$\$7/, /10\.0F \* \$\$8 - 14\.0F \* \$\$7/, /-16\.0F \* \$\$8 - 3\.0F \* \$\$7/]],
  ['ModelUtil', MU, [/\(float\) -Math\.PI/, /\(float\) \(Math\.PI \* 2\)/]]])
  for (const p of pats) ok(p.test(s), `${name}: the decomp no longer contains ${p} — the oracle below is stale`);
const PIf = PI, HALF = f32(Math.PI / 2);
const lerpAng = (a, b, t) => { let d = f32(b - a); while (d < -PIf) d = f32(d + f32(Math.PI * 2)); while (d >= PIf) d = f32(d - f32(Math.PI * 2)); return f32(f32(a) + f32(f32(t) * d)); };
const S = (x) => Math.sin(f32(x)), C = (x) => Math.cos(f32(x));
const mk = (rx, ry, rz, px, py, pz) => ({ rx, ry, rz, px, py, pz });
const P0 = (r) => ({ ...r });

// FoxEntityModel.method_18330 (animateModel) then method_18332 (setAngles). Rests = the ModelTransforms in getTexturedModelData.
const FOXREST = { head: mk(0, 0, 0, -1, 16.5, -3), body: mk(HALF, 0, 0, 0, 16, -6), tail: mk(-0.05235988, 0, 0, -4, 15, -1),
  right_hind_leg: mk(0, 0, 0, -5, 17.5, 7), left_hind_leg: mk(0, 0, 0, -1, 17.5, 7), right_front_leg: mk(0, 0, 0, -5, 17.5, 0), left_front_leg: mk(0, 0, 0, -1, 17.5, 0) };
function foxOracle(ls, amt, yaw, pitch, st) {
  const m = {}; for (const k in FOXREST) m[k] = P0(FOXREST[k]);
  const swing = (a) => { m.right_hind_leg.rx = C(f32(ls * f32(0.6662))) * 1.4 * a; m.left_hind_leg.rx = C(f32(f32(ls * f32(0.6662)) + PI)) * 1.4 * a;
    m.right_front_leg.rx = C(f32(f32(ls * f32(0.6662)) + PI)) * 1.4 * a; m.left_front_leg.rx = C(f32(ls * f32(0.6662))) * 1.4 * a; };
  m.body.rx = HALF; m.tail.rx = -0.05235988; swing(amt);
  m.head.px = -1; m.head.py = 16.5; m.head.pz = -3; m.head.ry = 0; m.head.rz = st.headRoll;
  m.body.px = 0; m.body.py = 16; m.body.pz = -6; m.body.rz = 0;
  m.right_hind_leg.px = -5; m.right_hind_leg.py = 17.5; m.right_hind_leg.pz = 7; m.left_hind_leg.px = -1; m.left_hind_leg.py = 17.5; m.left_hind_leg.pz = 7;
  if (st.sneaking) { m.body.rx = 1.6755161; m.body.py = 16 + st.bodyOff; m.body.pz = -6; m.head.py = 16.5 + st.bodyOff; m.head.ry = 0; }
  else if (st.sleeping) {
    m.body.rz = -HALF; m.body.py = 21; m.body.pz = -6; m.tail.rx = f32(-Math.PI * 5 / 6);
    if (st.baby) { m.tail.rx = -2.1816616; m.body.pz = -2; }
    m.head.px = 1; m.head.py = 19.49; m.head.pz = -3; m.head.rx = 0; m.head.ry = f32(-Math.PI * 2 / 3); m.head.rz = 0;
  } else if (st.sitting) {
    m.body.rx = f32(Math.PI / 6); m.body.py = 9; m.body.pz = -3; m.tail.rx = f32(Math.PI / 4); m.tail.px = -4; m.tail.py = 15; m.tail.pz = -2;
    m.head.px = -1; m.head.py = 10; m.head.pz = -0.25; m.head.rx = 0; m.head.ry = 0;
    if (st.baby) { m.head.py = 13; m.head.pz = -3.75; }
    m.right_hind_leg.rx = f32(-Math.PI * 5 / 12); m.right_hind_leg.px = -5; m.right_hind_leg.py = 21.5; m.right_hind_leg.pz = 6.75;
    m.left_hind_leg.rx = f32(-Math.PI * 5 / 12); m.left_hind_leg.px = -1; m.left_hind_leg.py = 21.5; m.left_hind_leg.pz = 6.75;
    m.right_front_leg.rx = f32(-Math.PI / 12); m.left_front_leg.rx = f32(-Math.PI / 12);
  }
  if (!st.sleeping && !st.walking && !st.sneaking) { m.head.rx = f32(pitch * D2R); m.head.ry = f32(yaw * D2R); }
  if (st.sleeping) { m.head.rx = 0; m.head.ry = f32(-Math.PI * 2 / 3); m.head.rz = C(f32(st.age * f32(0.027))) / 22; }
  if (st.sneaking) { const v = C(st.age) * 0.01; m.body.ry = v; m.right_hind_leg.rz = v; m.left_hind_leg.rz = v; m.right_front_leg.rz = v / 2; m.left_front_leg.rz = v / 2; }
  if (st.walking) { const L = f32(st.leg * f32(0.4662));
    m.right_hind_leg.rx = C(L) * 0.1; m.left_hind_leg.rx = C(f32(L + PI)) * 0.1; m.right_front_leg.rx = C(f32(L + PI)) * 0.1; m.left_front_leg.rx = C(L) * 0.1; }
  return m;
}
// PandaEntityModel.setAngles over QuadrupedEntityModel.setAngles; rests = the ModelTransforms.
const PANDAREST = { head: mk(0, 0, 0, 0, 11.5, -17), body: mk(HALF, 0, 0, 0, 10, 0), right_hind_leg: mk(0, 0, 0, -5.5, 15, 9), left_hind_leg: mk(0, 0, 0, 5.5, 15, 9),
  right_front_leg: mk(0, 0, 0, -5.5, 15, -9), left_front_leg: mk(0, 0, 0, 5.5, 15, -9) };
function pandaOracle(ls, amt, yaw, pitch, st) {
  const m = {}; for (const k in PANDAREST) m[k] = P0(PANDAREST[k]);
  const q = quad(ls, amt, yaw, pitch);
  m.head.rx = q.head.rx; m.head.ry = q.head.ry; for (const l of QP.slice(1)) m[l].rx = q[l];
  const t = st.age;
  if (st.ask > 0) { m.head.ry = 0.35 * S(f32(0.6 * t)); m.head.rz = 0.35 * S(f32(0.6 * t)); m.right_front_leg.rx = -0.75 * S(f32(0.3 * t)); m.left_front_leg.rx = 0.75 * S(f32(0.3 * t)); } else m.head.rz = 0;
  if (st.sneezing) { const n = st.sneezeProgress;
    if (n < 15) m.head.rx = f32(f32(-Math.PI / 4) * n / 14);
    else if (n < 20) m.head.rx = f32(-Math.PI / 4) + f32(Math.PI / 4) * Math.trunc((n - 15) / 5); }
  if (st.sit > 0) {
    m.body.rx = lerpAng(m.body.rx, 1.7407963, st.sit); m.head.rx = lerpAng(m.head.rx, HALF, st.sit);
    m.right_front_leg.rz = -0.27079642; m.left_front_leg.rz = 0.27079642; m.right_hind_leg.rz = 0.5707964; m.left_hind_leg.rz = -0.5707964;
    if (st.eating) { m.head.rx = HALF + 0.2 * S(f32(t * f32(0.6))); m.right_front_leg.rx = -0.4 - 0.2 * S(f32(t * f32(0.6))); m.left_front_leg.rx = -0.4 - 0.2 * S(f32(t * f32(0.6))); }
    if (st.thunder) { m.head.rx = 2.1707964; m.right_front_leg.rx = -0.9; m.left_front_leg.rx = -0.9; }
  } else { for (const l of QP.slice(1)) m[l].rz = 0; }
  if (st.lie > 0) {
    m.right_hind_leg.rx = -0.6 * S(f32(t * f32(0.15))); m.left_hind_leg.rx = 0.6 * S(f32(t * f32(0.15)));
    m.right_front_leg.rx = 0.3 * S(f32(t * f32(0.25))); m.left_front_leg.rx = -0.3 * S(f32(t * f32(0.25)));
    m.head.rx = lerpAng(m.head.rx, HALF, st.lie);
  }
  if (st.roll > 0) {
    m.head.rx = lerpAng(m.head.rx, 2.0561945, st.roll);
    m.right_hind_leg.rx = -0.5 * S(f32(t * f32(0.5))); m.left_hind_leg.rx = 0.5 * S(f32(t * f32(0.5)));
    m.right_front_leg.rx = 0.5 * S(f32(t * f32(0.5))); m.left_front_leg.rx = -0.5 * S(f32(t * f32(0.5)));
  }
  return m;
}
// PolarBearEntityModel.setAngles over QuadrupedEntityModel.setAngles. p = warning progress; (p*p) is what the Java squares.
const PBREST = { head: mk(0, 0, 0, 0, 10, -16), body: mk(HALF, 0, 0, 0, 9, 0), right_hind_leg: mk(0, 0, 0, -4.5, 14, 6), left_hind_leg: mk(0, 0, 0, 4.5, 14, 6),
  right_front_leg: mk(0, 0, 0, -3.5, 14, -8), left_front_leg: mk(0, 0, 0, 3.5, 14, -8) };
function polarOracle(ls, amt, yaw, pitch, st) {
  const m = {}; for (const k in PBREST) m[k] = P0(PBREST[k]);
  const q = quad(ls, amt, yaw, pitch);
  m.head.rx = q.head.rx; m.head.ry = q.head.ry; for (const l of QP.slice(1)) m[l].rx = q[l];
  const a = f32(st.w * st.w), b = f32(1 - a);
  m.body.rx = f32(Math.PI / 2) - a * PI * 0.35; m.body.py = 9 * b + 11 * a;
  m.right_front_leg.py = 14 * b - 6 * a; m.right_front_leg.pz = -8 * b - 4 * a; m.right_front_leg.rx -= a * PI * 0.45;
  m.left_front_leg.py = m.right_front_leg.py; m.left_front_leg.pz = m.right_front_leg.pz; m.left_front_leg.rx -= a * PI * 0.45;
  if (st.baby) { m.head.py = 10 * b - 9 * a; m.head.pz = -16 * b - 7 * a; } else { m.head.py = 10 * b - 14 * a; m.head.pz = -16 * b - 3 * a; }
  m.head.rx += a * PI * 0.15;
  return m;
}
/** engine pose (rest + delta; a null delta is "left at rest") against an oracle over a grid of `states` */
function compareOwn(rests, oracleFn, ctxOf, states, mut) {
  let worst = 0, at = '';
  for (const st of states) for (const ls of [0, 1, 7.9]) for (const a of [0, 1]) for (const [yaw, pitch] of [[0, 0], [-31, 45], [90, -90]]) {
    const o = oracleFn(ls, a, yaw, pitch, st), om = mut ? mut(o, st) : o;
    for (const part in rests) {
      const r = rests[part], d = ER.setupAnimDelta(part, ls, a, yaw, pitch, false, 'quadruped', ctxOf(st, r)) || {};
      const got = { rx: r.rx + (d.rx || 0), ry: r.ry + (d.ry || 0), rz: r.rz + (d.rz || 0), px: r.px + (d.dpx || 0), py: r.py + (d.dpy || 0), pz: r.pz + (d.dpz || 0) };
      for (const f in got) { const dd = Math.abs(got[f] - om[part][f]); if (dd > worst) { worst = dd; at = `${part}.${f} ${JSON.stringify(st)} ls=${ls} amt=${a} yaw=${yaw} pitch=${pitch}`; } }
    }
  }
  return { worst, at };
}
const FF = { cod: fishCompare(fishOr.cod), tropical: fishCompare(fishOr.tropical), salmon: fishCompare(fishOr.salmon), puffer: fishCompare(fishOr.puffer) };
for (const [k, r] of Object.entries(FF)) { ok(r.worst < TOL, `fish ${k}: worst deviation ${r.worst.toExponential(2)} at ${r.at}`); if (process.argv.includes('--verbose')) console.log(`  fish ${k}: worst ${r.worst.toExponential(2)} at ${r.at || 'n/a'}`); }
const fcaught = (m, fn, mut) => { const r = fishCompare(fn, mut); if (r.worst > TOL) breaks++; else ok(false, 'break NOT caught: ' + m); };
for (const k of ['cod', 'tropical', 'salmon']) {
  const part = Object.keys(fishOr[k](0, true))[0];
  fcaught(`${k} tail yaw +0.01`, fishOr[k], (o) => ({ [part]: { ry: o[part].ry + 0.01 } }));
  fcaught(`${k} tail yaw sign flipped`, fishOr[k], (o) => ({ [part]: { ry: -o[part].ry } }));
}
fcaught('cod/tropical dry-land factor 1.5 -> 1.0', (a, w) => fishOr.cod(a, true), null);
fcaught('salmon dry-land factor 1.3/1.7 -> in-water', (a, w) => fishOr.salmon(a, true), null);
for (const part of ['right_blue_fin', 'left_blue_fin', 'right_fin', 'left_fin']) fcaught(`puffer ${part} roll +0.01`, fishOr.puffer, (o) => ({ [part]: { rz: o[part].rz + 0.01 } }));

// ---- wolf (#7782): WolfEntityModel.method_17131/method_17133 + WolfEntity.getTailAngle/getBeg/getShakeAnimationProgress ----
const WM = src('WolfEntityModel'), WE = readFileSync(new URL('../.decomp/net/minecraft/entity/passive/WolfEntity.java', import.meta.url), 'utf8');
for (const p of [/tail\.yaw = MathHelper\.cos\(\$\$1 \* 0\.6662F\) \* 1\.4F \* \$\$2/, /neck\.setPivot\(-1\.0F, 16\.0F, -3\.0F\)/, /neck\.pitch = \(float\) \(Math\.PI \* 2\.0 \/ 5\.0\)/,
  /torso\.setPivot\(0\.0F, 18\.0F, 0\.0F\)/, /torso\.pitch = \(float\) \(Math\.PI \/ 4\)/, /tail\.setPivot\(-1\.0F, 21\.0F, 6\.0F\)/,
  /rightHindLeg\.setPivot\(-2\.5F, 22\.7F, 2\.0F\)/, /leftHindLeg\.setPivot\(0\.5F, 22\.7F, 2\.0F\)/, /rightHindLeg\.pitch = \(float\) \(Math\.PI \* 3\.0 \/ 2\.0\)/,
  /rightFrontLeg\.pitch = 5\.811947F/, /rightFrontLeg\.setPivot\(-2\.49F, 17\.0F, -4\.0F\)/, /leftFrontLeg\.setPivot\(0\.51F, 17\.0F, -4\.0F\)/,
  /realHead\.roll = \$\$0\.getBegAnimationProgress\(\$\$3\) \+ \$\$0\.getShakeAnimationProgress\(\$\$3, 0\.0F\)/, /neck\.roll = \$\$0\.getShakeAnimationProgress\(\$\$3, -0\.08F\)/,
  /torso\.roll = \$\$0\.getShakeAnimationProgress\(\$\$3, -0\.16F\)/, /realTail\.roll = \$\$0\.getShakeAnimationProgress\(\$\$3, -0\.2F\)/, /tail\.pitch = \$\$3/,
  /ModelTransform\.of\(-1\.0F, 12\.0F, 8\.0F, \(float\) \(Math\.PI \/ 5\)/])
  ok(p.test(WM), `WolfEntityModel: the decomp no longer contains ${p} — the wolf oracle is stale`);
for (const p of [/return 1\.5393804F/, /\(0\.55F - \(this\.getMaxHealth\(\) - this\.getHealth\(\)\) \* 0\.02F\) \* \(float\) Math\.PI/, /\/ 1\.8F/, /\* 0\.15F \* \(float\) Math\.PI/])
  ok(p.test(WE), `WolfEntity: the decomp no longer contains ${p} — the wolf oracle is stale`);
const lerp = (t, a, b) => f32(a + f32(t * f32(b - a)));
const shk = (e, pt, off) => { const t = Math.min(1, Math.max(0, f32(f32(lerp(pt, e.lastShakeProgress, e.shakeProgress) + off) / f32(1.8)))); return f32(Math.sin(f32(t * PI)) * Math.sin(f32(f32(t * PI) * 11)) * f32(0.15) * PI); };
const WREST = { upper_body: { rx: f32(Math.PI / 2), p: [-1, 14, -3] }, body: { rx: f32(Math.PI / 2), p: [0, 14, 2] }, tail: { rx: f32(Math.PI / 5), p: [-1, 12, 8] },
  right_hind_leg: { rx: 0, p: [-2.5, 16, 7] }, left_hind_leg: { rx: 0, p: [0.5, 16, 7] }, right_front_leg: { rx: 0, p: [-2.5, 16, -4] }, left_front_leg: { rx: 0, p: [0.5, 16, -4] }, head: { rx: 0, p: [-1, 13.5, -7] }, real_head: { rx: 0, p: [0, 0, 0] } };
const WP = Object.keys(WREST);
/** absolute vanilla pose -> delta from rest, per part: rx, ry, rz, dp[xyz] */
function wolfOracle(ls, amt, yaw, pitch, e, pt) {
  const th = f32(ls * f32(0.6662)), c0 = f32(cos(th) * f32(1.4) * amt), c1 = f32(cos(f32(th + PI)) * f32(1.4) * amt), H = f32(Math.PI / 2);
  const o = {}; const set = (n, rx, ry, rz, p) => { const r = WREST[n]; o[n] = { rx: rx - r.rx, ry, rz, dpx: (p ? p[0] : r.p[0]) - r.p[0], dpy: (p ? p[1] : r.p[1]) - r.p[1], dpz: (p ? p[2] : r.p[2]) - r.p[2] }; };
  const angry = e.angerTime > 0, tail = angry ? f32(1.5393804) : e.tamed ? f32(f32(f32(0.55) - f32(f32(e.maxHealth - e.health) * f32(0.02))) * PI) : f32(Math.PI / 5);
  const beg = f32(lerp(pt, e.begO, e.beg) * f32(0.15) * PI);
  const ty = angry ? 0 : f32(cos(th) * f32(1.4) * amt);
  if (e.sitting) {
    set('upper_body', f32(Math.PI * 2 / 5), 0, shk(e, pt, -0.08), [-1, 16, -3]); set('body', f32(Math.PI / 4), 0, shk(e, pt, -0.16), [0, 18, 0]);
    set('tail', tail, ty, shk(e, pt, -0.2), [-1, 21, 6]);
    set('right_hind_leg', f32(Math.PI * 3 / 2), 0, 0, [-2.5, 22.7, 2]); set('left_hind_leg', f32(Math.PI * 3 / 2), 0, 0, [0.5, 22.7, 2]);
    set('right_front_leg', 5.811947, 0, 0, [-2.49, 17, -4]); set('left_front_leg', 5.811947, 0, 0, [0.51, 17, -4]);
  } else {
    set('body', H, 0, shk(e, pt, -0.16)); set('upper_body', H, 0, shk(e, pt, -0.08)); set('tail', tail, ty, shk(e, pt, -0.2));
    set('right_hind_leg', c0, 0, 0); set('left_hind_leg', c1, 0, 0); set('right_front_leg', c1, 0, 0); set('left_front_leg', c0, 0, 0);
  }
  set('head', f32(pitch * f32(Math.PI / 180)), f32(yaw * f32(Math.PI / 180)), 0); set('real_head', 0, 0, f32(beg + shk(e, pt, 0)));
  return o;
}
const WSTATES = [];
for (const sitting of [false, true]) for (const angerTime of [0, 40]) for (const tamed of [false, true]) for (const health of [20, 11, 1]) for (const [begO, beg] of [[0, 0], [0.4, 0.64]]) for (const [lastShakeProgress, shakeProgress] of [[0, 0], [0.5, 0.9]])
  WSTATES.push({ type: 'wolf', sitting, angerTime, tamed, health, maxHealth: tamed ? 20 : 8, begO, beg, begTickAge: 0, age: 0, furWet: shakeProgress > 0, lastShakeProgress, shakeProgress });
const WLS = [0, 1, 7.9], WAMT = [0, 1], WPT = [0, 0.3, 1];
function compareWolf(mut) {
  let worst = 0, at = '';
  for (const st of WSTATES) for (const ls of WLS) for (const a of WAMT) for (const pt of WPT) for (const [yaw, pitch] of [[0, 0], [-31, 45], [90, -90]]) {
    const o = wolfOracle(ls, a, yaw, pitch, st, pt); if (mut) mut(o);
    const w = ER.wolfAnim(st, pt);
    for (const n of WP) {
      const d = ER.setupAnimDelta(n, ls, a, yaw, pitch, false, 'quadruped', { wolf: w }) || {};
      for (const k of ['rx', 'ry', 'rz', 'dpx', 'dpy', 'dpz']) { const dd = Math.abs((d[k] || 0) - o[n][k]); if (dd > worst) { worst = dd; at = `${n}.${k} sit=${st.sitting} anger=${st.angerTime} tamed=${st.tamed} hp=${st.health} ls=${ls} amt=${a} pt=${pt}`; } }
    }
  }
  return { worst, at };
}
const bools = [false, true];
const foxStates = []; for (const sneaking of bools) for (const sleeping of bools) for (const sitting of bools) for (const walking of bools) for (const baby of bools)
  if (!(sneaking && sleeping)) foxStates.push({ sneaking, sleeping, sitting, walking, baby, headRoll: 0.21, bodyOff: 1.7, leg: 5.36, age: 13.7 });   // the renderer never sets sleeping with crouching (ER.foxAnim)
const pandaStates = []; for (const sit of [0, 0.4, 1]) for (const lie of [0, 0.6]) for (const roll of [0, 0.5]) for (const ask of [0, 5]) for (const sn of [-1, 7, 16, 18, 22]) for (const eating of bools) for (const thunder of bools)
  pandaStates.push({ sit, lie, roll, ask, sneezing: sn >= 0, sneezeProgress: sn < 0 ? 0 : sn, eating, thunder, age: 13.7, baby: false });
const polarStates = []; for (const w of [0, 0.3, 1]) for (const baby of bools) polarStates.push({ w, baby });
const fxCtx = (st, r) => ({ fox: st, baby: st.baby, rest: r, ageInTicks: st.age });
const pdCtx = (st, r) => ({ panda: st, rest: r, ageInTicks: st.age });
const pbCtx = (st, r) => ({ polarBear: { p: st.w * st.w }, baby: st.baby, rest: r });
// engine rest objects use {rx,ry,rz,px,py,pz}
const OWN = {
  fox: { rests: FOXREST, fn: foxOracle, ctx: fxCtx, states: foxStates }, panda: { rests: PANDAREST, fn: pandaOracle, ctx: pdCtx, states: pandaStates },
  polar_bear: { rests: PBREST, fn: polarOracle, ctx: pbCtx, states: polarStates } };
const ownRes = {};
for (const [k, o] of Object.entries(OWN)) { ownRes[k] = compareOwn(o.rests, o.fn, o.ctx, o.states); ok(ownRes[k].worst < TOL, `${k}: worst deviation ${ownRes[k].worst.toExponential(2)} at ${ownRes[k].at}`);
  if (process.argv.includes('--verbose')) console.log(`  ${k}: worst ${ownRes[k].worst.toExponential(2)} at ${ownRes[k].at || 'n/a'}`); }
const ownCaught = (m, k, mut) => { const o = OWN[k], r = compareOwn(o.rests, o.fn, o.ctx, o.states, mut); if (r.worst > TOL) { breaks++; if (process.argv.includes('--verbose')) console.log('   ✓ break caught: ' + m); } else ok(false, 'break NOT caught: ' + m); };
for (const [k, o] of Object.entries(OWN)) for (const part in o.rests) for (const f of ['rx', 'ry', 'rz', 'px', 'py', 'pz'])
  ownCaught(`${k} ${part}.${f} +0.01`, k, (m, st) => { const c = {}; for (const p in m) c[p] = { ...m[p] }; c[part][f] += 0.01; return c; });
const wolfR = compareWolf(); ok(wolfR.worst < TOL, `wolf: worst deviation ${wolfR.worst.toExponential(2)} at ${wolfR.at}`);
if (process.argv.includes('--verbose')) console.log(`  wolf: worst ${wolfR.worst.toExponential(2)} at ${wolfR.at || 'n/a'}`);
for (const [n, k] of [['head', 'rx'], ['head', 'ry'], ['real_head', 'rz'], ['upper_body', 'rx'], ['upper_body', 'rz'], ['upper_body', 'dpy'], ['body', 'rx'], ['body', 'rz'], ['body', 'dpy'], ['body', 'dpz'],
  ['tail', 'rx'], ['tail', 'ry'], ['tail', 'rz'], ['tail', 'dpy'], ['tail', 'dpz'], ['right_hind_leg', 'rx'], ['left_hind_leg', 'rx'], ['right_front_leg', 'rx'], ['left_front_leg', 'rx'],
  ['right_hind_leg', 'dpy'], ['right_hind_leg', 'dpz'], ['right_front_leg', 'dpx'], ['left_front_leg', 'dpy']]) {
  const r = compareWolf((o) => { o[n][k] += 0.01; });
  if (r.worst > TOL) { breaks++; if (process.argv.includes('--verbose')) console.log(`   ✓ break caught: wolf ${n}.${k} +0.01`); } else ok(false, `break NOT caught: wolf ${n}.${k}`);
}
const WOLF_OK = wolfR.worst < TOL;
const sin7 = (x) => Math.sin(f32(x));
// ---- #7788 own-pose models: turtle, strider, goat (oracle re-reads the decomp literals; shape pinned below) ----
const T78 = src('TurtleEntityModel'), S78 = src('StriderEntityModel'), GT78 = src('GoatEntityModel'), GE78 = existsSync(new URL('../.decomp/net/minecraft/entity/passive/GoatEntity.java', import.meta.url)) ? readFileSync(new URL('../.decomp/net/minecraft/entity/passive/GoatEntity.java', import.meta.url), 'utf8') : '';
for (const [name, s, pats] of [
  ['TurtleEntityModel', T78, [/cos\(\$\$1 \* 0\.6662F \* 0\.6F\) \* 0\.5F \* \$\$2/, /cos\(\$\$6 \* \$\$1 \* 5\.0F \+ \(float\) Math\.PI\) \* 8\.0F \* \$\$2 \* \$\$7/, /\$\$0\.isDiggingSand\(\) \? 4\.0F : 1\.0F/, /\$\$0\.isDiggingSand\(\) \? 2\.0F : 1\.0F/, /cos\(\$\$1 \* 5\.0F \+ \(float\) Math\.PI\) \* 3\.0F \* \$\$2/, /!\$\$0\.isTouchingWater\(\) && \$\$0\.isOnGround\(\)/]],
  ['StriderEntityModel', S78, [/Math\.min\(0\.25F, \$\$2\)/, /0\.1F \* MathHelper\.sin\(\$\$1 \* 1\.5F\) \* 4\.0F \* \$\$2/, /\$\$1 \* 1\.5F \* 0\.5F\) \* 2\.0F \* \$\$2/, /\(float\) \(Math\.PI \/ 18\)/, /8\.0F \+ 2\.0F \* MathHelper\.sin/, /\$\$7 \* 1\.3F/, /\$\$7 \* 1\.2F/, /\$\$7 \* 0\.6F/, /0\.05F \* MathHelper\.sin\(\$\$3 \* 1\.0F \* -0\.4F\)/, /0\.1F \* MathHelper\.sin\(\$\$3 \* 1\.0F \* 0\.2F\)/, /0\.1F \* MathHelper\.sin\(\$\$3 \* 1\.0F \* 0\.4F\)/]],
  ['GoatEntityModel', GT78, [/this\.head\.pitch = \$\$6/, /getHeadPitch\(\)/]],
  ['GoatEntity', GE78, [/field_33488 \/ 20\.0F \* 30\.0F \* \(float\) \(Math\.PI \/ 180\.0\)/]]])
  for (const p of pats) ok(p.test(s), `${name}: the decomp no longer contains ${p} — the oracle below is stale`);
const turtleO = (ls, a, c) => {
  const w = f32(f32(ls * f32(0.6662)) * f32(0.6)), o = { right_hind_leg: { rx: cos(w) * 0.5 * a, ry: 0, rz: 0 }, left_hind_leg: { rx: cos(f32(w + PI)) * 0.5 * a, ry: 0, rz: 0 },
    right_front_leg: { rx: 0, ry: 0, rz: cos(f32(w + PI)) * 0.5 * a }, left_front_leg: { rx: 0, ry: 0, rz: cos(w) * 0.5 * a } };
  if (!c.inWater && c.onGround) { const k = c.digging ? 4 : 1, m = c.digging ? 2 : 1;
    o.right_front_leg = { rx: 0, ry: cos(f32(f32(k * ls * 5) + PI)) * 8 * a * m, rz: 0 }; o.left_front_leg = { rx: 0, ry: cos(f32(k * ls * 5)) * 8 * a * m, rz: 0 };
    o.right_hind_leg = { rx: 0, ry: cos(f32(f32(ls * 5) + PI)) * 3 * a, rz: 0 }; o.left_hind_leg = { rx: 0, ry: cos(f32(ls * 5)) * 3 * a, rz: 0 }; }
  return o;
};
const striderO = (ls, a0, yaw, pitch, age, ridden) => {
  const a = Math.min(0.25, a0), q = f32(f32(ls * 1.5) * 0.5), b = cos(f32(f32(ls * 1.5) + PI)) * a;
  const wob = (k, f) => k * sin7(f32(age * f)), I = Math.PI / 18;
  return { body: { rx: ridden ? 0 : f32(pitch * f32(Math.PI / 180)), ry: ridden ? 0 : f32(yaw * f32(Math.PI / 180)), rz: 0.1 * sin7(f32(ls * 1.5)) * 4 * a, dpy: 2 - 2 * cos(f32(ls * 1.5)) * 2 * a - 1 },
    left_leg: { rx: sin7(q) * 2 * a, ry: 0, rz: I * cos(q) * a, dpy: 2 * sin7(f32(q + PI)) * 2 * a }, right_leg: { rx: sin7(f32(q + PI)) * 2 * a, ry: 0, rz: I * cos(f32(q + PI)) * a, dpy: 2 * sin7(q) * 2 * a },
    right_bottom_bristle: { rz: b * 1.3 + wob(0.05, -0.4) }, right_middle_bristle: { rz: b * 1.2 + wob(0.1, 0.2) }, right_top_bristle: { rz: b * 0.6 + wob(0.1, 0.4) },
    left_top_bristle: { rz: b * 0.6 + wob(0.1, 0.4) }, left_middle_bristle: { rz: b * 1.2 + wob(0.1, 0.2) }, left_bottom_bristle: { rz: b * 1.3 + wob(0.05, -0.4) } };
};
const ownP = (mut) => {
  let worst = 0, at = '';
  const put = (id, got, want, ctx) => { const d = Math.abs((got || 0) - (want || 0)) / Math.max(1, Math.abs(want || 0)); if (d > worst) { worst = d; at = id + ' ' + ctx; } };
  const cmp = (id, d, o, ctx) => { d = d || {}; for (const f of ['rx', 'ry', 'rz', 'dpy']) if (o[f] !== undefined) put(id + '.' + f, d[f], o[f], ctx); };
  for (const ls of LS) for (const a of AMT) for (const yaw of YAW) for (const pitch of PITCH) {
    const ctx = `ls=${ls} amt=${a} yaw=${yaw} pitch=${pitch}`;
    for (const c of [{ inWater: true, onGround: false }, { inWater: false, onGround: true }, { inWater: false, onGround: true, digging: true }, { inWater: false, onGround: false }]) {
      const o = turtleO(ls, a, c), m = mut ? mut('turtle', o) : o;
      for (const p of Object.keys(m)) cmp('turtle.' + p, ER.setupAnimDelta(p, ls, a, yaw, pitch, false, 'quadruped', { turtle: { ...c, belly: false } }), m[p], ctx + ' ' + JSON.stringify(c));
      const hd = ER.setupAnimDelta('head', ls, a, yaw, pitch, false, 'quadruped', { turtle: { ...c, belly: false } });
      const hq = quad(ls, a, yaw, pitch).head; put('turtle.head.rx', hd.rx, hq.rx, ctx); put('turtle.head.ry', hd.ry, hq.ry, ctx);
    }
    for (const ridden of [false, true]) for (const age of [0, 13.5, 200.25]) {
      const o = striderO(ls, a, yaw, pitch, age, ridden), m = mut ? mut('strider', o) : o;
      for (const p of Object.keys(m)) cmp('strider.' + p, ER.setupAnimDelta(p, ls, a, yaw, pitch, false, 'quadruped', { strider: { ridden }, ageInTicks: age }), m[p], ctx + ` age=${age}${ridden ? ' ridden' : ''}`);
    }
  }
  // goat: GoatEntity.tickMovement counts field_33488 up while preparing the ram, down 2/tick after; model head.pitch = getHeadPitch()
  const Gt = M.Goat; let gw = 0;
  if (!Gt || !Gt.tickRamHead) ok(false, 'NS.Goat.tickRamHead exists'); else {
    const e = { preparingRam: true, type: 'goat' };
    for (let t = 0; t < 40; t++) {
      e.preparingRam = t < 25 || t > 33;
      Gt.tickRamHead(e);
      const n = e.ramHeadTicks | 0; if (!n) continue;
      let want = f32(f32(f32(n / 20) * 30) * f32(Math.PI / 180)); if (mut) want = mut('goat', { head: { rx: want } }).head.rx;
      const d = ER.setupAnimDelta('head', 0, 0, 0, (e.xHeadRot || 0) * 180 / Math.PI, false, 'quadruped', {});
      put('goat.head.rx', d && d.rx, want, `ramTicks=${n}`);
    }
  }
  return { worst, at };
};
const ownR = ownP();
ok(ownR.worst < TOL, `turtle/strider/goat: worst deviation ${ownR.worst.toExponential(2)} at ${ownR.at}`);
if (process.argv.includes('--verbose')) console.log(`  turtle/strider/goat: worst ${ownR.worst.toExponential(2)} at ${ownR.at || 'n/a'}`);
const caught7 = (m, mut, fn) => { if ((fn ? fn() : ownP(mut).worst) > TOL) { breaks++; if (process.argv.includes('--verbose')) console.log('   ✓ break caught: ' + m); } else ok(false, 'break NOT caught: ' + m); };
for (const p of ['right_hind_leg', 'left_hind_leg']) caught7(`turtle ${p}.rx +0.01`, (k, o) => k === 'turtle' ? { ...o, [p]: { ...o[p], rx: o[p].rx + 0.01 } } : o);
for (const p of ['right_front_leg', 'left_front_leg']) caught7(`turtle ${p}.rz +0.01`, (k, o) => k === 'turtle' ? { ...o, [p]: { ...o[p], rz: o[p].rz + 0.01 } } : o);
for (const p of ['right_front_leg', 'left_front_leg', 'right_hind_leg', 'left_hind_leg']) caught7(`turtle ${p}.ry +0.01 (land)`, (k, o) => k === 'turtle' ? { ...o, [p]: { ...o[p], ry: o[p].ry + 0.01 } } : o);
for (const [p, fs] of [['body', ['rx', 'ry', 'rz', 'dpy']], ['left_leg', ['rx', 'rz', 'dpy']], ['right_leg', ['rx', 'rz', 'dpy']]]) for (const f of fs)
  caught7(`strider ${p}.${f} +0.01`, (k, o) => k === 'strider' ? { ...o, [p]: { ...o[p], [f]: o[p][f] + 0.01 } } : o);
for (const p of ['right_bottom_bristle', 'right_middle_bristle', 'right_top_bristle', 'left_top_bristle', 'left_middle_bristle', 'left_bottom_bristle'])
  caught7(`strider ${p}.rz +0.01`, (k, o) => k === 'strider' ? { ...o, [p]: { rz: o[p].rz + 0.01 } } : o);
caught7('goat head.rx while ramming +0.01', (k, o) => k === 'goat' ? { head: { rx: o.head.rx + 0.01 } } : o);
// ---- #7788 axolotl: AxolotlEntityModel.method_33293 (cache-mixed pose via lerpAngleDegrees), chained over frames ----
const AX78 = src('AxolotlEntityModel');
for (const p of [/MOVING_IN_WATER_LEG_PITCH = 1\.8849558F/, /\$\$0 \* 0\.33F/, /\$\$0 \* 0\.075F/, /\$\$0 \* 0\.11F/, /\$\$0 \* 0\.09F/, /1\.4137167F, 1\.0995574F/, /0\.47123894F, 1\.7278761F/, /0\.9424779F, 1\.5F - \$\$4, -0\.1F/, /1\.1F, 1\.0F, 0\.0F/, /0\.8F, 2\.3F, -0\.5F/, /0\.45F \* \$\$4/, /this\.lerpAngleDegrees\(0\.05F, \$\$0, \$\$1\)/, /lerpAngleDegrees\(0\.2F, this\.body\.pitch/, /lerpAngleDegrees\(0\.1F, this\.body\.pitch/])
  ok(p.test(AX78), `AxolotlEntityModel: the decomp no longer contains ${p} — the oracle below is stale`);
const axWrap = (d) => { d = d % 360; if (d >= 180) d -= 360; if (d < -180) d += 360; return d; };
const axO = (prev, st, age, yaw, pitch) => {
  const R = Math.PI / 180, N = ['body', 'head', 'right_hind_leg', 'left_hind_leg', 'right_front_leg', 'left_front_leg', 'tail', 'top_gills', 'left_gills', 'right_gills'];
  const P = {}; for (const n of N) P[n] = prev ? { ...prev[n] } : { rx: 0, ry: 0, rz: 0 };
  if (!prev) { P.body.rx = pitch * R; P.body.ry = yaw * R; }
  let by = 20; const lp = (d, a, b) => a + d * axWrap(b - a);
  const T = (n, rx, ry, rz) => { const q = P[n]; if (rx !== undefined) q.rx = lp(0.05, q.rx, rx); if (ry !== undefined) q.ry = lp(0.05, q.ry, ry); if (rz !== undefined) q.rz = lp(0.05, q.rz, rz); };
  const leg = (n, a, b, c) => T(n, a, b, c), cp = () => { for (const k of ['hind', 'front']) { const l = P['left_' + k + '_leg']; T('right_' + k + '_leg', l.rx, -l.ry, -l.rz); } };
  const Pi = Math.PI;
  if (st.dead) { leg('left_hind_leg', 1.4137167, 1.0995574, Pi / 4); leg('left_front_leg', Pi / 4, 2.042035, 0); T('body', -0.15, undefined, 0.35); cp(); T('body', undefined, yaw * R);
    T('head', 0, 0, 0); T('tail', undefined, 0); for (const g of ['top_gills', 'left_gills', 'right_gills']) T(g, 0, 0, 0); }
  else if (st.water && st.moving) { const a = age * 0.33, s = Math.sin(a), c = Math.cos(a), w = 0.13 * s;
    P.body.rx = lp(0.1, P.body.rx, pitch * R + w); P.head.rx = -w * 1.8; by -= 0.45 * c; T('top_gills', -0.5 * s - 0.8); T('left_gills', undefined, 0.3 * s + 0.9); T('right_gills', undefined, -P.left_gills.ry);
    T('tail', undefined, 0.3 * Math.cos(a * 0.9)); leg('left_hind_leg', 1.8849558, -0.4 * s, Pi / 2); leg('left_front_leg', 1.8849558, -0.2 * c - 0.1, Pi / 2); cp(); T('head', undefined, 0, 0); }
  else if (st.water) { const a = age * 0.075, c = Math.cos(a), s = Math.sin(a) * 0.15;
    T('body', -0.15 + 0.075 * c); by -= s; T('head', -P.body.rx); T('top_gills', 0.2 * c); T('left_gills', undefined, -0.3 * c - 0.19); T('right_gills', undefined, -P.left_gills.ry);
    leg('left_hind_leg', Pi * 3 / 4 - c * 0.11, 0.47123894, 1.7278761); leg('left_front_leg', Pi / 4 - c * 0.2, 2.042035, 0); cp(); T('tail', undefined, 0.5 * c); T('head', undefined, 0, 0); }
  else if (st.ground && st.moving) { const a = age * 0.11, c = Math.cos(a), k = (c * c - 2 * c) / 5, m = 0.7 * c;
    T('head', 0, 0.09 * c, 0); T('tail', undefined, P.head.ry); T('top_gills', 0.6 - 0.08 * (c * c + 2 * Math.sin(a))); T('left_gills', undefined, -P.top_gills.rx); T('right_gills', undefined, -P.left_gills.ry);
    leg('left_hind_leg', 0.9424779, 1.5 - k, -0.1); leg('left_front_leg', 1.0995574, Pi / 2 - m, 0); leg('right_hind_leg', P.left_hind_leg.rx, -1 - k, 0); leg('right_front_leg', P.left_front_leg.rx, -Pi / 2 - m, 0);
    P.body.rx = lp(0.2, P.body.rx, 0); T('body', undefined, yaw * R, 0); }
  else if (st.ground) { const a = age * 0.09, s = Math.sin(a), c = Math.cos(a), k = s * s - 2 * s, m = c * c - 3 * s;
    T('head', -0.09 * k, 0, -0.2); T('tail', undefined, -0.1 + 0.1 * k); T('top_gills', 0.6 + 0.05 * m); T('left_gills', undefined, -P.top_gills.rx); T('right_gills', undefined, -P.left_gills.ry);
    leg('left_hind_leg', 1.1, 1, 0); leg('left_front_leg', 0.8, 2.3, -0.5); cp(); P.body.rx = lp(0.2, P.body.rx, 0); T('body', undefined, yaw * R, 0); }
  else return { P, by, cache: null };
  const cache = {}; for (const n of N) cache[n] = { ...P[n] };
  return { P, by, cache };
};
const AXS = [{ dead: true }, { water: true, moving: true }, { water: true }, { ground: true, moving: true }, { ground: true }, {}];
const axP = (mut) => {
  let worst = 0, at = '', ec = null, oc = null;
  const put = (id, g, w, ctx) => { const d = Math.abs(g - w) / Math.max(1, Math.abs(w)); if (d > worst) { worst = d; at = id + ' ' + ctx; } };
  for (const seq of [[0, 1, 2, 3, 4, 5], [4, 3, 1, 2, 0, 5], [1, 1, 1, 2, 2, 4, 4, 3, 3, 0, 0], [5, 5, 3, 3]]) for (const [yaw, pitch] of [[0, 0], [37, -20], [-120, 55]]) {
    ec = null; oc = null; let age = 0;
    for (const si of seq) for (let t = 0; t < 4; t++) {
      age += 3.5; const st = AXS[si], e = ER.axolotlPose(ec, st, age, yaw, pitch); let o = axO(oc, st, age, yaw, pitch);
      if (mut) o = mut(o); if (e.cache) ec = e.cache; if (o.cache) oc = o.cache;
      const ctx = `st=${JSON.stringify(st)} age=${age} yaw=${yaw} pitch=${pitch}`;
      for (const n of Object.keys(o.P)) for (const f of ['rx', 'ry', 'rz']) put('axolotl.' + n + '.' + f, e.pose[n][f], o.P[n][f], ctx);
      put('axolotl.body.pivotY', e.bodyPivotY, o.by, ctx);
    }
  }
  return { worst, at };
};
const axR = axP();
ok(axR.worst < TOL, `axolotl: worst deviation ${axR.worst.toExponential(2)} at ${axR.at}`);
{ const d = ER.setupAnimDelta('left_gills', 0, 0, 0, 0, false, 'quadruped', { axolotl: ER.axolotlPose(null, { water: true }, 5, 0, 0) }); ok(d && typeof d.ry === 'number', 'axolotl: ctx.axolotl reaches ER.setupAnimDelta'); }
for (const n of ['body', 'head', 'right_hind_leg', 'left_hind_leg', 'right_front_leg', 'left_front_leg', 'tail', 'top_gills', 'left_gills', 'right_gills']) for (const f of ['rx', 'ry', 'rz'])
  caught7(`axolotl ${n}.${f} +0.01`, null, () => axP((o) => ({ ...o, P: { ...o.P, [n]: { ...o.P[n], [f]: o.P[n][f] + 0.01 } } })).worst);
caught7('axolotl body pivotY +0.01', null, () => axP((o) => ({ ...o, by: o.by + 0.01 })).worst);
const OWN7788 = new Set(['turtle', 'strider', 'goat']);
// ---- sheep: SheepEntityModel / SheepWoolEntityModel (head.pivotY = 6 + neck*9, head.pitch = headAngle) over eatGrassTimer x partial ----
const SH = src('SheepEntityModel') + src('SheepWoolEntityModel'), SE = existsSync(new URL('../.decomp/net/minecraft/entity/passive/SheepEntity.java', import.meta.url)) ? readFileSync(new URL('../.decomp/net/minecraft/entity/passive/SheepEntity.java', import.meta.url), 'utf8') : '';
for (const p of [/pivotY = 6\.0F \+ \$\$0\.getNeckAngle\(\$\$3\) \* 9\.0F/, /head\.pitch = this\.(headPitchModifier|headAngle)/, /super\.setAngles/]) ok(p.test(SH), `Sheep models: the decomp no longer contains ${p}`);
for (const p of [/eatGrassTimer >= 4 && this\.eatGrassTimer <= 36/, /\/ 4\.0F : -\(\(float\)\(this\.eatGrassTimer - 40\) - \$\$0\) \/ 4\.0F/, /\/ 32\.0F/, /0\.21991149F \* MathHelper\.sin\(\$\$1 \* 28\.7F\)/]) ok(p.test(SE), `SheepEntity: the decomp no longer contains ${p}`);
const sheepO = (timer, t, ls, amt, yaw, pitch) => {
  const neck = timer <= 0 ? 0 : (timer >= 4 && timer <= 36) ? 1 : timer < 4 ? f32((timer - t) / 4) : f32(-(timer - 40 - t) / 4);
  const rx = (timer > 4 && timer <= 36) ? f32(f32(Math.PI / 5) + f32(0.21991149 * f32(Math.sin(f32(f32((timer - 4 - t) / 32) * f32(28.7)))))) : timer > 0 ? f32(Math.PI / 5) : f32(pitch * f32(Math.PI / 180));
  return { ...quad(ls, amt, yaw, pitch), head: { rx, ry: f32(yaw * f32(Math.PI / 180)) }, dpy: f32(neck * 9) };
};
const TIMERS = [0, 1, 3, 4, 5, 20, 36, 37, 39, 40], PARTIAL = [0, 0.5, 1];
function compareSheep(mut) {
  let worst = 0, at = '';
  const put = (n, g, w, c) => { const d = Math.abs(g - w); if (d > worst) { worst = d; at = n + ' ' + c; } };
  for (const timer of TIMERS) for (const t of PARTIAL) for (const ls of [0, 2.5, 31]) for (const a of [0, 1]) for (const yaw of [-90, 17]) for (const pitch of [-90, 0, 45]) {
    const o = mut ? mut(sheepO(timer, t, ls, a, yaw, pitch)) : sheepO(timer, t, ls, a, yaw, pitch);
    const ctx = { sheepEatGrass: ER.sheepEatGrass({ type: 'sheep', eatGrassTimer: timer }, t) };
    const c = `timer=${timer} t=${t} ls=${ls} amt=${a} yaw=${yaw} pitch=${pitch}`;
    const h = ER.setupAnimDelta('head', ls, a, yaw, pitch, false, 'quadruped', ctx) || { rx: 0, ry: 0 };
    put('head.rx', h.rx, o.head.rx, c); put('head.ry', h.ry, o.head.ry, c); put('head.dpy', h.dpy || 0, o.dpy, c);
    for (const p of QP.slice(1)) put(p, (ER.setupAnimDelta(p, ls, a, yaw, pitch, false, 'quadruped', ctx) || { rx: 0 }).rx, o[p], c);
  }
  return { worst, at };
}
const sheepR = compareSheep();
ok(sheepR.worst < 1e-4, `sheep: worst deviation ${sheepR.worst.toExponential(2)} at ${sheepR.at}`);
const caughtS = (m, mut) => { const r = compareSheep(mut); if (r.worst > 1e-4) breaks++; else ok(false, 'break NOT caught: ' + m); };
caughtS('sheep head pitch +0.01', (o) => ({ ...o, head: { ...o.head, rx: o.head.rx + 0.01 } }));
caughtS('sheep head yaw +0.01', (o) => ({ ...o, head: { ...o.head, ry: o.head.ry + 0.01 } }));
caughtS('sheep neck pivotY +0.1', (o) => ({ ...o, dpy: o.dpy + 0.1 }));
for (const p of QP.slice(1)) caughtS(`sheep ${p} x1.01`, (o) => ({ ...o, [p]: o[p] * 1.01 + 0.001 }));
// ---- #7795 PlayerEntityModel / ArmorStandEntityModel: BipedEntityModel.setAngles line by line (arm poses EMPTY, no swing) ----
const PM = src('PlayerEntityModel'), AM = src('ArmorStandEntityModel'), AAM = src('ArmorStandArmorEntityModel'), SA = readFileSync(new URL('../.decomp/net/minecraft/client/render/entity/model/CrossbowPosing.java', import.meta.url), 'utf8');
const AE = readFileSync(new URL('../.decomp/net/minecraft/entity/decoration/ArmorStandEntity.java', import.meta.url), 'utf8');
for (const [name, s2, pats] of [
  ['BipedEntityModel(player)', B, [/this\.body\.pitch = 0\.5F/, /this\.rightArm\.pitch \+= 0\.4F/, /this\.rightLeg\.pivotZ = 4\.0F/, /this\.rightLeg\.pivotY = 12\.2F/, /this\.head\.pivotY = 4\.2F/, /this\.body\.pivotY = 3\.2F/,
    /this\.leftArm\.pivotY = 5\.2F/, /\$\$8 \/= 0\.2F/, /this\.rightArm\.pitch \+= \(float\) \(-Math\.PI \/ 5\)/, /this\.rightLeg\.yaw = \(float\) \(Math\.PI \/ 10\)/, /this\.rightLeg\.roll = 0\.07853982F/,
    /1\.8707964F/, /5\.012389F/, /1\.2707963F/, /\$\$1 % 26\.0F/, /0\.33333334F/, /\$\$1 \* 0\.6662F \+ \(float\) Math\.PI\) \* 2\.0F \* \$\$2 \* 0\.5F \/ \$\$8/, /float \$\$3 = \(\$\$2 - \$\$1\) % \(float\) \(Math\.PI \* 2\)/]],
  ['CrossbowPosing.swingArm', SA, [/\$\$0\.roll \+ \$\$2 \* \(MathHelper\.cos\(\$\$1 \* 0\.09F\) \* 0\.05F \+ 0\.05F\)/, /\$\$0\.pitch \+ \$\$2 \* MathHelper\.sin\(\$\$1 \* 0\.067F\) \* 0\.05F/]],
  ['PlayerEntityModel', PM, [/this\.leftPants\.copyTransform\(this\.leftLeg\)/, /this\.jacket\.copyTransform\(this\.body\)/]],
  ['ArmorStandArmorEntityModel', AAM, [/this\.hat\.copyTransform\(this\.head\)/, /this\.rightLeg\.roll = \(float\) \(Math\.PI \/ 180\.0\) \* \$\$0\.getRightLegRotation\(\)\.getRoll\(\)/]],
  ['ArmorStandEntityModel', AM, [/this\.shoulderStick\.roll = \(float\) \(Math\.PI \/ 180\.0\) \* \$\$0\.getBodyRotation\(\)\.getRoll\(\)/, /this\.basePlate\.yaw = \(float\) \(Math\.PI \/ 180\.0\) \* -MathHelper\.lerpAngleDegrees/]],
  ['ArmorStandEntity', AE, [/DEFAULT_LEFT_ARM_ROTATION = new EulerAngle\(-10\.0F, 0\.0F, -10\.0F\)/, /DEFAULT_RIGHT_ARM_ROTATION = new EulerAngle\(-15\.0F, 0\.0F, 10\.0F\)/,
    /DEFAULT_LEFT_LEG_ROTATION = new EulerAngle\(-1\.0F, 0\.0F, -1\.0F\)/, /DEFAULT_RIGHT_LEG_ROTATION = new EulerAngle\(1\.0F, 0\.0F, 1\.0F\)/]]]) {
  for (const p of pats) ok(p.test(s2), `${name}: the decomp no longer contains ${p} — the player/armor-stand oracle is stale`);
}
const PIv = f32(Math.PI);
const wrapP = (d) => { let w = f32(d % f32(Math.PI * 2)); if (w < -PIv) w += f32(Math.PI * 2); if (w >= PIv) w -= f32(Math.PI * 2); return w; };
// state: {ls, amt, yaw, pitch, riding, sneak, lp (leaningPitch), swimPose, flying (getRoll()>4), v2, age}
function playerOracle(st) {
  const lerpAngle = (a, from, to) => from + a * wrapP(to - from), lerp = (a, b, c) => b + a * (c - b);
  const part = (px, py, pz) => ({ rx: 0, ry: 0, rz: 0, px, py, pz });
  const head = part(0, 0, 0), body = part(0, 0, 0), ra = part(-5, 2, 0), la = part(5, 2, 0), rl = part(-1.9, 12, 0.1), ll = part(1.9, 12, 0.1);
  head.ry = st.yaw * D2R;
  if (st.flying) head.rx = -PIv / 4; else if (st.lp > 0) head.rx = lerpAngle(st.lp, head.rx, st.swimPose ? -PIv / 4 : st.pitch * D2R); else head.rx = st.pitch * D2R;
  body.ry = 0; ra.pz = 0; ra.px = -5; la.pz = 0; la.px = 5;
  let k = 1; if (st.flying) { k = st.v2; k /= 0.2; k *= k * k; } if (k < 1) k = 1;
  const w = f32(st.ls * f32(0.6662));
  ra.rx = cos(w + PIv) * 2 * st.amt * 0.5 / k; la.rx = cos(w) * 2 * st.amt * 0.5 / k; ra.rz = 0; la.rz = 0;
  rl.rx = cos(w) * 1.4 * st.amt / k; ll.rx = cos(w + PIv) * 1.4 * st.amt / k; rl.ry = 0; ll.ry = 0; rl.rz = 0; ll.rz = 0;
  if (st.riding) { ra.rx += -PIv / 5; la.rx += -PIv / 5; rl.rx = -1.4137167; rl.ry = PIv / 10; rl.rz = 0.07853982; ll.rx = -1.4137167; ll.ry = -PIv / 10; ll.rz = -0.07853982; }
  ra.ry = 0; la.ry = 0;
  if (st.sneak) { body.rx = 0.5; ra.rx += 0.4; la.rx += 0.4; rl.pz = ll.pz = 4; rl.py = ll.py = 12.2; head.py = 4.2; body.py = 3.2; la.py = ra.py = 5.2; }
  else { body.rx = 0; rl.pz = ll.pz = 0.1; rl.py = ll.py = 12; head.py = 0; body.py = 0; la.py = ra.py = 2; }
  ra.rz += 1 * (cos(st.age * f32(0.09)) * 0.05 + 0.05); ra.rx += 1 * Math.sin(f32(st.age * f32(0.067))) * 0.05;
  la.rz += -1 * (cos(st.age * f32(0.09)) * 0.05 + 0.05); la.rx += -1 * Math.sin(f32(st.age * f32(0.067))) * 0.05;
  if (st.lp > 0) {
    const l = st.ls % 26, m = (x) => -65 * x + x * x;
    if (l < 14) {
      la.rx = lerpAngle(st.lp, la.rx, 0); ra.rx = lerp(st.lp, ra.rx, 0); la.ry = lerpAngle(st.lp, la.ry, PIv); ra.ry = lerp(st.lp, ra.ry, PIv);
      la.rz = lerpAngle(st.lp, la.rz, PIv + 1.8707964 * m(l) / m(14)); ra.rz = lerp(st.lp, ra.rz, PIv - 1.8707964 * m(l) / m(14));
    } else if (l >= 14 && l < 22) {
      const q = (l - 14) / 8;
      la.rx = lerpAngle(st.lp, la.rx, HALF * q); ra.rx = lerp(st.lp, ra.rx, HALF * q); la.ry = lerpAngle(st.lp, la.ry, PIv); ra.ry = lerp(st.lp, ra.ry, PIv);
      la.rz = lerpAngle(st.lp, la.rz, 5.012389 - 1.8707964 * q); ra.rz = lerp(st.lp, ra.rz, 1.2707963 + 1.8707964 * q);
    } else if (l >= 22 && l < 26) {
      const q = (l - 22) / 4;
      la.rx = lerpAngle(st.lp, la.rx, HALF - HALF * q); ra.rx = lerp(st.lp, ra.rx, HALF - HALF * q); la.ry = lerpAngle(st.lp, la.ry, PIv); ra.ry = lerp(st.lp, ra.ry, PIv);
      la.rz = lerpAngle(st.lp, la.rz, PIv); ra.rz = lerp(st.lp, ra.rz, PIv);
    }
    ll.rx = lerp(st.lp, ll.rx, 0.3 * cos(f32(st.ls * f32(0.33333334)) + PIv)); rl.rx = lerp(st.lp, rl.rx, 0.3 * cos(f32(st.ls * f32(0.33333334))));
  }
  return { head, hat: head, body, jacket: body, right_arm: ra, right_sleeve: ra, left_arm: la, left_sleeve: la, right_leg: rl, right_pants: rl, left_leg: ll, left_pants: ll };
}
const PSTATES = [], PLS = [0, 1, 7.9, 13.5, 20, 24.5, 31], PAMT = [0, 0.25, 1];
for (const ls of PLS) for (const amt of PAMT) for (const yaw of [-90, 17]) for (const pitch of [-90, 45]) for (const riding of [false, true]) for (const sneak of [false, true])
  for (const lp of [0, 0.4, 1]) for (const swimPose of lp ? [false, true] : [false]) for (const flying of [false, true]) for (const v2 of flying ? [0.05, 0.5] : [0]) for (const age of [0, 33.7])
    PSTATES.push({ ls, amt, yaw, pitch, riding, sneak, lp, swimPose, flying, v2, age });
const PPARTS = ['head', 'hat', 'body', 'jacket', 'right_arm', 'right_sleeve', 'left_arm', 'left_sleeve', 'right_leg', 'right_pants', 'left_leg', 'left_pants'];
const PFIELDS = ['rx', 'ry', 'rz', 'px', 'py', 'pz'];
function comparePlayer(layer, mut) {
  const L = M.BEModel.layer(layer); let worst = 0, at = '';
  if (!L) return { worst: 1, at: `${layer}: no model layer` };
  for (const st of PSTATES) {
    const o = playerOracle(st);
    for (const pn of PPARTS) {
      const rest = L.parts.find((q) => q.n === pn); if (!rest) { worst = 1; at = `${layer} has no ${pn}`; continue; }
      const base = ER.OVERLAY_OF[pn] || pn, oo = mut ? mut(o[pn], pn, st) : o[pn];
      const ctx = { rest, biped: true, ageInTicks: st.age, attackTime: 0, player: { sneaking: st.sneak, swimPose: st.swimPose, lp: st.lp, flying: st.flying, v2: st.v2, usingItem: false } };
      const d = ER.setupAnimDelta(pn, st.ls, st.amt, st.yaw, st.pitch, st.riding, 'humanoid', ctx) || {};
      const got = { rx: rest.rx + (d.rx || 0), ry: rest.ry + (d.ry || 0), rz: rest.rz + (d.rz || 0), px: rest.px + (d.dpx || 0), py: rest.py + (d.dpy || 0), pz: rest.pz + (d.dpz || 0) };
      for (const f of PFIELDS) {
        if (f[0] === 'p' && (base === 'hat' || pn === 'hat')) continue;   // the hat copies the head's ROTATION; its pivot rides the head parent's chain
        const dd = Math.abs(got[f] - oo[f]); if (dd > worst) { worst = dd; at = `${layer}.${pn}.${f} ${JSON.stringify(st)}`; }
      }
    }
  }
  return { worst, at };
}
// ---- #7796 arms: CrossbowPosing.meleeAttack (zombie family, zombified piglin), SkeletonEntityModel melee, BipedEntityModel.animateArms ----
const CP = src('CrossbowPosing'), SK = src('SkeletonEntityModel'), AZ = src('AbstractZombieModel');
for (const [n, s, p] of [['CrossbowPosing', CP, /\$\$1\.yaw = -\(0\.1F - \$\$5 \* 0\.6F\)/], ['CrossbowPosing', CP, /\(float\) -Math\.PI \/ \(\$\$2 \? 1\.5F : 2\.25F\)/], ['CrossbowPosing', CP, /\$\$5 \* 1\.2F - \$\$6 \* 0\.4F/],
  ['CrossbowPosing', CP, /MathHelper\.cos\(\$\$1 \* 0\.09F\) \* 0\.05F \+ 0\.05F/], ['CrossbowPosing', CP, /MathHelper\.sin\(\$\$1 \* 0\.067F\) \* 0\.05F/],
  ['SkeletonEntityModel', SK, /\$\$7 \* 1\.2F - \$\$8 \* 0\.4F/], ['AbstractZombieModel', AZ, /meleeAttack\(this\.leftArm, this\.rightArm/],
  ['BipedEntityModel', B, /\* \(float\) \(Math\.PI \* 2\)\) \* 0\.2F/], ['BipedEntityModel', B, /-\(this\.head\.pitch - 0\.7F\) \* 0\.75F/], ['BipedEntityModel', B, /\* -0\.4F/]]) ok(p.test(s), `${n}: the decomp no longer contains ${p} — the arm oracle is stale`);
{ const ZM = src('ZombieEntityModel'), GM = src('GiantEntityModel');   // #9151: no override beyond the base class, else the oracle is stale
  ok(!/method_17087|setAngles/.test(ZM) && !/method_17087|setAngles/.test(GM), 'ZombieEntityModel/GiantEntityModel gained a setAngles override — the zombie family oracle is stale');
  ok(/super\.method_17087\(\$\$0, \$\$1, \$\$2, \$\$3, \$\$4, \$\$5\)/.test(AZ), 'AbstractZombieModel.setAngles no longer calls the biped base first'); }
const sn = (x) => Math.sin(f32(x));
/** oracle: arm angles after the model's setAngles. kind 'zombie' = meleeAttack, 'skeleton' = SkeletonEntityModel melee; returns {right,left}={rx,ry,rz} + body yaw + pivots */
function armOracle(kind, t, age, aggr, lefty, mut) {
  const A = sn(f32(t * PI)), Bv = sn(f32(1 - f32(f32(1 - t) * f32(1 - t))) * PI);
  const base = { right: { rx: 0, ry: 0, rz: 0 }, left: { rx: 0, ry: 0, rz: 0 } };
  let by = 0, px = { r: -5, l: 5 }, pz = { r: 0, l: 0 };
  if (t > 0) {                                     // animateArms (runs first inside BipedEntityModel.setAngles)
    by = f32(sn(f32(f32(Math.sqrt(t)) * f32(Math.PI * 2))) * 0.2); if (lefty) by = -by;
    pz = { r: sn(by) * 5, l: -sn(by) * 5 }; px = { r: -cos(by) * 5, l: cos(by) * 5 };
    base.right.ry += by; base.left.ry += by; base.left.rx += by;
    const g = 1 - f32(f32(1 - t) ** 4), a1 = sn(g * PI), a2 = f32(sn(f32(t * PI)) * -(0 - 0.7) * 0.75);   // head pitch 0
    const m = lefty ? base.left : base.right; m.rx -= a1 * 1.2 + a2; m.ry += by * 2; m.rz += sn(f32(t * PI)) * -0.4;
  }
  const o = base, R = o.right, L = o.left;
  const div = aggr ? 1.5 : 2.25, pitch0 = kind === 'zombie' ? -PI / div : -PI / 2;
  const d = kind === 'zombie' ? f32(A * 1.2 - Bv * 0.4) : -f32(A * 1.2 - Bv * 0.4);
  if (kind === 'zombie' || kind === 'skeleton') {
    R.rz = 0; L.rz = 0; R.ry = -(0.1 - A * 0.6); L.ry = 0.1 - A * 0.6; R.rx = pitch0 + d; L.rx = pitch0 + d;
    R.rz += cos(f32(age * 0.09)) * 0.05 + 0.05; R.rx += sn(f32(age * 0.067)) * 0.05;
    L.rz -= cos(f32(age * 0.09)) * 0.05 + 0.05; L.rx -= sn(f32(age * 0.067)) * 0.05;
  }
  const out = { right: R, left: L, by, px, pz };
  return mut ? mut(out) : out;
}
function compareArms(kind, mut) {
  let worst = 0, at = '';
  for (const t of [0, 0.3, 0.7, 1]) for (const age of [0, 10, 37.3]) for (const aggr of kind === 'zombie' ? [false, true] : [false]) for (const lefty of [false, true]) {
    if (kind === 'zombie' && lefty) continue;        // animateZombieArms/meleeAttack assign every angle: handedness only moves body/pivots
    const o = armOracle(kind, t, age, aggr, lefty, mut);
    const rest = { rx: 0, ry: 0, rz: 0, px: 0, pz: 0 };
    const ctx = { biped: true, attackTime: t, ageInTicks: age, aggressive: aggr, leftHanded: lefty, rest };
    if (kind === 'zombie') ctx.zarm = ER.zombieArms('zombie'); else ctx.skelMelee = true;
    for (const [part, ox] of [['right_arm', o.right], ['left_arm', o.left]]) {
      const d = ER.setupAnimDelta(part, 0, 0, 0, 0, false, 'humanoid', { ...ctx, rest: { ...rest } }) || {};
      for (const k of ['rx', 'ry', 'rz']) { const dd = Math.abs((d[k] || 0) - ox[k]); if (dd > worst) { worst = dd; at = `${part}.${k} t=${t} age=${age} aggr=${aggr}`; } }
    }
  }
  return { worst, at };
}
const PL = {};
for (const layer of ['player', 'player_slim']) { PL[layer] = comparePlayer(layer); ok(PL[layer].worst < TOL, `${layer}: worst deviation ${PL[layer].worst.toExponential(2)} at ${PL[layer].at}`); if (process.argv.includes('--verbose')) console.log(`  ${layer}: worst ${PL[layer].worst.toExponential(2)} over ${PSTATES.length} states at ${PL[layer].at || 'n/a'}`); }
for (const f of PFIELDS) for (const pn of ['head', 'body', 'right_arm', 'left_arm', 'right_leg', 'left_leg']) {
  if (f[0] === 'p' && pn === 'head' && false) continue;
  const r = comparePlayer('player', (o, n) => (n === pn ? { ...o, [f]: o[f] + 0.01 } : o));
  if (r.worst > TOL) { breaks++; } else ok(false, `break NOT caught: player ${pn}.${f} +0.01`);
}
// ---- armor stand: every part takes its Pose triple (degrees -> radians); hat copies head; sticks copy body; base plate -yaw ----
{
  const AS = M.NS ? M.NS.ArmorStand : M.ArmorStand, K = { head: 'Head', hat: 'Head', body: 'Body', right_body_stick: 'Body', left_body_stick: 'Body', shoulder_stick: 'Body', left_arm: 'LeftArm', right_arm: 'RightArm', left_leg: 'LeftLeg', right_leg: 'RightLeg' };
  const NBT = [null, { Head: [10, -20, 30], Body: [5, 100, -7], LeftArm: [-90, 45, 12], RightArm: [33, -170, 80], LeftLeg: [-60, 1, 359], RightLeg: [120, -30, 2] }];
  const standCmp = (mut) => {
    let worst = 0, at = '';
    for (const pose of NBT) for (const small of [false, true]) {
      const e = { type: 'armor_stand', maxHealth: 20, age: 3, small, yaw: 1.1, yawO: 0.7, yBodyRot: 1.1, yBodyRotO: 0.7, animPos: 0, animSpeed: 0 };
      if (pose) e.asPose = pose;
      const an = ER.animOf(e, 0.5);
      for (const [pn, key] of Object.entries(K)) {
        const v = pose ? pose[key] : AS.DEFAULT_POSE[key], want = mut ? mut(pn, v) : v, d = an.deltaFor(pn) || { rx: 0, ry: 0, rz: 0 };
        [d.rx, d.ry, d.rz].forEach((g, i) => { const dd = Math.abs(g - f32(D2R * want[i])); if (dd > worst) { worst = dd; at = `${pn}[${i}] pose=${!!pose}`; } });
      }
    }
    return { worst, at };
  };
  const sr = standCmp(); ok(sr.worst < TOL, `armor_stand: worst deviation ${sr.worst.toExponential(2)} at ${sr.at}`);
  if (process.argv.includes('--verbose')) console.log(`  armor_stand: worst ${sr.worst.toExponential(2)} at ${sr.at || 'n/a'}`);
  for (const pn of Object.keys(K)) for (let i = 0; i < 3; i++) { const r = standCmp((n, v) => (n === pn ? v.map((x, j) => (j === i ? x + 1 : x)) : v)); if (r.worst > TOL) breaks++; else ok(false, `break NOT caught: armor_stand ${pn}[${i}] +1deg`); }
  PL.armor_stand = sr;
}
const ARMS = { zombie: compareArms('zombie'), skeleton: compareArms('skeleton') };
for (const [k, r] of Object.entries(ARMS)) { ok(r.worst < TOL, `arms ${k}: worst deviation ${r.worst.toExponential(2)} at ${r.at}`); if (process.argv.includes('--verbose')) console.log(`  arms ${k}: worst ${r.worst.toExponential(2)} at ${r.at}`); }
const armBreak = (m, kind, mut) => { const r = compareArms(kind, mut); if (r.worst > TOL) { breaks++; if (process.argv.includes('--verbose')) console.log('   ✓ break caught: ' + m); } else ok(false, 'break NOT caught: ' + m); };
for (const kind of ['zombie', 'skeleton']) {
  armBreak(`${kind} right arm pitch +0.01`, kind, (o) => ({ ...o, right: { ...o.right, rx: o.right.rx + 0.01 } }));
  armBreak(`${kind} left arm yaw +0.01`, kind, (o) => ({ ...o, left: { ...o.left, ry: o.left.ry + 0.01 } }));
  armBreak(`${kind} right arm roll +0.01`, kind, (o) => ({ ...o, right: { ...o.right, rz: o.right.rz + 0.01 } }));
}
// BOW_AND_ARROW (positionRightArm/LeftArm field_3403, then CrossbowPosing.swingArms bob): skeleton, stray
const BOWSRC = B.match(/case field_3403:[\s\S]*?break;/g) || [];
ok(BOWSRC.length === 2 && /-0\.1F \+ this\.head\.yaw;/.test(BOWSRC[0]) && /this\.head\.yaw - 0\.4F/.test(BOWSRC[1]), 'BipedEntityModel: the BOW_AND_ARROW cases changed — the bow oracle is stale');
function bowOracle(lefty, hy, hp, age) {
  const R = { rx: -PI / 2 + hp, ry: lefty ? -0.1 + hy - 0.4 : -0.1 + hy, rz: 0 }, L = { rx: -PI / 2 + hp, ry: lefty ? 0.1 + hy : 0.1 + hy + 0.4, rz: 0 };
  R.rz += cos(f32(age * 0.09)) * 0.05 + 0.05; R.rx += sn(f32(age * 0.067)) * 0.05;
  L.rz -= cos(f32(age * 0.09)) * 0.05 + 0.05; L.rx -= sn(f32(age * 0.067)) * 0.05;
  return { right: R, left: L };
}
function compareBow(mut) {
  let worst = 0, at = '';
  for (const lefty of [false, true]) for (const hy of [-40, 0, 25]) for (const hp of [-30, 0, 45]) for (const age of [0, 10, 37.3]) {
    const o = mut ? mut(bowOracle(lefty, hy * PI / 180, hp * PI / 180, age)) : bowOracle(lefty, hy * PI / 180, hp * PI / 180, age);
    for (const [part, ox] of [['right_arm', o.right], ['left_arm', o.left]]) {
      const d = ER.setupAnimDelta(part, 0, 0, hy, hp, false, 'humanoid', { biped: true, attackTime: 0, ageInTicks: age, leftHanded: lefty, skelBow: true, rest: { rx: 0, ry: 0, rz: 0, px: 0, pz: 0 } }) || {};
      for (const k of ['rx', 'ry', 'rz']) { const dd = Math.abs((d[k] || 0) - ox[k]); if (dd > worst) { worst = dd; at = `${part}.${k} lefty=${lefty} hy=${hy} hp=${hp}`; } }
    }
  }
  return { worst, at };
}
const bowR = compareBow(); ok(bowR.worst < TOL, `arms bow: worst deviation ${bowR.worst.toExponential(2)} at ${bowR.at}`);
for (const [m, mut] of [['bow right arm pitch +0.01', (o) => ({ ...o, right: { ...o.right, rx: o.right.rx + 0.01 } })], ['bow left arm yaw +0.01', (o) => ({ ...o, left: { ...o.left, ry: o.left.ry + 0.01 } })], ['bow right arm roll +0.01', (o) => ({ ...o, right: { ...o.right, rz: o.right.rz + 0.01 } })]]) { if (compareBow(mut).worst > TOL) breaks++; else ok(false, 'break NOT caught: ' + m); }
// ---- #9152 zombie_villager (no setAngles override: ZombieVillagerEntityModel only toggles hat/hat_rim) + drowned (DrownedEntityModel.animateModel/setAngles) ----
const ZV = src('ZombieVillagerEntityModel'), DRSRC = src('DrownedEntityModel');
ok(!/void (setAngles|method_17087|method_17791)\(/.test(ZV), 'ZombieVillagerEntityModel gained a setAngles override — the zombie_villager oracle (= zombie pose) is stale');
for (const p of [/\(float\) Math\.PI\)\;\s*\n?\s*this\.leftArm\.yaw = 0\.0F|leftArm\.pitch \* 0\.5F - \(float\) Math\.PI/, /rightArm\.pitch \* 0\.5F - \(float\) Math\.PI/, /-Math\.PI \* 4\.0 \/ 5\.0/, /leaningPitch \* 0\.35F \* MathHelper\.sin\(0\.1F \* \$\$3\)/,
  /rightArm\.roll, -0\.15F/, /leftArm\.roll, 0\.15F/, /leftLeg\.pitch - this\.leaningPitch \* 0\.55F/, /rightLeg\.pitch \+ this\.leaningPitch \* 0\.55F/, /this\.head\.pitch = 0\.0F/])
  ok(p.test(DRSRC), `DrownedEntityModel: the decomp no longer contains ${p} — the drowned oracle is stale`);
function drownedOracle(st) {
  const pl = playerOracle({ ls: st.ls, amt: st.amt, yaw: st.yaw, pitch: st.pitch, riding: st.riding, sneak: false, lp: st.lp, swimPose: st.swim, flying: false, v2: 0, age: st.age });
  const z = armOracle('zombie', 0, st.age, st.aggr, false).right, zl = armOracle('zombie', 0, st.age, st.aggr, false).left;
  const R = { ...z }, L = { ...zl }, lerpAngle = (a, f, t) => f + a * wrapP(t - f);
  if (st.trident) { const m = st.lefty ? L : R; m.rx = f32(m.rx * 0.5) - PIv; m.ry = 0; }
  const sw = Math.sin(f32(0.1 * st.age));
  if (st.lp > 0) {
    R.rx = lerpAngle(st.lp, R.rx, f32(-PI * 4 / 5)) + st.lp * 0.35 * sw; L.rx = lerpAngle(st.lp, L.rx, f32(-PI * 4 / 5)) - st.lp * 0.35 * sw;
    R.rz = lerpAngle(st.lp, R.rz, -0.15); L.rz = lerpAngle(st.lp, L.rz, 0.15);
  }
  const rl = { ...pl.right_leg }, ll = { ...pl.left_leg }, head = { ...pl.head }, hat = { ...pl.head };
  if (st.lp > 0) { ll.rx -= st.lp * 0.55 * sw; rl.rx += st.lp * 0.55 * sw; head.rx = 0; }
  return { head, hat, right_arm: R, left_arm: L, right_leg: rl, left_leg: ll };
}
function compareDrowned(mut) {
  let worst = 0, at = '';
  for (const ls of [0, 7.9, 20]) for (const amt of [0, 1]) for (const yaw of [-40, 25]) for (const pitch of [-30, 45]) for (const riding of [false, true]) for (const lp of [0, 0.4, 1]) for (const swim of lp ? [false, true] : [false])
    for (const age of [0, 33.7]) for (const aggr of [false, true]) for (const trident of [false, true]) for (const lefty of trident ? [false, true] : [false]) {
      const st = { ls, amt, yaw, pitch, riding, lp, swim, age, aggr, trident, lefty }, o = mut ? mut(drownedOracle(st)) : drownedOracle(st);
      for (const pn of ['head', 'hat', 'right_arm', 'left_arm', 'right_leg', 'left_leg']) {
        const rest = { rx: 0, ry: 0, rz: 0, px: 0, py: 0, pz: 0 };
        const ctx = { biped: true, rest, attackTime: 0, ageInTicks: age, aggressive: aggr, leftHanded: lefty, zarm: ER.zombieArms('drowned'), trident, drownedLp: lp, drownedSwim: swim };
        const d = ER.setupAnimDelta(pn, ls, amt, yaw, pitch, riding, 'humanoid', ctx) || {};
        for (const k of ['rx', 'ry', 'rz']) { if (pn === 'hat' && k !== 'rx' && k !== 'ry') continue; const dd = Math.abs((d[k] || 0) - o[pn][k]); if (dd > worst) { worst = dd; at = `${pn}.${k} ${JSON.stringify(st)}`; } }
      }
    }
  return { worst, at };
}
const DRW = compareDrowned(); ok(DRW.worst < TOL, `drowned: worst deviation ${DRW.worst.toExponential(2)} at ${DRW.at}`);
if (process.argv.includes('--verbose')) console.log(`  drowned: worst ${DRW.worst.toExponential(2)} at ${DRW.at || 'n/a'}`);
for (const pn of ['head', 'hat', 'right_arm', 'left_arm', 'right_leg', 'left_leg']) for (const k of ['rx', 'ry', 'rz']) {
  if (pn === 'hat' && k === 'rz') continue;
  if (compareDrowned((o) => ({ ...o, [pn]: { ...o[pn], [k]: o[pn][k] + 0.01 } })).worst > TOL) breaks++; else ok(false, `break NOT caught: drowned ${pn}.${k} +0.01`);
}
const ARM_NC = 'arms: swing/attack/charge/aggressive arms are posed by the arm layers (ZombieArms, bow, crossbow, illager) and are not compared';
const ARM_DONE = new Set(['zombie', 'husk', 'giant', 'zombie_villager', 'drowned', 'skeleton', 'stray', 'wither_skeleton', 'piglin', 'piglin_brute', 'zombified_piglin']);   // piglins: comparePiglin (crossbow hold/charge, melee, dance, admire) + zombified meleeAttack; meleeAttack via ZombieArms; skeleton melee is compared above but those mobs also have bow poses, drowned a trident, piglins crossbow/dance: still owed
const cCaught = (m, mut) => { if (compareChicken(mut).worst > TOL) breaks++; else ok(false, 'break NOT caught: ' + m); };
for (const p of ['right_leg', 'left_leg', 'right_wing', 'left_wing']) cCaught(`chicken ${p} +0.01`, (o) => ({ ...o, [p]: o[p] + 0.01 }));
for (const p of ['head', 'beak', 'red_thing']) {
  cCaught(`chicken ${p} pitch +0.01`, (o) => ({ ...o, [p]: { ...o.head, rx: o.head.rx + 0.01 }, head: p === 'head' ? { ...o.head, rx: o.head.rx + 0.01 } : o.head }));
  cCaught(`chicken ${p} yaw +0.01`, (o) => ({ ...o, [p]: { ...o.head, ry: o.head.ry + 0.01 }, head: p === 'head' ? { ...o.head, ry: o.head.ry + 0.01 } : o.head }));
}
cCaught('chicken wings not mirrored', (o) => ({ ...o, left_wing: o.right_wing }));

// ---- #7794: the models that own their pose maths (villager/trader/witch, illagers, ravager) ----
const V = src('VillagerResemblingModel'), I = src('IllagerEntityModel'), W = src('WitchEntityModel'), RV = src('RavagerEntityModel');
for (const [name, s, pats] of [
  ['VillagerResemblingModel', V, [/cos\(\$\$1 \* 0\.6662F\) \* 1\.4F \* \$\$2 \* 0\.5F/, /0\.3F \* MathHelper\.sin\(0\.45F \* \$\$3\)/, /this\.head\.pitch = 0\.4F/]],
  ['IllagerEntityModel', I, [/cos\(\$\$1 \* 0\.6662F \+ \(float\) Math\.PI\) \* 2\.0F \* \$\$2 \* 0\.5F/, /Math\.PI \* 3\.0 \/ 4\.0/, /2\.670354F/, /-0\.9424779F/, /\(float\) \(-Math\.PI \/ 5\)/, /cos\(\$\$3 \* 0\.6662F\) \* 0\.05F/, /cos\(\$\$3 \* 0\.6662F\) \* 0\.25F/]],
  ['CrossbowPosing', CP, [/-0\.97079635F/, /-1\.8849558F/, /MathHelper\.cos\(\$\$4 \* 0\.09F\) \* 0\.15F/, /MathHelper\.cos\(\$\$4 \* 0\.19F\) \* 0\.5F/, /\$\$5 \* 2\.2F - \$\$6 \* 0\.4F/, /0\.1F - \$\$5 \* 0\.6F/, /MathHelper\.lerp\(\$\$8, 0\.4F, 0\.85F\)/, /-1\.5F \+ \$\$2\.pitch/]],
  ['WitchEntityModel', W, [/0\.01F \* \(float\)\(\$\$0\.getId\(\) % 10\)/, /\* 4\.5F \* \(float\) \(Math\.PI \/ 180\.0\)/, /\* 2\.5F \* \(float\) \(Math\.PI \/ 180\.0\)/, /setPivot\(0\.0F, 1\.0F, -1\.5F\)/, /this\.nose\.pitch = -0\.9F/]],
  ['RavagerEntityModel', RV, [/0\.4F \* \$\$2/, /0\.21991149F/, /\(float\) Math\.PI \* \(\$\$16 \? 0\.05F : 0\.01F\)/, /-6\.5F \+ \$\$11/, /\$\$10 \* \$\$10 \* \$\$10 \* 12\.0F/, /\(float\) \(Math\.PI \/ 20\) \* MathHelper\.sin/, /\(double\)\$\$4 \/ 40\.0/]]]) {
  for (const p of pats) ok(p.test(s), `${name}: the decomp no longer contains ${p} — the oracle below is stale`);
}
const DR = f32(Math.PI / 180), sin = (x) => Math.sin(f32(x)), c32 = (x) => Math.cos(f32(x));
const walk = (ls, a, k, off) => c32(f32(ls * f32(0.6662)) + off) * k * a;
const villagerO = (ls, a, yaw, pitch, st) => ({
  head: st.shake ? { rx: 0.4, ry: yaw * DR, rz: 0.3 * sin(0.45 * st.age) } : { rx: pitch * DR, ry: yaw * DR, rz: 0 },
  right_leg: { rx: walk(ls, a, 1.4 * 0.5, 0) }, left_leg: { rx: walk(ls, a, 1.4 * 0.5, PI) } });
const wrap10 = (v) => (Math.abs(v % 10 - 5) - 2.5) / 2.5;
const illagerO = (ls, a, yaw, pitch, st) => {
  const hy = yaw * DR, hp = pitch * DR, P = Math.PI, age = st.age, t = st.attackTime;
  const arm = (right) => {
    let r = st.riding ? { rx: -P / 5, ry: 0, rz: 0 } : { rx: walk(ls, a, 2 * 0.5, right ? PI : 0), ry: 0, rz: 0 };
    const sw = (g) => { r.rz += g * (c32(age * 0.09) * 0.05 + 0.05); r.rx += g * sin(age * 0.067) * 0.05; };
    const s5 = sin(t * P), s6 = sin((1 - (1 - t) * (1 - t)) * P);
    switch (st.state) {
      case 'ATTACKING':
        r.rz = 0;
        if (st.mainEmpty) { r.ry = right ? -(0.1 - s5 * 0.6) : 0.1 - s5 * 0.6; r.rx = -P / 1.5 + s5 * 1.2 - s6 * 0.4; }
        else { const main = right === !st.leftHanded; r.ry = right ? P / 20 : -P / 20;
          r.rx = main ? -1.8849558 + c32(age * 0.09) * 0.15 + s5 * 2.2 - s6 * 0.4 : c32(age * 0.19) * 0.5 + s5 * 1.2 - s6 * 0.4; }
        sw(right ? 1 : -1); break;
      case 'SPELLCASTING': r = { rx: c32(age * 0.6662) * 0.25, ry: 0, rz: right ? P * 3 / 4 : -P * 3 / 4 }; break;
      case 'BOW_AND_ARROW': r = right ? { rx: -P / 2 + hp, ry: -0.1 + hy, rz: r.rz } : { rx: -0.9424779 + hp, ry: hy - 0.4, rz: P / 2 }; break;
      case 'CROSSBOW_HOLD': r = right ? { rx: -P / 2 + hp + 0.1, ry: -0.3 + hy, rz: r.rz } : { rx: -1.5 + hp, ry: 0.6 + hy, rz: r.rz }; break;
      case 'CROSSBOW_CHARGE': { const f = st.charge, p0 = -0.97079635;
        r = right ? { rx: p0, ry: -0.8, rz: r.rz } : { rx: p0 + (-P / 2 - p0) * f, ry: 0.4 + (0.85 - 0.4) * f, rz: r.rz }; break; }
      case 'CELEBRATING': r = { rx: c32(age * 0.6662) * 0.05, ry: 0, rz: right ? 2.670354 : -P * 3 / 4 }; break;
    }
    return r;
  };
  return { head: { rx: hp, ry: hy, rz: 0 },
    right_leg: st.riding ? { rx: -1.4137167, ry: P / 10, rz: 0.07853982 } : { rx: walk(ls, a, 0.7, 0) },
    left_leg: st.riding ? { rx: -1.4137167, ry: -P / 10, rz: -0.07853982 } : { rx: walk(ls, a, 0.7, PI) },
    right_arm: arm(true), left_arm: arm(false) };
};
const witchO = (ls, a, yaw, pitch, st) => { const f = 0.01 * (st.id % 10);
  return { nose: st.lift ? { rx: -0.9, ry: 0, rz: cos(st.age * f) * 2.5 * DR, dpy: 1 - -2, dpz: -1.5 }
    : { rx: sin(st.age * f) * 4.5 * DR, ry: 0, rz: cos(st.age * f) * 2.5 * DR, dpy: 0, dpz: 0 } }; };
const ravagerO = (ls, a, yaw, pitch, st) => {
  const P = Math.PI, { at, stun, roar, pt } = st, k = 0.4 * a, np = stun > 0 ? 0.21991149 : 0;
  let neck, jaw;
  if (at > 0) {
    const z = ((1 + wrap10(at - pt)) * 0.5) ** 3 * 12;
    neck = { rx: np, dpy: -z * sin(np), dpz: -6.5 + z - 5.5 };
    jaw = at > 5 ? sin((at - 4 - pt) / 4) * P * 0.4 : (P / 20) * sin(P * (at - pt) / 10);
  } else {
    neck = { rx: np, dpx: stun > 0 ? Math.sin(stun / 40 * 10) * 3 : 0, dpy: sin(np) };   // pivotY = -7 - (-1 * sin(neck.pitch))
    jaw = P * (stun > 0 ? 0.05 : 0.01);
    if (stun <= 0 && roar > 0) jaw = (P / 2) * sin((20 - roar - pt) / 20 * P * 0.25);
  }
  return { head: { rx: pitch * DR, ry: yaw * DR, rz: 0 }, neck, mouth: { rx: jaw },
    right_hind_leg: { rx: walk(ls, 1, 1, 0) * k / 1 * (1 / 1) }, left_hind_leg: { rx: walk(ls, 1, 1, PI) * k },
    right_front_leg: { rx: walk(ls, 1, 1, PI) * k }, left_front_leg: { rx: walk(ls, 1, 1, 0) * k } };
};
const FIELDS = ['rx', 'ry', 'rz', 'dpx', 'dpy', 'dpz'];
const SPEC = {
  villager: { fn: villagerO, parts: ['head', 'right_leg', 'left_leg'], states: [{ shake: false, age: 0 }, { shake: true, age: 3 }, { shake: true, age: 41.5 }],
    ctx: (st) => ({ vleg: true, headShake: st.shake, ageInTicks: st.age }), riding: [false, true] },
  illager: { fn: illagerO, parts: ['head', 'right_leg', 'left_leg', 'right_arm', 'left_arm'],
    states: ['CROSSED', 'ATTACKING', 'SPELLCASTING', 'BOW_AND_ARROW', 'CROSSBOW_HOLD', 'CROSSBOW_CHARGE', 'CELEBRATING'].flatMap((state) =>
      [0, 0.5, 1].flatMap((charge) => [{ state, age: 7.3, attackTime: 0.35, mainEmpty: true, leftHanded: false, charge }, { state, age: 19, attackTime: 0.8, mainEmpty: false, leftHanded: false, charge }, { state, age: 55.5, attackTime: 0.1, mainEmpty: false, leftHanded: true, charge }])),
    ctx: (st) => ({ illager: { state: st.state, ageInTicks: st.age, attackTime: st.attackTime, leftHanded: st.leftHanded, mainEmpty: st.mainEmpty, charge: st.charge, rest: {} }, ageInTicks: st.age }), riding: [false, true] },
  witch: { fn: witchO, parts: ['nose'], states: [3, 17, 24].flatMap((id) => [0, 11.5, 88].flatMap((age) => [false, true].map((lift) => ({ id, age, lift })))),
    ctx: (st) => ({ witch: { id: st.id, drinking: st.lift }, ageInTicks: st.age, rest: { px: 0, py: -2, pz: 0, rx: 0, ry: 0, rz: 0 } }), riding: [false] },
  ravager: { fn: ravagerO, parts: ['head', 'neck', 'mouth', 'right_hind_leg', 'left_hind_leg', 'right_front_leg', 'left_front_leg'],
    states: [0, 1, 3, 5, 6, 10].flatMap((at) => [0, 12].flatMap((stun) => [0, 7, 20].flatMap((roar) => [0, 0.6].map((pt) => ({ at, stun, roar, pt }))))),
    ctx: (st) => ({ ravager: { at: st.at, st: st.stun, rt: st.roar, pt: st.pt } }), riding: [false] } };
const REST0 = { neck: { dpx: 0, dpy: -7, dpz: 5.5 }, nose: { dpy: -2 } };
function compareFam(name, mut) {
  const S = SPEC[name]; let worst = 0, at = '';
  for (const ls of [0, 0.37, 2.5, 31]) for (const a of [0, 0.25, 1]) for (const yaw of [-90, 17, 90]) for (const pitch of [-90, 0, 45]) for (const riding of S.riding) for (const st of S.states) {
    const o0 = S.fn(ls, a, yaw, pitch, { ...st, riding }); const o = mut ? mut(o0) : o0;
    for (const p of S.parts) {
      const d = ER.setupAnimDelta(p, ls, a, yaw, pitch, riding, null, S.ctx(st)) || {};
      const want = o[p], rest = REST0[p] || {};
      for (const f of FIELDS) {
        const w = (want[f] || 0) - (f[0] === 'd' ? 0 : 0);
        const g = d[f] || 0, exp = f[0] === 'd' ? (name === 'ravager' && p === 'neck' ? (f === 'dpx' ? w : f === 'dpy' ? w - 0 : w) : w) : w;
        const dv = Math.abs(g - exp - (name === 'ravager' && p === 'neck' && f === 'dpy' ? 0 : 0));
        if (dv > worst) { worst = dv; at = `${name}.${p}.${f} ls=${ls} a=${a} yaw=${yaw} pitch=${pitch}${riding ? ' riding' : ''} ${JSON.stringify(st)} got ${g} want ${exp}`; }
      }
    }
  }
  return { worst, at };
}
const fam2 = {};
for (const k of Object.keys(SPEC)) { fam2[k] = compareFam(k); ok(fam2[k].worst < TOL, `${k}: worst deviation ${fam2[k].worst.toExponential(2)} at ${fam2[k].at}`); if (process.argv.includes('--verbose')) console.log(`  ${k}: worst ${fam2[k].worst.toExponential(2)} at ${fam2[k].at}`); }
const caught2 = (m, name, mut) => { const r = compareFam(name, mut); if (r.worst > TOL) breaks++; else ok(false, 'break NOT caught: ' + m); };
const bump = (part, field, d = 0.01) => (o) => ({ ...o, [part]: { ...o[part], [field]: (o[part][field] || 0) + d } });
for (const p of SPEC.villager.parts) for (const f of p === 'head' ? ['rx', 'ry', 'rz'] : ['rx']) caught2(`villager ${p}.${f} +0.01`, 'villager', bump(p, f));
for (const p of SPEC.illager.parts) for (const f of p.endsWith('arm') ? ['rx', 'ry', 'rz'] : p === 'head' ? ['rx', 'ry'] : ['rx']) caught2(`illager ${p}.${f} +0.01`, 'illager', bump(p, f));
for (const f of ['rx', 'rz', 'dpy', 'dpz']) caught2(`witch nose.${f} +0.01`, 'witch', bump('nose', f));
for (const p of SPEC.ravager.parts) for (const f of p === 'head' ? ['rx', 'ry'] : p === 'neck' ? ['rx', 'dpx', 'dpy', 'dpz'] : ['rx']) caught2(`ravager ${p}.${f} +0.01`, 'ravager', bump(p, f));

// ---- #8924 evoker_fangs: EvokerFangsEntityModel.setAngles + EvokerFangsEntityRenderer scale + getAnimationProgress ----
const EF = src('EvokerFangsEntityModel'), EFR = readFileSync(new URL('../.decomp/net/minecraft/client/render/entity/EvokerFangsEntityRenderer.java', import.meta.url), 'utf8'), EFE = readFileSync(new URL('../.decomp/net/minecraft/entity/mob/EvokerFangsEntity.java', import.meta.url), 'utf8');
for (const [n, s2, pats] of [['EvokerFangsEntityModel', EF, [/\$\$1 \* 2\.0F/, /1\.0F - \$\$6 \* \$\$6 \* \$\$6/, /\(float\) Math\.PI - \$\$6 \* 0\.35F \* \(float\) Math\.PI/, /\(float\) Math\.PI \+ \$\$6 \* 0\.35F \* \(float\) Math\.PI/, /sin\(\$\$1 \* 2\.7F\)\) \* 0\.6F \* 12\.0F/, /24\.0F - \$\$7/]],
  ['EvokerFangsEntityRenderer', EFR, [/\$\$6 > 0\.9F/, /\(1\.0F - \$\$6\) \/ 0\.1F/]], ['EvokerFangsEntity', EFE, [/this\.ticksLeft - 2/, /\(float\)\$\$1 - \$\$0\) \/ 20\.0F/]]])
  for (const p of pats) ok(p.test(s2), `${n}: the decomp no longer contains ${p} — the evoker_fangs oracle is stale`);
const fangsO = (prog) => { let t = f32(prog * 2); if (t > 1) t = 1; t = 1 - t * t * t;
  return { upper_jaw: { rz: Math.PI - t * 0.35 * Math.PI, dpy: -(prog + Math.sin(f32(prog * 2.7))) * 0.6 * 12 },
           lower_jaw: { rz: Math.PI + t * 0.35 * Math.PI, dpy: -(prog + Math.sin(f32(prog * 2.7))) * 0.6 * 12 }, base: { rz: 0, dpy: -(prog + Math.sin(f32(prog * 2.7))) * 0.6 * 12 } }; };
const fangsCompare = (mut) => { let worst = 0, at = '';
  const note = (d, w) => { if (d > worst) { worst = d; at = w; } };
  for (const ticksLeft of [22, 21, 20, 12, 3, 2, 1, 0, -3]) for (const partial of [0, 0.3, 0.9]) {
    const e = { playingAnimation: true, clientTicksLeft: ticksLeft };
    const t = ticksLeft - 2, prog = t <= 0 ? 1 : 1 - (t - partial) / 20;
    note(Math.abs(NS_SP.fangsProgress(e, partial) - prog), `progress ticksLeft=${ticksLeft} partial=${partial}`);
    const progE = mut ? mut.prog(NS_SP.fangsProgress(e, partial)) : NS_SP.fangsProgress(e, partial);
    const A = ER.fangsAnim(progE), O = fangsO(prog);
    for (const part of ['base', 'upper_jaw', 'lower_jaw']) { const g = A.deltaFor(part), w = O[part];
      for (const f of ['rx', 'ry', 'rz', 'dpy']) note(Math.abs((g[f] || 0) - (w[f] || 0)), `${part}.${f} ticksLeft=${ticksLeft} partial=${partial}`); }
    const sc = ER.fangsScale(prog), ws = (prog > 0.9 ? 2 * (1 - prog) / 0.1 : 2) / 2;
    note(Math.abs(sc.sxz - ws) + Math.abs(sc.sy - ws), `scale prog=${prog}`);
  }
  return { worst, at }; };
const NS_SP = M.Spell;
const fangsR = fangsCompare();
ok(fangsR.worst < 1e-5, `evoker_fangs: worst deviation ${fangsR.worst.toExponential(2)} at ${fangsR.at}`);
for (const [m, mut] of [['progress +0.01', { prog: (p) => p + 0.01 }], ['progress *0.9', { prog: (p) => p * 0.9 }]]) { const r = fangsCompare(mut); if (r.worst > 1e-5) breaks++; else ok(false, 'break NOT caught: evoker_fangs ' + m); }
// ---- #8944 llama_spit: LlamaSpitEntityModel (empty setAngles, no own pose) + LlamaSpitEntityRenderer translate/yaw/pitch ----
const LSM = src('LlamaSpitEntityModel'), LSR = readFileSync(new URL('../.decomp/net/minecraft/client/render/entity/LlamaSpitEntityRenderer.java', import.meta.url), 'utf8');
for (const [n, s2, pats] of [['LlamaSpitEntityModel', LSM, [/public void setAngles\(T \$\$0, float \$\$1, float \$\$2, float \$\$3, float \$\$4, float \$\$5\) \{\s*\}/]],
  ['LlamaSpitEntityRenderer', LSR, [/translate\(0\.0, 0\.15F, 0\.0\)/, /POSITIVE_Y\.getDegreesQuaternion\(MathHelper\.lerp\(\$\$2, \$\$0\.prevYaw, \$\$0\.getYaw\(\)\) - 90\.0F\)/, /POSITIVE_Z\.getDegreesQuaternion\(MathHelper\.lerp\(\$\$2, \$\$0\.prevPitch, \$\$0\.getPitch\(\)\)\)/]]])
  for (const p of pats) ok(p.test(s2), `${n}: the decomp no longer contains ${p} — the llama_spit oracle is stale`);
const spitCompare = (mut) => { let worst = 0, at = '';
  const note = (d, w) => { if (d > worst) { worst = d; at = w; } };
  const lift = ER.BASE_SPIT.yOffsetFixed / M.CFG.MODEL_UNITS_PER_BLOCK;
  note(Math.abs(lift - 0.15 - (mut && mut.lift || 0)), 'lift');
  note(ER.BASE_SPIT.flip ? 1 : 0, 'flip');
  for (const [yo, y] of [[0, 0], [10, 30], [-170, 170], [90, 95]]) for (const [po, pp] of [[0, 0], [-20, 40], [15, 15]]) for (const partial of [0, 0.4, 1]) {
    const e = { spitYawO: yo, spitYaw: y, spitPitchO: po, spitPitch: pp };
    const R = ER.spitAnimOf(e, partial).sleepPose.R;
    const a = (yo + (y - yo) * partial - 90 + (mut && mut.yaw || 0)) * Math.PI / 180, b = (po + (pp - po) * partial) * Math.PI / 180;
    const cy = Math.cos(a), sy = Math.sin(a), cz = Math.cos(b), sz = Math.sin(b);
    const W = [cy * cz, -cy * sz, sy, sz, cz, 0, -sy * cz, sy * sz, cy];   // Ry(a) * Rz(b)
    for (let i = 0; i < 9; i++) note(Math.abs(R[i] - W[i]), `R[${i}] yaw ${yo}->${y} pitch ${po}->${pp} partial=${partial}`);
    note(Math.abs(ER.spitYaw(e, partial) - a), `spitYaw ${yo}->${y} partial=${partial}`);
  }
  return { worst, at }; };
const spitR = spitCompare();
ok(spitR.worst < 1e-5, `llama_spit: worst deviation ${spitR.worst.toExponential(2)} at ${spitR.at}`);
for (const [m, mut] of [['lift +0.01', { lift: 0.01 }], ['yaw +1deg', { yaw: 1 }]]) { const r = spitCompare(mut); if (r.worst > 1e-5) breaks++; else ok(false, 'break NOT caught: llama_spit ' + m); }
const OWNV = new Set(['villager', 'wandering_trader', 'evoker', 'illusioner', 'pillager', 'vindicator', 'witch', 'ravager']);
const OWNFAM = { villager: 'villager', wandering_trader: 'villager', evoker: 'illager', illusioner: 'illager', pillager: 'illager', vindicator: 'illager', witch: 'witch', ravager: 'ravager' };

// ---- #8788 panda: PandaEntityModel.setAngles/animateModel (ask for bamboo, sneeze, sit, eat, thunder, lie on back, roll) ----
const PANDA_SRC = src('PandaEntityModel');
for (const lit of ['0.35F', '0.6F', '0.75F', '0.3F', '1.7407963F', '0.27079642F', '0.5707964F', '0.4F', '0.2F', '2.1707964F', '0.9F', '0.15F', '0.25F', '2.0561945F', '14.0F', '5)'])
  ok(PANDA_SRC.includes(lit), `PandaEntityModel: the decomp no longer contains ${lit} - the panda oracle is stale`);
const PD_REST = { head: { rx: 0, ry: 0, rz: 0 }, body: { rx: Math.PI / 2, ry: 0, rz: 0 }, right_front_leg: { rx: 0, ry: 0, rz: 0 }, left_front_leg: { rx: 0, ry: 0, rz: 0 }, right_hind_leg: { rx: 0, ry: 0, rz: 0 }, left_hind_leg: { rx: 0, ry: 0, rz: 0 } };
const PD_STATES = [{}, { ask: 3 }, { sneezing: true, sneezeProgress: 7 }, { sneezing: true, sneezeProgress: 17 }, { sneezing: true, sneezeProgress: 25 },
  { sit: 0.6 }, { sit: 1, eating: true }, { sit: 1, thunder: true }, { sit: 0.5, eating: true, thunder: true }, { lie: 0.7 }, { roll: 0.4 }, { sit: 0.5, lie: 0.5, roll: 0.5, ask: 1 }];
const PD_AGES = [0, 3.7, 40.25];
const interpA = (a, b, t) => { let d = f32(f32(b) - f32(a)); while (d < -PI) d = f32(d + f32(2 * Math.PI)); while (d >= PI) d = f32(d - f32(2 * Math.PI)); return f32(a + f32(t * d)); };
const pandaO = (ls, amt, yaw, pitch, st, age) => {
  const q = quad(ls, amt, yaw, pitch), o = { 'head.rx': q.head.rx, 'head.ry': q.head.ry, 'head.rz': 0, 'body.rx': Math.PI / 2,
    'right_hind_leg.rx': q.right_hind_leg, 'left_hind_leg.rx': q.left_hind_leg, 'right_front_leg.rx': q.right_front_leg, 'left_front_leg.rx': q.left_front_leg,
    'right_front_leg.rz': 0, 'left_front_leg.rz': 0, 'right_hind_leg.rz': 0, 'left_hind_leg.rz': 0 };
  const sn = (k) => sinf(f32(age * k));
  if ((st.ask | 0) > 0) { o['head.ry'] = 0.35 * sn(0.6); o['head.rz'] = 0.35 * sn(0.6); o['right_front_leg.rx'] = -0.75 * sn(0.3); o['left_front_leg.rx'] = 0.75 * sn(0.3); }
  if (st.sneezing) { const sp = st.sneezeProgress | 0; if (sp < 15) o['head.rx'] = -(Math.PI / 4) * sp / 14; else if (sp < 20) o['head.rx'] = -(Math.PI / 4) + (Math.PI / 4) * 0; }
  if (st.sit > 0) {
    o['body.rx'] = interpA(o['body.rx'], 1.7407963, st.sit); o['head.rx'] = interpA(o['head.rx'], Math.PI / 2, st.sit);
    o['right_front_leg.rz'] = -0.27079642; o['left_front_leg.rz'] = 0.27079642; o['right_hind_leg.rz'] = 0.5707964; o['left_hind_leg.rz'] = -0.5707964;
    if (st.eating) { o['head.rx'] = Math.PI / 2 + 0.2 * sn(0.6); o['right_front_leg.rx'] = -0.4 - 0.2 * sn(0.6); o['left_front_leg.rx'] = o['right_front_leg.rx']; }
    if (st.thunder) { o['head.rx'] = 2.1707964; o['right_front_leg.rx'] = -0.9; o['left_front_leg.rx'] = -0.9; }
  }
  if (st.lie > 0) { o['right_hind_leg.rx'] = -0.6 * sn(0.15); o['left_hind_leg.rx'] = 0.6 * sn(0.15); o['right_front_leg.rx'] = 0.3 * sn(0.25); o['left_front_leg.rx'] = -0.3 * sn(0.25); o['head.rx'] = interpA(o['head.rx'], Math.PI / 2, st.lie); }
  if (st.roll > 0) { o['head.rx'] = interpA(o['head.rx'], 2.0561945, st.roll); o['right_hind_leg.rx'] = -0.5 * sn(0.5); o['left_hind_leg.rx'] = 0.5 * sn(0.5); o['right_front_leg.rx'] = 0.5 * sn(0.5); o['left_front_leg.rx'] = -0.5 * sn(0.5); }
  return o;
};
function comparePanda(mut) {
  let worst = 0, at = '';
  for (const st of PD_STATES) for (const age of PD_AGES) for (const ls of LS) for (const a of AMT) for (const yaw of YAW) for (const pitch of PITCH) {
    const o = pandaO(ls, a, yaw, pitch, st, age); if (mut) mut(o);
    const px = Object.assign({ ask: 0, sneezing: false, sneezeProgress: 0, sit: 0, lie: 0, roll: 0, eating: false, thunder: false }, st);
    for (const part of Object.keys(PD_REST)) {
      const rest = PD_REST[part], d = ER.setupAnimDelta(part, ls, a, yaw, pitch, false, 'quadruped', { panda: px, ageInTicks: age, rest }) || {};
      for (const f of ['rx', 'ry', 'rz']) { const k = `${part}.${f}`; if (!(k in o)) continue; const e = (d[f] || 0) + (rest[f] || 0), dv = Math.abs(e - o[k]); if (!(dv <= worst)) { worst = dv; at = `${k} ${JSON.stringify(st)} age=${age} ls=${ls} amt=${a} yaw=${yaw} pitch=${pitch}`; } }
    }
  }
  return { worst, at };
}
const PANDA = comparePanda(); ok(PANDA.worst < TOL, `panda: worst deviation ${PANDA.worst.toExponential(2)} at ${PANDA.at}`);
for (const k of Object.keys(pandaO(1, 1, 0, 0, {}, 1))) { const r = comparePanda((o) => { o[k] += 0.01; }); if (r.worst > TOL) breaks++; else ok(false, `break NOT caught: panda ${k} +0.01`); }

// ---- #8808 pig: PigEntityModel declares no setAngles (QuadrupedEntityModel's, compared above) - its only own numbers are the ctor's baby row ----
const PIGJ = src('PigEntityModel');
const pigCtor = (j) => { const m = /super\(\$\$0, (true|false), ([\d.]+)F, ([\d.]+)F, ([\d.]+)F, ([\d.]+)F, (\d+)\)/.exec(j); return m ? { sh: m[1] === 'true', hy: +m[2], hz: +m[3], hs: +m[4], bs: +m[5], by: +m[6], own: /setAngles/.test(j) } : null; };
const pigCmp = (j) => {
  const c = pigCtor(j); if (!c || c.own) return 1e9;
  const h = ER.babyTransform('pig', 'head'), b = ER.babyTransform('pig', 'body');
  if (!h || !b) return 1e9;
  return Math.max(Math.abs(h.s - (c.sh ? 1.5 / c.hs : 1)), Math.abs(h.oy - c.hy), Math.abs(h.oz - c.hz), Math.abs(b.s - 1 / c.bs), Math.abs(b.oy - c.by), Math.abs(b.oz));
};
if (!M.Entities.ready) M.Entities.init();
const PIGW = pigCmp(PIGJ);
ok(PIGW < TOL, `pig: PigEntityModel ctor baby row vs engine babyTransform, worst ${PIGW}`);
for (const [m, from, to] of [['head y offset', '4.0F, 4.0F, 2.0F, 2.0F, 24', '5.0F, 4.0F, 2.0F, 2.0F, 24'], ['body scale', '4.0F, 4.0F, 2.0F, 2.0F, 24', '4.0F, 4.0F, 2.0F, 3.0F, 24'], ['own setAngles appears', 'extends QuadrupedEntityModel<T> {', 'extends QuadrupedEntityModel<T> { void setAngles(){}']])
  if (pigCmp(PIGJ.replace(from, to)) > TOL) breaks++; else ok(false, 'break NOT caught: pig ' + m);
// ---- #8858 llama / trader_llama / llama_decor: LlamaEntityModel.setAngles chest visibility (head + legs are the grid above) ----
const LLS = src('LlamaEntityModel');
for (const p of [/head\.pitch = \$\$5 \* \(float\) \(Math\.PI \/ 180\.0\)/, /head\.yaw = \$\$4 \* \(float\) \(Math\.PI \/ 180\.0\)/, /rightHindLeg\.pitch = MathHelper\.cos\(\$\$1 \* 0\.6662F\) \* 1\.4F \* \$\$2/,
  /leftHindLeg\.pitch = MathHelper\.cos\(\$\$1 \* 0\.6662F \+ \(float\) Math\.PI\) \* 1\.4F/, /boolean \$\$6 = !\$\$0\.isBaby\(\) && \$\$0\.hasChest\(\)/, /rightChest\.visible = \$\$6/, /leftChest\.visible = \$\$6/])
  ok(p.test(LLS), `LlamaEntityModel: the decomp no longer contains ${p} — the llama oracle is stale`);
const llamaChest = (baby, chest, mutate) => { const v = !baby && chest; return mutate ? !v : v; };
function llamaCmp(mutate) {
  let worst = 0, at = '';
  for (const type of ['llama', 'trader_llama']) for (const baby of [false, true]) for (const chest of [false, true]) {
    const e = { type, hasChest: chest, growAge: baby ? -24000 : 0 };
    const hid = M.Mount.hideChestParts(e);
    const got = !(hid && hid.left_chest && hid.right_chest);
    if (got !== llamaChest(baby, chest, mutate)) { worst = 1; at = `${type} baby=${baby} chest=${chest}`; }
  }
  return { worst, at };
}
if (M.Breed) M.Breed.ready = true;
const LLR = llamaCmp();
ok(LLR.worst < TOL, `llama chest visibility (baby/chest) differs at ${LLR.at}`);
if (llamaCmp(true).worst > TOL) breaks++; else ok(false, 'break NOT caught: llama chest visibility');
// ---- per-mob output: every roster mob has a row ----
const PK = JSON.parse(readFileSync(R('./mobproof-anim-known.json'), 'utf8'));
const OUT = {}; const OWN7792 = new Set(['creeper', 'spider', 'cave_spider', 'silverfish', 'endermite', 'enderman']);
const FISHM = { fish: 'cod', pufferfish: 'puffer', tropical_fish: 'tropical' };   // 'fish' row stands for cod; salmon is compared above
const GEN = 'head/limb pose beyond the base class (specialised setAngles, arms/attack/death/hurt/baby/riding/sleeping/swimming/flying states, tail/ear/jaw/wing parts) is not compared yet';
// ---- #8922 end_crystal: EndCrystalEntityRenderer's own bob/spin/tilt maths, literals re-read from the decomp each run ----
const ECS = readFileSync(new URL('../EndCrystalEntityRenderer.java', MD), 'utf8');
const ecLit = (re, what) => { const m = re.exec(ECS); ok(!!m, `end_crystal: decomp no longer contains ${what}`); return m ? m.slice(1).map(Number) : [0, 0, 0, 0]; };
const [EC_F, EC_D1, EC_H, EC_K, EC_SC] = [ecLit(/sin\(\$\$2 \* ([\d.]+)F\) \/ ([\d.]+)F \+ ([\d.]+)F/, 'bob sin literals'), ecLit(/\* \$\$3 \+ \$\$3\) \* ([\d.]+)F;\s*return \$\$3 - ([\d.]+)F/, 'bob scale/offset'), ecLit(/endCrystalAge \+ \$\$2\) \* ([\d.]+)F/, 'spin rate'), ecLit(/getYOffset\(\$\$0, \$\$2\);[\s\S]*?translate\(0\.0, \(double\)\(([\d.]+)F \+ \$\$6 \/ ([\d.]+)F\)/, 'frame lift'), ecLit(/Quaternion\(new Vec3f\(SINE_45_DEGREES, 0\.0F, SINE_45_DEGREES\), ([\d.]+)F, true\)[\s\S]*?scale\(([\d.]+)F, [\d.]+F, [\d.]+F\)/, 'tilt/scale')];
function ecOracle(mut) {
  const m = (a, b) => { const r = []; for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) r.push(a[i * 3] * b[j] + a[i * 3 + 1] * b[3 + j] + a[i * 3 + 2] * b[6 + j]); return r; };
  const quat = (x, y, z, w) => [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w), 2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w), 2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)];
  const s45 = Math.sin(Math.PI / 4), ha = EC_SC[0] * Math.PI / 180 / 2, sh = Math.sin(ha);
  const TILT = quat(s45 * sh, 0, s45 * sh, Math.cos(ha));
  let worst = 0, at = '';
  for (const age of [0, 1, 7, 40, 333]) for (const pt of [0, 0.25, 0.9]) {
    const bumpB = mut ? 0.01 : 0, bumpS = mut ? 0.01 : 0;
    const t = age + pt, sn = Math.sin(t * EC_F[0]) / EC_F[1] + EC_F[2], bob = (sn * sn + sn) * EC_D1[0] - EC_D1[1] + bumpB;
    const a = t * EC_H[0] * Math.PI / 180 + bumpS, c = Math.cos(a), sa = Math.sin(a), Ry = [c, 0, sa, 0, 1, 0, -sa, 0, c];
    const R1 = m(Ry, TILT), R2 = m(m(R1, TILT), Ry), R3 = m(m(R2, TILT), Ry);
    const e = { endCrystalAge: age, x: 0, y: 0, z: 0, prevX: 0, prevY: 0, prevZ: 0 }, out = [];
    ER.pushEndCrystal(e, 0, 0, 0, pt, out, []);
    const want = [['glass', R1, 2], ['glass', R2, 1.75], ['cube', R3, EC_SC[1] * EC_SC[1] * 2]];
    const got = out.filter((o) => o.ecPart !== 'base');
    if (got.length !== 3) { worst = 1; at = 'push count'; continue; }
    got.forEach((o, i) => {
      const G = ER.rotMatrix(o.ecRot.rx, o.ecRot.ry, o.ecRot.rz), errs = [o.y - (2 + bob), o.ecScale - want[i][2]];
      for (let k = 0; k < 9; k++) errs.push(G[k] - want[i][1][k]);
      const w = Math.max(...errs.map(Math.abs)); if (w > worst) { worst = w; at = `${want[i][0]}#${i} age ${age} pt ${pt}`; }
    });
    const yo = Math.abs(ER.crystalYOffset(e, pt) - bob); if (yo > worst) { worst = yo; at = `crystalYOffset age ${age}`; }
  }
  return { worst, at };
}
const ecR = ecOracle(false); ok(ecR.worst < TOL, `end_crystal: worst deviation ${ecR.worst.toExponential(2)} at ${ecR.at}`);
if (ecOracle(true).worst > TOL) breaks++; else ok(false, 'break NOT caught: end_crystal bob+spin +0.01');
// ---- #8947 minecart family: MinecartEntityRenderer.render pose (rail snap, slope pitch, wobble, jitter), literals re-read from the decomp ----
const MCS = readFileSync(new URL('../MinecartEntityRenderer.java', MD), 'utf8');
for (const p of [/snapPositionToRailWithOffset\(\$\$10, \$\$11, \$\$12, 0\.3F\)/, /snapPositionToRailWithOffset\(\$\$10, \$\$11, \$\$12, -0\.3F\)/, /\(\$\$16\.y \+ \$\$17\.y\) \/ 2\.0 - \$\$11/, /Math\.atan2\(\$\$18\.z, \$\$18\.x\) \* 180\.0 \/ Math\.PI/, /Math\.atan\(\$\$18\.y\) \* 73\.0/,
  /translate\(0\.0, 0\.375, 0\.0\)/, /getDegreesQuaternion\(180\.0F - \$\$1\)/, /POSITIVE_Z\.getDegreesQuaternion\(-\$\$15\)/, /MathHelper\.sin\(\$\$19\) \* \$\$19 \* \$\$20 \/ 10\.0F \* \(float\)\$\$0\.getDamageWobbleSide\(\)/, /\* 493286711L/, /\* 0\.004F/])
  ok(p.test(MCS), `minecart: decomp no longer contains ${p} — the oracle is stale`);
function cartOracle(mut) {
  const mu = (a, b) => { const r = []; for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) r.push(a[i * 3] * b[j] + a[i * 3 + 1] * b[3 + j] + a[i * 3 + 2] * b[6 + j]); return r; };
  const RY = (d) => { const t = d * Math.PI / 180, c = Math.cos(t), s = Math.sin(t); return [c, 0, s, 0, 1, 0, -s, 0, c]; };
  const RZ = (d) => { const t = d * Math.PI / 180, c = Math.cos(t), s = Math.sin(t); return [c, -s, 0, s, c, 0, 0, 0, 1]; };
  const RX = (d) => { const t = d * Math.PI / 180, c = Math.cos(t), s = Math.sin(t); return [1, 0, 0, 0, c, -s, 0, s, c]; };
  const bump = mut ? 0.01 : 0;
  const snap = (x, y, z, off) => off === undefined ? [x + 0.1, y + 0.2, z - 0.05] : [x + off * 0.8, y + 0.2 + off * 0.6, z + off * 0.1];
  let worst = 0, at = '';
  for (const yaw of [0, 37, -120, 200]) for (const pitch of [0, 20, -35]) for (const wob of [[0, 0, 1], [3, 5, 1], [7.5, 12, -1]]) for (const pt of [0, 0.4, 1]) for (const rail of [false, true]) for (const id of [0, 7, 123456]) {
    const e = { type: 'minecart', id, cartYaw: yaw, cartYawO: yaw, cartPitch: pitch, cartPitchO: pitch - 10, cartDamageWobble: { ticks: wob[0], strength: wob[1], side: wob[2] } };
    const p = [3.5, 64.25, -2.75];
    if (rail) e.cartSnap = snap;
    const P = M.MinecartRender.pose(e, pt, p);
    let y = yaw, pi = pitch + (pitch - 10 - pitch) * (1 - pt) * -1 * -1, dx = 0, dy = 0, dz = 0;
    pi = (pitch - 10) + (pitch - (pitch - 10)) * pt;
    if (rail) {
      const s0 = snap(...p), a = snap(...p, 0.3), b = snap(...p, -0.3);
      dx = s0[0] - p[0]; dy = (a[1] + b[1]) / 2 - p[1]; dz = s0[2] - p[2];
      const v = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], l = Math.hypot(...v);
      y = Math.atan2(v[2] / l, v[0] / l) * 180 / Math.PI; pi = Math.atan(v[1] / l) * 73;
    }
    let R = mu(RY(180 - y + bump * 100), RZ(-pi));
    const wt = wob[0] - pt, ws = Math.max(0, wob[1] - pt);
    if (wt > 0) R = mu(R, RX(Math.sin(wt) * wt * ws / 10 * wob[2]));
    let a = BigInt.asIntN(64, BigInt(id) * 493286711n); a = BigInt.asIntN(64, BigInt.asIntN(64, a * a * 4392167121n) + BigInt.asIntN(64, a * 98761n));
    const j = [16n, 20n, 24n].map((sh) => (((Number((a >> sh) & 7n) + 0.5) / 8) - 0.5) * 0.004);
    const want = [dx + j[0], dy + j[1] + 0.375, dz + j[2]], got = [P.dx, P.dy, P.dz], ctx = `yaw=${yaw} pitch=${pitch} wob=${wob} pt=${pt} rail=${rail} id=${id}`;
    const errs = [...want.map((w, i) => Math.abs(w - got[i])), ...R.map((w, i) => Math.abs(w - P.R[i]))];
    const w = Math.max(...errs); if (w > worst) { worst = w; at = ctx; }
  }
  return { worst, at };
}
const cartR = cartOracle(false); ok(cartR.worst < 1e-9, `minecart: worst deviation ${cartR.worst.toExponential(2)} at ${cartR.at}`);
if (cartOracle(true).worst > 1e-9) breaks++; else ok(false, 'break NOT caught: minecart yaw +0.01');
// ---- #9154 PiglinEntityModel.setAngles: ears (limb swing + age), dancing, admiring, crossbow hold/charge, main-arm raise ----
const PG = src('PiglinEntityModel');
for (const p of [/\$\$3 \* 0\.1F \+ \$\$1 \* 0\.5F/, /0\.08F \+ \$\$2 \* 0\.4F/, /\(float\) \(-Math\.PI \/ 6\) - MathHelper\.cos\(\$\$7 \* 1\.2F\) \* \$\$8/, /\(float\) \(Math\.PI \/ 6\) \+ MathHelper\.cos\(\$\$7\) \* \$\$8/,
  /\$\$3 \/ 60\.0F/, /MathHelper\.sin\(\$\$11 \* 30\.0F\) \* 10\.0F/, /MathHelper\.cos\(\$\$11 \* 30\.0F\) \* 10\.0F/, /pivotX = MathHelper\.sin\(\$\$11 \* 10\.0F\)/, /MathHelper\.sin\(\$\$11 \* 40\.0F\) \+ 0\.4F/,
  /\(70\.0F \+ MathHelper\.cos\(\$\$11 \* 40\.0F\) \* 10\.0F\)/, /MathHelper\.sin\(\$\$11 \* 40\.0F\) \* 0\.5F \+ 1\.5F/, /MathHelper\.sin\(\$\$11 \* 40\.0F\) \* 0\.35F/, /this\.head\.pitch = 0\.5F/, /yaw = -0\.5F/, /pitch = -0\.9F/, /yaw = 0\.5F/, /pitch = -1\.8F/,
  /CrossbowPosing\.hold\(this\.rightArm, this\.leftArm, this\.head/, /CrossbowPosing\.charge\(this\.rightArm, this\.leftArm/])
  ok(p.test(PG), `PiglinEntityModel: the decomp no longer contains ${p} — the piglin oracle is stale`);
for (const p of [/\$\$4\.yaw = \(\$\$3 \? -0\.3F : 0\.3F\) \+ \$\$2\.yaw/, /\$\$5\.yaw = \(\$\$3 \? 0\.6F : -0\.6F\) \+ \$\$2\.yaw/, /-Math\.PI \/ 2\) \+ \$\$2\.pitch \+ 0\.1F/, /\$\$5\.pitch = -1\.5F \+ \$\$2\.pitch/, /MathHelper\.lerp\(\$\$8, 0\.4F, 0\.85F\)/])
  ok(p.test(CP), `CrossbowPosing: the decomp no longer contains ${p} — the piglin oracle is stale`);
function piglinOracle(part, st, ls, amt, age, hy, hp, lefty, ch) {
  const D = f32(Math.PI / 180), P6 = f32(Math.PI / 6), t = f32(f32(age * 0.1) + f32(ls * 0.5)), a = f32(0.08 + f32(amt * 0.4)), R = !lefty;
  const hr = { rx: f32(hp * D), ry: f32(hy * D) };
  if (st === 'dance') {
    const u = f32(age / 60);
    if (part === 'right_ear') return { rz: P6 + D * sn(u * 30) * 10 };
    if (part === 'left_ear') return { rz: -P6 - D * cos(u * 30) * 10 };
    if (part === 'head') return { dpx: sn(u * 10), dpy: sn(u * 40) + 0.4, ...hr };
    if (part === 'body') return { dpy: sn(u * 40) * 0.35 };
    const rz = D * (70 + cos(u * 40) * 10);
    if (part === 'right_arm') return { rz, dpy: sn(u * 40) * 0.5 + 1.5 };
    if (part === 'left_arm') return { rz: -rz, dpy: sn(u * 40) * 0.5 + 1.5 };
    return null;
  }
  if (part === 'left_ear') return { rz: -P6 - cos(f32(t * 1.2)) * a };
  if (part === 'right_ear') return { rz: P6 + cos(t) * a };
  const main = R ? 'right_arm' : 'left_arm', off = R ? 'left_arm' : 'right_arm';
  if (st === 'admire') { if (part === 'head') return { rx: 0.5, ry: 0 }; if (part === (lefty ? 'right_arm' : 'left_arm')) return { rx: -0.9, ry: lefty ? -0.5 : 0.5 }; return null; }
  if (st === 'melee') return part === main ? { rx: -1.8 } : null;
  if (st === 'hold') {
    if (part === main) return { rx: f32(-PI / 2 + hr.rx + 0.1), ry: f32((R ? -0.3 : 0.3) + hr.ry) };
    if (part === off) return { rx: f32(-1.5 + hr.rx), ry: f32((R ? 0.6 : -0.6) + hr.ry) };
    return null;
  }
  if (st === 'charge') {
    const p0 = f32(-0.97079635);
    if (part === main) return { rx: p0, ry: R ? -0.8 : 0.8 };
    if (part === off) return { rx: f32(p0 + f32(ch * f32(-PI / 2 - p0))), ry: f32(f32(0.4 + f32(ch * f32(0.85 - 0.4)))) * (R ? 1 : -1) };
  }
  return null;
}
function comparePiglin(mut) {
  let worst = 0, at = '';
  const rest = { rx: 0, ry: 0, rz: 0, px: 0, py: 0, pz: 0 };
  const states = [['default', null], ['dance', null], ['admire', 'admire'], ['melee', null], ['hold', 'hold'], ['charge', 'charge']];
  for (const [st, pose] of states) for (const ls of LS) for (const a of AMT) for (const age of [0, 3.5, 17.25, 123.4]) for (const hy of [-40, 0, 25]) for (const hp of [-30, 0, 45]) for (const lefty of [false, true]) for (const ch of (st === 'charge' ? [0, 0.4, 1] : [0])) {
    for (const part of ['left_ear', 'right_ear', 'head', 'body', 'left_arm', 'right_arm']) {
      let o = piglinOracle(part, st, ls, a, age, hy, hp, lefty, ch); if (!o) continue;
      if (mut) { o = { ...o }; mut(o, part, st); }
      const d = CALL(part, ls, a, hy, hp, 'humanoid', { piglin: true, piglinDance: st === 'dance', piglinPose: pose, piglinMelee: st === 'melee', attackTime: 0, biped: true, ageInTicks: age, leftHanded: lefty, charge: ch, rest });
      for (const k of ['rx', 'ry', 'rz', 'dpx', 'dpy']) {
        if (o[k] === undefined) continue;
        const x = Math.abs((d[k] || 0) - o[k]); if (x > worst) { worst = x; at = `${st}.${part}.${k} ls=${ls} amt=${a} age=${age} hy=${hy} hp=${hp} lefty=${lefty} ch=${ch}`; }
      }
    }
  }
  return { worst, at };
}
const PGR = comparePiglin(); ok(PGR.worst < TOL, `piglin: worst deviation ${PGR.worst.toExponential(2)} at ${PGR.at}`);
for (const [m, mut] of [['piglin ear roll +0.01', (o, p) => { if (p.endsWith('_ear')) o.rz += 0.01; }], ['piglin dance head pivot +0.01', (o, p, s) => { if (s === 'dance' && p === 'head') o.dpy += 0.01; }],
  ['piglin dance arm roll +0.01', (o, p, s) => { if (s === 'dance' && p === 'left_arm') o.rz += 0.01; }], ['piglin admire head pitch +0.01', (o, p, s) => { if (s === 'admire' && p === 'head') o.rx += 0.01; }],
  ['piglin hold main arm yaw +0.01', (o, p, s) => { if (s === 'hold' && o.ry !== undefined) o.ry += 0.01; }], ['piglin charge off arm pitch +0.01', (o, p, s) => { if (s === 'charge') o.rx += 0.01; }],
  ['piglin melee arm pitch +0.01', (o, p, s) => { if (s === 'melee') o.rx += 0.01; }]]) { if (comparePiglin(mut).worst > TOL) breaks++; else ok(false, 'break NOT caught: ' + m); }
const PIGLIN_DONE = new Set(['piglin', 'piglin_brute', 'zombified_piglin']);
for (const mob of ROSTER) {
  const row = { pass: true, checked: [], notCovered: [GEN], failed: [] };
  const HORSEY = new Set(['horse', 'donkey', 'mule', 'skeleton_horse', 'zombie_horse']);
  if (HORSEY.has(mob)) { row.notCovered = []; row.checked.push(`HorseEntityModel.animateModel (head/neck, body, 4 legs + baby legs, tail; rearing/eating/grazing/water/tail-wag/baby) worst ${fam.horse.worst.toExponential(2)}`); if (fam.horse.worst >= TOL) { row.pass = false; row.failed.push(`horse worst ${fam.horse.worst} at ${fam.horse.at}`); } }
  if (fam[mob] && (mob === 'cat' || mob === 'ocelot')) { row.checked.push(`feline pose (8 parts: legs/tails/body/head; crouch/sprint${mob === 'cat' ? '/sitting/sleep/headDown' : ''}), worst ${fam[mob].worst.toExponential(2)}`); row.notCovered = []; if (fam[mob].worst >= TOL) { row.pass = false; row.failed.push(`feline worst ${fam[mob].worst} at ${fam[mob].at}`); } OUT[mob] = row; continue; }
  if (mob === 'pig') row.notCovered = [];
  const kind = LLAMA.has(mob) || QUAD.has(mob) ? 'quadruped' : BIPED.has(mob) ? 'humanoid' : null;
  if (kind) {
    const r = fam[kind];
    row.checked.push(`${kind} head yaw/pitch + ${kind === 'quadruped' ? 'four legs' : 'two legs + riding legs'} over ${LS.length * AMT.length * YAW.length * PITCH.length} grid points, worst ${r.worst.toExponential(2)}`);
    if (r.worst >= TOL) { row.pass = false; row.failed.push(`${kind} worst ${r.worst} at ${r.at}`); }
    if (LLAMA.has(mob)) { row.notCovered = []; row.checked.push(`LlamaEntityModel chest visibility (baby/chest), worst ${LLR.worst}`); if (LLR.worst >= TOL) { row.pass = false; row.failed.push('llama chest ' + LLR.at); } }
    if (PIGLIN_DONE.has(mob)) { row.notCovered = row.notCovered.filter((n) => n !== GEN); row.checked.push(`PiglinEntityModel.setAngles (ears by limb swing+age, dancing, admiring, crossbow hold/charge, main-arm raise), worst ${PGR.worst.toExponential(2)}`); if (PGR.worst >= TOL) { row.pass = false; row.failed.push(`piglin worst ${PGR.worst} at ${PGR.at}`); } }
    if (mob === 'cow' || mob === 'mooshroom') row.notCovered = [];   // #8809: no setAngles override; ctor baby literals compared above
    if (mob === 'zombie_villager' || mob === 'drowned') { row.notCovered = []; row.checked.push(mob === 'drowned' ? `DrownedEntityModel.setAngles (swimming lean arms/legs/head/hat, trident arm), worst ${DRW.worst.toExponential(2)}` : 'ZombieVillagerEntityModel: no setAngles override (zombie pose; hat/hat_rim visibility only)'); if (DRW.worst >= TOL) { row.pass = false; row.failed.push(`drowned worst ${DRW.worst} at ${DRW.at}`); } }
    if (['skeleton', 'stray', 'wither_skeleton'].includes(mob)) { row.notCovered = []; row.checked.push(`SkeletonEntityModel.animateModel/setAngles: bow BOW_AND_ARROW arms (head yaw/pitch, handedness, bob) worst ${bowR.worst.toExponential(2)}; aggressive melee arms worst ${ARMS.skeleton.worst.toExponential(2)}`); if (bowR.worst >= TOL || ARMS.skeleton.worst >= TOL) { row.pass = false; row.failed.push('skeleton arms ' + bowR.at + ' / ' + ARMS.skeleton.at); } }   // #9153
    if (mob === 'zombie' || mob === 'husk' || mob === 'giant') { row.notCovered = []; row.checked.push('ZombieEntityModel/AbstractZombieModel/GiantEntityModel add no pose maths beyond BipedEntityModel + meleeAttack (head, legs, riding, baby, arms compared above)'); }   // #9151
    if (kind === 'humanoid' && !ARM_DONE.has(mob)) row.notCovered.push('arms: swing/attack/charge/aggressive arms are posed by the arm layers (ZombieArms, bow, crossbow, illager) and are not compared');
  } else if (OWN7791[mob]) {
    const r = ownRes7791[mob];
    row.notCovered = [];
    row.checked.push(`own pose maths: ${r.fields.length} fields (${mob}) over ${OWN7791[mob].states.length} states, worst ${r.worst.toExponential(2)}`);
    if (r.worst >= TOL) { row.pass = false; row.failed.push(`${mob} worst ${r.worst} at ${r.at}`); }
  } else if (mob === 'shulker_bullet') {
    row.notCovered = [];
    row.checked.push(`ShulkerBulletEntityRenderer spin/bob + model yaw/pitch, worst ${sbWorst.toExponential(2)}`);
    if (sbWorst >= TOL) { row.pass = false; row.failed.push('shulker_bullet worst ' + sbWorst); }
  } else if (mob === 'wither_skull') {
    row.notCovered = [];
    row.checked.push(`WitherSkullEntityRenderer yaw/pitch lerp + SkullEntityModel.setHeadRotation, worst ${wsWorst.toExponential(2)}`);
    if (wsWorst >= TOL) { row.pass = false; row.failed.push('wither_skull worst ' + wsWorst); }
  } else if (OWN7790.has(mob)) {
    row.checked.push(`own setAngles (${mob}) over ${ownCases7790[mob].length} grid points, worst ${own7790[mob].worst.toExponential(2)}`);
    row.notCovered = [];
    if (own7790[mob].worst >= TOL) { row.pass = false; row.failed.push(`${mob} worst ${own7790[mob].worst} at ${own7790[mob].at}`); }
  } else if (mob === 'trident') {
    row.notCovered = [];
    row.checked.push(`TridentEntityRenderer yaw-90/pitch+90 lerp pose (5x4x4 grid), worst ${trWorst.toExponential(2)}`);
    if (trWorst >= TOL) { row.pass = false; row.failed.push(`trident worst ${trWorst}`); }
  } else if (mob === 'end_crystal') {
    row.notCovered = [];
    row.checked.push(`EndCrystalEntityRenderer bob/spin/tilt/scale chain (3 pushes x 15 age/tick pairs), worst ${ecR.worst.toExponential(2)}`);
    if (ecR.worst >= TOL) { row.pass = false; row.failed.push(`end_crystal worst ${ecR.worst} at ${ecR.at}`); }
  } else if (OWN_MOBS[mob]) {
    const r = ownRes93[OWN_MOBS[mob]] || { worst: slimeWorst };
    row.notCovered = (mob === 'shulker' || mob === 'hoglin' || mob === 'zoglin' || mob === 'slime' || mob === 'magma_cube' || mob === 'snow_golem' || mob === 'iron_golem') ? [] : [GEN];   // #8896: slime/magma_cube compared above (own93)
    row.checked.push(`own setAngles maths (${OWN_MOBS[mob]}) over ${OWN_MOBS[mob] === 'slime' ? 'the limbSwing grid' : own93[OWN_MOBS[mob]].states.length + ' states'}, worst ${r.worst.toExponential(2)}`);
    if (r.worst >= TOL) { row.pass = false; row.failed.push(`own pose worst ${r.worst}`); }
  } else if (OWN7788.has(mob)) {
    row.checked.push(`${mob}: own setAngles (legs/body/bristles/ram head) over the limb/head grid + states, worst ${ownR.worst.toExponential(2)}`);
    if (ownR.worst >= TOL) { row.pass = false; row.failed.push(`own-pose worst ${ownR.worst} at ${ownR.at}`); }
    row.notCovered = [];
  } else if (mob === 'panda') {
    row.notCovered = [];
    row.checked.push(`panda PandaEntityModel (head/body/four legs; ask-for-bamboo, sneeze, sit, eat, thunder, lie on back, roll) over ${PD_STATES.length} states x age x the grid, worst ${PANDA.worst.toExponential(2)}`);
    if (PANDA.worst >= TOL) { row.pass = false; row.failed.push(`panda worst ${PANDA.worst} at ${PANDA.at}`); }
  } else if (mob === 'axolotl') {
    row.checked.push(`axolotl: cache-mixed pose (play dead, swim, swim-still, walk, stand, air; all 10 parts + body pivotY) over chained state sequences, worst ${axR.worst.toExponential(2)}`);
    if (axR.worst >= TOL) { row.pass = false; row.failed.push(`axolotl worst ${axR.worst} at ${axR.at}`); }
    row.notCovered = [];
  } else if (OWN7787.has(mob)) {
    row.checked.push('own setAngles (dolphin body/tail, squid tentacles, guardian head/spikes/tail) over the age x state x yaw grid');
    if (mob === 'guardian' || mob === 'elder_guardian') row.notCovered = [];
    if (mob === 'elder_guardian') { const E = src('../ElderGuardianEntityRenderer'), EE = readFileSync(new URL('net/minecraft/entity/mob/ElderGuardianEntity.java', new URL('../../../../../../', MD)), 'utf8'); ok(/scale\(ElderGuardianEntity\.SCALE/.test(E) && /EntityType\.field_6086\.getWidth\(\) \/ EntityType\.field_6118\.getWidth\(\)/.test(EE), 'elder guardian scale is no longer width ratio'); row.checked.push('elder_guardian: shared GuardianEntityModel spikes/tail/eye + width-ratio scale'); }
    if (mob === 'squid' || mob === 'glow_squid' || mob === 'dolphin') { row.notCovered = []; if (own.worst >= TOL) { row.pass = false; row.failed.push(`${mob} worst ${own.worst} at ${own.at}`); } }
  } else if (mob === 'rabbit' || mob === 'bee') {
    row.checked.push(`${mob} own setAngles (all assigned parts, jump / bee still,angry,bodyPitch states), worst ${own.worst.toExponential(2)}`);
    if (own.worst >= TOL) { row.pass = false; row.failed.push(`${mob} worst ${own.worst} at ${own.at}`); }
    if (mob === 'rabbit' || mob === 'bee') row.notCovered = [];   // #8784: BeeEntityModel pose compared in full above
  } else if (ownRes[mob]) {
    const r = ownRes[mob];
    if (mob === 'fox') row.notCovered = [];   // #8787 FoxEntityModel setAngles/animateModel compared above
    row.checked.push(`${mob} own setAngles (rotations + pivots of every part) over ${OWN[mob].states.length} states x grid, worst ${r.worst.toExponential(2)}`);
    if (r.worst >= TOL) { row.pass = false; row.failed.push(`${mob} worst ${r.worst} at ${r.at}`); }
    if (mob === 'polar_bear') row.notCovered = [];
  } else if (mob === 'wolf') { row.notCovered = []; row.checked.push(`wolf WolfEntityModel pose (legs, head, tail angle from health/anger, sitting pivots, begging/shake rolls), worst ${wolfR.worst.toExponential(2)}`); if (!WOLF_OK) { row.pass = false; row.failed.push(`wolf worst ${wolfR.worst} at ${wolfR.at}`); }
  } else if (mob === 'sheep') {
    row.notCovered = [];
    row.checked.push(`sheep head pitch/yaw/neck pivotY + four legs over eatGrassTimer x partial grid, worst ${sheepR.worst.toExponential(2)}`);
    if (sheepR.worst >= 1e-4) { row.pass = false; row.failed.push(`sheep worst ${sheepR.worst} at ${sheepR.at}`); }
  } else if (PL[mob]) {
    row.checked.push(mob === 'armor_stand' ? 'every part Pose triple (default + NBT), hat/sticks/base plate over 4 stands' : `BipedEntityModel.setAngles: head/body/arms/legs + overlays, sneak/riding/swim-crawl/elytra-roll states over ${PSTATES.length} states, worst ${PL[mob].worst.toExponential(2)}`);
    if (PL[mob].worst >= TOL) { row.pass = false; row.failed.push(`${mob} worst ${PL[mob].worst}`); }
    row.notCovered = [];   // #8871/#8872: PlayerEntityModel and ArmorStandEntityModel poses compared above
  } else if (mob === 'chicken') {
    row.notCovered = [];
    row.checked.push(`chicken head/beak/wattle yaw+pitch, two legs, two wing rolls over ${LS.length * AMT.length * YAW.length * PITCH.length * WING.length} grid points, worst ${CH.worst.toExponential(2)}`);
    if (CH.worst >= TOL) { row.pass = false; row.failed.push(`chicken worst ${CH.worst} at ${CH.at}`); }
  } else if (FISHM[mob]) { const r = FF[FISHM[mob]]; row.notCovered = []; if (r.worst >= TOL) { row.pass = false; row.failed.push(`${mob} worst ${r.worst} at ${r.at}`); } row.checked.push(`own setAngles (tail yaw / fin roll, in water and out of water) over ${AGE.length * 2} ageInTicks x water points, worst ${r.worst.toExponential(2)}`);
  } else if (mob === 'leash_knot') {
    row.notCovered = [];   // #8945
    row.checked.push('leash_knot renderer scale(-1,-1,1), setAngles(0..) and model yaw/pitch maths, worst ' + lkR);
    if (lkR >= 1e-9) { row.pass = false; row.failed.push('leash_knot worst ' + lkR); }
  } else if (mob === 'llama_spit') {
    row.notCovered = [];   // #8944: empty setAngles + renderer lift/yaw/pitch compared above
    row.checked.push(`llama_spit renderer 0.15 lift, lerped yaw-90 / pitch rotation matrix over a yaw x pitch x partial grid, no-op model setAngles, worst ${spitR.worst.toExponential(2)}`);
    if (spitR.worst >= 1e-5) { row.pass = false; row.failed.push(`llama_spit worst ${spitR.worst} at ${spitR.at}`); }
  } else if (mob === 'evoker_fangs') {
    row.notCovered = [];   // #8924: EvokerFangsEntityModel.setAngles + renderer scale + progress compared above
    row.checked.push(`evoker_fangs jaw rolls, shared pivotY lift, renderer scale, getAnimationProgress over 27 ticksLeft x partial points, worst ${fangsR.worst.toExponential(2)}`);
    if (fangsR.worst >= 1e-5) { row.pass = false; row.failed.push(`evoker_fangs worst ${fangsR.worst} at ${fangsR.at}`); }
  } else if (OWNV.has(mob)) {
    if (mob === 'witch') row.notCovered = [];   // #8868: WitchEntityModel nose pose compared in full by fam2.witch
    const r = fam2[OWNFAM[mob]];
    if (OWNFAM[mob] === 'illager') row.notCovered = [];   // #8869: IllagerEntityModel.setAngles (crossed/attacking/spellcasting/bow/crossbow/celebrating, riding, head, legs) compared above
    row.checked.push(`${OWNFAM[mob]} own setAngles/animateModel (head, legs, arms/nose/neck/jaw by state) over ${SPEC[OWNFAM[mob]].states.length} states x the grid, worst ${r.worst.toExponential(2)}`);
    if (r.worst >= TOL) { row.pass = false; row.failed.push(`${OWNFAM[mob]} worst ${r.worst} at ${r.at}`); }
    if (mob === 'ravager') row.notCovered = [];   // #8870: RavagerEntityModel setAngles/animateModel compared in full above
    if (OWNFAM[mob] === 'villager') row.notCovered = [];   // #8867: VillagerResemblingModel head shake + legs compared
  } else if (M.MinecartRender.is(mob)) {
    row.notCovered = [];   // #8947: MinecartEntityRenderer pose compared above
    row.checked.push(`MinecartEntityRenderer rail snap/slope pitch/wobble/jitter pose matrix + offset over a yaw x pitch x wobble x partial x rail grid, worst ${cartR.worst.toExponential(2)}`);
    if (cartR.worst >= 1e-9) { row.pass = false; row.failed.push(`${mob} worst ${cartR.worst} at ${cartR.at}`); }
  } else if (mob === 'boat') {
    row.notCovered = [];   // #8923: paddle angles + renderer yaw/wobble/bubble pose compared above
    row.checked.push(`BoatEntityModel.setPaddleAngle + BoatEntityRenderer pose matrix over a phase/yaw/wobble/bubble grid, worst ${boatR.worst.toExponential(2)}`);
    if (boatR.worst >= 1e-4) { row.pass = false; row.failed.push(`boat worst ${boatR.worst} at ${boatR.at}`); }
  } else if (OWN7792.has(mob)) (['creeper', 'spider', 'cave_spider', 'silverfish', 'endermite', 'enderman'].includes(mob) && (row.notCovered = [])), row.checked.push('own setAngles maths (#7792) over its limb/head/age/state grid, worst ' + own7792.worst.toExponential(2)), own7792.worst >= T7 && (row.pass = false, row.failed.push('own maths ' + own7792.at));
  else if (!HORSEY.has(mob)) row.notCovered.push('no base-class setAngles: model has its own pose maths');
  OUT[mob] = row;
  const have = new Set(PK.notCovered[mob] || []);
  for (const r of row.notCovered) ok(have.has(r), `#7523 NEW notCovered for ${mob}: ${r} (ledger tools/mobproof-anim-known.json is shrink-only)`);
}
for (const mob of Object.keys(PK.notCovered)) { const cur = new Set((OUT[mob] || { notCovered: [] }).notCovered); for (const r of PK.notCovered[mob]) ok(cur.has(r), `#7523 ${mob}: '${r}' is now covered - delete it from tools/mobproof-anim-known.json`); }
if (process.argv.includes('--write-known')) { const o = {}; for (const m of ROSTER) o[m] = OUT[m].notCovered; writeFileSync(R('./mobproof-anim-known.json'), JSON.stringify({ why: '#7523 shrink-only ledger: per mob, what tools/mobanimproof.mjs cannot yet compare against vanilla setAngles. May only get shorter.', notCovered: o }, null, 1)); console.log('wrote ledger'); process.exit(0); }
for (const m of ROSTER) if (!OUT[m].pass) ok(false, `${m}: ${OUT[m].failed.join('; ')}`);
mkdirSync(R('./mobproof/out/'), { recursive: true });
writeFileSync(R('./mobproof/out/animation.json'), JSON.stringify(OUT, null, 1));
console.log(`mobanimproof: ${ROSTER.length} mobs, ${Object.values(OUT).filter((r) => r.checked.length).length} compared, ${pass} assertions, ${fails.length} failures, ${breaks} breaks caught`);
if (fails.length) { for (const f of fails.slice(0, 30)) console.log('  ✗ ' + f); process.exit(1); }
