#!/usr/bin/env node
// extract-zombiearms.mjs — `AnimationUtils.animateZombieArms`, and WHICH mobs get it.
//
//   node tools/extract-zombiearms.mjs [--if-missing]  -> tools/golden/zombiearms-1.18.2.tsv
//
// ⚠⚠ WHY. Dan, session 55: *"the zombie doesnt have its arms out pose"*. `extract-setupanim.mjs`
// (D-263) read the two BASE models — `HumanoidModel` and `QuadrupedModel` — and a zombie is a
// `HumanoidModel`, so `ER.setupAnimDelta` posed it exactly like a player: arms hanging, swinging
// with the walk. The arms-out pose is not in `HumanoidModel.setupAnim` at all. It is one extra
// line in `AbstractZombieModel.setupAnim`, AFTER the super call:
//
//     AnimationUtils.animateZombieArms(this.leftArm, this.rightArm,
//                                      this.isAggressive(entity), this.attackTime, ageInTicks);
//
// and that helper OVERWRITES all three angles of both arms rather than adding to them. So this
// is a second layer over the base model's, not a different base model — which is exactly why
// `ER.modelKindOf` could never have found it: a zombie's PART NAMES are a humanoid's.
//
// ⚠ AND THE POSE IS NOT WHAT MEMORY SAYS IT IS. Every write-up of this animation says the arms
// are set to −π/2. The bytecode says −π divided by **1.5 when the zombie is aggressive and 2.25
// when it is not** — −120° and −80°, neither of them −90°, and the difference between them is
// the whole "it raises its arms when it comes for you" read. Read it, do not remember it (rule 4).
//
// ── WHAT IS READ ────────────────────────────────────────────────────────────────────────────
//   1. AnimationUtils, by FLOAT FINGERPRINT: the one class in the jar whose constant pool holds
//      0.09f, 0.067f and 1.2f together. (0.09 and 0.067 alone already pick it out uniquely;
//      1.2 is the third leg of the anchor so a jar that moved the bob helper cannot pass.)
//   2. its `(ModelPart, ModelPart, boolean, float, float)` method — the only member with that
//      descriptor — and the ORDERED float literals in it, which are the pose.
//   3. the `bobArms` chain it ends with: a `(ModelPart, ModelPart, float)` that calls a
//      `(ModelPart, float, float)` twice with +1 and −1, and THAT one's two constants.
//   4. WHO CALLS IT: every class whose own code invokes that method, mapped to an entity name
//      through the renderer generic supertypes (`extract-babymodel.mjs` §5's technique) so the
//      engine gets a list of LAYERS rather than a list of class names that die with this jar.
//
// REQUIRES A JDK (`javap`), not just a JRE.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { requireJar } from './paths.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const TYPES = join(ROOT, 'tools', 'golden', 'entity-types-1.18.2.tsv');
const OUT = join(ROOT, 'tools', 'golden', 'zombiearms-1.18.2.tsv');
const say = (...a) => console.log(...a);
let failures = 0;
const ok = (c, m) => { if (!c) { failures++; say('   x ' + m); } return c; };
const stop = () => { if (failures) { say('\n aborted'); process.exit(1); } };

if (process.argv.includes('--if-missing') && existsSync(OUT)) {
  say(' zombiearms-1.18.2.tsv is present — nothing to do (--if-missing)');
  process.exit(0);
}
if (!existsSync(TYPES)) { say(' SKIP — entity-types-1.18.2.tsv is missing; run extract-entities first.'); process.exit(0); }
const JAR = requireJar('1.18.2');
try { execFileSync('javap', ['-version'], { stdio: 'ignore' }); }
catch { say('SKIP - no javap on this machine. Install a JDK, or keep the committed TSV.'); process.exit(0); }

const work = mkdtempSync(join(tmpdir(), 'mclite-zarms-'));
execFileSync('unzip', ['-o', '-q', JAR, '*.class', '-d', work]);
const all = execFileSync('bash', ['-c',
  'cd ' + JSON.stringify(work) + " && find . -name '*.class' | sed 's|^\\./||; s|\\.class$||' | tr '/' '.'"],
  { maxBuffer: 1 << 28 }).toString().trim().split('\n');
say(' classes ............ ' + all.length);

const javap = (args, names) => {
  let out = '';
  for (let i = 0; i < names.length; i += 300) {
    out += execFileSync('javap', [...args, '-cp', work, ...names.slice(i, i + 300)],
      { maxBuffer: 1 << 29, stdio: ['ignore', 'pipe', 'ignore'] }).toString();
  }
  return out.split('\n').filter((l) => !l.startsWith('Picked up'));
};

