// supportrule.mjs — which survival rule each block obeys. ONE copy, two callers (D-346).
//
// ⚠ WHY IT IS A MODULE. `tools/gen-data.mjs` needs this table for the browser and
// `tools/loadsrc.mjs` needs the same table for every headless check. Written twice it is two
// tables that can disagree, and the disagreement would look like "the rule works in the game and
// not in the check", which is the most expensive shape of bug this project has (D-164, D-314).
//
// ⚠ THE SPLIT OF RESPONSIBILITY. `tools/golden/cansurvive-1.18.2.tsv` says which of vanilla's 55
// `canSurvive` overrides owns each of the 898 blocks — that is READ from the bytecode. The list
// below says which of those owners the ENGINE implements — that is a decision, and it is here, in
// one place, in the open. A block under an owner that is not named here gets rule 0 and keeps
// exactly the behaviour it had before, and is COUNTED as owed rather than quietly missing.
//
// ⚠ THE OWNERS ARE NAMED BY A REPRESENTATIVE BLOCK, NOT BY THEIR OBFUSCATED CLASS. `cdg` is this
// jar's name for the rail family and the next version will call it something else; "the class
// that owns `rail`" is true for ever. A pinned obfuscated name is a constant that rots.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

/** [rule id, the block whose owner class this rule is, what the rule reads] */
export const SUPPORT_RULES = [
  // ⚠ A RULE MAY NAME SEVERAL REPRESENTATIVES, because vanilla gives the same rule to families
  // that do not share a class. A repeater's `canSurvive` is byte-for-byte a rail's; a sign's is a
  // banner's; a candle cake's is too. One rule id, several owner classes, and the referee table
  // is what proves they really are the same rule rather than three that happen to look alike.
  [1, 'rail',                 'a RIGID face below'],
  [1, 'repeater',             'a RIGID face below — the same method body as a rail'],
  [2, 'stone_pressure_plate', 'a RIGID face below, or a supported centre'],
  [3, 'snow',                 'not ice/packed_ice/barrier; honey or soul sand always; else a FULL face below, or 8 layers of snow'],
  [4, 'cactus',               'no solid horizontal neighbour, no lava beside, cactus/sand/red_sand below, no liquid above'],
  [5, 'lever',                'a FULL face on whatever it is attached to'],
  [6, 'oak_door',             'lower half: a FULL face below. upper half: the same door below'],
  [7, 'white_carpet',         'anything but air below'],
  [8, 'candle',               'a supported CENTRE below — the same question a torch asks'],
  [9, 'brain_coral',          'a FULL face below'],
  [10, 'brain_coral_wall_fan', 'a FULL face on the block behind it'],
  [11, 'white_banner',        'a SOLID material below (vanilla Material.isSolid, not a shape)'],
  [11, 'oak_sign',            'a SOLID material below — the same body as a banner'],
  [11, 'candle_cake',         'a SOLID material below — the same body again'],
  [12, 'white_wall_banner',   'a SOLID material on the block behind it'],
  [12, 'oak_wall_sign',       'a SOLID material behind — the same body as a wall banner'],

  // ── D-349: the remaining 96 blocks. ⚠ A THIRD OF THEM ARE RULES THAT ALREADY EXISTED, and
  // saying so here is the whole value of naming rules by a representative block: the referee
  // proves the bodies really are identical rather than merely similar.
  [8,  'torch',               'a supported CENTRE below — byte for byte a candle'],
  [10, 'wall_torch',          'a FULL face behind — byte for byte a coral wall fan'],
  [10, 'redstone_wall_torch', 'a FULL face behind — it calls wall_torch own body'],
  [10, 'ladder',              'a FULL face behind — the same body again'],
  [10, 'tripwire_hook',       'a FULL face behind, and the facing must be horizontal'],
  [10, 'amethyst_cluster',    'a FULL face behind — the same body, with a SIX-way facing'],
  [11, 'cake',                'a SOLID material below — the same body as a banner'],

  [13, 'dandelion',           'the block GROUND rule, asked of the cell below'],
  [13, 'sea_pickle',          'the same body — its ground rule is the interesting half'],
  [13, 'small_dripleaf',      'the same body again'],
  [15, 'wheat',               'light 8, or open sky, AND the ground rule'],
  [16, 'tall_grass',          'upper: its own lower half below. lower: the ground rule'],
  [16, 'tall_seagrass',       'the same body, over the seagrass ground rule'],
  [17, 'grindstone',          'always — it OVERRIDES the button rule with an unconditional true'],
  [18, 'soul_fire',           'a #soul_fire_base_blocks below'],
  [19, 'redstone_wire',       'a FULL face below, or a hopper by name'],
  [20, 'farmland',            'the cell ABOVE: not a solid material, or a fence gate, or a moving piston'],
  [21, 'dirt_path',           'the cell ABOVE: not a solid material, or a fence gate'],
  [22, 'sugar_cane',          'itself below, or sand/#dirt with water beside THE CELL BELOW'],
  [23, 'cocoa',               'a #jungle_logs in the direction it FACES — not the opposite'],
  [24, 'bamboo',              'a #bamboo_plantable_on below'],
  [24, 'bamboo_sapling',      'a #bamboo_plantable_on below — the same body'],
  [25, 'bubble_column',       'itself, magma_block or soul_sand below'],
  [26, 'hanging_roots',       'a FULL face on the underside of the block above'],
  [27, 'spore_blossom',       'a supported CENTRE above, and its own cell is not water'],
  [28, 'big_dripleaf',        'itself, its stem, or a #big_dripleaf_placeable below'],
  [29, 'big_dripleaf_stem',   'a stem or tag below AND a stem or head above'],
  [30, 'pointed_dripstone',   'the cell it grows FROM, or another segment pointing the same way'],
  [31, 'bell',                'the cell its ATTACHMENT names — ceiling, floor or the wall it faces'],
  [32, 'piston_head',         'its own piston base, extended, facing the same way'],
  [40, 'fire',                'a FULL face below, or ANY of the six neighbours catches fire'],
  [14, 'brown_mushroom',     'a #mushroom_grow_block below, or darkness and a floor that renders solid'],
  [33, 'lantern',             'a supported CENTRE above it when hanging, below it when standing'],
  [34, 'kelp',                'the cell BEHIND the growth direction: its head, its body, or a FULL face'],
  [35, 'vine',                'every attached face still full, at least one, vine-under-vine allowed'],
  [36, 'glow_lichen',         'every attached face still full, at least one — no vine fallback'],
  [37, 'chorus_plant',        'a horizontal neighbour over chorus/end_stone, or chorus/end_stone below'],
  [38, 'chorus_flower',       'chorus/end_stone below, or air below and EXACTLY one chorus beside'],
  [39, 'scaffolding',         'a support distance under seven'],
];

