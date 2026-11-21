#!/usr/bin/env node
// extract-support.mjs — PLAN G15c (D-346). WHICH BLOCKS HAVE A `canSurvive`, OUT OF THE BYTECODE.
//
//   node tools/extract-support.mjs   -> tools/golden/cansurvive-1.18.2.tsv
//
// ⚠⚠ **WHY THIS EXISTS.** `tools/pack-runtime.mjs` derives a block's support class from its
// `material` plus two hand-written lists, and says so: *"what CAN be derived here is the class of
// rule"*. It was right for what it covered and it cannot cover the rest — a rail needs a RIGID
// face below, a cactus needs no solid neighbour on any side, a lever asks the face it is attached
// to, and `material` says none of those. Measured in this engine: **rail, snow layer, cactus,
// lever, button, door, lily pad, carpet and pressure plate can all be placed in mid-air.**
//
// So the question "does this block have a survival rule at all, and whose" stops being a guess:
// vanilla answers it by OVERRIDING `canSurvive`, and this reads the override table out of the jar.
//
// ── HOW EACH THING IS IDENTIFIED, AND WHY IT CANNOT BE A COINCIDENCE (D-263) ─────────────────
//   1. `canSurvive` BY SHAPE AND BY COUNT, never by name — there are no names. It is the method
//      taking (BlockState, LevelReader, BlockPos) and returning boolean. Every one of those three
//      types is itself found by use:
//        - the two candidate 3-reference-argument boolean descriptors are counted, and the one
//          with the most overrides wins ONLY IF its second parameter is the NARROWER of the two
//          level interfaces (LevelReader extends BlockGetter). The other, with a BlockGetter, is
//          `propagatesSkylightDown` — a real method with real overriders, and the trap here.
//        - the declaring class must be the base class every block state descends from.
//      ⚠ Both counts are printed and asserted, so "56 classes override it" is a fact on the page
//      rather than a claim in a comment.
//   2. The `Blocks` class, by the same test `tools/extract-materials.mjs` uses: the class with
//      850-1100 static finals of one Block type. Its `<clinit>` gives name -> field AND
//      name -> constructed class, both read from the same registration window.
//   3. A block's rule OWNER is the first class in its superclass chain that overrides the method.
//      That is what makes this exact rather than approximate: two blocks share a rule when and
//      only when they share an owner.
//   4. The three SUPPORT TYPES come from the enum's own three anonymous subclasses, and their
//      names are read from the `<clinit>` strings — FULL, CENTER, RIGID — never assumed from the
//      field order. Each carries the VoxelShape its test intersects against, and those shapes are
//      the rectangles the runtime needs: CENTER is box(7,0,7 .. 9,10,9) and RIGID is a full block
//      MINUS box(2,0,2 .. 14,16,14), which is the outer two-pixel rim.
//   5. `getBlockSupportShape` is read too, because it is NOT the collision shape: seven blocks
//      override it. A cauldron, a composter and a hopper are hollow and still support a rail.
//
// ⚠ CLOSED IN BOTH DIRECTIONS: every one of the ~900 blocks is either joined to an owner class or
// counted as having no override; the owner list and the block list must reconcile; and the three
// support types must come out with three distinct names and three distinct shapes.
//
// ⚠ THIS FILE DECIDES NOTHING ABOUT WHAT THE ENGINE DOES. It records which blocks have a rule and
// whose. `src/02c_states.js` implements the rules and `tools/supportcheck.mjs` grades it against
// this table — so a family that is not implemented yet is a NAMED row here, not a silence.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { requireJar } from './paths.mjs';

const MCLITE_ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT = join(MCLITE_ROOT, 'tools', 'golden', 'cansurvive-1.18.2.tsv');

const say = (...a) => console.log(...a);
let failures = 0;
const ok = (c, m) => { if (!c) { failures++; say('   x ' + m); } };

if (process.argv.includes('--if-missing') && existsSync(OUT)) {
  say(' cansurvive-1.18.2.tsv is present — nothing to do (--if-missing)');
  process.exit(0);
}

const JAR = requireJar('1.18.2');
try { execFileSync('javap', ['-version'], { stdio: 'ignore' }); }
catch { say('SKIP - no javap on this machine. Install a JDK, or keep the committed TSV.'); process.exit(0); }

say('extract-support — the canSurvive override table, out of the 1.18.2 bytecode');

const work = mkdtempSync(join(tmpdir(), 'mclite-sup-'));
execFileSync('unzip', ['-o', '-q', JAR, '*.class', '-d', work]);

const classes = execFileSync('bash', ['-c',
  'cd ' + JSON.stringify(work) + " && ls *.class | sed 's/\\.class$//'"],
  { maxBuffer: 1 << 26 }).toString().trim().split('\n').filter(Boolean);
