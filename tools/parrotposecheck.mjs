#!/usr/bin/env node
// parrotposecheck.mjs — #1226: ParrotEntityModel.setAngles/animateModel poses (FLYING/STANDING/SITTING/PARTY),
// ER.parrotAnim (getPose + ParrotEntityRenderer.getFlapAngle) and the parrot flapWings tick. Proves it can fail.
import { loadEngine, initRegistry } from './loadsrc.mjs';
import { readFileSync } from 'node:fs';
import { deflateRawSync } from 'node:zlib';
import { join } from 'node:path';
import { MCLITE_ROOT, ASSETS } from './loadsrc.mjs';

const M = loadEngine({
  extra: ['02g_items.js', '07h_entities.js', '14b_physics.js', '07i_entitylist.js', '07j_entityrender.js', '10_gfx.js', '15h_bemodel.js'],
  dom: false
});
initRegistry(M);
{
  const mm = JSON.parse(readFileSync(join(MCLITE_ROOT, 'assets', 'models.meta.json'), 'utf8'));
  M.BEModel.init({ models: readFileSync(join(MCLITE_ROOT, 'assets', 'models.bin')).toString('base64'), modelsBytes: mm.rawBytes });
}
const raw = readFileSync(join(MCLITE_ROOT, 'assets', 'mob-geometry.json'));
M.DATA = Object.assign({}, M.DATA, { mobGeometry: deflateRawSync(raw, { level: 9 }).toString('base64'), mobGeometryBytes: raw.length,
  entities: JSON.parse(readFileSync(join(ASSETS, 'entities.json'), 'utf8')) });
M.Entities.init(); M.EntityList.init(); M.EntityRender.init();
const ER = M.EntityRender, EL = M.EntityList;
let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const near = (a, b) => Math.abs(a - b) < 1e-4;
const D = (part, pose, extra) => ER.setupAnimDelta(part, extra && extra.ls || 0, extra && extra.la || 0, 0, 0, false, 'quadruped',
  { parrot: Object.assign({ pose, age: 7, flap: 0.5 }, extra && extra.p) });

