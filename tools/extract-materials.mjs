#!/usr/bin/env node
// extract-materials.mjs — vanilla's per-block `Material`, and therefore `canBeReplaced`,
// read out of the 1.18.2 client jar's BYTECODE.
//
//   node tools/extract-materials.mjs            -> tools/golden/block-materials-1.18.2.tsv
//
// ⚠ WHY THIS EXISTS. `Material.isReplaceable()` is the rule that decides whether a placed block
// overwrites what is already in the cell. It is compiled Java: in no JSON, in no `minecraft-data`
// file, and in no tag. Session 9 found `14_player.js` GUESSING it from geometry —
// `geom === MODEL && no collision && no light` — which marked 139 blocks and 2,590 real states
// replaceable against vanilla's 28 blocks. Fence gates, buttons, pressure plates, rails, levers,
// saplings, every flower, every coral, cobweb, sugar cane, sweet berry bush and every crop were
// all silently overwritable. That is D-263.
//
// ⚠ AND IT NEEDS NO MAPPINGS. Mojang's mapping host is outside this container's egress allowlist,
// so the obfuscated jar is read structurally instead — which is stronger, not weaker, because
// nothing here trusts a name:
//
//   1. `Material` is the only final class with 40-60 static finals of its own type. It is built
//      through a builder, so each constant is a chain of `Builder` calls ending in `build()`.
//   2. Which builder call is `replaceable()` is DERIVED, not assumed. AIR and STRUCTURAL_AIR are
//      the first two constants and are byte-identical; PORTAL is the third and differs from them
//      in exactly one call. That call is `notPushable()`; the one AIR has and PORTAL does not is
//      `replaceable()`. Section 4 then asserts the resulting set against the shape vanilla must
//      have: air and the fluids in, stone and wood out, in BOTH directions.
//   3. `Blocks` is the class with 850-1000 static finals of one Block type. Its `<clinit>` names
//      every block as a string literal in registry order, and the `Material` field read between
//      one name and the next is that block's material.
//   4. Blocks built through a helper (logs, leaves, beds, ores) are resolved by the helper's
//      DESCRIPTOR; blocks built with `Properties.copy(other)` inherit from the block they copy,
//      iterated to a fixed point. 898 of 898 resolve, 0 unresolved — that is the assertion.
//
// The same table carries every block's material, so G9's furnace burn times and G13's SoundType
// have a route that is not "hand-table it".

import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { requireJar } from './paths.mjs';

const MCLITE_ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT = join(MCLITE_ROOT, 'tools', 'golden', 'block-materials-1.18.2.tsv');

const say = (...a) => console.log(...a);
let failures = 0;
const ok = (c, m) => { if (!c) { failures++; say('   x ' + m); } };
const esc = (s) => s.replace(/[$]/g, '\\$');

// ⚠ `tools/golden/` IS GITIGNORED (D-6 — it is Mojang's compiled code), so this file is a
// required input that a fresh clone does not have, exactly like `physics-1.18.2.tsv`. The suite
// runs this stage with `--if-missing`, which is a no-op when the table is already there: four
// minutes of javap on every suite run would be four minutes of nothing.
if (process.argv.includes('--if-missing') && existsSync(OUT)) {
  say(' block-materials-1.18.2.tsv is present — nothing to do (--if-missing)');
  process.exit(0);
}

const JAR = requireJar('1.18.2');
try { execFileSync('javap', ['-version'], { stdio: 'ignore' }); }
catch { say('SKIP - no javap on this machine. Install a JDK, or keep the committed TSV.'); process.exit(0); }

