#!/usr/bin/env node
// wither1576check.mjs — #1576: WitherArmorFeatureRenderer (wither_armor.png on the 0.5-dilated model at health <= max/2).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, initRegistry } from './loadsrc.mjs';
import { ROOT } from './paths.mjs';

let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); return c; };
const okAv = (c, m) => { breaks++; ok(c, 'anti-vacuity: ' + m); if (c) console.log('   ✓ ' + m); };
const rd = (f) => readFileSync(join(ROOT, f), 'utf8');

const M = loadEngine({ extra: ['02g_items.js', '07h_entities.js', '14b_physics.js', '07i_entitylist.js',
  '07j_entityrender.js', '07m_breed.js', '10_gfx.js', '15h_bemodel.js', '07k_goals.js', '07t_fly.js', '07zw_mobnbt.js', '07_world.js', '07b_behaviour.js'], dom: false });
initRegistry(M);
const ER = M.EntityRender;

ok(/new Dilation\(0\.5F\)|WITHER_ARMOR/.test(rd('.decomp/net/minecraft/client/render/entity/model/EntityModelLayers.java')), '.decomp no longer has WITHER_ARMOR');
const on = (h) => ER.witherArmorOn({ type: 'wither', health: h, maxHealth: 300 });
ok(on(150) && on(1) && !on(151) && !on(300), 'gate is health <= max/2');
ok(!ER.witherArmorOn({ type: 'zombie', health: 1, maxHealth: 300 }), 'only withers');
ok(!!JSON.parse(rd('assets/mob-geometry.json')).layers.wither_armor, 'wither_armor has packed geometry');
const tsv = rd('tools/golden/models-1.18.2.tsv').split('\n').filter((l) => l.startsWith('wither_armor\t'));
ok(tsv.length === 9 && tsv.every((l) => l.split('\t')[19] === '0.5'), 'wither_armor rows are the wither boxes at grow 0.5');
ok(/wither_armor: P\('wither\/wither_armor\.png'\)/.test(rd('tools/extract-mob-textures.mjs')), 'wither_armor.png is extracted');
ok(/texKey: 'wither_armor'/.test(rd('src/07j_entityrender.js')), 'renderer pushes the armor pass');

okAv(!on(200), 'a layer drawn above half health would be caught');
okAv(!on(undefined), 'a wither with no health must not draw it');
okAv(tsv.every((l) => l.split('\t')[19] !== '0'), 'an undilated armor model would be caught');

console.log(`wither1576check (#1576, wither armor layer)\n assertions passed .. ${pass}\n failures ........... ${fails.length}\n breaks caught ...... ${breaks}`);
if (fails.length) { for (const f of fails) console.log('  FAIL: ' + f); process.exit(1); }
