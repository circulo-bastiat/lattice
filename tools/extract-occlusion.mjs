#!/usr/bin/env node
// extract-occlusion.mjs — PLAN W8c (D-350). `canOcclude`, PER BLOCK, OUT OF THE BYTECODE.
//
//   node tools/extract-occlusion.mjs   -> tools/golden/canocclude-1.18.2.tsv
//
// ⚠⚠ **WHY THIS EXISTS, AND WHY THE TABLE THIS ENGINE ALREADY HAD WOULD NOT DO.** Vanilla's
// mushroom rule ends in `isSolidRender`, which is `canOcclude() && the occlusion shape is a full
// cube`. MC-Lite has a per-block `transparent` flag, and it comes from the third-party
// minecraft-data dataset, not from the jar. Substituting it would be a PROXY ONE INFERENCE AWAY
// from the thing that matters — the failure this project has already named twice (D-291, D-331)
// — so the mushroom rule was left OWED rather than approximated, and this closes it properly.
//
// ── THE TRAIL, ANCHORED ON THE ONE RULE THAT NEEDS IT (D-263) ────────────────────────────────
// Nothing here is identified by name, and nothing is identified by counting fields — the first
// draft of the reference scan in `extract-support.mjs` picked a class of 155 STRING constants by
// counting and produced zero rows, which is the quiet kind of wrong. Every step below follows a
// CALL:
//   1. the mushroom's own ground rule (from `cansurvive-1.18.2.tsv`, which this engine already
//      trusts) calls one method on the state — that IS `isSolidRender`.
//   2. its body calls one no-argument boolean method on the state — that IS `canOcclude`.
//   3. that accessor's whole body is `return this.<field>` — one field on the state base.
//   4. the state base's constructor copies that field from ONE field of the Properties object —
//      which is how the Properties class and the canOcclude field are both identified.
//   5. the Properties methods that write that field with a zero are the setters. There are two:
//      one that also zeroes a second field (vanilla's `noCollission`, which turns occlusion off
//      as a side effect) and one that zeroes only this one (`noOcclusion`).
// Then every block's registration window in `Blocks.<clinit>` is scanned for a call to either.
//
// ⚠ AND THE FIFTY-EIGHT BLOCKS BUILT BY A HELPER ARE FOLLOWED, NOT DROPPED. Logs, leaves and the
// rest never mention Properties in their own window: the chain is inside a static helper on the
// Blocks class. A scan that stopped at the window would report `oak_leaves` as occluding, which
// is wrong, and would be wrong SILENTLY. One hop into the helper fixes it, and `oak_leaves` is
// one of the asserted anchors precisely because it is the case that needs the hop.
//
// ⚠ CLOSED IN BOTH DIRECTIONS: every one of the ~900 blocks gets an answer, the answer is
// asserted against six anchors chosen because their values are not in doubt, and the split is
// asserted to be a believable one rather than "everything true" or "everything false".

import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { requireJar } from './paths.mjs';

const MCLITE_ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT = join(MCLITE_ROOT, 'tools', 'golden', 'canocclude-1.18.2.tsv');
const say = (...a) => console.log(...a);
let failures = 0;
const ok = (c, m) => { if (!c) { failures++; say('   x ' + m); } return c; };

say('extract-occlusion — canOcclude per block, out of the 1.18.2 bytecode');

// ⚠ SAME CONTRACT AS EVERY OTHER EXTRACTOR: a machine with no JDK keeps the committed TSV.
if (process.argv.includes('--if-missing') && existsSync(OUT)) {
  say(' canocclude-1.18.2.tsv is present — nothing to do (--if-missing)');
  process.exit(0);
}

const jar = requireJar('1.18.2');
const work = mkdtempSync(join(tmpdir(), 'mclite-occ-'));
execFileSync('unzip', ['-qo', jar, '*.class', '-x', 'net/*', 'com/*', 'org/*', 'it/*', 'io/*',
                       'javax/*', 'assets/*', 'data/*', '-d', work], { stdio: 'ignore' });

const dump = (cls) => execFileSync('javap', ['-p', '-c', '-cp', work, cls],
  { maxBuffer: 1 << 27, stdio: ['ignore', 'pipe', 'ignore'] }).toString().split('\n');

