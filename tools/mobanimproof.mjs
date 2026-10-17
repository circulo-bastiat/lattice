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
const M = loadEngine({ extra: ['02g_items.js', '07h_entities.js', '14b_physics.js', '07i_entitylist.js', '07j_entityrender.js', '10_gfx.js', '11_gfx_webgpu.js', '12_gfx_webgl2.js', '15h_bemodel.js', '07zq2_wolfshake.js', '07k_goals.js', '07zj_goat.js', '19_data.gen.js'], dom: false });
initRegistry(M);
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
for (const p of ['right_leg', 'left_leg']) caught(`humanoid ${p} amplitude x1.01`, 'humanoid', biped, BP, (o) => ({ ...o, [p]: o[p] * 1.01 + 0.001 }));
caught('humanoid legs not swapped', 'humanoid', biped, BP, (o) => ({ ...o, right_leg: o.left_leg, left_leg: o.right_leg }));
caught('humanoid head pitch +0.01', 'humanoid', biped, BP, (o) => ({ ...o, head: { ...o.head, rx: o.head.rx + 0.01 } }));
caught('humanoid head yaw +0.01', 'humanoid', biped, BP, (o) => ({ ...o, head: { ...o.head, ry: o.head.ry + 0.01 } }));
caught('humanoid riding leg pitch -1.4137167 -> -1.41', 'humanoid', (a, b, c, d, r) => { const o = biped(a, b, c, d, r); if (r) { o.right_leg = -1.41; } return o; }, BP);

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
// ---- #7796 arms: CrossbowPosing.meleeAttack (zombie family, zombified piglin), SkeletonEntityModel melee, BipedEntityModel.animateArms ----
const CP = src('CrossbowPosing'), SK = src('SkeletonEntityModel'), AZ = src('AbstractZombieModel');
for (const [n, s, p] of [['CrossbowPosing', CP, /\$\$1\.yaw = -\(0\.1F - \$\$5 \* 0\.6F\)/], ['CrossbowPosing', CP, /\(float\) -Math\.PI \/ \(\$\$2 \? 1\.5F : 2\.25F\)/], ['CrossbowPosing', CP, /\$\$5 \* 1\.2F - \$\$6 \* 0\.4F/],
  ['CrossbowPosing', CP, /MathHelper\.cos\(\$\$1 \* 0\.09F\) \* 0\.05F \+ 0\.05F/], ['CrossbowPosing', CP, /MathHelper\.sin\(\$\$1 \* 0\.067F\) \* 0\.05F/],
  ['SkeletonEntityModel', SK, /\$\$7 \* 1\.2F - \$\$8 \* 0\.4F/], ['AbstractZombieModel', AZ, /meleeAttack\(this\.leftArm, this\.rightArm/],
  ['BipedEntityModel', B, /\* \(float\) \(Math\.PI \* 2\)\) \* 0\.2F/], ['BipedEntityModel', B, /-\(this\.head\.pitch - 0\.7F\) \* 0\.75F/], ['BipedEntityModel', B, /\* -0\.4F/]]) ok(p.test(s), `${n}: the decomp no longer contains ${p} — the arm oracle is stale`);
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
const ARMS = { zombie: compareArms('zombie'), skeleton: compareArms('skeleton') };
for (const [k, r] of Object.entries(ARMS)) { ok(r.worst < TOL, `arms ${k}: worst deviation ${r.worst.toExponential(2)} at ${r.at}`); if (process.argv.includes('--verbose')) console.log(`  arms ${k}: worst ${r.worst.toExponential(2)} at ${r.at}`); }
const armBreak = (m, kind, mut) => { const r = compareArms(kind, mut); if (r.worst > TOL) { breaks++; if (process.argv.includes('--verbose')) console.log('   ✓ break caught: ' + m); } else ok(false, 'break NOT caught: ' + m); };
for (const kind of ['zombie', 'skeleton']) {
  armBreak(`${kind} right arm pitch +0.01`, kind, (o) => ({ ...o, right: { ...o.right, rx: o.right.rx + 0.01 } }));
  armBreak(`${kind} left arm yaw +0.01`, kind, (o) => ({ ...o, left: { ...o.left, ry: o.left.ry + 0.01 } }));
  armBreak(`${kind} right arm roll +0.01`, kind, (o) => ({ ...o, right: { ...o.right, rz: o.right.rz + 0.01 } }));
}
const ARM_NC = 'arms: swing/attack/charge/aggressive arms are posed by the arm layers (ZombieArms, bow, crossbow, illager) and are not compared';
const ARM_DONE = new Set(['zombie', 'husk', 'giant', 'zombie_villager']);   // meleeAttack via ZombieArms; skeleton melee is compared above but those mobs also have bow poses, drowned a trident, piglins crossbow/dance: still owed
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
const OWNV = new Set(['villager', 'wandering_trader', 'evoker', 'illusioner', 'pillager', 'vindicator', 'witch', 'ravager']);
const OWNFAM = { villager: 'villager', wandering_trader: 'villager', evoker: 'illager', illusioner: 'illager', pillager: 'illager', vindicator: 'illager', witch: 'witch', ravager: 'ravager' };

