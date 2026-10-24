#!/usr/bin/env node
// mapcontentcheck.mjs — #229 G18f-b: 07pm_mapcontent.js (MapColor table + fillExplorationMap).
//   1. COLORS/BRIGHTNESS equal the ids/values parsed straight out of .decomp MapColor.java
//   2. renderColor/colorByte/center follow the decomp formulas
//   3. fillExploration on synthetic worlds: hatching, coast, all-land, all-ocean behave as the loop says
//   4. WIRING: a real Trade map offer's tag renders to pixels off the real biome grid
//   5. anti-vacuity: broken table / broken fill are caught ("<n> breaks caught")
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MCLITE_ROOT } from './loadsrc.mjs';

let pass = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); return !!c; };
let breaks = 0;
const okAv = (c, m) => { breaks++; if (ok(c, 'anti-vacuity: ' + m)) console.log('   ✓ break caught: ' + m); };

// standalone: the module needs no registry/assets, so this loads the REAL file alone
const NSx = {};
new Function('MCL', readFileSync(join(MCLITE_ROOT, 'src/07pm_mapcontent.js'), 'utf8'))(NSx);
const MC = NSx.MapContent;
ok(!!MC, 'NS.MapContent missing');

const src = readFileSync(join(MCLITE_ROOT, '.decomp/net/minecraft/block/MapColor.java'), 'utf8');
const table = [...src.matchAll(/new MapColor\((\d+), (\d+)\);/g)].map((m) => [+m[1], +m[2]]);
const bright = [...src.matchAll(/field_\d+\((\d), (\d+)\)/g)].map((m) => [+m[1], +m[2]]);
ok(table.length === 62, 'expected 62 MapColor rows in decomp, got ' + table.length);
ok(bright.length === 4, 'expected 4 Brightness rows, got ' + bright.length);

const tableOk = (mc) => table.every(([id, c]) => mc.COLORS[id] === c) && mc.COLORS.length === table.length &&
  bright.every(([id, b]) => mc.BRIGHTNESS[id] === b);
ok(tableOk(MC), 'MapColor/Brightness table differs from .decomp');

// renderColor: decomp getRenderColor — channels scaled, then RED and BLUE swapped (ABGR)
const refRender = (b) => {
  const id = (b & 255) >> 2; if (id === 0) return 0;
  const [, c] = table.find((t) => t[0] === id) || [0, 0]; const k = bright[b & 3][1];
  const r = ((c >> 16 & 255) * k / 255) | 0, g = ((c >> 8 & 255) * k / 255) | 0, bl = ((c & 255) * k / 255) | 0;
  return (0xFF000000 | bl << 16 | g << 8 | r) >>> 0;
};
let renderOk = true;
for (let b = 0; b < 256; b++) if (b >> 2 <= 61 && MC.renderColor(b) !== refRender(b)) renderOk = false;
ok(renderOk, 'renderColor differs from the decomp formula');
ok(MC.renderColor(0) === 0 && MC.renderColor(3) === 0, 'CLEAR must render 0 at every brightness');
ok(MC.colorByte(15, 3) === 63 && MC.colorByte(26, 0) === 104, 'colorByte = id<<2|brightness');
// MapState.of: scale 2 -> 512-wide; x=0 -> floor(64/512)=0 -> centre 256-64=192
ok(MC.center(0, 0, 2).x === 192 && MC.center(-100, 700, 2).x === -320 && MC.center(-100, 700, 2).z === 704, 'MapState.of centre snap');
ok(MC.center(0, 0, 0).x === 0 && MC.center(63, 0, 0).x === 0 && MC.center(64, 0, 0).x === 128, 'scale-0 centre snap');

