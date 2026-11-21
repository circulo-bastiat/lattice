#!/usr/bin/env node
// extract-entity-ground.mjs — THE ON-GROUND HALF of an entity's motion, out of the 1.18.2 bytecode.
//
//   node tools/extract-entity-ground.mjs [--if-missing]  -> tools/golden/entity-ground-1.18.2.tsv
//
// ⚠⚠ WHY THIS FILE EXISTS AT ALL. `extract-entity-motion.mjs` reads GRAVITY and the UNIFORM
// drag, and its own header names what it deliberately does NOT read:
//
//     "Vertical drag ... appears in TWO shapes — `scale(0.98)` ... and `multiply(f, 0.98, f)`
//      for the ones whose horizontal damping is a VARIABLE ... Every case seen so far is 0.98,
//      which is exactly why it must not be assumed."
//
// That owed row was not a cosmetic gap. `EntityList.tickOne` damped all three axes by the one
// uniform number, so a dropped item kept 98% of its speed every tick FOR EVER, on the ground as
// in the air — Dan, session 55: *"items slide too much when dropped"*. Vanilla's item multiplies
// its horizontal speed by the friction of the block UNDER it times 0.98, which on grass is
// 0.588: twenty-four times more damping per tick than the engine was applying. The bug was one
// missing branch, and the reason it was missing is that the number it needs was never measured.
//
// ⚠ WHAT IS READ, AND THE TWO SHAPES IT COMES IN (both confirmed in the jar, D-427):
//
//   BLOCK shape — `item` (bli), `experience_orb` (axq):
//       float f = 0.98F;
//       if (this.onGround) f = level.getBlockState(below).getBlock().getFriction() * 0.98F;
//       setDeltaMovement(getDeltaMovement().multiply(f, 0.98D, f));
//       if (this.onGround [&& delta.y < 0]) setDeltaMovement(delta.multiply(1.0, B, 1.0));
//     ⚠ THE BOUNCE IS NOT THE SAME NUMBER IN BOTH, AND IT IS NOT GUARDED THE SAME WAY. An item
//       bounces -0.5 and ONLY when it is already falling; an orb bounces -0.9 unconditionally.
//       Memory says "-0.5, both" — the jar says otherwise, which is the entire point of rule 4.
//
//   FLAT shape — `tnt` (blj), `falling_block` (blh):
//       ... scale(0.98) ...
//       if (this.onGround) setDeltaMovement(getDeltaMovement().multiply(0.7, -0.5, 0.7));
//
// ⚠ THE COLUMNS ARE A LAW, NOT FOUR LOOSE NUMBERS. `mode` says which of the two shapes applies,
// and the engine branches on it; a packer or a runtime that flattened them would have to invent
// a friction lookup for TNT or a 0.7 for the item. Anything this file cannot read is left EMPTY
// and the type simply keeps the uniform drag it already had (D-307's rule, one level down).
//
// REQUIRES A JDK (`javap`), not just a JRE — same as extract-entity-motion.mjs.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { requireJar } from './paths.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const TYPES = join(ROOT, 'tools', 'golden', 'entity-types-1.18.2.tsv');
const MOTION = join(ROOT, 'tools', 'golden', 'entity-motion-1.18.2.tsv');
const OUT = join(ROOT, 'tools', 'golden', 'entity-ground-1.18.2.tsv');
const say = (...a) => console.log(...a);
let failures = 0;
const ok = (c, m) => { if (!c) { failures++; say('   x ' + m); } return c; };

if (process.argv.includes('--if-missing') && existsSync(OUT)) {
  say(' entity-ground-1.18.2.tsv is present — nothing to do (--if-missing)');
  process.exit(0);
}
if (!existsSync(TYPES) || !existsSync(MOTION)) {
  say(' SKIP — run extract-entities and extract-entity-motion first.');
  process.exit(0);
}
const JAR = requireJar('1.18.2');
try { execFileSync('javap', ['-version'], { stdio: 'ignore' }); }
catch { say('SKIP - no javap on this machine. Install a JDK, or keep the committed TSV.'); process.exit(0); }