say(' classes in the jar .......... ' + classes.length);
ok(classes.length > 3000, 'only ' + classes.length + ' classes — the jar did not unpack');

// ── 1. one signature dump for the whole jar ─────────────────────────────────────────────────
// javap over 6,000 classes in batches takes about ten seconds and gives every declaration in one
// place; the alternative is one process per class, which is minutes.
let sigs = '';
for (let i = 0; i < classes.length; i += 400) {
  sigs += execFileSync('javap', ['-p', '-cp', work].concat(classes.slice(i, i + 400)),
                       { maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'ignore'] }).toString();
}
const lines = sigs.split('\n').filter((l) => !l.startsWith('Picked up'));
say(' declarations read ........... ' + lines.length);

const CLS = /^(?:public |final |abstract |protected |private |static |)*(?:class|interface|enum) ([\w$.]+)(?: extends ([\w$.]+))?/;
const superOf = Object.create(null);
const fieldsOf = Object.create(null);
const boolM = /^\s+(?:public |protected |private |static |final |abstract |synchronized |native |)*boolean (\w+)\(([^)]*)\);/;
const shapeM = /^\s+(?:public |protected |private |static |final |abstract |)*(\w+) (\w+)\(([^)]*)\);/;
const statF = /^\s+public static final ([\w$.]+) (\w+);/;

const boolSigs = new Map();     // "name|a,b,c" -> [owners]
const shape3 = new Map();       // "ret|name|a,b,c" -> [owners]
let cur = null;
for (const l of lines) {
  if (l && !/^\s/.test(l)) { const m = CLS.exec(l.trim()); if (m) { superOf[m[1]] = m[2] || null; cur = m[1]; } continue; }
  if (!cur) continue;
  const f = statF.exec(l);
  if (f) { (fieldsOf[cur] = fieldsOf[cur] || []).push([f[1], f[2]]); }
  const b = boolM.exec(l);
  if (b) {
    const args = b[2].split(',').map((s) => s.trim()).filter(Boolean);
    if (args.length === 3 && args.every((a) => /^[\w$.]+$/.test(a) &&
        !['int', 'long', 'float', 'double', 'boolean', 'char', 'byte', 'short'].includes(a))) {
      const k = b[1] + '|' + args.join(',');
      if (!boolSigs.has(k)) boolSigs.set(k, []);
      boolSigs.get(k).push(cur);
    }
  }
  const s3 = shapeM.exec(l);
  if (s3 && s3[1] !== 'boolean') {
    const args = s3[3].split(',').map((x) => x.trim()).filter(Boolean);
    if (args.length === 3) {
      const k = s3[1] + '|' + s3[2] + '|' + args.join(',');
      if (!shape3.has(k)) shape3.set(k, []);
      shape3.get(k).push(cur);
    }
  }
}

// ── 2. canSurvive, by count AND by the narrower level type ──────────────────────────────────
const byArgs = new Map();
for (const [k, owners] of boolSigs) {
  const args = k.split('|')[1];
  byArgs.set(args, (byArgs.get(args) || 0) + owners.length);
}
const ranked = [...byArgs].sort((a, b) => b[1] - a[1]).slice(0, 4);
say(' top 3-arg boolean shapes .... ' + ranked.map(([a, n]) => a + ' x' + n).join('   '));
ok(ranked.length >= 2, 'fewer than two candidate shapes — the dump did not parse');

// the two leaders differ only in their SECOND parameter; the narrower one is LevelReader
const [A, B] = ranked;
const aArgs = A[0].split(','), bArgs = B ? B[0].split(',') : null;
ok(!!bArgs && aArgs[0] === bArgs[0] && aArgs[2] === bArgs[2],
   'the two leading shapes do not differ in exactly one parameter — the trap has changed shape');
const extendsChain = (c) => { const out = []; let x = c; for (let i = 0; i < 25 && x; i++) { out.push(x); x = superOf[x]; } return out; };
// an interface's `extends` is recorded too, so "narrower" is "reaches the other by extends"
const narrower = (p, q) => extendsChain(p).includes(q);
const levelA = aArgs[1], levelB = bArgs ? bArgs[1] : null;
let LEVEL = null;
if (levelB && narrower(levelA, levelB)) LEVEL = levelA;
else if (levelB && narrower(levelB, levelA)) LEVEL = levelB;
say(' level interfaces ............ ' + levelA + ' vs ' + levelB + '  -> LevelReader is ' + LEVEL);
ok(!!LEVEL, 'neither level interface extends the other — cannot tell LevelReader from BlockGetter');
const SIG = [aArgs[0], LEVEL, aArgs[2]].join(',');

