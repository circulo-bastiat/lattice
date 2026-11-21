import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT, initRegistry } from './loadsrc.mjs';
const ASSETS = join(MCLITE_ROOT, 'assets');
const rdj = (f) => JSON.parse(readFileSync(join(ASSETS, f), 'utf8'));
const b64 = (f) => readFileSync(join(ASSETS, f)).toString('base64');
let pass = 0; const fails = []; let breaks = 0;
const ok = (c, m) => { if (c) pass++; else fails.push(m); return c; };
const okAv = (c, m) => { breaks++; if (ok(c, 'anti-vacuity: ' + m)) console.log('   ✓ ' + m); };
const near = (a, b, e = 1e-5) => Math.abs(a - b) <= e;
console.log('turtlerendercheck — #1256: turtle legs + plastron');
const src = (f) => readFileSync(join(MCLITE_ROOT, '.decomp/net/minecraft/client/render/entity', f), 'utf8');

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
const EL = M.EntityList, IT = M.Items, Eq = M.Equip, ER = M.EntityRender;
const realLayers = ER.itemLayers, realPart = ER.spritePartOf;
ER.itemLayers = (i) => { const r = realLayers && realLayers(i); return r && r.length ? r : [1000 + i]; };
ER.spritePartOf = (t) => { const r = realPart ? realPart(t) : -1; return r >= 0 ? r : 7; };


const tm = readFileSync(join(MCLITE_ROOT, '.decomp/net/minecraft/client/render/entity/model/TurtleEntityModel.java'), 'utf8');
ok(/plastron\.visible = !this\.child && \$\$0\.hasEgg\(\)/.test(tm) && /translate\(0\.0, -0\.08F, 0\.0\)/.test(tm), 'decomp plastron');
ok(/\$\$0\.isDiggingSand\(\) \? 4\.0F : 1\.0F/.test(tm) && /\* 8\.0F \* \$\$2 \* \$\$7/.test(tm) && /\* 3\.0F \* \$\$2/.test(tm), 'decomp land legs');
const L = M.BEModel.layer('turtle');
const P = Math.PI, c = Math.cos;
let formulas = (n, l, a, st) => {   // expected [rx, ry, rz]
  const w = l * 0.6662 * 0.6, land = !st.inWater && st.onGround, k = st.digging ? 4 : 1, m = st.digging ? 2 : 1;
  if (n === 'left_hind_leg') return land ? [0, c(l * 5) * 3 * a, 0] : [c(w + P) * 0.5 * a, 0, 0];
  if (n === 'right_hind_leg') return land ? [0, c(l * 5 + P) * 3 * a, 0] : [c(w) * 0.5 * a, 0, 0];
  if (n === 'left_front_leg') return land ? [0, c(k * l * 5) * 8 * a * m, 0] : [0, 0, c(w) * 0.5 * a];
  return land ? [0, c(k * l * 5 + P) * 8 * a * m, 0] : [0, 0, c(w + P) * 0.5 * a];
};
const legs = ['left_hind_leg', 'right_hind_leg', 'left_front_leg', 'right_front_leg'];
const states = [
  { inWater: true, onGround: false, digging: false, belly: false },
  { inWater: false, onGround: true, digging: false, belly: false },
  { inWater: false, onGround: true, digging: true, belly: false },
  { inWater: false, onGround: true, digging: false, belly: true },
  { inWater: true, onGround: false, digging: false, belly: true },
];
function sec1() {
  const r = [];
  for (const st of states) for (const n of legs) {
    const d = ER.setupAnimDelta(n, 3.7, 0.6, 0, 0, false, 'quadruped', { turtle: st });
    const f = formulas(n, 3.7, 0.6, st);
    r.push((d && near(d.rx, f[0]) && near(d.ry, f[1]) && near(d.rz, f[2]) && near(d.dpy || 0, st.belly ? -1.28 : 0))
      || n + ' ' + JSON.stringify(st) + ' -> ' + JSON.stringify(d) + ' want ' + f);
  }
  const body = ER.setupAnimDelta('body', 3.7, 0.6, 0, 0, false, 'quadruped', { turtle: states[3] });
  r.push((body && near(body.dpy, -1.28)) || 'belly lowers the body 0.08 block');
  r.push(!ER.setupAnimDelta('body', 3.7, 0.6, 0, 0, false, 'quadruped', { turtle: states[0] }) || 'no belly: body untouched');
  // animOf reads the entity
  const t = EL.spawn('turtle', 0.5, 64, 0.5);
  t.hasEgg = true; t.diggingSand = true; t.onGround = true; t.inWater = false;
  let a = ER.animOf(t, 1).turtle;
  r.push((a && a.belly && a.digging && a.onGround && !a.inWater) || 'animOf adult: ' + JSON.stringify(a));
  t.isBaby = true; a = ER.animOf(t, 1).turtle;
  r.push((a && !a.belly) || 'baby never shows the plastron');
  // emission: the egg_belly boxes appear only with belly
  const count = (belly) => { const o = ER.emitMobLayer([], 0, 'turtle', 0, 64, 0, 1, 0, 15, 0, 0,
      { limbSwing: 0, limbSwingAmount: 0, netHeadYaw: 0, headPitch: 0, turtle: Object.assign({}, states[0], { belly }) },
      undefined, 'turtle'); return typeof o === 'number' ? o : (o && o.length) || 0; };
  r.push(count(true) > count(false) || 'egg_belly emitted only when visible: ' + count(true) + ' vs ' + count(false));
  return r;
}
for (const x of sec1()) { if (x !== true) fails.push(String(x)); else pass++; }
// anti-vacuity: break each formula and the check must notice
const realDelta = ER.turtleDelta;
const breakers = [
  (n, l, a, t, b) => { const o = realDelta(n, l, a, Object.assign({}, t, { digging: false }), b); return o; },
  (n, l, a, t, b) => { const o = realDelta(n, l, a, Object.assign({}, t, { belly: false }), b); return o; },
  (n, l, a, t, b) => { const o = realDelta(n, l, a, Object.assign({}, t, { onGround: false }), b); return o; },
];
for (const [i, br] of breakers.entries()) {
  ER.turtleDelta = br;
  const bad = sec1().filter((x) => x !== true).length;
  breaks++; ok(bad > 0, 'anti-vacuity: breaker ' + i + ' caught'); if (bad > 0) console.log('   ✓ breaker ' + i + ' caught (' + bad + ' mismatches)');
}
ER.turtleDelta = realDelta;
if (fails.length) { console.log(`${pass} assertions, ${fails.length} failures, ${breaks} breaks caught`); for (const f of fails) console.log('  ✗ ' + f); console.log('FAIL turtlerendercheck'); process.exit(1); }
console.log(`PASS turtlerendercheck: ${pass} assertions, 0 failures, ${breaks} breaks caught`);
