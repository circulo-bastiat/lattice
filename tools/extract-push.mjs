#!/usr/bin/env node
// extract-push.mjs — what a PISTON can push, out of the 1.18.2 BYTECODE.
//
//   node tools/extract-push.mjs [--if-missing]   -> tools/golden/push-reaction-1.18.2.tsv
//
// ⚠ WHY THIS EXISTS. `PushReaction` is the single table G15c cannot be written without, and it
// is compiled Java from end to end: no JSON file, no tag, nothing in `minecraft-data`. Every
// block has one of five answers — NORMAL (moves), DESTROY (breaks), BLOCK (stops the piston),
// IGNORE (is not there), PUSH_ONLY (can be pushed but not pulled) — and getting one wrong is a
// piston door that eats an obsidian block or a slime contraption that falls apart.
//
// ⚠ THE ANSWER COMES FROM TWO PLACES AND BOTH ARE READ, which is the point of this file:
//
//   1. THE MATERIAL. `BlockBehaviour.getPistonPushReaction` defaults to
//      `this.material.getPushReaction()`, and each `Material` is built by a builder whose
//      DEFAULT is NORMAL. Two protected builder calls change it — one to DESTROY, one to BLOCK —
//      and WHICH is which is derived from the enum's own `<clinit>` name literals rather than
//      from the order the calls appear.
//   2. THE BLOCK. Fourteen classes override it outright, and they are not a footnote: every
//      door, every glazed terracotta (the only PUSH_ONLY blocks in the game), ice, end rods,
//      lanterns, bells, amethyst, shulker boxes, pointed dripstone and the structure void.
//      A table built from materials alone is wrong for about sixty blocks.
//
// ⚠ THE BLOCK -> MATERIAL JOIN IS NOT RE-DERIVED HERE. `tools/golden/block-materials-1.18.2.tsv`
// already carries it for all 898 blocks, resolved through helpers and `Properties.copy` to a
// fixed point (D-263, the first table). Re-deriving it would be a second implementation of the
// hardest part of that file, free to disagree with it. This reads it, and asserts it is there.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { requireJar } from './paths.mjs';

const MCLITE_ROOT = fileURLToPath(new URL('..', import.meta.url));
const MATS = join(MCLITE_ROOT, 'tools', 'golden', 'block-materials-1.18.2.tsv');
const OUT = join(MCLITE_ROOT, 'tools', 'golden', 'push-reaction-1.18.2.tsv');

const say = (...a) => console.log(...a);
let failures = 0;
const ok = (c, m) => { if (!c) { failures++; say('   x ' + m); } };

if (process.argv.includes('--if-missing') && existsSync(OUT)) {
  say(' push-reaction-1.18.2.tsv is present — nothing to do (--if-missing)');
  process.exit(0);
}
if (!existsSync(MATS)) {
  say(' SKIP - block-materials-1.18.2.tsv is missing; run extract-materials first.');
  process.exit(0);
}
const JAR = requireJar('1.18.2');
try { execFileSync('javap', ['-version'], { stdio: 'ignore' }); }
catch { say('SKIP - no javap on this machine. Install a JDK, or keep the committed TSV.'); process.exit(0); }

const work = mkdtempSync(join(tmpdir(), 'mclite-push-'));
execFileSync('unzip', ['-qo', JAR, '*.class', '-d', work]);
const classes = readdirSync(work).filter((f) => f.endsWith('.class'));
say(` ${classes.length} classes`);
const javap = (list) => execFileSync('javap', ['-p', '-c', '-constants', ...list],
  { cwd: work, maxBuffer: 1 << 30, env: { ...process.env, JAVA_TOOL_OPTIONS: '' } }).toString();

// ── 1. the block -> material join, read rather than re-derived ──────────────────────────────
const matRows = readFileSync(MATS, 'utf8').split('\n').filter((l) => l && l[0] !== '#')
  .map((l) => l.split('\t'));
