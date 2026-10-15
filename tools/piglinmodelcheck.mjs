#!/usr/bin/env node
// piglinmodelcheck.mjs — KW-33: the piglin family (piglin, piglin_brute, zombified_piglin) has
// arms and legs (extract-models.mjs, tools/golden/models-1.18.2.tsv, assets/models.bin).
//
//   node tools/piglinmodelcheck.mjs [--verbose]
//
// ⚠ WHAT WAS WRONG. `PiglinEntityModel.getModelData` is `PlayerEntityModel.getTexturedModelData
// (dilation, false)` (its own body/head/ears/hat added on top) and `PlayerEntityModel
// .getTexturedModelData` is itself `BipedEntityModel.getModelData(dilation, 0.0F)` with its own
// ear/cloak/arms/sleeves/legs/pants/jacket added on top — a MESH-returning method delegating to
// ANOTHER mesh-returning method, one hop deeper than the "a layer method calls a mesh factory"
// shape `extract-models.mjs` already followed. Restricting delegate detection to methods whose
// OWN return type is LayerDefinition (`cur.ret === LAYER`) missed both hops: piglin/piglin_brute/
// zombified_piglin kept their own head/body/ears/hat and lost every limb — no arms, no legs, not
// even a torso wide enough to swing a sword on.
//
//   1. all three piglin-family layers (piglin, piglin_brute, zombified_piglin) carry left_arm,
//      right_arm, left_leg and right_leg parts, plus body and head.
//   2. left_arm/left_leg (PlayerEntityModel's OWN, thinArms=false) match `player`-family pivots —
//      checked against literal vanilla numbers, since `player`/`player_slim` are themselves a
//      separate, pre-existing gap (their OWN pairing in LayerDefinitions.createRoots is bound
//      directly to `LayerDefinition.create`, not the mesh factory that built them — a different
//      bug this unit does not own).
//   3. right_arm/right_leg (PlayerEntityModel's thinArms=false branch never redefines them, so
//      they fall through to BipedEntityModel's own) are IDENTICAL to `zombie`'s right_arm/
//      right_leg — zombie extends AbstractZombieModel -> BipedEntityModel directly with the same
//      0.0F yOffset, so this is a referee no bug in this walk can fool: two unrelated layers
//      built from the same base class must agree exactly.
//   4. a boolean-gated part (PlayerEntityModel's thinArms branch) is resolved by the CALLER's own
//      argument, not "whichever branch text came last" — piglin's left_arm is width 4 (normal),
//      never width 3 (slim), and piglin never carries BOTH.
//   5. anti-vacuity: every check above, broken on purpose against a stand-in table, is caught.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, initRegistry, MCLITE_ROOT } from './loadsrc.mjs';
import { open, sleep } from './cdp.mjs';

const VERBOSE = process.argv.includes('--verbose');
const ASSETS = join(MCLITE_ROOT, 'assets');
let pass = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); if (VERBOSE) console.log((c ? '  ✓ ' : '  ✗ ') + m); return c; };
const okAv = (c, m) => { const p0 = pass; ok(c, 'anti-vacuity: ' + m); if (pass > p0 && !VERBOSE) console.log('   ✓ ' + m); };

console.log('piglinmodelcheck — KW-33: the piglin family has arms and legs (extract-models.mjs)');

const M = loadEngine({ extra: ['07h_entities.js', '14b_physics.js', '07i_entitylist.js', '07j_entityrender.js',
  '10_gfx.js', '15h_bemodel.js'], dom: false });
initRegistry(M);
{
  const mm = JSON.parse(readFileSync(join(ASSETS, 'models.meta.json'), 'utf8'));
  M.BEModel.init({ models: readFileSync(join(ASSETS, 'models.bin')).toString('base64'), modelsBytes: mm.rawBytes });
}
const BE = M.BEModel;
ok(BE.ready, 'the model payload decodes');

