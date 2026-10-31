#!/usr/bin/env node
// wolfmodelcheck.mjs — #1162 (the wolf half is #910's real_head/real_tail on master; this keeps the bee): a model part with NO cuboids (bee `bone`) never reaches the
// flattened box table, so its pivot was lost and its children drew at the root origin ("orientation of the
// wolf is mangled"). Composed pivots are checked against WolfEntityModel/BeeEntityModel (.decomp), the sit pose
// and head turn included, and every box-less transformed parent in .decomp must have a VIRTUAL_PARTS entry.
//   node tools/wolfmodelcheck.mjs
import { join } from 'node:path';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { loadEngine, MCLITE_ROOT, initRegistry } from './loadsrc.mjs';

const ASSETS = join(MCLITE_ROOT, 'assets');
let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); return c; };
const okAv = (c, m) => { breaks++; if (ok(c, 'anti-vacuity: ' + m)) console.log('   ✓ ' + m); };
const near = (a, b, e = 1e-4) => Math.abs(a - b) <= e;
console.log('wolfmodelcheck — #1162: box-less parent parts (wolf head/tail, bee bone)');

const M = loadEngine({ extra: ['02f_tags.js', '02g_items.js', '07_world.js', '07h_entities.js', '07j_entityrender.js', '10_gfx.js', '15h_bemodel.js'], dom: false });
if (initRegistry) initRegistry(M);
const mm = JSON.parse(readFileSync(join(ASSETS, 'models.meta.json'), 'utf8'));
M.BEModel.init({ models: readFileSync(join(ASSETS, 'models.bin')).toString('base64'), modelsBytes: mm.rawBytes });
const ER = M.EntityRender, PI = Math.PI;
const parts = n => M.BEModel.layer(n).parts;
const pose = (layer, part, w, yaw) => ER.fullyPosedPart(parts(layer), layer, { limbSwing: 0, limbSwingAmount: 0, netHeadYaw: yaw || 0, headPitch: 0, riding: false, wolf: w }, part);

function run() { try { return run1(); } catch (e) { return ['threw: ' + e.message]; } }
function run1() {
  const f = [];
  const t = (c, m) => { if (!c) f.push(m); };
  const at = (p, x, y, z, rx, m) => t(p && near(p.px, x) && near(p.py, y) && near(p.pz, z) && near(p.rx, rx), `${m}: got ${p && [p.px, p.py, p.pz, p.rx].map(v => +v.toFixed(3))}, want ${[x, y, z, +rx.toFixed(3)]}`);
  at(pose('bee', 'body', null), 0, 19, 0, 0, 'bee body under bone');
  at(pose('bee', 'left_wing', null), 1.5, 15, -3, 0, 'bee wing under bone');
  return f;
}
const f0 = run(); ok(f0.length === 0, 'bee pose: ' + f0.join('; '));

// class audit: every box-less, transformed parent in .decomp needs a virtual part
{
  const dir = join(MCLITE_ROOT, '.decomp/net/minecraft/client/render/entity/model');
  let n = 0;
  if (existsSync(dir)) for (const f of readdirSync(dir)) {
    const s = readFileSync(join(dir, f), 'utf8');
    for (const m of s.matchAll(/addChild\(\s*"(\w+)",\s*ModelPartBuilder\.create\(\),\s*ModelTransform\.(?:pivot|of)\(/g)) {
      n++;
      const layer = f.replace(/EntityModel\.java$/, '').toLowerCase();
      ok(ER.VIRTUAL_PARTS[layer] && ER.VIRTUAL_PARTS[layer][m[1]], `${f}: box-less transformed parent '${m[1]}' has no VIRTUAL_PARTS entry`);
    }
  }
  ok(n >= 3, `audit saw ${n} box-less parents (want >= 3: wolf head, wolf tail, bee bone)`);
}
{
  const p = ER.VIRTUAL_PARTS; ER.VIRTUAL_PARTS = {};
  okAv(run().length > 0, 'dropping the virtual parents is caught');
  ER.VIRTUAL_PARTS = p;
  const q = ER.PART_PARENT.bee; ER.PART_PARENT.bee = {};
  okAv(run().length > 0, 'dropping the bee parent links is caught');
  ER.PART_PARENT.bee = q;
  const vp = ER.VIRTUAL_PARTS.bee.bone.py; ER.VIRTUAL_PARTS.bee.bone.py = 0;
  okAv(run().length > 0, 'a wrong bone pivot is caught');
  ER.VIRTUAL_PARTS.bee.bone.py = vp;
}
if (fails.length) { console.log(`${pass} assertions, ${fails.length} failures, ${breaks} breaks caught`); for (const x of fails) console.log('  ✗ ' + x); console.log('FAIL wolfmodelcheck'); process.exit(1); }
console.log(`PASS wolfmodelcheck: ${pass} assertions, 0 failures, ${breaks} breaks caught`);
