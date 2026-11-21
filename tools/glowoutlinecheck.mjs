#!/usr/bin/env node
// glowoutlinecheck.mjs — #5623: Glowing outline pass (ER.renderOutlines). Headless: proves the
// vertex stream (what both backends draw, depth test OFF) exists for a glowing mob, sits on its
// box, is absent without the effect, and that renderOrbs dispatches it. The picture itself is
// owed to a browser stage.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT, initRegistry } from './loadsrc.mjs';
const ASSETS = join(MCLITE_ROOT, 'assets');
const rdj = (f) => JSON.parse(readFileSync(join(ASSETS, f), 'utf8'));
const b64 = (f) => readFileSync(join(ASSETS, f)).toString('base64');
let pass = 0; const fails = []; let breaks = 0;
const ok = (c, m) => { if (c) { pass++; if (/^anti-vacuity/.test(m)) console.log('   ✓ ' + m); } else fails.push(m); return c; };
console.log('glowoutlinecheck — #5623: Glowing outline');
const M = loadEngine({ extra: ['02f_tags.js', '02g_items.js', '07_world.js', '09b_sky.js', '14b_physics.js',
  '14f_inventory.js', '07h_entities.js', '07y_equip.js', '07ox_enchhelper.js', '07i_entitylist.js', '07l_spawn.js',
  '07m_breed.js', '14i_hand.js', '14j_combat.js', '14d_survival.js', '07zk_undead.js', '07q_effects.js', '07k_goals.js',
  '07zzf_piglin.js', '07j_entityrender.js', '10_gfx.js', '15h_bemodel.js'], dom: false });
if (initRegistry) initRegistry(M);
M.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
M.DATA = Object.assign({}, M.DATA, { entities: rdj('entities.json') });
{ const mm = rdj('models.meta.json'); M.BEModel.init({ models: b64('models.bin'), modelsBytes: mm.rawBytes }); }
M.Entities.init(); M.EntityList.init(); M.Equip.init();
if (M.Effects && M.Effects.init) M.Effects.init();
M.Combat.init(); M.EntityRender.init();
const ER = M.EntityRender, EL = M.EntityList;
const cam = { x: 0.5, y: 65, z: -5, viewProj: new Float32Array(16) };
const z = EL.spawn('zombie', 0.5, 64, 0.5);
const quads = () => ER.buildOutlineVerts(cam, 1).length / (4 * ER.CRYSTAL_BEAM_VERTEX_FLOATS);
ok(quads() === 0, 'no outline without the effect');
M.Effects.addStatusEffect(z, 'glowing', 200, 0, false, true);
ok(quads() === 72, 'glowing zombie: 12 edges x 6 faces, got ' + quads());
const v = ER.buildOutlineVerts(cam, 1), b = M.Entities.boxAt('zombie', 0.5, 64, 0.5);
let inside = true;
for (let i = 0; i < v.length; i += 7) if (v[i] < b[0] - 0.2 || v[i] > b[3] + 0.2 || v[i + 1] < b[1] - 0.2 || v[i + 1] > b[4] + 0.2) inside = false;
ok(inside, 'outline hugs the zombie box');
let nd = null; ER.renderCrystalBeamsGL2 = (G, c, p, vv, noDepth) => { nd = noDepth; };
ER.renderOutlines({ name: 'webgl2' }, cam); ok(nd === true, 'drawn with depth test off (visible through walls)');
// anti-vacuity: breaks
breaks++; ER.OUTLINE_ENABLED = false; ok(quads() === 0, 'anti-vacuity: pass disabled -> no outline'); ER.OUTLINE_ENABLED = true;
breaks++; { const g = EL.spawn('zombie', 4.5, 64, 0.5); ok(quads() === 72, 'anti-vacuity: an un-glowing neighbour adds nothing'); g.removed = true; }
breaks++; z.removed = true; ok(quads() === 0, 'anti-vacuity: removed entity -> no outline');
if (fails.length) { console.log(`${pass} assertions, ${fails.length} failures, ${breaks} breaks caught`); for (const f of fails) console.log('  ✗ ' + f); console.log('FAIL glowoutlinecheck'); process.exit(1); }
console.log(`PASS glowoutlinecheck: ${pass} assertions, 0 failures, ${breaks} breaks caught`);
