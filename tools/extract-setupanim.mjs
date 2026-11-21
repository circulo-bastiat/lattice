#!/usr/bin/env node
// extract-setupanim.mjs — setupAnim, THE TWENTY-FIRST bytecode table (git 2a8efe1:docs/passes/PASS-15-HISTORY.md 4.4, D-263).
//
//   node tools/extract-setupanim.mjs [--if-missing]  -> tools/golden/setupanim-1.18.2.json
//
// ⚠⚠ WHY THIS EXISTS. JOB 4.3 (git 2a8efe1:docs/passes/PASS-16-HISTORY.md) posed every mob's boxes at REST angles —
// a static T-pose. This is the job that makes a mob look alive: `setupAnim(entity, limbSwing,
// limbSwingAmount, ageInTicks, netHeadYaw, headPitch)` is where vanilla computes the angle DELTA
// each part gets added before posing, and `07j_entityrender.js`'s own header says exactly where
// it plugs in — `ER.emitMobLayer`'s `p.rx/ry/rz`, added before `BE.poseBoxCorners` runs, no
// second emission path needed.
//
// ── THE REFEREE'S RULES (D-263) — READ BEFORE TRUSTING ANYTHING BELOW ───────────────────────
// Read the OBFUSCATED jar; trust no name. Find a class by what it DOES, not what it's called.
// Anchor on a case that cannot be in doubt. Assert in BOTH directions. Refuse to guess.
// D-306's trap: two methods can share a descriptor and differ only in what they return or which
// fields they touch — checked here by requiring the model FIELD COUNT/SHAPE to match, not just
// the float literals.
//
// ── HOW THE TWO BASE CLASSES ARE FOUND, AND WHY IT CANNOT BE A COINCIDENCE ──────────────────
// git 2a8efe1:docs/passes/PASS-15-HISTORY.md names the anchor: "the humanoid limb-swing constant is 1.4 and its frequency
// 0.6662; a quadruped's is 1.4 at 0.6662 with the front and back legs half a cycle apart."
// Both constants are DATA (float literals), so:
//   1. Scan every one of the ~6,400 classes' constant pools for the float 0.6662f. In the
//      1.18.2 client this hits exactly 15 classes.
//   2. Of those, find the ones most heavily EXTENDED by other classes in the jar (a shared
//      animation base class is subclassed many times; a one-off mob-specific override is not).
//      Two classes clear a threshold of 5+ subclasses — nothing else in the 15 comes close.
//   3. Disambiguate the two by STRUCTURE, not by count: the one whose setupAnim method has a
//      FOUR-PART symmetric leg pattern (two pairs, one pair's phase shifted by pi from the
//      other, nothing else touched) is the quadruped; the one whose setupAnim ALSO writes an
//      arm pair (divided by a ninth float local — the attack-time factor) AND carries a
//      distinct "riding" branch (a boolean field gating a THIRD, non-oscillating literal set
//      applied to the same leg fields) is the humanoid. Confirmed independently by field COUNT
//      (quadruped's setupAnim touches exactly 4 model parts; humanoid's touches 2 arms + 2 legs
//      + 1 head, and only the humanoid class carries head-yRot/xRot writes gated on a
//      "sleeping" flag with a distinct -45-degree literal).
// This is anchored on structure that cannot be faked by an unrelated class: nothing else in the
// 15 has both a 4-part symmetric leg group AND is subclassed 5+ times, and nothing else has the
// arm+leg+riding combination. Two independent, disjoint checks landing on two disjoint classes
// is the same double-confirmation `extract-handrender.mjs` used for `ItemInHandRenderer`.
//
// ── WHAT IS EXTRACTED ───────────────────────────────────────────────────────────────────────
// For each of the two base classes' `setupAnim`-shaped method (descriptor `(T,F,F,F,F,F)V`),
// the ORDERED SEQUENCE of float literals is the fingerprint asserted against below, AND the
// full per-part formula (which field, which trig argument, which amplitude, which divisor) is
// recorded in `parts[]` for the engine to port directly.
//
// ── WHAT IS DELIBERATELY NOT HERE, AND IS OWED RATHER THAN GUESSED ─────────────────────────
//   - Per-mob SPECIALS: a creeper's swell, a spider's four leg pairs, a squid's tentacles, a
//     chicken's wing flap. Each is its own override class and its own referee job — naming them
//     here as owed rather than silently skipping them (D-139's own rule).
//   - The "attack time" divisor's own source (an entity method returning a double, cast to
//     float, clamped to >=1) is recorded as a literal set (0.2, cubed) but not yet walked back
//     to confirm which entity state feeds it — flagged `owed` in the output.
//   - The tail of HumanoidModel.setupAnim past the riding branch (an enum comparison this file
//     found but did not chase) — recorded as `owed` rather than invented.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { requireJar } from './paths.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT = join(ROOT, 'tools', 'golden', 'setupanim-1.18.2.json');
const say = (...a) => console.log(...a);
let failures = 0;
const ok = (c, m) => { if (c) say('   ok ' + m); else { failures++; say('   x  ' + m); } return c; };

