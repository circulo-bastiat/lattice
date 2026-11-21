#!/usr/bin/env node
// endportalrendercheck.mjs -- #5578: End portal / gateway render rules against the decomp source text.
import { readFileSync } from 'node:fs';
import { loadEngine, initRegistry, MCLITE_ROOT } from './loadsrc.mjs';
const D = MCLITE_ROOT + '.decomp/net/minecraft/client/render/';
const portalJ = readFileSync(D + 'block/entity/EndPortalBlockEntityRenderer.java', 'utf8');
const gateJ = readFileSync(D + 'block/entity/EndGatewayBlockEntityRenderer.java', 'utf8');
const layerJ = readFileSync(D + 'RenderLayer.java', 'utf8');
const M = loadEngine({ extra: ['02g_items.js', '02f_tags.js', '07b_behaviour.js', '07c_blockentity.js', '07j_entityrender.js'], dom: false });
initRegistry(M);
const ER = M.EntityRender || M.ER; const BE = M.BlockEntities; BE.init(); BE.ready = true;
let pass = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const GOLD = JSON.parse(readFileSync(MCLITE_ROOT + 'tools/golden/endportal-shader-1.18.2.json', 'utf8'));   // extract-shaders.mjs, from the jar
const num = (src, re) => parseFloat(src.match(re)[1]);

