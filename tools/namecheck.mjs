#!/usr/bin/env node
// namecheck.mjs — loop/nameplate: mob name rendering off e.customName.
//
//   node tools/namecheck.mjs [--verbose]
//
// Sections:
//   1. ER.hasLabel -- the GATE (EntityRenderer.hasLabel / LivingEntityRenderer.method_4055 /
//      MobEntityRenderer.hasLabel, .decomp, read in full): named, distance (sneak-halved),
//      not ridden, not invisible, not hud-hidden, crosshair-targeted.
//   2. ER.shouldFlipUpsideDown -- exact-name Dinnerbone/Grumm gate, living-only.
//   3. ER.dinnerbonePoseFor + ER.emitMobLayer -- the RENDER wiring: a from-scratch matrix
//      derivation (this file's own, cross-checked against the code's own header comment)
//      proving the flipped draw's Y is a fixed mirror of the plain draw's Y, and X negates
//      while Z does not, vertex-for-vertex.
//   4. Passive.jebColorAt / Passive.fleeceTintFor -- the jeb_ rainbow cycle, transcribed
//      arithmetic-for-arithmetic from SheepWoolFeatureRenderer.method_4198 lines 44-55.
//   5. anti-vacuity -- break each of the above and watch this file's own assertions catch it.

import { readFileSync } from 'node:fs';
import { deflateRawSync } from 'node:zlib';
import { loadEngine, initRegistry, MCLITE_ROOT, ASSETS } from './loadsrc.mjs';
import { join } from 'node:path';

const VERBOSE = process.argv.includes('--verbose');
let pass = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); return c; };
let breaks = 0;
const okAv = (c, m) => { breaks++; ok(c, 'anti-vacuity: ' + m); if (c && VERBOSE) console.log('   ✓ ' + m); };
const say = (s) => { if (VERBOSE) console.log(s); };

console.log('namecheck -- loop/nameplate: mob name rendering off e.customName');

const M = loadEngine({
  extra: ['02g_items.js', '07h_entities.js', '14b_physics.js', '07i_entitylist.js',
          '07q_effects.js', '07r_mount.js', '07j_entityrender.js', '10_gfx.js',
          '15h_bemodel.js', '07w_passive.js'],
  dom: false
});
initRegistry(M);
{
  const mm = JSON.parse(readFileSync(join(MCLITE_ROOT, 'assets', 'models.meta.json'), 'utf8'));
  M.BEModel.init({ models: readFileSync(join(MCLITE_ROOT, 'assets', 'models.bin')).toString('base64'),
                    modelsBytes: mm.rawBytes });
}
const mobGeomRaw = readFileSync(join(MCLITE_ROOT, 'assets', 'mob-geometry.json'));
M.DATA = Object.assign({}, M.DATA, {
  mobGeometry: deflateRawSync(mobGeomRaw, { level: 9 }).toString('base64'),
  mobGeometryBytes: mobGeomRaw.length,
  entities: JSON.parse(readFileSync(join(ASSETS, 'entities.json'), 'utf8'))
});
M.Entities.init();
M.EntityRender.init();
M.Passive.init();
const ER = M.EntityRender, Ps = M.Passive, Ent = M.Entities, Mnt = M.Mount, ES = M.Effects;
ok(ER.ready, 'the entity renderer is up');
ok(typeof ER.hasLabel === 'function', 'ER.hasLabel exists');
ok(typeof ER.shouldFlipUpsideDown === 'function', 'ER.shouldFlipUpsideDown exists');
ok(typeof ER.dinnerbonePoseFor === 'function', 'ER.dinnerbonePoseFor exists');
ok(typeof Ps.jebColorAt === 'function', 'Passive.jebColorAt exists');
ok(Ent.isLiving('cow'), 'sanity: entities.json loaded -- "cow" is living');

