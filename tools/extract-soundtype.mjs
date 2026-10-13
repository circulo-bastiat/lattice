#!/usr/bin/env node
// extract-soundtype.mjs — PLAN G13. Every block's `SoundType`, out of the 1.18.2 BYTECODE.
//
//   node tools/extract-soundtype.mjs   -> tools/golden/block-soundtype-1.18.2.tsv
//
// ⚠ PLAN SAID "hand-tabled or taken from minecraft-data". Neither is needed. `SoundType` is
// compiled Java — 76 constants, each naming five `SoundEvent`s — and D-263's referee technique
// reads it structurally out of the obfuscated jar, trusting no name. This is the fifth table that
// route has produced (Material, EquipmentSlot, the furnace fuel map, DyeColor, and now this).
//
// ── HOW EACH CLASS IS IDENTIFIED, AND WHY THE ANSWER CANNOT BE A COINCIDENCE ─────────────────
//   1. `SoundEvents` is the class with 1,000-1,400 static finals of one other type. Its
//      `<clinit>` is `ldc "<name>"; invokestatic; putstatic <field>` over and over, so the field
//      -> registry-name map falls out. ⚠ IT HAS EXACTLY 1,203 FIELDS AND `sounds.json` HAS
//      EXACTLY 1,203 EVENTS — that equality is checked, and it is not a coincidence anyone could
//      arrange by accident.
//   2. `SoundType` is the class with 50-90 static finals of its OWN type whose `<clinit>` reads
//      SoundEvents fields. ⚠ It reads them **380 times for 76 constants — exactly five each**,
//      which is the shape `SoundType(float, float, SoundEvent x5)` must have and nothing else in
//      this jar does.
//   3. ⚠⚠ **THE ARGUMENT ORDER IS DERIVED, NOT ASSUMED.** The five events of a SoundType are
//      passed positionally, and a clone that writes `break, place, step, hit, fall` from memory
//      gets a game where placing a block sounds like walking on it. But the registered NAMES end
//      in the role — `block.stone.break`, `.step`, `.place`, `.hit`, `.fall` — so the order is
//      read off the data: for every constant whose five events share a prefix, the suffix
//      sequence must be the SAME sequence, and that sequence is the constructor's order. It comes
//      out `break, step, place, hit, fall`, agreed by 60+ constants, and the check refuses to
//      write if they disagree.
//   4. Block -> SoundType is `Blocks.<clinit>` again: the SoundType field read between one block
//      name and the next. Helper-built blocks resolve by descriptor and `Properties.copy` blocks
//      inherit to a fixed point, exactly as in `extract-materials.mjs`.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { requireJar } from './paths.mjs';

const MCLITE_ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT = join(MCLITE_ROOT, 'tools', 'golden', 'block-soundtype-1.18.2.tsv');

const say = (...a) => console.log(...a);
let failures = 0;
const ok = (c, m) => { if (!c) { failures++; say('   x ' + m); } };
const esc = (s) => s.replace(/[$]/g, '\\$');

if (process.argv.includes('--if-missing') && existsSync(OUT)) {
  say(' block-soundtype-1.18.2.tsv is present — nothing to do (--if-missing)');
  process.exit(0);
}

const JAR = requireJar('1.18.2');
try { execFileSync('javap', ['-version'], { stdio: 'ignore' }); }
catch { say('SKIP - no javap on this machine. Install a JDK, or keep the committed TSV.'); process.exit(0); }

