#!/usr/bin/env node
// extract-itemmodel.mjs — PLAN G17d (D-342). THE SPRITE EXTRUSION, out of the 1.18.2 BYTECODE.
//
//   node tools/extract-itemmodel.mjs   -> tools/golden/itemmodel-1.18.2.tsv
//
// ⚠ WHY THIS EXISTS. A dropped stick was INVISIBLE. `ER.OWED_ITEM` named it as a written-down
// deviation — "sprite items (no block model)" — which is honest but is not a picture. An item
// entity holding a BLOCK is that block's model and was already drawn; an item entity holding a
// stick, an apple or an ingot is vanilla's EXTRUDED SPRITE: a front quad, a back quad, and a
// ring of one-pixel-deep side quads around every alpha boundary in the sprite, merged into runs.
//
// That geometry is compiled Java. It is not in any data pack, it is not in the assets, and it
// cannot be read off a screenshot: the depth is one sixteenth of a block and the side quads are
// only visible edge-on. So it comes out of the jar, and this file is the reading.
//
// ── HOW THE CLASS IS IDENTIFIED, AND WHY IT CANNOT BE A COINCIDENCE (D-263) ──────────────────
//   1. THREE classes in the 1.18.2 client carry the string `layer0`. A constant is not a use, so
//      that alone identifies nothing — it is the same trap `extract-guigeom.mjs` fell into with
//      the hotbar's 182.
//   2. Two independent discriminators are applied and BOTH must pick the same class:
//      a. it assembles the whole list `layer0..layer4` into one `List<String>` in `<clinit>`;
//      b. it declares two `private static final float` fields whose ConstantValues are 7.5 and
//         8.5 — the front and back Z planes — and pushes them repeatedly.
//      The other two carry neither: one is a worldgen placement codec whose strings are
//      `use_alternate_layer0_chance` and friends, the other has a single unrelated `layer0`.
//   3. The SIDE enum is read from its own `<clinit>`: four constants, each built with a
//      Direction and two ints. ⚠ `LEFT` carries **EAST** and `RIGHT` carries **WEST** — the
//      pairing looks backwards and it is what the jar says, because the sprite is seen from +Z.
//      Written down here so that nobody "fixes" it later from intuition.
//   4. The Direction enum's own `<clinit>` is read too, so `go.c` is NORTH because the jar says
//      the string NORTH next to that putstatic — never because of a remembered field order.
//   5. The ordinal switch map is read out of the synthetic `eru$1` class, so the four geometry
//      cases are attached to UP/DOWN/LEFT/RIGHT by the compiler's own table rather than by the
//      order they happen to appear in.
//
// ⚠ CLOSED IN BOTH DIRECTIONS: the number of `layer0` classes is asserted, each discriminator is
// asserted to pick EXACTLY ONE class, the two must agree, the side enum must have exactly four
// constants with four distinct directions, and the switch map must be a permutation of 1..4.
//
// ⚠ WHAT THIS FILE DOES **NOT** DECIDE. It records the jar's numbers. The port that consumes
// them is `tools/itemmodelgen.mjs`, and `tools/spritecheck.mjs` grades the port against THIS
// table — so a constant that is wrong here fails there rather than becoming a silent requirement
// (the `guicheck` lesson: a wrong check turns a bug into a requirement).

import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { requireJar } from './paths.mjs';

const MCLITE_ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT = join(MCLITE_ROOT, 'tools', 'golden', 'itemmodel-1.18.2.tsv');

const say = (...a) => console.log(...a);
let failures = 0;
const ok = (c, m) => { if (!c) { failures++; say('   x ' + m); } };

if (process.argv.includes('--if-missing') && existsSync(OUT)) {
  say(' itemmodel-1.18.2.tsv is present — nothing to do (--if-missing)');
  process.exit(0);
}

const JAR = requireJar('1.18.2');
try { execFileSync('javap', ['-version'], { stdio: 'ignore' }); }
catch { say('SKIP - no javap on this machine. Install a JDK, or keep the committed TSV.'); process.exit(0); }

say('extract-itemmodel — the sprite extrusion, out of the 1.18.2 client bytecode');

const work = mkdtempSync(join(tmpdir(), 'mclite-im-'));
execFileSync('unzip', ['-o', '-q', JAR, '*.class', '-d', work]);

const dump = (klass, verbose) =>
  execFileSync('javap', verbose ? ['-p', '-v', '-cp', work, klass] : ['-p', '-c', '-cp', work, klass],
               { maxBuffer: 1 << 27, stdio: ['ignore', 'pipe', 'ignore'] })
    .toString().split('\n').filter((l) => !l.startsWith('Picked up'));

