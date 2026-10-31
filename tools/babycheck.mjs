#!/usr/bin/env node
// babycheck.mjs — PLAN G18e unit 2: A BABY IS NOT THE ADULT DRAWN SMALLER.
//
//   node tools/babycheck.mjs [--verbose]
//
// ⚠ WHAT THIS PROVES. `AgeableListModel` gives a young mob's HEAD parts and BODY parts two
// different transforms, and for four of the ten models this engine could read, the head is not
// scaled at all — a baby cow is a full-sized head on a halved body. So the assertions below are
// about the DIFFERENCE between the two groups, not about the mob being smaller: a uniform
// shrink would pass "the baby is smaller" and be wrong in the one way that is visible.
//
// It also holds the BOX to `LivingEntity.getScale()`, which is every living entity's rule
// rather than an animal's, and asserts the crossing — an animal that grows up gets its adult
// box back on the tick its age reaches nought, not at some later refresh.

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEngine, initRegistry, MCLITE_ROOT } from './loadsrc.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ASSETS = join(ROOT, 'assets');
const VERBOSE = process.argv.includes('--verbose');

let pass = 0, breaks = 0;
const fails = [];
const ok = (c, m) => { if (c) pass++; else if (fails.length < 40) fails.push(m); return c; };
const okAv = (c, m) => { breaks++; if (c) { pass++; if (VERBOSE) console.log('   ✓ ' + m); } else fails.push('anti-vacuity: ' + m); };
const say = (...a) => { if (VERBOSE) console.log(...a); };

console.log('babycheck — PLAN G18e unit 2, the baby\'s box and the baby\'s model');

const M = loadEngine({
  extra: ['02g_items.js', '07h_entities.js', '14b_physics.js', '07i_entitylist.js',
          '07j_entityrender.js', '07m_breed.js', '10_gfx.js', '15h_bemodel.js'],
  dom: false
});
initRegistry(M);
{
  const mm = JSON.parse(readFileSync(MCLITE_ROOT + 'assets/models.meta.json', 'utf8'));
  M.BEModel.init({ models: readFileSync(MCLITE_ROOT + 'assets/models.bin').toString('base64'),
                   modelsBytes: mm.rawBytes });
}
M.DATA = Object.assign({}, M.DATA, {
  entities: JSON.parse(readFileSync(join(ASSETS, 'entities.json'), 'utf8'))
});
M.Entities.init();
M.EntityList.init();
M.EntityRender.init();
M.Breed.init();

const ER = M.EntityRender, BE = M.BEModel, Ent = M.Entities, Br = M.Breed, EL = M.EntityList;
ok(ER.ready, 'the entity renderer is up');
ok(Br.ready, 'Breed is up');
if (!ER.ready || !Br.ready) { console.log('\nFAIL  fixture did not initialise'); process.exit(1); }

