#!/usr/bin/env node
// extract-flammable.mjs — PLAN W8c (D-352). THE IGNITE-ODDS MAP, OUT OF THE BYTECODE.
//
//   node tools/extract-flammable.mjs   -> tools/golden/flammable-1.18.2.tsv
//
// ⚠⚠ **WHY THIS EXISTS.** `fire` was the last of the 98 blocks D-346 left owed. Its `canSurvive`
// is *"a sturdy face below, OR any of the six neighbours is flammable"*, and "flammable" is not a
// material, a tag or a shape: it is a per-block INTEGER in a map built by a bootstrap method that
// calls `setFlammable(block, igniteOdds, burnOdds)` about two hundred times. There is no JSON for
// it in any version of the jar. A guess ("wood and wool and leaves") would be a private list, and
// a private list is what is wrong after a version bump with no test able to tell.
//
// ── IDENTIFIED BY USE, ANCHORED ON THE RULE THAT NEEDS IT (D-263) ────────────────────────────
//   1. The fire class is whoever owns `fire`'s `canSurvive` in `cansurvive-1.18.2.tsv` — the
//      table this engine already trusts, and the same anchor `extract-occlusion.mjs` uses.
//   2. `setFlammable` is its only private void method taking (Block, int, int). Its body writes
//      the two arguments into two maps IN ORDER, so which map holds which number is READ, not
//      assumed.
//   3. ⚠ AND WHICH MAP `canSurvive` USES IS READ TOO. The two maps are interchangeable to look
//      at and the rule reads exactly one of them; the helper `canSurvive` calls is followed and
//      the field it touches is compared against the two. Getting this backwards would make fire
//      survive beside a block that BURNS WELL rather than one that CATCHES easily — a plausible
//      and completely wrong answer.
//   4. The bootstrap is the static method with the most calls to `setFlammable`. Every call site
//      is a `getstatic Blocks.<field>` and two integer pushes, read from the same window.
//
// ⚠ CLOSED IN BOTH DIRECTIONS: every registered block joins to a registry name, the count is
// asserted to be a believable one, and four anchors are asserted whose values are not in doubt.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { requireJar } from './paths.mjs';

const MCLITE_ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT = join(MCLITE_ROOT, 'tools', 'golden', 'flammable-1.18.2.tsv');
const say = (...a) => console.log(...a);
let failures = 0;
const ok = (c, m) => { if (!c) { failures++; say('   x ' + m); } return c; };

say('extract-flammable — the ignite-odds map, out of the 1.18.2 bytecode');
if (process.argv.includes('--if-missing') && existsSync(OUT)) {
  say(' flammable-1.18.2.tsv is present — nothing to do (--if-missing)');
  process.exit(0);
}

const jar = requireJar('1.18.2');
const work = mkdtempSync(join(tmpdir(), 'mclite-fire-'));
execFileSync('unzip', ['-qo', jar, '*.class', '-x', 'net/*', 'com/*', 'org/*', 'it/*', 'io/*',
                       'javax/*', 'assets/*', 'data/*', '-d', work], { stdio: 'ignore' });
const dump = (cls) => execFileSync('javap', ['-p', '-c', '-cp', work, cls],
  { maxBuffer: 1 << 27, stdio: ['ignore', 'pipe', 'ignore'] }).toString().split('\n');
const body = (lines, headRe) => {
  const out = [];
  let inside = false;
  for (const l of lines) {
    if (!inside) { if (headRe.test(l)) inside = true; continue; }
    if (/^\s*$/.test(l)) break;
    out.push(l);
  }
  return out;
};

// ── 1. the fire class, from the table this engine already trusts ─────────────────────────────
let FIRE = null, CAN = null, STATE = null, LEVEL = null, POS = null;
for (const l of readFileSync(join(MCLITE_ROOT, 'tools', 'golden', 'cansurvive-1.18.2.tsv'), 'utf8')
  .split('\n')) {
  const f = l.split('\t');
  if (f[0] === 'method') { CAN = f[2]; const a = f[3].split(','); STATE = a[0]; LEVEL = a[1]; POS = a[2]; }
  if (f[0] === 'owner' && (f[3] || '').split(' ').includes('fire')) FIRE = f[1];
}
say(' fire class .................. ' + FIRE);
ok(!!FIRE && !!CAN, 'the cansurvive table has no owner row for fire — run extract-support first');
if (!FIRE) { say('extract-flammable: FAILED'); process.exit(1); }
const code = dump(FIRE);

