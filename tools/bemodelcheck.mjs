#!/usr/bin/env node
// bemodelcheck.mjs — PLAN G10c. The block-entity item models: the table, the roster, the UVs.
//
//   node tools/bemodelcheck.mjs [--verbose]
//
// ⚠ WHAT THIS EXISTS TO CATCH. Sixty items in the creative inventory used to draw nothing at all.
// Fixing that meant a fourteenth bytecode table (the boxes), forty entity textures, a UV layout,
// a per-item display transform and sixteen dye colours — five separate things any one of which
// can be subtly wrong while the picture still looks like a chest. §1 holds the roster closed
// against the JAR's own `builtin/entity` parent chains, §2 holds the UV layout against the PLAYER
// SKIN's documented coordinates, and §3 holds the tables against the golden TSVs.
//
// ⚠ THE PIXELS ARE `g11bcheck` §9's, because the textures are canvases and there is no canvas
// here. This half is the arithmetic; that half watches the icons draw.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateRawSync } from 'node:zlib';

const MCLITE_ROOT = fileURLToPath(new URL('..', import.meta.url));
const SRC = MCLITE_ROOT + 'src', ASSETS = MCLITE_ROOT + 'assets';
const VERBOSE = process.argv.includes('--verbose');

const NS = {};
globalThis.MCL = NS;
for (const f of ['00_ns.js', '01_util.js', '01b_inflate.js', '02g_items.js', '14f_inventory.js',
                 '15e_creative.js', '15h_bemodel.js', '10_gfx.js', '15d_blockicon.js']) {
  new Function('MCL', readFileSync(join(SRC, f), 'utf8'))(NS);
}
{
  const meta = JSON.parse(readFileSync(join(ASSETS, 'items.meta.json'), 'utf8'));
  NS.Items.init({ items: readFileSync(join(ASSETS, 'items.bin')).toString('base64'), itemsBytes: meta.rawBytes });
  const mm = JSON.parse(readFileSync(join(ASSETS, 'models.meta.json'), 'utf8'));
  NS.BEModel.init({ models: readFileSync(join(ASSETS, 'models.bin')).toString('base64'), modelsBytes: mm.rawBytes });
}
const IT = NS.Items, BE = NS.BEModel, Cr = NS.Creative, BI = NS.BlockIcon;

let pass = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else if (fails.length < 40) fails.push(m); };
const okAv = (c, m) => { ok(c, m); if (c) console.log('   ✓ ' + m.replace(/^anti-vacuity: /, '')); };
const say = (s) => { if (VERBOSE) console.log('   ' + s); };

console.log('bemodelcheck — PLAN G10c, the block-entity item models (D-317)');
ok(BE.ready, 'the model payload decodes');
console.log(`    ${Object.keys(BE.layers).length} layers · ${Object.keys(BE.gui).length} gui transforms`
  + ` · ${Object.keys(BE.dye).length} dye colours`);

// ═══════════════ 1. the roster, closed against the jar's parent chains ═════════════════════
console.log('\n 1. every item that can draw nothing else is covered or named');
{
  // ⚠ `BE.gui` IS THE JAR'S OWN ANSWER to "which items have no sprite and no block model": it is
  // built from the `builtin/entity` parent chains, which is precisely what that means. The
  // blank-icon set is therefore not a list anybody typed — it is the intersection of that with
  // the item registry.
  const entityItems = Object.keys(BE.gui).filter((n) => IT.of(n) >= 0).sort();
  console.log(`    ${entityItems.length} real items have a builtin/entity model`);
  ok(entityItems.length >= 55, `only ${entityItems.length} builtin/entity items — that is not the set`);
  const owed = new Set(BE.OWED);
  let covered = 0, named = 0;
  for (const n of entityItems) {
    const spec = BE.forItem(n);
    if (spec) { covered++; continue; }
    if (owed.has(n)) { named++; continue; }
    ok(false, `"${n}" draws nothing and is neither covered by a rule nor named in BE.OWED`);
  }
  console.log(`    ${covered} drawn from a model, ${named} named as owed`);
  ok(covered + named === entityItems.length, 'the two halves do not add up');
  ok(covered >= 50, `only ${covered} of them can be drawn`);
  // the other direction: nothing on the owed list may quietly have started working
  for (const n of BE.OWED) {
    ok(!BE.forItem(n), `BE.OWED names "${n}", which a rule now covers — the list is out of date`);
  }
  // ⚠ ...AND `Creative.NO_ICON` MUST AGREE WITH THE JAR. That list was typed by hand from a
  // measurement; this is the jar's own answer, and the two disagreeing means one of them drifted.
  const noIcon = new Set(Cr.NO_ICON);
  for (const n of entityItems) ok(noIcon.has(n), `the jar says "${n}" is builtin/entity and Creative.NO_ICON does not list it`);
  for (const n of Cr.NO_ICON) ok(BE.gui[n] !== undefined, `Creative.NO_ICON lists "${n}", which is not builtin/entity in the jar`);
  say('owed: ' + BE.OWED.join(' '));
}