// among the methods with that argument shape, canSurvive is the one with the most overriders
let best = null;
for (const [k, owners] of boolSigs) {
  const [name, args] = k.split('|');
  if (args !== SIG) continue;
  if (!best || owners.length > best.owners.length) best = { name, owners };
}
ok(!!best && best.owners.length >= 20,
   'the winning method has only ' + (best ? best.owners.length : 0) + ' overriders — that is not canSurvive');
const CAN = best.name, CAN_OWNERS = new Set(best.owners);
const STATE = aArgs[0], POS = aArgs[2];
// the class that DECLARES it is the base every block state descends from
const BASE = best.owners.find((c) => superOf[STATE] && superOf[STATE].startsWith(c));
say(' canSurvive .................. ' + CAN + '(' + SIG + ')Z   ' + best.owners.length + ' overriders');
say(' BlockState ' + STATE + ' extends ' + superOf[STATE] + '   BlockPos ' + POS +
    (BASE ? '   declared on ' + BASE : ''));
ok(!!BASE, 'no overrider is the class BlockState descends from — the base was not identified');

// ── 3. the Blocks class, and the two maps its <clinit> gives ────────────────────────────────
let BLOCKS = null, BLOCKTYPE = null, BLOCKN = 0;
for (const [c, fs] of Object.entries(fieldsOf)) {
  const count = new Map();
  for (const [t] of fs) count.set(t, (count.get(t) || 0) + 1);
  for (const [t, n] of count) if (n >= 850 && n <= 1100 && n > BLOCKN) { BLOCKS = c; BLOCKTYPE = t; BLOCKN = n; }
}
say(' Blocks class ................ ' + BLOCKS + ' with ' + BLOCKN + ' static finals of ' + BLOCKTYPE);
ok(!!BLOCKS, 'no class has 850-1100 static finals of one type — Blocks was not found');

const blocksCode = execFileSync('javap', ['-p', '-c', '-cp', work, BLOCKS],
  { maxBuffer: 1 << 27, stdio: ['ignore', 'pipe', 'ignore'] }).toString().split('\n');
const nameToClass = new Map(), fieldToName = new Map();
{
  // Each registration window carries the registry NAME as a String constant, constructs the block
  // with `new <Class>`, and ends at the `putstatic` of the field. Reading all three from the same
  // window is what joins them; reading them from separate passes would join the wrong pairs.
  let name = null, cls = null;
  const reName = new RegExp('ldc(?:_w)?\\s+#\\d+\\s+// String ([a-z_0-9]+)$');
  const reNew = /new\s+#\d+\s+\/\/ class ([\w$/]+)/;
  const rePut = new RegExp('putstatic\\s+#\\d+\\s+// Field (\\w+):L' + BLOCKTYPE + ';');
  for (const l of blocksCode) {
    const n = reName.exec(l); if (n) { name = n[1]; cls = null; continue; }
    const w = reNew.exec(l); if (w && name && cls === null) cls = w[1];
    const p = rePut.exec(l);
    if (p && name) { nameToClass.set(name, cls || ''); fieldToName.set(p[1], name); name = null; cls = null; }
  }
}
say(' blocks joined to a class .... ' + nameToClass.size + '   (' +
    [...nameToClass.values()].filter((v) => !v).length + ' built by a helper, class unknown)');
ok(nameToClass.size >= 850, 'only ' + nameToClass.size + ' blocks joined — the <clinit> walk failed');
ok(fieldToName.size === nameToClass.size, 'the field map and the class map disagree in size');

// ── 4. each block's rule OWNER: the first class in its chain that overrides canSurvive ───────
const ownerOf = new Map();
for (const [n, c] of nameToClass) {
  if (!c) continue;
  for (const k of extendsChain(c)) {
    if (k === BASE) break;                      // reached the default: no rule
    if (CAN_OWNERS.has(k)) { ownerOf.set(n, k); break; }
  }
}
const byOwner = new Map();
for (const [n, o] of ownerOf) { if (!byOwner.has(o)) byOwner.set(o, []); byOwner.get(o).push(n); }
say(' blocks WITH a survival rule . ' + ownerOf.size + ' across ' + byOwner.size + ' classes');
ok(ownerOf.size > 100 && ownerOf.size < nameToClass.size,
   ownerOf.size + ' blocks have a rule — that is not a believable split');
ok(byOwner.size >= 20, 'only ' + byOwner.size + ' distinct owners');