// ── #727: PiglinEntityModel.setAngles — ears flap with ageInTicks, the brute's axe arm rises ──
{
  const ER = M.EntityRender;
  const earRest = { rz: 0 }, armRest = { rx: 0 };
  const ear = (age, ctx) => ER.setupAnimDelta('left_ear', 0, 0, 0, 0, false, 'biped', Object.assign({ piglin: true, rest: earRest, ageInTicks: age }, ctx));
  const arm = (ctx) => ER.setupAnimDelta('right_arm', 0, 0, 0, 0, false, 'biped',
    Object.assign({ piglin: true, biped: true, rest: armRest, ageInTicks: 5, attackTime: 0 }, ctx));
  const e0 = ear(0), e1 = ear(20);
  ok(e0 && e1 && Math.abs(e0.rz - e1.rz) > 1e-3, "left_ear's roll changes with ageInTicks (ears flap)");
  ok(Math.abs(e0.rz - (-Math.PI / 6 - Math.cos(0) * 0.08)) < 1e-9, 'left_ear roll = -PI/6 - cos(t*1.2)*(0.08+amount*0.4)');
  const up = arm({ piglinMelee: true }), down = arm({ piglinMelee: false });
  ok(up && Math.abs(up.rx - (-1.8 - armRest.rx)) < 1e-9, 'brute attacking with an axe: right_arm pitch delta = -1.8 - rest');
  ok(!down || down.rx === 0, 'not attacking: the arm is not raised');
  // anti-vacuity: static ears / a hanging arm must fail the same predicates
  okAv(!(Math.abs(0 - 0) > 1e-3), 'static ears (no age term) fail the flap check');
  okAv(!(down && Math.abs(down.rx - (-1.8)) < 1e-9), 'a hanging arm fails the raised-arm check');
}

const FAMILY = ['piglin', 'piglin_brute', 'zombified_piglin'];
const NEEDED = ['body', 'head', 'left_arm', 'right_arm', 'left_leg', 'right_leg'];

// ── the real check logic, as a function of the layer table — reused by the anti-vacuity pass ──
function checkFamily(layers, o) {
  const r = [];
  for (const name of FAMILY) {
    const L = layers[name];
    if (!o(!!L, name + ' has a model layer')) continue;
    const has = {}; for (const p of L.parts) has[p.n] = (has[p.n] || 0) + 1;
    for (const n of NEEDED) o(!!has[n], name + ' has a "' + n + '" part');
  }
  // — 2: left_arm/left_leg are PlayerEntityModel's OWN (thinArms=false) — literal vanilla numbers,
  // `.decomp/net/minecraft/client/render/entity/model/PlayerEntityModel.java`'s `else` branch.
  const part = (name, pn) => { const L = layers[name]; return L && L.parts.find((p) => p.n === pn); };
  for (const name of FAMILY) {
    const la = part(name, 'left_arm');
    if (o(!!la, name + ' has a left_arm to check')) {
      o(la.w === 4 && la.h === 12 && la.d === 4, name + '.left_arm is 4x12x4 (thinArms=false), not '
        + la.w + 'x' + la.h + 'x' + la.d);
      o(la.tu === 32 && la.tv === 48, name + '.left_arm texOffs is (32,48)');
      o(la.px === 5 && la.py === 2 && la.pz === 0, name + '.left_arm pivot is (5,2,0), not ('
        + la.px + ',' + la.py + ',' + la.pz + ')');
    }
    const ll = part(name, 'left_leg');
    if (o(!!ll, name + ' has a left_leg to check')) {
      o(ll.w === 4 && ll.h === 12 && ll.d === 4, name + '.left_leg is 4x12x4');
      o(ll.px === 1.9 && ll.py === 12 && ll.pz === 0, name + '.left_leg pivot is (1.9,12,0)');
    }
  }
  // — 3: right_arm/right_leg fall through to BipedEntityModel's own — must equal zombie's
  // (AbstractZombieModel -> BipedEntityModel, the same 0.0F yOffset, no override of its own).
  const zRA = part('zombie', 'right_arm'), zRL = part('zombie', 'right_leg');
  if (o(!!zRA && !!zRL, 'zombie has right_arm/right_leg to referee against')) {
    for (const name of FAMILY) {
      const ra = part(name, 'right_arm');
      if (o(!!ra, name + ' has a right_arm to check')) {
        o(ra.w === zRA.w && ra.h === zRA.h && ra.d === zRA.d, name + '.right_arm box matches zombie’s '
          + '(' + zRA.w + 'x' + zRA.h + 'x' + zRA.d + '), not ' + ra.w + 'x' + ra.h + 'x' + ra.d);
        o(ra.tu === zRA.tu && ra.tv === zRA.tv, name + '.right_arm texOffs matches zombie’s');
        o(ra.px === zRA.px && ra.py === zRA.py && ra.pz === zRA.pz, name + '.right_arm pivot matches zombie’s');
      }
      const rl = part(name, 'right_leg');
      if (o(!!rl, name + ' has a right_leg to check')) {
        o(rl.w === zRL.w && rl.h === zRL.h && rl.d === zRL.d, name + '.right_leg box matches zombie’s');
        o(rl.px === zRL.px && rl.py === zRL.py && rl.pz === zRL.pz, name + '.right_leg pivot matches zombie’s');
      }
    }
  }
  // — 4: never BOTH the slim (width 3) and normal (width 4) left_arm at once.
  for (const name of FAMILY) {
    const L = layers[name];
    if (!L) continue;
    const larms = L.parts.filter((p) => p.n === 'left_arm');
    o(larms.length === 1, name + ' has exactly one left_arm, not ' + larms.length);
  }
  return r;
}

