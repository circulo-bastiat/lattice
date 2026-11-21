#!/usr/bin/env node
// ssread.mjs — print the debug dump embedded in a `/ss` png (#1890).
//   node tools/ssread.mjs <file.png> [--json] [--map]
// Default: a plain-English summary. --json: the whole dump. --map: the section-draw maps (what was drawn,
// what the visibility flood hid) as text. The dump lives in the png's `tEXt` chunk `mclite-dump`
// (src/15j_ss.js SS.embed); nothing here depends on the game.
import { readFileSync } from 'node:fs';

const file = process.argv[2];
if (!file) { console.error('usage: node tools/ssread.mjs <file.png> [--json] [--map]'); process.exit(2); }
const png = readFileSync(file);
if (png.readUInt32BE(0) !== 0x89504e47) { console.error('not a png'); process.exit(2); }
let pos = 8, text = null;
while (pos + 8 <= png.length) {
  const len = png.readUInt32BE(pos), type = png.toString('latin1', pos + 4, pos + 8);
  if (type === 'tEXt') {
    const body = png.subarray(pos + 8, pos + 8 + len), z = body.indexOf(0);
    if (body.toString('latin1', 0, z) === 'mclite-dump') text = body.toString('latin1', z + 1);
  }
  if (type === 'IEND') break;
  pos += 12 + len;
}
if (text === null) { console.error('no mclite-dump chunk in ' + file + ' (not a /ss file, or the chat app re-encoded it)'); process.exit(1); }
const d = JSON.parse(text);
if (process.argv.includes('--json')) { console.log(JSON.stringify(d, null, 1)); process.exit(0); }
if (process.argv.includes('--map')) {
  for (const g of (d.sectionDraw && d.sectionDraw.grids) || []) { console.log(`sy ${g.sy} (y ${g.yMin}..${g.yMin + 15}) top-left chunk at block x ${g.x0}, z ${g.z0}`); g.rows.forEach((r) => console.log('  ' + r)); }
  console.log((d.sectionDraw || {}).legend || ''); process.exit(0);
}
const w = d.world || {}, p = d.player || {}, g = d.gfx || {}, e = (d.entitiesNear || {}).list || [];
console.log(`taken ${d.takenAt} via ${d.why} | seed ${w.seed} climate ${w.climate} | ${g.backend} ${g.gpu || ''} rd ${g.renderDistance} | ${d.timing && d.timing.fps} fps`);
console.log(`player ${p.x},${p.y},${p.z} yaw ${p.yaw} pitch ${p.pitch}`);
const by = {}; e.forEach((x) => { by[x.type] = (by[x.type] || 0) + 1; });
console.log(`entities within 32: ${e.length} ` + JSON.stringify(by));
const wet = e.filter((x) => x.inWater), off = e.filter((x) => Math.abs(x.renderedMinusY) > 0.25);
console.log(`  in water: ${wet.length}; drawn >0.25 blocks away from their position: ${off.length}`);
const f = d.focus && (d.focus.crosshairTarget || d.focus.firstNonAir);
if (f) console.log(`look cell ${f.cell.name} ${f.cell.pos} light ${JSON.stringify(f.cell.light)} | section meshed=${f.section.meshed} dirty=${f.section.dirty} vis=${f.section.vis} | faces ` + Object.entries(f.faces).map(([k, v]) => `${k} ${v.verdict}`).join(', '));
const sd = d.sectionDraw;
if (sd) { const c = {}; (sd.grids || []).forEach((gr) => gr.rows.forEach((r) => [...r].forEach((ch) => { c[ch] = (c[ch] || 0) + 1; }))); console.log(`sections (3 rows around the camera): ` + JSON.stringify(c) + ` occlusion ${sd.occlusion}  (run with --map to see them)`); }