// ═══════════════════════════ 1. the table ═══════════════════════════════════════════════════
{
  say('\n§1 the table');
  const cow = Ent.babyModel('cow');
  ok(!!cow, 'cow has a baby-model row');
  ok(cow && cow.sh === 0, 'a baby COW\'s head is NOT scaled — scaleHead is false in the jar');
  ok(cow && cow.hy === 10 && cow.hz === 4, `its head offsets are (10, 4) model units (got ${cow && cow.hy}, ${cow && cow.hz})`);
  ok(cow && cow.bs === 2 && cow.by === 24, `its body is halved and shifted 24 (got ${cow && cow.bs}, ${cow && cow.by})`);
  ok(cow && cow.head.join(',') === 'head', 'and `head` is its only head part');
  const all = Object.keys(Ent.babyModels || {});
  ok(all.length >= 22, `${all.length} models travelled into the runtime (QUEUE 0.2: expected the original 10 plus the 12 the Tame/Breed remainder pass closed)`);
  const scaled = all.filter((n) => Ent.babyModel(n).sh), plain = all.filter((n) => !Ent.babyModel(n).sh);
  // BOTH KINDS MUST BE PRESENT: if the packer ever dropped the flag this is where it shows
  ok(scaled.length > 0 && plain.length > 0,
    `both kinds survive the pack step — ${scaled.length} scale the head, ${plain.length} do not`);
  ok(Ent.babyModel('enderman') === null,
    'a model this engine RULED not-babyable returns null rather than a plausible default — enderman never actually goes through the child branch in vanilla (see ER.BABY_RULED)');

  // QUEUE 0.2 (Tame/Breed remainder) — `ER.BABY_OWED` is now the CLOSED and EMPTY half of this
  // table, and `ER.BABY_RULED` is the "named, and never will be drawn" half (`ER.OWED`'s own
  // three-way rule, one file over, 07j_entityrender.js): every one of the 25 vanilla
  // AgeableListModel species is either in `Ent.babyModels` (drawn), on `ER.BABY_OWED` (named,
  // still unread) or on `ER.BABY_RULED` (named, the ENTITY never takes the child branch) —
  // never two of the three, and never none of them.
  ok(ER.BABY_OWED.length === 0, `ER.BABY_OWED has ${ER.BABY_OWED.length} entries, expected 0 — the QUEUE 0.2 pass closed all 15`);
  ok(ER.BABY_RULED.length === 3 && ER.BABY_RULED.slice().sort().join(',') === 'enderman,giant,vex',
    `ER.BABY_RULED is ${JSON.stringify(ER.BABY_RULED)}, expected exactly [enderman, giant, vex]`);
  ok(all.length + ER.BABY_OWED.length + ER.BABY_RULED.length === 29,
    `drawn (${all.length}) + OWED (${ER.BABY_OWED.length}) + RULED (${ER.BABY_RULED.length}) = ${all.length + ER.BABY_OWED.length + ER.BABY_RULED.length}, not the 29 total AgeableListModel species (25 + donkey, mule, zombie_horse, skeleton_horse, #4697)`);
  for (const nm of ER.BABY_RULED) {
    ok(Ent.babyModel(nm) === null, `${nm} is on ER.BABY_RULED but Ent.babyModel('${nm}') is not null — the ruling is stale`);
    ok(all.indexOf(nm) < 0, `${nm} is BOTH drawn and on ER.BABY_RULED — the two disagree`);
  }
  // ⚠ anti-vacuity, both directions: a species genuinely missing from the table must show up
  // as null (proven above by 'enderman'), and a species genuinely IN it must not.
  okAv(Ent.babyModel('cow') !== null && ER.BABY_RULED.indexOf('cow') < 0,
    'anti-vacuity: cow is drawn and correctly absent from ER.BABY_RULED — the list is not vacuously "everything"');
  okAv(Ent.babyModel('enderman') === null && ER.BABY_RULED.indexOf('enderman') >= 0,
    'anti-vacuity: enderman is undrawn and correctly present on ER.BABY_RULED — the list is not vacuously empty');

  // ═══════ QUEUE 0.2's own dozen — one spot check per resolution SHAPE, cited to the tsv row ═══
  say('\n§1b the QUEUE 0.2 remainder, one check per shape');
  const axolotl = Ent.babyModel('axolotl');
  ok(!!axolotl, 'axolotl has a baby-model row (AnimalModel(Z,F,F) short-ctor default, then hand-verified against .decomp)');
  ok(axolotl && axolotl.sh === 1 && axolotl.hy === 8 && axolotl.hz === 3.35 && axolotl.bs === 2 && axolotl.by === 24,
    `axolotl is ${JSON.stringify(axolotl)} — expected (true, 8, 3.35, bs 2, by 24)`);
  ok(axolotl && axolotl.head.length === 0,
    'axolotl has NO head parts — AxolotlEntityModel.getHeadParts() returns ImmutableList.of(), the whole model is one body group');
  const chicken = Ent.babyModel('chicken');
  ok(chicken && chicken.sh === 0 && chicken.head.join(',') === 'head,beak,red_thing',
    `chicken is ${JSON.stringify(chicken)} — expected scaleHead false and three head parts (the wattle's OWN field literal is "red_thing", not "wattle")`);
  const horse = Ent.babyModel('horse');
  ok(horse && horse.hs === 2.7272 && horse.by === 20 && horse.head.join(',') === 'head_parts',
    `horse is ${JSON.stringify(horse)} — expected its own (2.7272, by 20) and the head_parts literal, not "head"`);
  for (const n of ['donkey', 'mule', 'zombie_horse', 'skeleton_horse']) {
    const m = Ent.babyModel(n);
    ok(m && m.hs === 2.7272 && m.hy === 16.2 && m.hz === 1.36 && m.by === 20 && m.head.join(',') === 'head_parts',
      `${n} is ${JSON.stringify(m)} — HorseEntityModel's ctor values are inherited (#4697)`);
  }
  const zombie = Ent.babyModel('zombie');
  ok(zombie && zombie.sh === 1 && zombie.hy === 16 && zombie.hz === 0 && zombie.hs === 2 && zombie.bs === 2 && zombie.by === 24,
    `zombie is ${JSON.stringify(zombie)} — expected BipedEntityModel's own (true, 16, 0, 2, 2, 24), reached via Zombie->AbstractZombieModel->BipedEntityModel(1)->BipedEntityModel(2)->AnimalModel`);
  ok(Ent.babyModel('drowned') && Ent.babyModel('drowned').hy === 16 && Ent.babyModel('zombie_villager') && Ent.babyModel('zombie_villager').hy === 16,
    'drowned and zombie_villager inherit the same BipedEntityModel six values as zombie (both extend it through the same chain)');
  const stand = Ent.babyModel('armor_stand');
  ok(stand && stand.hy === 16 && stand.hz === 0,
    `armor_stand is ${JSON.stringify(stand)} — a "small" stand takes the SAME BipedEntityModel child branch a baby zombie does (ArmorStandEntity.isBaby() == isSmall())`);
}