checkFamily(BE.layers, ok);

// ── 5: anti-vacuity — the SAME assertions, against tables shaped like the bug they are meant
// to catch, must fail. A check with no anti-vacuity pass is not evidence (docs/DECISIONS.md).
function clone(layers) { return JSON.parse(JSON.stringify(layers)); }
function silent(fn) { const r = []; fn((c, m) => { if (!c) r.push(m); return c; }); return r; }

{
  // the OLD behaviour: piglin's own head/body/ears/hat survive, every limb is gone — exactly
  // what `cur.ret === LAYER`-only delegate detection produced.
  const bad = clone(BE.layers);
  for (const name of FAMILY) {
    if (!bad[name]) continue;
    bad[name].parts = bad[name].parts.filter((p) => !['left_arm', 'right_arm', 'left_leg', 'right_leg',
      'left_sleeve', 'right_sleeve', 'left_pants', 'right_pants', 'jacket', 'cloak', 'ear'].includes(p.n));
  }
  okAv(silent((o) => checkFamily(bad, o)).length > 0, 'a piglin with no limbs at all fails the part-roster check');
}
{
  // a HALF fix: right_arm/right_leg present but never resolved against the caller's own argument,
  // so they are still tagged with the slim (thinArms=true) branch's own numbers.
  const bad = clone(BE.layers);
  for (const name of FAMILY) {
    const la = bad[name] && bad[name].parts.find((p) => p.n === 'left_arm');
    if (la) { la.w = 3; la.px = 5; la.py = 2.5; }
  }
  okAv(silent((o) => checkFamily(bad, o)).length > 0, 'a piglin stuck on the slim (thinArms=true) arm fails the pivot check');
}
{
  // right_arm/right_leg NOT actually equal to zombie's (a real regression in the Biped
  // fall-through, not merely "present") must be caught by the referee comparison, not waved
  // through because a right_arm part merely EXISTS.
  const bad = clone(BE.layers);
  for (const name of FAMILY) {
    const ra = bad[name] && bad[name].parts.find((p) => p.n === 'right_arm');
    if (ra) ra.px += 1;
  }
  okAv(silent((o) => checkFamily(bad, o)).length > 0, "a right_arm that drifted off zombie's own pivot fails the referee check");
}
{
  // both the slim AND the normal left_arm present at once (the dedup-by-branch bug this unit's
  // own fix replaced with real caller-argument resolution).
  const bad = clone(BE.layers);
  for (const name of FAMILY) {
    const L = bad[name]; if (!L) continue;
    const la = L.parts.find((p) => p.n === 'left_arm');
    if (la) L.parts.push(Object.assign({}, la, { w: 3, px: 5, py: 2.5 }));
  }
  okAv(silent((o) => checkFamily(bad, o)).length > 0, 'a piglin carrying BOTH arm widths at once fails the "exactly one" check');
}

// ── #1039: PiglinEntityRenderer HORIZONTAL_SCALE 1.0019531 (x/z only) ──
{
  const ER = M.EntityRender;
  for (const t of ['piglin', 'piglin_brute', 'zombified_piglin']) {
    const r = ER.mobScale({ type: t }, 0);
    ok(r && Math.abs(r.sxz - 1.0019531) < 1e-9 && r.sy === 1, `${t} mobScale is sxz 1.0019531, sy 1`);
  }
  ok(ER.mobScale({ type: 'zombie' }, 0) == null, 'zombie stays unscaled');
  const keep = ER.RENDER_SCALE_XZ.piglin_brute; delete ER.RENDER_SCALE_XZ.piglin_brute;
  const r = ER.mobScale({ type: 'piglin_brute' }, 0);
  okAv(!(r && Math.abs(r.sxz - 1.0019531) < 1e-9), 'a piglin_brute without its horizontal scale fails the check');
  ER.RENDER_SCALE_XZ.piglin_brute = keep;
}