/** the body of one method, from its declaration line to the blank line that ends it */
function body(lines, headRe) {
  const out = [];
  let inside = false;
  for (const l of lines) {
    if (!inside) { if (headRe.test(l)) inside = true; continue; }
    if (/^\s*$/.test(l)) break;
    out.push(l);
  }
  return out;
}

// ── 1. the mushroom's ground rule, from the table this engine already trusts ─────────────────
const rows = readFileSync(join(MCLITE_ROOT, 'tools', 'golden', 'cansurvive-1.18.2.tsv'), 'utf8')
  .split('\n').filter((l) => l && l[0] !== '#');
let GROUND_METHOD = null, STATE = null, GETTER = null, POS = null, MUSH = null, BLOCKS = null;
for (const l of rows) {
  const f = l.split('\t');
  if (f[0] === 'groundmethod') { GROUND_METHOD = f[2]; const a = f[3].split(','); STATE = a[0]; GETTER = a[1]; POS = a[2]; }
  if (f[0] === 'ground' && (f[3] || '').split(' ').includes('brown_mushroom')) MUSH = f[1];
}
say(' mushroom ground owner ....... ' + MUSH + '.' + GROUND_METHOD + '(' + [STATE, GETTER, POS].join(',') + ')Z');
ok(!!MUSH && !!STATE, 'the cansurvive table has no ground row for brown_mushroom — run extract-support first');
if (!MUSH) { say('extract-occlusion: FAILED'); process.exit(1); }

// ── 2. isSolidRender: the one state method the mushroom's ground rule calls ──────────────────
const mushBody = body(dump(MUSH), new RegExp('\\bboolean ' + GROUND_METHOD + '\\(' + [STATE, GETTER, POS].join(', ') + '\\);'));
const solidRender = (() => {
  for (const l of mushBody) {
    const m = new RegExp('Method ' + STATE + '\\.(\\w+):\\(L' + GETTER + ';L' + POS + ';\\)Z').exec(l);
    if (m) return m[1];
  }
  return null;
})();
say(' isSolidRender ............... ' + STATE + '.' + solidRender + '(' + GETTER + ',' + POS + ')Z');
ok(!!solidRender, 'the mushroom ground rule calls no (getter, pos) boolean on the state');

// ── 3. canOcclude: the no-argument boolean the render test asks first ────────────────────────
// ⚠ THE ACCESSOR IS DECLARED ON THE STATE'S SUPERCLASS, not on the state — the same trap
// `extract-support.mjs` §6 hit. Walk the chain.
const CLS = /^(?:public |final |abstract |static |protected |private )*(?:class|interface|enum)\s+([\w$]+)(?:<[^>]*>)?(?:\s+extends\s+([\w$.]+))?/;
const superOf = {};
{
  const all = execFileSync('javap', ['-p', '-cp', work,
    ...execFileSync('bash', ['-c', 'cd ' + work + ' && ls *.class | sed "s/\\.class$//"'],
      { maxBuffer: 1 << 26 }).toString().trim().split('\n')],
    { maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'ignore'] }).toString().split('\n');
  for (const l of all) {
    if (l && !/^\s/.test(l)) { const m = CLS.exec(l.trim()); if (m) superOf[m[1]] = m[2] || null; }
  }
}
const chain = (c) => { const o = []; let x = c; for (let i = 0; i < 25 && x; i++) { o.push(x); x = superOf[x]; } return o; };
let renderBody = [], RENDER_OWNER = null;
for (const k of chain(STATE)) {
  const d = dump(k);
  const b = body(d, new RegExp('\\bboolean ' + solidRender + '\\(' + GETTER + ', ' + POS + '\\);'));
  if (b.length) { renderBody = b; RENDER_OWNER = k; break; }
}
ok(renderBody.length > 0, 'no class in the state chain declares isSolidRender');
const occAcc = (() => {
  for (const l of renderBody) {
    const m = new RegExp('Method ' + STATE + '\\.(\\w+):\\(\\)Z').exec(l);
    if (m) return m[1];
  }
  return null;
})();
say(' canOcclude accessor ......... ' + STATE + '.' + occAcc + '()Z   (declared on ' + RENDER_OWNER + ')');
ok(!!occAcc, 'isSolidRender calls no no-argument boolean on the state — the trail broke');

