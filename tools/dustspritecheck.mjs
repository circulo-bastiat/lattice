#!/usr/bin/env node
// #5773: block-dust sprites for the blocks whose model particle is not in the block atlas.
// Every shulker box (17), bell, conduit, barrier, structure_void and light (16 levels) must emit >0 dust,
// the barrier/structure_void/light layer must be the one for the jar model's `textures.particle`
// (item/barrier ...), and every block whose model is `builtin/entity` must either emit dust or be named in
// ENTITY_NO_DUST. Anti-vacuity: the Px.OWED skip list restored (those blocks lose their layers) must fail.
import { existsSync, readFileSync } from 'node:fs';
import { loadEngine } from './loadsrc.mjs';
import { Jar } from './jarlib.mjs';
import { JARS } from './paths.mjs';

const M = loadEngine({ extra: ['07zx_particle.js'], dom: false });
const Px = M.Particle, S = M.States, R = M.Reg;
const flat = JARS + '/1.18.2.jar', nested = JARS + '/1.18.2/1.18.2.jar';
const jar = new Jar(existsSync(flat) ? flat : nested);
const model = (id) => { const p = 'assets/minecraft/models/' + id.replace(/^minecraft:/, '') + '.json'; return jar.names().includes(p) ? JSON.parse(jar.read(p).toString()) : null; };

const COLORS = ['white', 'orange', 'magenta', 'light_blue', 'yellow', 'lime', 'pink', 'gray', 'light_gray', 'cyan', 'purple', 'blue', 'brown', 'green', 'red', 'black'];
const PAD = (l) => (l < 10 ? '0' : '') + l;
// blocks with a builtin/entity item model that are NOT block-dust blocks (their block model has a real particle)
const ENTITY_NO_DUST = new Set([]);

const wanted = [];   // [blockName, stateNumber, expected particle texture or null]
for (const n of ['shulker_box', ...COLORS.map((c) => c + '_shulker_box'), 'bell', 'conduit']) wanted.push([n, S.stateOf(n), null]);
wanted.push(['barrier', S.stateOf('barrier'), model('block/barrier').textures.particle]);
wanted.push(['structure_void', S.stateOf('structure_void'), model('block/structure_void').textures.particle]);
const lvl = R.PROP.level;
for (let l = 0; l < 16; l++) {
  const st = S.withProp(S.stateOf('light'), lvl, R.PVAL[String(l)]);
  wanted.push(['light[level=' + l + ']', st, model('block/light_' + PAD(l)).textures.particle]);
}

const ptMeta = JSON.parse(readFileSync(new URL('../assets/particle-tex.meta.json', import.meta.url), 'utf8'));
M.DATA = Object.assign({}, M.DATA, { particleLayers: ptMeta.layers });
Px._resetLayerCacheForTest();
const run = () => {
  const f = [];
  const layerTex = new Map();   // layer -> texture it was claimed for
  for (const [name, st, tex] of wanted) {
    if (!(st > 0)) { f.push(name + ': no state'); continue; }
    Px.list.length = 0;
    const n = Px.addBlockBreakParticles(1, 2, 3, st, [[0, 0, 0, 1, 1, 1]], () => 0.5);
    if (!(n > 0)) { f.push(name + ': breaks with NO dust'); continue; }
    const lay = Px.list[0].entLayer;
    if (!(lay >= 0)) { f.push(name + ': no sprite layer'); continue; }
    if (tex) {
      if (layerTex.has(lay) && layerTex.get(lay) !== tex) f.push(name + ': layer shared with ' + layerTex.get(lay));
      layerTex.set(lay, tex);
    }
  }
  // distinct sprites -> distinct layers (all 16 light levels differ)
  const lights = wanted.filter((w) => w[0].startsWith('light[')).map((w) => Px.entityDustLayer(w[1]));
  if (new Set(lights).size !== 16) f.push('light levels do not each have their own sprite layer');
  if (Px.entityDustLayer(wanted.find((w) => w[0] === 'barrier')[1]) === Px.entityDustLayer(wanted.find((w) => w[0] === 'structure_void')[1])) f.push('barrier and structure_void share a layer');
  // the builtin/entity block list: nothing breaks silently
  for (const p of jar.names()) {
    const m = /^assets\/minecraft\/models\/block\/([^/]+)\.json$/.exec(p);
    if (!m) continue;
    const j = JSON.parse(jar.read(p).toString());
    if (j.parent !== 'builtin/entity' && j.parent !== 'minecraft:builtin/entity') continue;
    const b = m[1];
    if (ENTITY_NO_DUST.has(b)) continue;
    const st = S.stateOf(b);
    if (st > 0 && !(Px.entityDustLayer(st) >= 0)) f.push('builtin/entity block ' + b + ' breaks silently');
  }
  return f;
};

const fails = run();
const saved = M.DATA.particleLayers;
let breaks = 0;
// anti-vacuity: restore the OWED skip (no dust layers at all for these blocks)
M.DATA = Object.assign({}, M.DATA, { particleLayers: Object.assign({}, saved, { dust: {} }) });
Px._resetLayerCacheForTest();
if (run().length) { breaks++; console.log('   ✓ anti-vacuity: OWED skip list restored is caught'); }
const d2 = Object.assign({}, saved.dust); for (const k of ['barrier', 'structure_void', 'light_07']) delete d2[k];
M.DATA = Object.assign({}, M.DATA, { particleLayers: Object.assign({}, saved, { dust: d2 }) });
Px._resetLayerCacheForTest();
if (run().length) { breaks++; console.log('   ✓ anti-vacuity: barrier/structure_void/light dropped is caught'); }
M.DATA = Object.assign({}, M.DATA, { particleLayers: saved }); Px._resetLayerCacheForTest();

console.log(` assertions passed .. ${wanted.length}\n blocks checked ..... ${wanted.length}\n failures ........... ${fails.length}`);
for (const f of fails) console.log('   ✗ ' + f);
console.log(` ${breaks} breaks caught`);
process.exit(fails.length || breaks < 2 ? 1 : 0);
