#!/usr/bin/env node
// supportcheck.mjs — PLAN G15c (D-346). WHAT MAY STAND ON WHAT, GRADED AGAINST THE BYTECODE.
//
//   node tools/supportcheck.mjs
//
// ⚠⚠ **THE STANDING WARNING FOR THIS WHOLE AREA: a rule that refuses a LEGAL build is worse than
// one that allows an illegal one.** A player who cannot place a rail on a hopper will not file a
// bug, they will conclude the game is broken. So every rule here is asserted in BOTH directions —
// the things that must be allowed as well as the things that must be refused — and the
// anti-vacuity section breaks each rule to prove the assertion can fail.
//
// ⚠ AND THE NUMBERS COME FROM `tools/golden/cansurvive-1.18.2.tsv`, never from this file (D-305).
// `guicheck` pinned the hotbar selector at 24x24 and made the correct value fail for three
// sessions; the three support-type rectangles are exactly the same kind of number, so they are
// read from the table and compared against the engine's constants rather than typed here.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, initRegistry, MCLITE_ROOT } from './loadsrc.mjs';

let pass = 0, breaks = 0;
const fails = [];
const ok = (c, m) => { if (c) pass++; else if (fails.length < 60) fails.push(m); return c; };
const okAv = (c, m) => { breaks++; if (c) { pass++; console.log('   ✓ ' + m); } else fails.push('anti-vacuity: ' + m); };

console.log('supportcheck — what may stand on what (D-346)');

// ⚠ `02f_tags.js` IS NOT OPTIONAL HERE. Eight of D-349's rules ask a TAG question — #dirt,
// #nylium, #bamboo_plantable_on, #jungle_logs, #soul_fire_base_blocks, #big_dripleaf_placeable,
// #small_dripleaf_placeable, #fence_gates — and `W.tagBelow` answers 0 when the payload is
// absent. Without this line every one of them would be asserted against a tag registry that is
// not there, and "the rule refuses everything" reads exactly like "the rule works".
const M = loadEngine({ extra: ['02f_tags.js', '07_world.js'], dom: false });
initRegistry(M);
const SR = M.States, R = M.Reg, W = M.World;
ok(SR.ready, 'the state tables are up');

// ── the referee ─────────────────────────────────────────────────────────────────────────────
const TSV = join(MCLITE_ROOT, 'tools', 'golden', 'cansurvive-1.18.2.tsv');
const rows = readFileSync(TSV, 'utf8').split('\n').filter((l) => l && l[0] !== '#');
const types = new Map(), owners = new Map(), ownerOfBlock = new Map(), shapeOverride = new Set(), shapeClasses = new Set();
for (const line of rows) {
  const f = line.split('\t');
  if (f[0] === 'supporttype') types.set(f[1], { box: f[2] ? f[2].split(',').map(Number) : null, how: f[3] });
  if (f[0] === 'supportshape') { shapeOverride.add(f[1]); shapeClasses.add(f[2]); }
  if (f[0] === 'owner') {
    const ns = (f[3] || '').split(' ').filter(Boolean);
    owners.set(f[1], ns);
    for (const n of ns) ownerOfBlock.set(n, f[1]);
  }
}
ok(types.size === 3, `the table carries three support types (${types.size})`);
ok(owners.size >= 20, `and ${owners.size} rule owners`);

// ═══════════════ 1. the support-type rectangles are the JAR'S ═══════════════════════════════
console.log('\n 1. the three support types are the rectangles the bytecode names');
{
  const c = types.get('CENTER'), g = types.get('RIGID'), full = types.get('FULL');
  ok(!!c && !!g && !!full, 'FULL, CENTER and RIGID are all present');
  ok(full && !full.box, 'FULL tests the WHOLE face and carries no box');
  // the table is in sixteenths; the engine is in 1/1024 of a block
  if (c && c.box) {
    const want = [c.box[0] * 64, c.box[2] * 64, c.box[3] * 64, c.box[5] * 64];
    const got = SR.CENTER_RECT;
    ok(got[0] === want[0] && got[1] === want[1] && got[2] === want[2] && got[3] === want[3],
       `CENTER is x,z ${c.box[0]}..${c.box[3]} of 16 (engine ${got.join(',')}, jar ${want.join(',')})`);
  }
  if (g && g.box) {
    const want = [g.box[0] * 64, g.box[2] * 64, g.box[3] * 64, g.box[5] * 64];
    const got = SR.RIGID_INNER;
    ok(got[0] === want[0] && got[1] === want[1] && got[2] === want[2] && got[3] === want[3],
       `RIGID's inner box is ${g.box[0]}..${g.box[3]} of 16 (engine ${got.join(',')}, jar ${want.join(',')})`);
    ok(g.how === 'subtract', 'and RIGID SUBTRACTS it from a whole block — it is the rim, not the middle');
  }
}

// ═══════════════ 2. the face predicates answer the way vanilla's geometry does ═══════════════
console.log('\n 2. FULL, CENTER and RIGID tell the right blocks apart');
{
  const UP = 2, F = SR.SUPPORT_FULL, C = SR.SUPPORT_CENTER, G = SR.SUPPORT_RIGID;
  const st = (n) => SR.stateOf(n) | 0;
  // ⚠ EACH ROW IS A THING A PLAYER DOES. A fence takes a torch and not a rail; a hopper takes a
  // rail and not a torch, because its top is a rim with a hole in the middle. Neither is a
  // special case in the engine — the collision geometry answers both.
  const table = [
    ['stone',      1, 1, 1],
    ['glass',      1, 1, 1],
    ['oak_fence',  0, 1, 0],
    ['cobblestone_wall', 0, 1, 0],
    ['hopper',     0, 0, 1],
    ['anvil',      0, 1, 0],
    ['oak_slab',   0, 0, 0],
    ['farmland',   0, 0, 0],
    ['cactus',     0, 0, 0],
    ['soul_sand',  1, 1, 1],
  ];
  for (const [n, f, c, g] of table) {
    const s = st(n);
    if (!ok(s > 0, `${n} is a real block`)) continue;
    ok(SR.faceSturdy(s, UP, F) === !!f, `${n}: FULL ${!!f}`);
    ok(SR.faceSturdy(s, UP, C) === !!c, `${n}: CENTER ${!!c}`);
    ok(SR.faceSturdy(s, UP, G) === !!g, `${n}: RIGID ${!!g}`);
  }
  // ⚠ SOUL SAND IS THE ONE THAT CANNOT BE DERIVED FROM THE COLLISION BOX. It is 14/16 tall and
  // you sink into it, and vanilla's `getBlockSupportShape` returns a WHOLE BLOCK for it — which
  // is why redstone, rails and repeaters sit on it. Reading the collision shape alone refuses
  // all three on a block players build on constantly. The referee names the override.
  ok(shapeOverride.has('soul_sand'), 'the jar says soul_sand overrides its support shape');
  ok(SR.supportsWholeBlock(st('soul_sand')), 'and the engine treats it as a whole block');
  // #353: THREE blocks override getSidesShape - LeavesBlock (empty), SnowBlock (LAYERS_TO_SHAPE[layers]),
  // SoulSandBlock (full). Leaves support nothing; snow supports a full face only at 8 layers on top and
  // presents a full face underneath from layer 1.
  ok(shapeClasses.size === 3, `three classes override the support shape (${shapeClasses.size})`);
  ok(shapeOverride.has('oak_leaves'), 'the jar says leaves override the support shape');
  for (let d = 0; d < 6; d++) for (const t of [F, C, G]) {
    ok(SR.faceSturdy(st('oak_leaves'), d, t) === false, `oak_leaves face ${d} type ${t} supports nothing`);
  }
  const snow = (n) => SR.withLocal('snow', n - 1) | 0;
  for (const t of [F, C, G]) {
    ok(SR.faceSturdy(snow(8), UP, t) === true, `snow[8] top type ${t} supports`);
    ok(SR.faceSturdy(snow(1), UP, t) === false, `snow[1] top type ${t} does not`);
    ok(SR.faceSturdy(snow(1), 3, t) === true, `snow[1] bottom type ${t} supports`);
    ok(SR.faceSturdy(snow(8), 3, t) === true, `snow[8] bottom type ${t} supports`);
  }
  {
    // anti-vacuity (#353): with the leaves table emptied, leaves would support a torch - the assertion above sees it
    const keep = SR.leavesBlocks; SR.leavesBlocks = new Uint8Array(keep.length);
    okAv(SR.faceSturdy(st('oak_leaves'), UP, C) === true, 'with the leaves override removed, leaves hold a torch again');
    SR.leavesBlocks = keep;
    const sb = SR.snowBlock; SR.snowBlock = -1;
    okAv(SR.faceSturdy(snow(1), 3, F) === false, 'with the snow override removed, a 1-layer snow presents no full face below');
    SR.snowBlock = sb;
  }
  ok(!SR.supportsWholeBlock(st('stone')), 'while an ordinary block is not given that treatment');
}