// ── who to read: exactly the types the engine is allowed to simulate ───────────────────────
// ⚠ NOT every entity type. `pack-entities.mjs` only lets a type be spawned when BOTH its
// gravity and its uniform drag were measured, so reading the other 107 classes would produce
// rows nothing can ever use and 107 more chances to mis-parse something.
const classOf = new Map();
for (const l of readFileSync(TYPES, 'utf8').split('\n')) {
  if (!l || l[0] === '#') continue;
  const c = l.split('\t');
  if (c[6]) classOf.set(c[0], c[6]);
}
const simulatable = [];
for (const l of readFileSync(MOTION, 'utf8').split('\n')) {
  if (!l || l[0] === '#') continue;
  const c = l.split('\t');
  if (!c[0] || c[2] === undefined || c[2] === '' || c[3] === undefined || c[3] === '') continue;
  if (!classOf.has(c[0])) continue;
  simulatable.push(c[0]);
}
ok(simulatable.length >= 4, `only ${simulatable.length} simulatable types — the motion table is wrong`);
if (failures) { say(' refusing to guess'); process.exit(1); }

const work = mkdtempSync(join(tmpdir(), 'mclite-ground-'));
const wanted = [...new Set(simulatable.map((n) => classOf.get(n)))].map((c) => c + '.class');
execFileSync('unzip', ['-qo', JAR, ...wanted, '-d', work]);
const javap = (list) => execFileSync('javap', ['-p', '-c', '-constants', ...list],
  { cwd: work, maxBuffer: 1 << 30, env: { ...process.env, JAVA_TOOL_OPTIONS: '' } }).toString();

/** Split javap's concatenation back into one text per class. */
function dumps(names) {
  const text = javap(names.map((c) => c + '.class'));
  const out = new Map();
  let cur = null, buf = [];
  for (const line of text.split('\n')) {
    const m = line.match(/^(?:public |final |abstract |)+class ([A-Za-z0-9$_]+)/);
    if (m) { if (cur) out.set(cur, buf.join('\n')); cur = m[1]; buf = []; }
    buf.push(line);
  }
  if (cur) out.set(cur, buf.join('\n'));
  return out;
}

/**
 * Every `tick`-shaped method body in a class dump, as an array of instruction lines.
 * ⚠ THE TICK IS NOT FOUND BY NAME. It is obfuscated (`k()` in all four classes read here, but
 * that is an accident of this jar), so the body is found by CONTENT: the method that contains
 * the on-ground field test AND a three-argument Vec3 multiply is the only one that can carry
 * the law this file is after. A name match would be a guess that happens to work once.
 */
function bodies(dump) {
  const out = [];
  let cur = null;
  for (const line of dump.split('\n')) {
    if (/^ {2}\S.*\(.*\);\s*$/.test(line)) { if (cur) out.push(cur); cur = []; continue; }
    if (cur && /^\s+\d+:/.test(line)) cur.push(line.trim());
  }
  if (cur) out.push(cur);
  return out;
}

