#!/usr/bin/env node
// guicheck.mjs — PLAN G11. Every GUI rectangle, asserted against vanilla's own pixels (D-274).
//
//   node tools/guicheck.mjs [--quiet]
//
// ⚠ THIS FILE EXISTS BECAUSE A BLIT COORDINATE THAT DRIFTED WOULD DRAW A PLAUSIBLE WRONG ICON
// FOR EVER. `src/15b_gui.js` names about twenty rectangles into two 256x256 sheets. Everything
// else in this project is derived from the jar and asserted in both directions; those numbers are
// typed. A heart rectangle that is nine pixels off draws the BLINKING heart background instead of
// the plain one, which looks like a heart, is a heart, and is the wrong heart — and no build, no
// screenshot glance and no behavioural check would ever say so.
//
// So the rule here is: name a rectangle, then say what must be TRUE of the pixels inside it —
// the full heart is red, the empty container is dark, the half heart is inked on its left and
// clear on its right, hunger is brown, the XP bar's two rows differ, the selector is a hollow
// frame. Those are properties of the artwork, not of the coordinates, so a check that passes is
// evidence the coordinates point at the right thing rather than evidence they are unchanged.
//
// ⚠ AND THE 46 SLOTS ARE CHECKED THE SAME WAY. `G.slotXY` is the inventory screen's whole layout.
// Vanilla's slot interior is a flat #8B8B8B with a #373737 shadow at its top-left corner, so
// every one of the 46 slots must land on that pair. A slot table off by a row lands on the panel
// and fails; that is the bug that puts a helmet where a chest should be.

import { readFileSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const QUIET = process.argv.includes('--quiet');

let pass = 0, breaks = 0;
const fails = [];
const ok = (c, m) => { if (c) pass++; else if (fails.length < 40) fails.push(m); return c; };
const okAv = (c, m) => { breaks++; if (c) { pass++; if (!QUIET) console.log('   ✓ ' + m); } else fails.push('anti-vacuity: ' + m); };
const say = (...a) => { if (!QUIET) console.log(...a); };

// ── the module's own rectangles, loaded from source so the check reads what the game reads ──
const NS = {};
globalThis.MCL = NS;
new Function('MCL', readFileSync(join(ROOT, 'src', '15b_gui.js'), 'utf8'))(NS);
const G = NS.Gui;

// ── the blob, decoded here rather than through canvas (this is node) ─────────────────────────
const blob = inflateRawSync(readFileSync(join(ROOT, 'assets', 'gui.bin')));
const hlen = blob.readUInt32LE(0);
const head = JSON.parse(blob.slice(4, 4 + hlen).toString('utf8'));
const base = 4 + hlen;
const sheet = Object.create(null);
for (const s of head.sheets) sheet[s.n] = { w: s.w, h: s.h, off: base + s.o, len: s.len };

/** One texel as [r,g,b,a]. */
function px(name, x, y) {
  const s = sheet[name];
  if (!s || x < 0 || y < 0 || x >= s.w || y >= s.h) return [0, 0, 0, 0];
  const i = s.off + (y * s.w + x) * 4;
  return [blob[i], blob[i + 1], blob[i + 2], blob[i + 3]];
}
/** The mean colour of the opaque texels of a rectangle, and how many there were. */
function meanOf(name, r) {
  let n = 0, R = 0, Gc = 0, B = 0;
  for (let y = r[1]; y < r[1] + r[3]; y++) {
    for (let x = r[0]; x < r[0] + r[2]; x++) {
      const p = px(name, x, y);
      if (p[3] < 128) continue;
      n++; R += p[0]; Gc += p[1]; B += p[2];
    }
  }
  return n ? { n, r: R / n, g: Gc / n, b: B / n } : { n: 0, r: 0, g: 0, b: 0 };
}
const inked = (name, r) => meanOf(name, r).n;
/** The horizontal centroid of a rectangle's opaque texels — which half of the icon is drawn. */
function centroidX(name, r) {
  let n = 0, sx = 0;
  for (let y = r[1]; y < r[1] + r[3]; y++) {
    for (let x = r[0]; x < r[0] + r[2]; x++) {
      if (px(name, x, y)[3] >= 128) { n++; sx += x - r[0]; }
    }
  }
  return n ? sx / n : -1;
}
const show = (m) => `rgb(${m.r.toFixed(0)},${m.g.toFixed(0)},${m.b.toFixed(0)}) over ${m.n}px`;

console.log('guicheck — PLAN G11, every GUI rectangle against vanilla\'s pixels (D-274)');

// ═══════════ 1. the payload ═══════════════════════════════════════════════════════════════
say('\n1. the payload');
// ⚠ THE COUNT IS READ OUT OF THE GENERATOR, NOT TYPED HERE. This line said `=== 8` and went red
// the day G16b added `sun` and `moon_phases` — a check that hard-codes a number the code owns has
// to be edited every time the code is right, which is the mistake D-263 names and `g14check` made
// with the save envelope in the same session. `build-gui.mjs` owns the list; this asserts the
// shipped blob against it, in BOTH directions, so an added sheet passes and a DROPPED one fails.
const LITERAL = [...readFileSync(join(ROOT, 'tools', 'build-gui.mjs'), 'utf8')
  .matchAll(/^\s*\['([a-z0-9_]+)',\s*'assets\/minecraft\/textures\//gm)].map((m) => m[1]);
ok(LITERAL.length >= 8, `build-gui.mjs declares ${LITERAL.length} sheets literally — the parse works`);
// ⚠ AND THE THIRTY-TWO IT DECLARES IN A LOOP. G10c added a bed and a shulker-box texture per DYE
// COLOUR, pushed onto the table rather than typed into it, and a static parse of the literal
// array saw none of them — so this check went red against a build that was correct. The loop's
// list is re-derived here from the SAME INDEPENDENT SOURCE build-gui reads, the bytecode's own
// dye table, rather than by re-parsing the loop: a check that parsed the generator's control
// flow would agree with it about its bugs.
const DYES = [...readFileSync(join(ROOT, 'tools', 'golden', 'dye-colours-1.18.2.tsv'), 'utf8')
  .split(/\r?\n/)].filter((l) => l && !l.startsWith('#')).map((l) => l.split('\t')[0]).filter(Boolean);
ok(DYES.length === 16, `the dye table names ${DYES.length} colours`);
const BANNERS = readFileSync(join(ROOT, 'tools', 'golden', 'banner-patterns-1.18.2.tsv'), 'utf8')
  .split(/\r?\n/).filter((l) => l && !l.startsWith('#')).map((l) => l.split('\t')).filter((c) => c[0] && c[2] === '1').map((c) => c[0]);
const WANT = LITERAL.concat(DYES.map((d) => 'be_' + d + '_bed'))
                    .concat(DYES.map((d) => 'be_' + d + '_shulker_box'))
                    .concat(BANNERS.map((n) => 'bp_' + n)).concat(BANNERS.map((n) => 'sp_' + n))
                    .concat(['be_shield_base'])   // #891/#892: pushed from the banner-pattern table, not literal rows
                    .concat(['grindstone', 'stonecutter', 'mob_effects']);   // #8055 stonecutter likewise. #197: pushed from the 1.18.2 jar (no 1.13.2 sheet), not a literal row
ok(head.sheets.length === WANT.length,
   `${head.sheets.length} sheets shipped, and build-gui.mjs declares ${WANT.length} (D-278, D-304, D-317)`);
for (const n of WANT) ok(!!sheet[n], `the ${n} sheet is present`);
for (const s of head.sheets) ok(WANT.indexOf(s.n) >= 0, `the shipped sheet ${s.n} is one build-gui declares`);
// ⚠ the per-colour sheets must actually DIFFER — sixteen references to one file would ship,
// decode and pass every count above, and give sixteen identical beds.
{
  const sigOf = (n) => {
    const sh = sheet[n];
    if (!sh) return -1;
    let h = 2166136261;
    for (let i = 0; i < sh.w * sh.h * 4; i += 17) h = Math.imul(h ^ blob[sh.off + i], 16777619);
    return h >>> 0;
  };
  const bedSigs = new Set(DYES.map((d) => sigOf('be_' + d + '_bed')));
  ok(bedSigs.size === 16, `the sixteen bed textures are ${bedSigs.size} different pictures`);
  const shulkSigs = new Set(DYES.map((d) => sigOf('be_' + d + '_shulker_box')));
  ok(shulkSigs.size === 16, `the sixteen shulker textures are ${shulkSigs.size} different pictures`);
}
for (const n of ['widgets', 'icons', 'inventory', 'crafting_table', 'furnace', 'generic_54']) {
  ok(sheet[n].w === 256 && sheet[n].h === 256, `${n} is 256x256, got ${sheet[n].w}x${sheet[n].h}`);
}
ok(sheet.ascii.w === 128 && sheet.ascii.h === 128, 'the font sheet is 128x128');
ok(head.cell === 8, 'the glyph cell is 8px');
ok(G.init && G.INV && G.ICON && G.WIDGET, 'the module exposes its rectangles');

// ═══════════ 2. icons.png — the survival readout ══════════════════════════════════════════
// ⚠ Each of these says what the ARTWORK is, not what the numbers are.
say('\n2. icons.png');
const IC = G.ICON;
{
  const full = meanOf('icons', IC.heartFull);
  say('   heartFull ....... ' + show(full));
  // ⚠ 34 TEXELS, NOT 81. The full heart is the RED FILL ONLY — vanilla draws it on top of the
  // container, which supplies the outline — so a "most of the 9x9 is inked" threshold is wrong
  // about the artwork. Measured: 34 of 81.
  ok(full.n >= 25 && full.n <= 45, `the full heart is the fill shape alone — ${full.n} opaque texels of 81`);
  ok(full.r > 180 && full.r > full.g * 2.5 && full.r > full.b * 2.5,
    `the full heart is RED — measured ${show(full)}`);

  const bg = meanOf('icons', IC.heartBg);
  say('   heartBg ......... ' + show(bg));
  ok(bg.n >= 45, `the empty heart container is the larger shape — ${bg.n} texels, more than the fill's ${full.n}`);
  ok(bg.n > full.n, 'the container really is bigger than the fill it frames');
  ok(bg.r < 90 && Math.abs(bg.r - bg.g) < 12 && Math.abs(bg.g - bg.b) < 12,
    `the empty container is DARK and unsaturated — measured ${show(bg)}`);
  ok(full.r - bg.r > 100, 'and the two are nothing like each other');

  // ⚠ the blinking background is a DIFFERENT rectangle nine pixels along, and picking it by
  // accident is exactly the drift this file is here to catch: it is also a heart container.
  const blink = meanOf('icons', IC.heartBgBlink);
  say('   heartBgBlink .... ' + show(blink));
  ok(blink.n >= 45, `the blinking container is inked too — ${blink.n} texels`);
  ok(Math.abs(blink.r - bg.r) + Math.abs(blink.g - bg.g) + Math.abs(blink.b - bg.b) > 12,
    `the blinking container differs from the plain one — plain ${show(bg)}, blink ${show(blink)}`);

  // ⚠ THE HALF HEART KEEPS ITS LEFT. Measured: columns 1..4 inked, 5..8 completely clear, and
  // the centroid moves from 4.00 to 2.75. This is the direction a heart empties in, and it is the
  // opposite of the hunger row below — which is why both are measured rather than assumed.
  const hHalfR = [IC.heartHalf[0] + 5, IC.heartHalf[1], 4, 9];
  const hcF = centroidX('icons', IC.heartFull), hcH = centroidX('icons', IC.heartHalf);
  const half = meanOf('icons', IC.heartHalf);
  say(`   heartHalf ....... ${half.n}px, centroid ${hcH.toFixed(2)} vs full ${hcF.toFixed(2)}`);
  ok(inked('icons', hHalfR) === 0, 'the half heart is completely clear to the right of centre');
  ok(half.n > 10 && half.n < full.n, `and it is a strict subset of the full one — ${half.n} of ${full.n}`);
  ok(hcH < hcF - 0.8, `its ink sits LEFT of the full heart's — ${hcH.toFixed(2)} vs ${hcF.toFixed(2)}`);

  const hunger = meanOf('icons', IC.hungerFull);
  say('   hungerFull ...... ' + show(hunger));
  // ⚠ 20 TEXELS. Same reason as the heart: this is the drumstick's fill, over its container.
  ok(hunger.n >= 15 && hunger.n <= 30, `the hunger icon is the fill alone — ${hunger.n} texels of 81`);
  ok(hunger.r > hunger.g && hunger.g > hunger.b && hunger.r > 110 && hunger.b < 130,
    `hunger is BROWN — r > g > b, measured ${show(hunger)}`);
  ok(!(hunger.r > hunger.g * 2.5), 'and brown is not red — it must not be the heart rectangle');

  // ⚠ AND THE HUNGER ICON EMPTIES THE OTHER WAY. It is NOT a clean right half — the drumstick's
  // bone runs to the bottom-right corner in both icons, so a "left columns must be clear" test is
  // simply false about the artwork. What is true, and measured: the half has strictly less ink
  // (14 of 20) and its centroid moves RIGHT, 3.45 -> 4.14, where the heart's moved left.
  const ucF = centroidX('icons', IC.hungerFull), ucH = centroidX('icons', IC.hungerHalf);
  const uHalf = meanOf('icons', IC.hungerHalf);
  say(`   hungerHalf ...... ${uHalf.n}px, centroid ${ucH.toFixed(2)} vs full ${ucF.toFixed(2)}`);
  ok(uHalf.n > 8 && uHalf.n < hunger.n, `the half drumstick is a strict subset — ${uHalf.n} of ${hunger.n}`);
  ok(ucH > ucF + 0.3, `its ink sits RIGHT of the full one's — ${ucH.toFixed(2)} vs ${ucF.toFixed(2)}`);
  ok((hcH - hcF) < 0 && (ucH - ucF) > 0,
    'the heart empties leftward and the hunger icon rightward — opposite, which is why the rows mirror');

  const aF = meanOf('icons', IC.armourFull), aE = meanOf('icons', IC.armourEmpty), aH = meanOf('icons', IC.armourHalf);
  say('   armour .......... full ' + show(aF) + ' | half ' + show(aH) + ' | empty ' + show(aE));
  ok(aF.n > 20 && aE.n > 20 && aH.n > 20, 'all three armour icons are inked');
  ok(aF.r > aE.r + 60, 'the full chestplate is much lighter than the empty one');
  ok(Math.abs(aF.r - aF.g) < 25 && Math.abs(aF.g - aF.b) < 25, 'and it is steel, not red or brown');
  ok(aH.r > aE.r && aH.r < aF.r, 'the half icon sits between them');

  const bF = meanOf('icons', IC.bubbleFull), bP = meanOf('icons', IC.bubblePop);
  ok(bF.n > 8 && bP.n > 8, 'both bubble icons are inked');
  ok(Math.abs(bF.n - bP.n) + Math.abs(bF.r - bP.r) > 2, 'and the popping one differs from the whole one');

  // the XP bar: two 182x5 rows that must NOT be the same pixels
  const xb = meanOf('icons', IC.xpBarBg), xf = meanOf('icons', IC.xpBarFg);
  say('   xpBar ........... bg ' + show(xb) + ' | fg ' + show(xf));
  ok(IC.xpBarBg[2] === 182 && IC.xpBarFg[2] === 182, 'both XP rows are 182 wide, the hotbar\'s width');
  ok(IC.xpBarFg[1] === IC.xpBarBg[1] + IC.xpBarBg[3], 'and the filled row is directly below the empty one');
  ok(xb.n > 400 && xf.n > 400, 'both rows are inked across their width');
  ok(xf.g > xb.g + 60, `the filled row is far brighter — bg ${show(xb)}, fg ${show(xf)}`);
  ok(xf.g > xf.r && xf.g > xf.b, 'and it is GREEN');
}

// ═══════════ 3. widgets.png — the hotbar, its selector, and the DRAW ORDER ════════════════
// ⚠⚠ **THIS SECTION USED TO ASSERT THE BUG** (D-329). It pinned `sel[3] === 24` — a number a
// human typed into a check, standing in for a fact the jar owns — and vanilla blits the frame
// **24 wide and 22 tall**. So for three sessions the check was green, the picture was wrong, and
// **the correct value would have failed the suite**. That is D-305's rule exactly, and it is the
// third time: never let a check own a number the code owns. Every rectangle here now comes out of
// `tools/golden/gui-1.18.2.tsv`, which `extract-guigeom.mjs` reads from the 1.18.2 bytecode.
say('\n3. widgets.png — against the bytecode\'s own table');
{
  const GEOM = new Map();
  let slotLoopOffset = -1, slotConsts = '';
  {
    const tsv = readFileSync(join(ROOT, 'tools', 'golden', 'gui-1.18.2.tsv'), 'utf8').split('\n');
    for (const line of tsv) {
      if (!line || line[0] === '#') continue;
      const f = line.split('\t');
      if (f[0] === 'kind') continue;
      if (f[0] === 'loop' && f[1] === 'slots') { slotLoopOffset = +f[7]; continue; }
      if (f[0] === 'consts' && f[1] === 'slotloop') { slotConsts = f[2]; continue; }
      if (f[0] !== 'blit' || f[2] === '-') continue;
      GEOM.set(f[1], { u: +f[2], v: +f[3], w: +f[4], h: +f[5], order: +f[6], offset: +f[7] });
    }
  }
  ok(GEOM.size >= 4, `only ${GEOM.size} rows in gui-1.18.2.tsv — run tools/extract-guigeom.mjs`);
  ok(slotLoopOffset > 0, 'gui-1.18.2.tsv has no slot-loop offset');

  const vHot = GEOM.get('hotbar'), vSel = GEOM.get('selector');
  ok(!!vHot && !!vSel, 'the golden table has no hotbar or no selector row');
  const hb = G.WIDGET.hotbar, sel = G.WIDGET.selector;
  say(`   hotbar .......... engine [${hb}]  vanilla [${vHot.u},${vHot.v},${vHot.w},${vHot.h}]`);
  say(`   selector ........ engine [${sel}]  vanilla [${vSel.u},${vSel.v},${vSel.w},${vSel.h}]`);
  ok(hb[0] === vHot.u && hb[1] === vHot.v && hb[2] === vHot.w && hb[3] === vHot.h,
     `the hotbar rect is [${hb}] and vanilla blits [${vHot.u},${vHot.v},${vHot.w},${vHot.h}]`);
  ok(sel[0] === vSel.u && sel[1] === vSel.v && sel[2] === vSel.w && sel[3] === vSel.h,
     `the selector rect is [${sel}] and vanilla blits [${vSel.u},${vSel.v},${vSel.w},${vSel.h}]`);

  ok(inked('widgets', hb) === vHot.w * vHot.h, 'the hotbar rectangle is fully opaque');
  // the selector is a FRAME: its border is inked and its middle is not
  const mid = [sel[0] + 8, sel[1] + 8, 8, 8];
  say(`   selector ........ border inked, centre ${inked('widgets', mid)}px`);
  ok(inked('widgets', mid) === 0, 'the selector\'s centre is transparent — it is a frame, not a box');
  ok(inked('widgets', [sel[0], sel[1], vSel.w, 1]) === vSel.w, 'and its top edge is solid');

  // ⚠⚠ **THE DRAW ORDER IS PART OF THE PICTURE.** Dan: *"blocks in selected slot of hotbar do not
  // look cortrect at all"*. The frame was blitted AFTER the nine slots, so it was composited over
  // the selected slot's item and over nothing else. Vanilla blits the bar, then the frame, then
  // loops the slots — and the table carries the bytecode offsets that say so, so this is an
  // assertion about the jar rather than about a sentence in a comment.
  ok(vHot.offset < vSel.offset, 'vanilla blits the bar before the selector');
  ok(vSel.offset < slotLoopOffset,
     `vanilla blits the selector at ${vSel.offset}, before the nine-slot loop at ${slotLoopOffset}`);
  {
    const hud = readFileSync(join(ROOT, 'src', '15_hud.js'), 'utf8');
    const fn = hud.slice(hud.indexOf('H.drawHotbar = function'));
    const body = fn.slice(0, fn.indexOf('\n  };'));
    const iSel = body.indexOf('WIDGET.selector');
    const iLoop = body.indexOf('for (var i = 0; i < 9; i++)');
    say(`   draw order ...... selector at ${iSel}, slot loop at ${iLoop} in H.drawHotbar`);
    ok(iSel > 0 && iLoop > 0, 'H.drawHotbar has no selector blit or no nine-slot loop');
    ok(iSel < iLoop,
       'H.drawHotbar draws the selection frame AFTER the nine slots — vanilla draws it before, ' +
       'and drawing it after paints the frame over the selected slot\'s icon');
  }

  // the slot geometry: vanilla's loop body pushes 90, 20, 2 (x) and 16, 3 (y)
  ok(slotConsts === '90 20 2 16 3',
     `vanilla's slot loop pushes [${slotConsts}] — this check knows the shape [90 20 2 16 3]`);
  {
    const hud = readFileSync(join(ROOT, 'src', '15_hud.js'), 'utf8');
    ok(/r\.x \+ \(3 \+ i \* 20\) \* s/.test(hud),
       'the slot x is not `r.x + (3 + i*20)*s` — vanilla\'s is width/2 - 90 + i*20 + 2, and the ' +
       'bar starts at width/2 - 91, so the offset into the bar is 3 and the pitch is 20');
    ok(/iy = r\.y \+ 3 \* s/.test(hud),
       'the slot y is not `r.y + 3*s` — vanilla\'s is height - 16 - 3 and the bar is 22 tall');
  }

  // the offhand frames are drawn by H.drawHotbar from the golden geometry
  ok(GEOM.has('offhand_1') && GEOM.has('offhand_2'),
     'the golden table lost the offhand frames — the extractor is reading the wrong method');
  for (const [k, n] of [['offhandLeft', 'offhand_1'], ['offhandRight', 'offhand_2']]) {
    const v = GEOM.get(n), w = G.WIDGET[k];
    ok(w && w[0] === v.u && w[1] === v.v && w[2] === v.w && w[3] === v.h,
       `G.WIDGET.${k} is ${JSON.stringify(w)} — vanilla blits ${n} from (${v.u}, ${v.v}) ${v.w}x${v.h}`);
  }
  {
    const hud = readFileSync(join(ROOT, 'src', '15_hud.js'), 'utf8');
    const fn = hud.slice(hud.indexOf('H.drawHotbar = function'));
    ok(/WIDGET\.offhandLeft/.test(fn.slice(0, fn.indexOf('\n  };'))),
       'H.drawHotbar does not blit the offhand frame — vanilla renderHotbar draws it when slot 40 is non-empty');
    const body = fn.slice(0, fn.indexOf('\n  };'));
    okAv(!/WIDGET\.offhandLeft/.test(body.split('WIDGET.offhandLeft').join('')),
         'a H.drawHotbar with the offhand blit removed is caught');
    // main arm LEFT: the offhand goes to the right side (offhandRight at w/2+91, item +101), indicator to the left
    ok(/mainHand === 'left'/.test(body) && /WIDGET\.offhandRight/.test(body) && /r\.x \+ 182 \* s/.test(body) && /r\.x \+ 192 \* s/.test(body),
       'H.drawHotbar ignores Options.mainArm: left-handed must draw offhandRight at w/2+91 (item w/2+101)');
    okAv(!/mainHand === 'left'/.test(body.split("mainHand === 'left'").join('')),
         'a H.drawHotbar that ignores mainArm is caught');
    ok(/mainHand === 'left'\) x = \(\(st\.w \/ 2\) \| 0\) - 91 - 22/.test(hud),
       'the hotbar attack indicator does not move to w/2-91-22 for a left main arm');
  }
}

// ═══════════ 4. inventory.png — all 46 slots, against the artwork ═════════════════════════
// Vanilla's slot interior is a flat #8B8B8B with a #373737 shadow one texel up and left.
say('\n4. inventory.png — the 46 slots');
{
  const SLOT_GREY = [139, 139, 139], SHADOW = [55, 55, 55];
  const near = (p, q, tol) => Math.abs(p[0] - q[0]) <= tol && Math.abs(p[1] - q[1]) <= tol && Math.abs(p[2] - q[2]) <= tol;
  let greyOk = 0, shadowOk = 0;
  const bad = [];
  for (let i = 0; i < 46; i++) {
    const [x, y] = G.slotXY(i);
    const c = px('inventory', x + 8, y + 8);
    const s = px('inventory', x - 1, y - 1);
    if (near(c, SLOT_GREY, 6) && c[3] === 255) greyOk++; else bad.push(`slot ${i} centre at (${x + 8},${y + 8}) is rgba(${c})`);
    if (near(s, SHADOW, 8) && s[3] === 255) shadowOk++; else bad.push(`slot ${i} shadow at (${x - 1},${y - 1}) is rgba(${s})`);
  }
  say(`   ${greyOk}/46 centres are the slot grey, ${shadowOk}/46 have the shadow corner`);
  ok(greyOk === 46, `all 46 slot centres land on vanilla's #8B8B8B interior — ${bad.slice(0, 4).join('; ')}`);
  ok(shadowOk === 46, `all 46 slots have the #373737 top-left shadow — ${bad.slice(0, 4).join('; ')}`);
  ok(G.INV.w === 176 && G.INV.h === 166, 'the panel is 176x166');

  // the whole panel is opaque, and the area OUTSIDE it in the 256x256 sheet is not drawn
  // ⚠ 18 TEXELS ARE NOT OPAQUE, and they are the four rounded corners — rows 0..2 and 163..165.
  // "fully opaque" was an assumption; the measurement is 29,198 of 29,216.
  const panelInk = inked('inventory', [0, 0, 176, 166]);
  say(`   panel ........... ${panelInk} of ${176 * 166} texels opaque (the rest are the rounded corners)`);
  ok(panelInk >= 176 * 166 - 24 && panelInk <= 176 * 166,
    `the panel is opaque but for its corners — ${176 * 166 - panelInk} clear texels`);
  ok(inked('inventory', [0, 0, 176, 3]) < 176 * 3, 'the top row really is rounded');
  ok(inked('inventory', [4, 4, 168, 158]) === 168 * 158, 'and everything inside the corners is solid');

  // the slot table must be a bijection with slotAt
  let inverse = 0;
  for (let i = 0; i < 46; i++) {
    const [x, y] = G.slotXY(i);
    if (G.slotAt(x, y) === i && G.slotAt(x + 15, y + 15) === i) inverse++;
  }
  ok(inverse === 46, `slotAt inverts slotXY for all 46 slots, got ${inverse}`);
  // ...and no two slots may overlap
  const seen = new Set();
  for (let i = 0; i < 46; i++) { const p = G.slotXY(i); seen.add(p[0] + ',' + p[1]); }
  ok(seen.size === 46, `the 46 slots are at 46 distinct places, got ${seen.size}`);
  // a point in the gutter between two backpack slots belongs to neither
  const m0 = G.slotXY(9);
  ok(G.slotAt(m0[0] + 16, m0[1] + 8) === -1, 'the two-pixel gutter between slots belongs to no slot');
}

// ═══════════ 4b. the survival HUD's layout, as arithmetic ════════════════════════════════
// ⚠ THIS SECTION EXISTS BECAUSE THE HUNGER ROW WAS DRAWN ON TOP OF THE HEARTS. The expression
// was `left + (91 - 9 - i * 8)` — plausible to read, and `left` is already `width/2 - 91`, so it
// landed the drumsticks ten pixels LEFT of centre, straight over hearts four through ten. A
// screenshot did not give it away: a red heart under a brown drumstick still reads as a row of
// hearts. So the layout is data now (`G.HUD`) and the overlaps are arithmetic, which is testable.
say('\n4b. the survival HUD layout');
{
  const L = G.HUD;
  const band = (xs) => ({ lo: Math.min(...xs), hi: Math.max(...xs) + L.icon });
  const hearts = band(Array.from({ length: L.count }, (_, i) => L.heartX(i)));
  const hunger = band(Array.from({ length: L.count }, (_, i) => L.hungerX(i)));
  say(`   hearts span ${hearts.lo}..${hearts.hi}, hunger ${hunger.lo}..${hunger.hi}, of ${L.barW}`);
  ok(hearts.lo === 0, `the heart row starts at the hotbar's left edge, got ${hearts.lo}`);
  ok(hunger.hi === L.barW, `and the hunger row ends at its right edge, got ${hunger.hi}`);
  ok(hunger.lo >= hearts.hi, `THE TWO ROWS DO NOT OVERLAP — hearts end at ${hearts.hi}, hunger starts at ${hunger.lo}`);
  ok(hearts.hi <= L.barW / 2 && hunger.lo >= L.barW / 2,
    'the hearts are entirely left of centre and the hunger entirely right of it');
  // the two rows must MIRROR: the nth heart and the nth drumstick are equidistant from the ends
  let mirrored = 0;
  for (let i = 0; i < L.count; i++) if (L.heartX(i) === L.barW - L.icon - L.hungerX(i)) mirrored++;
  ok(mirrored === L.count, `all ${L.count} positions mirror about the centre, got ${mirrored}`);
  // ...and they must run in OPPOSITE directions, which is why the half icons differ (D-274)
  ok(L.heartX(1) > L.heartX(0) && L.hungerX(1) < L.hungerX(0),
    'the hearts grow rightward and the hunger row leftward');

  // vertical: the item name must clear the heart row, and the level must sit BETWEEN the rows
  const nameBand = [L.nameY, L.nameY + 8];
  const rowBand = [L.rowY, L.rowY + L.icon];
  say(`   name at ${nameBand[0]}..${nameBand[1]}, hearts ${rowBand[0]}..${rowBand[1]}, xp bar ${L.xpY}..${L.xpY + 5}`);
  ok(nameBand[1] <= rowBand[0],
    `the held item's name clears the heart row — name ends at ${nameBand[1]}, hearts begin at ${rowBand[0]} (D-277)`);
  ok(L.armourDY < 0 && L.rowY + L.armourDY + L.icon <= L.rowY,
    'armour sits entirely above the heart row');
  ok(L.xpY > L.rowY + L.icon - 1, 'the experience bar is below the heart row');
  // the level text overlaps the rows' BAND but is horizontally centred, where neither row reaches
  ok(L.xpLevelY + 8 > L.rowY && hearts.hi < L.barW / 2,
    'the level number shares the rows\' band but sits in the gap between them, as vanilla does');
}

// ═══════════ 4b2. XP bar fill and level outline (#362) ═══════════════════════════════════
say('\n4b2. XP fill = (int)(p*183), outline = 4 offsets');
{
  const widthAt = (p) => {
    let w = -1;
    const prev = G.sheets;
    G.sheets = { icons: { canvas: {} } };
    G.blitPart({ drawImage: (_i, _a, _b, sw) => { w = sw; } }, 'icons', G.ICON.xpBarFg, 0, 0, 1, p);
    G.sheets = prev;
    return w;
  };
  for (const [p, want] of [[0.3, 54], [0.5, 91], [0.997, 182]]) {
    ok(widthAt(p) === want, `fill(${p}) is ${want} px, got ${widthAt(p)}`);
  }
  okAv(widthAt(0.3) !== Math.round(182 * 0.3), 'round(182p) would give 55 at p=0.3, not vanilla 54');
  const key = (o) => o.map((d) => d.join(',')).sort().join(' ');
  ok(key(G.XP_OUTLINE) === '-1,0 0,-1 0,1 1,0', 'the level outline is exactly (+-1,0) and (0,+-1)');
  const eight = []; for (let x = -1; x <= 1; x++) for (let y = -1; y <= 1; y++) if (x || y) eight.push([x, y]);
  okAv(key(eight) !== key(G.XP_OUTLINE), 'the 8-way loop would differ from the four offsets');
}

// ═══════════ 4c. the player preview ═══════════════════════════════════════════════════════
say('\n4c. the player preview (D-278)');
{
  const V = G.PREVIEW;
  ok(!!sheet.steve, 'the default skin ships');
  ok(sheet.steve.w === 64 && sheet.steve.h === 64, `the skin is 64x64, got ${sheet.steve.w}x${sheet.steve.h}`);
  ok(G.SKIN.length === 12, `twelve front faces — six parts and six overlays, got ${G.SKIN.length}`);
  // the figure is 16 units wide and 32 tall, and every part must be inside it
  let inside = 0, w = 0, h = 0;
  for (const part of G.SKIN) {
    if (part.p[0] >= 0 && part.p[1] >= 0 && part.p[0] + part.t[2] <= 16 && part.p[1] + part.t[3] <= 32) inside++;
    w = Math.max(w, part.p[0] + part.t[2]); h = Math.max(h, part.p[1] + part.t[3]);
  }
  ok(inside === G.SKIN.length, `every part lies inside the 16x32 figure, ${inside} of ${G.SKIN.length}`);
  ok(w === 16 && h === 32, `and together they fill it exactly — ${w}x${h}`);
  // the base layer must tile the figure with no gap and no overlap
  const base = G.SKIN.filter((p) => !p.o);
  ok(base.length === 6, `six base parts, got ${base.length}`);
  const area = base.reduce((a, p) => a + p.t[2] * p.t[3], 0);
  ok(area === 8 * 8 + 8 * 12 + 2 * 4 * 12 + 2 * 4 * 12,
    `the base parts total ${area} texels — head 64 + body 96 + two arms 96 + two legs 96`);
  const cover = new Set();
  for (const p of base) for (let y = 0; y < p.t[3]; y++) for (let x = 0; x < p.t[2]; x++) cover.add((p.p[1] + y) * 16 + p.p[0] + x);
  ok(cover.size === area, `and they do not overlap each other — ${cover.size} distinct cells of ${area}`);
  // each overlay must sit exactly on its own base part
  for (const o of G.SKIN.filter((p) => p.o)) {
    ok(base.some((b) => b.p[0] === o.p[0] && b.p[1] === o.p[1] && b.t[2] === o.t[2] && b.t[3] === o.t[3]),
      `the ${o.n} overlay lands exactly on a base part`);
  }
  // the artwork itself: the face must be skin-toned and opaque, and the six parts must differ
  const face = meanOf('steve', [8 + 2, 8 + 2, 4, 4]);
  say('   face ............ ' + show(face));
  ok(face.n === 16, 'the face is fully opaque');
  ok(face.r > face.g && face.g > face.b && face.r > 120, `and it is skin-toned — ${show(face)}`);
  const shirt = meanOf('steve', G.SKIN.find((p) => p.n === 'body').t);
  say('   shirt ........... ' + show(shirt));
  ok(shirt.b > shirt.r && shirt.g > shirt.r, `the default shirt is cyan — ${show(shirt)}`);
  const trouser = meanOf('steve', G.SKIN.find((p) => p.n === 'rightLeg').t);
  ok(trouser.b > trouser.r + 30, `and the trousers are blue — ${show(trouser)}`);
  // the figure must land inside the black window, not over the slots
  const fx = V.cx - 8, fy = V.feet - 32;
  ok(fx >= V.box[0] && fx + 16 <= V.box[0] + V.box[2], `the figure fits the window horizontally (${fx}..${fx + 16} in ${V.box[0]}..${V.box[0] + V.box[2]})`);
  ok(V.unit * 32 <= V.box[3], `and vertically — ${(V.unit * 32).toFixed(1)} of ${V.box[3]} GUI pixels tall`);
  // ⚠ and the window really is BLACK in the texture — the "bug" that started this was the artwork
  const win = meanOf('inventory', V.box);
  ok(win.n === V.box[2] * V.box[3] && win.r < 8 && win.g < 8 && win.b < 8,
    `the preview window is solid black in inventory.png — ${show(win)} — so nothing drawn there means a black hole`);
}

// ═══════════ 4d. generic_54.png — the chest screen (PASS 17 JOB 1, G19b) ═══════════════════
// ⚠ `G.CHEST`'s numbers are transcribed from public 1.18.2 mapped decompiles (`ChestMenu`'s own
// constructor, `ChestScreen`'s own `imageHeight`), NOT yet re-walked against this project's own
// bytecode (`Menu.chestMenu`'s own header names the same gap). What THIS section verifies against
// the real shipped artwork rather than trusting the citation: the slot grid lands on the same
// #8B8B8B/#373737 pair every other vanilla container screen uses, and — the one number that
// cannot be a coincidence — a 6-row (double chest) screen's own height must equal generic_54.png's
// REAL shipped pixel height, because a double chest is defined as showing the whole sheet.
say('\n4d. generic_54.png — the chest screen');
{
  const SLOT_GREY = [139, 139, 139], SHADOW = [55, 55, 55];
  const near = (p, q, tol) => Math.abs(p[0] - q[0]) <= tol && Math.abs(p[1] - q[1]) <= tol && Math.abs(p[2] - q[2]) <= tol;

  // ⚠ `sheet.generic_54.{w,h}` IS THE PADDED CANVAS (256x256 — every sheet is squared to a
  // power of two), not the real artwork, so the real bounds are MEASURED: the last opaque texel
  // in a row/column comfortably inside the panel (y=100 for width, x=16 for height — both far
  // from the rounded-corner texels a single edge row/column could catch).
  const realW = (() => { let m = -1; for (let x = 0; x < sheet.generic_54.w; x++) if (px('generic_54', x, 100)[3] > 0) m = x; return m + 1; })();
  const realH = (() => { let m = -1; for (let y = 0; y < sheet.generic_54.h; y++) if (px('generic_54', 16, y)[3] > 0) m = y; return m + 1; })();
  ok(realW === G.CHEST.w, `generic_54.png's real width is ${realW}, G.CHEST says ${G.CHEST.w}`);
  // ⚠ THE ONE NUMBER THAT CANNOT BE A COINCIDENCE. A double chest's own screen shows the sheet's
  // entire real height — if `G.CHEST.h(6)` and the artwork's measured height ever disagree, one
  // of them is wrong, and the formula's OWN plausible-but-wrong sibling (`rows*18 + 96`, missing
  // the divider row) is asserted to fail the same test, so passing here is not a coincidence.
  ok(G.CHEST.h(6) === realH,
    `a double chest's own image height (${G.CHEST.h(6)}) must equal generic_54.png's real, measured height (${realH})`);
  okAv(G.CHEST.h(6) - 18 !== realH,
    'a plausible off-by-one height formula (rows*18+96) would MISS the real texture height, and does');

  const rows = 3;
  const n = rows * 9 + 36;
  // ⚠ THE SCREEN IS DRAWN FROM THE SHEET IN TWO BLITS (`Hud.drawChest`'s own comment): the top
  // `rows*18+17` pixels come from the sheet 1:1, but everything below that is the FIXED
  // player-inventory band, always read from source y=125 regardless of `rows` — measured
  // directly off the shipped pixels (a light-grey divider band at y=125..138 is the tell: it is
  // the same shade as the title bar, and it sits exactly one row-height past where a 6-row
  // (double chest) top part ends). A slot below the fold has a DIFFERENT texture y than its own
  // screen y, so the probe below maps one to the other rather than assuming they are equal —
  // sampling raw screen-y against the sheet is exactly the bug this measurement caught (a false
  // 54/63 failure, all nine in the third backpack row, the first version of this section shipped).
  const topH = rows * 18 + 17, SRC_Y0 = 126;   // D-652: GenericContainerScreen.drawBackground's own 126
  const texY = (y) => (y < topH ? y : SRC_Y0 + (y - topH));
  let greyOk = 0, shadowOk = 0;
  const bad = [];
  for (let i = 0; i < n; i++) {
    const [x, y] = G.chestSlotXY(i, rows);
    const c = px('generic_54', x + 8, texY(y + 8));
    const s = px('generic_54', x - 1, texY(y - 1));
    if (near(c, SLOT_GREY, 6) && c[3] === 255) greyOk++; else bad.push(`slot ${i} centre at (${x + 8},${texY(y + 8)}) is rgba(${c})`);
    if (near(s, SHADOW, 8) && s[3] === 255) shadowOk++; else bad.push(`slot ${i} shadow at (${x - 1},${texY(y - 1)}) is rgba(${s})`);
  }
  say(`   rows=3: ${greyOk}/${n} centres are the slot grey, ${shadowOk}/${n} have the shadow corner`);
  ok(greyOk === n, `all ${n} chest-screen slot centres land on vanilla's #8B8B8B interior — ${bad.slice(0, 4).join('; ')}`);
  ok(shadowOk === n, `all ${n} chest-screen slots have the #373737 top-left shadow — ${bad.slice(0, 4).join('; ')}`);
  // anti-vacuity: sampling at the WRONG (unmapped) screen-y for the bottom band must fail —
  // this is the exact regression the comment above names, reproduced on demand rather than left
  // as a memory of a bug that happened once while writing the check.
  {
    let wrongOk = 0;
    for (let i = rows * 9; i < n; i++) {
      const [x, y] = G.chestSlotXY(i, rows);
      const c = px('generic_54', x + 8, y + 8);
      if (near(c, SLOT_GREY, 6) && c[3] === 255) wrongOk++;
    }
    okAv(wrongOk < (n - rows * 9), `sampling the bottom band at its SCREEN y instead of its sheet y does not land on grey (${wrongOk}/${n - rows * 9} would falsely pass)`);
  }

  // the slot table must be a bijection with chestSlotAt, and no two slots may overlap
  let inverse = 0;
  const seen = new Set();
  for (let i = 0; i < n; i++) {
    const [x, y] = G.chestSlotXY(i, rows);
    if (G.chestSlotAt(x, y, rows) === i && G.chestSlotAt(x + 15, y + 15, rows) === i) inverse++;
    seen.add(x + ',' + y);
  }
  ok(inverse === n, `chestSlotAt inverts chestSlotXY for all ${n} rows=3 slots, got ${inverse}`);
  ok(seen.size === n, `the ${n} rows=3 slots are at ${n} distinct places, got ${seen.size}`);

  // ⚠ anti-vacuity (D-305): the SAME check run at rows=6 must place the player's own inventory
  // band 18 pixels further down than at rows=3 — the `(rows - 4) * 18` term is exactly what a
  // check that only ever ran at rows=3 could not tell from a hardcoded offset.
  const y3 = G.chestSlotXY(3 * 9, 3)[1];   // first backpack slot, rows=3
  const y6 = G.chestSlotXY(6 * 9, 6)[1];   // first backpack slot, rows=6
  okAv(y6 === y3 + 18 * (6 - 3), `the player-inventory band moves with row count (rows=3 -> y=${y3}, rows=6 -> y=${y6})`);
}

// ═══════════ 4e. shulker_box.png — the shulker box screen (PASS 17 JOB 1, G19b) ═════════════
// ⚠ UNLIKE the barrel (D-403, `generic_54.png` reused — no separate texture exists in the jar),
// vanilla DOES ship its own `shulker_box.png` for `ShulkerBoxScreen`, confirmed present in the
// 1.13.2 jar this project's GUI sheets are drawn from. Same 27-slot, 176x166 layout as the plain
// chest (`Hud.openChest` opens it at `rows=3`, same as any other single-block container) — only
// the artwork differs, so this reruns 4d's own real-pixel proof against the new sheet rather than
// assuming "same shape" means "same texture is fine to skip checking".
say('\n4e. shulker_box.png — the shulker box screen');
{
  const SLOT_GREY = [139, 139, 139], SHADOW = [55, 55, 55];
  const near = (p, q, tol) => Math.abs(p[0] - q[0]) <= tol && Math.abs(p[1] - q[1]) <= tol && Math.abs(p[2] - q[2]) <= tol;
  const realW = (() => { let m = -1; for (let x = 0; x < sheet.shulker_box.w; x++) if (px('shulker_box', x, 100)[3] > 0) m = x; return m + 1; })();
  const realH = (() => { let m = -1; for (let y = 0; y < sheet.shulker_box.h; y++) if (px('shulker_box', 16, y)[3] > 0) m = y; return m + 1; })();
  ok(realW === G.SHULKER.w, `shulker_box.png's real width is ${realW}, G.SHULKER says ${G.SHULKER.w}`);
  // ⚠ D-406's own find: shulker_box.png is NOT the same 222-tall multi-size sheet generic_54.png
  // is — it is its own dedicated, single-size (27-slot only) image, and its real measured height
  // is 166, two rows SHORTER than `G.CHEST.h(3)` (168) — reusing the chest's own formula here
  // would blit past the real artwork into the sheet's transparent padding. `G.SHULKER.h` is the
  // measured constant, not the chest's row formula, precisely because of this.
  ok(G.SHULKER.h === realH,
    `the shulker box's own screen height (${G.SHULKER.h}) must equal shulker_box.png's real, measured height (${realH})`);
  okAv(G.CHEST.h(3) !== realH,
    `the chest's own rows=3 formula (${G.CHEST.h(3)}) must NOT equal shulker_box.png's real height (${realH}) — they are genuinely different images`);

  const rows = 3, n = rows * 9 + 36;
  const topH = rows * 18 + 17;
  // ⚠ UNLIKE generic_54.png (a shared multi-size sheet whose bottom band always lives at a FIXED
  // source y=125 regardless of how many rows are cropped above it), shulker_box.png is its own
  // whole, self-contained image — `Hud.drawChest`'s own comment names the pixel comparison that
  // proved this — so the texture is sampled 1:1 the entire way down; no remap function needed.
  const texY = (y) => y;
  let greyOk = 0, shadowOk = 0;
  const bad = [];
  for (let i = 0; i < n; i++) {
    const [x, y] = G.chestSlotXY(i, rows, true);
    const c = px('shulker_box', x + 8, texY(y + 8));
    const s = px('shulker_box', x - 1, texY(y - 1));
    if (near(c, SLOT_GREY, 6) && c[3] === 255) greyOk++; else bad.push(`slot ${i} centre at (${x + 8},${texY(y + 8)}) is rgba(${c})`);
    if (near(s, SHADOW, 8) && s[3] === 255) shadowOk++; else bad.push(`slot ${i} shadow at (${x - 1},${texY(y - 1)}) is rgba(${s})`);
  }
  ok(greyOk === n, `all ${n} shulker-screen slot centres land on vanilla's #8B8B8B interior — ${bad.slice(0, 4).join('; ')}`);
  ok(shadowOk === n, `all ${n} shulker-screen slots have the #373737 top-left shadow — ${bad.slice(0, 4).join('; ')}`);
  // anti-vacuity: shulker_box.png and generic_54.png must not be the SAME bytes shipped twice
  // under two names — a check that only measured shape (already proven above) would not catch
  // a build that quietly aliased the two sheets.
  let sameBytes = true;
  for (let i = 0; i < realW * realH * 4; i += 31) {
    if (blob[sheet.shulker_box.off + i] !== blob[sheet.generic_54.off + i]) { sameBytes = false; break; }
  }
  okAv(!sameBytes, 'shulker_box.png is genuinely different pixel data from generic_54.png, not the same sheet under a second name');
}

// ═══════════ 4e2. the slot's TOP EDGE, exactly (D-652) ════════════════════════════════════════
// ⚠ §4d/§4e's shadow probe at (x-1, y-1) sits in the slot's LEFT shadow COLUMN, which is 17 rows
// tall — a slot drawn one or two pixels low still lands in it. That is how the chest's backpack
// (1px, plus a matching 1px blit error) and the shulker's (2px) sat low for months. The top
// EDGE pins y exactly: (x+8, y-1) is the shadow row, (x+8, y-2) is the panel above it.
say('\n4e2. every chest/shulker slot top edge, exactly');
{
  const SH = [55, 55, 55];
  const eq = (p, q) => Math.abs(p[0] - q[0]) <= 8 && Math.abs(p[1] - q[1]) <= 8 && Math.abs(p[2] - q[2]) <= 8;
  const edgeScore = (sheetName, slotXY, texY, n) => {
    let good = 0;
    for (let i = 0; i < n; i++) {
      const [x, y] = slotXY(i);
      if (eq(px(sheetName, x + 8, texY(y - 1)), SH) && !eq(px(sheetName, x + 8, texY(y - 2)), SH)) good++;
    }
    return good;
  };
  const top3 = 3 * 18 + 17, top6 = 6 * 18 + 17;
  const tex3 = (y) => (y < top3 ? y : 126 + (y - top3)), tex6 = (y) => (y < top6 ? y : 126 + (y - top6));
  const c3 = edgeScore('generic_54', (i) => G.chestSlotXY(i, 3), tex3, 63);
  const c6 = edgeScore('generic_54', (i) => G.chestSlotXY(i, 6), tex6, 90);
  const sb = edgeScore('shulker_box', (i) => G.chestSlotXY(i, 3, true), (y) => y, 63);
  ok(c3 === 63, `all 63 rows=3 chest slots sit exactly under their shadow row (${c3}/63)`);
  ok(c6 === 90, `all 90 rows=6 chest slots sit exactly under their shadow row (${c6}/90)`);
  ok(sb === 63, `all 63 shulker slots sit exactly under their shadow row (${sb}/63)`);
  okAv(edgeScore('shulker_box', (i) => { const p = G.chestSlotXY(i, 3, false); return p; }, (y) => y, 63) < 63,
       'the shulker drawn with the CHEST\'s rows=3 footer (the pre-D-652 bug) is caught by the edge probe');
  okAv(edgeScore('generic_54', (i) => { const p = G.chestSlotXY(i, 3); return [p[0], p[1] + 1]; }, tex3, 63) < 63,
       'every chest slot one pixel low is caught by the edge probe');
  // the referee: the handlers' own numbers, read off .decomp (rule 3/4), not off this file
  const dq = (f) => { try { return readFileSync(join(ROOT, '.decomp/net/minecraft/screen', f), 'utf8'); } catch (e) { return ''; } };
  const GH = dq('GenericContainerScreenHandler.java'), SBH = dq('ShulkerBoxScreenHandler.java');
  const n1 = (t, re) => { const m = t.match(re); return m ? +m[1] : NaN; };
  ok(G.CHEST.invY(4) === n1(GH, /8 \+ \$\$\d+ \* 18, (\d+) \+ \$\$\d+ \* 18 \+ \$\$\d+\)\)/) &&
     G.CHEST.hotbarY(4) === n1(GH, /8 \+ \$\$\d+ \* 18, (\d+) \+ \$\$\d+\)\)/),
     `G.CHEST's footer is GenericContainerScreenHandler's own (${G.CHEST.invY(4)}/${G.CHEST.hotbarY(4)})`);
  ok(G.SHULKER.main[1] === n1(SBH, /new Slot\([^;]*?8 \+ \$\$\d+ \* 18, (\d+) \+ \$\$\d+ \* 18\)\)/) &&
     G.SHULKER.hotbar[1] === n1(SBH, /new Slot\([^;]*?8 \+ \$\$\d+ \* 18, (\d+)\)\)/),
     `G.SHULKER's footer is ShulkerBoxScreenHandler's own (${G.SHULKER.main[1]}/${G.SHULKER.hotbar[1]})`);
}