// ═══════════════ 3. every block with a rule has the rule the table says ═════════════════════
console.log('\n 3. the rule table and the jar agree about which blocks have a rule');
{
  const ruled = [], owed = [];
  for (let b = 0; b < R.blockCount; b++) {
    const n = R.names[b];
    const s = R.realFirst[b];
    const rule = SR.rule ? SR.rule[s] : 0;
    if (rule) ruled.push(n); else if (ownerOfBlock.has(n)) owed.push(n);
  }
  console.log(`   ${ruled.length} blocks carry one of the implemented rules, ${owed.length} more have a` +
              ` vanilla override this engine does not implement yet`);
  ok(ruled.length >= 50, `at least fifty blocks carry a rule (${ruled.length})`);
  // ⚠ CLOSED IN BOTH DIRECTIONS: nothing may carry a rule that the jar says has no override.
  const wrong = ruled.filter((n) => !ownerOfBlock.has(n));
  ok(wrong.length === 0,
     `no block carries a rule the jar does not give it (${wrong.slice(0, 5).join(' ')})`);
  // and the families that used to float must now all carry one
  for (const n of ['rail', 'powered_rail', 'snow', 'cactus', 'lever', 'stone_button',
                   'oak_door', 'white_carpet', 'stone_pressure_plate']) {
    const s = SR.stateOf(n) | 0;
    ok(s > 0 && SR.rule[s] > 0, `${n} has a survival rule now (was floating)`);
  }
}