// ═════════════════════ 1. ER.hasLabel -- the GATE ═════════════════════════════════════════
{
  say('\n§1 ER.hasLabel');
  function mkMob(over) {
    return Object.assign({ type: 'cow', x: 0, y: 0, z: 0, customName: 'Bob' }, over || {});
  }

  // named, close, targeted -> true
  const e1 = mkMob();
  ok(ER.hasLabel(e1, 0, 0, 10, e1, false) === true,
    'a named mob 10 blocks out, targeted by the crosshair, gets a label');

  // named, close, NOT targeted -> false (isCustomNameVisible is unreachably false, per header)
  ok(ER.hasLabel(e1, 0, 0, 10, null, false) === false,
    'the SAME mob with nothing targeting it gets no label (CustomNameVisible NBT is unreachable here)');
  ok(ER.hasLabel(e1, 0, 0, 10, mkMob({ x: 5 }), false) === false,
    'targeted-by-someone-ELSE (a different entity object) still gets no label');

  // distance gate, non-sneaking: 64 blocks is the edge
  ok(ER.hasLabel(e1, 0, 0, 63.9, e1, false) === true, 'just inside 64 blocks (non-sneaking): labelled');
  ok(ER.hasLabel(e1, 0, 0, 64.1, e1, false) === false, 'just outside 64 blocks (non-sneaking): not labelled');

  // distance gate, sneaking: 32 blocks is the edge -- the SAME mob, only e.sneaking differs
  const e2 = mkMob({ sneaking: true });
  ok(ER.hasLabel(e2, 0, 0, 31.9, e2, false) === true, 'just inside 32 blocks (sneaking): labelled');
  ok(ER.hasLabel(e2, 0, 0, 40, e2, false) === false,
    'inside the 64-block non-sneaking range but OUTSIDE 32 -- sneaking halves the range, not labelled');

  // no custom name at all
  const e3 = mkMob({ customName: null });
  ok(ER.hasLabel(e3, 0, 0, 1, e3, false) === false, 'no customName at all: never labelled, even targeted point-blank');

  // dead / removed
  ok(ER.hasLabel(mkMob({ dead: true }), 0, 0, 1, e1, false) === false, 'a dead mob draws no label');
  const eRemoved = mkMob({ removed: true });
  ok(ER.hasLabel(eRemoved, 0, 0, 1, eRemoved, false) === false, 'a removed mob draws no label');

  // ridden -- Mnt.isRidden(e), a REAL call through 07r_mount.js, not a stand-in
  const eRidden = mkMob({ rider: 'player' });
  ok(Mnt.isRidden(eRidden) === true, 'sanity: Mnt.isRidden reads e.rider for real');
  ok(ER.hasLabel(eRidden, 0, 0, 1, eRidden, false) === false, 'a RIDDEN mob (hasPassengers) draws no label, even targeted');

  // invisible -- through the real 07q_effects.js store, not a hand-rolled flag
  const eInvis = mkMob();
  ES.addStatusEffect(eInvis, 'invisibility', 200, 0, false, true);
  ok(ES.hasStatusEffect(eInvis, 'invisibility') === true, 'sanity: the real effect store now carries invisibility');
  ok(ER.hasLabel(eInvis, 0, 0, 1, eInvis, false) === false, 'an INVISIBLE targeted mob draws no label');

  // hud hidden (F1 / NS.Settings.hideGui) -- passed straight through as `hideGui`
  ok(ER.hasLabel(e1, 0, 0, 1, e1, true) === false, 'hideGui=true (F1) suppresses every label, even a targeted one up close');

  // BOTH directions of every gate checked above already exercise "opens" and "closes" the
  // rule; this closes the loop on the one compound case none of them cover alone -- a
  // sneaking, targeted, in-range mob that is ALSO ridden still gets nothing.
  const eBoth = mkMob({ sneaking: true, rider: 'player' });
  ok(ER.hasLabel(eBoth, 0, 0, 10, eBoth, false) === false,
    'sneaking-but-in-range-and-targeted is still refused once ridden -- the gates AND together');
}

// ═════════════════════ 2. ER.shouldFlipUpsideDown ══════════════════════════════════════════
{
  say('\n§2 ER.shouldFlipUpsideDown');
  ok(ER.shouldFlipUpsideDown({ type: 'cow', customName: 'Dinnerbone' }, 'cow') === true,
    '"Dinnerbone" on a living mob flips it');
  ok(ER.shouldFlipUpsideDown({ type: 'cow', customName: 'Grumm' }, 'cow') === true,
    '"Grumm" on a living mob flips it too');
  ok(ER.shouldFlipUpsideDown({ type: 'cow', customName: 'dinnerbone' }, 'cow') === false,
    'lower-case "dinnerbone" does NOT flip it -- exact-string, no case-fold (the jar\'s own .equals)');
  ok(ER.shouldFlipUpsideDown({ type: 'cow', customName: 'Dinnerbones' }, 'cow') === false,
    '"Dinnerbones" (a superstring) does NOT flip it -- .equals, not .contains');
  ok(ER.shouldFlipUpsideDown({ type: 'cow', customName: null }, 'cow') === false,
    'no custom name at all: never flips');
  ok(Ent.isLiving('item') === false, 'sanity: "item" carries no living attrs (entities.json)');
  ok(ER.shouldFlipUpsideDown({ type: 'item', customName: 'Dinnerbone' }, 'item') === false,
    '"Dinnerbone" on a NON-living layer never flips it -- LivingEntityRenderer-only, per the jar\'s own class hierarchy');

  // ER.dinnerbonePoseFor's own arithmetic, against a hand-computed value independent of the
  // function's own source (h + 0.1 - ER.LIVING_Y_OFFSET, ER.LIVING_Y_OFFSET === 1.501)
  const h = 1.4;   // cow's own bounding-box height, entities.json
  const bp = ER.dinnerbonePoseFor(h);
  ok(bp.flip === false, 'the Dinnerbone base pose is UNflipped (the two 180-Z rolls cancel -- see the function\'s own header)');
  const wantOffset = (h + 0.1 - 1.501) * M.CFG.MODEL_UNITS_PER_BLOCK;
  ok(Math.abs(bp.yOffsetFixed - wantOffset) < 1e-6,
    `yOffsetFixed is (height + 0.1 - 1.501) * MODEL_UNITS_PER_BLOCK (got ${bp.yOffsetFixed}, want ${wantOffset})`);
}

