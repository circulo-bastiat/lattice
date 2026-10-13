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
const num = (src, re) => parseFloat(src.match(re)[1]);

function run(mut) {
  const f = []; const chk = (c, m) => { if (!c) f.push(m); };
  const P = Object.assign({}, ER.END_PORTAL); if (mut) P.layers = 15;
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
  ER.END_PORTAL = saved;
  return f;
}
const clean = run(false); ok(clean.length === 0, 'clean run: ' + clean.join('; '));
const bad = run(true); ok(bad.length > 0, 'a changed layer count must fail'); 
console.log(`endportalrendercheck: ${pass} ok, ${fails.length} fail, ${bad.length} breaks caught`);
for (const x of fails) console.log('FAIL', x);
process.exit(fails.length ? 1 : 0);