// ── 5. the three SUPPORT TYPES, with their shapes ───────────────────────────────────────────
// The enum is the one with exactly three own-type static finals whose <clinit> names them; each
// constant is an anonymous subclass carrying the VoxelShape its test intersects against.
let SUPPORT = null;
for (const [c, fs] of Object.entries(fieldsOf)) {
  const own = fs.filter(([t]) => t === c);
  if (own.length !== 3) continue;
  const code = execFileSync('javap', ['-p', '-c', '-cp', work, c],
    { maxBuffer: 1 << 24, stdio: ['ignore', 'pipe', 'ignore'] }).toString();
  if (!/String FULL/.test(code) || !/String CENTER/.test(code) || !/String RIGID/.test(code)) continue;
  SUPPORT = { cls: c, code: code.split('\n') };
  break;
}
say(' SupportType enum ............ ' + (SUPPORT ? SUPPORT.cls : '(not found)'));
ok(!!SUPPORT, 'no three-constant enum naming FULL, CENTER and RIGID');
const types = [];
if (SUPPORT) {
  // name -> the anonymous subclass that implements it, from the <clinit> window
  let pendingCls = null;
  for (const l of SUPPORT.code) {
    const w = /new\s+#\d+\s+\/\/ class ([\w$]+)/.exec(l); if (w) { pendingCls = w[1]; continue; }
    const n = /ldc(?:_w)?\s+#\d+\s+\/\/ String (FULL|CENTER|RIGID)$/.exec(l);
    if (n && pendingCls) { types.push({ name: n[1], cls: pendingCls }); pendingCls = null; }
  }
  for (const t of types) {
    const body = execFileSync('javap', ['-p', '-c', '-cp', work, t.cls],
      { maxBuffer: 1 << 24, stdio: ['ignore', 'pipe', 'ignore'] }).toString();
    // ⚠ THE SIX DOUBLES INCLUDE `dconst_0`, WHICH IS NOT AN `ldc2_w`. The first draft matched only
    // `ldc2_w // double N` and read FIVE arguments for a six-argument box, so every support type
    // came out as "the whole face" — which is FULL's answer, given to all three. A constant
    // pushed by a dedicated opcode is still a constant.
    const nums = [];
    for (const l of body.split('\n')) {
      const m = /ldc2_w\s+#\d+\s+\/\/ double ([\d.]+)d/.exec(l);
      if (m) { nums.push(Number(m[1])); continue; }
      if (/\bdconst_0\b/.test(l)) nums.push(0);
      else if (/\bdconst_1\b/.test(l)) nums.push(1);
    }
    t.box = nums.length >= 6 ? nums.slice(0, 6) : null;
    // RIGID is a full block MINUS its box; CENTER is the box itself. The two are told apart by
    // whether the constructor starts from a whole-block shape before joining the box in.
    t.subtracts = /invokestatic\s+#\d+\s+\/\/ Method \w+\.\w+:\(\)L\w+;/.test(body) && !!t.box;
  }
  say(' support shapes .............. ' +
      types.map((t) => t.name + '[' + (t.box ? t.box.join(',') : 'whole face') + ']').join('  '));
  ok(types.length === 3, 'read ' + types.length + ' support types, not 3');
  ok(new Set(types.map((t) => t.name)).size === 3, 'two support types came out with the same name');
  const full = types.find((t) => t.name === 'FULL');
  ok(!!full && !full.box, 'FULL carries a box — it should test the WHOLE face');
}