// ═════════════════════ 3. ER.emitMobLayer -- the Dinnerbone RENDER wiring ═════════════════
{
  say('\n§3 Dinnerbone render geometry (ER.emitMobLayer + ER.dinnerbonePoseFor)');
  const layer = 'cow';
  const n = ER.mobQuadCount(layer);
  ok(n > 0, 'cow has quads to draw');
  const h = Ent.height ? Ent.height(layer) : 1.4;

  function draw(base) {
    const out = new Uint32Array(n * 16);
    const o = ER.emitMobLayer(out, 0, layer, 0, 0, 0, 1, 0, 15, 0, 0, null,
      base, undefined, false, undefined, undefined);
    ok(o === n * 16, `emitMobLayer wrote exactly ${n} quads' worth of words (wrote ${o / 16})`);
    const verts = [];
    for (let i = 0; i < o; i += 4) verts.push(M.Mesher.unpackModelVertex(out[i], out[i + 1], out[i + 2], out[i + 3]));
    return verts;
  }

  const plain = draw(undefined);                        // ER.basePoseFor('cow') -> BASE_LIVING
  const flipped = draw(ER.dinnerbonePoseFor(h));

  ok(plain.length === flipped.length && plain.length === n * 4,
    'both draws produce the same vertex count (same layer, same pose data, only the base transform differs)');

  const U = M.CFG.MODEL_UNITS_PER_BLOCK;
  const wantSumFixed = Math.round((h + 0.1) * U);
  let maxYSumErr = 0, maxXMismatch = 0, maxZMismatch = 0;
  for (let i = 0; i < plain.length; i++) {
    const p = plain[i], f = flipped[i];
    // Y: this file's own header derives worldY_normal(v) + worldY_dinnerbone(v) == height+0.1
    // for EVERY vertex, independent of which one it is -- the two base-pose y-translates were
    // solved to make this hold exactly (up to i16 fixed-point rounding, +/-1 unit per term).
    maxYSumErr = Math.max(maxYSumErr, Math.abs((p.py + f.py) - wantSumFixed));
    // X: bs flips from -1 (plain) to +1 (dinnerbone) at yaw=0 -- f.px === -p.px.
    maxXMismatch = Math.max(maxXMismatch, Math.abs(f.px + p.px));
    // Z: `rz` never carries a `bs` factor in ER.emitMobLayer's own formula (07j_entityrender.js)
    // -- unaffected by the base-pose flip either way.
    maxZMismatch = Math.max(maxZMismatch, Math.abs(f.pz - p.pz));
  }
  ok(maxYSumErr <= 2, `every vertex's plain-Y + flipped-Y equals (height+0.1) in fixed point (max error ${maxYSumErr} of ${wantSumFixed}, tolerance 2)`);
  ok(maxXMismatch <= 2, `every vertex's flipped-X is the NEGATION of its plain-X (max mismatch ${maxXMismatch})`);
  ok(maxZMismatch <= 2, `every vertex's flipped-Z equals its plain-Z (max mismatch ${maxZMismatch})`);

  // and the identity pose (ER.dinnerbonePoseFor with height 0, i.e. flip:false, offset
  // 0.1-1.501) really does differ from plain -- the flip is not accidentally a no-op.
  const totalMove = plain.reduce((s, p, i) => s + Math.abs(p.py - flipped[i].py), 0);
  ok(totalMove > 0, 'the flipped draw is NOT pixel-identical to the plain one (the transform actually moved something)');
}

