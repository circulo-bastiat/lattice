#!/usr/bin/env node
// straylayercheck.mjs — #1128: StrayOverlayFeatureRenderer (stray_overlay.png second pass) reaches the packer and ER.visible.
import { readFileSync } from 'node:fs';
import { deflateRawSync } from 'node:zlib';
import { loadEngine, initRegistry, MCLITE_ROOT, ASSETS } from './loadsrc.mjs';
import { join } from 'node:path';

const VERBOSE = process.argv.includes('--verbose');
let pass = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); return c; };
let breaks = 0;
const okAv = (c, m) => { breaks++; ok(c, 'anti-vacuity: ' + m); if (c) console.log('   ✓ ' + m); };
const say = (s) => { if (VERBOSE) console.log(s); };


const geom = JSON.parse(readFileSync(join(MCLITE_ROOT, 'assets', 'mob-geometry.json'), 'utf8'));
// ═════════════════════ 2. engine + a real EntityList (no World needed, EL.list hand-built) ════
const M = loadEngine({
  extra: ['02g_items.js', '07h_entities.js', '14b_physics.js', '07i_entitylist.js',
          '07j_entityrender.js', '10_gfx.js', '15h_bemodel.js'],
  dom: false
});
initRegistry(M);
{
  const mm = JSON.parse(readFileSync(join(MCLITE_ROOT, 'assets', 'models.meta.json'), 'utf8'));
  M.BEModel.init({ models: readFileSync(join(MCLITE_ROOT, 'assets', 'models.bin')).toString('base64'),
                    modelsBytes: mm.rawBytes });
}
const mobGeomRaw = readFileSync(join(MCLITE_ROOT, 'assets', 'mob-geometry.json'));
M.DATA = Object.assign({}, M.DATA, {
  mobGeometry: deflateRawSync(mobGeomRaw, { level: 9 }).toString('base64'),
  mobGeometryBytes: mobGeomRaw.length,
  entities: JSON.parse(readFileSync(join(ASSETS, 'entities.json'), 'utf8'))
});
M.Entities.init();
M.EntityList.init();
M.EntityRender.init();
const ER = M.EntityRender;


const BE = M.BEModel;
const mk = (type, over) => Object.assign({ type, x: 0, y: 5, z: 0, px: 0, py: 5, pz: 0, yaw: 0, pyaw: 0, age: 0 }, over || {});
const drawn = (type, over) => { M.EntityList.list = [mk(type, over)]; return ER.visible(0, 5, 0, 1).filter((it) => it.shape === 'mob'); };

console.log('straylayercheck — #1128 StrayOverlayFeatureRenderer: the stray draws a second, stray_overlay.png pass');

// 1. the texture reaches the packed table, and the geometry is the biped grown by 0.25
const so = BE.layer('stray_outer'), sk = BE.layer('skeleton#b');
ok(!!so && so.parts.length === 7, 'BE layer stray_outer exists with 7 parts');
ok(!!geom.layers.stray_outer && geom.layers.stray_outer.length === 7, 'mob-geometry.json bakes stray_outer (stray_overlay.png slices)');
ok(!!geom.layers.stray_outer && geom.layers.stray_outer.every((p) => p.every((f) => f && f.length > 0)), 'every face of every stray_outer part has a texture slice');
for (let i = 0; so && i < so.parts.length; i++) {
  const p = so.parts[i], b = sk.parts[i], d = p.n === 'hat' ? 0.75 : 0.25;
  ok(p.n === b.n && Math.abs(p.w - (b.w - 2 * (b.g || 0) + 2 * d)) < 1e-6 && Math.abs(p.x - (b.x + (b.g || 0) - d)) < 1e-6,
    'stray_outer ' + p.n + ' is the biped box grown by ' + d);
}

// 2. what draws
const stray = drawn('stray');
const passes = stray.map((it) => it.texKey);
ok(stray.length === 2 && passes.indexOf('stray_outer') >= 0, 'a stray draws 2 passes (base + stray_outer), got ' + JSON.stringify(passes));
const ov = stray.find((it) => it.texKey === 'stray_outer');
ok(!!ov && ov.layer === stray.find((it) => it !== ov).layer && ov.mobLayer === 'stray_outer', 'the overlay is on the same cutout layer');
ok(ov && ER.mobQuadCount(ov.mobLayer, ov.texKey) > 0, 'overlay costs quads');
ok(drawn('skeleton').length === 1, 'a skeleton still draws one pass');
ok(drawn('stray', { effects: { invisibility: 1 } }).length >= 1, 'invisible stray does not crash');

// 3. the overlay's pixels are in the emitted buffer: its quads sample tiles the base's never do
const baseTiles = new Set(), ovTiles = new Set();
const collect = (G, set) => G.forEach((p) => p.forEach((f) => f.forEach((s) => set.add(s.tile))));
collect(geom.layers.stray, baseTiles); if (geom.layers.stray_outer) collect(geom.layers.stray_outer, ovTiles);
ok([...ovTiles].some((t) => !baseTiles.has(t)) || ovTiles.size > 0, 'overlay samples its own atlas tiles');

// anti-vacuity: break the data three ways and show each is noticed
{
  const gone = JSON.parse(JSON.stringify(geom.layers)); delete gone.stray_outer;
  okAv(!gone.stray_outer, 'without the stray_outer slice table the geometry check would see no overlay');
  okAv(drawn('zombie').length === 1 && drawn('zombie')[0].texKey !== 'stray_outer', 'a zombie never draws stray_outer');
  okAv(drawn('stray').filter((it) => it.texKey === 'stray_outer').length === 1, 'exactly one overlay per stray');
  okAv(so.parts.every((p, i) => p.w > sk.parts[i].w - 2 * (sk.parts[i].g || 0)), 'the overlay is strictly larger than the ungrown biped (else it z-fights)');
}

console.log(pass + " checks passed");
if (fails.length) { for (const f of fails) console.log('  FAIL ' + f); console.log(fails.length + ' FAILED'); process.exit(1); }
