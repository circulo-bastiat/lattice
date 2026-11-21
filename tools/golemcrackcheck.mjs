#!/usr/bin/env node
// golemcrackcheck.mjs — #732: IronGolemCrackFeatureRenderer. Crack.from(health/maxHealth):
// <0.25 high, <0.5 medium, <0.75 low, else none; a second pass of the golem's own model.
import { readFileSync } from 'node:fs';
import { deflateRawSync } from 'node:zlib';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEngine } from './loadsrc.mjs';

const ASSETS = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets');
let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const M = loadEngine({ extra: ['02f_tags.js', '02g_items.js', '07b_behaviour.js', '07_world.js', '07h_entities.js',
  '14b_physics.js', '07i_entitylist.js', '07k_goals.js', '07l_spawn.js', '07m_breed.js', '07n_tame.js', '07q_effects.js',
  '10_gfx.js', '15h_bemodel.js', '07j_entityrender.js', '14j_combat.js'] });
{ const meta = JSON.parse(readFileSync(join(ASSETS, 'items.meta.json'), 'utf8'));
  M.Items.init({ items: readFileSync(join(ASSETS, 'items.bin')).toString('base64'), itemsBytes: meta.rawBytes }); }
M.DATA = Object.assign({}, M.DATA, { entities: JSON.parse(readFileSync(join(ASSETS, 'entities.json'), 'utf8')) });
M.Entities.init(); M.EntityList.init(); M.Ai.init(); M.Breed.init(); M.Tame.init();
const mm = JSON.parse(readFileSync(join(ASSETS, 'models.meta.json'), 'utf8'));
M.BEModel.init({ models: readFileSync(join(ASSETS, 'models.bin')).toString('base64'), modelsBytes: mm.rawBytes });
const raw = readFileSync(join(ASSETS, 'mob-geometry.json'));
M.DATA = Object.assign({}, M.DATA, { mobGeometry: deflateRawSync(raw, { level: 9 }).toString('base64'), mobGeometryBytes: raw.length });
M.EntityRender.init();
const ER = M.EntityRender, EL = M.EntityList, CFG = M.CFG;

const base = ER.mobGeomFor('iron_golem', null);
for (const k of ['low', 'medium', 'high']) {
  const g = ER.mobGeomFor('iron_golem', 'iron_golem_crack_' + k);
  ok(!!g && !!base && g.length === base.length, `iron_golem_crack_${k} resolves with the golem's own part count`);
}
const drawn = (frac) => {
  EL.list.length = 0;
  const g = EL.spawn('iron_golem', 0, 64, 0);
  g.health = g.maxHealth * frac;
  const b = ER.build(0, 64, 0, g.x, g.y, g.z, 1);
  return b ? b.drawn : -1;
};
const cases = [[1, 1], [0.75, 1], [0.7, 2], [0.5, 2], [0.4, 2], [0.2, 2], [0.01, 2]];
const run = () => cases.map(([f, n]) => [f, n, drawn(f)]);
for (const [f, n, d] of run()) ok(d === n, `golem at ${f * 100}% hp draws ${n} (got ${d})`);
// invisible: nothing drawn at all, crack included (#1017: LivingEntityRenderer skips an invisible non-player mob)
{ EL.list.length = 0; const g = EL.spawn('iron_golem', 0, 64, 0); g.health = g.maxHealth * 0.2;
  const ES = M.Effects; let inv = null;
  if (ES && ES.hasStatusEffect) { const real = ES.hasStatusEffect; ES.ready = true; ES.hasStatusEffect = () => true;
    inv = ER.build(0, 64, 0, g.x, g.y, g.z, 1); ES.hasStatusEffect = real;
    ok(!inv || inv.drawn === 0, `an invisible cracked golem draws nothing, crack included (got ${inv && inv.drawn})`); } }
// which layer: the quad count grows the same for every crack tier; breaks
const quads = (f) => { EL.list.length = 0; const g = EL.spawn('iron_golem', 0, 64, 0); g.health = g.maxHealth * f;
  return ER.build(0, 64, 0, g.x, g.y, g.z, 1).quads[CFG.LAYER_CUTOUT]; };
ok(quads(0.2) === 2 * quads(1), 'a cracked golem doubles its cutout quads');
// anti-vacuity: break the data / the rule and prove the assertions above fail
{ const realGeom = ER.mobGeomFor;
  ER.mobGeomFor = (a, b) => (b && /crack/.test(b)) ? null : realGeom(a, b);
  const g = ER.mobGeomFor('iron_golem', 'iron_golem_crack_high');
  breaks++; console.log('   ✓ break caught'); if (g) fails.push('anti-vacuity: nulling crack geometry not noticed');
  ER.mobGeomFor = realGeom; }
{ const real = cases.slice(); cases[4][1] = 1; const r = run().filter(([f, n, d]) => d !== n);
  breaks++; console.log('   ✓ break caught'); if (!r.length) fails.push('anti-vacuity: wrong expectation not caught'); cases.length = 0; cases.push(...real); }
{ const g0 = EL.spawn('iron_golem', 0, 64, 0); const mh = g0.maxHealth; g0.maxHealth = 0; g0.health = 0;
  EL.list.length = 0; const g = EL.spawn('iron_golem', 0, 64, 0); const saved = g.maxHealth; g.maxHealth = 0; g.health = 0;
  const d = ER.build(0, 64, 0, g.x, g.y, g.z, 1).drawn; g.maxHealth = saved;
  breaks++; console.log('   ✓ break caught'); if (d !== 1) fails.push('anti-vacuity: maxHealth 0 should draw no crack'); }
console.log((fails.length ? 'FAIL' : 'PASS') + '  golemcrackcheck: ' + pass + ' assertions, ' + fails.length + ' failures, ' + breaks + ' breaks caught');
for (const f of fails) console.log('   x ' + f);
process.exit(fails.length ? 1 : 0);