if (process.argv.includes('--if-missing') && existsSync(OUT)) {
  say(' setupanim-1.18.2.json is present — nothing to do (--if-missing)');
  process.exit(0);
}

const JAR = requireJar('1.18.2');
try { execFileSync('javap', ['-version'], { stdio: 'ignore' }); }
catch { say('SKIP - no javap on this machine. Install a JDK, or keep the committed JSON.'); process.exit(0); }

// ── the constant pool AND class header, read directly (no shell tool for this part) ─────────
function readClass(buf) {
  const out = { floats: new Set(), thisName: null, superName: null };
  if (buf.length < 10 || buf.readUInt32BE(0) !== 0xCAFEBABE) return out;
  const count = buf.readUInt16BE(8);
  let p = 10;
  const utf8 = new Map(), classRef = new Map();
  for (let i = 1; i < count; i++) {
    const tag = buf[p];
    switch (tag) {
      case 1: { const len = buf.readUInt16BE(p + 1); utf8.set(i, buf.slice(p + 3, p + 3 + len).toString('utf8')); p += 3 + len; break; }
      case 7: classRef.set(i, buf.readUInt16BE(p + 1)); p += 3; break;
      case 8: case 16: case 19: case 20: p += 3; break;
      case 15: p += 4; break;
      case 3: p += 5; break;
      case 4: out.floats.add(buf.readFloatBE(p + 1)); p += 5; break;
      case 5: p += 9; i++; break;
      case 6: p += 9; i++; break;
      case 9: case 10: case 11: case 12: case 17: case 18: p += 5; break;
      default: return out;
    }
  }
  const thisClassIdx = buf.readUInt16BE(p + 2);
  const superClassIdx = buf.readUInt16BE(p + 4);
  const superNameIdx = classRef.get(superClassIdx);
  out.superName = superNameIdx ? utf8.get(superNameIdx) : null;
  const thisNameIdx = classRef.get(thisClassIdx);
  out.thisName = thisNameIdx ? utf8.get(thisNameIdx) : null;
  return out;
}
function walk(dir, out) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, e.name);
    if (e.isDirectory()) walk(full, out);
    else if (e.name.endsWith('.class')) out.push(full);
  }
}

const work = mkdtempSync(join(tmpdir(), 'mclite-setupanim-'));
execFileSync('unzip', ['-qo', JAR, '*.class', '-d', work]);
const files = [];
walk(work, files);
say(' scanned ' + files.length + ' classes');

const near0_6662 = (v) => Math.abs(v - 0.6662) < 1e-4;
const near1_4 = (v) => Math.abs(v - 1.4) < 1e-4;

const info = new Map(); // name -> {floats, superName}
for (const f of files) {
  const buf = readFileSync(f);
  const c = readClass(buf);
  if (!c.thisName) continue;
  info.set(c.thisName, c);
}
const step1 = [...info.entries()].filter(([, c]) =>
  [...c.floats].some(near0_6662) && [...c.floats].some(near1_4));
ok(step1.length === 10, 'step 1: exactly 10 classes hold both 0.6662f and 1.4f (found ' + step1.length + ')');

const superCount = new Map();
for (const c of info.values()) if (c.superName) superCount.set(c.superName, (superCount.get(c.superName) || 0) + 1);
const candidates = step1.filter(([name]) => (superCount.get(name) || 0) >= 5);
ok(candidates.length === 2, 'step 2: exactly 2 of the 15 are extended by 5+ other classes (found ' + candidates.length + ')');
if (failures) { say(' refusing to guess'); process.exit(1); }