// ═══════════ 4f. furnace / blast_furnace / smoker — the furnace-family screen (D-414) ═════════
// ⚠ ONE SHEET, THREE SCREENS. The blast furnace and the smoker have their own `.png` in the 1.18.2
// jar and both are pixel-identical to `furnace.png` — `build-gui.mjs` asserts that and stops the
// build if a jar ever says otherwise — so all three draw from `furnace` and share `G.FURNACE`.

say('\n4f. furnace.png — the furnace-family screen');
{
  const SLOT_GREY = [139, 139, 139], SHADOW = [55, 55, 55];
  const near = (p, q, tol) => Math.abs(p[0] - q[0]) <= tol && Math.abs(p[1] - q[1]) <= tol && Math.abs(p[2] - q[2]) <= tol;
  const realW = (() => { let m = -1; for (let x = 0; x < sheet.furnace.w; x++) if (px('furnace', x, 100)[3] > 0) m = x; return m + 1; })();
  const realH = (() => { let m = -1; for (let y = 0; y < sheet.furnace.h; y++) if (px('furnace', 16, y)[3] > 0) m = y; return m + 1; })();
  ok(realW === G.FURNACE.w, `furnace.png's real width is ${realW}, G.FURNACE says ${G.FURNACE.w}`);
  ok(realH === G.FURNACE.h, `furnace.png's real height is ${realH}, G.FURNACE says ${G.FURNACE.h}`);

  // ⚠ THE 39 SLOT ORIGINS ARE A TRANSCRIPTION (D-414 says so in `Menu.furnaceMenu`'s own header),
  // and this is the referee behind it: every one of them must land on a slot square that really
  // is in the picture. A transcription that drifted by a pixel draws a plausible-looking wrong
  // screen for ever, which is exactly what `extract-guigeom`'s own header was written about.
  // ⚠ SLOT 2 — THE RESULT — HAS NO 18x18 SHADOW CORNER OF ITS OWN, AND THAT IS THE TEXTURE,
  // NOT A DRIFT. Vanilla draws the furnace's output inside a LARGER recess: measured on these
  // pixels it is 24x24 of #8B8B8B at (112, 31), with the #373737 corner at (111, 30) — so the
  // slot origin (116, 35) sits four pixels inside it and the usual (x-1, y-1) probe lands on
  // grey. The recess is asserted on its own terms below rather than the rule being loosened.
  let greyOk = 0, shadowOk = 0; const bad = [];
  for (let i = 0; i < 39; i++) {
    const [x, y] = G.furnaceSlotXY(i);
    const c = px('furnace', x + 8, y + 8), s = px('furnace', x - 1, y - 1);
    if (near(c, SLOT_GREY, 6) && c[3] === 255) greyOk++; else bad.push(`slot ${i} centre at (${x + 8},${y + 8}) is rgba(${c})`);
    if (i === 2) { shadowOk++; continue; }
    if (near(s, SHADOW, 8) && s[3] === 255) shadowOk++; else bad.push(`slot ${i} shadow at (${x - 1},${y - 1}) is rgba(${s})`);
  }
  ok(greyOk === 39, `all 39 furnace-screen slot centres land on vanilla's #8B8B8B interior — ${bad.slice(0, 4).join('; ')}`);
  ok(shadowOk === 39, `all 39 furnace-screen slots have the #373737 top-left shadow (slot 2 excepted — its recess is asserted below) — ${bad.slice(0, 4).join('; ')}`);

  // the result recess, MEASURED from the origin outwards rather than from typed corners
  {
    const cx = G.FURNACE.result[0] + 8, cy = G.FURNACE.result[1] + 8;
    let x0 = cx; while (near(px('furnace', x0 - 1, cy), SLOT_GREY, 6)) x0--;
    let x1 = cx; while (near(px('furnace', x1 + 1, cy), SLOT_GREY, 6)) x1++;
    let y0 = cy; while (near(px('furnace', cx, y0 - 1), SLOT_GREY, 6)) y0--;
    let y1 = cy; while (near(px('furnace', cx, y1 + 1), SLOT_GREY, 6)) y1++;
    ok(x1 - x0 + 1 === 24 && y1 - y0 + 1 === 24,
       `the furnace's result slot sits in a 24x24 recess, measured ${x1 - x0 + 1}x${y1 - y0 + 1}`);
    ok(G.FURNACE.result[0] === x0 + 4 && G.FURNACE.result[1] === y0 + 4,
       `and the 16x16 slot is centred in it — recess at (${x0},${y0}), slot at (${G.FURNACE.result.join(',')})`);
    const corner = px('furnace', x0 - 1, y0 - 1);
    ok(near(corner, SHADOW, 8) && corner[3] === 255, `the recess has the #373737 corner at (${x0 - 1},${y0 - 1}), got rgba(${corner})`);
    okAv(x1 - x0 + 1 !== 16, 'the result recess is genuinely bigger than a plain slot — otherwise the exemption above is hiding nothing');
  }

  // the flame and the arrow are BOTH a screen position and a source rect on the right margin
  const F = G.FURNACE.flame, A = G.FURNACE.arrow;
  ok(F.sx === realW && A.sx === realW, `the flame and arrow sprites sit on the sheet's right margin at x=${realW}, got ${F.sx}/${A.sx}`);
  const flameLit = meanOf('furnace', [F.sx, F.sy, F.w, F.h]);
  ok(flameLit.n > 0 && flameLit.r > flameLit.b + 30, `the flame sprite is warm-coloured (r ${flameLit.r | 0}, b ${flameLit.b | 0})`);
  const arrowMean = meanOf('furnace', [A.sx, A.sy, 24, A.h]);
  ok(arrowMean.n > 0 && arrowMean.r > 180 && Math.abs(arrowMean.r - arrowMean.b) < 40,
     `the arrow sprite is the pale progress bar (rgb ${arrowMean.r | 0},${arrowMean.g | 0},${arrowMean.b | 0})`);

  // the slot table is a bijection with the hit test, and no two slots overlap
  let inverse = 0; const seen = new Set();
  for (let i = 0; i < 39; i++) {
    const [x, y] = G.furnaceSlotXY(i);
    if (G.furnaceSlotAt(x, y) === i && G.furnaceSlotAt(x + 15, y + 15) === i) inverse++;
    seen.add(x + ',' + y);
  }
  ok(inverse === 39, `furnaceSlotAt inverts furnaceSlotXY for all 39 slots, got ${inverse}`);
  ok(seen.size === 39, `the 39 slots are at 39 distinct places, got ${seen.size}`);

  // ⚠ ANTI-VACUITY: the three screen slots are NOT on the player-inventory grid, so shifting the
  // whole table by one pixel must break the pixel test. A check that only ever sampled the
  // backpack band would pass a screen whose three OWN slots were in the wrong place.
  // ⚠ ONE PIXEL IS NOT A BREAK: a slot interior is 16 pixels of flat grey, so a probe that drifts
  // by one is still inside it. A WHOLE SLOT is: shifting the three screen slots one slot-pitch to
  // the right lands on the panel between them, and none of the three stays on grey.
  let shifted = 0;
  for (let i = 0; i < 3; i++) {
    const [x, y] = G.furnaceSlotXY(i);
    const c = px('furnace', x + 8 + G.SLOT, y + 8);
    if (near(c, SLOT_GREY, 6) && c[3] === 255) shifted++;
  }
  okAv(shifted === 0, `shifting the three furnace slots one slot-pitch right lands on grey ${shifted}/3 times, not 3/3`);
  okAv(G.FURNACE.inventoryLabel.y === G.FURNACE.h - 94,
       `"Inventory" sits at imageHeight - 94 (${G.FURNACE.h - 94}), not at a typed constant`);
}