// ── ONE disassembly of the whole jar, split by class ───────────────────────────────────────
// ⚠ It is ~90 seconds and it is the only pass: everything below reads this map. Two passes
// would double the slowest build stage in the project for no new information.
const stripGenerics = (s) => {
  let out = '', d = 0;
  for (const ch of s) { if (ch === '<') d++; else if (ch === '>') d--; else if (d === 0) out += ch; }
  return out;
};
const body = new Map(), head = new Map();
{
  const lines = javap(['-c', '-p', '-constants'], all);
  let cur = null, buf = null;
  for (const line of lines) {
    const bare = stripGenerics(line).trim();
    const d = bare.match(/^(?:public |final |abstract |protected |static )*(?:class|interface|enum) ([\w.$]+)/);
    if (d && bare.endsWith('{')) { if (cur) body.set(cur, buf); cur = d[1]; buf = []; head.set(cur, line.trim()); continue; }
    if (cur) buf.push(line);
  }
  if (cur) body.set(cur, buf);
}
say(' disassembled ....... ' + body.size + ' classes');

/** Every member of a class as [signatureLine, instructionLines]. */
function members(cls) {
  const out = [];
  let sig = null, code = [];
  for (const line of (body.get(cls) || [])) {
    if (/^ {2}\S.*\);\s*$/.test(line)) { if (sig) out.push([sig, code]); sig = line.trim(); code = []; continue; }
    if (sig && /^\s+\d+:/.test(line)) code.push(line.trim());
  }
  if (sig) out.push([sig, code]);
  return out;
}
const litsOf = (code) => code.map((l) => l.match(/ldc(?:_w)?\s+#\d+\s+\/\/ float ([-\d.E]+)f/))
                             .filter(Boolean).map((m) => Number(m[1]));

// ── 1. AnimationUtils, by float fingerprint ────────────────────────────────────────────────
const WANT = [0.09, 0.067, 1.2];
const cands = [];
for (const [cls, lines] of body) {
  const fs = new Set(litsOf(lines.filter((l) => /^\s*\d+:/.test(l))));
  if (WANT.every((w) => [...fs].some((f) => Math.abs(f - w) < 1e-6))) cands.push(cls);
}
ok(cands.length === 1, `${cands.length} classes carry 0.09f, 0.067f and 1.2f together — expected exactly one (AnimationUtils): ${cands.join(' ')}`);
stop();
const UTIL = cands[0];
say(' AnimationUtils ..... ' + UTIL);

// ── 2. animateZombieArms: the one (ModelPart, ModelPart, boolean, float, float) ─────────────
const arms = members(UTIL).filter(([s]) => /\(\w[\w.$]*, \w[\w.$]*, boolean, float, float\)/.test(stripGenerics(s)));
ok(arms.length === 1, `${arms.length} members of ${UTIL} take (Part, Part, boolean, float, float) — expected exactly one`);
stop();
const ARMS = arms[0][1];
// ⚠ THE ModelPart CLASS, TAKEN FROM THE SIGNATURE RATHER THAN ASSUMED. The first draft of
// this file looked for bobArms with `(\w+, \w+, float)` and matched `(ModelPart, float, float)`
// — the PER-ARM helper — because `float` is a `\w+` too. It then reported "bobArms hands its
// helper 0 signs", which is a true statement about the wrong method.
const PART = (stripGenerics(arms[0][0]).match(/\((\w[\w.$]*), /) || [])[1];
ok(!!PART, 'could not read the ModelPart class out of the pose signature');
const seq = litsOf(ARMS);

// the pose, read by POSITION in the literal sequence rather than by name
//   [PI, PI, 0.1, 0.6, 0.1, 0.6, -PI, 1.5, 2.25, 1.2, 0.4, 1.2, 0.4]
const near = (a, b) => Math.abs(a - b) < 1e-5;
ok(seq.length === 13, `the pose has ${seq.length} float literals, expected 13: ${seq.join(' ')}`);
const yawBase = seq[2], yawSwing = seq[3];
const aggrDiv = seq[7], calmDiv = seq[8];
const swing1 = seq[9], swing2 = seq[10];
ok(near(seq[0], Math.PI) && near(seq[1], Math.PI), 'the two sine arguments are not pi');
ok(near(seq[4], yawBase) && near(seq[5], yawSwing), 'the two arms do not share one yaw formula');
ok(near(seq[11], swing1) && near(seq[12], swing2), 'the two arms do not share one swing formula');
ok(near(seq[6], -Math.PI), `the arm base angle is ${seq[6]}, expected -pi over a divisor`);
ok(aggrDiv < calmDiv, `the aggressive divisor ${aggrDiv} is not smaller than the calm one ${calmDiv} — an angry zombie raises its arms HIGHER`);
stop();

// ── 3. bobArms, and the two constants in its per-arm helper ────────────────────────────────
const bobCall = ARMS[ARMS.length - 2] || '';
const bobName = (bobCall.match(/invokestatic\s+#\d+\s+\/\/ Method (?:[\w.$]+\.)?(\w+):\(/) || [])[1];
ok(!!bobName, `the pose does not end in a static call: "${bobCall}"`);
const P = PART.replace(/\$/g, '\\$');
const bobPair = members(UTIL).find(([s]) => new RegExp('\\b' + bobName + '\\(' + P + ', ' + P + ', float\\)').test(stripGenerics(s)));
ok(!!bobPair, 'no (Part, Part, float) bobArms on ' + UTIL);
stop();
const signs = bobPair[1].filter((l) => /fconst_1|float -1\.0f/.test(l)).length;
ok(signs === 2, `bobArms hands its helper ${signs} signs, expected +1 and -1`);
const bobOne = members(UTIL).find(([s]) => new RegExp('\\(' + P + ', float, float\\)').test(stripGenerics(s)));
ok(!!bobOne, 'no (Part, float, float) per-arm bob helper');
stop();
const bseq = litsOf(bobOne[1]);
// [0.09, 0.05, 0.05, 0.067, 0.05]
ok(bseq.length === 5, `the bob helper has ${bseq.length} literals, expected 5: ${bseq.join(' ')}`);
const bobZFreq = bseq[0], bobAmp = bseq[1], bobXFreq = bseq[3];
ok(near(bseq[2], bobAmp) && near(bseq[4], bobAmp), 'the bob does not share one amplitude');
stop();

// ── 4. who calls it, and which entity that is ──────────────────────────────────────────────
const CALL = new RegExp('invokestatic\\s+#\\d+\\s+// Method ' + UTIL.replace(/\$/g, '\\$') + '\\.\\w+:\\(\\w[\\w.$/;]*;\\w[\\w.$/;]*;ZFF\\)V');
const callers = new Set();
for (const [cls, lines] of body) {
  if (cls === UTIL) continue;
  if (lines.some((l) => CALL.test(l.trim()))) callers.add(cls);
}
ok(callers.size > 0, 'nothing in the jar calls animateZombieArms — the descriptor match is wrong');
say(' model classes ...... ' + [...callers].join(' '));

// entity class -> registry name, and renderer generics -> entity/model pair
const nameOfEntityClass = new Map();
for (const l of readFileSync(TYPES, 'utf8').split('\n')) {
  if (!l || l[0] === '#') continue;
  const p = l.split('\t');
  if (p.length >= 7 && p[6]) nameOfEntityClass.set(p[6].trim(), p[0]);
}
// ⚠ A CALLER IS AN ABSTRACT BASE AS OFTEN AS IT IS A CONCRETE MODEL, so the subclass closure is
// taken too: `AbstractZombieModel` is what calls the helper and `ZombieModel` is what a renderer
// names. Without the closure the entity list comes back empty and looks like "no mob uses this".
const superOf = new Map();
for (const [cls, h] of head) {
  const m = stripGenerics(h).match(/(?:class|interface) [\w.$]+(?: extends ([\w.$]+))?/);
  superOf.set(cls, (m && m[1]) || null);
}
const isCaller = (c) => { let x = c; while (x) { if (callers.has(x)) return true; x = superOf.get(x); } return false; };

const rows = [];
for (const [cls, h] of head) {
  const m = h.match(/extends [\w.$]+<\s*([\w.$]+)\s*,\s*([\w.$]+)(?:<[^>]*>)?\s*>/);
  if (!m) continue;
  const ent = m[1], mod = m[2];
  if (!nameOfEntityClass.has(ent)) continue;
  if (!isCaller(mod)) continue;
  rows.push([nameOfEntityClass.get(ent), mod, cls]);
}
// ⚠ #914: THE TWO SHAPES THE GENERIC-SUPERTYPE WALK MISSES — both drawn with the pose in vanilla.
//   (a) GIANT: `GiantEntityRenderer extends MobEntityRenderer<GiantEntity, BipedEntityModel<GiantEntity>>`
//       names the BASE model in its generics, but its constructor does `new GiantEntityModel(..)`,
//       a caller subclass. A renderer whose generic entity is unrowed takes the caller model it
//       INSTANTIATES.
//   (b) HUSK: `HuskEntityRenderer extends ZombieEntityRenderer` spells no generics at all; it
//       reuses its parent's model. Its entity is named here and CHECKED against the jar: the
//       entity class must extend an already-rowed entity's class, or this aborts.
{
  const have = new Set(rows.map((r) => r[0]));
  const classOf = new Map([...nameOfEntityClass].map(([c, n]) => [n, c]));
  for (const [cls, h] of head) {
    const m = h.match(/extends [\w.$]+<\s*([\w.$]+)\s*,/);
    if (!m || !nameOfEntityClass.has(m[1]) || have.has(nameOfEntityClass.get(m[1]))) continue;
    const made = (body.get(cls) || []).map((l) => (l.match(/new\s+#\d+\s+\/\/ class ([\w.$/]+)/) || [])[1])
      .filter(Boolean).map((c) => c.replace(/\//g, '.')).filter(isCaller);
    if (!made.length) continue;
    have.add(nameOfEntityClass.get(m[1]));
    rows.push([nameOfEntityClass.get(m[1]), made[0], cls]);
  }
  for (const [ent, parent] of [['husk', 'zombie']]) {
    let x = classOf.get(ent), rooted = false;
    while (x && !rooted) { x = superOf.get(x); rooted = x === classOf.get(parent); }
    ok(rooted, ent + "'s entity class does not extend " + parent + "'s — the renderer-subclass rule is wrong");
    const pr = rows.find((r) => r[0] === parent);
    if (rooted && pr && !have.has(ent)) rows.push([ent, pr[1], '(subclass of ' + pr[2] + ')']);
  }
}
rows.sort((a, b) => a[0].localeCompare(b[0]));
say(' entities ........... ' + (rows.map((r) => r[0]).join(' ') || 'NONE'));

// ⚠ THE SHORTFALL IS NAMED, NOT HIDDEN (extract-babymodel.mjs' own rule). A renderer that
// does not spell its entity and model out in its generic supertype — a subclass renderer that
// reuses its parent's model, which is how `husk` is drawn — produces no row here, and the day
// one of those mobs is rostered that must be a question somebody answers rather than a zombie
// standing with its arms down.
const covered = new Set(rows.map((r) => r[1]));
const unmatched = [...callers].filter((c) => {
  for (const m of covered) { let x = m; while (x) { if (x === c) return false; x = superOf.get(x); } }
  return true;
});
if (unmatched.length) say(' unmatched classes .. ' + unmatched.join(' ') + '  (no renderer names both an entity and this model)');

// the anchor that cannot be in doubt
ok(rows.some((r) => r[0] === 'husk') && rows.some((r) => r[0] === 'giant'), 'husk/giant are not in the list (#914)');
ok(rows.some((r) => r[0] === 'zombie'), 'zombie is not in the list — the entity->model link is wrong');
ok(!rows.some((r) => r[0] === 'player' || r[0] === 'villager'),
   'a non-zombie mob came out of the caller walk: ' + rows.map((r) => r[0]).join(' '));
stop();

const out = [
  '# zombiearms-1.18.2.tsv — generated by tools/extract-zombiearms.mjs from the 1.18.2 jar.',
  '# AnimationUtils.animateZombieArms: the layer AbstractZombieModel adds OVER HumanoidModel.',
  '# THE POSE (leftArm = arg0, rightArm = arg1), in the jar\'s own order:',
  '#   f  = sin(attackTime * PI);  f1 = sin((1 - (1-attackTime)^2) * PI)',
  '#   both zRot  = 0',
  '#   rightArm.yRot = -(yawBase - f*yawSwing);   leftArm.yRot = yawBase - f*yawSwing',
  '#   both xRot  = -PI / (aggressive ? aggrDiv : calmDiv)',
  '#   both xRot += f*swing1 - f1*swing2',
  '#   bobArms(rightArm[+1], leftArm[-1], ageInTicks):',
  '#     zRot += sign * (cos(age*bobZFreq)*bobAmp + bobAmp);  xRot += sign * sin(age*bobXFreq)*bobAmp',
  `!const\tyawBase\t${yawBase}`,
  `!const\tyawSwing\t${yawSwing}`,
  `!const\taggrDiv\t${aggrDiv}`,
  `!const\tcalmDiv\t${calmDiv}`,
  `!const\tswing1\t${swing1}`,
  `!const\tswing2\t${swing2}`,
  `!const\tbobZFreq\t${bobZFreq}`,
  `!const\tbobXFreq\t${bobXFreq}`,
  `!const\tbobAmp\t${bobAmp}`,
  `!class\tAnimationUtils\t${UTIL}`,
  `# unmatched model classes (no renderer names both an entity and this model): ${unmatched.join(' ') || 'none'}`,
  '# entity\tmodelClass\trenderer',
].concat(rows.map((r) => r.join('\t')));
writeFileSync(OUT, out.join('\n') + '\n');

say('');
say('========= extract-zombiearms =========');
say(` pose ....... yaw ${yawBase}-f*${yawSwing}  xRot -PI/${aggrDiv} angry, -PI/${calmDiv} calm, +f*${swing1}-f1*${swing2}`);
say(` bob ........ cos(age*${bobZFreq})*${bobAmp}+${bobAmp} on zRot, sin(age*${bobXFreq})*${bobAmp} on xRot`);
say(` entities ... ${rows.length}  (${rows.map((r) => r[0]).join(' ')})`);
say('======================================');
process.exit(failures ? 1 : 0);