// ── 4. the field it returns, and the Properties field the constructor copies into it ─────────
let OCC_FIELD = null, OCC_OWNER = null;
for (const k of chain(STATE)) {
  const b = body(dump(k), new RegExp('\\bboolean ' + occAcc + '\\(\\);'));
  if (!b.length) continue;
  for (const l of b) {
    const m = /getfield\s+#\d+\s+\/\/ Field (\w+):Z/.exec(l);
    if (m) { OCC_FIELD = m[1]; OCC_OWNER = k; break; }
  }
  if (OCC_FIELD) break;
}
say(' canOcclude field ............ ' + OCC_OWNER + '.' + OCC_FIELD + ':Z');
ok(!!OCC_FIELD, 'the canOcclude accessor does not return a plain field — the trail broke');

let PROPS = null, PROP_FIELD = null;
{
  const d = dump(OCC_OWNER);
  // ⚠ THE PAIR MUST BE ADJACENT: `getfield <Props>.<g>` then `putfield <this>.<OCC_FIELD>`.
  // Scanning for either alone finds a dozen booleans copied in the same constructor.
  let last = null;
  for (const l of d) {
    const g = /getfield\s+#\d+\s+\/\/ Field ([\w$]+)\.(\w+):Z/.exec(l);
    if (g) { last = g; continue; }
    const p = new RegExp('putfield\\s+#\\d+\\s+// Field ' + OCC_FIELD + ':Z').exec(l);
    if (p && last) { PROPS = last[1]; PROP_FIELD = last[2]; break; }
    if (/putfield|invoke/.test(l)) last = null;
  }
}
say(' Properties class ............ ' + PROPS + ', canOcclude field ' + PROP_FIELD);
ok(!!PROPS, 'nothing copies a Properties boolean into the canOcclude field');

// ── 5. the Properties methods that turn it off ───────────────────────────────────────────────
const SETTERS = [];
{
  const d = dump(PROPS);
  let cur = null, sawZero = false, wrote = false;
  const head = new RegExp('^\\s+public ' + PROPS.replace('$', '\\$') + ' (\\w+)\\(\\);');
  for (const l of d) {
    const h = head.exec(l);
    if (h) { if (cur && wrote) SETTERS.push(cur); cur = h[1]; sawZero = false; wrote = false; continue; }
    if (!cur) continue;
    if (/\biconst_0\b/.test(l)) sawZero = true;
    const p = new RegExp('putfield\\s+#\\d+\\s+// Field ' + PROP_FIELD + ':Z').exec(l);
    if (p && sawZero) wrote = true;
    if (/^\s*$/.test(l) && cur) { if (wrote) SETTERS.push(cur); cur = null; wrote = false; }
  }
  if (cur && wrote) SETTERS.push(cur);
}
say(' methods that clear it ....... ' + SETTERS.map((m) => PROPS + '.' + m + '()').join('  '));
ok(SETTERS.length >= 1 && SETTERS.length <= 3,
   SETTERS.length + ' methods clear the canOcclude field — expected one or two');