// ── 6. getBlockSupportShape: NOT the collision shape ────────────────────────────────────────
// Among the 3-argument methods returning the VoxelShape type, the support shape is the one
// declared on the same base class as canSurvive. Seven blocks override it.
// ⚠ IDENTIFIED BY USE, IN TWO HOPS, because THREE different 3-argument methods on the base class
// return a VoxelShape and picking them all gave 35 blocks — fences, skulls and powder snow, which
// override the INTERACTION and VISUAL shapes and not this one. The support types themselves name
// the right one: each of their bodies calls exactly one BlockState method to get the shape it
// tests. Follow that call to the BlockState accessor, then follow the accessor to the Block
// method it forwards to, and the answer is a single method with a handful of overriders.
let shapeBlocks = new Map(), SUPPORT_SHAPE = null;
if (types.length) {
  const body0 = execFileSync('javap', ['-p', '-c', '-cp', work, types[0].cls],
    { maxBuffer: 1 << 24, stdio: ['ignore', 'pipe', 'ignore'] }).toString();
  const acc = new RegExp('Method ' + STATE + '\\.(\\w+):\\(L(\\w+);L' + POS + ';\\)L(\\w+);').exec(body0);
  ok(!!acc, 'no BlockState shape accessor in the FULL support type — cannot find the support shape');
  if (acc) {
    // ⚠ THE ACCESSOR IS DECLARED ON THE STATE'S SUPERCLASS, NOT ON THE STATE. `BlockState`
    // inherits every shape accessor from `BlockBehaviour.BlockStateBase`, so dumping the state
    // class alone finds nothing and the trail "breaks" on a jar that is perfectly ordinary.
    // Walk the chain and take the first class that declares it.
    let accBody = [];
    for (const k of extendsChain(STATE)) {
      const dump = execFileSync('javap', ['-p', '-c', '-cp', work, k],
        { maxBuffer: 1 << 27, stdio: ['ignore', 'pipe', 'ignore'] }).toString().split('\n');
      if (dump.some((l) => new RegExp('\\s' + acc[3] + ' ' + acc[1] + '\\(' + acc[2] + ', ' + POS + '\\);').test(l))) {
        accBody = dump; break;
      }
    }
    ok(accBody.length > 0, 'no class in the BlockState chain declares the shape accessor');
    // the accessor's own body forwards to one Block method taking (BlockState, BlockGetter, Pos)
    let inside = false, fwd = null;
    const head = new RegExp('^\\s+(?:public |)' + acc[3] + ' ' + acc[1] + '\\(' + acc[2] + ', ' + POS + '\\);');
    for (const l of accBody) {
      if (head.test(l)) { inside = true; continue; }
      if (!inside) continue;
      if (/^\s*$/.test(l)) break;
      const m = new RegExp('Method (\\w+)\\.(\\w+):\\(L' + STATE + ';L' + acc[2] + ';L' + POS + ';\\)L' + acc[3] + ';').exec(l);
      if (m) { fwd = m; break; }
    }
    ok(!!fwd, 'the shape accessor does not forward to a Block method — the two-hop trail broke');
    if (fwd) {
      SUPPORT_SHAPE = fwd[2] + '(' + [STATE, acc[2], POS].join(',') + ')';
      const key = acc[3] + '|' + fwd[2] + '|' + [STATE, acc[2], POS].join(',');
      const owners = (shape3.get(key) || []).filter((o) => o !== BASE);
      for (const [n, c] of nameToClass) {
        if (!c) continue;
        for (const k of extendsChain(c)) { if (k === BASE) break; if (owners.includes(k)) { shapeBlocks.set(n, k); break; } }
      }
      // #353: LeavesBlock is built by a HELPER (createLeavesBlock), so the <clinit> join leaves its
      // class unknown and the loop above skips all eight leaves. An override owner no named block
      // reaches is that helper's class; the helper-built `*_leaves` blocks are its blocks.
      const claimed = new Set(shapeBlocks.values());
      const orphans = owners.filter((o) => !claimed.has(o));
      if (orphans.length === 1) {
        for (const [n, c] of nameToClass) if (!c && /_leaves$/.test(n)) shapeBlocks.set(n, orphans[0]);
      }
    }
  }
}
say(' support shape ............... ' + (SUPPORT_SHAPE || '(not found)'));
say(' blocks overriding it ........ ' + shapeBlocks.size + '  (' +
    [...shapeBlocks.keys()].sort().join(' ') + ')');

