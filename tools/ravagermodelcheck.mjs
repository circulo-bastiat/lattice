#!/usr/bin/env node
// ravagermodelcheck.mjs — #843: RavagerEntityModel.animateModel/setAngles (.decomp method_17089/method_17091):
// neck lunge + jaw during the bite (attackTick 10, 5), stun wobble (stunTick 20), roar jaw, 0.4 leg gait, parent links.
//   node tools/ravagermodelcheck.mjs
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { loadEngine, MCLITE_ROOT, initRegistry } from './loadsrc.mjs';

const ASSETS = join(MCLITE_ROOT, 'assets');
let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); return c; };
const okAv = (c, m) => { breaks++; if (ok(c, 'anti-vacuity: ' + m)) console.log('   ✓ ' + m); };
const near = (a, b, e = 1e-5) => Math.abs(a - b) <= e;
console.log('ravagermodelcheck — #843: ravager neck/jaw/stun/roar/legs');

const M = loadEngine({ extra: ['02f_tags.js', '02g_items.js', '07_world.js', '07h_entities.js', '07j_entityrender.js', '10_gfx.js', '15h_bemodel.js'], dom: false });
if (initRegistry) initRegistry(M);
const mm = JSON.parse(readFileSync(join(ASSETS, 'models.meta.json'), 'utf8'));
M.BEModel.init({ models: readFileSync(join(ASSETS, 'models.bin')).toString('base64'), modelsBytes: mm.rawBytes });
const ER = M.EntityRender, PI = Math.PI;
const D = (part, l, a, r) => ER.setupAnimDelta(part, l, a, 0, 0, false, 'quadruped', { ravager: Object.assign({ at: 0, st: 0, rt: 0, pt: 0 }, r) });

function run() {
  try { return run1(); } catch (e) { return ['threw: ' + e.message]; }
}
function run1() {
  const f = [];
  const t = (c, m) => { if (!c) f.push(m); };
  // attack tick 10, pt 0: wrap(10,10)=(|0-5|-2.5)/2.5=1 -> c=1 -> z=12; jaw (tick>5) sin(6/4)*PI*0.4
  let n = D('neck', 0, 0, { at: 10 }), j = D('mouth', 0, 0, { at: 10 });
  t(near(5.5 + n.dpz, -6.5 + 12), `attack 10: neck pivotZ 5.5 (${5.5 + n.dpz})`);
  t(near(j.rx, Math.sin(6 / 4) * PI * 0.4), `attack 10: jaw ${j.rx}`);
  // attack tick 5: wrap(5,10) = (|5-5|-2.5)/2.5 = -1 -> c=0 -> pivotZ -6.5; jaw PI/20*sin(PI*5/10)
  n = D('neck', 0, 0, { at: 5 }); j = D('mouth', 0, 0, { at: 5 });
  t(near(5.5 + n.dpz, -6.5), `attack 5: neck pivotZ (${5.5 + n.dpz})`);
  t(near(j.rx, PI / 20), `attack 5: jaw ${j.rx}`);
  // stun 20: pitch 0.21991149, pivotX sin(0.5*10)*3, jaw PI*0.05
  n = D('neck', 0, 0, { st: 20 }); j = D('mouth', 0, 0, { st: 20 });
  t(near(n.dpx, Math.sin(5) * 3) && near(n.rx, 0.21991149), `stun 20: neck x ${n.dpx} pitch ${n.rx}`);
  t(near(j.rx, PI * 0.05), `stun 20: jaw ${j.rx}`);
  // roar 10: jaw PI/2*sin((20-10)/20*PI*0.25); idle jaw PI*0.01
  j = D('mouth', 0, 0, { rt: 10 });
  t(near(j.rx, PI / 2 * Math.sin(0.5 * PI * 0.25)), `roar 10: jaw ${j.rx}`);
  t(near(D('mouth', 0, 0, {}).rx, PI * 0.01), 'idle jaw PI*0.01');
  // legs: 0.4 * limbDistance, cos(pos*0.6662)
  t(near(D('right_hind_leg', 2, 0.5, {}).rx, Math.cos(2 * 0.6662) * 0.4 * 0.5), 'hind leg amplitude 0.4');
  t(near(D('right_front_leg', 2, 0.5, {}).rx, Math.cos(2 * 0.6662 + PI) * 0.4 * 0.5), 'front leg opposite phase');
  t(ER.partParentOf('ravager', 'head') === 'neck' && ER.partParentOf('ravager', 'mouth') === 'head', 'parents neck>head>mouth');
  return f;
}
let f0 = run(); ok(f0.length === 0, 'ravager pose: ' + f0.join('; '));
{
  const k = ER.ravagerDelta; ER.ravagerDelta = () => null;
  okAv(run().length > 0, 'a model with no ravager pose is caught');
  ER.ravagerDelta = k;
  const p = ER.PART_PARENT.ravager; ER.PART_PARENT.ravager = {};
  okAv(run().length > 0, 'dropping the neck/head/mouth parents is caught');
  ER.PART_PARENT.ravager = p;
  const w = ER.ravagerWrap; ER.ravagerWrap = () => 0;
  okAv(run().length > 0, 'a broken bite wrap is caught');
  ER.ravagerWrap = w;
}
if (fails.length) { console.log(`${pass} assertions, ${fails.length} failures, ${breaks} breaks caught`); for (const x of fails) console.log('  ✗ ' + x); console.log('FAIL ravagermodelcheck'); process.exit(1); }
console.log(`PASS ravagermodelcheck: ${pass} assertions, 0 failures, ${breaks} breaks caught`);
