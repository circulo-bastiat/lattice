// #4744 enderman angry render jitter (EndermanEntityRenderer.getPositionOffset).
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

console.log('mountrendercheck — QUEUE 0.2 G18e remainder, mount/llama render overlays (Mnt.OWED/Ll.OWED close, unit A)');

// ═════════════════════ 1. the packer — the new families reach mob-geometry.json ══════════════
const geom = JSON.parse(readFileSync(join(MCLITE_ROOT, 'assets', 'mob-geometry.json'), 'utf8'));
{
  say('\n§1 pack-mobtex.mjs — horse_marking/horse_armor/decor geometry keys');
  const need = (k) => ok(Array.isArray(geom.layers[k]) && geom.layers[k].length > 0, `mob-geometry.json has a non-empty "${k}" layer`);
  // sheet 0 of each family is baked under the BARE key, never "#0" — D-469's own "cat"/"horse"
  // convention (the base layerName fallback only rescues this for a family whose name IS the
  // species — "llama"/"horse" — never for an OVERLAY family like these three).
  need('horse_marking'); need('horse_marking#1'); need('horse_marking#2'); need('horse_marking#3');
  need('horse_armor'); need('horse_armor#1'); need('horse_armor#2'); need('horse_armor#3');
  need('decor#null');
  for (let i = 1; i <= 15; i++) need('decor#null#' + i);
  // GEOM_BASE_OVERRIDE: horse_marking/horse_armor borrow HORSE's own box list — same shape
  // (part/face/slice-counts) as "horse" itself, exactly the wolf_tame/wolf check this file's
  // sibling (mobrendercheck.mjs) already runs for the collar unit.
  const shapeOf = (L) => L.map((parts) => parts.map((faces) => faces.length));
  ok(JSON.stringify(shapeOf(geom.layers.horse)) === JSON.stringify(shapeOf(geom.layers.horse_marking)),
    'horse_marking\'s box SHAPE matches horse\'s (GEOM_BASE_OVERRIDE: same geometry, different skin)');
  ok(JSON.stringify(shapeOf(geom.layers.horse)) === JSON.stringify(shapeOf(geom.layers.horse_armor)),
    'horse_armor\'s box SHAPE matches horse\'s (GEOM_BASE_OVERRIDE: same geometry, different skin)');
}

// ═════════════════════ 2. engine + a real EntityList (no World needed, EL.list hand-built) ════
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
M.Breed.init();
M.Tame.init();
M.Mount.init();
M.EntityRender.init();
const ER = M.EntityRender, Mn = M.Mount, Ll = M.Llama;
ok(ER.ready && Mn.ready, 'EntityRender/Mount both report ready');
ok(!!Ll && typeof Ll.skinKey === 'function', 'NS.Llama.skinKey exists (07ze_llama.js)');
ok(typeof Mn.hideChestParts === 'function' && typeof Mn.HORSE_ARMOR_TEX_INDEX === 'object',
  'Mnt.hideChestParts/Mnt.HORSE_ARMOR_TEX_INDEX exist (07r_mount.js)');


const mk = (over) => Object.assign({ type: 'enderman', x: 0, y: 5, z: 0, px: 0, py: 5, pz: 0, yaw: 0, pyaw: 0, age: 0 }, over || {});
const xz = (e) => { M.EntityList.list = [e]; const it = ER.visible(0, 5, 0, 1).find((v) => v.shape === 'mob'); return it ? [it.x, it.z] : null; };
const spread = (e) => { const xs = []; for (let n = 0; n < 40; n++) { const r = xz(e); if (!r) return -1; xs.push(r[0], r[1]); } return Math.max(...xs) - Math.min(...xs); };
// #4744 -- EndermanEntityRenderer.getPositionOffset: angry (has a target) => gaussian*0.02 on x/z each frame
ok(spread(mk({ target: null })) === 0, 'calm enderman: render position is steady');
const sd = spread(mk({ target: { id: 1 } }));
ok(sd > 0.01 && sd < 0.5, 'angry enderman: render position shivers (spread ' + sd + ')');
const rest = spread(mk({ target: { id: 1 }, type: 'zombie' }));
let caught = 0;
okAv(rest === 0 || rest === -1, 'a zombie with a target does not shiver'); caught++;
okAv(!(spread(mk({ target: null })) > 0), 'breaking the premise (calm) shows no jitter'); caught++;
if (fails.length) { fails.forEach((f) => console.log('  FAIL: ' + f)); process.exit(1); }
console.log(pass + ' checks passed, ' + caught + ' breaks caught');
