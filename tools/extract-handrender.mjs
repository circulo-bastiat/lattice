#!/usr/bin/env node
// extract-handrender.mjs — THE FIRST-PERSON HAND, OUT OF THE CLIENT BYTECODE (D-359).
//
//   node tools/extract-handrender.mjs [--if-missing]  -> tools/golden/handrender-1.18.2.json
//
// ⚠⚠ WHY THIS EXISTS. Dan, 15 Sept 2026: *"items in your hand are still not even close to
// vanilla … theres no sway in the hand and hand models like the real game."* He was right, and
// the reason is structural: until tonight the held item was a **software-rasterised sprite
// blitted onto the 2D HUD canvas** (D-273, D-311, D-320). A flat blit cannot rotate in depth, so
// no amount of tuning could have made it the real thing. The replacement draws the item as real
// geometry through vanilla's own transform stack — and every number in that stack comes from
// here rather than from anybody's memory.
//
// ── HOW THE TWO CLASSES ARE IDENTIFIED, AND WHY IT CANNOT BE A COINCIDENCE ──────────────────
// The client jar is obfuscated: `ItemInHandRenderer` is `eqo` in 1.18.2 and will be something
// else in any other version. **Nothing here is read by name.** A class is found by the FLOAT
// CONSTANTS in its own constant pool, which survive obfuscation exactly because they are data:
//
//   1. `ItemInHandRenderer` is the ONE class in 6,352 that holds {0.56, -0.52, -0.72} — the hand
//      position from `applyItemArmTransform`. It is confirmed twice over by two more disjoint
//      fingerprints from two other methods in the same class: {0.64000005, -0.71999997} from
//      `renderPlayerArm`, and {5.6, 3.6, -135.0} from its skin-model tail. Three independent
//      hits on one class is not a coincidence; one hit might be.
//   2. `GameRenderer` is found by **8000.0f**, which occurs in exactly two classes in the jar and
//      in only one of those beside 40.0 and 200.0 — `bobHurt`'s death-tilt `40 - 8000/(t+200)`.
//      The tie is broken by the requirement that the class REFERENCE the class found in step 1.
//
// ── WHAT IS EXTRACTED ───────────────────────────────────────────────────────────────────────
// For each method of interest, the ORDERED SEQUENCE OF FLOAT/DOUBLE LITERALS in its bytecode.
// That sequence is a fingerprint of the arithmetic itself: `applyItemArmAttackTransform` is
// 3.1415927, 45.0, -20.0, 3.1415927, -20.0, -80.0, -45.0 and nothing else can be. The engine's
// own constants are asserted against this file by `tools/handposecheck.mjs`, so a typo in the
// port fails the suite rather than looking slightly wrong on screen.
//
// ⚠ THE METHODS ARE FOUND BY DESCRIPTOR AND BY LITERAL SET, NOT BY NAME — every method in the
// class is called `a` or `b`. `applyItemArmTransform` is "the `(PoseStack, HumanoidArm, float)`
// whose literals are exactly {0.56, -0.52, -0.6, -0.72}"; its sibling with the same descriptor
// and a different set is `applyItemArmAttackTransform`. Both are asserted to be unique.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { requireJar } from './paths.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT = join(ROOT, 'tools', 'golden', 'handrender-1.18.2.json');

const say = (...a) => console.log(...a);
let failures = 0;
const ok = (c, m) => { if (c) say('   ok ' + m); else { failures++; say('   x  ' + m); } return c; };

if (process.argv.includes('--if-missing') && existsSync(OUT)) {
  say(' handrender-1.18.2.json is present — nothing to do (--if-missing)');
  process.exit(0);
}