// ── 7. mayPlaceOn: THE SECOND LEVEL OF THE RULE, AND THE REASON "THE BUSH FAMILY" IS NOT ONE
//      RULE ──────────────────────────────────────────────────────────────────────────────────
// ⚠⚠ **THE BIGGEST `canSurvive` OWNER DOES NOT DECIDE ANYTHING.** Its whole body is
//   `canSurvive(s, level, pos) { BlockPos b = pos.below(); return mayPlaceOn(getBlockState(b), level, b); }`
// and `mayPlaceOn` is overridden SEVENTEEN times beneath it. Reading the owner alone and calling
// its 37 blocks "one rule" would let a player plant NETHER WART ON GRASS and a LILY PAD ON STONE
// — a rule that admits an illegal build, which is the cheaper of the two failures but still a
// failure, and a rule that refused a legal one would be the expensive kind (D-346).
//
// ⚠ IDENTIFIED BY USE, ANCHORED ON THE DELEGATION ITSELF. The delegating owner is found by what
// its canSurvive DOES — fetch the state below, then call a method on ITSELF taking
// (BlockState, BlockGetter, BlockPos) and returning boolean — not by its size and not by a name.
// The method so found IS `mayPlaceOn`, and the trap next door is disarmed by construction: the
// other method with that exact descriptor is `propagatesSkylightDown`, and nothing here guesses
// between them, because this one was reached by following a call.
const GETTER = (levelA === LEVEL) ? levelB : levelA;
let GROUND = null, GROUND_OWNER = null;
{
  const reSelf = new RegExp('Method (\\w+):\\(L' + STATE + ';L' + GETTER + ';L' + POS + ';\\)Z');
  const delegating = [];
  for (const c of best.owners) {
    const dump = execFileSync('javap', ['-p', '-c', '-cp', work, c],
      { maxBuffer: 1 << 24, stdio: ['ignore', 'pipe', 'ignore'] }).toString().split('\n');
    // the canSurvive body only, and only when it also asks for the position BELOW
    let inside = false, sawBelow = false, call = null;
    const head = new RegExp('\\bboolean ' + CAN + '\\(' + [STATE, LEVEL, POS].join(', ') + '\\);');
    for (const l of dump) {
      if (head.test(l)) { inside = true; continue; }
      if (!inside) continue;
      if (/^\s*$/.test(l)) break;
      if (new RegExp('Method ' + POS + '\\.\\w+:\\(\\)L' + POS + ';').test(l)) sawBelow = true;
      const m = reSelf.exec(l);
      if (m && !call) call = m[1];
    }
    if (call && sawBelow) delegating.push([c, call]);
  }
  say(' canSurvive owners that DELEGATE to a ground test .. ' +
      delegating.map(([c, m]) => c + '.' + m).join(' ') || '(none)');
  ok(delegating.length >= 1, 'no canSurvive owner delegates to a (state, getter, pos) test — mayPlaceOn not found');
  // The one whose delegate has the MOST overriders is the family base; a delegate with one
  // implementation is a block asking its own private question, not a shared second level.
  let bestD = null;
  for (const [c, m] of delegating) {
    const n = (boolSigs.get(m + '|' + [STATE, GETTER, POS].join(',')) || []).length;
    if (!bestD || n > bestD[2]) bestD = [c, m, n];
  }
  GROUND_OWNER = bestD[0]; GROUND = bestD[1];
  say(' mayPlaceOn .................. ' + GROUND_OWNER + '.' + GROUND +
      '(' + [STATE, GETTER, POS].join(',') + ')Z   ' + bestD[2] + ' overriders');
  ok(bestD[2] >= 5, 'the ground test has only ' + bestD[2] + ' overriders — that is not mayPlaceOn');
  // ⚠ AND IT IS NOT THE TRAP. `propagatesSkylightDown` shares the descriptor exactly; if the
  // two ever came out as the same method the reading above followed a call into the wrong place.
  const trap = [...boolSigs].filter(([k]) => k.endsWith('|' + [STATE, GETTER, POS].join(',')))
    .sort((a, b) => b[1].length - a[1].length);
  say(' methods with that descriptor  ' + trap.map(([k, o]) => k.split('|')[0] + ' x' + o.length).join('  '));
  ok(trap.length >= 2, 'only one method has the ground descriptor — the trap has changed shape');
  ok(trap[0][0].split('|')[0] !== GROUND || trap[0][1].length === bestD[2],
     'the ground test and the descriptor leader disagree about their own overrider count');
}
// every block under the delegating owner, joined to the first class in its chain that overrides
// the ground test — that is its GROUND OWNER, and two blocks share a ground rule when and only
// when they share one.
const groundOwners = new Set(boolSigs.get(GROUND + '|' + [STATE, GETTER, POS].join(',')) || []);
const groundOf = new Map();
for (const [n, o] of ownerOf) {
  const c = nameToClass.get(n);
  if (!c) continue;
  for (const k of extendsChain(c)) {
    if (groundOwners.has(k)) { groundOf.set(n, k); break; }
    if (k === BASE) break;
  }
}
const byGround = new Map();
for (const [n, g] of groundOf) { if (!byGround.has(g)) byGround.set(g, []); byGround.get(g).push(n); }
say(' blocks with a GROUND rule ... ' + groundOf.size + ' across ' + byGround.size + ' classes');
ok(byGround.size >= 5, 'only ' + byGround.size + ' ground owners — the join failed');
// ⚠ CLOSED IN BOTH DIRECTIONS: every block that reaches the delegating owner must have a ground
// owner, because the delegating owner declares the method itself and therefore always matches.
{
  const under = [...ownerOf].filter(([, o]) => o === GROUND_OWNER).map(([n]) => n);
  const missing = under.filter((n) => !groundOf.has(n));
  ok(missing.length === 0,
     missing.length + ' blocks under ' + GROUND_OWNER + ' have no ground owner: ' + missing.slice(0, 6).join(' '));
}

