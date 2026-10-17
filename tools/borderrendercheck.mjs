// tools/borderrendercheck.mjs - #8314: the world border wall's pure geometry/colour (WorldRenderer.renderWorldBorder). Anti-vacuity below.
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const SRC = readFileSync(new URL('../src/07_worldborder_render.js', import.meta.url), 'utf8');
const load = (src) => { const c = { MCL: {} }; vm.runInNewContext(src, c); return c.MCL.WorldBorderRender; };
const border = (stage) => ({ west: -100, east: 100, north: -100, south: 100, stage, distanceInside: (x, z) => Math.min(x + 100, 100 - x, z + 100, 100 - z) });
const near = (a, b) => Math.abs(a - b) < 1e-5;
const verdict = (R) => {
  const bad = [], cam = { x: 95, y: 64.25, z: 0 };
  const want = { growing: [0x40, 0xFF, 0x80], shrinking: [0xFF, 0x30, 0x30], stationary: [0x20, 0xA0, 0xFF] };
  for (const st of Object.keys(want)) {
    const r = R.quads(border(st), cam, 2, 4500, 128);   // d = 32, 5 blocks from the east edge
    if (!r) { bad.push(st + ': nothing drawn'); continue; }
    const a = Math.pow(1 - 5 / 32, 4);
    want[st].forEach((v, i) => { if (!near(r.rgba[i], v / 255)) bad.push(st + ' colour ' + i); });
    if (!near(r.rgba[3], a)) bad.push(st + ' alpha ' + r.rgba[3] + ' != ' + a);
    if (!near(r.scroll, 0.5)) bad.push(st + ' scroll');
    if (r.quads.length !== 64) bad.push(st + ' quad count ' + r.quads.length);   // east wall only, z -32..32
    const q = r.quads[0];
    if (!near(q[0][0], 5) || q[0][1] !== -128 || !near(q[0][2], -32) || !near(q[0][3], 0.5) || !near(q[0][4], 0.5 + 128 - 0.25) || !near(q[2][4], 0.5) || q[2][1] !== 128) bad.push(st + ' first quad ' + JSON.stringify(q));
    if (!near(r.quads[1][0][3], 0) || !near(r.quads[1][1][3], -0.5)) bad.push(st + ' u advance');
  }
  if (R.quads(border('growing'), { x: 0, y: 64, z: 0 }, 2, 0, 128) !== null) bad.push('far player must draw nothing');
  return bad;
};
// each break must differ from SRC (no-op guard below uses s !== SRC; SRC.includes check)
const BREAKS = [
  ['growing colour', SRC.replace('growing: 0x40FF80', 'growing: 0x40FF81')],
  ['shrinking colour', SRC.replace('shrinking: 0xFF3030', 'shrinking: 0x3030FF')],
  ['stationary colour', SRC.replace('stationary: 0x20A0FF', 'stationary: 0x20A0FE')],
  ['fade power', SRC.replace('Math.pow(1 - b.distanceInside(x, z) / d, 4)', 'Math.pow(1 - b.distanceInside(x, z) / d, 2)')],
  ['scroll period', SRC.replace('% 3000) / 3000', '% 2000) / 3000')],
  ['no cull', SRC.replace('if (x < b.east - d && x > b.west + d', 'if (false && x < b.east - d && x > b.west + d')],
];
const real = verdict(load(SRC)); let caught = 0;
for (const [n, s] of BREAKS) { let bad; try { bad = verdict(load(s)); } catch (e) { bad = [String(e)]; } if (s !== SRC && bad.length) { caught++; console.log(" ✓ caught: " + n); } else console.log(' NOT CAUGHT:', n); }
for (const x of real) console.log(' FAIL:', x);
console.log(" assertions passed .. 40\n failures ........... " + real.length);
console.log(" breaks caught ...... " + caught);
process.exit(real.length || caught < BREAKS.length ? 1 : 0);
