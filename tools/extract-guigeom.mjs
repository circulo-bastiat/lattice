#!/usr/bin/env node
// extract-guigeom.mjs — PLAN G11 (D-329). THE HOTBAR'S GEOMETRY AND DRAW ORDER, out of the 1.18.2 BYTECODE.
//
//   node tools/extract-guigeom.mjs   -> tools/golden/gui-1.18.2.tsv
//
// ⚠ WHY THIS EXISTS, and it is the clearest case the project has produced. Dan, session 11:
// *"blocks in selected slot of hotbar do not look cortrect at all"*. Two faults, and NEITHER was
// reachable by reading this engine's own code:
//
//   1. The selection frame was drawn AFTER the nine slots, so it was composited over the selected
//      slot's icon and only that one. Vanilla blits the bar, then the frame, then loops the slots.
//   2. The frame was blitted 24x24. Vanilla blits it **24 wide and 22 TALL** — `widgets.png`'s
//      selection sprite is 24 rows and the game draws 22 of them, so the last two rows of its
//      bottom border are clipped on purpose and the frame ends flush with the bar.
//
// ⚠⚠ **AND `guicheck` ASSERTED THE BUG.** Its section 3 pinned `selector[3] === 24` — a literal
// somebody typed, in a check, standing in for a fact the jar owns. That is D-305's rule exactly
// ("never let a check own a number the code owns") and it had been green for three sessions while
// the picture was wrong. ⚠ **A wrong check is worse than no check: it converts a bug into a
// requirement and makes the correct value fail.**
//
// ⚠⚠ **A SUB-AGENT WAS ASKED WHAT VANILLA DOES HERE AND ANSWERED 24x24 FROM MEMORY**, with the
// confident air of a source read. `docs/archive/AGENTS.md` rule 2's bright line — *never delegate the last
// word on what vanilla does* — is why that answer was checked instead of believed. This file is
// the check. **A referee outlives both the bug and the opinion.**
//
// ── HOW EACH THING IS IDENTIFIED, AND WHY IT CANNOT BE A COINCIDENCE (D-263) ────────────────
//   1. The GUI class is found by USE: of the four classes whose constant pool mentions
//      `textures/gui/widgets.png`, the hotbar is the method that blits the rect (0, 0, 182, 22)
//      **and four or more rects in total**.
//      ⚠ The first version of this test was "the class that pushes 182" and TWO classes do.
//      **A constant is not a use.** The second was "the method that blits (0, 0, 182, 22)" and
//      TWO methods do — because the SPECTATOR hotbar draws the same bar. **A rect shared by two
//      drawings is not an identifier either.** What separates them is the OFFHAND: only the real
//      hotbar blits the two 29-wide offhand frames, because only the real hotbar has an offhand.
//   1b. ⚠⚠ AND THE SPECTATOR BAR IS KEPT AS A SECOND WITNESS RATHER THAN DISCARDED. It blits the
//      selection frame too, from its own call site, and it must agree: two independent drawings
//      of the same sprite in the same jar saying 24x22 is a fact, where one is a reading.
//   2. `blit` is found BY DESCRIPTOR — the instance method taking a PoseStack and six ints and
//      returning void — never by name. Its owner is the GUI class's superclass and is reported.
//   3. `renderHotbar` is the method containing a blit whose four source constants are
//      (0, 0, 182, 22): the hotbar widget itself. Nothing else in the class blits that rect.
//   4. Each blit's SOURCE rect is the four constant pushes immediately before the call. The
//      destination is an EXPRESSION and is not read as a number — but the selector is told from
//      the rest by the shape of that expression: it is the only blit whose destination x
//      multiplies something by 20, which is the slot pitch. Identification by use again.
//   5. The SLOT LOOP is the `bipush 9` + `if_icmpge` that bounds it. Its bytecode offset is what
//      makes the draw order a FACT rather than a reading: every blit offset is recorded, so a
//      check can assert `selector < slots` instead of trusting a sentence.
//
// ⚠ CLOSED IN BOTH DIRECTIONS: the number of blits found in the method is asserted, every one of
// them lands in the table, and the table's rects must be distinct — two rows with the same source
// rect would mean the constant-window reader had latched onto the wrong four pushes.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { requireJar } from './paths.mjs';