// ═══════════ 4g. hopper.png — the hopper screen (PASS 17 JOB 1, G19b, D-419) ═════════════════
// ⚠ THE SHORTEST CONTAINER SCREEN IN THE GAME: 176 x 133, five slots in a row and then the
// player-inventory footer with nothing above it. Nothing else can be borrowed for it, which is
// why `build-gui.mjs` lifts its own sheet — and why the eleven origins `Menu.hopperMenu`
// transcribes need a referee of their own rather than "it's the inventory footer again".
say('\n4g. hopper.png — the hopper screen');
{
  const SLOT_GREY = [139, 139, 139], SHADOW = [55, 55, 55];
  const near = (p, q, tol) => Math.abs(p[0] - q[0]) <= tol && Math.abs(p[1] - q[1]) <= tol && Math.abs(p[2] - q[2]) <= tol;
  const realW = (() => { let m = -1; for (let x = 0; x < sheet.hopper.w; x++) if (px('hopper', x, 100)[3] > 0) m = x; return m + 1; })();
  const realH = (() => { let m = -1; for (let y = 0; y < sheet.hopper.h; y++) if (px('hopper', 16, y)[3] > 0) m = y; return m + 1; })();
  ok(realW === G.HOPPER.w, `hopper.png's real width is ${realW}, G.HOPPER says ${G.HOPPER.w}`);
  ok(realH === G.HOPPER.h, `hopper.png's real height is ${realH}, G.HOPPER says ${G.HOPPER.h}`);
  // ⚠ IT IS GENUINELY SHORTER THAN EVERY OTHER SCREEN. Asserting that here is what stops a future
  // build from quietly aliasing it to the 166-tall furnace sheet and having every check still pass.
  okAv(realH !== G.FURNACE.h && realH !== G.CHEST.h(3),
       `the hopper's screen (${realH}) is its own height, not the furnace's (${G.FURNACE.h}) or a 3-row chest's (${G.CHEST.h(3)})`);

  let greyOk = 0, shadowOk = 0; const bad = [];
  for (let i = 0; i < G.HOPPER_SLOTS; i++) {
    const [x, y] = G.hopperSlotXY(i);
    const c = px('hopper', x + 8, y + 8), s = px('hopper', x - 1, y - 1);
    if (near(c, SLOT_GREY, 6) && c[3] === 255) greyOk++; else bad.push(`slot ${i} centre at (${x + 8},${y + 8}) is rgba(${c})`);
    if (near(s, SHADOW, 8) && s[3] === 255) shadowOk++; else bad.push(`slot ${i} shadow at (${x - 1},${y - 1}) is rgba(${s})`);
  }
  ok(greyOk === G.HOPPER_SLOTS, `all ${G.HOPPER_SLOTS} hopper-screen slot centres land on vanilla's #8B8B8B interior — ${bad.slice(0, 4).join('; ')}`);
  ok(shadowOk === G.HOPPER_SLOTS, `all ${G.HOPPER_SLOTS} hopper-screen slots have the #373737 top-left shadow — ${bad.slice(0, 4).join('; ')}`);

  let inverse = 0; const seen = new Set();
  for (let i = 0; i < G.HOPPER_SLOTS; i++) {
    const [x, y] = G.hopperSlotXY(i);
    if (G.hopperSlotAt(x, y) === i && G.hopperSlotAt(x + 15, y + 15) === i) inverse++;
    seen.add(x + ',' + y);
  }
  ok(inverse === G.HOPPER_SLOTS, `hopperSlotAt inverts hopperSlotXY for all ${G.HOPPER_SLOTS} slots, got ${inverse}`);
  ok(seen.size === G.HOPPER_SLOTS, `the ${G.HOPPER_SLOTS} slots are at ${G.HOPPER_SLOTS} distinct places, got ${seen.size}`);

  // the five hopper slots are a row, 18 apart, and the footer is the standard one
  const row = [];
  for (let i = 0; i < 5; i++) row.push(G.hopperSlotXY(i));
  ok(row.every((p) => p[1] === row[0][1]), 'the five hopper slots share one y');
  ok(row.every((p, i) => p[0] === row[0][0] + i * G.SLOT), 'and are 18 apart, left to right');
  okAv(G.HOPPER.inventoryLabel.y === G.HOPPER.h - 94,
       `"Inventory" sits at imageHeight - 94 (${G.HOPPER.h - 94}), the same formula that gives the furnace ${G.FURNACE.h - 94}`);
  // ⚠ ANTI-VACUITY: the title is LEFT-aligned here and CENTRED on the furnace. A check that did
  // not say so would pass a hopper screen that copied the furnace's own centring line.
  okAv(G.HOPPER.title.x === 8, `the hopper's title is at AbstractContainerScreen's default x=8, not centred (got ${G.HOPPER.title.x})`);
  // sampling the five slots one pixel off must stop landing on grey
  let shifted = 0;
  for (let i = 0; i < 5; i++) {
    const [x, y] = G.hopperSlotXY(i);
    const c = px('hopper', x + 8, y - 2);
    if (near(c, SLOT_GREY, 6) && c[3] === 255) shifted++;
  }
  okAv(shifted < 5, `sampling the five hopper slots two pixels above their centre lands on grey only ${shifted}/5 times`);
}

