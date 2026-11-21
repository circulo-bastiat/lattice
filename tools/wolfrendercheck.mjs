#!/usr/bin/env node
// wolfrendercheck.mjs — #910: WolfEntityModel.method_17131/method_17133 (sit pose, walking legs, tail yaw unless
// angry, tail pitch = getTailAngle, real_head roll = begging) through ER.setupAnimDelta / ER.animOf.
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

console.log('wolfrendercheck — #910');
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


const PI = Math.PI;
function sec() {
  const r = [], L = M.BEModel.layer('wolf');
  const rest = (n) => ER.findRestPartIn(L.parts, 'wolf', n);   // #1202: head/tail are VIRTUAL_PARTS (box-less parents)
  const W = (o) => Object.assign({ sitting: false, angry: false, tailAngle: PI / 5, headRoll: 0 }, o);
  const dl = (n, w, l, a, hp, hy) => ER.setupAnimDelta(n, l || 0, a || 0, hy || 0, hp || 0, false, null, { wolf: W(w), rest: rest(n) }) || { rx: 0, ry: 0, rz: 0 };
  // absolute pivot / pitch after the delta
  const at = (n, w, l, a) => { const x = dl(n, w, l, a), p = rest(n); return { px: p.px + (x.dpx || 0), py: p.py + (x.dpy || 0), pz: p.pz + (x.dpz || 0), rx: p.rx + x.rx, ry: p.ry + x.ry }; };
  const is = (m, n, w, e) => { const g = at(n, w); for (const k in e) if (!near(g[k], e[k], 1e-4)) { r.push(m + ' ' + n + '.' + k + '=' + g[k] + ' want ' + e[k]); return; } };
  const S = { sitting: true };
  is('sit', 'upper_body', S, { px: -1, py: 16, pz: -3, rx: PI * 2 / 5 });
  is('sit', 'body', S, { px: 0, py: 18, pz: 0, rx: PI / 4 });
  is('sit', 'right_hind_leg', S, { px: -2.5, py: 22.7, pz: 2, rx: PI * 3 / 2 });
  is('sit', 'left_hind_leg', S, { px: 0.5, py: 22.7, pz: 2, rx: PI * 3 / 2 });
  is('sit', 'right_front_leg', S, { px: -2.49, py: 17, pz: -4, rx: 5.811947 });
  is('sit', 'left_front_leg', S, { px: 0.51, py: 17, pz: -4, rx: 5.811947 });
  is('sit', 'tail', S, { px: -1, py: 21, pz: 6, rx: PI / 5 });
  is('stand', 'tail', {}, { px: -1, py: 12, pz: 8, rx: PI / 5 });
  is('stand', 'head', {}, { px: -1, py: 13.5, pz: -7 });
  is('stand', 'body', {}, { px: 0, py: 14, pz: 2, rx: PI / 2 });
  is('stand', 'upper_body', {}, { px: -1, py: 14, pz: -3, rx: PI / 2 });
  // walking legs and tail yaw
  const l = 2.0, a = 0.7, c = Math.cos(l * 0.6662) * 1.4 * a, c2 = Math.cos(l * 0.6662 + PI) * 1.4 * a;
  const wk = (n) => at(n, {}, l, a).rx;
  r.push((near(wk('right_hind_leg'), c) && near(wk('left_hind_leg'), c2) && near(wk('right_front_leg'), c2) && near(wk('left_front_leg'), c)) || 'walking legs');
  r.push(near(at('tail', {}, l, a).ry, c) || 'tail yaw sways');
  r.push(near(at('tail', { angry: true }, l, a).ry, 0) || 'angry tail yaw 0');
  r.push(near(at('tail', { tailAngle: 1.5393804 }).rx, 1.5393804) || 'tail pitch = tailAngle');
  // begging roll: pure roll when head is level; carries yaw/pitch otherwise
  r.push(near(dl('real_head', { headRoll: 0.3 }).rz, 0.3) || 'beg roll on real_head');
  r.push(near(dl('head', {}, 0, 0, 30).rx, 30 * 0.017453292) || 'head pitch');
  // animOf: state -> inputs
  const w = EL.spawn('wolf', 0.5, 64, 0.5);
  w.tamed = true; w.sitting = true; w.maxHealth = 20; w.health = 20;
  let A = M.EntityRender.animOf(w, 1).wolf;
  r.push((A && A.sitting && !A.angry && near(A.tailAngle, 0.55 * PI)) || 'animOf tamed full-health tail 0.55pi ' + JSON.stringify(A));
  w.health = 10; r.push(near(ER.animOf(w, 1).wolf.tailAngle, 0.35 * PI) || 'hurt tame tail');
  w.angerTime = 100; r.push((ER.animOf(w, 1).wolf.angry && near(ER.animOf(w, 1).wolf.tailAngle, 1.5393804)) || 'angry');
  w.angerTime = 0; w.begging = true; w.age = 1; ER.animOf(w, 1); w.age = 2;
  r.push(ER.animOf(w, 1).wolf.headRoll > 0.1 || 'beg ramps up');
  r.push(ER.animOf(EL.spawn('cow', 3.5, 64, 3.5), 1).wolf === null || 'cow has no wolf anim');
  EL.list.length = 0;
  return r.filter((x) => x !== true);
}
for (const f of sec()) ok(false, f); ok(true, 'sec');
{
  const k = ER.setupAnimDelta;
  ER.setupAnimDelta = (...a) => (a[0] === 'body' ? { rx: 0, ry: 0, rz: 0 } : k(...a));
  okAv(sec().length > 0, 'a sitting torso that never pitches is caught');
  ER.setupAnimDelta = (...a) => { const x = k(...a); return x && a[0] === 'tail' ? Object.assign({}, x, { ry: 0 }) : x; };
  okAv(sec().length > 0, 'a tail that never sways is caught');
  ER.setupAnimDelta = (...a) => { const x = k(...a); return x && a[0] === 'real_head' ? Object.assign({}, x, { rz: 0 }) : x; };
  okAv(sec().length > 0, 'a begging head that never rolls is caught');
  ER.setupAnimDelta = (...a) => (a[7] && a[7].wolf ? k(a[0], a[1], a[2], a[3], a[4], a[5], a[6], Object.assign({}, a[7], { wolf: Object.assign({}, a[7].wolf, { sitting: false }) })) : k(...a));
  okAv(sec().length > 0, 'a wolf that ignores sitting is caught');
  ER.setupAnimDelta = k;
  const w = ER.wolfTailAngle; ER.wolfTailAngle = () => PI / 5;
  okAv(sec().length > 0, 'a tail angle that ignores taming/anger is caught');
  ER.wolfTailAngle = w;
}
if (fails.length) { console.log(`${pass} assertions, ${fails.length} failures, ${breaks} breaks caught`); for (const f of fails) console.log('  ✗ ' + f); process.exit(1); }
console.log(`PASS wolfrendercheck: ${pass} assertions, 0 failures, ${breaks} breaks caught`);