/** The Vec3-ish class this method reads its delta out of: the return type of a no-arg getter. */
function vecClass(code) {
  for (const l of code) {
    const m = l.match(/invokevirtual\s+#\d+\s+\/\/ Method [A-Za-z0-9$_.]*:\(\)L([A-Za-z0-9$_]+);/);
    if (m && code.some((x) => x.includes(`Method ${m[1]}.`) && /\(DDD\)L/.test(x))) return m[1];
  }
  return null;
}

/**
 * Walk BACKWARDS from a `(DDD)` call and recover its three operands.
 * Each operand is either a constant (`dconst_0`, `dconst_1`, `ldc2_w // double X`) or a variable
 * (`fload_N` + `f2d`, or `dload_N`). Returns three entries of {k:'c'|'v', v}, in source order.
 * ⚠ A `(DDD)` call whose operands are not all recognised returns null rather than a partial
 * answer — half a law is worse than none, because it looks like a measurement.
 */
function argsOf(code, at) {
  const args = [];
  let i = at - 1;
  while (args.length < 3 && i >= 0) {
    const l = code[i];
    if (/^\d+: f2d$/.test(l)) {
      const p = code[i - 1] || '';
      const m = p.match(/^\d+: fload(?:_|\s+)(\d+)$/);
      if (!m) return null;
      args.push({ k: 'v', v: Number(m[1]) }); i -= 2; continue;
    }
    if (/^\d+: dconst_0$/.test(l)) { args.push({ k: 'c', v: 0 }); i--; continue; }
    if (/^\d+: dconst_1$/.test(l)) { args.push({ k: 'c', v: 1 }); i--; continue; }
    const c = l.match(/^\d+: ldc2_w\s+#\d+\s+\/\/ double ([-\d.E]+)d$/);
    if (c) { args.push({ k: 'c', v: Number(c[1]) }); i--; continue; }
    const d = l.match(/^\d+: dload(?:_|\s+)(\d+)$/);
    if (d) { args.push({ k: 'v', v: Number(d[1]) }); i--; continue; }
    return null;
  }
  return args.length === 3 ? args.reverse() : null;
}

/** The instruction index of the nearest preceding `getfield ... y:Z`-shaped boolean test. */
function nearestBoolField(code, at, within) {
  for (let i = at - 1; i >= Math.max(0, at - within); i--) {
    const m = code[i].match(/getfield\s+#\d+\s+\/\/ Field ([A-Za-z0-9$_]+):Z$/);
    if (m) return { i, name: m[1] };
  }
  return null;
}

const rows = [];
const dumpMap = dumps([...new Set(simulatable.map((n) => classOf.get(n)))]);
const seen = new Map();

for (const name of simulatable) {
  const cls = classOf.get(name);
  const dump = dumpMap.get(cls);
  if (!dump) { rows.push([name, cls, '', '', '', '', '', '', '']); continue; }
  if (seen.has(cls)) { const r = seen.get(cls).slice(); r[0] = name; rows.push(r); continue; }

  let best = null;
  for (const code of bodies(dump)) {
    const V = vecClass(code);
    if (!V) continue;
    const mulRe = new RegExp(`invokevirtual\\s+#\\d+\\s+// Method ${V}\\.[A-Za-z0-9$_]+:\\(DDD\\)L${V};`);
    const sites = [];
    for (let i = 0; i < code.length; i++) if (mulRe.test(code[i])) sites.push(i);
    if (!sites.length) continue;

    let mode = '', k = '', dragY = '', flat = '', bounce = '', guard = '';
    for (const at of sites) {
      const a = argsOf(code, at);
      if (!a) continue;
      // BLOCK shape: (var, const, same var)
      if (a[0].k === 'v' && a[2].k === 'v' && a[0].v === a[2].v && a[1].k === 'c') {
        // the variable must have been seeded with a float constant and re-seeded inside the
        // on-ground branch by a multiply — that is what makes it "the friction of the block below"
        const slot = a[0].v;
        let seed = null, reseeded = false;
        for (let i = 0; i < at; i++) {
          const f = code[i].match(/^\d+: ldc(?:_w)?\s+#\d+\s+\/\/ float ([-\d.E]+)f$/);
          if (f && /^\d+: fstore(?:_|\s+)/.test(code[i + 1] || '') &&
              Number((code[i + 1].match(/fstore(?:_|\s+)(\d+)/) || [])[1]) === slot) {
            if (seed === null) seed = Number(f[1]);
            else if (/^\d+: fmul$/.test(code[i - 1] || '') || code.slice(i, at).some((x) => /^\d+: fmul$/.test(x))) reseeded = true;
          }
        }
        if (code.slice(0, at).some((x) => /^\d+: fmul$/.test(x))) reseeded = true;
        if (seed !== null && reseeded) { mode = 'block'; k = seed; dragY = a[1].v; }
        continue;
      }
      if (a[0].k !== 'c' || a[1].k !== 'c' || a[2].k !== 'c') continue;
      const g = nearestBoolField(code, at, 30);
      if (!g) continue;
      if (a[0].v === 1 && a[2].v === 1 && a[1].v < 0) {
        bounce = a[1].v;
        // guarded on "and it is still falling"? the y component is read and compared with 0
        guard = code.slice(g.i, at).some((x) => /^\d+: dcmp[gl]$/.test(x)) ? 'falling' : 'always';
        continue;
      }
      if (a[0].v === a[2].v && a[1].v < 0) {
        mode = mode || 'flat'; flat = a[0].v; bounce = a[1].v;
        guard = code.slice(g.i, at).some((x) => /^\d+: dcmp[gl]$/.test(x)) ? 'falling' : 'always';
      }
    }
    // the "an item at rest is only moved every fourth tick" cadence
    let rest = '';
    for (let i = 1; i < code.length; i++) {
      if (!/^\d+: irem$/.test(code[i])) continue;
      const p = (code[i - 1] || '').match(/^\d+: (?:iconst_(\d)|bipush\s+(\d+))$/);
      if (!p) continue;
      const v = Number(p[1] !== undefined ? p[1] : p[2]);
      if (v === 4 && rest === '') rest = 4;
    }
    if (mode) { best = [name, cls, mode, k, dragY, flat, bounce, guard, rest]; break; }
  }
  if (!best) best = [name, cls, '', '', '', '', '', '', ''];
  seen.set(cls, best);
  rows.push(best);
}

// ── anchors: four facts this file must reproduce, or it has not read the jar ────────────────
// ⚠ AND THEY ARE THE FOUR THE MEMORY OF A LANGUAGE MODEL GETS WRONG, deliberately: the orb's
// -0.9, the item's "only while falling" guard, TNT's 0.7, and the fact that item and orb share
// a shape but not a constant. An anchor set that only checked the item would have passed on the
// day the orb was read as -0.5.
const byName = Object.fromEntries(rows.map((r) => [r[0], r]));
const anch = (n, i, v, what) => ok(byName[n] && String(byName[n][i]) === String(v),
  `${n}: ${what} read as "${byName[n] ? byName[n][i] : 'no row'}", expected ${v}`);
if (byName.item) {
  anch('item', 2, 'block', 'mode'); anch('item', 3, 0.98, 'friction factor');
  anch('item', 4, 0.98, 'vertical drag'); anch('item', 6, -0.5, 'bounce');
  anch('item', 7, 'falling', 'bounce guard'); anch('item', 8, 4, 'at-rest move cadence');
}
if (byName.experience_orb) {
  anch('experience_orb', 2, 'block', 'mode'); anch('experience_orb', 6, -0.9, 'bounce');
  anch('experience_orb', 7, 'always', 'bounce guard');
}
if (byName.tnt) { anch('tnt', 2, 'flat', 'mode'); anch('tnt', 5, 0.7, 'ground friction'); anch('tnt', 6, -0.5, 'bounce'); }

const head = [
  '# entity-ground-1.18.2.tsv — generated by tools/extract-entity-ground.mjs from the 1.18.2 jar.',
  '# THE ON-GROUND HALF of an entity tick, which extract-entity-motion.mjs deliberately left owed.',
  '# name\tclass\tmode\tk\tdragY\tflat\tbounce\tguard\trestSkip',
  '#   mode  block = f starts at k and becomes blockFriction(below)*k on the ground, then',
  '#               multiply(f, dragY, f); flat = the uniform drag already ran, then on the',
  '#               ground multiply(flat, bounce, flat). An empty mode = not read: keep the',
  '#               uniform drag and change nothing (D-307).',
  '#   guard falling = the bounce only applies while the entity is already moving down.',
  '#   restSkip  an entity at rest on the ground is moved and damped only every Nth tick.',
];
writeFileSync(OUT, head.concat(rows.map((r) => r.join('\t'))).join('\n') + '\n');

say('');
say('========= extract-entity-ground =========');
for (const r of rows) say(`  ${r[0].padEnd(16)} ${r[2] || '(not read)'}  k=${r[3]} dragY=${r[4]} flat=${r[5]} bounce=${r[6]} ${r[7]} rest=${r[8]}`);
say(` ${rows.filter((r) => r[2]).length}/${rows.length} types carry an on-ground law`);
say(failures ? ` ${failures} anchor failures` : ' anchors green');
say('========================================');
process.exit(failures ? 1 : 0);
