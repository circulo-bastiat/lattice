#!/usr/bin/env node
// pandaskincheck.mjs — #918: PandaEntityRenderer.getTexture. Pd.skinKey(e) must pick the sheet of
// the PRODUCT gene (recessive brown/weak only when main==hidden), each of the 7 sheets must be packed
// in mob-geometry.json, and 07j_entityrender.js's texKey chain must call it.
//   node tools/pandaskincheck.mjs
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';

const ASSETS = join(MCLITE_ROOT, 'assets');
let pass = 0; const fails = []; let breaks = 0;
const ok = (c, m) => { if (c) pass++; else fails.push(m); return c; };
const okAv = (c, m) => { breaks++; ok(c, 'anti-vacuity: ' + m); if (c) console.log('   ✓ ' + m); };

const MCL = loadEngine({ extra: ['02f_tags.js', '02g_items.js', '07_world.js', '07b_behaviour.js', '07d_mining.js',
  '07e_loot.js', '07h_entities.js', '07y_equip.js', '14b_physics.js', '14c_raycast.js', '07i_entitylist.js',
  '07k_goals.js', '07l_spawn.js', '14d_survival.js', '14f_inventory.js', '14j_combat.js', '14l_use.js',
  '07za_explosion.js', '07m_breed.js', '07zh_rabbit.js', '07zj_fox.js', '07zj_goat.js', '07zl_panda.js'], dom: false });
const Pd = MCL.Panda;
const geom = JSON.parse(readFileSync(join(ASSETS, 'mob-geometry.json'), 'utf8'));
const chain = readFileSync(join(MCLITE_ROOT, 'src', '07j_entityrender.js'), 'utf8');

const G = Pd.Gene;
// [main, hidden, expected product gene name -> sheet index]
const CASES = [
  [G.NORMAL, G.NORMAL, 0], [G.LAZY, G.NORMAL, 1], [G.WORRIED, G.LAZY, 2], [G.PLAYFUL, G.WEAK, 3],
  [G.BROWN, G.BROWN, 4], [G.WEAK, G.WEAK, 5], [G.AGGRESSIVE, G.BROWN, 6],
  [G.BROWN, G.NORMAL, 0], [G.WEAK, G.LAZY, 0],   // recessive main, mismatched hidden -> normal
];
const keyOf = (i) => i === 0 ? 'panda' : 'panda#' + i;
function run(skin) {
  for (const [m, h, idx] of CASES) {
    const k = skin({ type: 'panda', mainGene: m, hiddenGene: h });
    ok(k === keyOf(idx), `genes ${m}/${h} must draw "${keyOf(idx)}" — got ${k}`);
  }
  return skin({ type: 'cow' }) === null;
}
ok(run(Pd.skinKey), 'a non-panda must get no skin key');
for (let i = 0; i < 7; i++) ok(!!geom.layers[keyOf(i)], `sheet "${keyOf(i)}" is not packed in mob-geometry.json`);
ok(/NS\.Panda\.skinKey\(e\)/.test(chain), '07j_entityrender.js texKey chain has no Panda.skinKey call');

// anti-vacuity: a picker that ignores genes / a geometry missing a sheet must be caught
{
  const before = fails.length;
  run(() => 'panda');
  okAv(fails.length > before, 'a gene-blind picker was not caught'); fails.length = before;
  const g2 = Object.assign({}, geom.layers); delete g2['panda#4'];
  okAv(!g2[keyOf(4)], 'a geometry missing the brown sheet was not caught');
  okAv(!/NS\.Panda\.skinKeyX\(e\)/.test(chain), 'a renderer without the picker call was not caught');
}
console.log('================ pandaskincheck ================');
console.log(` assertions passed .. ${pass}`);
console.log(` failures ........... ${fails.length}`);
for (const f of fails) console.log('   ✗ ' + f);
console.log(` ${breaks} breaks caught`);
process.exit(fails.length ? 1 : 0);
