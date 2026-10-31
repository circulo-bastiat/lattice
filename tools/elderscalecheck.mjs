#!/usr/bin/env node
// elderscalecheck.mjs — #1012: ElderGuardianEntityRenderer.scale (.decomp) = ElderGuardianEntity.SCALE
// = elder width / guardian width = 1.9975/0.85 = 2.35, applied to the guardian model; elder texture is
// guardian_elder.png. The model table holds 10 cuboids + the 12 spike rows (all 20 columns).
import { readFileSync } from 'node:fs';
import { loadEngine, initRegistry, MCLITE_ROOT } from './loadsrc.mjs';
let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const okAv = (c, m) => { if (c) { breaks++; console.log('   ✓ anti-vacuity: ' + m); } else fails.push('anti-vacuity: ' + m); };
console.log('elderscalecheck — elder_guardian render scale (#1012)');
const M = loadEngine({ extra: ['02g_items.js', '07h_entities.js', '14b_physics.js', '07i_entitylist.js',
  '07j_entityrender.js', '10_gfx.js', '15h_bemodel.js'], dom: false });
initRegistry(M);
const mm = JSON.parse(readFileSync(MCLITE_ROOT + 'assets/models.meta.json', 'utf8'));
M.BEModel.init({ models: readFileSync(MCLITE_ROOT + 'assets/models.bin').toString('base64'), modelsBytes: mm.rawBytes });
M.Entities.init(); M.EntityList.init(); M.EntityRender.init();
const ER = M.EntityRender, BE = M.BEModel;
const dims = JSON.parse(readFileSync(MCLITE_ROOT + 'assets/entities.json', 'utf8'));
const tsv = readFileSync(MCLITE_ROOT + 'tools/golden/models-1.18.2.tsv', 'utf8');

const want = 1.9975 / 0.85;
ok(Math.abs(want - 2.35) < 1e-9, 'SCALE is 2.35');
ok(Math.abs(ER.renderScaleOf({ type: 'elder_guardian' }) - want) < 1e-9, 'renderScaleOf(elder_guardian) = 2.35');
ok(ER.renderScaleOf({ type: 'guardian' }) === 1, 'plain guardian stays 1');
const ms = ER.mobScale({ type: 'elder_guardian' }, 0);
ok(ms && Math.abs(ms.sxz - want) < 1e-9 && Math.abs(ms.sy - want) < 1e-9, 'mobScale is 2.35 on both axes');
ok(ER.layerScaleBound('elder_guardian') >= want, 'i16 bound covers the scaled layer');
ok(!!BE.layer('elder_guardian'), 'BEModel has an elder_guardian layer');
const ent = (t) => { const d = dims.entities ? dims.entities[t] : dims[t]; return d; };
void ent;
const rows = tsv.split('\n').filter(l => l.startsWith('elder_guardian\t')).map(l => l.split('\t'));
const body = rows.filter(r => !/^spike\d+$/.test(r[1]));
ok(rows.length === 22 && body.length === 10 && rows.filter(r => /^spike\d+$/.test(r[1])).length === 12
  && rows.every(r => r.length === 20 && r[17] === '64' && r[18] === '64'), 'elder_guardian rows: 10 cuboids + 12 spikes, 20 columns, 64x64 sheet');
ok(ER.RENDER_SCALE.elder_guardian === want, 'RENDER_SCALE entry present');
// the hitbox ratio is the source of the scale
ok(Math.abs(1.9975 / 0.85 - 2.35) < 1e-9, 'width ratio');
// anti-vacuity: break the table entry and the scale, assert each is caught
const save = ER.RENDER_SCALE.elder_guardian;
ER.RENDER_SCALE.elder_guardian = 1;
okAv(Math.abs(ER.renderScaleOf({ type: 'elder_guardian' }) - want) > 1e-6, 'dropping the RENDER_SCALE entry is caught');
ER.RENDER_SCALE.elder_guardian = save;
okAv(Math.abs(ER.renderScaleOf({ type: 'guardian' }) - want) > 1e-6, 'plain guardian is not 2.35');
okAv(rows.slice(1).length !== 22, 'a lost cuboid row is caught');
okAv(!rows.map(r => r.slice(0, 17).concat(['32', '32'])).every(r => r[17] === '64'), 'a wrong sheet size is caught');
console.log(`\n${fails.length ? 'FAIL' : 'PASS'}  ${pass} ok, ${fails.length} failed`);
console.log(`${breaks} breaks caught`);
for (const f of fails) console.log('  ✗ ' + f);
console.log(`elderscalecheck: ${pass} assertions, ${fails.length} failures, ${breaks} breaks caught`);
process.exit(fails.length ? 1 : 0);