// ═══════════════════════════ 2. the box ═════════════════════════════════════════════════════
{
  say('\n§2 the box');
  const adult = Ent.dimensions('cow');
  EL.init();
  const e = EL.spawn('cow', 0.5, 8, 0.5);
  ok(e.width === adult.width && e.height === adult.height, 'a spawned cow starts at the adult box');
  Br.setBaby(e, true);
  ok(Math.abs(e.width - adult.width * Ent.BREED.babyScale) < 1e-9
     && Math.abs(e.height - adult.height * Ent.BREED.babyScale) < 1e-9,
    `a baby cow's box is the jar's ${Ent.BREED.babyScale} of the adult's (got ${e.width} x ${e.height})`);
  // the CROSSING is the event, not the tick
  Br.setAge(e, -1);
  ok(e.height < adult.height, 'still a baby at age -1');
  Br.setAge(e, 0);
  ok(e.width === adult.width && e.height === adult.height, 'and the adult box is back the moment the age reaches nought');
  // growing up through the real tick, not by hand
  Br.setAge(e, -1);
  EL.tickAge ? EL.tickAge(e) : Br.tickAge(e);
  ok(Br.getAge(e) === 0 && e.height === adult.height, 'a baby that grows up through Breed.tickAge gets the adult box with it');

  // ANTI-VACUITY: a babyScale of 1 and the halving assertions stop meaning anything
  const saved = Br.C.babyScale;
  Br.C = Object.assign({}, Br.C, { babyScale: 1 });
  const f = EL.spawn('cow', 2.5, 8, 0.5);
  Br.setBaby(f, true);
  okAv(f.height === adult.height, 'with babyScale broken to 1 a baby is adult-sized — the halving assertions can actually fail');
  Br.C = Object.assign({}, Br.C, { babyScale: saved });
}