/**
 * [ground rule id, the block whose mayPlaceOn owner this is, what it reads]
 *
 * ⚠⚠ **THE SECOND LEVEL, AND THE REASON THE BUSH FAMILY IS NOT ONE RULE** (D-348). The biggest
 * `canSurvive` owner decides NOTHING: its body is "fetch the state below and ask `mayPlaceOn`",
 * and `mayPlaceOn` is overridden seventeen times under it. Treating its 52 blocks as one rule
 * would let a player plant NETHER WART ON GRASS and a LILY PAD ON STONE.
 *
 * ⚠ SAME CONVENTION AS `SUPPORT_RULES` ABOVE: named by a REPRESENTATIVE BLOCK, never by the
 * jar's obfuscated class, and several representatives may share one id when vanilla gives them
 * byte-for-byte the same body.
 */
export const GROUND_RULES = [
  [1,  'dandelion',          'the #dirt tag, or farmland'],
  [2,  'azalea',             'clay, or the base rule'],
  [3,  'crimson_fungus',     '#nylium, mycelium, soul_soil, or the base rule'],
  [4,  'crimson_roots',      '#nylium, soul_soil, or the base rule'],
  [4,  'nether_sprouts',     '#nylium, soul_soil, or the base rule — the same body'],
  [5,  'nether_wart',        'soul_sand, and nothing else'],
  [6,  'wheat',              'farmland'],
  [6,  'melon_stem',         'farmland — the same body'],
  [6,  'attached_melon_stem','farmland — the same body again'],
  [7,  'dead_bush',          'sand, red_sand, the seventeen terracottas, or the #dirt tag'],
  [8,  'seagrass',           'a FULL face up below, and the block below is NOT magma_block'],
  [8,  'tall_seagrass',      'a FULL face up below, not magma_block — the same body'],
  [9,  'lily_pad',           'no fluid in its own cell, and water or the ICE material below'],
  [10, 'wither_rose',        'the base rule, or netherrack, soul_sand or soul_soil'],
  [11, 'brown_mushroom',     'a face below that renders solid'],
  [12, 'sea_pickle',         'the face below is not empty, or it is sturdy'],
  [13, 'small_dripleaf',     'the #small_dripleaf_placeable tag, or water in its cell and the base rule'],
];