// ── 2. setFlammable, and which map takes which argument ──────────────────────────────────────
let SETTER = null, MAP1 = null, MAP2 = null;
{
  const head = /^\s+private void ([\w$]+)\(([\w$]+), int, int\);/;
  for (const l of code) {
    const m = head.exec(l);
    if (!m) continue;
    const b = body(code, new RegExp('private void ' + m[1] + '\\(' + m[2] + ', int, int\\);'));
    // the two `putfield`-free writes: getfield <map>; aload_1; iload_N; put
    let pending = null;
    const seen = [];
    for (const ln of b) {
      const g = /getfield\s+#\d+\s+\/\/ Field (\w+):L/.exec(ln);
      if (g) { pending = g[1]; continue; }
      const il = /\biload_(\d)\b/.exec(ln);
      if (il && pending) seen.push([Number(il[1]), pending]);
    }
    if (seen.length === 2) {
      SETTER = m[1];
      seen.sort((a, b2) => a[0] - b2[0]);
      MAP1 = seen[0][1]; MAP2 = seen[1][1];
      break;
    }
  }
}
say(' setFlammable ................ ' + FIRE + '.' + SETTER + '(Block,int,int)   first int -> ' +
    MAP1 + ', second -> ' + MAP2);
ok(!!SETTER, 'no private (Block, int, int) method writes two maps — setFlammable was not found');

// ── 3. WHICH map the survival rule reads. ⚠ NOT ASSUMED: the two are interchangeable to look at
//      and picking the wrong one gives a plausible, wrong answer.
let RULE_MAP = null;
{
  const cs = body(code, new RegExp('\\bboolean ' + CAN + '\\(' + [STATE, LEVEL, POS].join(', ') + '\\);'));
  const helpers = [];
  for (const l of cs) {
    const m = new RegExp('Method ([\\w$]+):\\(').exec(l);
    if (m) helpers.push(m[1]);
  }
  const visit = (name, depth) => {
    if (depth > 2 || RULE_MAP) return;
    for (const l of code) {
      // any method body mentioning one of the two maps, reached from canSurvive
      void l;
    }
    for (const decl of code) {
      const d = new RegExp('^\\s+(?:private |public |protected |)(?:static |)[\\w$.<>\\[\\]]+ ' +
                           name.replace('$', '\\$') + '\\(').exec(decl);
      if (!d) continue;
      const b = body(code, new RegExp(decl.trim().replace(/[.$()[\]]/g, (c) => '\\' + c)));
      for (const l of b) {
        const g = /getfield\s+#\d+\s+\/\/ Field (\w+):L/.exec(l);
        if (g && (g[1] === MAP1 || g[1] === MAP2)) { RULE_MAP = g[1]; return; }
        const h = /Method ([\w$]+):\(/.exec(l);
        if (h && h[1] !== name) visit(h[1], depth + 1);
        if (RULE_MAP) return;
      }
      break;
    }
  };
  for (const h of helpers) { visit(h, 0); if (RULE_MAP) break; }
}
say(' the map canSurvive reads .... ' + RULE_MAP + (RULE_MAP === MAP1 ? '  (the FIRST int)' : '  (the SECOND int)'));
ok(RULE_MAP === MAP1,
   'fire\'s survival reads ' + RULE_MAP + ', which is the SECOND argument of setFlammable — this ' +
   'tool assumed the first, and the assumption is now known to be wrong');

// ── 4. the bootstrap, and the Blocks class it names ──────────────────────────────────────────
let BLOCKS = null, BLOCKTYPE = null;
{
  const fieldsOf = {};
  const CLS = /^(?:public |final |abstract |static |protected |private )*(?:class|interface|enum)\s+([\w$]+)/;
  const statF = /^\s+(?:public |private |protected |)?static final ([\w$.]+(?:<[^>]*>)?)\s+([\w$]+);/;
  const names = execFileSync('bash', ['-c', 'cd ' + work + ' && ls *.class | sed "s/\\.class$//"'],
    { maxBuffer: 1 << 26 }).toString().trim().split('\n');
  const all = execFileSync('javap', ['-p', '-cp', work, ...names],
    { maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'ignore'] }).toString().split('\n');
  let cur = null;
  for (const l of all) {
    if (l && !/^\s/.test(l)) { const m = CLS.exec(l.trim()); if (m) cur = m[1]; continue; }
    if (!cur) continue;
    const f = statF.exec(l);
    if (f) (fieldsOf[cur] = fieldsOf[cur] || []).push([f[1].replace(/<.*/, ''), f[2]]);
  }
  let N = 0;
  for (const [c, fs] of Object.entries(fieldsOf)) {
    const count = new Map();
    for (const [t] of fs) count.set(t, (count.get(t) || 0) + 1);
    for (const [t, n] of count) if (n >= 850 && n <= 1100 && n > N) { BLOCKS = c; BLOCKTYPE = t; N = n; }
  }
  say(' Blocks class ................ ' + BLOCKS + ' with ' + N + ' static finals of ' + BLOCKTYPE);
  ok(!!BLOCKS, 'Blocks was not found');
}
const fieldToName = new Map();
{
  const bc = dump(BLOCKS);
  let name = null;
  const reName = new RegExp('ldc(?:_w)?\\s+#\\d+\\s+// String ([a-z_0-9]+)$');
  const rePut = new RegExp('putstatic\\s+#\\d+\\s+// Field (\\w+):L' + BLOCKTYPE + ';');
  for (const l of bc) {
    const n = reName.exec(l); if (n) { name = n[1]; continue; }
    const p = rePut.exec(l); if (p && name) { fieldToName.set(p[1], name); name = null; }
  }
  ok(fieldToName.size >= 850, 'only ' + fieldToName.size + ' Blocks fields joined to a name');
}

