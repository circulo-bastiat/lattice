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

const QUAD = new Set(['cow', 'mooshroom', 'pig']);     // CowEntityModel / PigEntityModel declare no setAngles of their own
const BIPED = new Set(['zombie', 'husk', 'giant', 'drowned', 'zombie_villager', 'skeleton', 'stray', 'wither_skeleton', 'piglin', 'piglin_brute', 'zombified_piglin']);
for (const c of ['CowEntityModel', 'PigEntityModel', 'ZombieEntityModel', 'GiantEntityModel', 'DrownedEntityModel', 'SkeletonEntityModel', 'ZombieVillagerEntityModel', 'PiglinEntityModel'])
  ok(!/void setAngles/.test(src(c)) || /^(Drowned|Skeleton|Piglin)/.test(c), `${c} overrides setAngles: it is no longer a plain base-class mob`);

// ---- the engine ----
const M = loadEngine({ extra: ['02g_items.js', '07h_entities.js', '14b_physics.js', '07i_entitylist.js', '07j_entityrender.js', '10_gfx.js', '11_gfx_webgpu.js', '12_gfx_webgl2.js', '15h_bemodel.js'], dom: false });
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
const QP = ['head', 'right_hind_leg', 'left_hind_leg', 'right_front_leg', 'left_front_leg'], BP = ['head', 'right_leg', 'left_leg'];
// ---- chicken: ChickenEntityModel.setAngles (own maths; head+beak+wattle share the head angles, wings roll by animationProgress) ----
const C = src('ChickenEntityModel');
for (const p of [/head\.pitch = \$\$5 \* \(float\) \(Math\.PI \/ 180\.0\)/, /head\.yaw = \$\$4 \* \(float\) \(Math\.PI \/ 180\.0\)/, /beak\.pitch = this\.head\.pitch/, /wattle\.yaw = this\.head\.yaw/,
  /rightLeg\.pitch = MathHelper\.cos\(\$\$1 \* 0\.6662F\) \* 1\.4F \* \$\$2/, /leftLeg\.pitch = MathHelper\.cos\(\$\$1 \* 0\.6662F \+ \(float\) Math\.PI\) \* 1\.4F \* \$\$2/, /rightWing\.roll = \$\$3/, /leftWing\.roll = -\$\$3/])
  ok(p.test(C), `ChickenEntityModel: the decomp no longer contains ${p} — the oracle below is stale`);
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
const cCaught = (m, mut) => { if (compareChicken(mut).worst > TOL) breaks++; else ok(false, 'break NOT caught: ' + m); };
for (const p of ['right_leg', 'left_leg', 'right_wing', 'left_wing']) cCaught(`chicken ${p} +0.01`, (o) => ({ ...o, [p]: o[p] + 0.01 }));
for (const p of ['head', 'beak', 'red_thing']) {
  cCaught(`chicken ${p} pitch +0.01`, (o) => ({ ...o, [p]: { ...o.head, rx: o.head.rx + 0.01 }, head: p === 'head' ? { ...o.head, rx: o.head.rx + 0.01 } : o.head }));
  cCaught(`chicken ${p} yaw +0.01`, (o) => ({ ...o, [p]: { ...o.head, ry: o.head.ry + 0.01 }, head: p === 'head' ? { ...o.head, ry: o.head.ry + 0.01 } : o.head }));
}
cCaught('chicken wings not mirrored', (o) => ({ ...o, left_wing: o.right_wing }));

// ---- #7794: the models that own their pose maths (villager/trader/witch, illagers, ravager) ----
const V = src('VillagerResemblingModel'), I = src('IllagerEntityModel'), W = src('WitchEntityModel'), RV = src('RavagerEntityModel'), CP = src('CrossbowPosing');
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
const OWN = new Set(['villager', 'wandering_trader', 'evoker', 'illusioner', 'pillager', 'vindicator', 'witch', 'ravager']);
const OWNFAM = { villager: 'villager', wandering_trader: 'villager', evoker: 'illager', illusioner: 'illager', pillager: 'illager', vindicator: 'illager', witch: 'witch', ravager: 'ravager' };

// ---- per-mob output: every roster mob has a row ----
const PK = JSON.parse(readFileSync(R('./mobproof-anim-known.json'), 'utf8'));
const OUT = {};
const GEN = 'head/limb pose beyond the base class (specialised setAngles, arms/attack/death/hurt/baby/riding/sleeping/swimming/flying states, tail/ear/jaw/wing parts) is not compared yet';
for (const mob of ROSTER) {
  const row = { pass: true, checked: [], notCovered: [GEN], failed: [] };
  if (fam[mob] && (mob === 'cat' || mob === 'ocelot')) { row.checked.push(`feline pose (8 parts: legs/tails/body/head; crouch/sprint${mob === 'cat' ? '/sitting/sleep/headDown' : ''}), worst ${fam[mob].worst.toExponential(2)}`); row.notCovered = []; if (fam[mob].worst >= TOL) { row.pass = false; row.failed.push(`feline worst ${fam[mob].worst} at ${fam[mob].at}`); } OUT[mob] = row; continue; }
  const kind = QUAD.has(mob) ? 'quadruped' : BIPED.has(mob) ? 'humanoid' : null;
  if (kind) {
    const r = fam[kind];
    row.checked.push(`${kind} head yaw/pitch + ${kind === 'quadruped' ? 'four legs' : 'two legs + riding legs'} over ${LS.length * AMT.length * YAW.length * PITCH.length} grid points, worst ${r.worst.toExponential(2)}`);
    if (r.worst >= TOL) { row.pass = false; row.failed.push(`${kind} worst ${r.worst} at ${r.at}`); }
    if (kind === 'humanoid') row.notCovered.push('arms: swing/attack/charge/aggressive arms are posed by the arm layers (ZombieArms, bow, crossbow, illager) and are not compared');
  } else if (mob === 'sheep') {
    row.checked.push(`sheep head pitch/yaw/neck pivotY + four legs over eatGrassTimer x partial grid, worst ${sheepR.worst.toExponential(2)}`);
    if (sheepR.worst >= 1e-4) { row.pass = false; row.failed.push(`sheep worst ${sheepR.worst} at ${sheepR.at}`); }
  } else if (mob === 'chicken') {
    row.checked.push(`chicken head/beak/wattle yaw+pitch, two legs, two wing rolls over ${LS.length * AMT.length * YAW.length * PITCH.length * WING.length} grid points, worst ${CH.worst.toExponential(2)}`);
    if (CH.worst >= TOL) { row.pass = false; row.failed.push(`chicken worst ${CH.worst} at ${CH.at}`); }
  } else if (OWN.has(mob)) {
    const r = fam2[OWNFAM[mob]];
    row.checked.push(`${OWNFAM[mob]} own setAngles/animateModel (head, legs, arms/nose/neck/jaw by state) over ${SPEC[OWNFAM[mob]].states.length} states x the grid, worst ${r.worst.toExponential(2)}`);
    if (r.worst >= TOL) { row.pass = false; row.failed.push(`${OWNFAM[mob]} worst ${r.worst} at ${r.at}`); }
  } else row.notCovered.push('no base-class setAngles: model has its own pose maths');
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