function run(mut) {
  const savedBeam = ER.GATEWAY_BEAM_DRAW, savedDraw = ER.END_PORTAL_DRAW, savedCol = ER.END_PORTAL_COLORS;
  if (mut === 2) ER.END_PORTAL_DRAW = false;
  if (mut === 4) ER.GATEWAY_BEAM_DRAW = false;
  if (mut === 3) ER.END_PORTAL_COLORS = savedCol.map((c) => c.map(() => 0));
  if (mut === 5) ER.END_PORTAL_COLORS = savedCol.map((c, i) => i === 15 ? [c[0], c[1], 0.261394] : c);
  const f = []; const chk = (c, m) => { if (!c) f.push(m); };
  const P = Object.assign({}, ER.END_PORTAL); if (mut === true || mut === 1) P.layers = 15;
  const saved = ER.END_PORTAL; ER.END_PORTAL = P;
  // the layer count is the shader's: RenderLayer registers exactly sky + portal textures, 16 layers
  chk((layerJ.match(/END_PORTAL_SHADER/g) || []).length >= 1, 'RenderLayer uses END_PORTAL_SHADER');
  chk((layerJ.match(/SKY_TEXTURE/g) || []).length >= 2, 'sky texture in both layers');
  chk(P.layers === 16, 'layer count 16 (end_portal shader)');
  chk(num(portalJ, /getTopYOffset\(\) \{\s*return ([\d.]+)F/) === P.topY, 'portal top y');
  chk(num(portalJ, /getBottomYOffset\(\) \{\s*return ([\d.]+)F/) === P.bottomY, 'portal bottom y');
  chk(num(gateJ, /getTopYOffset\(\) \{\s*return ([\d.]+)F/) === ER.END_GATEWAY.topY, 'gateway top y');
  chk(num(gateJ, /getBottomYOffset\(\) \{\s*return ([\d.]+)F/) === ER.END_GATEWAY.bottomY, 'gateway bottom y');
  chk(num(gateJ, /return (\d+);\s*\}\s*\}\s*$/) === ER.END_GATEWAY.renderDistance, 'gateway render distance');
  chk(gateJ.includes('0.15F, 0.175F'), 'beam radii in decomp');
  chk(ER.endPortalQuads(false).map(q => q.face).join() === 'down,up', 'portal draws up/down only');
  const up = ER.endPortalQuads(false).find(q => q.face === 'up');
  chk(up.v.every(v => v[1] === 0.75), 'portal top at 0.75');
  chk(ER.endPortalQuads(true).length === 6, 'gateway draws six sides');
  chk(ER.endPortalQuads(true, s => s !== 'north').length === 5, 'gateway skips culled sides');
  // beam: fresh -> magenta to world top, cooldown -> purple to 50, idle -> none
  const e = BE.create(0, 70, 0, 'end_gateway');
  e.age = 100; let b = ER.gatewayBeam(e, 0, 0, 320);
  chk(b && b.color === 13061821 && b.height === 640, 'fresh beam magenta, +-320 (' + (b && b.height) + ')');
  e.age = 500; e.teleportCooldown = 0; chk(ER.gatewayBeam(e, 0, 0, 320) === null, 'idle gateway has no beam');
  e.teleportCooldown = 20; b = ER.gatewayBeam(e, 0, 85, 320);
  chk(b && b.color === 8991416 && b.height === 100 && b.time === 5, 'cooldown beam purple, 50 high, time%40');
  // #8255 -- a rendered frame (CPU reference of the one shader both backends are generated from)
  const frame = (type, cells) => {
    for (const [x, z] of cells) BE.create(x, 70, z, type);
    const cam = { x: 1.5, y: 80, z: 1.5 }, N = 24, S = 6, white = () => [1, 1, 1];
    const verts = ER.buildEndPortalVerts(cam);
    const px = []; let lit = 0, black = 0;
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const nx = ((i + 0.5) / N) * 2 - 1, nz = ((j + 0.5) / N) * 2 - 1, wx = nx * S, wz = nz * S;
      let hit = false;
      for (let q = 0; q < verts.length; q += 12) {
        const xs = [0, 3, 6, 9].map((k) => verts[q + k]), zs = [0, 3, 6, 9].map((k) => verts[q + k + 2]), ys = verts[q + 1];
        if (xs[0] === xs[1] && xs[1] === xs[2]) continue;   // a vertical face seen edge-on
        if (ys === verts[q + 4] && wx >= Math.min(...xs) && wx <= Math.max(...xs) && wz >= Math.min(...zs) && wz <= Math.max(...zs)) hit = true;
      }
      if (!hit) continue;
      const c = ER.endPortalShade(nx * 0.5 + 0.5, nz * 0.5 + 0.5, 0.25, white, white);
      lit++; if (c[0] + c[1] + c[2] <= 0) black++;
      px.push(c);
    }
    return { lit, black, px, n: verts.length / 12 };
  };
  const cells = []; for (let x = 0; x < 3; x++) for (let z = 0; z < 3; z++) cells.push([x, z]);
  const fp = frame('end_portal', cells);
  chk(fp.lit > 0 && fp.black === 0, 'portal frame: drawn and non-black (' + fp.lit + ' lit, ' + fp.black + ' black)');
  chk(fp.n === 18, 'portal frame: 9 blocks x (up+down) = 18 quads (' + fp.n + ')');
  chk(JSON.stringify(ER.END_PORTAL_COLORS) === JSON.stringify(GOLD.colors), 'colour table equals the jar shader COLORS');
  chk(GOLD.layers === P.layers, 'layer count equals the jar shader');
  const q = ER.endPortalLayerParams(2, 0.5);
  chk(GOLD.translate[0] === '17.0 / layer' && q.tx === 17 / 2 && GOLD.rotate === '(layer * layer * 4321.0 + layer * 9.0) * 2.0' && GOLD.scale === '(4.5 - layer / 4.0) * 2.0' && GOLD.translate[1] === '(2.0 + layer / 1.5) * (GameTime * 1.5)' && q.k === (4.5 - 0.5) * 2 && q.ty === (2 + 2 / 1.5) * 0.75, 'layer matrix equals the jar shader');
  // all textures white -> pixel = COLORS[0] + sum(COLORS[0..layers-1]) exactly: pins the table AND the layer count
  const C = ER.END_PORTAL_COLORS, want = [0, 1, 2].map((k) => C[0][k] + C.slice(0, 16).reduce((a, c) => a + c[k], 0));
  chk(fp.px.length > 0 && fp.px[0].every((v, k) => Math.abs(v - want[k]) < 1e-9), 'portal pixel = vanilla layer table sum');
  BE.clear(); BE.ready = true;
  const fg = frame('end_gateway', [[1, 1]]);
  chk(fg.lit > 0 && fg.black === 0 && fg.n === 6, 'gateway frame: six sides, non-black (' + fg.n + ' quads, ' + fg.lit + ' lit)');
  BE.clear(); BE.ready = true;
  // #8634 -- the textured beam: fresh gateway at world top 256 -> y 70-256 .. 70+256, two prisms of 16 quads, 9 floats a vertex
  const g = BE.create(0, 70, 0, 'end_gateway'); g.age = 100;
  const bv = ER.buildGatewayBeamVerts({ x: 0.5, y: 70, z: 0.5 }, 0, 0);
  chk(bv.length === 32 * 9, 'beam: 8 quads x 4 verts x 9 floats, drawn (' + bv.length / 9 + ' verts)');
  if (bv.length) {
    const ys = [], us = [], vs = [];
    for (let i = 0; i < bv.length; i += 9) { ys.push(bv[i + 1]); us.push(bv[i + 7]); vs.push(bv[i + 8]); }
    chk(Math.min(...ys) <= -255 && Math.min(...ys) >= -257, 'beam bottom at y-256 (' + Math.min(...ys) + ')');
    chk(Math.max(...ys) >= 255 && Math.max(...ys) <= 257, 'beam top at y+256 (' + Math.max(...ys) + ')');
    chk(us.every((u) => u === 0 || u === 1), 'beam u is 0|1');
    chk(bv[6] === 1 && bv[16 * 9 + 6] === 0.125 && bv.slice(0, 32 * 9).filter((_, i) => i % 9 === 6).every((a) => a === 1 || a === 0.125), 'beam inner alpha 1, outer 0.125');
  }
  const bsrc = ER.gatewayBeamShaderSrc('glsl').fs + ER.gatewayBeamShaderSrc('wgsl');
  chk(/uTex/.test(bsrc) && /textureSampleLevel/.test(bsrc), 'beam shaders sample the texture on both backends');
  chk(ER.END_PORTAL_SHEETS.beam.layer === JSON.parse(readFileSync(MCLITE_ROOT + 'assets/be-tiles.meta.json', 'utf8')).whole.end_gateway_beam.layer, 'beam atlas layer = packed layer');
  chk(ER.BE_WORLD_OWED.length === 0, 'BE_WORLD_OWED emptied');
  chk(/ER\.renderGatewayBeams\(G, cam\)/.test(readFileSync(MCLITE_ROOT + 'src/07j_entityrender.js', 'utf8')), 'beam draw called from the dispatcher');
  BE.clear(); BE.ready = true;
  // both backends are generated from the one table: every constant is in both shader sources
  const gl = ER.endPortalShaderSrc('glsl').fs, wg = ER.endPortalShaderSrc('wgsl');
  chk(ER.END_PORTAL_COLORS.every((c) => c.every((v) => gl.includes(v.toFixed(6)) && wg.includes(v.toFixed(6)))), 'GLSL and WGSL carry the 16-colour table');
  chk(gl.includes('i < 16') && wg.includes('j < 16'), 'both shaders loop 16 layers');
  chk(M.EntityRender.renderEndPortals && /renderEndPortals\(G, cam\)/.test(readFileSync(MCLITE_ROOT + 'src/07j_entityrender.js', 'utf8')), 'dispatcher wired into renderOrbs');
  ER.GATEWAY_BEAM_DRAW = savedBeam; ER.END_PORTAL_DRAW = savedDraw; ER.END_PORTAL_COLORS = savedCol;
  ER.END_PORTAL = saved;
  return f;
}
const clean = run(false); ok(clean.length === 0, 'clean run: ' + clean.join('; '));
const breaks = [1, 2, 3, 4, 5].map((m) => run(m));
breaks.forEach((b, i) => ok(b.length > 0, 'mutation ' + (i + 1) + ' must fail'));
const bad = breaks.filter((b) => b.length > 0);
console.log(`endportalrendercheck: ${pass} ok, ${fails.length} fail, ${bad.length} breaks caught`);
for (const x of fails) console.log('FAIL', x);
process.exit(fails.length ? 1 : 0);