/**
 * @param assets  the assets directory, for `block-registry.json` (the roster IS the id order)
 * @returns { rule: number[] by block id, owed: number, ruled: number, byRule: Map }
 */
export function supportRuleTable(assets) {
  const tsv = join(ROOT, 'tools', 'golden', 'cansurvive-1.18.2.tsv');
  const rows = readFileSync(tsv, 'utf8').split('\n').filter((l) => l && l[0] !== '#');
  const ownerOfBlock = new Map();
  for (const line of rows) {
    const f = line.split('\t');
    if (f[0] !== 'owner') continue;
    for (const n of (f[3] || '').split(' ').filter(Boolean)) ownerOfBlock.set(n, f[1]);
  }
  if (!ownerOfBlock.size) throw new Error('cansurvive table has no owner rows');

  const ruleOfOwner = new Map();
  for (const [id, rep] of SUPPORT_RULES) {
    const o = ownerOfBlock.get(rep);
    if (!o) throw new Error('cansurvive table has no owner for the representative block ' + rep);
    // ⚠ TWO RULES MAY NOT CLAIM ONE OWNER — that would mean one class with two survival rules,
    // which is a mistake in this list, not a fact about the jar. Two owners sharing a rule id is
    // fine and expected: a repeater's body is a rail's.
    if (ruleOfOwner.has(o) && ruleOfOwner.get(o) !== id) {
      throw new Error('owner class ' + o + ' is claimed by rules ' + ruleOfOwner.get(o) + ' and ' + id);
    }
    ruleOfOwner.set(o, id);
  }

  // ⚠ THE ROSTER ORDER IS THE REGISTRY'S, because that is the order the runtime's block ids are
  // in. Building this from any other list gives a table that is right about every block and
  // attached to the wrong ones.
  const roster = Object.values(JSON.parse(readFileSync(join(assets, 'block-registry.json'), 'utf8')))
    .map((b) => b.name);
  let owed = 0, ruled = 0;
  const byRule = new Map();
  const rule = roster.map((n) => {
    const o = ownerOfBlock.get(n);
    if (!o) return 0;
    const r = ruleOfOwner.get(o);
    if (r === undefined) { owed++; return 0; }
    ruled++;
    if (!byRule.has(r)) byRule.set(r, []);
    byRule.get(r).push(n);
    return r;
  });
  // ⚠ AND `Material.isSolid` PER BLOCK, from the materials table's fourth column (D-346). Three
  // of vanilla's rules — the standing banner, the standing sign, the candle cake — read the
  // MATERIAL of the block below, not its shape, and nothing else in this engine carried it.
  // ⚠ IT IS NOT "has a collision box": COBWEB is solid and has no collider, and a LADDER is not
  // solid though it has one. That is the whole reason it has to come from the jar.
  const solid = roster.map(() => 1);
  try {
    const mt = readFileSync(join(ROOT, 'tools', 'golden', 'block-materials-1.18.2.tsv'), 'utf8')
      .split('\n').filter((l) => l && l[0] !== '#');
    const byName = new Map();
    for (const l of mt) { const f = l.split('\t'); if (f.length >= 4) byName.set(f[0], Number(f[3]) ? 1 : 0); }
    if (byName.size) roster.forEach((n, i) => { if (byName.has(n)) solid[i] = byName.get(n); });
  } catch { /* an older materials table with no solid column: everything stays solid */ }


  // ── the GROUND table: which mayPlaceOn each block obeys ───────────────────────────────────
  // ⚠ Same join, same shape, same "0 means owed" convention as `rule` above. A block with a
  // ground owner the engine has not implemented keeps rule 0 and is COUNTED, never silent.
  const groundOfBlock = new Map();
  for (const line of rows) {
    const f = line.split('\t');
    if (f[0] !== 'ground') continue;
    for (const n of (f[3] || '').split(' ').filter(Boolean)) groundOfBlock.set(n, f[1]);
  }
  if (!groundOfBlock.size) throw new Error('cansurvive table has no ground rows — re-run extract-support');
  const gruleOfOwner = new Map();
  for (const [id, rep] of GROUND_RULES) {
    const o = groundOfBlock.get(rep);
    if (!o) throw new Error('cansurvive table has no ground owner for the representative block ' + rep);
    if (gruleOfOwner.has(o) && gruleOfOwner.get(o) !== id) {
      throw new Error('ground owner ' + o + ' is claimed by rules ' + gruleOfOwner.get(o) + ' and ' + id);
    }
    gruleOfOwner.set(o, id);
  }
  let groundOwed = 0, grounded = 0;
  const byGround = new Map();
  const ground = roster.map((n) => {
    const o = groundOfBlock.get(n);
    if (!o) return 0;
    const g = gruleOfOwner.get(o);
    if (g === undefined) { groundOwed++; return 0; }
    grounded++;
    if (!byGround.has(g)) byGround.set(g, []);
    byGround.get(g).push(n);
    return g;
  });

  // ⚠ THE MATERIAL `ICE`, ANCHORED ON THE BLOCK `ice` AND NOT ON A LETTER. The lily pad's rule
  // asks whether the block below has vanilla's `Material.ICE`, and the materials table spells
  // materials with per-jar letters that mean nothing on their own. "The material the block `ice`
  // has" is true for ever; 'H' is true for this jar. ⚠ It is NOT every icy block: packed_ice and
  // blue_ice are ICE_SOLID, a different material, and a lily pad does not float on them.
  const iceMat = roster.map(() => 0);
  try {
    const mt = readFileSync(join(ROOT, 'tools', 'golden', 'block-materials-1.18.2.tsv'), 'utf8')
      .split('\n').filter((l) => l && l[0] !== '#');
    const matOf = new Map();
    for (const l of mt) { const f = l.split('\t'); if (f.length >= 2) matOf.set(f[0], f[1]); }
    const ICE = matOf.get('ice');
    if (ICE) roster.forEach((n, i) => { iceMat[i] = matOf.get(n) === ICE ? 1 : 0; });
  } catch { /* no materials table: no block claims the ICE material, and rule 9 asks water only */ }

  // ⚠ D-350 — vanilla's `canOcclude` and whether the block keeps vanilla's DEFAULT outline
  // shape, both out of the jar. The mushroom rule's `isSolidRender` is the one reader, and the
  // outline column is there because soul sand overrides its COLLISION shape and not its outline:
  // a full-cube test over this engine's collision boxes refuses a mushroom on soul sand, which
  // vanilla allows.
  const occlude = roster.map(() => 1);
  const outlineFull = roster.map(() => -1);
  try {
    const ot = readFileSync(join(ROOT, 'tools', 'golden', 'canocclude-1.18.2.tsv'), 'utf8')
      .split('\n').filter((l) => l && l[0] !== '#' && !l.startsWith('block\t'));
    const occOf = new Map(), outOf = new Map();
    for (const l of ot) {
      const f = l.split('\t');
      if (f.length >= 3) { occOf.set(f[0], Number(f[1])); outOf.set(f[0], Number(f[2])); }
    }
    if (occOf.size) {
      roster.forEach((n, i) => {
        if (occOf.has(n)) { occlude[i] = occOf.get(n); outlineFull[i] = outOf.get(n); }
      });
    }
  } catch { /* no occlusion table: every block occludes and no outline is known */ }

  // ⚠ D-352 — vanilla's IGNITE ODDS per block, out of `FireBlock.bootStrap`'s 140 registration
  // calls. Fire's `canSurvive` is "a sturdy face below, OR any of the six neighbours is
  // flammable", and flammable is not a material, a tag or a shape: it is this integer.
  const ignite = roster.map(() => 0), burn = roster.map(() => 0);
  try {
    const ft = readFileSync(join(ROOT, 'tools', 'golden', 'flammable-1.18.2.tsv'), 'utf8')
      .split('\n').filter((l) => l && l[0] !== '#' && !l.startsWith('block\t'));
    const igOf = new Map(), buOf = new Map();
    for (const l of ft) { const f = l.split('\t'); if (f.length >= 3) { igOf.set(f[0], Number(f[1])); buOf.set(f[0], Number(f[2])); } }
    // the SECOND int is FireBlock's burn odds — `checkBurnOut`'s chance a neighbour is consumed
    if (igOf.size) roster.forEach((n, i) => { if (igOf.has(n)) { ignite[i] = igOf.get(n); burn[i] = buOf.get(n); } });
  } catch { /* no flammable table: nothing catches, and fire needs a sturdy face below */ }

  return { rule, owed, ruled, byRule, roster, solid, ground, groundOwed, grounded, byGround,
           iceMat, occlude, outlineFull, ignite, burn };
}