// ── 1. the three classes that name layer0, and the two discriminators ────────────────────────
const withLayer0 = execFileSync('bash', ['-c',
  'cd ' + JSON.stringify(work) + " && grep -rl 'layer0' --include='*.class' . | sed 's|^\\./||; s|\\.class$||' | tr '/' '.'"],
  { maxBuffer: 1 << 26 }).toString().trim().split('\n').filter(Boolean);
say(' classes naming layer0 ....... ' + withLayer0.length + '  (' + withLayer0.join(' ') + ')');
ok(withLayer0.length >= 1 && withLayer0.length <= 8,
   withLayer0.length + ' classes name layer0 — that is not a discriminator at all');

// discriminator (a): the whole layer0..layer4 list, built in <clinit>
const byList = withLayer0.filter((k) => {
  const src = dump(k).join('\n');
  return ['layer0', 'layer1', 'layer2', 'layer3', 'layer4'].every((s) => src.includes('String ' + s));
});
// discriminator (b): the 7.5/8.5 front and back planes as ConstantValue fields
const byPlanes = withLayer0.filter((k) => {
  const v = dump(k, true).join('\n');
  return /ConstantValue: float 7\.5f/.test(v) && /ConstantValue: float 8\.5f/.test(v);
});
say(' with the whole layer list ... ' + (byList.join(' ') || '(none)'));
say(' with the 7.5/8.5 planes ..... ' + (byPlanes.join(' ') || '(none)'));
ok(byList.length === 1, 'the layer-list discriminator picked ' + byList.length + ' classes, not 1');
ok(byPlanes.length === 1, 'the Z-plane discriminator picked ' + byPlanes.length + ' classes, not 1');
ok(byList.length === 1 && byPlanes.length === 1 && byList[0] === byPlanes[0],
   'the two discriminators disagree: ' + byList[0] + ' vs ' + byPlanes[0]);
const GEN = byList[0];
say(' ItemModelGenerator .......... ' + GEN);

// the two planes, as numbers, read from the ConstantValue attributes rather than from a push
const genV = dump(GEN, true).join('\n');
const planes = [...genV.matchAll(/ConstantValue: float ([\d.]+)f/g)].map((m) => Number(m[1]))
  .filter((v) => v > 1 && v < 16).sort((a, b) => a - b);
ok(planes.length === 2, 'expected exactly two plane constants, found ' + planes.length);
const [FRONT_Z, BACK_Z] = planes;
ok(BACK_Z - FRONT_Z === 1, 'the extrusion is not one pixel deep: ' + FRONT_Z + '..' + BACK_Z);