// ═══════════ 4h. dispenser.png — the dispenser and dropper screen (G19b, D-420) ══════════════
// ⚠ ONE SHEET, TWO SCREENS, AND THE SECOND ONE HAS NO TEXTURE AT ALL. `DropperScreen` is
// `DispenserScreen` with a different title: there is no `gui/container/dropper.png` in the jar,
// which `build-gui.mjs` would have failed on had there been, and which is asserted here from the
// other side — the shipped blob must carry `dispenser` and must NOT carry `dropper`.
say('\n4h. dispenser.png — the dispenser and dropper screen');
{
  const SLOT_GREY = [139, 139, 139], SHADOW = [55, 55, 55];
  const near = (p, q, tol) => Math.abs(p[0] - q[0]) <= tol && Math.abs(p[1] - q[1]) <= tol && Math.abs(p[2] - q[2]) <= tol;
  ok(!!sheet.dispenser, 'the shipped blob carries a `dispenser` sheet');
  ok(!sheet.dropper, 'and carries no `dropper` sheet — vanilla ships none, and a second copy would be a lie about the jar');

  const realW = (() => { let m = -1; for (let x = 0; x < sheet.dispenser.w; x++) if (px('dispenser', x, 100)[3] > 0) m = x; return m + 1; })();
  const realH = (() => { let m = -1; for (let y = 0; y < sheet.dispenser.h; y++) if (px('dispenser', 16, y)[3] > 0) m = y; return m + 1; })();
  ok(realW === G.DISPENSER.w, `dispenser.png's real width is ${realW}, G.DISPENSER says ${G.DISPENSER.w}`);
  ok(realH === G.DISPENSER.h, `dispenser.png's real height is ${realH}, G.DISPENSER says ${G.DISPENSER.h}`);

  let greyOk = 0, shadowOk = 0; const bad = [];
  for (let i = 0; i < G.DISPENSER_SLOTS; i++) {
    const [x, y] = G.dispenserSlotXY(i);
    const c = px('dispenser', x + 8, y + 8), sh = px('dispenser', x - 1, y - 1);
    if (near(c, SLOT_GREY, 6) && c[3] === 255) greyOk++; else bad.push(`slot ${i} centre at (${x + 8},${y + 8}) is rgba(${c})`);
    if (near(sh, SHADOW, 8) && sh[3] === 255) shadowOk++; else bad.push(`slot ${i} shadow at (${x - 1},${y - 1}) is rgba(${sh})`);
  }
  ok(greyOk === G.DISPENSER_SLOTS, `all ${G.DISPENSER_SLOTS} dispenser-screen slot centres land on vanilla's #8B8B8B interior — ${bad.slice(0, 4).join('; ')}`);
  ok(shadowOk === G.DISPENSER_SLOTS, `all ${G.DISPENSER_SLOTS} dispenser-screen slots have the #373737 top-left shadow — ${bad.slice(0, 4).join('; ')}`);

  let inverse = 0; const seen = new Set();
  for (let i = 0; i < G.DISPENSER_SLOTS; i++) {
    const [x, y] = G.dispenserSlotXY(i);
    if (G.dispenserSlotAt(x, y) === i && G.dispenserSlotAt(x + 15, y + 15) === i) inverse++;
    seen.add(x + ',' + y);
  }
  ok(inverse === G.DISPENSER_SLOTS, `dispenserSlotAt inverts dispenserSlotXY for all ${G.DISPENSER_SLOTS} slots, got ${inverse}`);
  ok(seen.size === G.DISPENSER_SLOTS, `the ${G.DISPENSER_SLOTS} slots are at ${G.DISPENSER_SLOTS} distinct places, got ${seen.size}`);

  // ⚠ THE 3x3 IS ROW-MAJOR AND IT IS NOT THE CRAFTING TABLE'S. Asserting the ORIGIN as well as
  // the shape is what stops a copy-paste of `craftSlotXY` from passing: the crafting grid sits
  // at (30, 17) and this one at (62, 17), and both are 3x3 of 18.
  const g0 = G.dispenserSlotXY(0), g4 = G.dispenserSlotXY(4), g8 = G.dispenserSlotXY(8);
  ok(g0[0] === G.DISPENSER.grid[0] && g0[1] === G.DISPENSER.grid[1], `slot 0 is the grid origin, got ${g0}`);
  ok(g4[0] === g0[0] + G.SLOT && g4[1] === g0[1] + G.SLOT, 'slot 4 is the middle of the 3x3 — the grid is row-major');
  ok(g8[0] === g0[0] + 2 * G.SLOT && g8[1] === g0[1] + 2 * G.SLOT, 'and slot 8 its bottom-right');
  okAv(G.DISPENSER.grid[0] !== G.CRAFTING.grid[0],
       `the dispenser's grid (x=${G.DISPENSER.grid[0]}) is NOT the crafting table's (x=${G.CRAFTING.grid[0]}) — a copy-paste would put it there`);
  okAv(G.DISPENSER.inventoryLabel.y === G.DISPENSER.h - 94,
       `"Inventory" sits at imageHeight - 94 (${G.DISPENSER.h - 94})`);
  let shifted = 0;
  for (let i = 0; i < 9; i++) {
    const [x, y] = G.dispenserSlotXY(i);
    const c = px('dispenser', x + 8, y + 8 + 9);
    if (near(c, SLOT_GREY, 6) && c[3] === 255) shifted++;
  }
  okAv(shifted < 9, `sampling the nine grid slots half a slot low lands on grey only ${shifted}/9 times`);
}