// ═════════════════════ 4. Passive.jebColorAt / fleeceTintFor -- the jeb_ cycle ════════════
{
  say('\n§4 jeb_ rainbow cycle (Passive.jebColorAt)');
  const ORDER = Ps.DYE_COLOR_ORDER;
  ok(Array.isArray(ORDER) && ORDER.length === 16, 'DYE_COLOR_ORDER has all 16 DyeColor members');
  ok(ORDER[0] === 'white' && ORDER[15] === 'black', 'DYE_COLOR_ORDER is DyeColor.byId\'s own 0..15 order');

  // an independent re-derivation of SheepWoolFeatureRenderer.method_4198 lines 44-55, off
  // Passive.fleeceColor (already real/tested, mobrendercheck.mjs) rather than jebColorAt's
  // own arithmetic, so this is not the function checking itself.
  function refJeb(age, id, partial) {
    const n = 16;
    const idx0 = (Math.floor(age / 25) + id) % n;
    const idx1 = (idx0 + 1) % n;
    const t = ((age % 25) + partial) / 25;
    const c0 = Ps.fleeceColor(ORDER[idx0]), c1 = Ps.fleeceColor(ORDER[idx1]);
    return [c0[0] * (1 - t) + c1[0] * t, c0[1] * (1 - t) + c1[1] * t, c0[2] * (1 - t) + c1[2] * t];
  }
  const cases = [[0, 0, 0], [0, 0, 0.5], [24, 3, 0.9], [25, 3, 0], [37, 7, 0.25], [1000, 200, 0.75]];
  for (const [age, id, partial] of cases) {
    const got = Ps.jebColorAt({ age, id }, partial);
    const want = refJeb(age, id, partial);
    ok(Math.abs(got[0] - want[0]) < 1e-9 && Math.abs(got[1] - want[1]) < 1e-9 && Math.abs(got[2] - want[2]) < 1e-9,
      `jebColorAt(age=${age}, id=${id}, partial=${partial}) matches the independent re-derivation (got ${got}, want ${want})`);
  }

  // the cycle actually MOVES over a tick (age advances by 1, same id/partial=0): a mid-cycle
  // tick changes the colour; only the exact 25-tick boundary can coincide (and this pair
  // (24 -> 25) deliberately straddles a DyeColor STEP, not just a t sweep within one).
  const at24 = Ps.jebColorAt({ age: 24, id: 5 }, 0);
  const at25 = Ps.jebColorAt({ age: 25, id: 5 }, 0);
  ok(Math.abs(at24[0] - at25[0]) > 1e-6 || Math.abs(at24[1] - at25[1]) > 1e-6 || Math.abs(at24[2] - at25[2]) > 1e-6,
    `the fleece colour actually changes from age 24 to 25 (a DyeColor step boundary) -- got ${at24} vs ${at25}`);

  // Passive.fleeceTintFor -- the WIRING: routes to jebColorAt only for the exact name "jeb_"
  const jebSheep = { type: 'sheep', sheared: false, woolColor: 'red', customName: 'jeb_', age: 10, id: 3 };
  const gotJeb = Ps.fleeceTintFor(jebSheep, 0.4);
  const wantJebTint = Ps.jebColorAt(jebSheep, 0.4);
  ok(gotJeb[0] === wantJebTint[0] && gotJeb[1] === wantJebTint[1] && gotJeb[2] === wantJebTint[2],
    'fleeceTintFor("jeb_") returns exactly jebColorAt\'s own value, not the plain per-colour lookup');
  ok(gotJeb[0] !== Ps.fleeceColor('red')[0],
    'and that value differs from the sheep\'s OWN plain wool colour (red) -- jeb_ really overrides it');

  const plainSheep = { type: 'sheep', sheared: false, woolColor: 'red', customName: 'Steve', age: 10, id: 3 };
  const gotPlain = Ps.fleeceTintFor(plainSheep, 0.4);
  const wantPlain = Ps.fleeceColor('red');
  ok(gotPlain[0] === wantPlain[0] && gotPlain[1] === wantPlain[1] && gotPlain[2] === wantPlain[2],
    'a DIFFERENTLY-named sheep ("Steve") still gets its own plain wool colour -- the exact-string gate holds both ways');

  const jebFoldCase = { type: 'sheep', sheared: false, woolColor: 'red', customName: 'JEB_', age: 10, id: 3 };
  const gotFold = Ps.fleeceTintFor(jebFoldCase, 0.4);
  ok(gotFold[0] === wantPlain[0], 'a case-different "JEB_" is NOT the jeb_ special case -- exact-string, no fold, matching the jar\'s .equals');
}