// ── 2. the Direction enum, by its own strings ────────────────────────────────────────────────
// ⚠ NEVER by remembered field order. `go.c` is NORTH because the jar puts the string NORTH two
// instructions before `putstatic Field c:Lgo;`, and that is the only reason.
function enumFields(klass) {
  const lines = dump(klass);
  const at = lines.findIndex((l) => /^  static \{\};/.test(l));
  ok(at >= 0, klass + ' has no <clinit>');
  const map = Object.create(null);
  let pending = null;
  for (let i = at; i < lines.length; i++) {
    const s = lines[i].match(/ldc(?:_w)?\s+#\d+\s+\/\/ String ([A-Z_][A-Z_0-9]*)$/);
    if (s) { pending = s[1]; continue; }
    const p = lines[i].match(/putstatic\s+#\d+\s+\/\/ Field (\w+):L/);
    if (p && pending) { map[p[1]] = pending; pending = null; }
  }
  return map;
}
const DIROF = enumFields('go');
const DIRNAMES = Object.values(DIROF);
say(' Direction fields ............ ' + Object.entries(DIROF).map(([f, n]) => f + '=' + n).join(' '));
ok(new Set(DIRNAMES).size === 6 && ['DOWN', 'UP', 'NORTH', 'SOUTH', 'WEST', 'EAST']
     .every((n) => DIRNAMES.includes(n)),
   'the Direction enum did not come out as six distinct compass names');

// ── 3. the SIDE enum: four constants, each (Direction, dx, dy) ───────────────────────────────
// Its `<clinit>` reads:  ldc "UP" / iconst_0 / getstatic go.b / iconst_0 / iconst_m1 / invokespecial
const sideLines = dump(GEN + '$b');
const sideAt = sideLines.findIndex((l) => /^  static \{\};/.test(l));
ok(sideAt >= 0, GEN + '$b has no <clinit> — the side enum was not found');
const SIDES = [];
{
  let name = null, dir = null, ints = [];
  const num = (l) => {
    let m = l.match(/\b(?:iconst_(m?\d)|bipush\s+(-?\d+)|sipush\s+(-?\d+))/);
    if (!m) return null;
    if (m[1] !== undefined) return m[1].startsWith('m') ? -Number(m[1].slice(1)) : Number(m[1]);
    return Number(m[2] !== undefined ? m[2] : m[3]);
  };
  for (let i = sideAt; i < sideLines.length; i++) {
    const l = sideLines[i];
    const s = l.match(/ldc(?:_w)?\s+#\d+\s+\/\/ String ([A-Z]+)$/);
    if (s) { name = s[1]; dir = null; ints = []; continue; }
    if (name === null) continue;
    // ⚠ javap QUALIFIES a field it resolves on ANOTHER class and does not qualify one it
    // resolves on this class or its superclass: `// Field go.b:Lgo;` here, but `// Field
    // b:Leru$b;` inside the enum's own methods. The first draft of this regex required a bare
    // name, matched nothing at all, and the "read 0 span sides" assertion is the only reason
    // that came out as a failure instead of an empty table.
    const g = l.match(/getstatic\s+#\d+\s+\/\/ Field (?:go\.)?(\w+):Lgo;/);
    if (g) { dir = DIROF[g[1]]; ints = []; continue; }
    if (dir !== null) { const n = num(l); if (n !== null) ints.push(n); }
    if (dir !== null && ints.length === 2 && /invokespecial/.test(l)) {
      SIDES.push({ name, dir, dx: ints[0], dy: ints[1] });
      name = null; dir = null; ints = [];
    }
  }
}
say(' span sides .................. ' +
    SIDES.map((s) => s.name + '->' + s.dir + '(' + s.dx + ',' + s.dy + ')').join(' '));
ok(SIDES.length === 4, 'expected four span sides, read ' + SIDES.length);
ok(new Set(SIDES.map((s) => s.dir)).size === 4, 'two span sides carry the same Direction');
ok(SIDES.every((s) => Math.abs(s.dx) + Math.abs(s.dy) === 1),
   'a span side offset is not a unit step');

// ── 4. isHorizontal(): which sides run along X ───────────────────────────────────────────────
// The method that compares `this` against two of the constants and returns a boolean.
{
  const fieldOfName = Object.create(null);
  for (let i = sideAt; i < sideLines.length; i++) {
    const s = sideLines[i].match(/ldc(?:_w)?\s+#\d+\s+\/\/ String ([A-Z]+)$/);
    if (!s) continue;
    for (let j = i; j < Math.min(i + 20, sideLines.length); j++) {
      const p = sideLines[j].match(/putstatic\s+#\d+\s+\/\/ Field (\w+):L/);
      if (p) { fieldOfName[p[1]] = s[1]; break; }
    }
  }
  let horiz = null;
  for (let i = 0; i < sideLines.length; i++) {
    if (!/^  boolean \w+\(\);/.test(sideLines[i])) continue;
    // ⚠ THE BODY ENDS AT THE NEXT MEMBER, NOT AT A LINE COUNT. The first draft took a fixed
    // 24-line window and ran straight into the next method, so it read FOUR constant
    // references where the method has two and rejected a correct reading. A window is a
    // guess; the declaration that follows is a fact.
    let end = i + 1;
    while (end < sideLines.length && !/^  \S.*[({]/.test(sideLines[end])) end++;
    const body = sideLines.slice(i, end).join('\n');
    const refs = [...new Set([...body.matchAll(/getstatic\s+#\d+\s+\/\/ Field (\w+):L\w+\$b;/g)]
      .map((m) => fieldOfName[m[1]]))];
    if (refs.length === 2 && refs.every(Boolean)) horiz = refs;
  }
  ok(!!horiz, 'no two-constant boolean method — isHorizontal() was not found');
  for (const s of SIDES) s.horiz = horiz ? horiz.includes(s.name) : false;
  say(' horizontal sides ............ ' + (horiz || []).join(' '));
  ok(SIDES.filter((s) => s.horiz).length === 2, 'isHorizontal() does not split the four sides 2/2');
  // and it must agree with the offsets: a horizontal span runs along X, so it steps in Y
  for (const s of SIDES) {
    ok(s.horiz === (s.dx === 0),
       'side ' + s.name + ' says horiz=' + s.horiz + ' but steps (' + s.dx + ',' + s.dy + ')');
  }
}

// ── 5. the ordinal switch map, from the synthetic class ──────────────────────────────────────
{
  const sw = dump(GEN + '$1');
  const order = [];
  let field = null;
  for (const l of sw) {
    const g = l.match(/getstatic\s+#\d+\s+\/\/ Field \w+\$b\.(\w+):/);
    if (g) { field = g[1]; continue; }
    const c = l.match(/\biconst_(\d)\b/);
    if (c && field) { order.push([field, Number(c[1])]); field = null; }
  }
  const fieldOfName = Object.create(null);
  for (let i = sideAt; i < sideLines.length; i++) {
    const s = sideLines[i].match(/ldc(?:_w)?\s+#\d+\s+\/\/ String ([A-Z]+)$/);
    if (!s) continue;
    for (let j = i; j < Math.min(i + 20, sideLines.length); j++) {
      const p = sideLines[j].match(/putstatic\s+#\d+\s+\/\/ Field (\w+):L/);
      if (p) { fieldOfName[p[1]] = s[1]; break; }
    }
  }
  for (const [f, n] of order) { const s = SIDES.find((x) => x.name === fieldOfName[f]); if (s) s.case = n; }
  say(' switch cases ................ ' + SIDES.map((s) => s.name + '=' + s.case).join(' '));
  ok(SIDES.every((s) => s.case >= 1 && s.case <= 4), 'a span side has no switch case');
  ok(new Set(SIDES.map((s) => s.case)).size === 4, 'the switch map is not a permutation of 1..4');
}

// ── 6. the two FRONT/BACK face UV rects, from the element builder ────────────────────────────
// The method that puts two faces into a map and then builds one element spanning the whole
// sprite. Each `new erq([...4 floats...], 0)` immediately after a `getstatic Field go.X` is that
// face's uv rect; the Direction comes from the getstatic, never from the order.
{
  const lines = dump(GEN);
  const at = lines.findIndex((l) => /^  private java\.util\.List<\w+> \w+\(int, java\.lang\.String, \w+\);/.test(l));
  ok(at >= 0, 'the front/back element builder was not found');
  const body = lines.slice(at, at + 180);
  const faces = [];
  let dir = null, floats = [];
  for (const l of body) {
    const g = l.match(/getstatic\s+#\d+\s+\/\/ Field go\.(\w+):Lgo;/);
    if (g) { dir = DIROF[g[1]]; floats = []; continue; }
    if (dir === null) continue;
    if (/\bfconst_0\b/.test(l)) floats.push(0);
    else { const m = l.match(/ldc\s+#\d+\s+\/\/ float ([\d.]+)f/); if (m) floats.push(Number(m[1])); }
    if (floats.length === 4 && /invokespecial.*erq|invokespecial.*"<init>":\(\[FI\)V/.test(l)) {
      faces.push({ dir, uv: floats.slice() }); dir = null; floats = [];
    }
  }
  say(' front/back faces ............ ' + faces.map((f) => f.dir + '[' + f.uv.join(',') + ']').join(' '));
  ok(faces.length === 2, 'expected two whole-sprite faces, read ' + faces.length);
  ok(faces.length === 2 && faces[0].dir !== faces[1].dir, 'both whole-sprite faces name one Direction');
  var FACES = faces;
}

// ── 6b. THE GROUND DISPLAY TRANSFORMS, from the jar's own model JSON ─────────────────────────
// ⚠⚠ A DROPPED SPRITE AND A DROPPED BLOCK ARE NOT THE SAME SIZE, and this is the row that says
// so. `block/block.json` puts a dropped block at translation (0,3,0) scale 0.25;
// `item/generated.json` puts a dropped sprite at translation (0,2,0) scale **0.5** — twice as
// big, lifted less. `07j_entityrender.js` carried only the block pair, so every sprite item
// would have come out half the size vanilla draws it, and nothing would have said a word
// because half-size is a perfectly plausible picture.
// ⚠ `item/handheld.json` inherits `ground` from `item/generated` and overrides only the hand
// transforms, so a sword and a stick have the same ground transform. Asserted, not assumed.
const grounds = {};
for (const path of ['block/block', 'item/generated', 'item/handheld']) {
  let j = null;
  try {
    j = JSON.parse(execFileSync('unzip', ['-p', JAR, 'assets/minecraft/models/' + path + '.json'],
                                { maxBuffer: 1 << 24 }).toString());
  } catch { j = null; }
  const g = j && j.display && j.display.ground;
  if (g) grounds[path] = { ty: (g.translation || [0, 0, 0])[1], scale: (g.scale || [1, 1, 1])[1] };
}
say(' ground transforms ........... ' +
    Object.entries(grounds).map(([k, v]) => k + ' ty=' + v.ty + ' scale=' + v.scale).join('  '));
ok(!!grounds['block/block'], 'block/block.json has no display.ground');
ok(!!grounds['item/generated'], 'item/generated.json has no display.ground');
ok(!grounds['item/handheld'],
   'item/handheld.json now OVERRIDES display.ground — a sword no longer lies on the ground '
   + 'like a stick and this table needs a third row');
ok(grounds['block/block'] && grounds['item/generated'] &&
   grounds['block/block'].scale !== grounds['item/generated'].scale,
   'the block and sprite ground scales came out the same — one of them was read wrong');

// ── 7. java.util.Random, FROM A REAL JVM ─────────────────────────────────────────────────────
// ⚠⚠ THE STACK PILE'S OFFSETS ARE DRAWN FROM `java.util.Random`, so reproducing the picture
// means reproducing the LCG — and "I implemented the same algorithm" is a claim, not a check.
// A JDK is already required for `javap`, so the sequence is generated by the JVM itself and
// pinned here. `src/07j_entityrender.js`'s `ER.JRand` is then graded against numbers Java
// produced, not against a second copy of my own arithmetic.
// ⚠ The seeds are the ones the renderer actually uses: 187 is the empty-stack sentinel it
// hard-codes, and the rest stand in for `Item.getId(item) + damage`.
{
  const src = 'public class JR { public static void main(String[] a) {\n' +
    '  long[] seeds = {0L, 1L, 187L, 42L, 1000L, 20344L};\n' +
    '  for (long s : seeds) {\n' +
    '    java.util.Random r = new java.util.Random(s);\n' +
    '    StringBuilder b = new StringBuilder();\n' +
    '    for (int i = 0; i < 8; i++) { if (i > 0) b.append(","); b.append(Float.toString(r.nextFloat())); }\n' +
    '    System.out.println(s + "\\t" + b);\n' +
    '  }\n' +
    '} }\n';
  const jdir = mkdtempSync(join(tmpdir(), 'mclite-jr-'));
  writeFileSync(join(jdir, 'JR.java'), src);
  let out = '';
  try {
    execFileSync('javac', ['-d', jdir, join(jdir, 'JR.java')], { stdio: ['ignore', 'ignore', 'pipe'] });
    out = execFileSync('java', ['-cp', jdir, 'JR'], { stdio: ['ignore', 'pipe', 'ignore'] }).toString();
  } catch (e) {
    say('   ! javac/java unavailable — the java.util.Random rows are not regenerated');
    out = '';
  }
  var JRAND = out.trim().split('\n').filter(Boolean).map((l) => l.split('\t'));
  if (JRAND.length) {
    ok(JRAND.length === 6, 'expected six seeded sequences, the JVM produced ' + JRAND.length);
    ok(JRAND.every((r) => r[1].split(',').length === 8), 'a sequence is not eight values long');
    // two different seeds must not produce the same sequence, or the pin proves nothing
    ok(new Set(JRAND.map((r) => r[1])).size === JRAND.length,
       'two seeds produced identical sequences — the generator was not reseeded');
    say(' java.util.Random ............ ' + JRAND.length + ' seeded sequences from a real JVM');
  }
}

// ── the table ────────────────────────────────────────────────────────────────────────────────
const rows = [];
rows.push(['kind', 'a', 'b', 'c', 'd'].join('\t'));
rows.push(['class', GEN, '', '', ''].join('\t'));
rows.push(['plane', 'front', String(FRONT_Z), 'back', String(BACK_Z)].join('\t'));
for (const f of FACES) rows.push(['face', f.dir, f.uv.join(','), '', ''].join('\t'));
for (const s of SIDES) {
  rows.push(['side', s.name, s.dir, s.dx + ',' + s.dy, (s.horiz ? 'horiz' : 'vert') + ',' + s.case].join('\t'));
}
for (const [k, v] of Object.entries(grounds)) {
  rows.push(['ground', k, String(v.ty), String(v.scale), ''].join('\t'));
}
if (typeof JRAND !== 'undefined') {
  for (const [seed, vals] of JRAND) rows.push(['jrand', seed, vals, '', ''].join('\t'));
}
mkdirSync(join(MCLITE_ROOT, 'tools', 'golden'), { recursive: true });
writeFileSync(OUT, rows.join('\n') + '\n');

say('');
say(' ' + GEN + ': planes ' + FRONT_Z + '/' + BACK_Z + ', ' + FACES.length + ' whole-sprite faces, '
    + SIDES.length + ' span sides -> ' + OUT.replace(MCLITE_ROOT, ''));
if (failures) { say('\nextract-itemmodel: ' + failures + ' assertion(s) FAILED'); process.exit(1); }
say('extract-itemmodel: OK');