// ── the constant pool, read directly ────────────────────────────────────────────────────────
// ⚠ A `.class` FILE'S CONSTANT POOL IS WALKED, NOT SCANNED. Searching the raw bytes for an IEEE
// word finds it inside a UTF-8 string or an unrelated long as often as not; the pool has a
// declared layout and walking it is twenty lines.
function poolFloats(buf) {
  const out = new Set();
  if (buf.length < 10 || buf.readUInt32BE(0) !== 0xCAFEBABE) return out;
  const count = buf.readUInt16BE(8);
  let p = 10;
  for (let i = 1; i < count; i++) {
    const tag = buf[p];
    switch (tag) {
      case 1: p += 3 + buf.readUInt16BE(p + 1); break;                    // Utf8
      case 7: case 8: case 16: case 19: case 20: p += 3; break;
      case 15: p += 4; break;
      case 3: p += 5; break;                                              // Integer
      case 4: out.add(buf.readFloatBE(p + 1)); p += 5; break;             // Float
      case 5: p += 9; i++; break;                                         // Long — two slots
      case 6: out.add(buf.readDoubleBE(p + 1)); p += 9; i++; break;       // Double — two slots
      case 9: case 10: case 11: case 12: case 17: case 18: p += 5; break;
      default: return out;                                                // unknown: stop, safely
    }
  }
  return out;
}

const near = (a, b) => Math.abs(a - b) < 1e-5;
const hasAll = (set, wanted) => wanted.every((w) => [...set].some((v) => near(v, w)));

// ── unpack the client jar's classes once ────────────────────────────────────────────────────
const jar = requireJar('1.18.2');
const tmp = mkdtempSync(join(tmpdir(), 'mclite-hand-'));
execFileSync('unzip', ['-oq', jar, '*.class', '-d', tmp], { stdio: 'ignore' });
const classes = readdirSync(tmp).filter((f) => f.endsWith('.class'));
say(` ${classes.length} classes unpacked from ${jar}`);
ok(classes.length > 4000, `the jar really is the client (${classes.length} classes; a server jar has far fewer)`);

const pools = new Map();
for (const f of classes) {
  try { pools.set(f, poolFloats(readFileSync(join(tmp, f)))); } catch { /* not a class we can read */ }
}

const withAll = (wanted) => classes.filter((f) => pools.has(f) && hasAll(pools.get(f), wanted));

// ── 1. ItemInHandRenderer, by three disjoint fingerprints ───────────────────────────────────
const fpArm   = withAll([0.56, -0.52, -0.72]);
const fpPlayer = withAll([0.64000005, -0.71999997]);
const fpSkin  = withAll([5.6, 3.6, -135.0]);
ok(fpArm.length === 1, `exactly one class holds {0.56, -0.52, -0.72} (${fpArm.join(',') || 'none'})`);
ok(fpPlayer.length === 1 && fpPlayer[0] === fpArm[0],
   `the same class holds {0.64000005, -0.71999997} — the second independent fingerprint`);
ok(fpSkin.length === 1 && fpSkin[0] === fpArm[0],
   `and {5.6, 3.6, -135.0} — the third, from the skin-model tail`);
const IIHR = fpArm[0];

// ── 2. GameRenderer, by 8000.0 and by referencing the class above ───────────────────────────
const fpBob = withAll([8000.0, 40.0, 200.0]);
ok(fpBob.length >= 1, `at least one class holds bobHurt's {8000, 40, 200} (${fpBob.join(',')})`);
const refs = fpBob.filter((f) => readFileSync(join(tmp, f)).includes(Buffer.from(IIHR.replace('.class', ''), 'latin1')));
ok(refs.length === 1, `exactly one of them names ${IIHR} in its own pool — that is GameRenderer (${refs.join(',') || 'none'})`);
const GR = refs[0] || fpBob[0];
say(` ItemInHandRenderer = ${IIHR}   GameRenderer = ${GR}`);

// ── 3. javap, and the literal sequence of each method ───────────────────────────────────────
const dis = (cls) => execFileSync('javap', ['-p', '-c', join(tmp, cls)],
  { encoding: 'utf8', maxBuffer: 64 << 20, stdio: ['ignore', 'pipe', 'ignore'] });