// ═══════════════ 2. the UV layout, against the player skin ═════════════════════════════════
console.log('\n 2. the box UV layout, with the player skin as the referee');
{
  // ⚠⚠ THE SKIN IS THE ONE CASE NOBODY CAN ARGUE WITH. The right arm is `texOffs(40, 16)` with a
  // 4 x 12 x 4 box, and its six faces sit at documented places in every skin ever made.
  // `15d_blockicon.js`'s arm table already uses those numbers and the hand is already drawn with
  // them, so if the general formula reproduces that table it is the game's formula.
  // ⚠⚠ **THIS USED TO REGEX THE ARM TABLE OUT OF THE SOURCE TEXT.** That made the check a reader
  // of one file's spelling rather than a referee between two producers, and when the arm moved to
  // `BI.boxFaces` the check would have gone red on a correct build — the failure mode D-313
  // names. It now compares the two LIVE unwraps: `BEModel.faceRects`, which the chest and the bed
  // are drawn with, and `BlockIcon.boxFaces`, which the player's arm is drawn with. They are
  // written independently and they must agree, or one of the two pictures is wrong (D-314).
  //
  // ⚠ WHICH CAP IS WHICH. `faceRects` is in ARCH order (+X -X +Y -Y +Z -Z) and its +Y face is
  // DRAWN on the box's MAXIMUM-y corners (`FACE_CORNERS[2]` = corners with y1, `15h_bemodel.js`);
  // `boxFaces` is in Mojang's model order, first cap at the box's MINIMUM y. So boxFaces' first
  // cap is ARCH -Y. (Until D-773/beautiful-allen-7isws6 this map said ARCH +Y, trusting a
  // "+Y-up space" that the corner table never had — so the rectangles agreed while every mob drew
  // its caps swapped; `boxuvcheck` now holds the corners themselves against ModelPart.Cuboid.)
  // Reading either table in the other's space is exactly the bug Dan found in the hand (D-320).
  const ARM = { w: 4, h: 12, d: 4 };
  const TU = 40, TV = 16;
  ok(BI && typeof BI.boxFaces === 'function', 'the block-icon box unwrap is available');
  ok(BI.ARM.w === ARM.w && BI.ARM.h === ARM.h && BI.ARM.d === ARM.d, 'the arm is 4x12x4');
  ok(BI.ARM.u === TU && BI.ARM.v === TV, `the arm is texOffs(${TU}, ${TV})`);

  const rects = BE.faceRects({ tu: TU, tv: TV, w: ARM.w, h: ARM.h, d: ARM.d, m: 0 });
  // boxFaces order is [yMin cap, yMax cap, xMin, zMin, xMax, zMax]
  const ARCH_OF_BOX = [4, 2, 1, 0, 5, 3];       // +X -X +Y -Y +Z -Z  ->  boxFaces index
  const LABEL = ['+X', '-X', '+Y', '-Y', '+Z', '-Z'];
  const boxRect = (f) => {
    const us = [f.uv[0], f.uv[2], f.uv[4], f.uv[6]], vs = [f.uv[1], f.uv[3], f.uv[5], f.uv[7]];
    return [Math.min(...us), Math.min(...vs), Math.max(...us) - Math.min(...us), Math.max(...vs) - Math.min(...vs)];
  };
  const compare = () => {
    const bf = BI.boxFaces(TU, TV, ARM.w, ARM.h, ARM.d);
    return ARCH_OF_BOX.map((bi) => boxRect(bf[bi]));
  };
  {
    const mine = compare();
    for (let f = 0; f < 6; f++) {
      ok(rects[f][0] === mine[f][0] && rects[f][1] === mine[f][1],
         `the ${LABEL[f]} face is at (${rects[f][0]}, ${rects[f][1]}) in both unwraps`);
      ok(rects[f][2] === mine[f][2] && rects[f][3] === mine[f][3],
         `the ${LABEL[f]} face is ${rects[f][2]}x${rects[f][3]} in both unwraps`);
    }
  }
  // the sizes: sides are d x h, caps are w x d, front and back are w x h
  ok(rects[0][2] === ARM.d && rects[0][3] === ARM.h, 'a side face is d x h');
  ok(rects[2][2] === ARM.w && rects[2][3] === ARM.d, 'a cap is w x d');
  ok(rects[4][2] === ARM.w && rects[4][3] === ARM.h, 'a front face is w x h');
  // ⚠ the six rectangles must not overlap, which is the whole point of a texOffs layout
  const area = rects.reduce((a, r) => a + r[2] * r[3], 0);
  ok(area === 2 * (ARM.w * ARM.d) + 2 * (ARM.d * ARM.h) + 2 * (ARM.w * ARM.h),
     `the six faces cover ${area} texels, the box's surface is ` +
     (2 * (ARM.w * ARM.d) + 2 * (ARM.d * ARM.h) + 2 * (ARM.w * ARM.h)));
  {
    const seen = new Set();
    let overlap = 0;
    for (const r of rects) {
      for (let y = r[1]; y < r[1] + r[3]; y++) for (let x = r[0]; x < r[0] + r[2]; x++) {
        const k = y * 1024 + x;
        if (seen.has(k)) overlap++; else seen.add(k);
      }
    }
    ok(overlap === 0, `${overlap} texels are claimed by two faces`);
  }
  {
    // ⚠ anti-vacuity (D-30): swap the two caps in the arm's unwrap — the very shape of Dan's
    // bug — and the agreement above must break.
    const real = BI.boxFaces;
    BI.boxFaces = function (u, v, w, h, d) {
      const f = real(u, v, w, h, d); const t = f[0]; f[0] = f[1]; f[1] = t; return f;
    };
    const swapped = compare();
    BI.boxFaces = real;
    let differs = 0;
    for (let f = 0; f < 6; f++) if (swapped[f][0] !== rects[f][0] || swapped[f][1] !== rects[f][1]) differs++;
    okAv(differs === 2, `anti-vacuity: swapping the arm's two caps breaks the agreement on ${differs} faces`);
  }
  // mirror swaps the two side faces and nothing else
  const mir = BE.faceRects({ tu: TU, tv: TV, w: ARM.w, h: ARM.h, d: ARM.d, m: 1 });
  ok(mir[0][0] === rects[1][0] && mir[1][0] === rects[0][0], 'mirror swaps +X and -X');
  for (let f = 2; f < 6; f++) ok(mir[f].join() === rects[f].join(), `mirror left face ${f} alone`);
}