// ── 6. the Blocks class, its <clinit> windows, and one hop into the helpers ──────────────────
{
  const fieldsOf = {};
  const statF = /^\s+(?:public |private |protected |)?static final ([\w$.]+(?:<[^>]*>)?)\s+([\w$]+);/;
  const all = execFileSync('javap', ['-p', '-cp', work,
    ...execFileSync('bash', ['-c', 'cd ' + work + ' && ls *.class | sed "s/\\.class$//"'],
      { maxBuffer: 1 << 26 }).toString().trim().split('\n')],
    { maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'ignore'] }).toString().split('\n');
  let cur = null;
  for (const l of all) {
    if (l && !/^\s/.test(l)) { const m = CLS.exec(l.trim()); if (m) cur = m[1]; continue; }
    if (!cur) continue;
    const f = statF.exec(l);
    if (f) (fieldsOf[cur] = fieldsOf[cur] || []).push([f[1].replace(/<.*/, ''), f[2]]);
  }
  let BLOCKTYPE = null, N = 0;
  for (const [c, fs] of Object.entries(fieldsOf)) {
    const count = new Map();
    for (const [t] of fs) count.set(t, (count.get(t) || 0) + 1);
    for (const [t, n] of count) if (n >= 850 && n <= 1100 && n > N) { BLOCKS = c; BLOCKTYPE = t; N = n; }
  }
  say(' Blocks class ................ ' + BLOCKS + ' with ' + N + ' static finals of ' + BLOCKTYPE);
  ok(!!BLOCKS, 'Blocks was not found');

  const code = dump(BLOCKS);
  // split the <clinit> into per-block windows, exactly as extract-support does
  const windows = new Map();
  {
    let name = null, buf = [];
    const reName = new RegExp('ldc(?:_w)?\\s+#\\d+\\s+// String ([a-z_0-9]+)$');
    const rePut = new RegExp('putstatic\\s+#\\d+\\s+// Field (\\w+):L' + BLOCKTYPE + ';');
    for (const l of code) {
      const n = reName.exec(l);
      if (n) { name = n[1]; buf = []; continue; }
      if (name === null) continue;
      buf.push(l);
      if (rePut.test(l)) { windows.set(name, buf); name = null; buf = []; }
    }
  }
  say(' registration windows ........ ' + windows.size);
  ok(windows.size >= 850, 'only ' + windows.size + ' windows parsed out of the Blocks clinit');

  // the helpers: static methods on Blocks that RETURN a block, cached as we meet them
  // ⚠⚠ **A HELPER IS A NAME *AND* A DESCRIPTOR.** The first draft looked up the helper by name
  // alone and `oak_leaves` came out occluding — because `Blocks` has a dozen static methods
  // called `a`, and the first one javap prints is the two-argument REGISTER method, whose body
  // mentions no Properties at all. That is the anchor earning its place: the miss was silent and
  // the number it produced (317 non-occluding blocks) looked perfectly reasonable.
  const helperCache = new Map();
  /** "(Lckg;)Lcho;" -> "ckg", the way javap spells the parameter list in a declaration */
  const argsOf = (desc) => {
    const inner = /\(([^)]*)\)/.exec(desc);
    if (!inner) return null;
    const out = [];
    const re = /L([\w$/]+);|\[+|([BCDFIJSZ])/g;
    let m;
    while ((m = re.exec(inner[1]))) {
      if (m[1]) out.push(m[1].replace(/\//g, '.'));
      else if (m[2]) out.push({ B: 'byte', C: 'char', D: 'double', F: 'float', I: 'int',
                                J: 'long', S: 'short', Z: 'boolean' }[m[2]]);
    }
    return out.join(', ');
  };
  const helperClears = (m, desc) => {
    const key = m + desc;
    if (helperCache.has(key)) return helperCache.get(key);
    const args = argsOf(desc);
    let clears = false;
    if (args !== null) {
      const head = new RegExp('^\\s+(?:private |public |protected |)static [\\w$.<>]+ ' +
                              m.replace('$', '\\$') + '\\(' +
                              args.replace(/[.$]/g, (c) => '\\' + c) + '\\);');
      const b = body(code, head);
      for (const l of b) {
        for (const setter of SETTERS) {
          if (new RegExp('Method ' + PROPS.replace('$', '\\$') + '\\.' + setter + ':\\(\\)L').test(l)) clears = true;
        }
        // ⚠ AND HELPERS CALL HELPERS: a leaf helper may itself delegate. One more hop, bounded.
        const h2 = /invokestatic\s+#\d+\s+\/\/ Method ([\w$]+):(\([^)]*\)[\w$;/[]+)/.exec(l);
        if (h2 && (h2[1] + h2[2]) !== key && helperCache.size < 200) {
          if (helperClears(h2[1], h2[2])) clears = true;
        }
      }
    }
    helperCache.set(key, clears);
    return clears;
  };

  const reSetter = new RegExp('Method ' + PROPS.replace('$', '\\$') +
                              '\\.(' + SETTERS.join('|') + '):\\(\\)L');
  const reHelper = /invokestatic\s+#\d+\s+\/\/ Method ([\w$]+):(\([^)]*\)[\w$;/[]+)/;
  const reCopyFrom = new RegExp('getstatic\\s+#\\d+\\s+// Field (\\w+):L' + BLOCKTYPE + ';');
  const rePutName = new RegExp('putstatic\\s+#\\d+\\s+// Field (\\w+):L' + BLOCKTYPE + ';');
  const fieldToName = new Map();
  const occludes = new Map(), copiesFrom = new Map();
  let viaHelper = 0;
  for (const [name, win] of windows) {
    let clear = false, helperUsed = false, copy = null;
    for (const l of win) {
      const p = rePutName.exec(l); if (p) fieldToName.set(p[1], name);
      if (reSetter.test(l)) clear = true;
      const g = reCopyFrom.exec(l); if (g) copy = g[1];
      const h = reHelper.exec(l);
      if (h && !/^(java|com|net)/.test(h[1])) {
        helperUsed = true;
        if (helperClears(h[1], h[2])) clear = true;
      }
    }
    if (helperUsed && !win.some((l) => new RegExp(PROPS.replace('$', '\\$')).test(l))) viaHelper++;
    occludes.set(name, !clear);
    if (copy) copiesFrom.set(name, copy);
  }
  // `copy(Block)` inherits the flag: resolve to a fixed point.
  for (let pass = 0; pass < 4; pass++) {
    for (const [n, f] of copiesFrom) {
      const src = fieldToName.get(f);
      if (src && occludes.has(src) && !occludes.get(src)) occludes.set(n, false);
    }
  }
  const off = [...occludes.values()].filter((v) => !v).length;
  say(' blocks built by a helper .... ' + viaHelper + ' (followed one hop, not dropped)');
  say(' canOcclude = false .......... ' + off + ' of ' + occludes.size);
  ok(off > 60 && off < occludes.size / 2, off + ' blocks do not occlude — that is not a believable split');

  // ⚠ SIX ANCHORS, chosen because their values are not in doubt, and BOTH ways round.
  // `oak_leaves` is here because it is the case the helper hop exists for: its Properties chain
  // is not in its own window at all, and a scan that stopped there would call it occluding.
  for (const [n, want] of [['glass', false], ['ice', false], ['barrier', false],
                           ['oak_leaves', false], ['stone', true], ['oak_slab', true],
                           ['dirt', true], ['oak_fence', true]]) {
    ok(occludes.get(n) === want,
       n + ' came out canOcclude=' + occludes.get(n) + ', and it is ' + want);
  }

  // ── 7. AND WHETHER THE OUTLINE SHAPE IS STILL VANILLA'S FULL BLOCK ────────────────────────
  // ⚠⚠ **`isSolidRender` ASKS ABOUT THE OUTLINE SHAPE, NOT THE COLLISION SHAPE, AND SOUL SAND IS
  // THE BLOCK THAT TELLS THEM APART** — the same block that overturned a reading in D-346.
  // SoulSandBlock overrides the COLLISION shape (14/16 tall, you sink into it) and leaves the
  // outline alone, so vanilla's outline is a full cube and a mushroom grows on soul sand in the
  // dark. This engine ships COLLISION boxes — measured: soul_sand is 0..896, farmland 0..960 —
  // so a full-cube test over them refuses soul sand, which is refusing a LEGAL build, the
  // expensive half (D-346).
  // ⚠ IDENTIFIED BY USE, AND THE USE IS THE DEFAULT BODY. Among the Block methods returning a
  // VoxelShape from (state, getter, pos, context), exactly one has a body of "load the full-block
  // constant and return it" — that is `getShape`. Its neighbour reads a `hasCollision` field and
  // branches, which is `getCollisionShape`, and a third forwards to that one. So a block's
  // outline is vanilla's full cube exactly when NO class in its chain overrides the first.
  let OUTLINE = null, outlineOwners = new Set();
  {
    const d = dump(BLOCKS ? 'cou' : 'cou');
    void d;
    const base = chain(STATE).find((c) => superOf[STATE] === c) || superOf[STATE];
    void base;
  }
  {
    // the declaring class of the shape methods is the same base `canSurvive` was declared on:
    // walk the state's chain and take the first class that declares a 4-argument shape method.
    const SHAPE_RE = /^\s+public ([\w$]+) ([\w$]+)\(([\w$]+), ([\w$]+), ([\w$]+), ([\w$]+)\);/;
    let owner = null, cands = [];
    for (const k of chain(STATE).concat(['cou'])) {
      const d = dump(k);
      const found = [];
      for (const l of d) {
        const m = SHAPE_RE.exec(l);
        if (m && m[3] === STATE && m[4] === GETTER && m[5] === POS) found.push([m[1], m[2], m[6]]);
      }
      if (found.length >= 2) { owner = k; cands = found; break; }
    }
    ok(!!owner, 'no class declares two or more four-argument shape methods — getShape not found');
    if (owner) {
      const d = dump(owner);
      for (const [ret, name, ctx] of cands) {
        const b = body(d, new RegExp('public ' + ret + ' ' + name +
                                     '\\(' + [STATE, GETTER, POS, ctx].join(', ') + '\\);'));
        const ops = b.filter((l) => /^\s+\d+:/.test(l));
        // "invokestatic <something>.<m>:()L<ret>;" then "areturn" — nothing else at all
        if (ops.length === 2 && /invokestatic.*:\(\)L/.test(ops[0]) && /areturn/.test(ops[1])) {
          OUTLINE = { name, ret, ctx, owner };
        }
      }
    }
    ok(!!OUTLINE, 'no four-argument shape method has the constant full block as its body');
    if (OUTLINE) {
      say(' outline getShape ............ ' + OUTLINE.owner + '.' + OUTLINE.name +
          '(' + [STATE, GETTER, POS, OUTLINE.ctx].join(',') + ')' + OUTLINE.ret);
      const head = new RegExp('^\\s+public ' + OUTLINE.ret + ' ' + OUTLINE.name +
                              '\\(' + [STATE, GETTER, POS, OUTLINE.ctx].join(', ') + '\\);');
      const names = execFileSync('bash', ['-c', 'cd ' + work + ' && ls *.class | sed "s/\\.class$//"'],
        { maxBuffer: 1 << 26 }).toString().trim().split('\n');
      const all = execFileSync('javap', ['-p', '-cp', work, ...names],
        { maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'ignore'] }).toString().split('\n');
      let cur = null;
      for (const l of all) {
        if (l && !/^\s/.test(l)) { const m = CLS.exec(l.trim()); if (m) cur = m[1]; continue; }
        if (cur && cur !== OUTLINE.owner && head.test(l)) outlineOwners.add(cur);
      }
      say(' classes overriding it ....... ' + outlineOwners.size);
      ok(outlineOwners.size > 50 && outlineOwners.size < 500,
         outlineOwners.size + ' classes override the outline shape — that is not a believable count');
    }
  }
  // per block: its outline is the DEFAULT full cube when no class in its chain overrides it
  const nameToCls = new Map();
  {
    const reNew = /new\s+#\d+\s+\/\/ class ([\w$/]+)/;
    // ⚠⚠ **AND THE HELPER IS FOLLOWED FOR THE CLASS TOO, NOT ONLY FOR THE PROPERTIES.** The first
    // draft read the class from a `new` in the block's own window and left 75 blocks unknown,
    // and `supportcheck` immediately found that the unknown-fallback was DECIDING something for
    // four of them — the two pistons and the two item frames, whose collision shape is partial
    // and whose outline is not. An approximation that decides nothing is acceptable and must be
    // proved; one that decides something is a bug wearing a caveat.
    const clsCache = new Map();
    const helperClass = (m, desc, depth) => {
      const key = m + desc;
      if (clsCache.has(key)) return clsCache.get(key);
      if (depth > 3) return null;
      clsCache.set(key, null);                     // guard against a cycle
      const args = argsOf(desc);
      let found = null;
      if (args !== null) {
        const head = new RegExp('^\\s+(?:private |public |protected |)static [\\w$.<>]+ ' +
                                m.replace('$', '\\$') + '\\(' +
                                args.replace(/[.$]/g, (c) => '\\' + c) + '\\);');
        for (const l of body(code, head)) {
          const w = reNew.exec(l);
          if (w) { found = w[1]; break; }
          const h2 = /invokestatic\s+#\d+\s+\/\/ Method ([\w$]+):(\([^)]*\)[\w$;/[]+)/.exec(l);
          if (h2 && !/^(java|com|net)/.test(h2[1])) {
            const c2 = helperClass(h2[1], h2[2], depth + 1);
            if (c2) { found = c2; break; }
          }
        }
      }
      clsCache.set(key, found);
      return found;
    };
    const reH = /invokestatic\s+#\d+\s+\/\/ Method ([\w$]+):(\([^)]*\)[\w$;/[]+)/;
    for (const [name, win] of windows) {
      let cls = null;
      for (const l of win) { const w = reNew.exec(l); if (w) { cls = w[1]; break; } }
      if (!cls) {
        for (const l of win) {
          const h = reH.exec(l);
          if (h && !/^(java|com|net)/.test(h[1])) {
            const c = helperClass(h[1], h[2], 0);
            if (c) { cls = c; break; }
          }
        }
      }
      if (cls) nameToCls.set(name, cls);
    }
  }
  const outlineFull = new Map();
  for (const [name] of windows) {
    const c = nameToCls.get(name);
    let over = false;
    if (c) for (const k of chain(c)) { if (k === OUTLINE.owner) break; if (outlineOwners.has(k)) { over = true; break; } }
    // ⚠ A BLOCK BUILT BY A HELPER HAS NO `new` IN ITS WINDOW, so its class is unknown here. It is
    // marked UNKNOWN (-1) rather than guessed, and the runtime falls back to the collision shape
    // for those — the same answer this engine gave before, never a silent invention.
    outlineFull.set(name, c ? (over ? 0 : 1) : -1);
  }
  {
    const un = [...outlineFull.values()].filter((v) => v < 0).length;
    say(' outline is the default cube . ' + [...outlineFull.values()].filter((v) => v === 1).length +
        ' of ' + outlineFull.size + '   (' + un + ' unknown, class built by a helper)');
    // ⚠ ANCHORED ON THE PAIR THAT MADE THIS SECTION NECESSARY.
    ok(outlineFull.get('soul_sand') === 1,
       'soul_sand came out with a non-default outline — the whole point of this section is that it is default');
    ok(outlineFull.get('farmland') === 0, 'farmland does not override the outline shape, and it does');
    ok(outlineFull.get('oak_slab') === 0, 'a slab does not override the outline shape, and it does');
    ok(outlineFull.get('stone') === 1, 'stone overrides the outline shape, and it does not');
  }

  const out = [];
  out.push('# canocclude-1.18.2.tsv — vanilla canOcclude, per block (D-350).');
  out.push('# Written by tools/extract-occlusion.mjs from the 1.18.2 client bytecode.');
  out.push('# Trail: ' + MUSH + '.' + GROUND_METHOD + ' -> ' + STATE + '.' + solidRender +
           ' -> ' + STATE + '.' + occAcc + ' -> ' + OCC_OWNER + '.' + OCC_FIELD +
           ' <- ' + PROPS + '.' + PROP_FIELD);
  out.push('# Cleared by: ' + SETTERS.map((m) => PROPS + '.' + m + '()').join(' '));
  out.push('# ' + off + ' of ' + occludes.size + ' blocks do NOT occlude. ' + viaHelper +
           ' blocks are built by a helper and were followed one hop.');
  out.push('# outlineDefault: 1 = the block does NOT override getShape, so its outline is');
  out.push('#   vanilla full block. 0 = it does. -1 = built by a helper, class unknown.');
  out.push(['block', 'canOcclude', 'outlineDefault'].join('\t'));
  for (const [n, v] of [...occludes].sort()) {
    out.push([n, v ? 1 : 0, outlineFull.has(n) ? outlineFull.get(n) : -1].join('\t'));
  }
  mkdirSync(join(MCLITE_ROOT, 'tools', 'golden'), { recursive: true });
  writeFileSync(OUT, out.join('\n') + '\n');
  say('\n ' + occludes.size + ' blocks -> ' + OUT);
}

if (failures) { say('extract-occlusion: ' + failures + ' FAILED'); process.exit(1); }
say('extract-occlusion: OK');