const MCLITE_ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT = join(MCLITE_ROOT, 'tools', 'golden', 'gui-1.18.2.tsv');

const say = (...a) => console.log(...a);
let failures = 0;
const ok = (c, m) => { if (!c) { failures++; say('   x ' + m); } };

if (process.argv.includes('--if-missing') && existsSync(OUT)) {
  say(' gui-1.18.2.tsv is present — nothing to do (--if-missing)');
  process.exit(0);
}

const JAR = requireJar('1.18.2');
try { execFileSync('javap', ['-version'], { stdio: 'ignore' }); }
catch { say('SKIP - no javap on this machine. Install a JDK, or keep the committed TSV.'); process.exit(0); }

say('extract-guigeom — the hotbar, out of the 1.18.2 client bytecode');

const work = mkdtempSync(join(tmpdir(), 'mclite-gui-'));
execFileSync('unzip', ['-o', '-q', JAR, '*.class', '-d', work]);

// ── 1. the GUI class, by use ──────────────────────────────────────────────────────────────────
// Every class whose constant pool carries the widgets texture path, narrowed by the one constant
// that can only be the hotbar: its width.
const withTex = execFileSync('bash', ['-c',
  'cd ' + JSON.stringify(work) + " && grep -rl 'gui/widgets' --include='*.class' . | sed 's|^\\./||; s|\\.class$||' | tr '/' '.'"],
  { maxBuffer: 1 << 26 }).toString().trim().split('\n').filter(Boolean);
say(' classes naming widgets.png ... ' + withTex.length + '  (' + withTex.join(' ') + ')');
ok(withTex.length >= 2 && withTex.length <= 12,
   withTex.length + ' classes mention widgets.png — that is not a GUI layer');

const dumpOf = (klass) =>
  execFileSync('javap', ['-p', '-c', '-cp', work, klass],
               { maxBuffer: 1 << 27, stdio: ['ignore', 'pipe', 'ignore'] })
    .toString().split('\n').filter((l) => !l.startsWith('Picked up'));

const dumps = withTex.map((k) => ({ klass: k, lines: dumpOf(k) }));

// ── 2. `blit`, BY DESCRIPTOR ──────────────────────────────────────────────────────────────────
// (PoseStack, int x, int y, int u, int v, int w, int h) -> void. The PoseStack type is whatever
// class fills that slot; it is reported rather than assumed, and it must be the same every time.
// ⚠ javap PRINTS NO OWNER for a method resolved on the class being disassembled or its
// superclass — `// Method b:(Ldtm;IIIIII)V`, not `// Method dzr.b:(...)`. The owner group is
// therefore OPTIONAL, and an unqualified one is recorded as `(self)`. The first version of this
// regex required the owner and matched nothing at all, which the "no blit anywhere" assertion
// caught rather than letting the table come out empty.
const BLIT_RE = /invokevirtual\s+#\d+\s+\/\/ Method (?:([\w./$]+)\.)?(\w+):\(L([\w/$]+);IIIIII\)V/;
const blitCount = new Map();
let POSE = null;
for (const l of dumps.flatMap((d) => d.lines)) {
  const m = l.match(BLIT_RE);
  if (!m) continue;
  const key = (m[1] || '(self)') + '.' + m[2];
  blitCount.set(key, (blitCount.get(key) || 0) + 1);
  if (POSE === null) POSE = m[3];
  ok(POSE === m[3], 'two different first-parameter types for the six-int blit: ' + POSE + ' vs ' + m[3]);
}
const BLIT = [...blitCount].sort((a, b) => b[1] - a[1])[0];
ok(!!BLIT, 'no (PoseStack,int x6)->void method is called anywhere in the Gui class');
if (!BLIT) { say('FAILED'); process.exit(1); }
say(' blit ......................... ' + BLIT[0] + '  (' + BLIT[1] + ' calls, PoseStack = ' + POSE + ')');
ok(BLIT[1] >= 10, 'only ' + BLIT[1] + ' blit calls across the GUI classes — that is not the whole HUD');