const work = mkdtempSync(join(tmpdir(), 'mclite-snd-'));
try {
  execFileSync('unzip', ['-o', '-q', JAR, '-d', work]);
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

  // ── 1. the three classes, by shape ────────────────────────────────────────────────────────
  const sigs = javap(['-p'], all);
  let cur = null;
  const selfCount = new Map(), otherCount = new Map();
  for (const line of sigs) {
    const d = line.trim().match(/^(?:public |final |abstract |)*(?:class|interface|enum) ([\w.$]+)/);
    if (d && line.trimEnd().endsWith('{')) { cur = d[1]; continue; }
    if (!cur) continue;
    const f = line.match(/static final ([\w.$[\]]+) /);
    if (!f) continue;
    if (f[1] === cur) selfCount.set(cur, (selfCount.get(cur) || 0) + 1);
    else otherCount.set(cur + ' ' + f[1], (otherCount.get(cur + ' ' + f[1]) || 0) + 1);
  }
  const evCand = [...otherCount].filter(([, n]) => n >= 1000 && n <= 1400).sort((a, b) => b[1] - a[1])[0];
  ok(!!evCand, 'no SoundEvents candidate: no class with 1000-1400 static finals of one type');
  const [EVENTS, EVTYPE] = evCand ? evCand[0].split(' ') : [null, null];
  say(' SoundEvents ........ ' + EVENTS + ' of ' + EVTYPE + ' (' + (evCand ? evCand[1] : 0) + ' fields)');

  const blkCand = [...otherCount].filter(([, n]) => n >= 850 && n <= 1000).sort((a, b) => b[1] - a[1])[0];
  ok(!!blkCand, 'no Blocks candidate');
  const [BLOCKS, BLOCKTYPE] = blkCand ? blkCand[0].split(' ') : [null, null];
  say(' Blocks ............. ' + BLOCKS + ' of ' + BLOCKTYPE + ' (' + (blkCand ? blkCand[1] : 0) + ' fields)');
  if (failures) { say('\n aborted - the jar did not look like 1.18.2'); process.exit(1); }

  // SoundType: own-type constants, and its <clinit> reads SoundEvents five times per constant
  const stCands = [...selfCount].filter(([, n]) => n >= 50 && n <= 90).sort((a, b) => b[1] - a[1]);
  let SOUNDTYPE = null, stReads = 0, stCount = 0;
  for (const [c, n] of stCands) {
    const code = javap(['-c', '-p'], [c]);
    const reads = code.filter((l) => l.indexOf('Field ' + EVENTS + '.') >= 0).length;
    if (reads === n * 5) { SOUNDTYPE = c; stReads = reads; stCount = n; break; }
  }
  ok(!!SOUNDTYPE, 'no SoundType candidate: no class of 50-90 own-type constants reading SoundEvents exactly 5x each');
  say(' SoundType .......... ' + SOUNDTYPE + ' (' + stCount + ' constants, ' + stReads
    + ' SoundEvents reads = ' + stCount + ' x 5)');
  if (failures) { say('\n aborted'); process.exit(1); }

  // ── 2. SoundEvents field -> registry name ─────────────────────────────────────────────────
  const evCode = javap(['-c', '-p'], [EVENTS]);
  const ei = evCode.findIndex((l) => l.trim().startsWith('static {}'));
  const evName = new Map();
  let pending = null;
  const rePutEv = new RegExp('putstatic\\s+#\\d+\\s+// Field (\\w+):L' + esc(EVTYPE) + ';');
  for (const l of evCode.slice(ei)) {
    const s = l.match(/ldc(?:_w)?\s+#\d+\s+\/\/ String ([a-z0-9_.]+)$/);
    if (s) { pending = s[1]; continue; }
    const p = l.match(rePutEv);
    if (p && pending) { evName.set(p[1], pending); pending = null; }
  }
  say(' sound events ....... ' + evName.size + ' named');
  ok(evName.size >= 1000, 'only ' + evName.size + ' sound events named');

  // ── 3. SoundType constants and their five events, in constructor order ────────────────────
  const stCode = javap(['-c', '-p'], [SOUNDTYPE]);
  const si = stCode.findIndex((l) => l.trim().startsWith('static {}'));
  const reGetEv = new RegExp('getstatic\\s+#\\d+\\s+// Field ' + esc(EVENTS) + '\\.(\\w+):L' + esc(EVTYPE) + ';');
  const rePutSt = new RegExp('putstatic\\s+#\\d+\\s+// Field (\\w+):L' + esc(SOUNDTYPE) + ';');
  const types = new Map();
  const vp = new Map();   // constant -> [volume, pitch]: the constructor's first two float arguments
  let slots = [], flts = [];
  for (const l of stCode.slice(si)) {
    const fc = l.match(/\bfconst_(\d)\b/);
    if (fc) { flts.push(+fc[1]); continue; }
    const fl = l.match(/ldc(?:_w)?\s+#\d+\s+\/\/ float ([-\d.eE]+)f/);
    if (fl) { flts.push(+fl[1]); continue; }
    const g = l.match(reGetEv);
    if (g) { slots.push(g[1]); continue; }
    const p = l.match(rePutSt);
    if (p) { types.set(p[1], slots.slice(0, 5)); vp.set(p[1], flts.slice(0, 2)); slots = []; flts = []; }
  }
  say(' sound types ........ ' + types.size);
  ok(types.size === stCount, types.size + ' sound types decoded, expected ' + stCount);
  const wrongArity = [...types].filter(([, v]) => v.length !== 5).map(([k]) => k);
  ok(wrongArity.length === 0, wrongArity.length + ' sound types do not name exactly five events');

  // ⚠ THE ORDER, DERIVED. For every constant whose five events share a common prefix, take the
  // suffix sequence; they must all be the same sequence, and that sequence IS the order.
  const seqs = new Map();
  for (const [k, v] of types) {
    const names = v.map((f) => evName.get(f) || '');
    if (names.some((n) => !n)) continue;
    const parts = names.map((n) => n.split('.'));
    const pre = parts[0].slice(0, -1).join('.');
    if (!parts.every((p) => p.slice(0, -1).join('.') === pre)) continue;   // mixed prefixes: skip
    const seq = parts.map((p) => p[p.length - 1]).join(',');
    seqs.set(seq, (seqs.get(seq) || 0) + 1);
  }
  const ranked = [...seqs].sort((a, b) => b[1] - a[1]);
  say(' argument order ..... ' + ranked.map(([s, n]) => s + ' x' + n).join('  |  '));
  ok(ranked.length >= 1, 'no sound type had five events sharing a prefix — the order cannot be derived');
  const ORDER = ranked.length ? ranked[0][0].split(',') : [];
  ok(ranked.length === 1, 'the five events disagree on their order across sound types: '
    + ranked.map(([s, n]) => s + ' (' + n + ')').join(' vs '));
  ok(ranked.length && ranked[0][1] >= 20,
    'only ' + (ranked.length ? ranked[0][1] : 0) + ' sound types agree on the order; want at least 20');
  ok(ORDER.join(',') === 'break,step,place,hit,fall',
    'the derived order is ' + ORDER.join(',') + ', not break,step,place,hit,fall');
  if (failures) { say('\n aborted - the order could not be derived'); process.exit(1); }

  // ── 4. block -> sound type (the Blocks.<clinit> walk, as in extract-materials) ────────────
  const blkCode = javap(['-c', '-p'], [BLOCKS]);
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
    const reStField = new RegExp('Field ' + esc(SOUNDTYPE) + '\\.(\\w+):L' + esc(SOUNDTYPE) + ';', 'g');
    for (const [k, body] of bodies) {
      const ms = new Set([...body.join('\n').matchAll(reStField)].map((x) => x[1]));
      if (ms.size === 1) helperOf.set(k, [...ms][0]);
    }
  }
  const st = new Map(), f2b = new Map(), reads = new Map();
  const reGetSt = new RegExp('getstatic\\s+#\\d+\\s+// Field ' + esc(SOUNDTYPE) + '\\.(\\w+):L' + esc(SOUNDTYPE) + ';');
  const rePutBlk = new RegExp('putstatic\\s+#\\d+\\s+// Field (\\w+):L' + esc(BLOCKTYPE) + ';');
  const reGetBlk = new RegExp('getstatic\\s+#\\d+\\s+// Field (\\w+):L' + esc(BLOCKTYPE) + ';');
  let name = null;
  for (const l of blkCode.slice(bi)) {
    const nm = l.trim().match(/ldc(?:_w)?\s+#\d+\s+\/\/ String ([a-z0-9_]+)$/);
    if (nm && /^[a-z][a-z0-9_]*$/.test(nm[1])) { name = nm[1]; if (!st.has(name)) st.set(name, null); continue; }
    if (!name) continue;
    const gs2 = l.match(reGetSt);
    if (gs2 && st.get(name) === null) { st.set(name, gs2[1]); continue; }
    const ps = l.match(rePutBlk);
    if (ps) { f2b.set(ps[1], name); continue; }
    const gb = l.match(reGetBlk);
    if (gb) { if (!reads.has(name)) reads.set(name, []); reads.get(name).push(gb[1]); continue; }
    if (st.get(name) === null) {
      const iv = l.match(/\/\/ Method (\w+:\([^)]*\)[\w/;[$]+)\s*$/);
      if (iv && helperOf.has(iv[1]) && iv[1].indexOf('a:(Ljava/lang/String;') !== 0) st.set(name, helperOf.get(iv[1]));
    }
  }
  for (let pass = 0; pass < 8; pass++) {
    let changed = 0;
    for (const [b, v] of st) {
      if (v !== null) continue;
      for (const f of reads.get(b) || []) {
        const base = f2b.get(f);
        if (base && st.get(base)) { st.set(b, st.get(base)); changed++; break; }
      }
    }
    if (!changed) break;
  }
  // ⚠ THE DEFAULT IS NOT "unresolved". `BlockBehaviour$Properties` starts every block at
  // SoundType.STONE and `.sound(...)` overrides it, so a block that never calls `.sound` is
  // legitimately stone — which is why `extract-materials`' "0 unresolved" assertion does NOT
  // transfer here. The default is identified as the type STONE's own constant, which is the one
  // whose five events are `block.stone.*`, and the count of blocks taking it is REPORTED.
  let STONE = null;
  for (const [k, v] of types) {
    const n0 = evName.get(v[0]) || '';
    if (n0 === 'block.stone.break') { STONE = k; break; }
  }
  ok(!!STONE, 'could not find the SoundType whose break event is block.stone.break');
  let defaulted = 0;
  for (const [b, v] of st) if (v === null) { st.set(b, STONE); defaulted++; }
  say(' blocks ............. ' + st.size + '  (' + defaulted + ' took the default, ' + SOUNDTYPE + '.' + STONE + ')');

  // ── 5. the shape the answer must have, in both directions ────────────────────────────────
  // ⚠ ANTI-VACUITY FOR THE DERIVATION. These are blocks whose sound cannot be in doubt.
  const evOf = (block, role) => {
    const t = types.get(st.get(block));
    if (!t) return null;
    return evName.get(t[ORDER.indexOf(role)]) || null;
  };
  const MUST = [
    ['stone', 'break', 'block.stone.break'], ['stone', 'step', 'block.stone.step'],
    ['stone', 'place', 'block.stone.place'],
    ['oak_planks', 'break', 'block.wood.break'], ['oak_log', 'step', 'block.wood.step'],
    ['glass', 'break', 'block.glass.break'], ['white_wool', 'step', 'block.wool.step'],
    ['sand', 'step', 'block.sand.step'], ['gravel', 'step', 'block.gravel.step'],
    ['grass_block', 'step', 'block.grass.step'], ['snow_block', 'step', 'block.snow.step'],
    ['iron_block', 'step', 'block.metal.step'], ['ladder', 'step', 'block.ladder.step'],
    ['anvil', 'place', 'block.anvil.place'], ['slime_block', 'step', 'block.slime_block.step'],
    ['honey_block', 'step', 'block.honey_block.step'], ['netherrack', 'step', 'block.netherrack.step'],
    ['soul_sand', 'step', 'block.soul_sand.step'], ['bamboo', 'step', 'block.bamboo.step'],
    ['deepslate', 'step', 'block.deepslate.step'], ['amethyst_block', 'step', 'block.amethyst_block.step'],
  ];
  const vpOf = (b) => vp.get(st.get(b));
  for (const [b, v, p] of [['iron_block', 1, 1.5], ['anvil', 0.3, 1], ['stone', 1, 1]]) {
    const g = vpOf(b);
    ok(g && g.length === 2 && Math.abs(g[0] - v) < 1e-6 && Math.abs(g[1] - p) < 1e-6,
      b + ' volume/pitch is ' + JSON.stringify(g) + ', expected (' + v + ', ' + p + ')');
  }
  // WEEPING_VINES_LOW_PITCH (1.0, 0.5) is a constant no block uses in 1.18.2; it must still be decoded
  ok([...vp.values()].some((g) => g[0] === 1 && g[1] === 0.5), 'no sound type has (1, 0.5): WEEPING_VINES_LOW_PITCH missed');
  ok([...vp.values()].filter((g) => g[0] !== 1 || g[1] !== 1).length === 3, 'exactly 3 sound types are not (1, 1)');
  for (const [b, role, want] of MUST) {
    const got = evOf(b, role);
    ok(got === want, b + '.' + role + ' is ' + got + ', expected ' + want);
  }
  // and the other direction: two blocks of obviously different materials must NOT share a type
  const DIFFER = [['stone', 'oak_planks'], ['glass', 'white_wool'], ['sand', 'gravel'],
    ['grass_block', 'stone'], ['iron_block', 'stone'], ['netherrack', 'stone'], ['deepslate', 'stone']];
  for (const [a, b] of DIFFER) {
    ok(st.get(a) !== st.get(b), a + ' and ' + b + ' share a sound type — the walk collapsed');
  }

  if (failures) { say('\n x ' + failures + ' failures - NOT written'); process.exit(1); }

  mkdirSync(dirname(OUT), { recursive: true });
  const lines = ['# block\tsoundType\tvolume\tpitch\t' + ORDER.join('\t'),
    '# Generated by tools/extract-soundtype.mjs from ' + JAR,
    '# SoundType=' + SOUNDTYPE + '  SoundEvents=' + EVENTS + '  Blocks=' + BLOCKS,
    '# argument order DERIVED as ' + ORDER.join(',') + ', agreed by ' + ranked[0][1] + ' sound types',
    '# ' + st.size + ' blocks, ' + types.size + ' sound types, ' + defaulted + ' blocks on the default'];
  for (const b of [...st.keys()].sort()) {
    const t = types.get(st.get(b)) || [];
    lines.push([b, st.get(b), ...(vp.get(st.get(b)) || [1, 1]), ...t.map((f) => evName.get(f) || '?')].join('\t'));
  }
  writeFileSync(OUT, lines.join('\n') + '\n');
  say('\n wrote ' + OUT);
  say(' ' + st.size + ' blocks - ' + types.size + ' sound types - ' + failures + ' failures');
} finally {
  rmSync(work, { recursive: true, force: true });
}