// ── 8. WHAT EACH RULE NAMES: the blocks and tags its class actually references ───────────────
// ⚠⚠ **TWENTY-SEVEN RULES TYPED BY HAND ARE TWENTY-SEVEN CHANCES TO TYPE THE WRONG BLOCK**
// (D-349). `src/07_world.js` implements each owner's rule in JavaScript, and every one of them
// names blocks and tags — soul_sand, farmland, magma_block, #nylium, #bamboo_plantable_on. A
// wrong name there is a rule that silently never fires (D-305's note beside `resolveIds`: a
// missing name resolves to -1 and matches nothing), which is the failure mode that looks exactly
// like no bug at all.
// So the referee records, per owner class, EVERY `Blocks.x` and `BlockTags.x` its bytecode
// mentions, and `supportcheck` asserts that the names the engine's rule uses are a SUBSET of
// them. ⚠ It is the whole class, not one method body, because several rules delegate to private
// helpers (scaffolding's distance flood, sugar cane's water scan) and a body-only scan would
// report an empty set for a rule that names four blocks. A superset is a weaker claim than an
// exact one and it still catches every wrong name; claiming exactness here would be false.
const refsOf = new Map();
{
  const reBlk = new RegExp('// Field ' + BLOCKS + '\\.(\\w+):L' + BLOCKTYPE + ';');
  // ⚠⚠ **THE TAG HOLDER IS FOUND BY THE CALL, NOT BY COUNTING FIELDS.** The first draft of this
  // took "the class with 60-400 static finals of one type" and picked a class of 155 STRING
  // constants — a plausible-looking answer that produced ZERO tag rows, which is the quiet kind
  // of wrong. The right question is the one the bytecode asks out loud: a tag test is a
  // `getstatic` of some type T immediately followed by `BlockState.is(T)`. The class those
  // getstatics name IS BlockTags, and the type they carry IS TagKey, and neither is guessed.
  let TAGCLS = null, TAGTYPE = null;
  {
    const holders = new Map();
    const reGet = /getstatic\s+#\d+\s+\/\/ Field ([\w$]+)\.(\w+):L([\w$]+);/;
    const reIs = new RegExp('invoke\\w+\\s+#\\d+\\s+// Method ' + STATE + '\\.\\w+:\\(L([\\w$]+);\\)Z');
    for (const c of new Set([...best.owners, ...groundOwners])) {
      let dump;
      try {
        dump = execFileSync('javap', ['-p', '-c', '-cp', work, c],
          { maxBuffer: 1 << 25, stdio: ['ignore', 'pipe', 'ignore'] }).toString().split('\n');
      } catch { continue; }
      let last = null;
      for (const l of dump) {
        const g = reGet.exec(l); if (g) { last = g; continue; }
        const i = reIs.exec(l);
        // ⚠ THE TYPES MUST MATCH. `is(Block)` has the identical call shape and its getstatic is
        // the Blocks class; without this test the winner would be Blocks, by a mile.
        if (i && last && last[3] === i[1] && last[1] !== BLOCKS) {
          const k = last[1] + '|' + last[3];
          holders.set(k, (holders.get(k) || 0) + 1);
        }
      }
    }
    const rank = [...holders].sort((a, b) => b[1] - a[1]);
    say(' tag holders named by is(tag) . ' + rank.slice(0, 3).map(([k, n]) => k.replace('|', ':') + ' x' + n).join('  '));
    ok(rank.length > 0, 'no owner class asks a tag question — the is(TagKey) call shape was not found');
    if (rank.length) { TAGCLS = rank[0][0].split('|')[0]; TAGTYPE = rank[0][0].split('|')[1]; }
  }
  say(' BlockTags class ............. ' + TAGCLS + ' carrying ' + TAGTYPE);
  ok(!!TAGCLS, 'BlockTags was not found');
  const tagName = new Map();
  if (TAGCLS) {
    const code = execFileSync('javap', ['-p', '-c', '-cp', work, TAGCLS],
      { maxBuffer: 1 << 25, stdio: ['ignore', 'pipe', 'ignore'] }).toString().split('\n');
    let pend = null;
    const reStr = new RegExp('ldc(?:_w)?\\s+#\\d+\\s+// String ([a-z_0-9/]+)$');
    const rePut = new RegExp('putstatic\\s+#\\d+\\s+// Field (\\w+):L' + TAGTYPE + ';');
    for (const l of code) {
      const m = reStr.exec(l); if (m) { pend = m[1]; continue; }
      const q = rePut.exec(l); if (q && pend) { tagName.set(q[1], pend); pend = null; }
    }
    ok(tagName.size >= 60, 'only ' + tagName.size + ' tag names read out of ' + TAGCLS);
  }
  const reTag = TAGCLS ? new RegExp('// Field ' + TAGCLS + '\\.(\\w+):L' + TAGTYPE + ';') : null;
  for (const c of new Set([...best.owners, ...groundOwners])) {
    let dump;
    try {
      dump = execFileSync('javap', ['-p', '-c', '-cp', work, c],
        { maxBuffer: 1 << 25, stdio: ['ignore', 'pipe', 'ignore'] }).toString().split('\n');
    } catch { continue; }
    const blocks = new Set(), tags = new Set();
    for (const l of dump) {
      const b = reBlk.exec(l); if (b && fieldToName.has(b[1])) blocks.add(fieldToName.get(b[1]));
      if (reTag) { const t = reTag.exec(l); if (t && tagName.has(t[1])) tags.add(tagName.get(t[1])); }
    }
    if (blocks.size || tags.size) refsOf.set(c, { blocks: [...blocks].sort(), tags: [...tags].sort() });
  }
  say(' owner classes naming a block or tag .. ' + refsOf.size);
  ok(refsOf.size >= 15, 'only ' + refsOf.size + ' owner classes reference a block or a tag');
  // ⚠ ANCHORED, BOTH WAYS, ON TWO RULES WHOSE NAMES ARE ALREADY KNOWN: nether wart names soul
  // sand and nothing else, and the dead bush names sand and the terracottas. If the scan were
  // reading the wrong constant pool these two would not come out right.
  const wart = refsOf.get(groundOf.get('nether_wart'));
  ok(!!wart && wart.blocks.includes('soul_sand'),
     'the nether wart rule does not name soul_sand — the reference scan is reading the wrong fields');
  const bush = refsOf.get(groundOf.get('dead_bush'));
  ok(!!bush && bush.blocks.includes('red_sand') && bush.blocks.filter((n) => /terracotta/.test(n)).length >= 16,
     'the dead bush rule does not name red_sand and sixteen terracottas');
  // ⚠ AND THE TAG SIDE ANCHORED THE SAME WAY, because the two scans can fail independently and
  // a silent zero is what the first draft of this produced. The bush family's own ground rule
  // names exactly one tag and everyone knows which: dirt.
  const base = refsOf.get(GROUND_OWNER);
  ok(!!base && base.tags.includes('dirt'),
     'the base ground rule does not name the dirt tag — the tag scan read nothing');
  ok([...refsOf.values()].filter((r) => r.tags.length).length >= 8,
     'only ' + [...refsOf.values()].filter((r) => r.tags.length).length + ' owner classes name a tag');
}