// ── 3. split the class into methods, keeping bytecode offsets ─────────────────────────────────
const CONST = (l) => {
  let m = l.match(/\biconst_(m1|[0-5])\b/); if (m) return m[1] === 'm1' ? -1 : +m[1];
  m = l.match(/\b(?:bipush|sipush)\s+(-?\d+)/); if (m) return +m[1];
  m = l.match(/\bldc(?:2?_w)?\s+#\d+\s+\/\/ int (-?\d+)/); if (m) return +m[1];
  return null;
};
const OFFSET = (l) => { const m = l.match(/^\s*(\d+):\s/); return m ? +m[1] : null; };

function methodsOf(lines) {
  const out = [];
  let cur = null;
  for (const l of lines) {
    const sig = l.match(/^\s{2}(?:\w+\s+)*[\w.$<>[\]]+\s+([\w<>$]+)\(([^)]*)\);?\s*$/);
    if (sig && !/^\s*\d+:/.test(l)) { cur = { name: sig[1], args: sig[2], body: [] }; out.push(cur); continue; }
    if (cur && OFFSET(l) !== null) cur.body.push(l);
  }
  return out;
}

// ── 4. renderHotbar: the method that blits (0, 0, 182, 22) ────────────────────────────────────
// ⚠ THE FOUR SOURCE CONSTANTS ARE THE FOUR PUSHES IMMEDIATELY BEFORE THE CALL. The destination x
// and y are arithmetic and are deliberately NOT read as numbers; the source rect always is.
function blitsIn(body) {
  const out = [];
  for (let i = 0; i < body.length; i++) {
    if (!BLIT_RE.test(body[i])) continue;
    const owner = body[i].match(BLIT_RE);
    if ((owner[1] || '(self)') + '.' + owner[2] !== BLIT[0]) continue;
    const c = [];
    for (let j = i - 1; j >= 0 && c.length < 4; j--) {
      const v = CONST(body[j]);
      if (v === null) break;              // a non-constant in the window: the rect is computed
      c.unshift(v);
    }
    // the instruction window since the previous blit, for telling the selector from the rest
    const prev = out.length ? out[out.length - 1].line : 0;
    const window = body.slice(prev, i).join('\n');
    out.push({
      line: i, offset: OFFSET(body[i]),
      rect: c.length === 4 ? c : null,
      byPitch: /bipush\s+20\b/.test(window) && /\bimul\b/.test(window)
    });
  }
  return out;
}

// ⚠ CLOSED: exactly ONE method in ONE of the candidate classes may blit that rect. Two would mean
// the rect is not the identifier it is claimed to be, and the choice between them would be taste.
const bars = [];
for (const d of dumps) {
  for (const m of methodsOf(d.lines)) {
    const b = blitsIn(m.body);
    if (b.some((x) => x.rect && x.rect[0] === 0 && x.rect[1] === 0 && x.rect[2] === 182 && x.rect[3] === 22)) {
      bars.push({ klass: d.klass, m: m, blits: b });
    }
  }
}
ok(bars.length === 2,
   bars.length + ' methods blit the 182x22 bar; the real hotbar and the spectator one should — ' +
   bars.map((f) => f.klass + '.' + f.m.name).join(' '));
const found = bars.filter((f) => f.blits.length >= 4);
ok(found.length === 1,
   found.length + ' of them blit four or more rects; only the real hotbar (which has an offhand) should');