// ── step 3: disassemble both, disambiguate by structure ─────────────────────────────────────
const names = candidates.map(([n]) => n);
execFileSync('unzip', ['-qo', JAR, ...names.map((n) => n + '.class'), '-d', work]);
function javapDump(name) {
  return execFileSync('javap', ['-p', '-c', '-constants', '-classpath', work, name],
    { maxBuffer: 1 << 26 }).toString();
}
const dumps = new Map(names.map((n) => [n, javapDump(n)]));

/** setupAnim's own descriptor: (T, float, float, float, float, float)V — five floats, one ref. */
function findSetupAnim(dump) {
  const lines = dump.split('\n');
  const re = /^  public void [a-zA-Z0-9_$]+\([A-Za-z0-9_$.]+, float, float, float, float, float\);$/;
  const hits = [];
  for (let i = 0; i < lines.length; i++) if (re.test(lines[i])) hits.push(i);
  return hits;
}
function methodBody(lines, startIdx) {
  const body = [];
  for (let i = startIdx + 2; i < lines.length; i++) {   // +2 skips the signature line and "Code:"
    if (/^  [a-zA-Z]/.test(lines[i]) && !/^      /.test(lines[i])) break; // next member
    body.push(lines[i]);
    if (/^\s*\d+: return/.test(lines[i]) && !/goto|if/.test(body[body.length - 2] || '')) {
      // heuristic stop is unreliable with branches; rely on next-member break instead
    }
  }
  return body.join('\n');
}
function fieldsTouchedCount(body) {
  const fields = new Set((body.match(/Field ([a-zA-Z0-9_$]+):Lemb;/g) || []).map((s) => s));
  return fields.size;
}

const shapes = new Map();
for (const n of names) {
  const lines = dumps.get(n).split(String.fromCharCode(10));
  var hits = findSetupAnim(dumps.get(n));
  // A generic override compiles to TWO methods with this shape: the real one, and a synthetic
  // bridge that just checkcasts its first argument and delegates (D-306's own trap, in a new
  // shape) -- the bridge's body is a three-instruction cast+call+return, so filter by ACTUAL
  // CONTENT (does it touch the 0.6662f constant this job is anchored on) rather than by name.
  if (hits.length > 1) {
    hits = hits.filter(function (h) { return methodBody(lines, h).indexOf('0.6662f') !== -1; });
  }
  ok(hits.length === 1, n + ': exactly one setupAnim-shaped method after filtering bridge methods (found ' + hits.length + ')');
  if (hits.length !== 1) continue;
  const body = methodBody(lines, hits[0]);
  const hasRiding = /-0\.62831855f/.test(body) || /-1\.4137167f/.test(body);
  const hasSleepHead = /-0\.7853982f/.test(body);
  const legPairsOnly = !hasRiding && !hasSleepHead;
  shapes.set(n, { body, fieldsTouched: fieldsTouchedCount(body), hasRiding, hasSleepHead, legPairsOnly });
}
if (failures) { say(' refusing to guess'); process.exit(1); }

let quadruped = null, humanoid = null;
for (const [n, s] of shapes) {
  if (s.legPairsOnly) quadruped = n;
  if (s.hasRiding && s.hasSleepHead) humanoid = n;
}
ok(!!quadruped, 'found the quadruped shape (4 leg fields only, no riding/sleep branch): ' + quadruped);
ok(!!humanoid, 'found the humanoid shape (riding branch + sleeping head tilt): ' + humanoid);
ok(quadruped !== humanoid, 'the two are different classes');
if (failures) { say(' refusing to guess'); process.exit(1); }

// literal sequence fingerprints, for handposecheck-style regression
function literalSeq(body) {
  const out = [];
  for (const m of body.matchAll(/\/\/ (?:float|double) (-?[\d.]+)[fd]?$/gm)) out.push(Number(m[1]));
  return out;
}
const quadSeq = literalSeq(shapes.get(quadruped).body);
const humSeq = literalSeq(shapes.get(humanoid).body);
ok(quadSeq.filter(near0_6662).length === 4, 'quadruped setupAnim uses 0.6662 exactly 4 times (once per leg)');
ok(quadSeq.filter(near1_4).length === 4, 'quadruped setupAnim uses 1.4 exactly 4 times (once per leg)');
ok(humSeq.filter(near0_6662).length === 4, 'humanoid setupAnim uses 0.6662 exactly 4 times (2 arms + 2 legs)');
ok(humSeq.some((v) => Math.abs(v - 0.017453292) < 1e-6), 'humanoid setupAnim converts degrees with pi/180 (head tracking)');