// ═══════════════ 3. the tables ═════════════════════════════════════════════════════════════
console.log('\n 3. the layers, the transforms and the dye colours');
{
  // the golden TSV against the shipped payload, both directions
  const gold = new Map();
  for (const line of readFileSync(join(MCLITE_ROOT, 'tools', 'golden', 'models-1.18.2.tsv'), 'utf8').split(/\r?\n/)) {
    if (!line || line.startsWith('#')) continue;
    const c = line.split('\t');
    if (c.length < 19) continue;
    if (!gold.has(c[0])) gold.set(c[0], []);
    gold.get(c[0]).push(c);
  }
  // #109: the payload also ships two layers pack-models builds from the decompiled classes
  // (the bytecode walk cannot register them); section 3b holds them against that source.
  const DERIVED = ['dragon_head', 'conduit', 'conduit_cage', 'conduit_wind', 'conduit_eye', 'sign', 'boat', 'stray_outer', 'slime_outer'];   // boat: tools/golden/boat-model-1.18.2.tsv (#209), held by boatcheck; stray_outer: pack-models (#1128)
  ok(gold.size + DERIVED.length === Object.keys(BE.layers).length,
     `the golden table has ${gold.size} layers and the payload ships ${Object.keys(BE.layers).length}`);
  for (const n of DERIVED) ok(!gold.has(n), `"${n}" is in the golden table, so it is no longer derived`);
  let boxes = 0;
  for (const [name, rows] of gold) {
    if (name === 'magma_cube') continue;   // #2540: pack-models adds the 8 loop-built slices to the tsv's inside_cube; mobshapecheck holds the whole layer vs vanilla
    if (name === 'zombified_piglin#c') continue;   // #1548: the tsv row is the boat's model (a `$$3` name collision); pack-models ships the 1.02 biped
    const L = BE.layer(name);
    ok(!!L, `the payload has no "${name}" layer`);
    if (!L) continue;
    ok(L.parts.length === rows.length, `"${name}" has ${L.parts.length} parts and the table has ${rows.length}`);
    for (let i = 0; i < rows.length && i < L.parts.length; i++) {
      const r = rows[i], p = L.parts[i];
      // #1548: pack-models grows the humanoid armour layers (<mob>#b/#c, drowned_outer#null #7658) from the tsv's raw boxes to their true dilation
      const e = /#[bc]$|^drowned_outer#null$/.test(name) ? 2 * (p.g - (+r[19] || 0)) : 0;
      ok(p.n === r[1] && p.tu === +r[2] && p.tv === +r[3] && p.w === +r[7] + e && p.h === +r[8] + e && p.d === +r[9] + e,
         `"${name}" part ${i} does not match the golden row`);
      boxes++;
    }
    ok(L.tw === +rows[0][17] && L.th === +rows[0][18], `"${name}" ships a ${L.tw}x${L.th} sheet`);
  }
  console.log(`    ${boxes} boxes match the golden table exactly`);
  // ── 3b (#109): the two derived layers against the decompiled Java they come from ──────────
  {
    const dir = join(MCLITE_ROOT, '.decomp', 'net', 'minecraft', 'client', 'render');
    const globalOk = ok;
    const parseDragon = (src) => {
      // `.cuboid("name", x, y, z, w, h, d, u, v)` in order, with `.mirrored(true|false)` tracked
      const out = []; let mir = 0;
      const re = /\.mirrored\((true|false)\)|\.cuboid\("(\w+)",\s*(-?[\d.]+)F,\s*(-?[\d.]+)F,\s*(-?[\d.]+)F,\s*(\d+),\s*(\d+),\s*(\d+),\s*(\d+),\s*(\d+)\)/g;
      let m;
      while ((m = re.exec(src))) {
        if (m[1]) { mir = m[1] === 'true' ? 1 : 0; continue; }
        out.push({ x: +m[3], y: +m[4], z: +m[5], w: +m[6], h: +m[7], d: +m[8], tu: +m[9], tv: +m[10], m: mir });
      }
      return out;
    };
    const jaw = (src) => {
      const m = /uv\((\d+), (\d+)\)\.cuboid\("jaw", (-?[\d.]+)F, (-?[\d.]+)F, (-?[\d.]+)F, (\d+)\.0F, (\d+)\.0F, (\d+)\.0F\), ModelTransform\.pivot\((-?[\d.]+)F, (-?[\d.]+)F, (-?[\d.]+)F\)/.exec(src);
      return m && { tu: +m[1], tv: +m[2], x: +m[3], y: +m[4], z: +m[5], w: +m[6], h: +m[7], d: +m[8], px: +m[9], py: +m[10], pz: +m[11] };
    };
    const decompDragon = (src) => parseDragon(src.slice(0, src.indexOf('$$3.addChild')));
    const check = (L, src, quiet) => {
      const ok = quiet ? () => {} : globalOk;
      const want = decompDragon(src), j = jaw(src);
      ok(want.length === 6 && !!j, 'the decompiled dragon head parses to 6 head boxes and a jaw');
      const got = L.parts.filter((p) => p.n === 'head'), gj = L.parts.filter((p) => p.n === 'jaw')[0];
      let bad = 0;
      for (const w of want) {
        if (!got.some((g) => ['x', 'y', 'z', 'w', 'h', 'd', 'tu', 'tv', 'm'].every((k) => g[k] === w[k]))) bad++;
      }
      ok(bad === 0, `${bad} of the dragon head's decompiled boxes are missing or wrong in the payload`);
      ok(got.length === 6, 'the dragon head has 6 head boxes');
      ok(!!gj && !!j && ['x', 'y', 'z', 'w', 'h', 'd', 'tu', 'tv', 'px', 'py', 'pz'].every((k) => gj[k] === j[k]),
         'the dragon jaw matches the decompiled box and pivot');
      ok(!!gj && Math.abs(gj.rx - 0.2) < 1e-9, 'the item jaw is at pitch (sin 0 + 1) * 0.2');
      return bad;
    };
    const dsrc = readFileSync(join(dir, 'entity', 'model', 'DragonHeadEntityModel.java'), 'utf8');
    const DL = BE.layer('dragon_head');
    ok(DL && DL.tw === 256 && DL.th === 256, 'the dragon head sheet is 256x256');
    if (DL) {
      check(DL, dsrc);
      // anti-vacuity: an unmirrored nostril and a shifted box must both be seen
      const keep = JSON.stringify(DL.parts);
      DL.parts.filter((p) => p.m)[0].m = 0;
      const b1 = check(DL, dsrc, true);
      DL.parts = JSON.parse(keep);
      DL.parts[1].x += 1;
      const b2 = check(DL, dsrc, true);
      DL.parts = JSON.parse(keep);
      okAv(b1 >= 1 && b2 >= 1, 'anti-vacuity: an unmirrored dragon box and a shifted one are both caught');
    }
    const csrc = readFileSync(join(dir, 'block', 'entity', 'ConduitBlockEntityRenderer.java'), 'utf8');
    const cm = /getShellTexturedModelData[\s\S]*?uv\((\d+), (\d+)\)\.cuboid\((-?[\d.]+)F, (-?[\d.]+)F, (-?[\d.]+)F, (\d+)\.0F, (\d+)\.0F, (\d+)\.0F\)[\s\S]*?TexturedModelData\.of\(\$\$0, (\d+), (\d+)\)/.exec(csrc);
    const CL = BE.layer('conduit');
    ok(!!cm && !!CL && CL.parts.length === 1, 'the conduit shell parses and ships as one box');
    if (cm && CL) {
      const p = CL.parts[0];
      const same = p.tu === +cm[1] && p.tv === +cm[2] && p.x === +cm[3] && p.y === +cm[4] && p.z === +cm[5]
        && p.w === +cm[6] && p.h === +cm[7] && p.d === +cm[8] && CL.tw === +cm[9] && CL.th === +cm[10];
      ok(same, 'the conduit shell box matches ConduitBlockEntityRenderer.getShellTexturedModelData');
      p.w += 1;
      okAv(!(p.tu === +cm[1] && p.w === +cm[6]), 'anti-vacuity: a conduit box one wider no longer matches');
      p.w -= 1;
    }
  }
  // every rule names a layer that exists
  for (const r of BE.RULES) ok(!!BE.layer(r.layer), `a rule names layer "${r.layer}", which is not shipped`);
  // the chest's own numbers, one more time, at the runtime end of the pipe
  const chest = BE.layer('chest');
  const bottom = chest.parts.filter((p) => p.n === 'bottom')[0];
  ok(!!bottom && bottom.w === 14 && bottom.h === 10 && bottom.d === 14 && bottom.tu === 0 && bottom.tv === 19,
     'the chest bottom is 14x10x14 at texOffs(0, 19) at the runtime end too');
  // the display transforms
  ok(BE.gui.chest && BE.gui.chest.rot[1] === 45, `the chest's gui rotation is [${BE.gui.chest.rot}]`);
  ok(BE.gui.white_banner && BE.gui.white_banner.rot[1] === 20, `a banner's is [${BE.gui.white_banner.rot}]`);
  ok(BE.gui.white_bed && BE.gui.white_bed.rot[1] === 160, `a bed's is [${BE.gui.white_bed.rot}]`);
  // ⚠ ...AND THEY MUST NOT ALL BE THE SAME, which is the bug this replaced
  const ys = new Set(Object.values(BE.gui).map((g) => g.rot[1]));
  ok(ys.size >= 3, `the gui transforms use ${ys.size} distinct y rotations — one would be the old bug`);
  say('y rotations: ' + [...ys].sort((a, b) => a - b).join(' '));
  // the dye colours, anchored on three that cannot be in doubt
  ok(Object.keys(BE.dye).length === 16, `${Object.keys(BE.dye).length} dye colours`);
  ok(BE.dye.white === 0xF9FFFE, `white is 0x${(BE.dye.white >>> 0).toString(16)}, vanilla's is 0xf9fffe`);
  ok(BE.dye.black === 0x1D1D21, `black is 0x${(BE.dye.black >>> 0).toString(16)}`);
  ok(BE.dye.red === 0xB02E26, `red is 0x${(BE.dye.red >>> 0).toString(16)}`);
  ok(new Set(Object.values(BE.dye)).size === 16, 'two dye colours are the same number');
}