// the bootstrap: the method with the most calls to setFlammable
const odds = new Map();
{
  const reCall = new RegExp('invokevirtual\\s+#\\d+\\s+// Method ' + SETTER + ':\\(L' + BLOCKTYPE + ';II\\)V');
  const reGet = new RegExp('getstatic\\s+#\\d+\\s+// Field ' + BLOCKS + '\\.(\\w+):L' + BLOCKTYPE + ';');
  // ⚠ `iconst_N`, `bipush N` and `sipush N` are three ways to push the same integer, and the
  // first draft of a scan like this in `extract-support.mjs` matched only one of them and read
  // FIVE arguments for a six-argument box. All three are read here.
  const reInt = /\b(?:iconst_(\d)|bipush\s+(-?\d+)|sipush\s+(-?\d+))\b/;
  let field = null, ints = [];
  for (const l of code) {
    const g = reGet.exec(l); if (g) { field = g[1]; ints = []; continue; }
    const i = reInt.exec(l);
    if (i && field) { ints.push(Number(i[1] !== undefined ? i[1] : (i[2] !== undefined ? i[2] : i[3]))); continue; }
    if (reCall.test(l) && field && ints.length >= 2) {
      const n = fieldToName.get(field);
      if (n) odds.set(n, [ints[0], ints[1]]);
      field = null; ints = [];
    }
  }
}
say(' blocks registered flammable . ' + odds.size);
ok(odds.size > 100 && odds.size < 400,
   odds.size + ' flammable blocks — that is not a believable count');

// ⚠ FOUR ANCHORS, both ways round. Vanilla's own numbers: plain planks and logs catch at 5 and
// burn at 5 and 20; leaves catch at 30; wool at 30; and STONE is not in the map at all.
for (const [n, want] of [['oak_planks', 5], ['oak_leaves', 30], ['white_wool', 30], ['tnt', 15]]) {
  const v = odds.get(n);
  ok(!!v && v[0] === want, n + ' catches at ' + (v ? v[0] : '(absent)') + ', and vanilla says ' + want);
}
ok(!odds.has('stone'), 'stone is in the flammable map, which it is not');
ok(!odds.has('dirt'), 'dirt is in the flammable map, which it is not');

const out = [];
out.push('# flammable-1.18.2.tsv — vanilla\'s ignite odds and burn odds, per block (D-352).');
out.push('# Written by tools/extract-flammable.mjs from the 1.18.2 client bytecode.');
out.push('# ' + FIRE + '.' + SETTER + '(Block, igniteOdds, burnOdds); canSurvive reads ' + RULE_MAP +
         ', which takes the FIRST int.');
out.push('# ' + odds.size + ' blocks. A block absent from this table has ignite odds 0 and fire ' +
         'does not spread from it.');
out.push(['block', 'igniteOdds', 'burnOdds'].join('\t'));
for (const [n, v] of [...odds].sort()) out.push([n, v[0], v[1]].join('\t'));
mkdirSync(join(MCLITE_ROOT, 'tools', 'golden'), { recursive: true });
writeFileSync(OUT, out.join('\n') + '\n');
say('\n ' + odds.size + ' blocks -> ' + OUT);

if (failures) { say('extract-flammable: ' + failures + ' FAILED'); process.exit(1); }
say('extract-flammable: OK');