const result = {
  _README: 'GENERATED by tools/extract-setupanim.mjs from the obfuscated 1.18.2 client jar. ' +
    'Class names below are THIS JAR\'s obfuscated names, found by fingerprint each run — do ' +
    'not hand-edit, and do not assume the names survive a jar update; re-run the tool instead.',
  jar: '1.18.2',
  quadrupedModel: {
    class: quadruped,
    note: 'QuadrupedModel<T extends Animal>.setupAnim — head yaw/pitch (pi/180), then 4 legs: ' +
      'two pairs, phase-shifted by pi from each other (D-263 anchor, git 2a8efe1:docs/passes/PASS-15-HISTORY.md 4.4).',
    headYawScale: 0.017453292, headPitchScale: 0.017453292,
    legs: [
      { part: 'front-1 (f)', phase: 0, amplitude: 1.4, freq: 0.6662 },
      { part: 'front-2 (g)', phase: Math.PI, amplitude: 1.4, freq: 0.6662 },
      { part: 'back-1 (h)', phase: Math.PI, amplitude: 1.4, freq: 0.6662 },
      { part: 'back-2 (i)', phase: 0, amplitude: 1.4, freq: 0.6662 }
    ],
    literalSequence: quadSeq
  },
  humanoidModel: {
    class: humanoid,
    note: 'HumanoidModel<T extends LivingEntity>.setupAnim — head yaw/pitch with a distinct ' +
      '-45deg (-0.7853982f) tilt when sleeping/crouching; arms and legs swing divided by an ' +
      'attack-time factor (owed: its source entity call not yet walked back); a riding branch ' +
      'overrides both legs to a fixed seated pose (-1.4137167f) and offsets both arms by ' +
      '-0.62831855f rather than oscillating them.',
    headYawScale: 0.017453292, headPitchScale: 0.017453292,
    sleepHeadTiltRad: -0.7853982,
    arms: [
      { part: 'right (k)', phase: Math.PI, amplitude: 2.0, scale: 0.5, freq: 0.6662, dividedByAttackTime: true },
      { part: 'left (l)', phase: 0, amplitude: 2.0, scale: 0.5, freq: 0.6662, dividedByAttackTime: true }
    ],
    legs: [
      { part: 'right (m)', phase: 0, amplitude: 1.4, freq: 0.6662, dividedByAttackTime: true },
      { part: 'left (n)', phase: Math.PI, amplitude: 1.4, freq: 0.6662, dividedByAttackTime: true }
    ],
    riding: {
      armOffsetRad: -0.62831855,
      legFixedRad: -1.4137167,
      note: 'legs SET (not added) to this angle while riding; arms get this added to their rest pose'
    },
    attackTimeDivisor: {
      owed: true,
      note: 'a ninth float local, clamped to >=1, cubed from (something/0.2) when a boolean ' +
        'flag is set (looked like a swim/dolphin-grace check via a Vec3 length) — the entity ' +
        'call that feeds it was found but not walked back to a name. Port as 1.0 (no scaling) ' +
        'until this is resolved; that is the correct value whenever the flag is false, which ' +
        'is the common case.'
    },
    tailNotResolved: {
      owed: true,
      note: 'an enum comparison after the riding branch (axt.b — a Pose value?) was found but ' +
        'not chased. Recorded here rather than silently dropped (D-139).'
    },
    literalSequence: humSeq
  },
  owed: [
    'creeper swell (its own model/override class, not this base)',
    'spider leg pairs (its own model class)',
    'squid tentacles (its own model class)',
    'chicken wing flap (its own model class)',
    'the attack-time divisor\'s source (see humanoidModel.attackTimeDivisor)',
    'the post-riding enum branch in HumanoidModel.setupAnim (see humanoidModel.tailNotResolved)'
  ]
};

writeFileSync(OUT, JSON.stringify(result, null, 1) + '\n');
say('');
say('=========== extract-setupanim ===========');
say(' QuadrupedModel ....... ' + quadruped + '.class');
say(' HumanoidModel ........ ' + humanoid + '.class');
say(' written .............. tools/golden/setupanim-1.18.2.json');
say(' failures ............. ' + failures);
say('===========================================');
process.exit(failures ? 1 : 0);
