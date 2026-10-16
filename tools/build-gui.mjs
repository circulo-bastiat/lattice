#!/usr/bin/env node
// build-gui.mjs — PLAN G11. Vanilla's GUI sheets and its bitmap font, into one payload.
//
//   node tools/build-gui.mjs [--jar ...] [--out assets]
//
// ── WHY THE 1.13.2 JAR ──────────────────────────────────────────────────────────────────────
// D-5: the textures are the pre-1.14 ones, from Dan's own game files. The GUI is where that
// choice is most visible — 1.14 redrew the hotbar, the hearts and the buttons — so these come
// from 1.13.2 exactly like the block atlas does, and `--jar` names the source in the report so
// nobody has to guess which game a screenshot is of.
//
// ── WHAT SHIPS, AND WHY IT IS THIS SHORT A LIST ─────────────────────────────────────────────
// D-12 counts every kilobyte. Seven sheets cover everything G11 draws:
//   widgets.png            the hotbar, the selector, the buttons
//   icons.png              hearts, hunger, armour, the XP bar, the crosshair, the effect frames
//   container/inventory    the player's own screen — the one G8's click machine has been
//                          driving with nothing to look at
//   container/crafting_table   G9's 3x3
//   container/furnace          G9's smelter
//   container/generic_54       chests, and the shape every future container copies
//   font/ascii.png         the legacy bitmap font
//   entity/steve.png       the default skin, for the inventory's player preview (D-278)
// Everything else — the recipe book, advancements, the villager trade screen — belongs to stages
// that do not exist yet, and a sheet nothing draws is 256 KB of nothing.
//
// ── THE GLYPH WIDTHS ARE MEASURED, NOT TABLED ───────────────────────────────────────────────
// ⚠ Vanilla's legacy font is a 16x16 grid of 8x8 glyphs and the per-character width is NOT in any
// file: `FontTexture` scans each cell from the right for the first column with a non-transparent
// pixel. That is done HERE, once, at build time, so the runtime carries 256 bytes instead of a
// scan — and so the widths are the font's own rather than a table somebody typed. The space
// character has no pixels at all and gets vanilla's hard-coded 4.

import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { deflateRawSync, inflateRawSync } from 'node:zlib';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Jar } from './jarlib.mjs';
import { decodePng } from './png.mjs';
import { JARS as MCLITE_JARS } from './paths.mjs';

const MCLITE_ROOT = fileURLToPath(new URL('..', import.meta.url));
const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const jarPath = (v) => {
  const flat = MCLITE_JARS + '/' + v + '.jar';
  const nested = MCLITE_JARS + '/' + v + '/' + v + '.jar';
  return existsSync(flat) ? flat : nested;
};
const JAR = opt('jar', jarPath('1.13.2'));
const OUT = opt('out', join(MCLITE_ROOT, 'assets'));
mkdirSync(OUT, { recursive: true });

const t0 = Date.now();
const jarOld = new Jar(JAR);
// ⚠ D-414 — THE BLAST FURNACE AND THE SMOKER SHIP NO SHEET OF THEIR OWN. Vanilla has a
// `blast_furnace.png` and a `smoker.png` (1.14+, so not in the 1.13.2 jar above) and all three
// container sheets are PIXEL-IDENTICAL in 1.18.2 — so the three screens draw from `furnace`, and
// this asserts the identity against the 1.18.2 jar rather than trusting it (a 1.19+ jar that drew
// them differently would stop the build here instead of shipping the wrong picture).
const JAR_NEW = opt('new', jarPath('1.18.2'));
const jarNew = existsSync(JAR_NEW) ? new Jar(JAR_NEW) : null;