// ═══════════════════════════ 3. the transform ═══════════════════════════════════════════════
{
  say('\n§3 the transform');
  const head = ER.babyTransform('cow', 'head');
  const body = ER.babyTransform('cow', 'body');
  const leg = ER.babyTransform('cow', 'left_front_leg');
  ok(head && head.s === 1, 'a baby cow\'s HEAD is drawn at full scale (scaleHead false)');
  ok(head && head.oy === 10 && head.oz === 4, 'and shifted by its own two offsets');
  ok(body && body.s === 0.5 && body.oy === 24 && body.oz === 0, 'its BODY is halved and shifted 24 in Y only');
  ok(leg && leg.s === body.s && leg.oy === body.oy, 'a leg is a BODY part — every part that is not named a head part is');
  ok(ER.babyTransform('enderman', 'head') === null, 'a RULED layer has no transform at all (ER.BABY_RULED, not drawn)');

  // QUEUE 0.2 — zombie's HEAD SCALES (unlike cow's): 1.5 / 2 = 0.75, the vanilla "big head" baby
  // zombie look, reached through BipedEntityModel's own values rather than a species-specific ctor.
  const zHead = ER.babyTransform('zombie', 'head');
  const zBody = ER.babyTransform('zombie', 'body');
  ok(zHead && Math.abs(zHead.s - 0.75) < 1e-9 && zHead.oy === 16 && zHead.oz === 0,
    `zombie's head scale is ${zHead && zHead.s} — expected 1.5/2 = 0.75 with offsets (16, 0)`);
  ok(zBody && zBody.s === 0.5 && zBody.oy === 24,
    `zombie's body scale is ${zBody && zBody.s} — expected 1/2 = 0.5`);
  ok(zHead.s > zBody.s, 'and the head is proportionally BIGGER than the body — the "baby zombie has a big head" trait, not a uniform shrink');

  // QUEUE 0.2 — axolotl has NO head parts, so EVERY part (including one actually named "head")
  // takes the body branch: nothing in Ent.babyModel('axolotl').head ever matches.
  const axHead = ER.babyTransform('axolotl', 'head');
  const axBody = ER.babyTransform('axolotl', 'body');
  ok(axHead && axBody && axHead.s === axBody.s && axHead.oy === axBody.oy,
    'axolotl\'s "head" part is not in its (empty) head-part list, so it gets the BODY transform same as "body" does');
  // the 1.5 numerator only applies where the jar says to scale the head
  const panda = ER.babyTransform('panda', 'head');
  const pm = Ent.babyModel('panda');
  ok(panda && Math.abs(panda.s - (ER.BABY_HEAD_NUMERATOR / pm.hs)) < 1e-9,
    `a panda DOES scale its head: 1.5 / ${pm.hs} = ${(ER.BABY_HEAD_NUMERATOR / pm.hs).toFixed(4)}`);
  ok(panda && panda.s !== head.s, 'and the two species genuinely differ — the head rule is per model, not global');
}