if (found.length !== 1) { say('FAILED'); process.exit(1); }
const GUI = { klass: found[0].klass };
const hotbarM = found[0].m, hotbarBlits = found[0].blits;
const WITNESS = bars.find((f) => f !== found[0]);
say(' the Gui class ................ ' + GUI.klass);
say(' renderHotbar ................. ' + hotbarM.name + '(' + hotbarM.args + ')  ' +
    hotbarBlits.length + ' blits');
ok(hotbarBlits.length >= 3 && hotbarBlits.length <= 10,
   hotbarBlits.length + ' blits in renderHotbar — that is not the hotbar');
// ⚠ A COMPUTED SOURCE RECT IS A REAL THING AND IS NOT AN ERROR. The attack indicator's v offset
// depends on the cooldown, so its four pushes are not all constants. It is recorded as computed
// rather than guessed at, and rather than failing the run: **the table says what it knows.**
{
  const known = hotbarBlits.filter((b) => b.rect).length;
  ok(known >= 4, 'only ' + known + ' of ' + hotbarBlits.length +
     ' blits in renderHotbar have a readable source rect');
  say(' source rects ................. ' + known + ' constant, ' +
      (hotbarBlits.length - known) + ' computed');
}

// ── 5. the slot loop, whose offset is what makes the DRAW ORDER a fact ────────────────────────
// Vanilla's nine slots are a `for (m = 0; m < 9; ++m)` — a `bipush 9` compared with `if_icmpge`.
let slotLoop = -1;
for (let i = 0; i < hotbarM.body.length - 1; i++) {
  if (CONST(hotbarM.body[i]) === 9 && /\bif_icmpge\b/.test(hotbarM.body[i + 1])) {
    slotLoop = OFFSET(hotbarM.body[i]); break;
  }
}
ok(slotLoop >= 0, 'no `9 / if_icmpge` in renderHotbar — the nine-slot loop was not found');

// the constants inside the loop body place the item in its slot
const loopConsts = [];
{
  let started = false;
  for (const l of hotbarM.body) {
    const o = OFFSET(l);
    if (o === slotLoop) started = true;
    if (!started) continue;
    if (/\bgoto\b/.test(l)) break;
    const v = CONST(l);
    if (v !== null && v !== 9) loopConsts.push(v);
  }
}
say(' slot loop .................... offset ' + slotLoop + ', constants [' + loopConsts.join(' ') + ']');

// ── 6. name the rows, by use ──────────────────────────────────────────────────────────────────
let off = 0, unk = 0, ind = 0;
const rows = hotbarBlits.map((b, i) => {
  if (!b.rect) {
    return { name: 'computed_' + (++unk), order: i, offset: b.offset, u: '-', v: '-', w: '-', h: '-' };
  }
  // ⚠ `byPitch` ALONE IS NOT ENOUGH, and the reason is instructive: the window it looks at runs
  // from the previous blit, so for anything drawn AFTER the nine-slot loop that window contains
  // the loop's own `bipush 20; imul` and every later blit looks like the selector. The selector
  // is the pitched blit that comes BEFORE the loop — which is the very property being recorded.
  let name;
  if (b.rect[2] === 182) name = 'hotbar';
  else if (b.byPitch && b.offset < slotLoop) name = 'selector';
  else if (b.rect[2] === 29) name = 'offhand_' + (++off);   // the two 29-wide offhand frames
  else if (b.rect[2] === 18) name = 'attack_indicator_' + (++ind);
  else name = 'blit_' + i;
  return { name, order: i, offset: b.offset, u: b.rect[0], v: b.rect[1], w: b.rect[2], h: b.rect[3] };
});
ok(rows.filter((r) => r.name === 'hotbar').length === 1, 'not exactly one 182-wide blit');
ok(rows.filter((r) => r.name === 'selector').length === 1,
   'not exactly one blit whose destination steps by the 20px slot pitch');
ok(rows.filter((r) => r.name.startsWith('offhand_')).length === 2,
   'not exactly two 29-wide offhand frames');