const SHEETS = [
  ['widgets', 'assets/minecraft/textures/gui/widgets.png'],
  // G11 (#366) - `Slot.getBackgroundSprite`: the empty-armour-slot outlines PlayerScreenHandler
  // gives the four armour slots and the offhand. 16x16 each, drawn under an empty slot.
  ['empty_helmet', 'assets/minecraft/textures/item/empty_armor_slot_helmet.png'],
  ['empty_chestplate', 'assets/minecraft/textures/item/empty_armor_slot_chestplate.png'],
  ['empty_leggings', 'assets/minecraft/textures/item/empty_armor_slot_leggings.png'],
  ['empty_boots', 'assets/minecraft/textures/item/empty_armor_slot_boots.png'],
  ['empty_shield', 'assets/minecraft/textures/item/empty_armor_slot_shield.png'],
  ['icons', 'assets/minecraft/textures/gui/icons.png'],
  // #1584 - BossBarHud's sheet: 182x5 bar rows, colour ordinal * 10 (bg) and + 5 (fill).
  ['bars', 'assets/minecraft/textures/gui/bars.png'],
  ['inventory', 'assets/minecraft/textures/gui/container/inventory.png'],
  ['crafting_table', 'assets/minecraft/textures/gui/container/crafting_table.png'],
  ['furnace', 'assets/minecraft/textures/gui/container/furnace.png'],
  ['generic_54', 'assets/minecraft/textures/gui/container/generic_54.png'],
  // PASS 17 JOB 1 (G19b) — the shulker box's OWN screen background. Unlike the barrel
  // (D-403, which reuses generic_54.png because no separate barrel texture exists in the jar),
  // vanilla DOES ship a distinct 'shulker_box.png' (confirmed present in the 1.13.2 jar) — same
  // 176x166 27-slot layout as generic_54, different colour, so it is its own sheet rather than a
  // reused one.
  ['shulker_box', 'assets/minecraft/textures/gui/container/shulker_box.png'],
  // PASS 17 JOB 1 (G19b) — the HOPPER's own screen background. 176 wide and only 133 tall: five
  // slots in a row and then the player-inventory footer, with no room above it, which is why it
  // cannot borrow any of the sheets above. Present in the 1.13.2 jar under its own name.
  ['hopper', 'assets/minecraft/textures/gui/container/hopper.png'],
  // PASS 17 JOB 1 (G19b) — the DISPENSER's own screen background, which the DROPPER shares.
  // 176 x 166 with a 3x3 grid instead of the crafting table's, and vanilla ships no
  // `dropper.png` at all: `DropperScreen` is `DispenserScreen` with a different title, which is
  // asserted below rather than assumed.
  ['dispenser', 'assets/minecraft/textures/gui/container/dispenser.png'],
  // G22d — the ANVIL's own screen background (176 x 166; the name-field plate at (0,166) and the
  // red cross at (176,0), both in the sheet's margin). Present in the 1.13.2 jar.
  ['anvil', 'assets/minecraft/textures/gui/container/anvil.png'],
  // PASS 17 JOB 1 (G19b) — the BREWING STAND's own screen background, 176 x 166, with the fuel
  // gauge, the down-arrow and the bubbles as sprites in the margin at x=176 (`BrewingStandScreen`
  // blits them from (176,0), (176,29) and (185,0)). Present in the 1.13.2 jar under this name.
  ['brewing_stand', 'assets/minecraft/textures/gui/container/brewing_stand.png'],
  // D-48x (row 0 item 5 / G18f GUI polish) — THE TRADING SCREEN'S BACKGROUND, jar-verified.
  // `container/villager.png` (256x256 sheet) is present in the 1.13.2 jar under its PRE-1.14
  // name (1.14's Village & Pillage rework renamed and redrew it as the wider `villager2.png`,
  // which this project does not ship — D-5's whole-game 1.13.2 art-era choice applies here
  // exactly like every other sheet in this list). `clq` (GuiMerchant, javap'd off
  // `jars/1.13.2/1.13.2.jar`) never overrides `cky`'s (GuiContainer) default `xSize`/`ySize` —
  // read directly off `cky`'s own constructor (`sipush 176`/`sipush 166`) — so the panel is
  // vanilla's ordinary 176x166, not 1.14's widened 276x166. Only the BACKGROUND is wired this
  // unit: `clq`'s own `clq$1`/`clq$2` inner classes (two on-screen widgets at
  // guiLeft+147,guiTop+23 and guiLeft+17,guiTop+23) and the real slot table in its Container
  // (`aof`, unread) were found but NOT reached — named on `Trade.OWED`, not guessed at.
  ['merchant', 'assets/minecraft/textures/gui/container/villager.png'],
  // QUEUE 0.2 (G18e remainder) -- THE HORSE INVENTORY SCREEN'S OWN BACKGROUND, jar-verified.
  // `efp` (HorseScreen, .decomp Yarn names) names its own texture directly: `TEXTURE = new
  // Identifier("textures/gui/container/horse.png")` -- present in the 1.13.2 jar under this
  // same pre-1.14 name (unlike villager.png/villager2.png, horse.png was never renamed by
  // Village & Pillage), so D-5's whole-game 1.13.2 art-era choice applies here exactly like
  // every other sheet in this list. `HandledScreen`'s own unoverridden default
  // (backgroundWidth/backgroundHeight, .decomp) makes the panel 176x166 -- vanilla's ordinary
  // container size again, same as `merchant` above.
  ['horse', 'assets/minecraft/textures/gui/container/horse.png'],
  // ⚠ PLAN G11b — THE CREATIVE INVENTORY, four sheets. `tab_items` is the 195x136 panel every
  // item tab uses, `tab_item_search` the same panel with the search box drawn into it,
  // `tab_inventory` the survival tab's own 2x2-and-armour panel, and `tabs` the 6x2 strip of
  // 28x32 tab buttons in four states (top/bottom row x selected/not) plus the two scroller
  // sprites. They are 256x256 and almost entirely transparent, so they cost about a kilobyte
  // each deflated — and without them the one screen a creative player lives in has to be drawn
  // with rectangles, which is precisely what D-274 exists to stop.
  ['creative_items', 'assets/minecraft/textures/gui/container/creative_inventory/tab_items.png'],
  ['creative_search', 'assets/minecraft/textures/gui/container/creative_inventory/tab_item_search.png'],
  ['creative_inv', 'assets/minecraft/textures/gui/container/creative_inventory/tab_inventory.png'],
  ['creative_tabs', 'assets/minecraft/textures/gui/container/creative_inventory/tabs.png'],
  ['ascii', 'assets/minecraft/textures/font/ascii.png'],
  // PLAN G22 — THE ENCHANTING TABLE. Its screen sheet, the Standard Galactic alphabet the three
  // buttons print their clue in (`font/alt.json` is one bitmap provider over `ascii_sga.png`, the
  // same 16x16 grid of 8x8 cells as `ascii.png`, so its widths are scanned the same way), and the
  // enchantment glint that scrolls over an enchanted stack.
  ['enchanting_table', 'assets/minecraft/textures/gui/container/enchanting_table.png'],
  ['ascii_sga', 'assets/minecraft/textures/font/ascii_sga.png'],
  ['enchant_glint', 'assets/minecraft/textures/misc/enchanted_item_glint.png'],
  // ⚠ THE DEFAULT SKIN, and it is here for one screen. Vanilla's inventory draws the player into
  // a black window in `inventory.png` — the black is the TEXTURE's, not a bug — and with nothing
  // drawn into it the player's own screen has a black hole in the middle of it. 16 KB raw, about
  // one and a half deflated, and it is the difference between "the inventory" and "the inventory,
  // with you in it". D-278 says what is and is not drawn from it.
  ['steve', 'assets/minecraft/textures/entity/steve.png'],
  // ⚠ PLAN G16b — THE SUN AND THE MOON. They are not GUI sheets and they are here anyway,
  // because this is the project's one "decode a PNG out of the jar and hand it to the runtime"
  // pipeline and a second one would be a second copy of the deflate, the header and the round
  // trip (D-139's argument, applied before the duplication rather than after it). 32x32 and
  // 128x64 — about five kilobytes deflated between them. `moon_phases` is a FOUR-BY-TWO grid
  // and the moon's phase indexes it; `Sky.moonUV` does the arithmetic.
  ['sun', 'assets/minecraft/textures/environment/sun.png'],
  ['moon_phases', 'assets/minecraft/textures/environment/moon_phases.png'],
];