/** Split a javap dump into [{ sig, lines }] — one entry per method, in file order. */
function methods(text) {
  const out = [];
  let cur = null;
  for (const line of text.split('\n')) {
    const m = /^ {2}(?:public |private |protected |static |final |abstract |synchronized )*[\w.$<>[\]]+[\s(].*\(.*\);\s*$/.exec(line);
    if (m) { cur = { sig: line.trim(), lines: [] }; out.push(cur); continue; }
    if (/^ {2}(?:public |private |protected |static )*\S.*\(.*\);\s*$/.test(line)) {
      cur = { sig: line.trim(), lines: [] }; out.push(cur); continue;
    }
    if (cur) cur.lines.push(line);
  }
  return out;
}

/** Every float/double literal a method loads, in bytecode order. */
function literals(mth) {
  const out = [];
  for (const line of mth.lines) {
    const m = /\/\/\s+(float|double)\s+(-?[\d.E]+)[df]?\s*$/.exec(line);
    if (m) out.push(Math.round(parseFloat(m[2]) * 1e6) / 1e6);
    else if (/\bfconst_0\b/.test(line)) out.push(0);
    else if (/\bfconst_1\b/.test(line)) out.push(1);
    else if (/\bfconst_2\b/.test(line)) out.push(2);
    else if (/\bdconst_0\b/.test(line)) out.push(0);
    else if (/\bdconst_1\b/.test(line)) out.push(1);
  }
  return out;
}

const iihr = methods(dis(IIHR));
const gr = methods(dis(GR));
ok(iihr.length > 10, `${IIHR} disassembled into ${iihr.length} methods`);
ok(gr.length > 10, `${GR} disassembled into ${gr.length} methods`);

/**
 * The one method whose literal SET is exactly `want` (order-free), among those matching `sigRe`.
 * ⚠ IT MUST BE UNIQUE. A "first match" here is how an extractor silently reads the wrong method
 * in the next version; uniqueness is the only claim worth making about an obfuscated name.
 */
function only(list, sigRe, want, label, extra) {
  const hits = list.filter((m) => sigRe.test(m.sig)).filter((m) => {
    const lit = literals(m);
    const set = new Set(lit);
    if (!want.every((w) => [...set].some((v) => near(v, w)))) return false;
    return extra ? extra(lit, m) : true;
  });
  ok(hits.length === 1, `${label}: exactly one method matches (${hits.length})`);
  return hits[0] || null;
}

const armTransform = only(iihr, /\(dtm|\(.*PoseStack/, [0.56, -0.52, -0.6, -0.72], 'applyItemArmTransform');
const attackTransform = only(iihr, /\(dtm|\(.*PoseStack/, [45.0, -20.0, -80.0, -45.0], 'applyItemArmAttackTransform');
const playerArm = only(iihr, /\(dtm|\(.*PoseStack/, [-0.3, 0.4, -0.4, 0.64000005, -0.71999997, 70.0, 120.0, 200.0, -135.0, 5.6],
                       'renderPlayerArm');
// ⚠ `{0.1, 0.1}` ALONE MATCHES TWO PUBLIC METHODS — this one and `tick()`, which happens to
// carry two 0.1s of its own (the item-swap threshold, twice, for the two hands). The pair that
// separates them is the SHAPE: this one takes the partial tick first and lags BOTH look axes by
// 0.1; `tick()` takes nothing at all. Both halves are required, so neither can drift onto the
// other in a future version.
const handsWithItems = only(iihr, /^public void \w+\(float,/, [0.1], 'renderHandsWithItems',
  (lit) => lit.filter((v) => near(v, 0.1)).length === 2);
const tick = only(iihr, /^public void a\(\);|^public void tick\(\);/, [0.4, 0.1], 'ItemInHandRenderer.tick');
const bobHurt = only(gr, /\(dtm|\(.*PoseStack/, [8000.0, 40.0, 200.0, 14.0], 'bobHurt');
const bobView = only(gr, /\(dtm|\(.*PoseStack/, [0.5, 3.0, 0.2, 5.0], 'bobView');

// ── 4. the anchors: the numbers that cannot be wrong ────────────────────────────────────────
// ⚠ EACH ONE IS A CASE THAT CANNOT BE IN DOUBT, in the style of `extract-itemattrs.mjs`. A
// sequence that merely "looks plausible" is what an extractor is for avoiding.
const seq = (m) => (m ? literals(m) : []);
const L = {
  armTransform: seq(armTransform),
  attackTransform: seq(attackTransform),
  playerArm: seq(playerArm),
  handsWithItems: seq(handsWithItems),
  tick: seq(tick),
  bobHurt: seq(bobHurt),
  bobView: seq(bobView),
};

const has = (a, ...v) => v.every((x) => a.some((y) => near(y, x)));
ok(has(L.armTransform, 0.56, -0.52, -0.6, -0.72) && L.armTransform.length <= 6,
   `applyItemArmTransform is exactly the four numbers of a hand position [${L.armTransform}]`);
ok(L.attackTransform.filter((v) => near(v, -20)).length === 2,
   'applyItemArmAttackTransform uses -20 TWICE — once on Y with the 45, once on Z (a clone that uses it once is half a swing)');
ok(has(L.attackTransform, 45, -45, -80),
   `the swing rotates +45 then -45 about Y with -80 about X between them [${L.attackTransform}]`);
ok(has(L.playerArm, 0.64000005, -0.6, -0.71999997, 45, 70, -20, 120, 200, -135, 5.6),
   'renderPlayerArm carries the arm placement AND the skin-model tail');
ok(has(L.bobView, 0.5, 3.0, 0.2, 5.0) && !has(L.bobView, 8000),
   `bobView is the walk bob and nothing else [${L.bobView}]`);
ok(has(L.bobHurt, 40, 8000, 200, 14),
   `bobHurt carries the death tilt AND the 14-degree hurt roll [${L.bobHurt}]`);
ok(has(L.tick, 0.4, 0.1),
   `the equip animation steps by 0.4 a tick and swaps the item below 0.1 [${L.tick}]`);
ok(has(L.handsWithItems, 0.1),
   `renderHandsWithItems lags the hand behind the camera by 0.1 of the look delta [${L.handsWithItems}]`);

// ── 5. write it ─────────────────────────────────────────────────────────────────────────────
mkdirSync(join(ROOT, 'tools', 'golden'), { recursive: true });
const payload = {
  note: 'GENERATED by tools/extract-handrender.mjs from the 1.18.2 CLIENT jar. Do not hand-edit.',
  version: '1.18.2',
  classes: { itemInHandRenderer: IIHR, gameRenderer: GR },
  // the ordered literal sequence of each method — the fingerprint of its arithmetic
  literals: L,
  // and the named constants the engine ports, each one asserted above
  constants: {
    HAND_X: 0.56, HAND_Y: -0.52, HAND_EQUIP_Y: -0.6, HAND_Z: -0.72,
    SWING_Y_BASE: 45.0, SWING_Y_SWING: -20.0, SWING_Z: -20.0, SWING_X: -80.0, SWING_Y_BACK: -45.0,
    ITEM_SWING_X: -0.4, ITEM_SWING_Y: 0.2, ITEM_SWING_Z: -0.2,
    ARM_X: 0.64000005, ARM_Y: -0.6, ARM_Z: -0.71999997,
    ARM_SWING_X: -0.3, ARM_SWING_Y: 0.4, ARM_SWING_Z: -0.4,
    ARM_ROT_Y: 45.0, ARM_SWING_ROT_Y: 70.0, ARM_SWING_ROT_Z: -20.0,
    EQUIP_STEP: 0.4, EQUIP_SWAP_BELOW: 0.1,
    BOB_TRANSLATE: 0.5, BOB_ROLL: 3.0, BOB_PITCH_PHASE: 0.2, BOB_PITCH: 5.0,
    HURT_ROLL: 14.0, DEATH_TILT_A: 40.0, DEATH_TILT_B: 8000.0, DEATH_TILT_C: 200.0,
    HAND_LOOK_LAG: 0.1,
  },
};
writeFileSync(OUT, JSON.stringify(payload, null, 2) + '\n');
say('');
say('=========== extract-handrender ===========');
say(` ItemInHandRenderer ... ${IIHR}`);
say(` GameRenderer ......... ${GR}`);
say(` methods pinned ....... ${Object.values(L).filter((a) => a.length).length} of 7`);
say(` written .............. ${OUT.replace(ROOT, '')}`);
say(` failures ............. ${failures}`);
say('==========================================');
process.exit(failures ? 1 : 0);
