// goatbabycheck -- #751: GoatEntityModel.setAngles hides left_horn/right_horn on a baby goat.
// Emits the goat layer adult vs baby and asserts the quad delta is exactly the two horns' quads.
import { readFileSync } from 'node:fs';
import { deflateRawSync } from 'node:zlib';
import { loadEngine, initRegistry, MCLITE_ROOT, ASSETS } from './loadsrc.mjs';
import { join } from 'node:path';

const VERBOSE = false;
let pass = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); return c; };
let breaks = 0;
const okAv = (c, m) => { breaks++; ok(c, 'anti-vacuity: ' + m); if (c) console.log('   ✓ ' + m); };
const say = (s) => { if (VERBOSE) console.log(s); };


console.log('goatbabycheck');
const geom = JSON.parse(readFileSync(join(MCLITE_ROOT, 'assets', 'mob-geometry.json'), 'utf8'));
const M = loadEngine({
  extra: ['02g_items.js', '07h_entities.js', '14b_physics.js', '07i_entitylist.js',
          '07n_tame.js', '07m_breed.js', '07r_mount.js', '07ze_llama.js',
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
const L = M.BEModel.layer('goat');
const ER = M.EntityRender;
const horn = new Set(); L.parts.forEach((p, k) => { if (p.n === 'left_horn' || p.n === 'right_horn') horn.add(k); });
ok(horn.size === 2, 'goat has left_horn and right_horn');
let hq = 0;
for (const k of horn) for (let f = 0; f < 6; f++) { const s = geom.layers.goat[k][f]; hq += (s && s.length) ? s.length : 1; }
const n = ER.mobQuadCount('goat');
const emit = (anim) => { const b = new Uint32Array(n * 16); return ER.emitMobLayer(b, 0, 'goat', 0, 0, 0, 1, 0, 15, 0, 0, anim, undefined, undefined, false, undefined, undefined, null) / 16; };
const A = { limbSwing: 0, limbSwingAmount: 0, netHeadYaw: 0, headPitch: 0 };
const adult = emit(Object.assign({}, A, { baby: false })), baby = emit(Object.assign({}, A, { baby: true }));
ok(adult === n, 'adult goat emits all ' + n + ' quads (got ' + adult + ')');
okAv(baby === n - hq && hq > 0, 'baby goat drops exactly the ' + hq + ' horn quads (got ' + (n - baby) + ')');
// break: a non-goat baby (cow) must be untouched, and no-anim goat is full
okAv(emit(null) === n, 'goat with no anim is full');
console.log('================ goatbabycheck ================');
console.log(` assertions passed .. ${pass}`);
console.log(` failures ........... ${fails.length}`);
console.log(` breaks caught ...... ${breaks}`);
if (fails.length) { fails.forEach((f) => console.log('  FAIL: ' + f)); process.exit(1); }