const materialOf = new Map(matRows.map((r) => [r[0], r[1]]));
ok(materialOf.size > 800, `${materialOf.size} blocks carry a material, expected 898`);
// The header of that file names the classes it used, so this one does not have to guess them.
const head = readFileSync(MATS, 'utf8').split('\n').find((l) => l.startsWith('# Material='));
const M_CLASS = (head && head.match(/Material=([A-Za-z0-9$_]+)/) || [])[1];
const B_CLASS = (head && head.match(/Blocks=([A-Za-z0-9$_]+)/) || [])[1];
ok(!!M_CLASS && !!B_CLASS, `the materials table names its own Material (${M_CLASS}) and Blocks (${B_CLASS}) classes`);
if (failures) { say(' refusing to guess'); process.exit(1); }

// ── 2. the PushReaction enum, named from its own <clinit> ───────────────────────────────────
// ⚠ `Material` holds a field of this enum type; the enum is found by USE — it is the type of
// the last constructor argument of `Material` — and its five constants are named by the
// `Enum(String, int)` literal each one carries.
const matDump = javap([M_CLASS + '.class', M_CLASS + '$a.class']);
const ctor = matDump.split('\n').find((l) => /public .*\(.*\)\s*;/.test(l) && l.includes(M_CLASS + '('));
const PR_CLASS = (matDump.match(new RegExp('Method ' + M_CLASS.replace('$', '\\$')
  + '\\."<init>":\\([^)]*L([A-Za-z0-9$_]+);\\)V')) || [])[1];