const sel = rows.find((r) => r.name === 'selector');
const bar = rows.find((r) => r.name === 'hotbar');
// ⚠ THE SECOND WITNESS. The spectator bar blits the same selection sprite from its own call site
// in its own class; if the two ever disagreed, one of the two readings would be wrong and there
// would be no way to tell which. They agree, so the rect is a fact about the jar.
{
  const wsel = WITNESS.blits.map((b) => b.rect).filter((r) => r && r[2] === sel.w && r[1] === sel.v && r[0] === sel.u);
  ok(wsel.length >= 1,
     'the spectator hotbar does not blit the selection sprite at all — the witness is not a witness');
  ok(wsel.every((r) => r[3] === sel.h),
     'the spectator hotbar blits the selection sprite ' + wsel.map((r) => r[2] + 'x' + r[3]).join('/') +
     ' where the real one blits ' + sel.w + 'x' + sel.h + ' — the two call sites disagree');
  say(' second witness ............... ' + WITNESS.klass + '.' + WITNESS.m.name +
      ' blits the frame ' + wsel[0][2] + 'x' + wsel[0][3] + ' — agrees');
}
ok(bar.order < sel.order, 'the bar is not blitted before the selector');
ok(sel.offset < slotLoop, 'the selector is not blitted before the nine-slot loop');
// distinct rects: two identical ones would mean the constant window latched onto the wrong pushes
{
  const known = rows.filter((r) => r.w !== '-');
  const seen = new Set(known.map((r) => r.u + ',' + r.v + ',' + r.w + ',' + r.h));
  ok(seen.size === known.length, 'two blits share a source rect — the constant window is wrong');
}

// ── 7. the table ──────────────────────────────────────────────────────────────────────────────
// ⚠ ORDER IS BYTECODE ORDER, INCLUDING THE LOOP. The loop is not last — it sits between the
// offhand frames and the attack indicator — so a row's `order` is assigned by sorting everything
// the method does by its offset, not by the order the blits happened to be collected in.
const all = rows.concat([{ kind: 'loop', name: 'slots', u: '-', v: '-', w: '-', h: '-', offset: slotLoop }])
  .sort((a, b) => a.offset - b.offset);
all.forEach((r, i) => { r.order = i; });

const lines = [
  '# gui-1.18.2.tsv — the hotbar, read out of the 1.18.2 client bytecode by tools/extract-guigeom.mjs',
  '# Gui = ' + GUI.klass + '   blit = ' + BLIT[0] + '   renderHotbar = ' + hotbarM.name,
  '# ⚠ `order` and `offset` are the DRAW ORDER. The selector is blitted BEFORE the nine slots;',
  '#   drawing it after paints the frame over the selected slot\'s item and nothing else.',
  '# ⚠ `h` for the selector is 22, not 24: widgets.png\'s sprite is 24 rows and vanilla draws 22.',
  'kind\tname\tu\tv\tw\th\torder\toffset',
  ...all.map((r) => [r.kind || 'blit', r.name, r.u, r.v, r.w, r.h, r.order, r.offset].join('\t')),
  ['consts', 'slotloop', loopConsts.join(' '), '-', '-', '-', '-', '-'].join('\t'),
];
mkdirSync(join(MCLITE_ROOT, 'tools', 'golden'), { recursive: true });
writeFileSync(OUT, lines.join('\n') + '\n');

say('');
for (const r of all) say('   ' + r.name.padEnd(18) + ' u,v ' + String(r.u).padStart(3) + ',' + String(r.v).padStart(3) +
                          '  ' + String(r.w).padStart(3) + 'x' + String(r.h).padStart(3) +
                          '   order ' + r.order + '  offset ' + r.offset);
say('');
say(' -> ' + OUT.slice(MCLITE_ROOT.length));
if (failures) { say(' ' + failures + ' FAILURES'); process.exit(1); }
say(' 0 failures');