// ── the table ────────────────────────────────────────────────────────────────────────────────
const rows = [];
rows.push('# cansurvive-1.18.2.tsv — which blocks have a canSurvive override, and whose.');
rows.push('# Written by tools/extract-support.mjs from the 1.18.2 client bytecode (D-346).');
rows.push('# canSurvive = ' + BASE + '.' + CAN + '(' + SIG + ')Z, ' + best.owners.length + ' overriders.');
rows.push('# support types: the rect a face must COVER, in sixteenths. FULL is the whole face.');
rows.push('# ground rows: the SECOND level — which blocks share a mayPlaceOn override, and whose.');
rows.push(['kind', 'a', 'b', 'c'].join('\t'));
rows.push(['method', BASE, CAN, SIG].join('\t'));
for (const t of types) rows.push(['supporttype', t.name, t.box ? t.box.join(',') : '', t.subtracts ? 'subtract' : 'intersect'].join('\t'));
for (const [n, c] of [...shapeBlocks].sort()) rows.push(['supportshape', n, c, ''].join('\t'));
rows.push(['groundmethod', GROUND_OWNER, GROUND, [STATE, GETTER, POS].join(',')].join('\t'));
for (const [g, ns] of [...byGround].sort((a, b) => b[1].length - a[1].length)) {
  rows.push(['ground', g, String(ns.length), ns.sort().join(' ')].join('\t'));
}
for (const [c, r] of [...refsOf].sort()) {
  if (r.blocks.length) rows.push(['refblocks', c, String(r.blocks.length), r.blocks.join(' ')].join('\t'));
  if (r.tags.length) rows.push(['reftags', c, String(r.tags.length), r.tags.join(' ')].join('\t'));
}
for (const [o, ns] of [...byOwner].sort((a, b) => b[1].length - a[1].length)) {
  rows.push(['owner', o, String(ns.length), ns.sort().join(' ')].join('\t'));
}
mkdirSync(join(MCLITE_ROOT, 'tools', 'golden'), { recursive: true });
writeFileSync(OUT, rows.join('\n') + '\n');

say('');
say(' ' + ownerOf.size + ' blocks with a survival rule, ' + byOwner.size + ' rule owners, ' +
    types.length + ' support types -> ' + OUT.replace(MCLITE_ROOT, ''));
if (failures) { say('\nextract-support: ' + failures + ' assertion(s) FAILED'); process.exit(1); }
say('extract-support: OK');