const fail = [];
const images = {};
let rawBytes = 0;
// ── PLAN G10c — THE BLOCK-ENTITY TEXTURES ───────────────────────────────────────────────────
// ⚠ SIXTY ITEMS IN THE CREATIVE INVENTORY DRAW NOTHING WITHOUT THESE. Chests, shulker boxes,
// beds, banners and the shield are `builtin/entity` in vanilla: no item sprite, no block model,
// drawn by a block-entity renderer out of an ENTITY texture and a box model. `extract-models`
// supplies the boxes; these are the pixels. About 40 sheets of 64x64, which deflate to a few tens
// of kilobytes because they are mostly the same wood and the same shading.
//
// ⚠ THE COLOUR LIST IS THE DYE TABLE'S, NOT A LIST TYPED HERE (D-313's lesson). It is read out of
// `tools/golden/dye-colours-1.18.2.tsv`, which `extract-colours.mjs` pulled out of the bytecode,
// and the count is asserted at 16 in both directions — so a bed colour cannot go missing without
// the build stopping.
const DYES = (() => {
  const f = join(MCLITE_ROOT, 'tools', 'golden', 'dye-colours-1.18.2.tsv');
  const out = [];
  for (const line of readFileSync(f, 'utf8').split(/\r?\n/)) {
    if (!line || line.startsWith('#')) continue;
    const c = line.split('\t');
    if (c[0]) out.push(c[0]);
  }
  return out;
})();
if (DYES.length !== 16) {
  console.error('build-gui: the dye table has ' + DYES.length + ' colours, vanilla has 16 —'
    + ' run tools/extract-colours.mjs');
  process.exit(1);
}
const ENTITY_TEX = [
  ['be_chest', 'assets/minecraft/textures/entity/chest/normal.png'],
  ['be_chest_left', 'assets/minecraft/textures/entity/chest/normal_double.png'],
  ['be_trapped_chest', 'assets/minecraft/textures/entity/chest/trapped.png'],
  ['be_ender_chest', 'assets/minecraft/textures/entity/chest/ender.png'],
  ['be_shulker_box', 'assets/minecraft/textures/entity/shulker/shulker.png'],
  ['be_banner', 'assets/minecraft/textures/entity/banner_base.png'],
  ['be_shield', 'assets/minecraft/textures/entity/shield_base_nopattern.png'],
  // ⚠ THE FOUR MOB HEADS (D-324). The player head reuses `steve`, which is already here for the
  // inventory preview and the first-person arm, so five of the six heads cost four textures.
  // The dragon head and the conduit follow (#109): their layers are built in pack-models.
  ['be_skeleton_skull', 'assets/minecraft/textures/entity/skeleton/skeleton.png'],
  ['be_wither_skeleton_skull', 'assets/minecraft/textures/entity/skeleton/wither_skeleton.png'],
  ['be_zombie_head', 'assets/minecraft/textures/entity/zombie/zombie.png'],
  ['be_creeper_head', 'assets/minecraft/textures/entity/creeper/creeper.png'],
  ['be_dragon_head', 'assets/minecraft/textures/entity/enderdragon/dragon.png'],
  ['be_conduit', 'assets/minecraft/textures/entity/conduit/base.png'],
  // #5541: the active conduit's cage, two wind sheets and the open/closed eye
  ['be_conduit_cage', 'assets/minecraft/textures/entity/conduit/cage.png'],
  ['be_conduit_wind', 'assets/minecraft/textures/entity/conduit/wind.png'],
  ['be_conduit_wind_vertical', 'assets/minecraft/textures/entity/conduit/wind_vertical.png'],
  ['be_conduit_open_eye', 'assets/minecraft/textures/entity/conduit/open_eye.png'],
  ['be_conduit_closed_eye', 'assets/minecraft/textures/entity/conduit/closed_eye.png'],
];
for (const d of DYES) {
  ENTITY_TEX.push(['be_' + d + '_bed', 'assets/minecraft/textures/entity/bed/' + d + '.png']);
  ENTITY_TEX.push(['be_' + d + '_shulker_box',
                   'assets/minecraft/textures/entity/shulker/shulker_' + d + '.png']);
}
for (const e of ENTITY_TEX) SHEETS.push(e);

