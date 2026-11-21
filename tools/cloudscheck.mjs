// tools/cloudscheck.mjs — G17-CL1: the sky clouds' numbers (src/09d_clouds.js) against the jar and .decomp.
// cell grid == clouds.png, height/speed/cell/alpha/shades == WorldRenderer + DimensionEffects source, getCloudsColor
// behaviour, the drift placement and the vertex counts. Anti-vacuity: each break below must make it fail.
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { Jar } from './jarlib.mjs';
import { decodePng } from './png.mjs';
import { JARS } from './paths.mjs';
import { existsSync } from 'node:fs';

const R = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const WR = R('.decomp/net/minecraft/client/render/WorldRenderer.java'), DE = R('.decomp/net/minecraft/client/render/DimensionEffects.java');
const jarFile = existsSync(JARS + '/1.18.2.jar') ? JARS + '/1.18.2.jar' : JARS + '/1.18.2/1.18.2.jar';
const img = decodePng(new Jar(jarFile).read('assets/minecraft/textures/environment/clouds.png'));
const jarCell = (x, z) => img.data[((((z % 256) + 256) % 256) * 256 + (((x % 256) + 256) % 256)) * 4 + 3] === 255;

function load() {
  const ctx = vm.createContext({ console, Math, Float32Array, Uint8Array, Uint16Array, Uint32Array, Int32Array, Float64Array, Array, Object, String, Number, JSON, Error, atob: (s) => Buffer.from(s, 'base64').toString('binary') });
  ctx.window = ctx; ctx.globalThis = ctx;
  for (const f of ['00_ns', '01_util', '01b_inflate', '09b_sky', '09d_clouds', '19_data.gen']) vm.runInContext(R('src/' + f + '.js'), ctx, { filename: f });
  const NS = ctx.MCL || ctx.MCLITE;
  // src/19_data.gen.js is GENERATED (gen-data runs after extract-clouds in the suite); when this tree's copy predates
  // the clouds, feed it the extractor's own output instead, and assert the generator wires the field.
  if (NS.DATA && !NS.DATA.cloudBits && existsSync(new URL('../assets/clouds.bin', import.meta.url))) NS.DATA.cloudBits = readFileSync(new URL('../assets/clouds.bin', import.meta.url)).toString('base64');
  return NS;
}

function verdict(mut) {
  const bad = [], NS = load(), Cl = NS.Clouds;
  if (!Cl) return ['NS.Clouds does not exist'];
  if (!/cloudBits: '\$\{cloudBits\}'/.test(R('tools/gen-data.mjs'))) bad.push('gen-data.mjs does not inline cloudBits');
  mut && mut(Cl);
  let diff = 0;
  for (let z = -3; z < 259; z++) for (let x = -3; x < 259; x++) if (Cl.cellAt(x, z) !== jarCell(x, z)) diff++;
  if (diff) bad.push(`${diff} cells differ from clouds.png`);
  // constants against the decompiled source
  const has = (re, what) => { if (!re.test(WR)) bad.push('.decomp WorldRenderer no longer has ' + what); };
  has(/float \$\$7 = 12\.0F;/, 'the 12-block cell'); has(/\(\(float\)this\.ticks \+ \$\$2\) \* 0\.03F/, 'the 0.03 drift');
  has(/0\.8F\)\s*\.normal\(0\.0F, 1\.0F/, 'alpha 0.8'); has(/\$\$12 \* 0\.9F/, 'the 0.9 shade'); has(/\$\$12 \* 0\.7F/, 'the 0.7 shade'); has(/\$\$12 \* 0\.8F/, 'the 0.8 shade');
  const ow = /class Overworld[\s\S]*?super\((\d+\.\d+)F,/.exec(DE);
  if (!ow || Number(ow[1]) !== Cl.height('overworld')) bad.push(`overworld cloud height ${Cl.height('overworld')} != decomp ${ow && ow[1]}`);
  if (!(Cl.height('the_nether') !== Cl.height('the_nether')) || !(Cl.height('the_end') !== Cl.height('the_end'))) bad.push('nether/end must have no clouds (NaN)');
  if (Cl.CELL !== 12 || Cl.THICKNESS !== 4 || Cl.ALPHA !== 0.8 || Cl.SPEED !== 0.03) bad.push('cell/thickness/alpha/speed constants');
  // drift: 100 ticks at 0.03 = 3 blocks = 0.25 cell; the cloud y is height - camY + 0.33
  const p0 = Cl.place(0, 0, 0, 64, 0, 192), p1 = Cl.place(100, 0, 0, 64, 0, 192);
  if (Math.abs((p1.x - p0.x) - 0.25) > 1e-6) bad.push('100 ticks must drift 3 blocks (0.25 cell), got ' + (p1.x - p0.x) * 12);
  if (Math.abs(p0.y - (192 - 64 + 0.33)) > 1e-4) bad.push('cloud y is height - camY + 0.33');
  // colour: clear noon is white, rain greys it, night is dark
  const noon = Cl.color(0, 0, 0), rain = Cl.color(0, 1, 0), night = Cl.color(0.5, 0, 0);
  if (noon.some((c) => Math.abs(c - 1) > 1e-6)) bad.push('clear noon cloud colour must be 1,1,1: ' + noon);
  if (!(Math.abs(rain[0] - 0.62) < 1e-6 && Math.abs(rain[0] - rain[1]) < 1e-6)) bad.push('rain must desaturate the clouds toward grey: ' + rain);
  if (!(night[0] < 0.2 && night[2] > night[0])) bad.push('night clouds must be dark (0.1/0.1/0.15): ' + night);
  // geometry: fast = 4 quads, fancy = vanilla's loop
  const nf = Cl.build(0, 0, 0, [1, 1, 1], false).length / (4 * Cl.VERTEX_FLOATS), nF = Cl.build(0, 0, 0, [1, 1, 1], true).length / (4 * Cl.VERTEX_FLOATS);
  if (nf !== 4) bad.push('fast clouds are 4 quads, got ' + nf);
  if (nF < 1000 || nF > 16000) bad.push('fancy clouds quad count ' + nF);
  return bad;
}

const BREAKS = [
  ['grid shifted by one cell', (Cl) => { const c = Cl.cellAt; Cl.cellAt = (x, z) => c(x + 1, z); }],
  ['wrong drift speed', (Cl) => { const p = Cl.place; Cl.place = (t, pa, x, y, z, h) => p(t * 2, pa, x, y, z, h); }],
  ['height 128', (Cl) => { Cl.height = (d) => (d === 'overworld' ? 128 : NaN); }],
  ['nether has clouds', (Cl) => { Cl.height = () => 192; }],
  ['rain ignored', (Cl) => { const c = Cl.color; Cl.color = (a, r, t) => c(a, 0, t); }],
  ['alpha changed', (Cl) => { Cl.ALPHA = 0.5; }],
];
const real = verdict(); let caught = 0;
for (const [n, m] of BREAKS) { if (verdict(m).length) caught++; else console.log(' NOT CAUGHT:', n); }
for (const x of real) console.log(' FAIL:', x);
console.log(`cloudscheck: ${caught} breaks caught (of ${BREAKS.length})`);
process.exit(real.length || caught < BREAKS.length ? 1 : 0);