// ═══════════ 4k. brewing_stand.png — the brewing stand screen (G19b) ═════════════════════════
// The 41 slot origins are `BrewingStandScreenHandler`'s; the three progress sprites live in the
// sheet's right-hand margin, where `BrewingStandScreen.drawBackground` blits them from.
say('\n4k. brewing_stand.png — the brewing stand screen');
{
  const SLOT_GREY = [139, 139, 139], SHADOW = [55, 55, 55];
  const near = (p, q, tol) => Math.abs(p[0] - q[0]) <= tol && Math.abs(p[1] - q[1]) <= tol && Math.abs(p[2] - q[2]) <= tol;
  ok(!!sheet.brewing_stand, 'the shipped blob carries a `brewing_stand` sheet');
  const realW = (() => { let m = -1; for (let x = 0; x < sheet.brewing_stand.w; x++) if (px('brewing_stand', x, 100)[3] > 0) m = x; return m + 1; })();
  const realH = (() => { let m = -1; for (let y = 0; y < sheet.brewing_stand.h; y++) if (px('brewing_stand', 16, y)[3] > 0) m = y; return m + 1; })();
  ok(realW === G.BREWING.w, `brewing_stand.png's real width is ${realW}, G.BREWING says ${G.BREWING.w}`);
  ok(realH === G.BREWING.h, `brewing_stand.png's real height is ${realH}, G.BREWING says ${G.BREWING.h}`);

  let greyOk = 0, shadowOk = 0; const bad = [];
  for (let i = 0; i < G.BREWING_SLOTS; i++) {
    const [x, y] = G.brewingSlotXY(i);
    const c = px('brewing_stand', x + 8, y + 8), sh = px('brewing_stand', x - 1, y - 1);
    // the three bottle slots and the fuel slot have their own outlines/backdrop artwork, so the
    // centre must be slot-grey OR the drawn bottle/blaze silhouette's background is not asserted
    // for them beyond being opaque; the 36 player slots and the ingredient are plain
    const plain = i === 3 || i >= 5;
    if (plain ? (near(c, SLOT_GREY, 6) && c[3] === 255) : c[3] === 255) greyOk++; else bad.push(`slot ${i} centre at (${x + 8},${y + 8}) is rgba(${c})`);
    if (near(sh, SHADOW, 8) && sh[3] === 255) shadowOk++; else bad.push(`slot ${i} shadow at (${x - 1},${y - 1}) is rgba(${sh})`);
  }
  ok(greyOk === G.BREWING_SLOTS, `all ${G.BREWING_SLOTS} brewing-screen slot centres are where vanilla's artwork has them — ${bad.slice(0, 4).join('; ')}`);
  ok(shadowOk === G.BREWING_SLOTS, `all ${G.BREWING_SLOTS} brewing-screen slots have the #373737 top-left shadow — ${bad.slice(0, 4).join('; ')}`);

  let inverse = 0; const seen = new Set();
  for (let i = 0; i < G.BREWING_SLOTS; i++) {
    const [x, y] = G.brewingSlotXY(i);
    if (G.brewingSlotAt(x, y) === i && G.brewingSlotAt(x + 15, y + 15) === i) inverse++;
    seen.add(x + ',' + y);
  }
  ok(inverse === G.BREWING_SLOTS, `brewingSlotAt inverts brewingSlotXY for all ${G.BREWING_SLOTS} slots, got ${inverse}`);
  ok(seen.size === G.BREWING_SLOTS, `the ${G.BREWING_SLOTS} slots are at ${G.BREWING_SLOTS} distinct places, got ${seen.size}`);

  // the three progress sprites sit in the margin and are drawn (opaque) there
  const F = G.BREWING.fuelBar, A = G.BREWING.arrow, Bb = G.BREWING.bubbles;
  ok(px('brewing_stand', F.sx + 2, F.sy + 1)[3] === 255 && px('brewing_stand', F.sx + 17, F.sy + 1)[3] === 255,
     'the fuel gauge sprite spans 18 opaque pixels at (176, 29)');
  ok(px('brewing_stand', F.sx + 18, F.sy + 1)[3] === 0, 'and is not 19 wide');
  ok(px('brewing_stand', A.sx + 4, A.sy + 27)[3] === 255, 'the arrow sprite is drawn down to row 27 of its 28');
  ok(px('brewing_stand', Bb.sx + 5, Bb.max - 1)[3] === 255, 'the bubble sprite reaches its bottom row at (185, 28)');
  okAv(px('brewing_stand', F.sx + 30, F.sy + 1)[3] === 0, 'a sprite rect read 30 pixels to the right is empty');
  okAv(near(px('brewing_stand', G.brewingSlotXY(3)[0] + 8 + 9, G.brewingSlotXY(3)[1] + 8 + 9), SLOT_GREY, 6) === false,
       'sampling the ingredient slot half a slot low does not land on grey');
  okAv(G.BREWING.bottles[1][1] !== G.BREWING.bottles[0][1], 'the middle bottle sits LOWER than the outer two (a row of three would pass a naive copy)');
}

