#!/usr/bin/env node
// fishpatterncheck.mjs -- #1760: TropicalFishColorFeatureRenderer's pattern pass. For every variant the draw list
// gets a second `mob` entry whose texKey is TropicalFishEntity.getVarietyId (a/b by shape, pattern min(v>>8&255,5))
// and whose tint is getPatternColorComponents (v>>>24); its sheet and dilated boxes must exist in the shipped data.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { deflateRawSync } from 'node:zlib';
import { loadEngine, initRegistry, MCLITE_ROOT } from './loadsrc.mjs';

const A = join(MCLITE_ROOT, 'assets');
let pass = 0, breaks = 0;
const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const M = loadEngine({ extra: ['02g_items.js', '07h_entities.js', '14b_physics.js', '07i_entitylist.js', '07j_entityrender.js', '10_gfx.js', '15h_bemodel.js', '07n_tame.js'], dom: false });
initRegistry(M);
const mm = JSON.parse(readFileSync(join(A, 'models.meta.json'), 'utf8'));
M.BEModel.init({ models: readFileSync(join(A, 'models.bin')).toString('base64'), modelsBytes: mm.rawBytes });
const geomRaw = readFileSync(join(A, 'mob-geometry.json'));
M.DATA = Object.assign({}, M.DATA, { mobGeometry: deflateRawSync(geomRaw, { level: 9 }).toString('base64'), mobGeometryBytes: geomRaw.length,
  entities: JSON.parse(readFileSync(join(A, 'entities.json'), 'utf8')) });
M.Entities.init(); M.EntityList.init(); M.EntityRender.init();
const ER = M.EntityRender, BE = M.BEModel;
console.log('fishpatterncheck -- #1760 tropical fish pattern layer');

// the pure picker, every shape x pattern (incl. the >5 clamp), against the decomp formula
function expectKey(v) { const pat = Math.min((v >> 8) & 0xFF, 5); return ((v & 0xFF) === 0 ? 'tropical_fish_small_pattern' : 'tropical_fish_large_pattern') + (pat ? '#' + pat : ''); }
function run(pick) {
  let bad = 0;
  for (const shape of [0, 1, 7]) for (const pat of [0, 1, 2, 3, 4, 5, 9]) for (const [base, patc] of [[0, 15], [14, 3]]) {
    const v = shape | pat << 8 | base << 16 | (patc << 24);
    const r = pick({ type: 'tropical_fish', fishVariant: v });
    const d = (M.Tame.DYES[patc] && BE.dye[M.Tame.DYES[patc]]);
    const want = [((d >> 16) & 255) / 255, ((d >> 8) & 255) / 255, (d & 255) / 255];
    if (!r || r.texKey !== expectKey(v) || r.tint.join() !== want.join()) bad++;
  }
  return bad;
}
ok(run(ER.fishPatternFor) === 0, 'fishPatternFor disagrees with TropicalFishEntity.getVarietyId/getPatternColorComponents');
ok(ER.fishPatternFor({ type: 'cod', fishVariant: 1 }) === null, 'a non-tropical fish got a pattern pass');
ok(ER.fishPatternFor({ type: 'tropical_fish' }) === null, 'a tropical fish with no variant got a pattern pass');
// the shipped data: all 12 sheets are packed under their key, and the model layers carry the dilated boxes
for (const s of ['small', 'large']) {
  const L = BE.layer(`tropical_fish_${s}_pattern`), B = BE.layer(`tropical_fish_${s}`);
  ok(L && B && L.parts.length === B.parts.length && L.parts.every((p, i) => p.n === B.parts[i].n && Math.abs((p.g || 0) - 0.008) < 1e-6),
     `${s}: pattern layer is not the base layer's parts dilated by 0.008`);
  for (let n = 0; n < 6; n++) {
    const k = `tropical_fish_${s}_pattern` + (n ? '#' + n : '');
    ok(!!JSON.parse(geomRaw.toString('utf8')).layers[k], `${k}: no packed geometry/sheet`);
    ok(ER.mobQuadCount(`tropical_fish_${s}`, k) >= B.parts.length * 6, `${k}: pattern pass sizes fewer quads than the box list`);
  }
}
// anti-vacuity: break the picker three ways, each must be caught
const breakers = {
  'shape swapped': (e) => { const r = ER.fishPatternFor(e); return r && { texKey: r.texKey.replace(/small|large/, (m) => m === 'small' ? 'large' : 'small'), tint: r.tint }; },
  'no clamp at 5': (e) => ({ texKey: e.fishVariant & 0xFF ? 'tropical_fish_large_pattern#' + ((e.fishVariant >> 8) & 255) : 'tropical_fish_small_pattern#' + ((e.fishVariant >> 8) & 255), tint: ER.fishPatternFor(e).tint }),
  'base colour as tint': (e) => ({ texKey: ER.fishPatternFor(e).texKey, tint: ER.fishTintFor(e) }),
};
for (const [n, fn] of Object.entries(breakers)) { breaks++; if (run(fn) > 0) { pass++; console.log("   ✓ break caught: " + n); } else fails.push('anti-vacuity: break "' + n + '" not caught'); }
for (const f of fails) console.log('   x ' + f);
console.log(`fishpatterncheck: ${pass + fails.length} assertions, ${fails.length} failures, ${breaks - fails.filter((f) => f.startsWith("anti")).length} breaks caught`);
process.exit(fails.length ? 1 : 0);
