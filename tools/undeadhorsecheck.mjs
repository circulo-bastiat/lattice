#!/usr/bin/env node
// undeadhorsecheck.mjs — #715: zombie_horse / skeleton_horse drop their vanilla loot and DRAW.
//
//   node tools/undeadhorsecheck.mjs
//
// Vanilla: loot_tables/entities/zombie_horse.json = rotten_flesh 0..2 (looting-scaled);
// skeleton_horse.json = bone 0..2 (looting-scaled). Both render with the horse model
// (ZombieHorseEntityRenderer: horse_zombie.png / horse_skeleton.png, scale 1.0). The layer is keyed
// by the bare entity type, so the packed `zombie_horse`/`skeleton_horse` layers ARE the wiring.

import { readFileSync } from 'node:fs';
import { deflateRawSync } from 'node:zlib';
import { join } from 'node:path';
import { loadEngine, initRegistry, MCLITE_ROOT, ASSETS } from './loadsrc.mjs';

let pass = 0, breaks = 0;
const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); return c; };
const okAv = (c, m) => { breaks++; ok(c, 'anti-vacuity: ' + m); if (c) console.log('   ✓ ' + m); };

const M = loadEngine({
  extra: ['02f_tags.js', '02g_items.js', '07d_mining.js', '07e_loot.js', '07h_entities.js', '14b_physics.js',
          '07i_entitylist.js', '07n_tame.js', '07m_breed.js', '07r_mount.js', '07j_entityrender.js',
          '10_gfx.js', '15h_bemodel.js'],
  dom: false
});
initRegistry(M);
const mm = JSON.parse(readFileSync(join(MCLITE_ROOT, 'assets', 'models.meta.json'), 'utf8'));
M.BEModel.init({ models: readFileSync(join(MCLITE_ROOT, 'assets', 'models.bin')).toString('base64'), modelsBytes: mm.rawBytes });
const geomRaw = readFileSync(join(MCLITE_ROOT, 'assets', 'mob-geometry.json'));
M.DATA = Object.assign({}, M.DATA, {
  mobGeometry: deflateRawSync(geomRaw, { level: 9 }).toString('base64'), mobGeometryBytes: geomRaw.length,
  entities: JSON.parse(readFileSync(join(ASSETS, 'entities.json'), 'utf8'))
});
M.Entities.init(); M.EntityList.init(); M.Breed.init(); M.Tame.init(); M.Mount.init(); M.EntityRender.init();
const L = M.Loot, ER = M.EntityRender;

// ── loot ──
const total = (type, item, looting, n) => {
  const rng = L.rng(715); let t = 0, max = 0, other = 0;
  for (let i = 0; i < n; i++) {
    let one = 0;
    for (const s of L.entityDrops({ type, looting, rng })) { if (s.item === item) one += s.count; else other++; }
    t += one; if (one > max) max = one;
  }
  return { mean: t / n, max, other };
};
for (const [type, item] of [['zombie_horse', 'rotten_flesh'], ['skeleton_horse', 'bone']]) {
  const a = total(type, item, 0, 2000), b = total(type, item, 3, 2000);
  ok(a.other === 0, `${type} dropped something other than ${item}`);
  ok(a.max === 2 && Math.abs(a.mean - 1) < 0.1, `${type} ${item} at looting 0: mean ${a.mean}, max ${a.max} (want 0..2, mean 1)`);
  ok(b.max === 5 && b.mean > a.mean + 1.2, `${type} ${item} at looting 3: mean ${b.mean}, max ${b.max} (want 0..5, mean 2.5)`);
}
okAv(total('horse', 'rotten_flesh', 0, 200).mean === 0, 'a plain horse must NOT drop rotten_flesh (the probe can tell types apart)');
okAv(total('zombie_horse', 'bone', 0, 200).mean === 0, 'a zombie_horse must NOT drop bone');

// ── render ──
const mk = (type) => ({ type, x: 0, y: 5, z: 0, px: 0, py: 5, pz: 0, yaw: 0, pyaw: 0, age: 0, variant: 0 });
const tileOf = (type) => { const g = ER.mobGeomFor(type, type); return g && g[0][0][0].tile; };
for (const type of ['zombie_horse', 'skeleton_horse']) {
  M.EntityList.list = [mk(type)];
  const it = ER.visible(0, 5, 0, 1).find((i) => i.shape === 'mob' && i.mobLayer === type);
  ok(!!it, `ER.visible drew no mob item for ${type}`);
  const L2 = M.BEModel.layer(type);
  ok(!!L2 && L2.parts.length >= 10, `${type} has no horse-model layer`);
}
ok(tileOf('zombie_horse') !== tileOf('skeleton_horse'), 'zombie and skeleton horse sample the same skin tile');
okAv(tileOf('zombie_horse') !== tileOf('horse'), 'zombie_horse must sample its own skin, not the plain horse sheet');
M.EntityList.list = [mk('not_a_mob')];
okAv(!ER.visible(0, 5, 0, 1).some((i) => i.shape === 'mob'), 'an unknown type draws nothing (ER.visible probe can fail)');

// ── #1137: jump strength rolled per spawn (initAttributes -> getChildJumpStrengthBonus, 0.4..1.0) ──
for (const type of ['zombie_horse', 'skeleton_horse']) {
  const v = [];
  for (let i = 0; i < 30; i++) { const e = M.EntityList.spawn(type, 0, 5, 0); if (e) v.push(e.jumpStrengthAttr); }
  const inR = v.length === 30 && v.every((x) => typeof x === 'number' && x >= 0.4 && x <= 1.0);
  okAv(inR, `${type} jumpStrengthAttr defined and within [0.4,1.0] on all 30 spawns`);
  okAv(inR && Math.max(...v) - Math.min(...v) > 0, `${type} jumpStrengthAttr varies across spawns`);
}

console.log('');
console.log('================ undeadhorsecheck ===============');
console.log(` assertions passed .. ${pass}`);
console.log(` failures ........... ${fails.length}`);
console.log(` breaks caught ...... ${breaks}`);
console.log('=================================================');
for (const f of fails) console.log('FAIL  ' + f);
process.exit(fails.length ? 1 : 0);