// ═══════════════ 4. the rules themselves, in a real world ═══════════════════════════════════
console.log('\n 4. the rules, driven through World.setBlock in a real chunk');
{
  // a flat world: stone up to y=64, air above
  M.World.init(1);
  const SEC = M.CFG.WORLD_MIN_Y;
  for (let cx = -1; cx <= 1; cx++) for (let cz = -1; cz <= 1; cz++) {
    const c = M.World.makeChunk(cx, cz);
    c.state = M.CH.GENERATED;
    M.World.chunks.set(M.World.key ? M.World.key(cx, cz) : cx + ',' + cz, c);
  }
  const ready = M.World.loadedAt(0, 0);
  ok(ready, 'a chunk is loaded to place into');
  if (ready) {
    const put = (x, y, z, n) => M.World.setBlock(x, y, z, SR.stateOf(n) | 0);
    const clear = (x, y, z) => M.World.setBlock(x, y, z, 0);
    const stone = SR.stateOf('stone') | 0;
    // a floor of stone at y = 8 (arbitrary, inside the loaded section)
    for (let x = -2; x <= 2; x++) for (let z = -2; z <= 2; z++) M.World.setBlock(x, 8, z, stone);

    ok(put(1, 9, 1, 'rail') === true, 'a rail goes down on stone');
    clear(1, 9, 1);
    ok(put(1, 12, 1, 'rail') === false, 'and NOT in mid-air — this is the bug');
    ok(put(0, 9, 0, 'white_carpet') === true, 'a carpet goes on stone');
    clear(0, 9, 0);
    ok(put(0, 12, 0, 'white_carpet') === false, 'and not in mid-air');
    for (const air of ['cave_air', 'void_air']) {   // D-262 audit: rules 7, 37, 38 use isAir, not `=== 0`
      put(0, 10, 0, air);
      ok(put(0, 11, 0, 'white_carpet') === false, 'a carpet is refused over ' + air);
      clear(0, 11, 0); clear(0, 10, 0);
    }
    ok(put(-1, 9, -1, 'stone_pressure_plate') === true, 'a pressure plate goes on stone');
    clear(-1, 9, -1);
    ok(put(-1, 12, -1, 'stone_pressure_plate') === false, 'and not in mid-air');
    ok(put(2, 9, 2, 'snow') === true, 'a snow layer goes on stone');
    clear(2, 9, 2);
    ok(put(2, 12, 2, 'snow') === false, 'and not in mid-air');
    ok(put(-2, 12, -2, 'cactus') === false, 'a cactus does not go in mid-air');
    ok(put(-2, 12, -2, 'oak_door') === false, 'nor does a door');

    // ⚠ #351: THE OTHER HALF OF A RULE — remove the support and the block must go. The cascade used
    // to skip every jar-rule block with no material class (carpet, plate, cake, candle, door...).
    for (const n of ['white_carpet', 'stone_pressure_plate', 'cake', 'white_candle', 'redstone_wire', 'rail']) {
      M.World.setBlock(0, 8, 0, stone);
      const placed = put(0, 9, 0, n);
      M.World.setBlock(0, 8, 0, 0);
      const gone = M.World.getBlock(0, 9, 0) === 0;
      ok(placed && gone, n + ' breaks when the block under it is removed');
      clear(0, 9, 0); M.World.setBlock(0, 8, 0, stone);
    }

    // ⚠ THE OTHER DIRECTION, AND IT IS THE ONE THAT MATTERS MORE. A legal build must still work.
    M.World.setBlock(0, 9, 0, SR.stateOf('sand') | 0);
    ok(put(0, 10, 0, 'cactus') === true, 'a cactus DOES go on sand with nothing beside it');
    clear(0, 10, 0); clear(0, 9, 0);

    // a rail on a HOPPER: RIGID passes on a rim, and this is the build a wrong rule would refuse
    const hop = SR.stateOf('hopper') | 0;
    if (hop > 0) {
      M.World.setBlock(1, 9, 1, hop);
      ok(put(1, 10, 1, 'rail') === true, 'a rail DOES go on a hopper — its rim is rigid');
      clear(1, 10, 1); clear(1, 9, 1);
    }
    // a rail on SOUL SAND, which the collision box alone would refuse
    const ss = SR.stateOf('soul_sand') | 0;
    if (ss > 0) {
      M.World.setBlock(1, 9, 1, ss);
      ok(put(1, 10, 1, 'rail') === true, 'and on soul sand, whose support shape is a whole block');
      clear(1, 10, 1); clear(1, 9, 1);
    }
    // a rail on a FENCE must be refused: a post is not a rim
    const fen = SR.stateOf('oak_fence') | 0;
    if (fen > 0) {
      M.World.setBlock(1, 9, 1, fen);
      ok(put(1, 10, 1, 'rail') === false, 'a rail does NOT go on a fence post');
      clear(1, 9, 1);
    }

    // ⚠⚠ **A WALL ATTACHMENT, AND THIS SECTION EXISTS BECAUSE ITS ABSENCE HID A BUG.** The first
    // draft asserted only that a lever HAS a rule, never that one can be placed on a wall — and
    // the direction table the wall case uses was INVERTED, so it asked the supporting block for
    // the wrong face. The support sits opposite the way the widget faces, and the face it must
    // present is the one pointing back. Two orders of six directions that disagree is exactly
    // the mix-up `07_world.js` warns about, and the check has to place one to see it.
    {
      const R2 = M.Reg, put2 = (x, y, z, st) => M.World.setBlock(x, y, z, st);
      // a wall of stone at x = 3, and a lever on its west face (facing west = away from the wall)
      for (let yy = 9; yy <= 11; yy++) M.World.setBlock(3, yy, 0, stone);
      const lev = SR.stateOf('lever') | 0;
      let wallLever = -1, floorLever = -1;
      for (let s2 = 1; s2 < SR.count; s2++) {
        if (SR.block[s2] !== SR.block[lev]) continue;
        const face = SR.propValue(s2, R2.PROP.face);
        const facing = SR.propValue(s2, R2.PROP.facing);
        if (face === R2.PVAL.wall && facing === R2.PVAL.west && wallLever < 0) wallLever = s2;
        if (face === R2.PVAL.floor && floorLever < 0) floorLever = s2;
      }
      ok(wallLever > 0, 'a wall-mounted lever state facing west exists');
      if (wallLever > 0) {
        // facing west means the lever's face points west, so its support is to the EAST of it:
        // put it at x = 2 with the stone wall at x = 3
        ok(put2(2, 10, 0, wallLever) === true,
           'a lever mounts on the wall behind it');
        M.World.setBlock(2, 10, 0, 0);
        ok(put2(-3, 10, 0, wallLever) === false,
           'and NOT where there is no wall behind it');
      }
      if (floorLever > 0) {
        ok(put2(1, 9, 1, floorLever) === true, 'a floor lever stands on stone');
        M.World.setBlock(1, 9, 1, 0);
        ok(put2(1, 12, 1, floorLever) === false, 'and not in mid-air');
      }
      // a candle asks for a CENTRE, so it stands on a fence post where a rail may not
      const cand = SR.stateOf('candle') | 0;
      if (cand > 0 && fen > 0) {
        M.World.setBlock(1, 9, 1, fen);
        ok(put2(1, 10, 1, cand) === true, 'a candle stands on a fence post — it asks for a centre');
        M.World.setBlock(1, 10, 1, 0); M.World.setBlock(1, 9, 1, 0);
        ok(put2(1, 12, 1, cand) === false, 'and not in mid-air');
      }
        // ⚠ THE FAMILIES THAT SHARE A RULE WITHOUT SHARING A CLASS. A repeater's `canSurvive` is
      // byte-for-byte a rail's; a sign's and a candle cake's are a banner's. The referee table is
      // what proves they are the SAME rule rather than three that happen to look alike, and
      // these assertions are what keep the sharing honest if one of them ever diverges.
      for (const [n, mustFloat] of [['repeater', false], ['comparator', false],
                                    ['oak_sign', false], ['candle_cake', false]]) {
        const s3 = SR.stateOf(n) | 0;
        if (!s3) continue;
        ok(SR.rule[s3] > 0, `${n} carries a survival rule`);
        M.World.setBlock(1, 9, 1, stone);
        ok(put2(1, 10, 1, s3) === true, `${n} goes down on stone`);
        M.World.setBlock(1, 10, 1, 0); M.World.setBlock(1, 9, 1, 0);
        ok(put2(1, 12, 1, s3) === mustFloat, `and ${n} does NOT go in mid-air`);
      }
      // and a repeater must refuse a fence post, exactly as a rail does — it asks for a RIM
      {
        const rep = SR.stateOf('repeater') | 0;
        if (rep > 0 && fen > 0) {
          M.World.setBlock(1, 9, 1, fen);
          ok(put2(1, 10, 1, rep) === false, 'a repeater does NOT go on a fence post, just as a rail does not');
          M.World.setBlock(1, 9, 1, 0);
        }
      }

    // ⚠ THE MATERIAL RULE, AND THE TWO BLOCKS THAT PROVE IT IS NOT A SHAPE TEST. A banner
      // stands on anything whose MATERIAL is solid: a COBWEB qualifies though it has no
      // collision box at all, and a LADDER does not though it has one. Either substitution —
      // "has a collision box", "has a sturdy face" — gets both of these backwards.
      const ban = SR.stateOf('white_banner') | 0;
      const web = SR.stateOf('cobweb') | 0, lad = SR.stateOf('ladder') | 0;
      if (ban > 0) {
        M.World.setBlock(1, 9, 1, stone);
        ok(put2(1, 10, 1, ban) === true, 'a banner stands on stone');
        M.World.setBlock(1, 10, 1, 0);
        ok(put2(1, 12, 1, ban) === false, 'and not in mid-air');
        if (web > 0) {
          M.World.setBlock(1, 9, 1, web);
          ok(put2(1, 10, 1, ban) === true,
             'a banner stands on a COBWEB — solid material, no collision box');
          M.World.setBlock(1, 10, 1, 0);
        }
        M.World.setBlock(1, 9, 1, 0);
        // ⚠⚠ **A LADDER HAS TO GO ON A WALL, AND THE FIRST DRAFT OF THIS TEST FORGOT.** It set a
        // ladder into open air, the placement was correctly REFUSED, the cobweb from the line
        // above was still sitting there — and the banner stood on the cobweb and the assertion
        // failed while every rule involved was working. **A check that does not verify its own
        // setup is measuring the setup.** The ladder now goes against the stone wall at x = 3,
        // and its placement is asserted before anything is built on it.
        let ladderAt = -1;
        for (let s2 = 1; s2 < SR.count; s2++) {
          if (SR.block[s2] !== SR.block[lad]) continue;
          if (SR.propValue(s2, R2.PROP.facing) === R2.PVAL.west) { ladderAt = s2; break; }
        }
        if (ladderAt > 0) {
          ok(put2(2, 10, 0, ladderAt) === true, 'a ladder hangs on the wall at x=3');
          ok(SR.block[M.World.getBlock(2, 10, 0)] === SR.block[lad], 'and it is really there');
          ok(put2(2, 11, 0, ban) === false,
             'a banner does NOT stand on a ladder — a collision box, and not a solid material');
          M.World.setBlock(2, 11, 0, 0);
          M.World.setBlock(2, 10, 0, 0);
        }
      }
      ok(SR.solidMat && SR.solidMat[SR.block[web]] === 1, 'cobweb reports a solid material');
      ok(SR.solidMat && SR.solidMat[SR.block[lad]] === 0, 'and a ladder does not');

      // coral needs a FULL face, so a fence post is not enough
      const cor = SR.stateOf('brain_coral') | 0;
      if (cor > 0 && fen > 0) {
        M.World.setBlock(1, 9, 1, fen);
        ok(put2(1, 10, 1, cor) === false, 'coral does NOT stand on a fence post — it needs a full face');
        M.World.setBlock(1, 9, 1, stone);
        ok(put2(1, 10, 1, cor) === true, 'and it does stand on stone');
        M.World.setBlock(1, 10, 1, 0); M.World.setBlock(1, 9, 1, 0);
      }
    }

    // ═══════════ 4b. D-349's twenty-six rules, EVERY ONE IN BOTH DIRECTIONS ════════════════
    //
    // ⚠⚠ **A RULE ASSERTED IN ONE DIRECTION IS HALF A RULE** (D-346, paid for again here). "It
    // does not float" is the cheap half; "it still goes where it should" is the half that a
    // player notices, and a rule that refuses a LEGAL build is worse than one that allows an
    // illegal one. Every entry below is a pair.
    // ⚠ AND EVERY ONE GOES THROUGH `World.setBlock`, not through `surviveRule`. Asking the rule
    // function directly is asking the code its own question (D-331): the gate that CALLS it was
    // shut for a whole session and twelve green rules were dead on arrival.
    console.log('\n 4b. the twenty-six rules of D-349, each asserted both ways');
    {
      const R2 = M.Reg;
      const ST = (n) => SR.stateOf(n) | 0;
      /** a state of `name` whose named properties have the named values, or 0 */
      const stateWith = (name, props) => {
        const base = ST(name);
        if (!base) return 0;
        outer: for (let s2 = 1; s2 < SR.count; s2++) {
          if (SR.block[s2] !== SR.block[base]) continue;
          for (const k of Object.keys(props)) {
            const pi = R2.PROP[k], pv = R2.PVAL[props[k]];
            if (pi === undefined || pv === undefined) continue outer;
            if (SR.propValue(s2, pi) !== pv) continue outer;
          }
          return s2;
        }
        return 0;
      };
      // a clear arena around (0, 20, 0): nothing left over from the section above can reach it
      const wipe = () => {
        for (let dx = -2; dx <= 2; dx++) for (let dy = -2; dy <= 3; dy++) {
          for (let dz = -2; dz <= 2; dz++) M.World.setBlock(dx, 20 + dy, dz, 0);
        }
      };
      /**
       * `scene` places the named blocks at offsets from the test cell, then tries to put `what`
       * IN the test cell and asserts the answer.
       * ⚠ IT VERIFIES ITS OWN SETUP (session 11's rule): every scene block must actually be in
       * the cell afterwards, or the assertion below it is measuring the setup and not the rule.
       */
      let sceneFails = 0;
      /**
       * ⚠ A SCENE BLOCK MAY BE ONE THE RULES THEMSELVES REFUSE TO PLACE, and that is not a fault
       * in the scene. A big dripleaf STEM with a head above it is a configuration vanilla reaches
       * by GROWING, never by placing — the head cannot be placed until the stem is there and the
       * stem is not valid until the head is. Vanilla writes such states through its save replay,
       * which goes round `setBlock`'s gate by design (the comment on the gate says so), so a
       * scene cell prefixed `!` is written the same way: straight into the section, exactly as a
       * loaded save does. It is used for two cells in this whole file and both are named.
       */
      const raw = (x, y, z, st2) => {
        const c = M.World.get(x >> 4, z >> 4);
        const ly = y - M.CFG.WORLD_MIN_Y;
        M.Section.set(c.sec[ly >> 4], ((ly & 15) << 8) | ((z & 15) << 4) | (x & 15), st2);
        M.World.markDirty(x >> 4, z >> 4, ly >> 4);
      };
      const trial = (label, cells, what, expect) => {
        wipe();
        for (const cell of cells) {
          const [dx, dy, dz, n] = cell;
          const forced = cell[4] === 'raw';
          const st2 = typeof n === 'number' ? n : ST(n);
          if (forced) raw(dx, 20 + dy, dz, st2); else M.World.setBlock(dx, 20 + dy, dz, st2);
          if (M.World.getBlock(dx, 20 + dy, dz) !== st2) {
            sceneFails++;
            fails.push('scene for "' + label + '" did not take: ' + n + ' at ' + dx + ',' + dy + ',' + dz);
            return;
          }
        }
        const target = typeof what === 'number' ? what : ST(what);
        if (!target) { fails.push('no state for ' + what + ' (' + label + ')'); return; }
        ok(M.World.setBlock(0, 20, 0, target) === expect, label);
        M.World.setBlock(0, 20, 0, 0);
      };

      // ── the GROUND rules (D-348): the same canSurvive, seventeen different answers ────────
      trial('a dandelion goes on dirt', [[0, -1, 0, 'dirt']], 'dandelion', true);
      trial('and NOT on stone', [[0, -1, 0, 'stone']], 'dandelion', false);
      trial('a dandelion goes on farmland too', [[0, -1, 0, 'farmland']], 'dandelion', true);
      trial('an azalea goes on clay', [[0, -1, 0, 'clay']], 'azalea', true);
      trial('and an azalea NOT on stone', [[0, -1, 0, 'stone']], 'azalea', false);
      trial('a crimson fungus goes on crimson nylium', [[0, -1, 0, 'crimson_nylium']], 'crimson_fungus', true);
      trial('and a fungus NOT on stone', [[0, -1, 0, 'stone']], 'crimson_fungus', false);
      trial('crimson roots go on soul soil', [[0, -1, 0, 'soul_soil']], 'crimson_roots', true);
      trial('and roots NOT on stone', [[0, -1, 0, 'stone']], 'crimson_roots', false);
      // ⚠⚠ THE ONE THAT PROVES THE SECOND LEVEL EXISTS. Every block in this family shares one
      // `canSurvive`; if the family were flattened to one rule, nether wart would plant on grass.
      trial('NETHER WART goes on soul sand', [[0, -1, 0, 'soul_sand']], 'nether_wart', true);
      trial('and nether wart does NOT go on grass', [[0, -1, 0, 'grass_block']], 'nether_wart', false);
      trial('and not on dirt either', [[0, -1, 0, 'dirt']], 'nether_wart', false);
      trial('a melon stem goes on farmland', [[0, -1, 0, 'farmland']], 'melon_stem', true);
      trial('and a melon stem NOT on plain dirt', [[0, -1, 0, 'dirt']], 'melon_stem', false);
      trial('a dead bush goes on sand', [[0, -1, 0, 'sand']], 'dead_bush', true);
      trial('a dead bush goes on white terracotta', [[0, -1, 0, 'white_terracotta']], 'dead_bush', true);
      trial('and a dead bush NOT on stone', [[0, -1, 0, 'stone']], 'dead_bush', false);
      trial('seagrass goes on stone', [[0, -1, 0, 'stone']], 'seagrass', true);
      trial('and seagrass NOT on magma', [[0, -1, 0, 'magma_block']], 'seagrass', false);
      trial('a lily pad floats on water', [[0, -1, 0, 'water']], 'lily_pad', true);
      for (const lv of [1, 3, 7, 8]) trial('a lily pad is REFUSED on water level ' + lv, [[0, -1, 0, SR.withLocal('water', lv)]], 'lily_pad', false);
      {
        const slab0 = ST('oak_slab');
        let wl = 0;
        for (let q = slab0 - 8; q < slab0 + 8; q++) if (SR.block[q] === SR.block[slab0] && SR.waterIn[q]) { wl = q; break; }
        trial('a lily pad floats on a waterlogged slab', [[0, -1, 0, wl]], 'lily_pad', true);
      }
      trial('a lily pad floats on ICE', [[0, -1, 0, 'ice']], 'lily_pad', true);
      // ⚠ AND NOT ON PACKED ICE, which is a DIFFERENT material — this is what makes `iceMat` a
      // material table and not "anything with ice in the name".
      trial('and NOT on packed ice', [[0, -1, 0, 'packed_ice']], 'lily_pad', false);
      trial('and a lily pad NOT on stone', [[0, -1, 0, 'stone']], 'lily_pad', false);
      trial('a wither rose goes on netherrack', [[0, -1, 0, 'netherrack']], 'wither_rose', true);
      trial('a wither rose goes on dirt as well', [[0, -1, 0, 'dirt']], 'wither_rose', true);
      trial('and a wither rose NOT on stone', [[0, -1, 0, 'stone']], 'wither_rose', false);
      trial('a sea pickle goes on stone', [[0, -1, 0, 'stone']], 'sea_pickle', true);
      trial('and a sea pickle NOT in mid-air', [], 'sea_pickle', false);
      trial('a small dripleaf goes on clay', [[0, -1, 0, 'clay']], 'small_dripleaf', true);
      trial('and a small dripleaf NOT on stone', [[0, -1, 0, 'stone']], 'small_dripleaf', false);
      // #350: the water in its own cell must be a still source (isEqualAndStill); the tag branch has no water condition
      {
        const RG = M.Reg, wp = (st, p, v) => SR.withProp(st, RG.PROP[p], RG.PVAL[v]);
        const wl = (lvl) => wp(ST('water'), 'level', String(lvl));
        const dl = wp(ST('small_dripleaf'), 'waterlogged', 'true');
        const put = (floor, w) => {
          M.World.setBlock(0, 19, 0, ST(floor)); M.World.setBlock(0, 20, 0, w);
          const r = M.World.setBlock(0, 20, 0, dl);
          M.World.setBlock(0, 20, 0, 0); M.World.setBlock(0, 19, 0, 0); return r;
        };
        ok(dl && put('dirt', wl(0)) === true, 'a small dripleaf on dirt in a water SOURCE is allowed');
        ok(dl && put('dirt', wl(2)) === false, 'and NOT on dirt in FLOWING water (#350)');
        ok(dl && put('clay', wl(2)) === true, 'but on clay it is allowed in flowing water (the tag branch)');
      }

      // ── 16 DOUBLE PLANT ──────────────────────────────────────────────────────────────────
      {
        const lower = stateWith('tall_grass', { half: 'lower' });
        const upper = stateWith('tall_grass', { half: 'upper' });
        ok(lower > 0 && upper > 0, 'tall grass has a lower and an upper half state');
        if (lower > 0 && upper > 0) {
          trial('the lower half of tall grass goes on dirt', [[0, -1, 0, 'dirt']], lower, true);
          trial('and the lower half NOT on stone', [[0, -1, 0, 'stone']], lower, false);
          trial('the upper half goes over its own lower half',
                [[0, -2, 0, 'dirt'], [0, -1, 0, lower]], upper, true);
          trial('and the upper half NOT over stone', [[0, -1, 0, 'stone']], upper, false);
          // ⚠ AND NOT OVER A SECOND UPPER HALF — the rule is "its own lower half below", not
          // "the same block below", and this is the pair that tells those two readings apart.
          trial('and NOT over a second UPPER half',
                [[0, -3, 0, 'dirt'], [0, -2, 0, lower], [0, -1, 0, upper]], upper, false);
        }
      }

      // ── 17 GRINDSTONE: the rule that says yes ────────────────────────────────────────────
      trial('a grindstone stays in mid-air, which is vanilla', [], 'grindstone', true);

      // ── 18 SOUL FIRE ─────────────────────────────────────────────────────────────────────
      trial('soul fire burns on soul sand', [[0, -1, 0, 'soul_sand']], 'soul_fire', true);
      trial('and soul fire NOT on stone', [[0, -1, 0, 'stone']], 'soul_fire', false);

      // ── 19 REDSTONE WIRE, and the hopper vanilla names by hand ───────────────────────────
      trial('redstone dust goes on stone', [[0, -1, 0, 'stone']], 'redstone_wire', true);
      trial('redstone dust goes on a HOPPER, which vanilla exempts by name',
            [[0, -1, 0, 'hopper']], 'redstone_wire', true);
      trial('and redstone dust NOT on a fence post', [[0, -1, 0, 'oak_fence']], 'redstone_wire', false);
      trial('and NOT in mid-air', [], 'redstone_wire', false);

      // ── 20 and 21: THE TWO RULES THAT LOOK UP ────────────────────────────────────────────
      trial('farmland survives with air above it', [[0, -1, 0, 'dirt']], 'farmland', true);
      trial('and farmland does NOT survive under stone',
            [[0, -1, 0, 'dirt'], [0, 1, 0, 'stone']], 'farmland', false);
      trial('but it DOES survive under a fence gate',
            [[0, -1, 0, 'dirt'], [0, 1, 0, 'oak_fence_gate']], 'farmland', true);
      trial('a dirt path survives with air above it', [[0, -1, 0, 'dirt']], 'dirt_path', true);
      trial('and NOT under stone', [[0, -1, 0, 'dirt'], [0, 1, 0, 'stone']], 'dirt_path', false);

      // ── 22 SUGAR CANE: the water is beside THE GROUND ────────────────────────────────────
      trial('sugar cane grows on sand beside water',
            [[0, -1, 0, 'sand'], [1, -1, 0, 'water']], 'sugar_cane', true);
      trial('and NOT on sand with no water beside it', [[0, -1, 0, 'sand']], 'sugar_cane', false);
      // ⚠⚠ THE CASE THAT TELLS THE TWO READINGS APART. Water beside the CANE and not beside the
      // SAND is refused by vanilla; a rule that scans the cane's own neighbours would allow it.
      trial('and NOT with the water beside the CANE instead of the sand',
            [[0, -1, 0, 'sand'], [1, 0, 0, 'water']], 'sugar_cane', false);
      trial('and sugar cane DOES stack on sugar cane',
            [[0, -2, 0, 'sand'], [1, -2, 0, 'water'], [0, -1, 0, 'sugar_cane']], 'sugar_cane', true);

      // ── 23 COCOA: along the facing, not against it ───────────────────────────────────────
      {
        const cocoaN = stateWith('cocoa', { facing: 'north' });
        ok(cocoaN > 0, 'a north-facing cocoa state exists');
        if (cocoaN > 0) {
          trial('cocoa grows on the jungle log it FACES',
                [[0, 0, -1, 'jungle_log']], cocoaN, true);
          trial('and NOT on a jungle log BEHIND it',
                [[0, 0, 1, 'jungle_log']], cocoaN, false);
          trial('and NOT on an oak log it faces', [[0, 0, -1, 'oak_log']], cocoaN, false);
        }
      }

      // ── 24 BAMBOO ────────────────────────────────────────────────────────────────────────
      trial('bamboo grows on dirt', [[0, -1, 0, 'dirt']], 'bamboo', true);
      trial('and bamboo NOT on stone', [[0, -1, 0, 'stone']], 'bamboo', false);

      // ── 25 BUBBLE COLUMN ─────────────────────────────────────────────────────────────────
      trial('a bubble column stands on magma', [[0, -1, 0, 'magma_block']], 'bubble_column', true);
      trial('and NOT on stone', [[0, -1, 0, 'stone']], 'bubble_column', false);

      // ── 26 and 27: the two that hang from the ceiling ────────────────────────────────────
      trial('hanging roots hang from stone', [[0, 1, 0, 'stone']], 'hanging_roots', true);
      trial('and NOT from nothing', [], 'hanging_roots', false);
      trial('a spore blossom hangs from stone', [[0, 1, 0, 'stone']], 'spore_blossom', true);
      trial('and NOT from nothing', [], 'spore_blossom', false);
      // #348: `isWater(pos)` reads the WORLD cell, so a blossom is refused where water already is
      trial('and NOT into a water cell under stone', [[0, 1, 0, 'stone'], [0, 0, 0, 'water']], 'spore_blossom', false);
      trial('and NOT into a flowing water cell under stone',
            [[0, 1, 0, 'stone'], [0, 0, 0, SR.withLocal('water', 3)]], 'spore_blossom', false);
      {
        const wls = stateWith('stone_slab', { type: 'bottom', waterlogged: 'true' });
        ok(wls > 0, 'a waterlogged slab state exists');
        if (wls > 0) trial('and NOT into a waterlogged cell under stone', [[0, 1, 0, 'stone'], [0, 0, 0, wls]], 'spore_blossom', false);
      }

      // ── 28 and 29: the dripleaf, whose stem needs BOTH cells ─────────────────────────────
      trial('a big dripleaf stands on clay', [[0, -1, 0, 'clay']], 'big_dripleaf', true);
      trial('and NOT on stone', [[0, -1, 0, 'stone']], 'big_dripleaf', false);
      // ⚠ THE HEAD IS FORCED IN: a big dripleaf one block up cannot be PLACED before the stem
      // under it exists, and the stem is not valid until the head is. Vanilla reaches this by
      // growing; a save replay writes it directly; so does this.
      trial('a dripleaf stem needs a head above it as well as ground below',
            [[0, -1, 0, 'clay'], [0, 1, 0, 'big_dripleaf', 'raw']], 'big_dripleaf_stem', true);
      trial('and a stem with nothing above it is refused',
            [[0, -1, 0, 'clay']], 'big_dripleaf_stem', false);

      // ── 30 POINTED DRIPSTONE ─────────────────────────────────────────────────────────────
      {
        const up = stateWith('pointed_dripstone', { vertical_direction: 'up' });
        const down = stateWith('pointed_dripstone', { vertical_direction: 'down' });
        ok(up > 0 && down > 0, 'pointed dripstone has an up and a down state');
        if (up > 0) {
          trial('an upward dripstone stands on stone', [[0, -1, 0, 'stone']], up, true);
          trial('and NOT in mid-air', [], up, false);
        }
        if (down > 0) {
          trial('a downward dripstone hangs from stone', [[0, 1, 0, 'stone']], down, true);
          trial('and a downward one does NOT stand on the floor', [[0, -1, 0, 'stone']], down, false);
          trial('but it DOES hang from another one pointing the same way',
                [[0, 2, 0, 'stone'], [0, 1, 0, down]], down, true);
        }
      }

      // ── 31 BELL ──────────────────────────────────────────────────────────────────────────
      {
        const floorBell = stateWith('bell', { attachment: 'floor' });
        const ceilBell = stateWith('bell', { attachment: 'ceiling' });
        if (floorBell > 0) {
          trial('a floor bell stands on stone', [[0, -1, 0, 'stone']], floorBell, true);
          trial('and NOT in mid-air', [], floorBell, false);
          trial('and NOT on a fence post (vanilla asks a FULL face)', [[0, -1, 0, 'oak_fence']], floorBell, false);
        }
        if (ceilBell > 0) {
          trial('a ceiling bell hangs from stone', [[0, 1, 0, 'stone']], ceilBell, true);
          trial('and NOT from nothing', [], ceilBell, false);
          trial('but a ceiling bell DOES hang under a fence (CENTER)', [[0, 1, 0, 'oak_fence']], ceilBell, true);
        }
      }

      // ── 32 PISTON HEAD ───────────────────────────────────────────────────────────────────
      {
        const headUp = stateWith('piston_head', { facing: 'up', type: 'normal' });
        const baseUp = stateWith('piston', { facing: 'up', extended: 'true' });
        const baseIdle = stateWith('piston', { facing: 'up', extended: 'false' });
        if (headUp > 0 && baseUp > 0) {
          trial('a piston head sits on its own extended piston', [[0, -1, 0, baseUp]], headUp, true);
          trial('and NOT in mid-air', [], headUp, false);
        }
        if (headUp > 0 && baseIdle > 0) {
          trial('and NOT on a piston that is not extended', [[0, -1, 0, baseIdle]], headUp, false);
        }
      }

      // ── 33 LANTERN, both ways up ─────────────────────────────────────────────────────────
      {
        const stand = stateWith('lantern', { hanging: 'false' });
        const hang = stateWith('lantern', { hanging: 'true' });
        if (stand > 0) {
          trial('a standing lantern stands on stone', [[0, -1, 0, 'stone']], stand, true);
          trial('a standing lantern stands on a FENCE POST — it asks for a centre',
                [[0, -1, 0, 'oak_fence']], stand, true);
          trial('and NOT in mid-air', [], stand, false);
        }
        if (hang > 0) {
          trial('a hanging lantern hangs from stone', [[0, 1, 0, 'stone']], hang, true);
          trial('and NOT from nothing', [], hang, false);
        }
      }

      // ── 34 THE GROWING PLANTS: one rule, a direction, and kelp's magma clause ────────────
      trial('kelp grows up off stone', [[0, -1, 0, 'stone']], 'kelp', true);
      trial('and kelp does NOT grow off MAGMA', [[0, -1, 0, 'magma_block']], 'kelp', false);
      trial('kelp grows off kelp', [[0, -2, 0, 'stone'], [0, -1, 0, 'kelp_plant']], 'kelp', true);
      trial('twisting vines grow UP off stone', [[0, -1, 0, 'stone']], 'twisting_vines', true);
      trial('and twisting vines do NOT hang from a ceiling', [[0, 1, 0, 'stone']], 'twisting_vines', false);
      trial('weeping vines HANG from stone', [[0, 1, 0, 'stone']], 'weeping_vines', true);
      trial('and weeping vines do NOT stand on the floor', [[0, -1, 0, 'stone']], 'weeping_vines', false);
      trial('cave vines hang from stone', [[0, 1, 0, 'stone']], 'cave_vines', true);

      // ── 35 and 36: per-face attachment ───────────────────────────────────────────────────
      {
        const vineN = stateWith('vine', { north: 'true', south: 'false', east: 'false',
                                          west: 'false', up: 'false' });
        ok(vineN > 0, 'a vine state attached on its north side alone exists');
        if (vineN > 0) {
          trial('a vine clings to the stone on its north side', [[0, 0, -1, 'stone']], vineN, true);
          trial('and NOT to a stone on the WRONG side', [[0, 0, 1, 'stone']], vineN, false);
          trial('and NOT to nothing at all', [], vineN, false);
          // the vine-under-vine fallback, which glow lichen does NOT have
          trial('but it DOES hang under a vine with the same side attached',
                [[0, 1, -1, 'stone'], [0, 1, 0, vineN]], vineN, true);
        }
        // ⚠ #347: the neighbour's TOUCHING face is tested, not its far one (cubes hide the difference)
        {
          const lichD = stateWith('glow_lichen', { down: 'true', up: 'false', north: 'false', south: 'false', east: 'false', west: 'false', waterlogged: 'false' });
          const lichN = stateWith('glow_lichen', { north: 'true', up: 'false', down: 'false', south: 'false', east: 'false', west: 'false', waterlogged: 'false' });
          const slabT = stateWith('stone_slab', { type: 'top', waterlogged: 'false' });
          const slabB = stateWith('stone_slab', { type: 'bottom', waterlogged: 'false' });
          const stS = stateWith('stone_stairs', { facing: 'south', half: 'bottom', shape: 'straight', waterlogged: 'false' });
          const stN = stateWith('stone_stairs', { facing: 'north', half: 'bottom', shape: 'straight', waterlogged: 'false' });
          if (lichD > 0 && slabT > 0 && slabB > 0) {
            trial('lichen (down) sits on a TOP slab: touching face full', [[0, -1, 0, slabT]], lichD, true);
            trial('lichen (down) does NOT sit on a BOTTOM slab: touching face half', [[0, -1, 0, slabB]], lichD, false);
          }
          if (lichN > 0 && stS > 0 && stN > 0) {
            trial('lichen (north) on stairs facing south: touching face full', [[0, 0, -1, stS]], lichN, true);
            trial('lichen (north) NOT on stairs facing north: touching face half', [[0, 0, -1, stN]], lichN, false);
          }
          if (vineN > 0 && stS > 0) trial('vine (north) clings to stairs facing south', [[0, 0, -1, stS]], vineN, true);
        }
        // ⚠ #19: `VineBlock.canPlaceAt` DROPS a dead face and keeps the vine while ANY face is good;
        // `MultifaceGrowthBlock.canPlaceAt` (lichen) refuses on the first dead one. A vine with a good
        // north side and a dangling west side was refused, and worldgen hangs exactly these under leaves.
        const vineNW = stateWith('vine', { north: 'true', south: 'false', east: 'false',
                                           west: 'true', up: 'false' });
        ok(vineNW > 0, 'a vine state attached on its north and west sides exists');
        if (vineNW > 0) {
          trial('a vine with one good side and one dead side SURVIVES (vanilla drops the dead face)',
                [[0, 0, -1, 'stone']], vineNW, true);
          trial('and with BOTH sides dead it does not', [], vineNW, false);
        }
        const lichenDU = stateWith('glow_lichen', { down: 'true', up: 'true', north: 'false',
                                                    south: 'false', east: 'false', west: 'false' });
        if (lichenDU > 0) {
          trial('glow lichen with one good face and one dead face is REFUSED (it, unlike a vine, is all-or-nothing)',
                [[0, -1, 0, 'stone']], lichenDU, false);
        }
        const lichenD = stateWith('glow_lichen', { down: 'true', up: 'false', north: 'false',
                                                   south: 'false', east: 'false', west: 'false' });
        if (lichenD > 0) {
          trial('glow lichen sits on top of stone', [[0, -1, 0, 'stone']], lichenD, true);
          trial('and NOT on nothing', [], lichenD, false);
        }
      }

      // ── 37 and 38: the chorus pair ───────────────────────────────────────────────────────
      trial('a chorus plant grows on end stone', [[0, -1, 0, 'end_stone']], 'chorus_plant', true);
      trial('and NOT in mid-air', [], 'chorus_plant', false);
      trial('a chorus flower grows on end stone', [[0, -1, 0, 'end_stone']], 'chorus_flower', true);
      trial('and NOT in mid-air', [], 'chorus_flower', false);

      // ── 39 SCAFFOLDING ───────────────────────────────────────────────────────────────────
      trial('scaffolding stands on stone', [[0, -1, 0, 'stone']], 'scaffolding', true);
      trial('and NOT in mid-air', [], 'scaffolding', false);

      // ── 14 MUSHROOM and 15 CROP: the two rules that read a LIGHT LEVEL ───────────────────
      // ⚠ THE LIGHT IS SET THROUGH THE ENGINE'S OWN PACKING, not by writing a byte this file
      // invented: `Section.packLight` is what the lighting engine stores and what `getLight`
      // reads back, so a check that packed it by hand would be testing its own arithmetic.
      {
        const light = (x, y, z, sky, blk) => {
          const c = M.World.get(x >> 4, z >> 4);
          const ly = y - M.CFG.WORLD_MIN_Y;
          M.Section.setLight(c.sec[ly >> 4], ((ly & 15) << 8) | ((z & 15) << 4) | (x & 15),
                             M.Section.packLight(sky, blk));
        };
        const dark = () => light(0, 20, 0, 0, 0);
        const bright = () => light(0, 20, 0, 0, 14);
        // ⚠ THE SCENE IS BUILT FIRST AND THE LIGHT SET AFTER IT, because placing a block is an
        // edit and an edit re-lights the cell.
        const lit = (cells, what, sky, blk, expect, label) => {
          wipe();
          for (const [dx, dy, dz, n] of cells) M.World.setBlock(dx, 20 + dy, dz, ST(n));
          light(0, 20, 0, sky, blk);
          ok(M.World.setBlock(0, 20, 0, ST(what)) === expect, label);
          M.World.setBlock(0, 20, 0, 0);
        };
        void dark; void bright;
        lit([[0, -1, 0, 'mycelium']], 'brown_mushroom', 0, 15, true,
            'a mushroom grows on mycelium IN FULL LIGHT — the grow-block tag needs no darkness');
        lit([[0, -1, 0, 'stone']], 'brown_mushroom', 0, 0, true,
            'a mushroom grows on stone in the dark');
        lit([[0, -1, 0, 'stone']], 'brown_mushroom', 0, 14, false,
            'and NOT on stone in the light');
        // ⚠⚠ **SOUL SAND IS THE BLOCK THIS WHOLE TABLE EXISTS FOR** (D-350). Its COLLISION box is
        // 14/16 tall and its OUTLINE is a whole cube, so vanilla grows a mushroom on it and a
        // collision-shape test refuses one — which is refusing a LEGAL build.
        lit([[0, -1, 0, 'soul_sand']], 'brown_mushroom', 0, 0, true,
            'a mushroom grows on SOUL SAND in the dark, whose outline is a cube and whose collider is not');
        lit([[0, -1, 0, 'oak_slab']], 'brown_mushroom', 0, 0, false,
            'and NOT on a slab, whose outline is half a cube');
        lit([[0, -1, 0, 'glass']], 'brown_mushroom', 0, 0, false,
            'and NOT on glass, which is a full cube that does not OCCLUDE');
        lit([[0, -1, 0, 'oak_fence']], 'brown_mushroom', 0, 0, false,
            'and NOT on a fence post');

        lit([[0, -1, 0, 'farmland']], 'wheat', 0, 9, true, 'wheat grows on farmland in light 9');
        lit([[0, -1, 0, 'farmland']], 'wheat', 0, 0, false, 'and NOT on farmland in the dark');
        // ⚠ `canSeeSky` IS AN OR, NOT AN AND: a crop planted at dusk under open sky survives.
        lit([[0, -1, 0, 'farmland']], 'wheat', 15, 0, true,
            'but it DOES grow in the dark under open sky — the sky clause is an OR');
        lit([[0, -1, 0, 'dirt']], 'wheat', 0, 9, false, 'and never on plain dirt, however bright');
      }

      // ── the rules that were ALREADY HERE and now own more blocks ─────────────────────────
      // ⚠ NAMING A RULE BY A REPRESENTATIVE BLOCK IS ONLY WORTH ANYTHING IF THE SHARING IS
      // CHECKED. The referee says a torch's body IS a candle's and a ladder's IS a coral wall
      // fan's; these are what would fail the day one of them diverged.
      trial('a torch stands on stone', [[0, -1, 0, 'stone']], 'torch', true);
      trial('a torch stands on a FENCE POST, as a candle does', [[0, -1, 0, 'oak_fence']], 'torch', true);
      trial('and a torch NOT in mid-air', [], 'torch', false);
      trial('a cake stands on stone', [[0, -1, 0, 'stone']], 'cake', true);
      trial('and a cake NOT in mid-air', [], 'cake', false);
      // ⚠ AND THE CAKE ON A COBWEB, which is the MATERIAL rule and not a shape one
      trial('a cake stands on a COBWEB, which has no collision box at all',
            [[0, -1, 0, 'cobweb']], 'cake', true);
      {
        const ladN = stateWith('ladder', { facing: 'north' });
        if (ladN > 0) {
          trial('a ladder hangs on the wall behind it', [[0, 0, 1, 'stone']], ladN, true);
          trial('and NOT with the wall on the wrong side', [[0, 0, -1, 'stone']], ladN, false);
        }
        const amUp = stateWith('amethyst_cluster', { facing: 'up' });
        if (amUp > 0) {
          trial('an upward amethyst cluster grows on the floor', [[0, -1, 0, 'stone']], amUp, true);
          trial('and NOT in mid-air', [], amUp, false);
        }
        const amDown = stateWith('amethyst_cluster', { facing: 'down' });
        if (amDown > 0) {
          trial('a downward amethyst cluster grows on the ceiling', [[0, 1, 0, 'stone']], amDown, true);
          trial('and NOT on the floor', [[0, -1, 0, 'stone']], amDown, false);
        }
      }

      // ── 40 FIRE: the last of the 98, and "flammable" is an INTEGER ───────────────────────
      trial('fire burns on a stone floor', [[0, -1, 0, 'stone']], 'fire', true);
      trial('and NOT in mid-air with nothing beside it', [], 'fire', false);
      // ⚠⚠ **THE PAIR THAT PROVES THE IGNITE MAP IS BEING READ.** Fire beside WOOL survives with
      // nothing under it at all; fire beside STONE does not. No material, tag or shape separates
      // those two — only the per-block integer does.
      trial('but fire DOES hang in mid-air beside wool, which catches',
            [[1, 0, 0, 'white_wool']], 'fire', true);
      trial('and NOT beside stone, which does not', [[1, 0, 0, 'stone']], 'fire', false);
      // ⚠ ALL SIX NEIGHBOURS, not the four horizontals: vanilla walks Direction.values().
      trial('and wool ABOVE it counts too — the scan is all six directions',
            [[0, 1, 0, 'white_wool']], 'fire', true);
      trial('and so do leaves, at odds 30', [[1, 0, 0, 'oak_leaves']], 'fire', true);

      // ── D-349's OWN BUG: the cactus was reading the wrong table ──────────────────────────
      // ⚠⚠ **THE PAIR THAT TELLS `solid` FROM `solidMat` APART.** A cactus refuses a neighbour
      // whose MATERIAL is solid. A cobweb is a solid material with NO collision box; a ladder
      // has a collision box and is NOT a solid material. Any test that reads a shape, or reads
      // the right table with the wrong index, gets exactly one of these two backwards.
      trial('a cactus grows on sand with nothing beside it', [[0, -1, 0, 'sand']], 'cactus', true);
      trial('and a cactus is REFUSED beside a cobweb — a solid material with no collider',
            [[0, -1, 0, 'sand'], [1, 0, 0, 'cobweb']], 'cactus', false);
      // ⚠ A FLOWER POT, NOT A LADDER: a ladder is the textbook example of "a collider that is
      // not a solid material" and it has a survival rule of its own, so it cannot stand beside
      // the cactus without a wall — the scene would be testing the ladder. A flower pot is the
      // same material argument with no rule attached.
      trial('and a cactus is ALLOWED beside a flower pot — a collider that is not a solid material',
            [[0, -1, 0, 'sand'], [1, 0, 0, 'flower_pot']], 'cactus', true);
      trial('and a cactus is refused beside stone', [[0, -1, 0, 'sand'], [1, 0, 0, 'stone']],
            'cactus', false);

      ok(sceneFails === 0, 'every scene in this section actually took (' + sceneFails + ' did not)');
    }

    // ═══════════ 4c. the rules name only blocks and tags the REFEREE SAW ═══════════════════
    //
    // ⚠⚠ **TWENTY-SIX RULES TYPED BY HAND ARE TWENTY-SIX CHANCES TO TYPE THE WRONG BLOCK**, and
    // a wrong name resolves to -1 and matches nothing — a rule that never fires, which looks
    // exactly like no bug at all. The referee records every `Blocks.x` and `BlockTags.x` each
    // owner class mentions; this asserts the engine's names are a subset of that union.
    console.log('\n 4c. every block and tag the rules name is one the jar names');
    {
      const rows = readFileSync(join(MCLITE_ROOT, 'tools', 'golden', 'cansurvive-1.18.2.tsv'), 'utf8')
        .split('\n').filter((l) => l && l[0] !== '#');
      const refBlocks = new Set(), refTags = new Set();
      for (const l of rows) {
        const f = l.split('\t');
        if (f[0] === 'refblocks') for (const n of (f[3] || '').split(' ').filter(Boolean)) refBlocks.add(n);
        if (f[0] === 'reftags') for (const n of (f[3] || '').split(' ').filter(Boolean)) refTags.add(n);
      }
      ok(refBlocks.size > 40, 'the referee records ' + refBlocks.size + ' block references — too few');
      ok(refTags.size >= 8, 'the referee records ' + refTags.size + ' tag references — too few');
      // the names the engine's rules use, read off the source rather than repeated here
      const src = readFileSync(join(MCLITE_ROOT, 'src', '02k_survive.js'), 'utf8');   // the rules moved out of 07_world.js (#19)
      const used = new Set();
      for (const m of src.matchAll(/SV\.BID\.(\w+)/g)) used.add(m[1]);
      for (const m of src.matchAll(/tagQ\(L, '([a-z_]+)'/g)) used.add('#' + m[1]);
      for (const m of src.matchAll(/L\.tag\('([a-z_]+)'/g)) used.add('#' + m[1]);
      ok(used.size >= 25, 'only ' + used.size + ' names found in the rules — the scan read nothing');
      // ⚠ FOUR NAMES ARE THE ENGINE'S OWN AND NOT ANY RULE'S: the snow rule's ice, packed_ice,
      // barrier and honey_block come from D-346's referee row, and lava and water are the fluid
      // identities every rule shares. They are listed, not excused by a wildcard.
      const ENGINE_OWN = new Set(['ice', 'packed_ice', 'barrier', 'honey_block', 'water', 'lava',
                                  'sand', 'red_sand', 'soul_sand',
                                  // rules 20/21 name the fence-gate TAG where vanilla uses
                                  // `instanceof FenceGateBlock`, and 22 names frosted_ice which
                                  // the jar reaches through a fluid tag
                                  '#fence_gates', 'frosted_ice',
                                  // rule 7 asks two tags where the jar lists nineteen blocks;
                                  // 4d below asserts the two are the same set
                                  '#sand', '#terracotta']);
      const stray = [...used].filter((n) => {
        if (ENGINE_OWN.has(n)) return false;
        return n[0] === '#' ? !refTags.has(n.slice(1)) : !refBlocks.has(n);
      });
      ok(stray.length === 0,
         'these names are in the rules but in no rule class in the jar: ' + stray.join(' '));
      console.log('   ' + used.size + ' names used by the rules, ' + refBlocks.size + ' blocks and ' +
                  refTags.size + ' tags named by the jar, ' + stray.length + ' unaccounted for');

      // ── 4d. the dead bush's two tags ARE the jar's nineteen blocks ─────────────────────
      // ⚠ THE RULE ASKS `#sand` AND `#terracotta` WHERE THE JAR LISTS NINETEEN BLOCKS BY HAND.
      // That is a substitution, and a substitution is only safe if the sets are equal — so this
      // asserts it instead of trusting it. The day a tag gains a member the rule changes with
      // it, and this line is what says so.
      let bushRow = null;
      for (const l of rows) {
        const f = l.split('\t');
        if (f[0] === 'ground' && (f[3] || '').split(' ').includes('dead_bush')) bushRow = f[1];
      }
      let bushRefs = [];
      for (const l of rows) {
        const f = l.split('\t');
        if (f[0] === 'refblocks' && f[1] === bushRow) bushRefs = (f[3] || '').split(' ').filter(Boolean);
      }
      ok(bushRefs.length >= 19, 'the dead bush class names ' + bushRefs.length + ' blocks, not nineteen');
      const T = M.Tags;
      const tagUnion = new Set([...(T.blocks('sand') || []), ...(T.blocks('terracotta') || [])]);
      const onlyJar = bushRefs.filter((n) => !tagUnion.has(n));
      const onlyTag = [...tagUnion].filter((n) => !bushRefs.includes(n));
      ok(onlyJar.length === 0, 'the jar names blocks the two tags do not hold: ' + onlyJar.join(' '));
      ok(onlyTag.length === 0, 'the two tags hold blocks the jar does not name: ' + onlyTag.join(' '));
      console.log('   the dead bush: ' + bushRefs.length + ' blocks named by the jar, ' +
                  tagUnion.size + ' in #sand + #terracotta, ' +
                  (onlyJar.length + onlyTag.length) + ' differences');

      // ── 4e. what is still OWED is named, counted and consistent ────────────────────────
      const owedNames = [];
      {
        const ownerOf = new Map();
        for (const l of rows) {
          const f = l.split('\t');
          if (f[0] === 'owner') for (const n of (f[3] || '').split(' ').filter(Boolean)) ownerOf.set(n, f[1]);
        }
        for (let b = 0; b < R.blockCount; b++) {
          if (ownerOf.has(R.names[b]) && !SR.rule[R.realFirst[b]]) owedNames.push(R.names[b]);
        }
      }
      console.log('   still owed: ' + owedNames.join(' '));
      // ⚠⚠ **ZERO, AND THE ASSERTION IS THAT IT IS ZERO** (D-324). Every block vanilla gives a
      // `canSurvive` override now has one here. The day this engine gains a block the referee
      // knows a rule for and the engine does not, this line is what says so.
      ok(owedNames.length === 0,
         'these blocks have a vanilla survival rule this engine does not implement: ' +
         owedNames.join(' '));
      // ⚠⚠ **AND IT MUST FAIL THE DAY THEY ARE IMPLEMENTED** (D-324). A check that asserts a
      // limitation and keeps passing after the limitation is lifted is a check that has stopped
      // being about anything.
      ok(M.World.OWED_GROUND.length === owedNames.length,
         'World.OWED_GROUND lists ' + M.World.OWED_GROUND.length + ' missing tables while ' +
         owedNames.length + ' blocks are owed — the list has drifted from the code');

      // ⚠⚠ **THE ONE APPROXIMATION IN D-350, PROVED IMMATERIAL RATHER THAN EXCUSED.** The
      // referee cannot name the class of 75 blocks (their windows call a helper and never say
      // `new`), so `outlineFull` is unknown for them and `solidRender` falls back to the
      // COLLISION shape. That fallback only decides something if the two answers could differ —
      // so this asserts that for every such block the collision shape IS a full cube, which is
      // the same answer the default outline would give. If a helper-built block ever gains a
      // partial collision shape, this line is what says the fallback has started mattering.
      {
        const known = new Set();
        for (const l of readFileSync(join(MCLITE_ROOT, 'tools', 'golden', 'canocclude-1.18.2.tsv'), 'utf8')
          .split('\n')) {
          if (!l || l[0] === '#' || l.startsWith('block\t')) continue;
          known.add(l.split('\t')[0]);
        }
        const unknown = [], stray = [];
        for (let b = 0; b < R.blockCount; b++) {
          if (SR.outlineFull[b] !== 255) continue;
          unknown.push(R.names[b]);
          if (known.has(R.names[b])) stray.push(R.names[b]);
        }
        // ⚠ THE FALLBACK IS ONLY ACCEPTABLE IF IT NEVER RUNS FOR A BLOCK THE REFEREE COULD HAVE
        // ANSWERED. A block the jar HAS, whose outline came back unknown, means the class walk
        // failed and the fallback is quietly deciding — that is the failure this asserts away.
        ok(stray.length === 0,
           stray.length + ' blocks are in the referee table yet came back with an unknown outline: '
           + stray.slice(0, 8).join(' '));
        // ⚠⚠ **AND THE REST ARE BLOCKS VANILLA 1.18.2 DOES NOT HAVE.** `item_frame` and
        // `glow_item_frame` are ENTITIES in this version; they are in this engine's roster
        // because the roster is built from the third-party dataset, which still lists them. That
        // is a real finding about the roster and it is NAMED here rather than filtered away.
        console.log('   ' + unknown.length + ' roster blocks are absent from the jar\'s Blocks ' +
                    'class entirely: ' + unknown.join(' '));
        ok(unknown.length < 5,
           unknown.length + ' roster blocks are not in the jar at all — that is more than the ' +
           'two item frames and wants looking at');
      }
    }

    // ═══════════ 5. anti-vacuity ═══════════════════════════════════════════════════════════
    console.log('\n 5. anti-vacuity: break each rule and the break must show');
    {
      const saveRule = SR.rule[SR.stateOf('rail') | 0];
      const s0 = SR.stateOf('rail') | 0;
      SR.rule[s0] = 0;
      okAv(M.World.setBlock(1, 12, 1, s0) === true,
           'with the rail rule switched off it floats again, so section 4 was measuring the rule');
      M.World.setBlock(1, 12, 1, 0);
      SR.rule[s0] = saveRule;
      okAv(M.World.setBlock(1, 12, 1, s0) === false, 'and putting it back refuses it again');

      const cr = SR.CENTER_RECT.slice();
      SR.CENTER_RECT[0] = 0; SR.CENTER_RECT[1] = 0; SR.CENTER_RECT[2] = 1024; SR.CENTER_RECT[3] = 1024;
      okAv(SR.faceSturdy(fen, 2, SR.SUPPORT_CENTER) === false,
           'widening CENTER to the whole face stops a fence passing it');
      SR.CENTER_RECT[0] = cr[0]; SR.CENTER_RECT[1] = cr[1]; SR.CENTER_RECT[2] = cr[2]; SR.CENTER_RECT[3] = cr[3];
      okAv(SR.faceSturdy(fen, 2, SR.SUPPORT_CENTER) === true, 'and putting it back lets it pass again');

      const sb = SR.soulSandBlock;
      SR.soulSandBlock = -1;
      okAv(SR.faceSturdy(ss, 2, SR.SUPPORT_RIGID) === false,
           'without the support-shape override soul sand stops being rigid — the override is load-bearing');
      SR.soulSandBlock = sb;
      okAv(SR.faceSturdy(ss, 2, SR.SUPPORT_RIGID) === true, 'and with it back, it is rigid again');
    }
  }
}

// ═══════════ 5b. anti-vacuity for D-349: break the SECOND level and it must show ═══════════
//
// ⚠ A BREAK THAT CANNOT FIRE IS NOT A BREAK. Each of these removes one table the new rules
// stand on and asserts that a build which was legal a line earlier becomes illegal — or the
// reverse, where the table is what REFUSES something. Both directions appear, because a table
// that only ever says no would pass a one-directional break while doing nothing.
console.log('\n 5b. anti-vacuity: break the ground table, the tags and the two material tables');
{
  const ST = (n) => SR.stateOf(n) | 0;
  const wipe = () => {
    for (let dx = -2; dx <= 2; dx++) for (let dy = -2; dy <= 3; dy++) {
      for (let dz = -2; dz <= 2; dz++) M.World.setBlock(dx, 20 + dy, dz, 0);
    }
  };
  const put = (cells, what) => {
    wipe();
    for (const [dx, dy, dz, n] of cells) M.World.setBlock(dx, 20 + dy, dz, ST(n));
    const r = M.World.setBlock(0, 20, 0, ST(what));
    M.World.setBlock(0, 20, 0, 0);
    return r;
  };

  // ── the GROUND table: without it the whole family collapses back to one rule ────────────
  {
    const wart = SR.block[ST('nether_wart')];
    const keep = SR.ground[wart];
    okAv(put([[0, -1, 0, 'grass_block']], 'nether_wart') === false,
         'nether wart is refused on grass while its ground rule is in place');
    SR.ground[wart] = 1;                       // the BASE bush rule: dirt or farmland
    okAv(put([[0, -1, 0, 'grass_block']], 'nether_wart') === true,
         'and with its ground rule flattened to the family base it plants on GRASS — the second '
         + 'level is what refuses it');
    SR.ground[wart] = keep;
    okAv(put([[0, -1, 0, 'grass_block']], 'nether_wart') === false,
         'and putting the ground rule back refuses it again');
  }

  // ── the TAGS: eight rules ask one, and an absent payload answers "no" to all of them ────
  {
    const dirtCol = M.Tags.blockTag('dirt');
    const grass = SR.block[ST('grass_block')];
    okAv(put([[0, -1, 0, 'grass_block']], 'dandelion') === true,
         'a dandelion plants on grass while the dirt tag holds it');
    const stride = M.Tags.blockBitsBytes / R.blockCount;
    const bits = M.Tags.blockBits ? null : null;   // not exposed; flip via the state table instead
    // ⚠ THE TAG BITSET IS PRIVATE, so the break is made where the rule READS it: `stateIn` is
    // the one door, and replacing it is the same break with none of the reaching-in.
    const realStateIn = M.Tags.stateIn;
    M.Tags.stateIn = function (n) { return n === 'dirt' ? false : realStateIn.apply(M.Tags, arguments); };
    okAv(put([[0, -1, 0, 'grass_block']], 'dandelion') === false,
         'and with the dirt tag answering no, it will not plant on grass — the tag is what allows it');
    M.Tags.stateIn = realStateIn;
    okAv(put([[0, -1, 0, 'grass_block']], 'dandelion') === true,
         'and with the tag back it plants again');
    void dirtCol; void grass; void stride; void bits;
  }

  // ── `Material.ICE`: the table that tells ice from packed ice ────────────────────────────
  {
    const ice = SR.block[ST('ice')];
    okAv(put([[0, -1, 0, 'ice']], 'lily_pad') === true, 'a lily pad floats on ice while iceMat says so');
    SR.iceMat[ice] = 0;
    okAv(put([[0, -1, 0, 'ice']], 'lily_pad') === false,
         'and with ICE removed from the material table it will not — the material is what floats it');
    SR.iceMat[ice] = 1;
    okAv(put([[0, -1, 0, 'ice']], 'lily_pad') === true, 'and with it back it floats again');
  }

  // ── `Material.isSolid`: D-349's own bug, made to reappear ───────────────────────────────
  // ⚠ THIS BREAK IS THE BUG THIS SESSION FIXED. The cactus rule read a per-STATE table with a
  // BLOCK index; flipping the entry it should read is what proves it reads that one now.
  {
    const web = SR.block[ST('cobweb')];
    okAv(put([[0, -1, 0, 'sand'], [1, 0, 0, 'cobweb']], 'cactus') === false,
         'a cactus is refused beside a cobweb while the material table calls it solid');
    SR.solidMat[web] = 0;
    okAv(put([[0, -1, 0, 'sand'], [1, 0, 0, 'cobweb']], 'cactus') === true,
         'and with the cobweb made non-solid the cactus is allowed — the MATERIAL is what refuses it');
    SR.solidMat[web] = 1;
    okAv(put([[0, -1, 0, 'sand'], [1, 0, 0, 'cobweb']], 'cactus') === false,
         'and with it back it is refused again');
  }

  // ── THE ESCAPE ITSELF: a rule that CANNOT be answered must say so, not say no ───────────
  // ⚠⚠ **THIS BREAK IS A BUG `fuzzcheck` FOUND AND THIS FILE DID NOT** (D-351). `02f_tags.js` is
  // optional and main-thread-only; a check that does not ask for it gets an engine with no tag
  // registry, and the first draft of `tagBelow` answered "no" there — so every tag rule refused
  // EVERYTHING, and a correct rule denied its data looked exactly like a broken one. The answer
  // is -1, "no opinion", which falls through to the material-derived class the build always had.
  {
    const realReady = M.Tags.ready;
    okAv(put([[0, -1, 0, 'grass_block']], 'dandelion') === true,
         'a dandelion plants on grass while the tag registry is loaded');
    M.Tags.ready = false;
    okAv(M.World.surviveRule(0, 20, 0, ST('dandelion'), SR.rule[ST('dandelion')]) === -1,
         'with the tag registry gone the rule answers -1 — it cannot tell, rather than saying no');
    okAv(put([[0, -1, 0, 'grass_block']], 'dandelion') === true,
         'and the placement still works, falling through to the material class');
    M.Tags.ready = realReady;
  }

  // ── a NAMED block: kelp's magma clause ──────────────────────────────────────────────────
  {
    const keep = M.World.BID.magma_block;
    okAv(put([[0, -1, 0, 'magma_block']], 'kelp') === false,
         'kelp refuses magma while the block is named');
    M.World.BID.magma_block = -1;
    okAv(put([[0, -1, 0, 'magma_block']], 'kelp') === true,
         'and with the name unresolved it grows on magma — an unresolved name is a rule that '
         + 'never fires, which is why every one of them is in a list');
    M.World.BID.magma_block = keep;
    okAv(put([[0, -1, 0, 'magma_block']], 'kelp') === false, 'and with the name back it refuses again');
  }
}

console.log('\n==============================================================================');
console.log(` supportcheck: ${pass} assertions, ${fails.length} failed, ${breaks} breaks`);
for (const f of fails) console.log('   x ' + f);
process.exit(fails.length ? 1 : 0);