// #891 (KW-49-4c) -- THE BANNER PATTERN LAYERS. One sheet per `BannerPattern` that has a texture
// (`bp_<name>`, 1.18.2's `entity/banner/<name>.png`: the 1.13.2 jar lacks globe and piglin). The
// list is read out of `.decomp/.../BannerPattern.java`'s own constants, not typed here; the
// compositor is `BE.composite` (tint x texture, source-over, in `BannerBlockEntityRenderer`'s order).
const BANNER_PATTERNS = (() => {
  const f = join(MCLITE_ROOT, 'tools', 'golden', 'banner-patterns-1.18.2.tsv');
  const out = [];
  for (const line of readFileSync(f, 'utf8').split(/\r?\n/)) {
    if (!line || line.startsWith('#')) continue;
    const c = line.split('\t');
    if (c[0] && c[2] === '1') out.push(c[0]);
  }
  return out;
})();
const BANNER_SHEETS = BANNER_PATTERNS.map((n) => ['bp_' + n, 'assets/minecraft/textures/entity/banner/' + n + '.png']);

for (const e of BANNER_SHEETS) SHEETS.push(e);

// #892 (KW-49-4d) -- THE SHIELD'S PATTERN LAYERS. `BannerRenderer.renderShield` draws `shield_base.png`
// (tinted by the stack's `BlockEntityTag.Base`) and then each pattern's `entity/shield/<name>.png`.
// `sp_<name>` are the pattern sheets, `be_shield_base` the patterned base; both come from the 1.18.2 jar.
const SHIELD_SHEETS = BANNER_PATTERNS.map((n) => ['sp_' + n, 'assets/minecraft/textures/entity/shield/' + n + '.png']);
SHIELD_SHEETS.push(['be_shield_base', 'assets/minecraft/textures/entity/shield_base.png']);
for (const e of SHIELD_SHEETS) SHEETS.push(e);