// ═══════════ 4i. villager.png — the trading screen's background (D-48x, row 0 item 5) ═══════
// BACKGROUND ONLY (`Trade.OWED` names the rest): `G.MERCHANT` is vanilla's ordinary 176x166
// container size, jar-verified off the 1.13.2 `clq`/`cky` classes (`GuiMerchant` never overrides
// `GuiContainer`'s default xSize/ySize) — NOT 1.14's widened 276x166 `villager2.png` redesign,
// which this project does not ship (D-5's whole-game 1.13.2 art era).
say("\n4i. villager.png — the trading screen's background");
{
  ok(!!sheet.merchant, 'the shipped blob carries a `merchant` sheet');
  const realW = (() => { let m = -1; for (let x = 0; x < sheet.merchant.w; x++) if (px('merchant', x, 80)[3] > 0) m = x; return m + 1; })();
  const realH = (() => { let m = -1; for (let y = 0; y < sheet.merchant.h; y++) if (px('merchant', 16, y)[3] > 0) m = y; return m + 1; })();
  ok(realW === G.MERCHANT.w, `villager.png's real width is ${realW}, G.MERCHANT says ${G.MERCHANT.w}`);
  ok(realH === G.MERCHANT.h, `villager.png's real height is ${realH}, G.MERCHANT says ${G.MERCHANT.h}`);
  okAv(G.MERCHANT.w !== G.SHULKER.w || G.MERCHANT.h !== G.SHULKER.h || realW !== realH,
       'a copy-paste of another 176x166 sheet would still pass the two size checks above; the real pixels must differ too');
  let differs = 0;
  for (let sx = 0; sx < Math.min(sheet.merchant.w, sheet.shulker_box.w); sx += 7) {
    for (let sy = 0; sy < Math.min(sheet.merchant.h, sheet.shulker_box.h); sy += 7) {
      const a = px('merchant', sx, sy), b = px('shulker_box', sx, sy);
      if (a[0] !== b[0] || a[1] !== b[1] || a[2] !== b[2] || a[3] !== b[3]) differs++;
    }
  }
  okAv(differs > 0, 'villager.png is not pixel-identical to shulker_box.png at the sampled grid');
}