ok(!!PR_CLASS, `found the PushReaction enum by use (${PR_CLASS}) as Material's last constructor argument`);
const prDump = javap([PR_CLASS + '.class']);
const prName = new Map();                                  // field letter -> NAME
{
  const lines = prDump.split('\n');
  let last = null;
  for (const l of lines) {
    let m = l.match(/ldc(?:_w)?\s+#\d+\s+\/\/ String ([A-Z_]+)$/);
    if (m) { last = m[1]; continue; }
    m = l.match(/putstatic\s+#\d+\s+\/\/ Field ([A-Za-z0-9$_]+):L/);
    if (m && last) { prName.set(m[1], last); last = null; }
  }
}
ok(prName.size === 5, `${prName.size} PushReaction constants, expected 5`);
for (const n of ['NORMAL', 'DESTROY', 'BLOCK', 'IGNORE', 'PUSH_ONLY']) {
  ok([...prName.values()].includes(n), `PushReaction.${n} is present`);
}

// ── 3. the material -> reaction map, from Material.<clinit>'s builder chains ─────────────────
// ⚠ WHICH BUILDER CALL SETS WHICH REACTION IS READ, NOT ASSUMED. Each protected no-arg method of
// `Material.Builder` whose body is `putfield <the PushReaction field>` names its own constant in
// the `getstatic` right before it; the default is whatever the constructor puts there.
const setterFor = new Map();                                // builder method -> reaction NAME
let defaultReaction = null;
{
  const lines = matDump.split('\n');
  let inClass = null, method = null, body = [];
  const flush = () => {
    if (!method || inClass !== M_CLASS + '$a') { method = null; return; }
    const m = body.join(' ').match(/Field ([A-Za-z0-9$_]+):L(?:[A-Za-z0-9$_]+);\s*\|?\s*putfield/);
    const g = body.join(' ').match(/getstatic\s+#\d+\s+\/\/ Field [A-Za-z0-9$_]+\.([A-Za-z0-9$_]+):L([A-Za-z0-9$_]+);/);
    if (g && g[2] === PR_CLASS && prName.has(g[1])) {
      if (method === '<init>') defaultReaction = prName.get(g[1]);
      else setterFor.set(method, prName.get(g[1]));
    }
    method = null; body = [];
  };
  for (const l of lines) {
    const c = l.match(/^(?:public |final |abstract )*class ([A-Za-z0-9$_]+)/);
    if (c) { flush(); inClass = c[1]; continue; }
    // ⚠ A CONSTRUCTOR HAS NO RETURN TYPE, so a "TYPE NAME(" pattern silently misses it and its
    // body lands on the previous method. That is how the FIRST run of this file reported the
    // builder's default reaction as `null` and counted three setters instead of two: the
    // constructor — which is where the default is set — was never recognised as a method.
    let d = l.match(/^ {2}(?:public |protected |private |static |final )*[A-Za-z0-9$_.<>[\]]+ ([A-Za-z0-9$_<>]+)\(/);
    if (!d) {
      const k = l.match(/^ {2}(?:public |protected |private )*([A-Za-z0-9$_]+)\([^)]*\);$/);
      if (k && inClass && k[1] === inClass) d = [l, '<init>'];
    }
    // ⚠ AND THE "TYPE NAME(" PATTERN MATCHES A CONSTRUCTOR TOO, WRONGLY. `  public djb$a(djc);`
    // parses as return type `public`, method `djb$a` — because the modifier group is allowed to
    // match zero times. So the constructor came back named after its own class, went onto the
    // setter list, and left the default `null`, which then silently became NORMAL for 584
    // blocks through a `||` fallback. Two bugs that cancelled to a plausible table.
    if (d && d[1] === inClass) d = [l, '<init>'];
    if (d) { flush(); method = d[1]; body = []; continue; }
    if (method) body.push(l);
  }
  flush();
}
ok(defaultReaction === 'NORMAL', `the Material builder's default reaction is ${defaultReaction}, expected NORMAL`);
ok(setterFor.size === 2, `${setterFor.size} builder calls change the reaction, expected 2 (DESTROY and BLOCK)`);

const reactionOfMaterial = new Map();
{
  const lines = matDump.split('\n');
  let calls = [];
  let inClinit = false;
  for (const l of lines) {
    if (/^ {2}static \{\};/.test(l)) { inClinit = true; continue; }
    if (!inClinit) continue;
    const c = l.match(/invokevirtual\s+#\d+\s+\/\/ Method [A-Za-z0-9$_]+\.([A-Za-z0-9$_]+):\(\)L/);
    if (c) { calls.push(c[1]); continue; }
    const p = l.match(/putstatic\s+#\d+\s+\/\/ Field ([A-Za-z0-9$_]+):L([A-Za-z0-9$_]+);/);
    if (p && p[2] === M_CLASS) {
      let r = defaultReaction;
      for (const call of calls) if (setterFor.has(call)) r = setterFor.get(call);
      reactionOfMaterial.set(p[1], r);
      calls = [];
    }
  }
}
ok(reactionOfMaterial.size >= 40, `${reactionOfMaterial.size} materials resolved, expected 40+`);
const byR = {};
for (const r of reactionOfMaterial.values()) byR[r] = (byR[r] || 0) + 1;
say(` materials: ${Object.entries(byR).map(([k, v]) => `${v} ${k}`).join(', ')}`);

// ── 4. the block overrides ──────────────────────────────────────────────────────────────────
// `BlockStateBase.getPistonPushReaction()` delegates to one `Block` method taking a BlockState
// and returning the enum; every class that overrides it with a bare `return CONSTANT` is a
// block whose answer its material does not give.
let dump = '';
for (let i = 0; i < classes.length; i += 400) dump += javap(classes.slice(i, i + 400));
const lines = dump.split('\n');
say(` ${lines.length.toLocaleString()} lines of bytecode`);

const childrenOf = new Map();
for (const l of lines) {
  const m = l.match(/^(?:public |final |abstract |)*class ([A-Za-z0-9$_]+)(?:<[^>]*>)? extends ([A-Za-z0-9$_.]+)/);
  if (!m) continue;
  if (!childrenOf.has(m[2])) childrenOf.set(m[2], []);
  childrenOf.get(m[2]).push(m[1]);
}
// the Block base, found by use: it is what `stone` is constructed from
let BLOCK_BASE = null;
{
  let last = null;
  for (const l of lines) {
    let m = l.match(/^\s*\d+: ldc(?:_w)?\s+#\d+\s+\/\/ String ([a-z0-9_]+)$/);
    if (m) { last = m[1]; continue; }
    m = l.match(/^\s*\d+: new\s+#\d+\s+\/\/ class ([A-Za-z0-9$_]+)$/);
    if (m && last === 'stone') { BLOCK_BASE = m[1]; break; }
  }
}
const blockClasses = new Set();
(function walk(c) { if (!c || blockClasses.has(c)) return; blockClasses.add(c); for (const k of (childrenOf.get(c) || [])) walk(k); })(BLOCK_BASE);
ok(blockClasses.size > 150, `${blockClasses.size} Block subclasses`);

const namesOf = new Map();
{
  let last = null, cands = [];
  for (const l of lines) {
    let m = l.match(/^\s*\d+: ldc(?:_w)?\s+#\d+\s+\/\/ String ([a-z0-9_]+)$/);
    if (m) { last = m[1]; cands = []; continue; }
    const isRegister = /invokestatic\s+#\d+\s+\/\/ Method a:\(Ljava\/lang\/String;L[A-Za-z0-9$_]+;\)L[A-Za-z0-9$_]+;$/.test(l);
    m = l.match(/^\s*\d+: new\s+#\d+\s+\/\/ class ([A-Za-z0-9$_]+)$/);
    if (m) { if (blockClasses.has(m[1])) cands.push(m[1]); continue; }
    if (!isRegister) {
      m = l.match(/^\s*\d+: invokestatic\s+#\d+\s+\/\/ Method [^\s]*?\)L([A-Za-z0-9$_]+);$/);
      if (m) { if (blockClasses.has(m[1])) cands.push(m[1]); continue; }
    }
    if (isRegister && last && cands.length) {
      const c = cands[cands.length - 1];
      if (!namesOf.has(c)) namesOf.set(c, []);
      if (!namesOf.get(c).includes(last)) namesOf.get(c).push(last);
      last = null; cands = [];
    }
  }
}
function blocksUnder(c, seen) {
  seen = seen || new Set();
  if (seen.has(c)) return [];
  seen.add(c);
  const out = (namesOf.get(c) || []).slice();
  for (const k of (childrenOf.get(c) || [])) out.push(...blocksUnder(k, seen));
  return out;
}

// the override method: whichever `(BlockState) -> PushReaction` is implemented by the most
// classes. ⚠ Anchored, not taken on faith: the base class's version must read the MATERIAL,
// and at least one override must be a door, which cannot be in doubt — a piston breaks a door.
const overrides = new Map();                      // class -> reaction NAME
let baseClass = null;
{
  let cls = null;
  for (let i = 0; i < lines.length; i++) {
    const c = lines[i].match(/^(?:public |final |abstract |)*class ([A-Za-z0-9$_]+)/);
    if (c) { cls = c[1]; continue; }
    if (!new RegExp('^ {2}public ' + PR_CLASS + ' [A-Za-z0-9$_]+\\(cov\\);$').test(lines[i])) continue;
    const body = [];
    for (let j = i + 2; j < lines.length && lines[j].trim() !== ''; j++) body.push(lines[j]);
    const flat = body.join(' ');
    const g = flat.match(/getstatic\s+#\d+\s+\/\/ Field [A-Za-z0-9$_]+\.([A-Za-z0-9$_]+):L/);
    if (g && prName.has(g[1]) && /areturn/.test(flat) && !/invokevirtual/.test(flat)) {
      overrides.set(cls, prName.get(g[1]));
    } else if (flat.includes(M_CLASS + '.')) {
      baseClass = cls;                            // the one that reads the material
    }
  }
}
ok(!!baseClass, `the base implementation reads the Material (${baseClass})`);
ok(overrides.size >= 10, `${overrides.size} block classes override the push reaction, expected 10+`);
const doorClass = [...overrides.keys()].find((c) => blocksUnder(c).includes('oak_door'));
ok(!!doorClass && overrides.get(doorClass) === 'DESTROY',
   'a door overrides its material and reads DESTROY — the anchor that cannot be in doubt');

// ── 5. join, assert, write ──────────────────────────────────────────────────────────────────
const reactionOf = new Map();
for (const [block, mat] of materialOf) {
  // ⚠ NO `|| 'NORMAL'` FALLBACK. A material with no entry is a parse failure, not a NORMAL
  // block, and the first run hid twenty-three of them behind exactly that default.
  ok(reactionOfMaterial.has(mat), `material ${mat} (${block}) resolved to a reaction`);
  reactionOf.set(block, [reactionOfMaterial.get(mat), 'material:' + mat]);
}
let overridden = 0;
for (const [cls, r] of overrides) {
  for (const b of blocksUnder(cls)) { reactionOf.set(b, [r, 'block:' + cls]); overridden++; }
}
ok(overridden >= 40, `${overridden} blocks take their answer from a block override, expected 40+`);

// ⚠ ANCHORS IN BOTH DIRECTIONS. Each of these is a thing a player knows without looking it up.
// ⚠ AND THE ANCHORS ARE ABOUT *THIS TABLE*, NOT ABOUT WHAT A PISTON DOES. The first version
// asserted `obsidian: BLOCK` and `bedrock: BLOCK` and both failed — correctly. Obsidian's
// PushReaction really is NORMAL; a piston refuses it because `PistonBaseBlock.isPushable` names
// obsidian, crying obsidian and the respawn anchor OUTRIGHT, refuses anything whose destroy
// speed is −1 (that is bedrock), refuses an already-extended piston, and refuses anything with a
// block entity. Four rules that live in the piston and not in the block. Writing them into this
// table would have made it wrong AND would have hidden the fact that the piston has to carry
// them — so they are `Redstone.isPushable`'s job and this file asserts only what it owns.
const MUST = {
  anvil: 'BLOCK', barrier: 'BLOCK', piston: 'BLOCK', sticky_piston: 'BLOCK',
  moving_piston: 'BLOCK', nether_portal: 'BLOCK',
  stone: 'NORMAL', dirt: 'NORMAL', slime_block: 'NORMAL', ice: 'NORMAL', end_rod: 'NORMAL',
  obsidian: 'NORMAL', bedrock: 'NORMAL',
  torch: 'DESTROY', oak_door: 'DESTROY', bell: 'DESTROY', ladder: 'DESTROY',
  oak_leaves: 'DESTROY', poppy: 'DESTROY',
  white_glazed_terracotta: 'PUSH_ONLY', black_glazed_terracotta: 'PUSH_ONLY',
};
for (const [b, want] of Object.entries(MUST)) {
  const got = reactionOf.has(b) ? reactionOf.get(b)[0] : '(absent)';
  ok(got === want, `${b} is ${want} (got ${got})`);
}
const counts = {};
for (const [, v] of reactionOf) counts[v[0]] = (counts[v[0]] || 0) + 1;
ok((counts.PUSH_ONLY || 0) === 16, `${counts.PUSH_ONLY} PUSH_ONLY blocks — the sixteen glazed terracottas and nothing else`);
ok((counts.BLOCK || 0) === 13, `${counts.BLOCK} BLOCK blocks — three anvils, barrier, grindstone, lodestone, three portals, three pistons and the piston head`);
ok((counts.NORMAL || 0) > 400, `${counts.NORMAL} NORMAL blocks`);

const rows = [...reactionOf.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
writeFileSync(OUT,
  '# PushReaction — what a piston does to each block in 1.18.2.\n' +
  '# Generated by tools/extract-push.mjs. Do not hand-edit.\n' +
  `# PushReaction=${PR_CLASS}  Material=${M_CLASS}  base=${baseClass}  default=${defaultReaction}\n` +
  `# ${rows.length} blocks · ` + Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(' · ') + '\n' +
  '# block\treaction\tsource\n' +
  rows.map(([b, v]) => [b, v[0], v[1]].join('\t')).join('\n') + '\n');
say(` wrote ${rows.length} blocks -> tools/golden/push-reaction-1.18.2.tsv`);
say(' ' + Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(' · '));
if (failures) { say(` ${failures} assertions failed`); process.exit(1); }
say(' extract-push: OK');