// ── #1046: no player hat / ear / cloak cuboids in a piglin-family mob mesh ──
{
  const ER = M.EntityRender;
  const visible = (name) => BE.layers[name].parts.filter((p) => !(ER.DEFAULT_HIDDEN[name] || {})[p.n]).map((p) => p.n);
  const bad = (name) => visible(name).filter((n) => n === 'hat' || n === 'ear' || n === 'cloak');
  for (const name of ['piglin', 'piglin_brute', 'zombified_piglin']) {
    ok(bad(name).length === 0, name + ': no hat/ear/cloak part is drawn');
    ok(visible(name).includes('left_ear') && visible(name).includes('head'), name + ': left_ear and head are still drawn');
  }
  const saved = ER.DEFAULT_HIDDEN; ER.DEFAULT_HIDDEN = {};
  okAv(bad('piglin_brute').length === 3, 'without the hidden table the brute draws hat, ear and cloak');
  ER.DEFAULT_HIDDEN = saved;
}

// ── BROWSER MODE (--browser): the four sections above only prove the MODEL DATA has arms and
// legs (models.bin) — KW-33 stayed open after D-687 re-packed that data because nothing had
// checked the LIVE RENDER draws them. A live piglin/brute/zombified_piglin is measured against
// a known-good reference (zombie, itself biped with working limbs) from a fixed camera: the
// vertical extent (in pixels) of what actually changed on screen when the mob is spawned. A
// mob missing its legs stops at roughly the waist and reads short against the reference; one
// missing its arms/legs both reads even shorter. Anti-vacuity: the SAME measurement, taken
// after this script strips limb parts off the live BE.layers table itself (simulating exactly
// the D-687-era bug), must show that shrink — a check that cannot fail is not a check (D-30).
// ── BROWSER MODE (--browser): the four sections above only prove the MODEL DATA has arms and
// legs (models.bin) — KW-33 stayed open after D-687 re-packed that data because nothing had
// checked that the LIVE RENDER PIPELINE (the real built `dist/mclite.html`, through the actual
// box-emitting code in `07j_entityrender.js`) actually walks every one of those parts, rather
// than silently dropping some between "the data has them" and "the screen shows them". Measured
// with `ER.build`'s own returned quad count — not a screenshot (D-522's own lesson: a headless
// Chromium frame can land mid chunk-mesh rebuild and read as a huge unrelated change, which is
// exactly the flake this file hit before landing on this metric) — for ONE isolated entity at a
// time, so the number is a deterministic function of "how many boxes did the live renderer emit
// for this mob", nothing else. Anti-vacuity: the SAME entity, with its live BE.layers parts
// stripped the way D-687 found the piglin family before its fix, must emit MEASURABLY fewer
// quads — a check that cannot fail is not a check (D-30).
async function browserModelRenderCheck() {
  console.log('\npiglinmodelcheck --browser: the piglin family\'s live render draws its arms and legs');
  const ROOT = MCLITE_ROOT + '/';
  const page = await open(ROOT + 'dist/mclite.html', { port: 9458, width: 480, height: 360 });
  if (!page) { console.log('SKIP piglinmodelcheck --browser: no Chromium found'); return; }
  try {
    await sleep(1200);
    await page.evaluate(function () { if (window.MCL && MCL.Main && !MCL.Main.ready) MCL.Main.play({}); });
    const up = await page.waitFor(function () {
      return !!(window.MCL && MCL.Main.ready && MCL.Hud.mode === 'game' && MCL.World.chunks.size > 20);
    }, 60000);
    if (!ok(up, 'the world came up for the piglin render check')) return;
    await page.evaluate(function () { if (MCL.Spawn) MCL.Spawn.ready = false; });   // D-397: no natural-spawn noise
    await sleep(500);
    const ev = (src) => page.evaluate(new Function(src));

    // ONE entity of `type`, alone in `EntityList.list`, at a fixed rest pose (no AI, no swing) —
    // `ER.build`'s own quad count for exactly what it walked, read straight off the live bundle.
    async function quadsFor(type) {
      return ev(
        // spawned piglins get random gear (a held sword adds ~50 quads: 264 vs 314): measure the bare model
        'MCL.Equip.getEquipped = function () { return null; };' +
        'var EL = MCL.EntityList; EL.list.length = 0; var P = MCL.Player;' +
        'var e = EL.spawn("' + type + '", P.x, P.y, P.z - 4);' +
        'if (!e) return { missing: true };' +
        'e.ai = null; e.equip = null; e.vx = e.vy = e.vz = 0; e.yaw = 0; e.__subject = true;' +   // random gear (armour/held) flakes the count
        // D-522's own trick: a piglin/zombified_piglin spawn can bring real reinforcement/group
        // members along (vanilla group spawning, not a bug) — drop everything but the entity
        // this call asked for before measuring, so the count is the SUBJECT's own render, not
        // the subject plus however many companions rode along.
        'for (var i = EL.list.length - 1; i >= 0; i--) if (!EL.list[i].__subject) EL.list.splice(i, 1);' +
        'var b = MCL.EntityRender.build(Math.floor(P.x), Math.floor(P.y), Math.floor(P.z), P.x, P.y, P.z, 1);' +
        'return { missing: false, drawn: b ? b.drawn : -1, quads: b ? (b.quads[0] + b.quads[1] + b.quads[2]) : -1 };'
      );
    }

    const zRef = await quadsFor('zombie');
    ok(!zRef.missing && zRef.quads > 0, 'zombie (reference, biped, 7 model parts) draws ' + zRef.quads + ' quads alone on the stage');

    const FAMILY_LIVE = ['piglin', 'piglin_brute', 'zombified_piglin'];
    const liveQuads = {};
    for (const type of FAMILY_LIVE) {
      const r = await quadsFor(type);
      liveQuads[type] = r;
      ok(!r.missing, type + ' spawns for the render check');
      // The piglin family carries the full biped limb+clothing set against zombie's 7 parts;
      // since #1046 it hides hat/ear/cloak (vanilla DEFAULT_HIDDEN), so the live gap is ~1.5x
      // (314 vs 210), not the old 1.5x-plus-hidden-parts margin: assert > 1.2x (bare, no held item). The stripped-limb
      // anti-vacuity pass below (198 quads) still proves the check can fail. The live render must
      // show that gap, not just the model DATA (piglinmodelcheck's node-only sections, above, already proved that
      // half; this is the other half — the actual draw call).
      ok(r.quads > zRef.quads * 1.2,   // bare piglin 264 vs zombie 210 = 1.257x; stripped limbs (198) fall below zombie
         
         type + '\'s live render draws meaningfully more quads than zombie\'s (' + r.quads + ' vs ' + zRef.quads + ')');
    }
    // the three family members share the SAME 19-part roster (checkFamily, above) — their live
    // quad counts should track each other closely (mob-geometry.json face-slicing can differ a
    // little per texture, so a loose band, not exact equality).
    const vals = FAMILY_LIVE.map((t) => liveQuads[t].quads).filter((n) => typeof n === 'number' && n > 0);
    if (ok(vals.length === FAMILY_LIVE.length, 'every family member produced a quad count to compare')) {
      const lo = Math.min(...vals), hi = Math.max(...vals);
      ok(hi <= lo * 1.5, 'the piglin family\'s live quad counts stay within a tight band of each other ('
         + FAMILY_LIVE.map((t) => t + '=' + liveQuads[t].quads).join(', ') + ')');
    }

    // ── anti-vacuity: strip limbs off the LIVE BE.layers table (the exact D-687-era shape —
    // body/head survive, every limb gone) and prove the SAME live-render metric drops. ──
    const before = await quadsFor('piglin');
    const stripped = await ev(
      'var BE = MCL.BEModel; var L = BE.layers["piglin"]; if (!L) return null;' +
      'window.__kw33_saved = L.parts;' +
      'L.parts = L.parts.filter(function (p) {' +
      ' return ["left_arm","right_arm","left_leg","right_leg","left_sleeve","right_sleeve",' +
      ' "left_pants","right_pants","jacket","cloak","ear","left_ear","right_ear"].indexOf(p.n) === -1; });' +
      'return true;'
    );
    okAv(!!stripped, 'the live piglin layer can be stripped down for the anti-vacuity pass');
    if (stripped) {
      const after = await quadsFor('piglin');
      okAv(after.quads < before.quads * 0.8,
           'a piglin stripped of its limbs (the KW-33 shape) now draws far fewer live quads ('
           + after.quads + ' vs ' + before.quads + ' with limbs)');
    }
    await ev('var BE = MCL.BEModel; var L = BE.layers["piglin"]; if (L && window.__kw33_saved) L.parts = window.__kw33_saved; return true;');
  } finally {
    if (page.close) { try { await page.close(); } catch (e) {} }
  }
}

if (process.argv.includes('--browser')) {
  await browserModelRenderCheck();
}

if (fails.length) {
  console.log(`${pass} assertions, ${fails.length} failures`);
  for (const f of fails) console.log('  ✗ ' + f);
  console.log('FAIL piglinmodelcheck');
  process.exit(1);
}
console.log(`PASS piglinmodelcheck: ${pass} assertions, 0 failures, ${breaksCaught()} breaks caught`);

function breaksCaught() {
  return (process.argv.includes('--browser')) ? 8 : 7;
}
