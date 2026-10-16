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

const cCaught = (m, mut) => { if (compareChicken(mut).worst > TOL) breaks++; else ok(false, 'break NOT caught: ' + m); };
for (const p of ['right_leg', 'left_leg', 'right_wing', 'left_wing']) cCaught(`chicken ${p} +0.01`, (o) => ({ ...o, [p]: o[p] + 0.01 }));
for (const p of ['head', 'beak', 'red_thing']) {
  cCaught(`chicken ${p} pitch +0.01`, (o) => ({ ...o, [p]: { ...o.head, rx: o.head.rx + 0.01 }, head: p === 'head' ? { ...o.head, rx: o.head.rx + 0.01 } : o.head }));
  cCaught(`chicken ${p} yaw +0.01`, (o) => ({ ...o, [p]: { ...o.head, ry: o.head.ry + 0.01 }, head: p === 'head' ? { ...o.head, ry: o.head.ry + 0.01 } : o.head }));
}
cCaught('chicken wings not mirrored', (o) => ({ ...o, left_wing: o.right_wing }));

// ---- per-mob output: every roster mob has a row ----
const PK = JSON.parse(readFileSync(R('./mobproof-anim-known.json'), 'utf8'));
const OUT = {};
const GEN = 'head/limb pose beyond the base class (specialised setAngles, arms/attack/death/hurt/baby/riding/sleeping/swimming/flying states, tail/ear/jaw/wing parts) is not compared yet';
for (const mob of ROSTER) {
  const row = { pass: true, checked: [], notCovered: [GEN], failed: [] };
  const kind = QUAD.has(mob) ? 'quadruped' : BIPED.has(mob) ? 'humanoid' : null;
  if (kind) {
    const r = fam[kind];
    row.checked.push(`${kind} head yaw/pitch + ${kind === 'quadruped' ? 'four legs' : 'two legs + riding legs'} over ${LS.length * AMT.length * YAW.length * PITCH.length} grid points, worst ${r.worst.toExponential(2)}`);
    if (r.worst >= TOL) { row.pass = false; row.failed.push(`${kind} worst ${r.worst} at ${r.at}`); }
    if (kind === 'humanoid') row.notCovered.push('arms: swing/attack/charge/aggressive arms are posed by the arm layers (ZombieArms, bow, crossbow, illager) and are not compared');
  } else if (mob === 'chicken') {
    row.checked.push(`chicken head/beak/wattle yaw+pitch, two legs, two wing rolls over ${LS.length * AMT.length * YAW.length * PITCH.length * WING.length} grid points, worst ${CH.worst.toExponential(2)}`);
    if (CH.worst >= TOL) { row.pass = false; row.failed.push(`chicken worst ${CH.worst} at ${CH.at}`); }
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
console.log(`mobanimproof: ${ROSTER.length} mobs, ${Object.values(OUT).filter((r) => r.checked.length).length} compared, ${breaks} breaks caught, ${pass} assertions`);
if (fails.length) { for (const f of fails.slice(0, 30)) console.log('  ✗ ' + f); process.exit(1); }