for (const [name, path] of SHEETS) {
  const jar = (name.startsWith('bp_') || name.startsWith('sp_') || name === 'be_shield_base') && jarNew ? jarNew : jarOld;
  if (!jar.has(path)) { fail.push(`${path} is not in ${JAR}`); continue; }
  const img = decodePng(jar.read(path));
  if (!img || !img.data) { fail.push(`${path} did not decode`); continue; }
  images[name] = { w: img.width, h: img.height, data: img.data };
  rawBytes += img.data.length;
}
// #197 (G22e) -- the GRINDSTONE screen: added in 1.14, so it is only in the 1.18.2 jar (vanilla
// `GrindstoneScreen.TEXTURE`); the red "no result" X sprite sits at (176,0) 28x21.
if (jarNew) {
  const gp = 'assets/minecraft/textures/gui/container/grindstone.png';
  const gi = jarNew.has(gp) ? decodePng(jarNew.read(gp)) : null;
  if (!gi || !gi.data) fail.push(gp + ' is not in ' + JAR_NEW);
  else { images.grindstone = { w: gi.width, h: gi.height, data: gi.data }; rawBytes += gi.data.length; SHEETS.push(['grindstone', gp]); }
}
if (jarNew) {
  const ref = decodePng(jarNew.read('assets/minecraft/textures/gui/container/furnace.png'));
  for (const n of ['blast_furnace', 'smoker']) {
    const other = decodePng(jarNew.read('assets/minecraft/textures/gui/container/' + n + '.png'));
    if (!other || Buffer.compare(Buffer.from(other.data), Buffer.from(ref.data)) !== 0) {
      fail.push(n + '.png is NOT pixel-identical to furnace.png in ' + JAR_NEW + ' — it needs its own sheet (D-414)');
    }
  }
}
if (fail.length) {
  console.error('build-gui: ' + fail.length + ' failures');
  for (const f of fail) console.error('   x ' + f);
  process.exit(1);
}