// ═══════════════════════════ 4. the geometry it actually emits ══════════════════════════════
// ⚠ THE PICTURE, NOT THE TABLE. Sections 1-3 could all pass with the transform wired to
// nothing; this drives the real `ER.emitMobLayer` twice and compares what came out.
{
  say('\n§4 the emitted geometry');
  const L = BE.layer('cow');
  const n = ER.mobQuadCount('cow');
  const anim = (baby) => ({ limbSwing: 0, limbSwingAmount: 0, netHeadYaw: 0, headPitch: 0, riding: false, baby: baby });
  function emit(baby) {
    const out = new Uint32Array(n * 16);
    ER.emitMobLayer(out, 0, 'cow', 0, 0, 0, 1, 0, 15, 0, 3, anim(baby));
    const per = L.parts.map(() => ({ sx: 0, sy: 0, sz: 0, c: 0, minY: Infinity, maxY: -Infinity, minX: Infinity, maxX: -Infinity }));
    for (let q = 0; q < n; q++) {
      const pi = Math.floor(q / 6), o = q * 16;
      for (let c = 0; c < 4; c++) {
        const vt = M.Mesher.unpackModelVertex(out[o + c * 4], out[o + c * 4 + 1], out[o + c * 4 + 2], out[o + c * 4 + 3]);
        const p = per[pi];
        p.sx += vt.px; p.sy += vt.py; p.sz += vt.pz; p.c++;
        if (vt.py < p.minY) p.minY = vt.py;
        if (vt.py > p.maxY) p.maxY = vt.py;
        if (vt.px < p.minX) p.minX = vt.px;
        if (vt.px > p.maxX) p.maxX = vt.px;
      }
    }
    return per;
  }
  const idxOf = (name) => L.parts.findIndex((p) => p.n === name);
  const A = emit(false), B = emit(true);
  const iHead = idxOf('head'), iBody = idxOf('body'), iLeg = idxOf('left_front_leg');
  ok(iHead >= 0 && iBody >= 0 && iLeg >= 0, 'the cow layer has head, body and leg parts');

  const spanA = (p) => A[p].maxX - A[p].minX, spanB = (p) => B[p].maxX - B[p].minX;
  say(`   head span adult ${spanA(iHead)} baby ${spanB(iHead)}`);
  say(`   body span adult ${spanA(iBody)} baby ${spanB(iBody)}`);
  // THE WHOLE POINT: the head keeps its size and the body does not
  ok(Math.abs(spanB(iHead) - spanA(iHead)) <= 1,
    `the baby's HEAD is the same width as the adult's (${spanA(iHead)} -> ${spanB(iHead)})`);
  ok(spanB(iBody) < spanA(iBody) * 0.75,
    `the baby's BODY is visibly narrower (${spanA(iBody)} -> ${spanB(iBody)})`);
  ok(spanB(iLeg) < spanA(iLeg) * 0.75, `and so are its legs (${spanA(iLeg)} -> ${spanB(iLeg)})`);
  // the head is where a calf's head is: moved, not just left alone
  const cA = [A[iHead].sx / A[iHead].c, A[iHead].sy / A[iHead].c, A[iHead].sz / A[iHead].c];
  const cB = [B[iHead].sx / B[iHead].c, B[iHead].sy / B[iHead].c, B[iHead].sz / B[iHead].c];
  ok(Math.hypot(cB[0] - cA[0], cB[1] - cA[1], cB[2] - cA[2]) > 1,
    'the baby\'s head has MOVED — the two offsets are applied, not dropped');
  // ⚠ AND IT STANDS ON THE FLOOR. The body transform is a scale FOLLOWED BY a translate, so the
  // offset is scaled too (`s * (p + t)`); get that the other way round and the calf sinks into
  // the ground by most of a block. The cheapest proof is the one the eye would use: the lowest
  // emitted vertex is at the same height for both.
  const lowest = (P) => P.reduce((m, p) => Math.min(m, p.minY), Infinity);
  const highest = (P) => P.reduce((m, p) => Math.max(m, p.maxY), -Infinity);
  say(`   adult ${lowest(A)}..${highest(A)}  baby ${lowest(B)}..${highest(B)}`);
  ok(lowest(B) === lowest(A), `a calf's feet are on the same floor as its mother's (${lowest(A)} vs ${lowest(B)})`);
  ok(highest(B) < highest(A), `and it is shorter (${highest(A)} -> ${highest(B)})`);

  // ANTI-VACUITY: with the flag off, the two emissions are identical, so §4 can fail
  const C = emit(false);
  let same = true;
  for (let i = 0; i < A.length; i++) if (A[i].sx !== C[i].sx || A[i].sy !== C[i].sy) same = false;
  okAv(same, 'emitting twice with baby=false gives identical geometry — the difference above is the flag and nothing else');
  let anyDiff = false;
  for (let i = 0; i < A.length; i++) if (A[i].sy !== B[i].sy || A[i].sx !== B[i].sx) anyDiff = true;
  okAv(anyDiff, 'and emitting with baby=true genuinely changes it');
}

console.log('');
console.log('================ babycheck ==================');
console.log(` assertions passed .. ${pass}`);
console.log(` failures ........... ${fails.length}`);
console.log(` breaks caught ...... ${breaks}`);
console.log('==============================================');
for (const f of fails) console.log('FAIL  ' + f);
process.exit(fails.length ? 1 : 0);