// ═════════════════════ 5. anti-vacuity ═════════════════════════════════════════════════════
{
  say('\n§5 anti-vacuity');

  // 5a. break the distance gate's own constants and prove a wrong range IS distinguishable.
  okAv(ER.LABEL_RANGE_SNEAK === 32 && ER.LABEL_RANGE_NORMAL === 64,
    'ER.LABEL_RANGE_SNEAK/NORMAL are exactly 32/64 (LivingEntityRenderer.java:223) -- a ' +
    'regression to, say, 30/60 would fail this line first');
  const eMid = { type: 'cow', x: 0, y: 0, z: 0, customName: 'Bob', sneaking: true };
  const stillLabelledAt33 = ER.hasLabel(eMid, 0, 0, 33, eMid, false);
  okAv(stillLabelledAt33 === false,
    'a sneaking mob at 33 blocks (inside the WRONG 64 range but outside the real 32 one) is ' +
    'refused -- proves the sneak-halving branch is load-bearing, not a dead `if`');

  // 5b. the Dinnerbone Y-sum invariant is not vacuously true for ANY pair of translates --
  // reproduce it with a deliberately WRONG offset (missing the -1.501 term) and show the sum
  // invariant breaks at a real vertex.
  {
    const layer = 'cow';
    const n = ER.mobQuadCount(layer);
    const h = Ent.height ? Ent.height(layer) : 1.4;
    const U = M.CFG.MODEL_UNITS_PER_BLOCK;
    const brokenBase = { flip: false, yOffsetFixed: (h + 0.1) * U };   // BROKEN: drops "- 1.501"
    const out = new Uint32Array(n * 16);
    ER.emitMobLayer(out, 0, layer, 0, 0, 0, 1, 0, 15, 0, 0, null, brokenBase, undefined, false, undefined, undefined);
    const vBroken = M.Mesher.unpackModelVertex(out[0], out[1], out[2], out[3]);
    const outPlain = new Uint32Array(n * 16);
    ER.emitMobLayer(outPlain, 0, layer, 0, 0, 0, 1, 0, 15, 0, 0, null, undefined, undefined, false, undefined, undefined);
    const vPlain = M.Mesher.unpackModelVertex(outPlain[0], outPlain[1], outPlain[2], outPlain[3]);
    const wantSumFixed = Math.round((h + 0.1) * U);
    const brokenSumErr = Math.abs((vPlain.py + vBroken.py) - wantSumFixed);
    okAv(brokenSumErr > 100,
      `dropping the "-1.501" term from the Dinnerbone offset breaks the Y-sum invariant by ` +
      `${brokenSumErr} fixed units at a real vertex -- §3's exact-sum assertion is not vacuously true for any offset`);
  }

  // 5c. the jeb_ cycle length is really 16, not some other DyeColor.values().length --
  // reproduce with a broken n=15 cycle and show it diverges from the real one at a chosen id.
  {
    function brokenJeb(age, id, partial) {
      const n = 15;   // BROKEN: DyeColor has 16 members, not 15
      const ORDER = Ps.DYE_COLOR_ORDER;
      const idx0 = (Math.floor(age / 25) + id) % n;
      const idx1 = (idx0 + 1) % n;
      const t = ((age % 25) + partial) / 25;
      const c0 = Ps.fleeceColor(ORDER[idx0]), c1 = Ps.fleeceColor(ORDER[idx1]);
      return [c0[0] * (1 - t) + c1[0] * t, c0[1] * (1 - t) + c1[1] * t, c0[2] * (1 - t) + c1[2] * t];
    }
    // id=15 lands exactly on the seam where a mod-15 cycle wraps early and a mod-16 one does not.
    const real = Ps.jebColorAt({ age: 0, id: 15 }, 0);
    const broken = brokenJeb(0, 15, 0);
    okAv(Math.abs(real[0] - broken[0]) > 1e-6 || Math.abs(real[1] - broken[1]) > 1e-6 || Math.abs(real[2] - broken[2]) > 1e-6,
      `a mod-15 stand-in cycle disagrees with the real mod-16 one at id=15 (real ${real}, broken ${broken}) -- §4's exact-match assertions are not vacuous for any cycle length`);
  }
}

console.log(`\n${pass} checks passed, ${breaks} anti-vacuity, ${fails.length} failed`);
if (fails.length) { fails.forEach((f) => console.log('  FAIL: ' + f)); process.exit(1); }