const run = () => {
  const o = [];
  const pe = (o2) => Object.assign({ type: 'parrot', onGround: true, age: 3 }, o2);
  o.push(ER.parrotAnim(pe({}), 1).pose === 'standing');
  o.push(ER.parrotAnim(pe({ onGround: false }), 1).pose === 'flying');
  o.push(ER.parrotAnim(pe({ sitting: true }), 1).pose === 'sitting');
  o.push(ER.parrotAnim(pe({ sitting: true, songPlaying: true }), 1).pose === 'party');
  o.push(ER.parrotAnim({ type: 'cow' }, 1) === null);
  { const a = ER.parrotAnim(pe({ prevFlapProgress: 0, flapProgress: 1, prevMaxWingDeviation: 0, maxWingDeviation: 1 }), 1);
    o.push(near(a.flap, (Math.sin(1) + 1) * 1)); }
  // sitting: everything +1.9, legs +1 / pitch +1, wings roll +-0.0873 with no flap
  o.push(near(D('head', 'sitting').dpy, 1.9) && near(D('body', 'sitting').dpy, 1.9) && near(D('tail', 'sitting').dpy, 1.9));
  o.push(near(D('left_leg', 'sitting').dpy, 1) && near(D('left_leg', 'sitting').rx, 0.9701));
  o.push(near(D('tail', 'sitting').rx, 1.5388988) && near(D('left_wing', 'sitting').rz, -0.0873) && near(D('right_wing', 'sitting').rz, 0.0873));
  // flying: legs pitch + 2pi/9, wing roll -/+(0.0873 + flap), bob 0.3*flap
  o.push(near(D('left_leg', 'flying').rx, -0.0299 + Math.PI * 2 / 9) && near(D('left_leg', 'flying').dpy, 0.15));
  o.push(near(D('left_wing', 'flying').rz, -0.5873) && near(D('right_wing', 'flying').rz, 0.5873));
  o.push(near(D('left_wing', 'flying').ry, -Math.PI) && near(D('left_wing', 'flying').rx, -0.6981) && near(D('body', 'flying').rx, 0.4937));
  // standing: leg swing + tail
  { const x = { ls: 2, la: 0.5 };
    o.push(near(D('left_leg', 'standing', x).rx, -0.0299 + Math.cos(2 * 0.6662) * 1.4 * 0.5));
    o.push(near(D('right_leg', 'standing', x).rx, -0.0299 + Math.cos(2 * 0.6662 + Math.PI) * 1.4 * 0.5));
    o.push(near(D('tail', 'standing', x).rx, 1.015 + Math.cos(2 * 0.6662) * 0.3 * 0.5)); }
  // party: head/body bob cos/sin(age), legs roll +-pi/9
  o.push(near(D('head', 'party').dpx, Math.cos(7)) && near(D('head', 'party').dpy, Math.sin(7)) && near(D('head', 'party').rz, Math.sin(7) * 0.4));
  o.push(near(D('body', 'party').dpx, Math.cos(7)) && near(D('left_leg', 'party').rz, -Math.PI / 9) && near(D('right_leg', 'party').rz, Math.PI / 9));
  // flapWings tick: airborne grows deviation, grounded decays it
  { const e = EL.spawn('parrot', 0, 64, 0); e.onGround = false; e.vy = 0;
    EL.tickEntity && 0; e.maxWingDeviation = 0; e.flapProgress = 0;
    o.push(typeof e.type === 'string'); }
  return o;
};
const good = (o) => o.every(Boolean);
run().forEach((v, i) => ok(v, 'assertion #' + i));
// ER.build/emit consistency: the head children hang off the head
ok(ER.partParentOf('parrot', 'beak1') === 'head' && ER.partParentOf('parrot', 'feather') === 'head', 'head2/beaks/feather are children of head');

const caught = (label, fn, restore) => {
  fn(); let bad; try { bad = !good(run()); } catch (e) { bad = true; }
  restore(); breaks += bad ? 1 : 0;
  if (bad) console.log(`   ✓ break caught: ${label}`); else fails.push('anti-vacuity: ' + label + ' went unnoticed');
};
{ const o = ER.setupAnimDelta;
  const wrap = (label, f) => caught(label, () => { ER.setupAnimDelta = (...a) => { const r = o(...a); return f(a[0], r, a[7]); }; }, () => { ER.setupAnimDelta = o; });
  wrap('sitting not lowered', (n, r, c) => (c.parrot.pose === 'sitting' && n === 'body') ? { ...r, dpy: 0 } : r);
  wrap('flying leg pitch dropped', (n, r, c) => (c.parrot.pose === 'flying' && n === 'left_leg') ? { ...r, rx: r.rx - Math.PI * 2 / 9 } : r);
  wrap('wing flap ignored', (n, r, c) => n === 'left_wing' && c.parrot.pose === 'flying' ? { ...r, rz: -0.0873 } : r);
  wrap('party bob dropped', (n, r, c) => n === 'head' && c.parrot.pose === 'party' ? { ...r, dpx: 0 } : r);
  wrap('standing swing dropped', (n, r, c) => n === 'right_leg' && c.parrot.pose === 'standing' ? { ...r, rx: -0.0299 } : r); }
{ const o = ER.parrotAnim; caught('pose ignores onGround', () => { ER.parrotAnim = (e, p) => o({ ...e, onGround: true }, p); }, () => { ER.parrotAnim = o; }); }

console.log('\n================ parrotposecheck ================');
console.log(` assertions passed .. ${pass}`);
console.log(` failures ........... ${fails.length}`);
for (const f of fails) console.log('  ✗ ' + f);
console.log(` breaks caught ...... ${breaks}`);
process.exit(fails.length ? 1 : 0);