// ── the glyph widths, measured out of ascii.png ─────────────────────────────────────────────
function measureWidths(img) {
  const cell = img.w / 16;                    // 8 for a 128x128 sheet
  const widths = new Uint8Array(256);
  for (let ch = 0; ch < 256; ch++) {
    const cx = (ch % 16) * cell, cy = ((ch / 16) | 0) * cell;
    let last = -1;
    for (let x = 0; x < cell; x++) {
      for (let y = 0; y < cell; y++) {
        const i = ((cy + y) * img.w + (cx + x)) * 4;
        if (img.data[i + 3] > 0) { last = x; break; }
      }
    }
    // vanilla: the advance is the last inked column + 1, plus one pixel of spacing; a blank cell
    // is 0 except for the space, which it hard-codes at 4.
    widths[ch] = last < 0 ? (ch === 32 ? 4 : 0) : (last + 2);
  }
  return widths;
}
const ascii = images.ascii;
const cell = ascii.w / 16;
const widths = measureWidths(ascii);
const widthsSga = measureWidths(images.ascii_sga);
// ⚠ ANCHORS, asserted before anything is written. These are the widths every Minecraft screenshot
// has had since 2011, and a scan that had drifted by one would silently misalign every string.
const anchors = { 32: 4, 33: 2, 44: 2, 46: 2, 58: 2, 105: 2, 108: 3, 116: 4, 65: 6, 87: 6, 64: 7 };
const wFail = [];
for (const k of Object.keys(anchors)) {
  if (widths[+k] !== anchors[k]) {
    wFail.push(`glyph ${k} ("${String.fromCharCode(+k)}") measured ${widths[+k]}, expected ${anchors[k]}`);
  }
}
let inked = 0;
for (let i = 33; i < 127; i++) if (widths[i] > 0) inked++;
if (inked < 90) wFail.push(`only ${inked} of the 94 printable ASCII glyphs have any ink`);
if (wFail.length) {
  console.error('build-gui: the font scan is wrong — NOT written');
  for (const f of wFail) console.error('   x ' + f);
  process.exit(1);
}

// ── pack ────────────────────────────────────────────────────────────────────────────────────
// One blob: a JSON header naming each sheet and its offset, then the RGBA runs end to end.
const order = SHEETS.map(([n]) => n);
const header = { v: '1.13.2', sheets: [], widths: Array.from(widths), widthsSga: Array.from(widthsSga), cell: cell };
let off = 0;
for (const n of order) {
  header.sheets.push({ n: n, w: images[n].w, h: images[n].h, o: off, len: images[n].data.length });
  off += images[n].data.length;
}
const headerJson = Buffer.from(JSON.stringify(header), 'utf8');
const body = Buffer.alloc(off);
let p = 0;
for (const n of order) { Buffer.from(images[n].data).copy(body, p); p += images[n].data.length; }
const whole = Buffer.concat([
  Buffer.from(new Uint32Array([headerJson.length]).buffer), headerJson, body,
]);
const deflated = deflateRawSync(whole, { level: 9 });
if (Buffer.compare(inflateRawSync(deflated), whole) !== 0) {
  console.error('build-gui: deflate round trip did not match');
  process.exit(1);
}
writeFileSync(join(OUT, 'gui.bin'), deflated);
writeFileSync(join(OUT, 'gui.meta.json'), JSON.stringify({
  jar: JAR, rawBytes: whole.length, deflated: deflated.length,
  sheets: header.sheets.map((s) => ({ n: s.n, w: s.w, h: s.h })),
  cell, inkedGlyphs: inked,
}, null, 2));

console.log('================== build-gui ==================');
for (const s of header.sheets) console.log('   ' + s.n.padEnd(16) + s.w + 'x' + s.h);
console.log(' glyphs with ink .... ' + inked + ' of 94 printable, cell ' + cell + 'px');
console.log(' gui.bin ............ ' + (whole.length / 1024).toFixed(1) + ' KB raw -> '
  + (deflated.length / 1024).toFixed(1) + ' KB deflated');
console.log(' ' + (Date.now() - t0) + ' ms  ->  ' + join(OUT, 'gui.bin'));
console.log('==============================================');