const work = mkdtempSync(join(tmpdir(), 'mclite-mat-'));
try {
  execFileSync('unzip', ['-o', '-q', JAR, '-d', work]);

  // ------------------------------------------------------------ 1. find Material and Blocks
  const all = execFileSync('bash', ['-c',
    'cd ' + JSON.stringify(work) + " && find . -name '*.class' | sed 's|^\\./||; s|\\.class$||' | tr '/' '.'"],
    { maxBuffer: 1 << 28 }).toString().trim().split('\n');
  say(' classes ............ ' + all.length);

  const javap = (args, names) => {
    let out = '';
    for (let i = 0; i < names.length; i += 300) {
      out += execFileSync('javap', [...args, '-cp', work, ...names.slice(i, i + 300)],
        { maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'ignore'] }).toString();
    }
    return out.split('\n').filter((l) => !l.startsWith('Picked up'));
  };

  const sigs = javap(['-p'], all);
  let cur = null;
  const selfCount = new Map(), otherCount = new Map(), isFinalClass = new Set();
  for (const line of sigs) {
    const d = line.trim().match(/^(?:public |final |abstract |)*(?:class|interface|enum) ([\w.$]+)/);
    if (d && line.trimEnd().endsWith('{')) {
      cur = d[1];
      if (/final class /.test(line)) isFinalClass.add(cur);
      continue;
    }
    if (!cur) continue;
    const f = line.match(/static final ([\w.$[\]]+) /);
    if (!f) continue;
    if (f[1] === cur) selfCount.set(cur, (selfCount.get(cur) || 0) + 1);
    else {
      const k = cur + ' ' + f[1];
      otherCount.set(k, (otherCount.get(k) || 0) + 1);
    }
  }
  const blkCand = [...otherCount].filter(([, n]) => n >= 850 && n <= 1000).sort((a, b) => b[1] - a[1])[0];
  ok(!!blkCand, 'no Blocks candidate: no class with 850-1000 static finals of one Block type');
  const [BLOCKS, BLOCKTYPE] = blkCand ? blkCand[0].split(' ') : [null, null];
  say(' Blocks class ....... ' + BLOCKS + ' of ' + BLOCKTYPE + ' (' + (blkCand ? blkCand[1] : 0) + ' fields)');
  if (failures) { say('\n aborted - the jar did not look like 1.18.2'); process.exit(1); }

  // ⚠ MATERIAL IS PICKED BY USE, NOT BY SHAPE. Several classes in this jar are final with ~40-60
  // static finals of their own type (MaterialColor, SoundType, DyeColor…), and session 9's first
  // cut chose the wrong one by count alone. The Material class is the one `Blocks.<clinit>` reads
  // most: every block names one. So the candidate set is shape, and the choice is evidence.
  const blkCode0 = javap(['-c', '-p'], [BLOCKS]);
  const clinit0 = blkCode0.slice(blkCode0.findIndex((l) => l.trim().startsWith('static {}')));
  const useCount = new Map();
  for (const l of clinit0) {
    const g = l.match(/getstatic\s+#\d+\s+\/\/ Field ([\w.$]+)\.\w+:L([\w/$]+);/);
    if (g) useCount.set(g[1], (useCount.get(g[1]) || 0) + 1);
  }
  const matCand = [...selfCount]
    .filter(([c, n]) => n >= 40 && n <= 60 && isFinalClass.has(c) && useCount.has(c))
    .map(([c, n]) => [c, n, useCount.get(c)])
    .sort((a, b) => b[2] - a[2])[0];
  ok(!!matCand, 'no Material candidate: no final class with 40-60 own-type static finals that Blocks reads');
  const MAT = matCand ? matCand[0] : null;
  say(' Material class ..... ' + MAT + ' (' + (matCand ? matCand[1] : 0) + ' constants, read '
    + (matCand ? matCand[2] : 0) + 'x by Blocks)');
  if (failures) { say('\n aborted - the jar did not look like 1.18.2'); process.exit(1); }

  // ------------------------------------------------------------ 2. which builder call is replaceable()
  const matCode = javap(['-c', '-p'], [MAT]);
  const ci = matCode.findIndex((l) => l.trim().startsWith('static {}'));
  const chains = [];
  let calls = [];
  const reBuild = new RegExp('Method ' + esc(MAT) + '\\$a\\.(\\w+):\\(\\)L' + esc(MAT) + '\\$a;');
  const rePut = new RegExp('putstatic\\s+#\\d+\\s+// Field (\\w+):L' + esc(MAT) + ';');
  for (const l of matCode.slice(ci)) {
    if (l.indexOf('Method ' + MAT + '$a."<init>"') >= 0) { calls = []; continue; }
    const c = l.match(reBuild);
    if (c) { calls.push(c[1]); continue; }
    const p = l.match(rePut);
    if (p) { chains.push([p[1], calls]); calls = []; }
  }
  say(' materials .......... ' + chains.length);
  ok(chains.length >= 40, 'only ' + chains.length + ' materials decoded from <clinit>');
  const [A, B, C] = chains;
  ok(A && B && String(A[1]) === String(B[1]),
    'the first two materials are not identical (expected AIR and STRUCTURAL_AIR)');
  const onlyInAir = A[1].filter((x) => C[1].indexOf(x) < 0);
  ok(onlyInAir.length === 1, 'AIR and PORTAL differ by ' + onlyInAir.length + ' calls, expected exactly 1');
  const CALL = onlyInAir[0];
  const replMats = new Set(chains.filter((e) => e[1].indexOf(CALL) >= 0).map((e) => e[0]));
  say(' replaceable() ...... ' + MAT + '$a.' + CALL + '()  ->  ' + replMats.size + ' materials');

  // ------------------------------------------------------------ 3. block -> material
  const blkCode = blkCode0;
  const bi = blkCode.findIndex((l) => l.trim().startsWith('static {}'));
  const PRIM = { int: 'I', boolean: 'Z', float: 'F', double: 'D', long: 'J', void: 'V', char: 'C', byte: 'B', short: 'S' };
  const desc = (t) => {
    t = t.trim(); let a = 0;
    while (t.endsWith('[]')) { a++; t = t.slice(0, -2); }
    return '['.repeat(a) + (PRIM[t] || 'L' + t.replace(/\./g, '/') + ';');
  };
  const helperOf = new Map();
  {
    const bodies = new Map();
    let m = null;
    for (const l of blkCode) {
      const d = l.match(/^\s{2}(?:public |private |protected |static |final |abstract )*([\w.$[\]]+) (\w+)\((.*)\);\s*$/);
      if (d) {
        const sig = d[3].split(',').filter((x) => x.trim()).map(desc).join('');
        m = d[2] + ':(' + sig + ')' + desc(d[1]); bodies.set(m, []); continue;
      }
      if (l.trim().startsWith('static {}')) { m = null; continue; }
      if (m) bodies.get(m).push(l);
    }
    const reMatField = new RegExp('Field ' + esc(MAT) + '\\.(\\w+):L' + esc(MAT) + ';', 'g');
    for (const [k, body] of bodies) {
      const ms = new Set([...body.join('\n').matchAll(reMatField)].map((x) => x[1]));
      if (ms.size === 1) helperOf.set(k, [...ms][0]);
    }
  }
  const mats = new Map(), f2b = new Map(), reads = new Map();
  const reGetMat = new RegExp('getstatic\\s+#\\d+\\s+// Field ' + esc(MAT) + '\\.(\\w+):L' + esc(MAT) + ';');
  const rePutBlk = new RegExp('putstatic\\s+#\\d+\\s+// Field (\\w+):L' + esc(BLOCKTYPE) + ';');
  const reGetBlk = new RegExp('getstatic\\s+#\\d+\\s+// Field (\\w+):L' + esc(BLOCKTYPE) + ';');
  let name = null;
  for (const l of blkCode.slice(bi)) {
    const nm = l.trim().match(/ldc(?:_w)?\s+#\d+\s+\/\/ String ([a-z0-9_]+)$/);
    if (nm && /^[a-z][a-z0-9_]*$/.test(nm[1])) { name = nm[1]; if (!mats.has(name)) mats.set(name, null); continue; }
    if (!name) continue;
    const gm = l.match(reGetMat);
    if (gm && mats.get(name) === null) { mats.set(name, gm[1]); continue; }
    const ps = l.match(rePutBlk);
    if (ps) { f2b.set(ps[1], name); continue; }
    const gs = l.match(reGetBlk);
    if (gs) { if (!reads.has(name)) reads.set(name, []); reads.get(name).push(gs[1]); continue; }
    if (mats.get(name) === null) {
      const iv = l.match(/\/\/ Method (\w+:\([^)]*\)[\w/;[$]+)\s*$/);
      if (iv && helperOf.has(iv[1]) && iv[1].indexOf('a:(Ljava/lang/String;') !== 0) mats.set(name, helperOf.get(iv[1]));
    }
  }
  for (let pass = 0; pass < 8; pass++) {
    let changed = 0;
    for (const [b, v] of mats) {
      if (v !== null) continue;
      for (const f of reads.get(b) || []) {
        const base = f2b.get(f);
        if (base && mats.get(base)) { mats.set(b, mats.get(base)); changed++; break; }
      }
    }
    if (!changed) break;
  }
  const unresolved = [...mats].filter((e) => e[1] === null).map((e) => e[0]);
  say(' blocks ............. ' + mats.size + '  (unresolved ' + unresolved.length + ')');
  ok(unresolved.length === 0,
    unresolved.length + ' blocks have no material: ' + unresolved.slice(0, 8).join(', '));

  const repl = [...mats].filter((e) => replMats.has(e[1])).map((e) => e[0]).sort();
  say(' replaceable blocks . ' + repl.length);

  // ------------------------------------------------------------ 4. the shape the answer must have
  // ⚠ ANTI-VACUITY FOR THE DERIVATION ITSELF. A wrong builder call would still produce a set;
  // these are the blocks whose answer cannot be in doubt, in BOTH directions.
  const MUST = ['air', 'cave_air', 'void_air', 'water', 'lava', 'fire', 'soul_fire', 'snow',
    'grass', 'tall_grass', 'fern', 'large_fern', 'dead_bush', 'seagrass', 'tall_seagrass',
    'vine', 'glow_lichen', 'structure_void', 'light', 'bubble_column'];
  const MUST_NOT = ['stone', 'dirt', 'oak_planks', 'oak_log', 'oak_leaves', 'glass', 'chest',
    'oak_fence_gate', 'stone_button', 'rail', 'oak_sapling', 'poppy', 'cobweb',
    'wheat', 'sugar_cane', 'kelp', 'powder_snow', 'oak_slab', 'oak_stairs',
    'stone_pressure_plate', 'lever', 'redstone_wire', 'tube_coral', 'white_bed'];
  for (const b of MUST) ok(repl.indexOf(b) >= 0, b + ' must be replaceable and is not');
  for (const b of MUST_NOT) ok(repl.indexOf(b) < 0, b + ' must NOT be replaceable and is');

  if (failures) { say('\n x ' + failures + ' failures - NOT written'); process.exit(1); }

  // ── isSolid(), DERIVED THE SAME WAY AND ANCHORED ON COBWEB (D-346) ────────────────────────
  // ⚠ `Material.isSolid()` is what vanilla's banner, sign and candle-cake `canSurvive` read, and
  // nothing else in this project carries it. It is the ABSENCE of one builder call, so it is
  // derived by elimination: take the calls present in every material that is certainly not solid
  // — AIR, WATER, PLANT, DECORATION — and absent from every material that certainly is — STONE,
  // WOOD, GLASS. That leaves TWO, because `nonSolid()` and `noCollider()` travel together
  // everywhere except in one place.
  // ⚠⚠ **COBWEB IS THE ANCHOR THAT CANNOT BE IN DOUBT.** `Material.WEB` has NO COLLIDER — you
  // walk into a cobweb, you do not stand on it — and it is nonetheless SOLID. So of the two
  // candidates, the one cobweb's material does NOT have is `nonSolid()`. Without an anchor like
  // that the two are indistinguishable, and picking either at random is right half the time on a
  // table of 47 materials, which is the worst possible outcome: mostly correct.
  // ⚠ The materials are named by a BLOCK whose material is not in doubt, never by their
  // obfuscated field, for the same reason the support rules are (D-346).
  const matOfBlockName = (n) => mats.get(n);
  let SOLID_CALL = null;
  {
    const chainOf = new Map(chains);
    const notSolid = ['air', 'water', 'grass', 'torch'];      // AIR, WATER, REPLACEABLE_PLANT, DECORATION
    const isSolid = ['stone', 'oak_planks', 'glass'];         // STONE, WOOD, GLASS
    const anchor = 'cobweb';                                  // WEB: no collider, and still solid
    const have = (n) => chainOf.get(matOfBlockName(n)) || [];
    let cand = new Set(have(notSolid[0]));
    for (const n of notSolid.slice(1)) { const h = new Set(have(n)); cand = new Set([...cand].filter((x) => h.has(x))); }
    for (const n of isSolid) { const h = new Set(have(n)); cand = new Set([...cand].filter((x) => !h.has(x))); }
    ok(cand.size >= 1, 'no builder call separates the solid materials from the non-solid ones');
    const web = new Set(have(anchor));
    const narrowed = [...cand].filter((x) => !web.has(x));
    ok(narrowed.length === 1,
       'cobweb narrowed ' + cand.size + ' candidates to ' + narrowed.length + ', not 1 — ' +
       'the two calls no longer travel together and the anchor has stopped working');
    SOLID_CALL = narrowed[0];
    const nonSolidMats = new Set(chains.filter((e) => e[1].indexOf(SOLID_CALL) >= 0).map((e) => e[0]));
    say(' nonSolid() ......... ' + MAT + '$a.' + SOLID_CALL + '()  ->  ' + nonSolidMats.size +
        ' materials are NOT solid');
    // closed in both directions: the anchors must come out the way they went in
    for (const n of notSolid) ok(nonSolidMats.has(matOfBlockName(n)), n + ' came out SOLID and must not be');
    for (const n of isSolid) ok(!nonSolidMats.has(matOfBlockName(n)), n + ' came out non-solid and must not be');
    ok(!nonSolidMats.has(matOfBlockName(anchor)), 'cobweb came out non-solid — the anchor is inverted');
    var NONSOLID_MATS = nonSolidMats;
  }


  mkdirSync(dirname(OUT), { recursive: true });
  const lines = ['# block\tmaterial\treplaceable\tsolid',
    '# Generated by tools/extract-materials.mjs from ' + JAR,
    '# Material=' + MAT + '  Blocks=' + BLOCKS + '  replaceable()=' + MAT + '$a.' + CALL + '()' +
      (SOLID_CALL ? '  nonSolid()=' + MAT + '$a.' + SOLID_CALL + '()' : ''),
    '# ' + mats.size + ' blocks, ' + repl.length + ' replaceable, 0 unresolved.'];
  for (const b of [...mats.keys()].sort()) {
    const m = mats.get(b);
    lines.push(b + '\t' + m + '\t' + (replMats.has(m) ? 1 : 0) +
               '\t' + (NONSOLID_MATS && NONSOLID_MATS.has(m) ? 0 : 1));
  }
  writeFileSync(OUT, lines.join('\n') + '\n');
  say('\n wrote ' + OUT);
  say(' ' + mats.size + ' blocks - ' + repl.length + ' replaceable - 0 unresolved - ' + failures + ' failures');
} finally {
  rmSync(work, { recursive: true, force: true });
}