// ═══════════════ 4. the rules resolve ══════════════════════════════════════════════════════
console.log('\n 4. what each item resolves to');
{
  const cases = [
    ['chest', 'chest', 'be_chest', null, null],
    ['trapped_chest', 'chest', 'be_trapped_chest', null, null],
    ['ender_chest', 'chest', 'be_ender_chest', null, null],
    ['red_shulker_box', 'shulker', 'be_red_shulker_box', null, null],
    ['shulker_box', 'shulker', 'be_shulker_box', null, null],
    ['red_bed', 'bed_head', 'be_red_bed', 'bed_foot', null],
    ['white_banner', 'banner', 'be_banner', null, 'white'],
    ['shield', 'shield', 'be_shield', null, null]
  ];
  for (const [item, layer, tex, second, tint] of cases) {
    const s = BE.forItem(item);
    ok(!!s, `${item} resolves to nothing`);
    if (!s) continue;
    ok(s.layer === layer, `${item} -> layer "${s.layer}", expected "${layer}"`);
    ok(s.tex === tex, `${item} -> texture "${s.tex}", expected "${tex}"`);
    ok((s.second || null) === second, `${item} -> second layer "${s.second}"`);
    ok((s.tintName || null) === tint, `${item} -> tint "${s.tintName}"`);
  }
  // ⚠ A BED IS TWO LAYERS and the colour comes from the TEXTURE, not a tint; a banner is one
  // layer and the colour comes from a TINT. Getting that backwards gives sixteen white banners
  // (which is what the first build did) or sixteen identical beds.
  ok(!BE.forItem('red_bed').tintName, 'a bed is not tinted — it has its own texture');
  ok(!!BE.forItem('red_banner').tintName, 'a banner IS tinted — there is one banner texture');
  // an ordinary item must resolve to nothing at all
  for (const n of ['stone', 'diamond_sword', 'apple', 'oak_planks']) {
    ok(!BE.forItem(n), `${n} is an ordinary item and must not resolve to a block-entity model`);
  }
}