// ---- 3. synthetic worlds ----
const O = MC.ORANGE, BR = MC.BROWN;
const allLand = MC.fillExploration(0, 0, 0, () => 'plains');
ok(allLand.every((v) => v === 0), 'all-land map must stay CLEAR');
const allSea = MC.fillExploration(0, 0, 0, () => 'ocean');
// interior: n=8 -> odd rows CLEAR; even rows painted orange with hatch brightness; border ring CLEAR
ok(allSea[5 * 128 + 5] === 0, 'all-ocean odd row interior must be CLEAR');
ok((allSea[4 * 128 + 5] >> 2) === O, 'all-ocean even row interior must be ORANGE');
ok(allSea[0] === 0 && allSea[4 * 128] === 0 && allSea[4 * 128 + 127] === 0, 'border ring never painted');
// half-plane: ocean where x < 64 (world x = column at scale 0, centre 0 -> x0=-64)
const half = MC.fillExploration(0, 0, 0, (x) => x < 0 ? 'river' : 'plains');
// column 63 = ocean edge (x=-1): 5 water neighbours -> n=5 -> brightness 0 (n>3), ORANGE
ok(half[10 * 128 + 63] === MC.colorByte(O, 0), 'ocean coast n=5 -> ORANGE LOW, got ' + half[10 * 128 + 63]);
// column 64 = first land: 3 water neighbours -> BROWN, n<=3 -> LOWEST(3)
ok(half[10 * 128 + 64] === MC.colorByte(BR, 3), 'first land column -> BROWN LOWEST, got ' + half[10 * 128 + 64]);
ok(half[10 * 128 + 66] === 0, 'land two cells from water stays CLEAR');
// column 62 is fully enclosed (n=8): odd row CLEAR, even row hatched ORANGE
ok(half[11 * 128 + 62] === 0 && (half[10 * 128 + 62] >> 2) === O, 'n=8 -> odd row CLEAR, even row hatched');
// swamp counts as aquatic, forest does not
const sw = MC.fillExploration(0, 0, 0, (x) => x < 0 ? 'swamp' : 'forest');
ok(sw[10 * 128 + 63] === half[10 * 128 + 63], 'swamp must count as aquatic like river/ocean');
// hatch phase: row 4 columns cycle brightness by ((px + (int)(sin(4)*7))/8 % 5)
const hatch = new Set(); for (let px = 2; px < 126; px++) hatch.add(allSea[4 * 128 + px] & 3);
ok(hatch.has(0) && hatch.has(1) && hatch.has(2), 'hatch rows must use LOW, NORMAL and HIGH brightness');

// ---- 4. colorsFor: tag -> pixels via the categoryAt hook, memoised ----
{
  const tag = { scale: 2, target: { x: 1000, z: -2000 } };
  const saved = MC.categoryAt;
  MC.categoryAt = () => 'ocean';
  const c1 = MC.colorsFor(tag);
  ok(c1 && c1.length === 16384 && c1[4 * 128 + 5] !== 0, 'colorsFor renders through the categoryAt hook');
  ok(MC.colorsFor(tag) === c1, 'colorsFor memoises per (scale, centre)');
  ok(MC.colorsFor(null) === null, 'no tag -> null');
  MC.categoryAt = saved;
}

// ---- 5. anti-vacuity ----
{
  const bad = JSON.parse(JSON.stringify({ COLORS: MC.COLORS, BRIGHTNESS: MC.BRIGHTNESS }));
  bad.COLORS[26] ^= 1; okAv(!tableOk(bad), 'one flipped colour bit must fail the table check');
  const b2 = { COLORS: MC.COLORS.slice(0, 61), BRIGHTNESS: MC.BRIGHTNESS }; okAv(!tableOk(b2), 'truncated table must fail');
  const b3 = { COLORS: MC.COLORS, BRIGHTNESS: [180, 220, 255, 136] }; okAv(!tableOk(b3), 'wrong LOWEST brightness must fail');
  const saved = MC.renderColor, savedB = MC.BRIGHTNESS;
  MC.BRIGHTNESS = [220, 180, 255, 135];
  okAv(MC.renderColor(MC.colorByte(15, 0)) !== refRender(MC.colorByte(15, 0)), 'swapped brightness changes rendered pixel');
  MC.BRIGHTNESS = savedB;
  const savedO = MC.ORANGE; MC.ORANGE = 16;
  const broken = MC.fillExploration(0, 0, 0, (x) => x < 0 ? 'river' : 'plains');
  okAv(broken[10 * 128 + 63] !== MC.colorByte(15, 0), 'wrong ORANGE id changes the coast pixel');
  MC.ORANGE = savedO;
  const broken2 = MC.fillExploration(0, 0, 0, (x) => x < 0 ? 'forest' : 'plains');
  okAv(broken2[10 * 128 + 63] !== half[10 * 128 + 63], 'non-aquatic category must not paint the coast');
  void saved;
}

console.log('mapcontentcheck: ' + pass + ' assertions, ' + fails.length + ' failed');
console.log(breaks + ' breaks caught');
for (const f of fails) console.log('FAIL ' + f);
process.exit(fails.length ? 1 : 0);