// ═══════════ 4j. the trading screen's real slots and arrow widgets (D-483) ════════════════════
// javap'd off `aqo` (the real Container — `clq`'s own ctor feeds `new aqo(aof, axd, axy)` to
// `cky`'s super-ctor, so `aqo`, not `aof`, holds the slot table) and `clq$a` (the arrow-button
// base, off `clq`'s `c()`/init). See 15b_gui.js's own comment for the bytecode citation.
say("\n4j. the trading screen's real slots and the two arrow widgets");
{
  const SLOT_GREY = [139, 139, 139];
  ok(!!G.MERCHANT_SLOT && !!G.MERCHANT_ARROW, 'Gui carries MERCHANT_SLOT and MERCHANT_ARROW');
  const S = G.MERCHANT_SLOT;
  ok(S.in1[0] === 36 && S.in1[1] === 53, `in1 is (36,53) off aqo's own "new aqx(f,0,36,53)", got (${S.in1})`);
  ok(S.in2[0] === 62 && S.in2[1] === 53, `in2 is (62,53) off aqo's own "new aqx(f,1,62,53)", got (${S.in2})`);
  ok(S.out[0] === 120 && S.out[1] === 53, `out is (120,53) off aqo's own "new aqp(...,2,120,53)", got (${S.out})`);
  // every slot centre lands on the panel's own drawn grey square — proves the numbers are not
  // merely internally consistent but actually line up with the art (D-274)
  let onGrey = 0;
  for (const p of [S.in1, S.in2, S.out]) { const c = px('merchant', p[0] + 8, p[1] + 8); if (c[0] === SLOT_GREY[0] && c[1] === SLOT_GREY[1] && c[2] === SLOT_GREY[2] && c[3] === 255) onGrey++; }
  ok(onGrey === 3, `all 3 merchant slots land on vanilla's #8B8B8B slot grey, got ${onGrey}/3`);
  okAv(S.in1[0] !== S.out[0], 'in1 and out are not the same column — a copy-paste would collapse them');

  const A = G.MERCHANT_ARROW;
  ok(A.w === 12 && A.h === 19, `arrow widgets are 12x19 (clq$a's own ctor: "bipush 12; bipush 19"), got ${A.w}x${A.h}`);
  ok(A.next.x === 147 && A.next.y === 23, `next ("clq$1", guiLeft+147,guiTop+23), got (${A.next.x},${A.next.y})`);
  ok(A.prev.x === 17 && A.prev.y === 23, `previous ("clq$2", guiLeft+17,guiTop+23), got (${A.prev.x},${A.prev.y})`);
  ok(A.next.v === 0 && A.prev.v === 19, `next is row v=0 ("o"=true), previous row v=19 ("o"=false), got (${A.next.v},${A.prev.v})`);
  // the six sprite cells this unit reads (2 rows x 3 states: normal/hover/disabled) must all be
  // real, fully-opaque icon pixels on the sheet, not blank margin past the visible 176x166 panel
  let solid = 0, cells = 0;
  for (const v of [A.next.v, A.prev.v]) {
    for (const du of [0, A.hoverDu, A.disabledDu]) {
      cells++;
      let opaque = 0, total = 0;
      for (let dx = 0; dx < A.w; dx++) for (let dy = 0; dy < A.h; dy++) { total++; if (px('merchant', A.u + du + dx, v + dy)[3] === 255) opaque++; }
      if (opaque === total) solid++;
    }
  }
  ok(solid === cells, `all ${cells} arrow sprite cells (u=${A.u}+{0,${A.hoverDu},${A.disabledDu}}, v={${A.next.v},${A.prev.v}}) are fully opaque, got ${solid}`);
  // and the two ROWS must actually differ (next vs previous are drawn as different arrows) —
  // proves v matters, a wrong constant that read the same row twice would still pass every
  // check above but fail this one
  let rowDiffers = 0;
  for (let dx = 0; dx < A.w; dx++) for (let dy = 0; dy < A.h; dy++) {
    const a = px('merchant', A.u + dx, A.next.v + dy), b = px('merchant', A.u + dx, A.prev.v + dy);
    if (a[0] !== b[0] || a[1] !== b[1] || a[2] !== b[2]) rowDiffers++;
  }
  okAv(rowDiffers > 0, `the next/previous arrow rows differ in at least one pixel, got ${rowDiffers} differing`);
}

// ═══════════ 4c. H.drawItem: stack count and durability bar, in vanilla GUI pixels (#364) ═══
// Vanilla ItemRenderer.renderGuiItemOverlay: count at (x+19-2-width, y+9); bar black (x+2,y+13) 13x2,
// colour (x+2,y+13) step x 1, step = round(13 - damage*13/max); all scaled by the GUI scale.
say('\n4c. drawItem count and durability bar');
{
  const HN = { Gui: { ready: true, textWidth: (t) => 6 * t.length, text: (c, t, x, y, k) => c.rec.push(['text', t, x, y, k]) },
    Inventory: { isEmpty: (s) => !s || !s.n }, Items: { names: ['pick'], durability: [100] } };
  new Function('MCL', readFileSync(join(ROOT, 'src', '15_hud.js'), 'utf8'))(HN);
  const H = HN.Hud;
  const run = (s, cur) => {
    const c = { rec: [], fillStyle: '', fillRect(x, y, w, h) { this.rec.push(['rect', x, y, w, h]); }, drawImage() {} };
    H.itemSheetReady = false;
    H.drawItem(c, { i: 0, n: 5, d: 25 }, 10, 20, 16 * s);
    const t = c.rec.find((r) => r[0] === 'text'), rects = c.rec.filter((r) => r[0] === 'rect');
    const w = HN.Gui.textWidth('5');
    const good = t && t[2] === 10 + (17 - w) * s && t[3] === 20 + 9 * s
      && rects.length === 2 && rects[0].slice(1).join() === [10 + 2 * s, 20 + 13 * s, 13 * s, 2 * s].join()
      && rects[1].slice(1).join() === [10 + 2 * s, 20 + 13 * s, 10 * s, s].join();   // round(13 - 25*13/100) = 10
    return good;
  };
  for (let s = 1; s <= 4; s++) ok(run(s), `drawItem at GUI scale ${s} matches vanilla count/bar geometry`);
  // anti-vacuity: the old device-pixel formula at s=3 must not satisfy the same assertion
  const size = 48, oldBx = 10 + Math.round(size * 0.1), oldBw = Math.round(size * 0.8);
  okAv(!(oldBx === 10 + 2 * 3 && oldBw === 13 * 3), 'the pre-#364 formula at scale 3 fails the bar assertion');
}

// ═══════════ the report ══════════════════════════════════════════════════════════════════════
//
// ⚠⚠ **THIS BLOCK DID NOT EXIST UNTIL D-419, AND ITS ABSENCE MEANT `guicheck` COULD NOT FAIL.**
// Every `ok()` above pushed its message into `fails` and nothing ever read the array: the file
// printed its sections, exited 0, and the suite counted it green whatever the pixels said. The
// suite's own "⚠ N check stages REPORTED NO ASSERTION COUNT and contribute nothing to the total"
// line had been naming it every run. That is D-305's rule — a check that cannot fail is not a
// check — reached by omission rather than by a weak assertion, and it is the more dangerous
// route, because a file with a hundred correct assertions in it looks exactly like a working one.
console.log('\n================= guicheck ==================');
console.log(` assertions passed .. ${pass}`);
console.log(` failures ........... ${fails.length}`);
console.log(` breaks caught ...... ${breaks}`);
console.log('==============================================');
if (fails.length) { for (const f of fails) console.log('  ✗ ' + f); process.exit(1); }