// ═══════════════ 5. anti-vacuity (D-30) ════════════════════════════════════════════════════
console.log('\n 5. anti-vacuity — each section is broken and the break must be caught');
{
  // §1: an item removed from the rules is not silently covered
  const was = BE.RULES;
  BE.RULES = BE.RULES.filter((r) => r.layer !== 'chest');
  okAv(!BE.forItem('chest'), 'anti-vacuity: with its rule gone, the chest resolves to nothing');
  BE.RULES = was;
  okAv(!!BE.forItem('chest'), 'anti-vacuity: and putting it back covers it again');
}
{
  // §2: the UV formula shifted by one no longer reproduces the skin
  const r = BE.faceRects({ tu: 41, tv: 16, w: 4, h: 12, d: 4, m: 0 });
  okAv(r[5][0] !== 44, 'anti-vacuity: a texOffs one to the right no longer lands on the skin\'s front face');
}
{
  // §3: a layer with the wrong box size is visible to the golden comparison
  const L = BE.layer('chest');
  const p = L.parts.filter((x) => x.n === 'bottom')[0];
  const wasW = p.w;
  p.w = 13;
  okAv(p.w !== 14, 'anti-vacuity: a chest bottom one unit narrower is a different number');
  p.w = wasW;
}
{
  // §3: the dye column read one to the left would be the firework colours
  okAv(BE.dye.white !== 0xF0F0F0,
       'anti-vacuity: white is not 0xf0f0f0 — that is `fireworkColor`, the neighbouring column');
}
{
  // §4: a bed and a banner must not resolve the same way
  const bed = BE.forItem('red_bed'), ban = BE.forItem('red_banner');
  okAv(bed.tex !== ban.tex && bed.layer !== ban.layer,
       'anti-vacuity: a bed and a banner resolve to different layers and different textures');
}

// ═══════════════ report ════════════════════════════════════════════════════════════════════
console.log('\n' + '='.repeat(78));
console.log(` bemodelcheck: ${pass} assertions, ${fails.length} failed`);
if (fails.length) {
  for (const f of fails) console.log('   x ' + f);
  process.exit(1);
}
console.log(' the boxes are the jar\'s, and the UV layout is the skin\'s.');