// ---- per-mob output: every roster mob has a row ----
const PK = JSON.parse(readFileSync(R('./mobproof-anim-known.json'), 'utf8'));
const OUT = {};
const FISHM = { fish: 'cod', pufferfish: 'puffer', tropical_fish: 'tropical' };   // 'fish' row stands for cod; salmon is compared above
const GEN = 'head/limb pose beyond the base class (specialised setAngles, arms/attack/death/hurt/baby/riding/sleeping/swimming/flying states, tail/ear/jaw/wing parts) is not compared yet';
for (const mob of ROSTER) {
  const row = { pass: true, checked: [], notCovered: [GEN], failed: [] };
  const HORSEY = new Set(['horse', 'donkey', 'mule', 'skeleton_horse', 'zombie_horse']);
  if (HORSEY.has(mob)) { row.notCovered = [GEN]; row.checked.push(`HorseEntityModel.animateModel (head/neck, body, 4 legs + baby legs, tail; rearing/eating/grazing/water/tail-wag/baby) worst ${fam.horse.worst.toExponential(2)}`); if (fam.horse.worst >= TOL) { row.pass = false; row.failed.push(`horse worst ${fam.horse.worst} at ${fam.horse.at}`); } }
  if (fam[mob] && (mob === 'cat' || mob === 'ocelot')) { row.checked.push(`feline pose (8 parts: legs/tails/body/head; crouch/sprint${mob === 'cat' ? '/sitting/sleep/headDown' : ''}), worst ${fam[mob].worst.toExponential(2)}`); row.notCovered = []; if (fam[mob].worst >= TOL) { row.pass = false; row.failed.push(`feline worst ${fam[mob].worst} at ${fam[mob].at}`); } OUT[mob] = row; continue; }
  const kind = LLAMA.has(mob) || QUAD.has(mob) ? 'quadruped' : BIPED.has(mob) ? 'humanoid' : null;
  if (kind) {
    const r = fam[kind];
    row.checked.push(`${kind} head yaw/pitch + ${kind === 'quadruped' ? 'four legs' : 'two legs + riding legs'} over ${LS.length * AMT.length * YAW.length * PITCH.length} grid points, worst ${r.worst.toExponential(2)}`);
    if (r.worst >= TOL) { row.pass = false; row.failed.push(`${kind} worst ${r.worst} at ${r.at}`); }
    if (kind === 'humanoid' && !ARM_DONE.has(mob)) row.notCovered.push('arms: swing/attack/charge/aggressive arms are posed by the arm layers (ZombieArms, bow, crossbow, illager) and are not compared');
  } else if (OWN7788.has(mob)) {
    row.checked.push(`${mob}: own setAngles (legs/body/bristles/ram head) over the limb/head grid + states, worst ${ownR.worst.toExponential(2)}`);
    if (ownR.worst >= TOL) { row.pass = false; row.failed.push(`own-pose worst ${ownR.worst} at ${ownR.at}`); }
    row.notCovered = [];
  } else if (mob === 'axolotl') {
    row.checked.push(`axolotl: cache-mixed pose (play dead, swim, swim-still, walk, stand, air; all 10 parts + body pivotY) over chained state sequences, worst ${axR.worst.toExponential(2)}`);
    if (axR.worst >= TOL) { row.pass = false; row.failed.push(`axolotl worst ${axR.worst} at ${axR.at}`); }
    row.notCovered = [];
  } else if (OWN7787.has(mob)) {
    row.checked.push('own setAngles (dolphin body/tail, squid tentacles, guardian head/spikes/tail) over the age x state x yaw grid');
  } else if (mob === 'rabbit' || mob === 'bee') {
    row.checked.push(`${mob} own setAngles (all assigned parts, jump / bee still,angry,bodyPitch states), worst ${own.worst.toExponential(2)}`);
    if (own.worst >= TOL) { row.pass = false; row.failed.push(`${mob} worst ${own.worst} at ${own.at}`); }
  } else if (ownRes[mob]) {
    const r = ownRes[mob];
    row.checked.push(`${mob} own setAngles (rotations + pivots of every part) over ${OWN[mob].states.length} states x grid, worst ${r.worst.toExponential(2)}`);
    if (r.worst >= TOL) { row.pass = false; row.failed.push(`${mob} worst ${r.worst} at ${r.at}`); }
  } else if (mob === 'wolf') { row.notCovered = []; row.checked.push(`wolf WolfEntityModel pose (legs, head, tail angle from health/anger, sitting pivots, begging/shake rolls), worst ${wolfR.worst.toExponential(2)}`); if (!WOLF_OK) { row.pass = false; row.failed.push(`wolf worst ${wolfR.worst} at ${wolfR.at}`); }
  } else if (mob === 'sheep') {
    row.checked.push(`sheep head pitch/yaw/neck pivotY + four legs over eatGrassTimer x partial grid, worst ${sheepR.worst.toExponential(2)}`);
    if (sheepR.worst >= 1e-4) { row.pass = false; row.failed.push(`sheep worst ${sheepR.worst} at ${sheepR.at}`); }
  } else if (mob === 'chicken') {
    row.checked.push(`chicken head/beak/wattle yaw+pitch, two legs, two wing rolls over ${LS.length * AMT.length * YAW.length * PITCH.length * WING.length} grid points, worst ${CH.worst.toExponential(2)}`);
    if (CH.worst >= TOL) { row.pass = false; row.failed.push(`chicken worst ${CH.worst} at ${CH.at}`); }
  } else if (FISHM[mob]) { const r = FF[FISHM[mob]]; row.checked.push(`own setAngles (tail yaw / fin roll, in water and out of water) over ${AGE.length * 2} ageInTicks x water points, worst ${r.worst.toExponential(2)}`);
  } else if (OWNV.has(mob)) {
    const r = fam2[OWNFAM[mob]];
    row.checked.push(`${OWNFAM[mob]} own setAngles/animateModel (head, legs, arms/nose/neck/jaw by state) over ${SPEC[OWNFAM[mob]].states.length} states x the grid, worst ${r.worst.toExponential(2)}`);
    if (r.worst >= TOL) { row.pass = false; row.failed.push(`${OWNFAM[mob]} worst ${r.worst} at ${r.at}`); }
  } else if (!HORSEY.has(mob)) row.notCovered.push('no base-class setAngles: model has its own pose maths');
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
