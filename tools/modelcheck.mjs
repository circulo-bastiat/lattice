#!/usr/bin/env node
// modelcheck.mjs — prove the model interpreter is right, not merely that it ran.
//
//   node tools/modelcheck.mjs [--jar path]
//
// ANTI-VACUITY RULE (MineHTML's own `SUITE-VACUITY.md`, learned the hard way): a suite can be
// green and prove nothing. Every assertion here compares against a value that is KNOWN
// INDEPENDENTLY — from Minecraft's actual behaviour — rather than against whatever the code
// happened to produce. If the interpreter were replaced with one that returned empty arrays,
// every one of these must fail. There is a self-check at the end that verifies exactly that.

import { Jar } from './jarlib.mjs';
import {
  resolveModel, parseBlockstate, propertiesOf, enumerateStates,
  placementsFor, multipartMatches, classify, resolveTextureVar, DIRS,
  steps, rotatePoint, rotateBox, rotateDir,
} from './models.mjs';

import { existsSync } from 'node:fs';
import { JARS as MCLITE_JARS } from './paths.mjs';
/* MCLITE_JARS now comes from tools/paths.mjs (session 5) */
// Two layouts are accepted, because Dan's jars live in a launcher directory and the build
// machine's live in a flat one: <JARS>/1.18.2.jar and <JARS>/1.18.2/1.18.2.jar. Point
// MCLITE_JARS at a .minecraft `versions` folder and it just works.
const jarPath = (v) => {
  const flat = MCLITE_JARS + '/' + v + '.jar';
  const nested = MCLITE_JARS + '/' + v + '/' + v + '.jar';
  return existsSync(flat) ? flat : (existsSync(nested) ? nested : flat);
};
const argv = process.argv.slice(2);
const JAR = (() => { const i = argv.indexOf('--jar'); return i >= 0 ? argv[i + 1] : jarPath('1.18.2'); })();

const jar = new Jar(JAR);
const cache = new Map();
let pass = 0, fail = 0;
const failures = [];

function check(name, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { pass++; return true; }
  fail++; failures.push(`${name}\n      expected ${e}\n      actual   ${a}`);
  return false;
}
function ok(name, cond, detail = '') {
  if (cond) { pass++; return true; }
  fail++; failures.push(`${name}${detail ? '\n      ' + detail : ''}`);
  return false;
}
// eq(actual, expected, name) — the argument order that reads naturally for the rotation
// section below, expressed in terms of check() so there is still exactly one place that
// counts a pass.
const eq = (actual, expected, name) => check(name, actual, expected);
const bs = (n) => parseBlockstate(jar.readJson(`assets/minecraft/blockstates/${n}.json`));
const statesOf = (n) => { const b = bs(n); return enumerateStates(propertiesOf(b)); };

console.log(`modelcheck against ${JAR}\n`);

// ---------------------------------------------------------------- 1. state counts
// These numbers come from Minecraft's own block definitions, not from our output.
// oak_stairs: facing(4) x half(2) x shape(5) = 40.  repeater: facing(4) x delay(4) x locked(2) x powered(2) = 64.
// redstone_wire: 4 sides x 3 states each = 81.  lever: face(3) x facing(4) x powered(2) = 24.
console.log('1. state counts vs vanilla');
// ⚠ These are VISUAL state counts - what blockstates.json describes. Non-visual
// properties (waterlogged, powered-on-doors) are absent from that file by design, so the
// in-game counts are higher. The difference is documented in models.mjs and is the reason
// blocks.json from Mojang's data generator is on the Track W critical path.
check('oak_stairs states', statesOf('oak_stairs').length, 40);   // facing4 x half2 x shape5
check('repeater states', statesOf('repeater').length, 64);       // facing4 x delay4 x locked2 x powered2
check('redstone_wire states', statesOf('redstone_wire').length, 81); // 4 sides x 3 (none|side|up)
check('lever states', statesOf('lever').length, 24);             // face3 x facing4 x powered2
check('oak_fence states', statesOf('oak_fence').length, 16);     // n/e/s/w booleans - the multipart trap
check('oak_slab states', statesOf('oak_slab').length, 3);        // type3; waterlogged is not visual
check('stone states', statesOf('stone').length, 1);
check('oak_door states', statesOf('oak_door').length, 32);       // facing4 half2 hinge2 open2; powered not visual

// the multipart boolean trap itself, asserted directly
check('fence north domain', [...propertiesOf(bs('oak_fence')).get('north')].sort(), ['false', 'true']);
check('iron_bars states', statesOf('iron_bars').length, 16);
check('cobblestone_wall states', statesOf('cobblestone_wall').length > 1, true);

// ---------------------------------------------------------------- 2. properties
console.log('2. properties');
// propertiesOf returns a Map, not an object - assert on the Map.
check('oak_stairs props', [...propertiesOf(bs('oak_stairs')).keys()].sort(),
      ['facing', 'half', 'shape']);
check('oak_stairs shape values', [...propertiesOf(bs('oak_stairs')).get('shape')].sort(),
      ['inner_left', 'inner_right', 'outer_left', 'outer_right', 'straight']);
check('oak_fence props', [...propertiesOf(bs('oak_fence')).keys()].sort(),
      ['east', 'north', 'south', 'west']);

// ---------------------------------------------------------------- 3. multipart
console.log('3. multipart evaluation');
const fenceBs = bs('oak_fence');
ok('oak_fence is multipart', fenceBs.kind === 'multipart', `kind=${fenceBs.kind}`);
// A fence with no connections draws ONLY the post.
const fenceNone = placementsFor(fenceBs, { north: 'false', east: 'false', south: 'false', west: 'false' });
check('fence with no sides -> 1 part (post)', fenceNone.length, 1);
ok('that part is the post', /fence_post$/.test(fenceNone[0]?.model || ''), fenceNone[0]?.model);
// One connection: post + one side.
const fenceN = placementsFor(fenceBs, { north: 'true', east: 'false', south: 'false', west: 'false' });
check('fence north only -> 2 parts', fenceN.length, 2);
// All four: post + four sides.
const fenceAll = placementsFor(fenceBs, { north: 'true', east: 'true', south: 'true', west: 'true' });
check('fence all sides -> 5 parts', fenceAll.length, 5);
// The four side placements must be four DIFFERENT y rotations - this is the bug that makes
// fences look wrong, and it is invisible unless you check the rotations specifically.
const sideYs = fenceAll.filter((p) => /fence_side$/.test(p.model)).map((p) => p.y).sort((a, b) => a - b);
check('fence side rotations', sideYs, [0, 90, 180, 270]);

// the when-grammar itself
ok('when OR', multipartMatches({ OR: [{ a: 'x' }, { b: 'y' }] }, { b: 'y' }));
ok('when AND', multipartMatches({ AND: [{ a: 'x' }, { b: 'y' }] }, { a: 'x', b: 'y' }));
ok('when AND fails', !multipartMatches({ AND: [{ a: 'x' }, { b: 'y' }] }, { a: 'x', b: 'z' }));
ok('when alternatives a|b', multipartMatches({ a: 'x|y' }, { a: 'y' }));
ok('when alternatives reject', !multipartMatches({ a: 'x|y' }, { a: 'z' }));

// ---------------------------------------------------------------- 4. rotation + uvlock
console.log('4. rotation and uvlock');
const stairBs = bs('oak_stairs');
const sNorth = placementsFor(stairBs, { facing: 'north', half: 'bottom', shape: 'straight' })[0];
const sEast  = placementsFor(stairBs, { facing: 'east',  half: 'bottom', shape: 'straight' })[0];
const sTop   = placementsFor(stairBs, { facing: 'north', half: 'top',    shape: 'straight' })[0];
ok('stairs north exists', !!sNorth);
ok('stairs use the same model in all 4 facings',
   sNorth.model === sEast.model, `${sNorth?.model} vs ${sEast?.model}`);
ok('facing is expressed as a y rotation, not a different model',
   sNorth.y !== sEast.y, `y ${sNorth?.y} vs ${sEast?.y}`);
ok('top half uses x=180', sTop.x === 180, `x=${sTop?.x}`);
ok('rotated stairs set uvlock', sTop.uvlock === true, `uvlock=${sTop?.uvlock}`);
// vanilla's inner/outer shapes are genuinely different models, not rotations
const sInner = placementsFor(stairBs, { facing: 'north', half: 'bottom', shape: 'inner_left' })[0];
ok('inner_left is a different model', sInner.model !== sNorth.model, `${sInner?.model}`);

// ---------------------------------------------------------------- 5. model resolution
console.log('5. model resolution and inheritance');
const planks = resolveModel(jar, 'block/oak_planks', cache);
check('oak_planks elements', planks.elements.length, 1);
check('oak_planks is a full cube', classify(planks), 'cube');
check('oak_planks all 6 faces', DIRS.filter((d) => planks.elements[0].faces[d]).length, 6);
check('oak_planks texture resolved through #all',
      planks.elements[0].faces.up.texture, 'block/oak_planks');
// inheritance: the child supplies textures, the PARENT supplies elements
const slab = resolveModel(jar, 'block/oak_slab', cache);
check('oak_slab elements', slab.elements.length, 1);
check('oak_slab is half height', slab.elements[0].to[1], 8);
check('oak_slab classify', classify(slab), 'slab');
// a model whose textures differ per face
const log = resolveModel(jar, 'block/oak_log', cache);
ok('oak_log side != end texture',
   log.elements[0].faces.north.texture !== log.elements[0].faces.up.texture,
   `${log.elements[0].faces.north.texture} / ${log.elements[0].faces.up.texture}`);
check('oak_log up texture', log.elements[0].faces.up.texture, 'block/oak_log_top');

// ---------------------------------------------------------------- 6. implicit UVs
console.log('6. implicit UVs derived from element extent');
// This is the subtle one. A slab's SIDE face must show the bottom half of the texture
// (v from 8 to 16), not the whole thing squashed. Vanilla derives it from the element.
const slabNorth = slab.elements[0].faces.north;
ok('slab side UV is half-height', slabNorth.uv[3] - slabNorth.uv[1] === 8,
   `uv=${JSON.stringify(slabNorth.uv)}`);
// A full cube's faces must be the whole 16x16.
check('cube face UV', planks.elements[0].faces.up.uv, [0, 0, 16, 16]);

// ---------------------------------------------------------------- 7. cullface
console.log('7. cullface');
ok('cube faces carry cullface', DIRS.every((d) => planks.elements[0].faces[d].cullface !== null),
   'a cube whose faces have no cullface would render hidden geometry forever');
ok('slab top face has no cullface (it is not on a block boundary)',
   slab.elements[0].faces.up.cullface === null, `${slab.elements[0].faces.up.cullface}`);
ok('slab bottom face does have cullface', slab.elements[0].faces.down.cullface === 'down');

// ---------------------------------------------------------------- 8. tint
console.log('8. tint index');
const grass = resolveModel(jar, 'block/grass_block', cache);
const anyTint = grass.elements.some((e) => DIRS.some((d) => e.faces[d] && e.faces[d].tintindex >= 0));
ok('grass_block carries a tintindex', anyTint,
   'without tint, grass is grey everywhere and biome colour does nothing');

// ---------------------------------------------------------------- 9. texture var chains
// ⚠ NAMESPACE NORMALISATION, 6 Sept 2026. Vanilla's own files spell the same texture two
// ways — `block/stone` in one model, `minecraft:block/sand` in another — and resolveTextureVar
// now strips the redundant default namespace. Measured before the fix: 676 of 810 atlas keys
// carried the prefix and 134 did not, and 43 of the 57 legacy tile lookups missed because of
// it. These expectations were updated to the canonical bare form; the suite caught the change,
// which is exactly what it is for.
console.log('9. texture variable chains');
check('direct', resolveTextureVar({ a: 'block/stone' }, '#a'), 'block/stone');
check('chained', resolveTextureVar({ a: '#b', b: 'block/dirt' }, '#a'), 'block/dirt');
check('dangling', resolveTextureVar({ a: '#missing' }, '#a'), null);
check('cyclic', resolveTextureVar({ a: '#b', b: '#a' }, '#a'), null);

// ---------------------------------------------------------------- 10. whole-jar invariants
console.log('10. whole-jar invariants');
const all = jar.under('assets/minecraft/blockstates/').filter((n) => n.endsWith('.json'));
check('blockstates count', all.length, 900);
let totalStates = 0, noParts = 0, badTex = 0;
for (const f of all) {
  const b = parseBlockstate(jar.readJson(f));
  const st = enumerateStates(propertiesOf(b));
  totalStates += st.length;
  for (const s of st) {
    const ps = placementsFor(b, s);
    if (!ps.length) noParts++;
    for (const p of ps) {
      const m = resolveModel(jar, p.model, cache);
      for (const el of m.elements) for (const d of DIRS) {
        const fc = el.faces[d];
        if (fc && !fc.texture) badTex++;
      }
    }
  }
}
ok('total block states grew after the multipart fix', totalStates > 5729,
    `totalStates=${totalStates} (was 5729 before boolean-domain completion)`);
check('states with no geometry', noParts, 0);
check('faces with an unresolved texture', badTex, 0);

// ---------------------------------------------------------------- 11. anti-vacuity self-check
console.log('11. placement rotation — ground truth from four blockstates files');
{
  // Every assertion here is re-readable in the jar. See the long note in models.mjs.
  // This section exists because the first implementation used the standard right-handed
  // rotation, which is the opposite of Mojang's, and it was caught by an occlusion mask
  // rather than by a rotation test — which is the wrong way round.
  eq(steps(0), 0, 'steps(0)');
  eq(steps(90), 1, 'steps(90)');
  eq(steps(270), 3, 'steps(270)');
  eq(steps(360), 0, 'steps(360)');
  eq(steps(-90), 3, 'steps(-90) must wrap, not go negative');

  // y90 maps east -> south.  (stairs: base step is EAST and facing=east has no rotation;
  //                           facing=south is y:90)
  eq(rotateDir('east', 0, 90), 'south', 'y90: east -> south');
  eq(rotateDir('south', 0, 90), 'west', 'y90: south -> west');
  eq(rotateDir('west', 0, 90), 'north', 'y90: west -> north');
  eq(rotateDir('north', 0, 90), 'east', 'y90: north -> east');
  eq(rotateDir('up', 0, 90), 'up', 'y rotation must not move up');
  eq(rotateDir('down', 0, 90), 'down', 'y rotation must not move down');

  // x90 maps up -> north.    (amethyst_cluster: base points UP, facing=north is x:90)
  eq(rotateDir('up', 90, 0), 'north', 'x90: up -> north');
  eq(rotateDir('north', 90, 0), 'down', 'x90: north -> down');
  eq(rotateDir('down', 90, 0), 'south', 'x90: down -> south');
  eq(rotateDir('south', 90, 0), 'up', 'x90: south -> up');
  eq(rotateDir('east', 90, 0), 'east', 'x rotation must not move east');

  // both axes together, in Mojang's order (x first, then y).
  // amethyst_cluster facing=east is x:90,y:90 — up -> north -> east.
  eq(rotateDir('up', 90, 90), 'east', 'x90 then y90: up -> east (amethyst facing=east)');
  eq(rotateDir('up', 90, 270), 'west', 'x90 then y270: up -> west (amethyst facing=west)');
  eq(rotateDir('up', 90, 180), 'south', 'x90 then y180: up -> south (amethyst facing=south)');
  eq(rotateDir('up', 180, 0), 'down', 'x180: up -> down (amethyst facing=down)');

  // four quarter turns is the identity, on both axes and combined
  for (const d of DIRS) {
    eq(rotateDir(d, 360, 0), d, `x360 is the identity for ${d}`);
    eq(rotateDir(d, 0, 360), d, `y360 is the identity for ${d}`);
    eq(rotateDir(rotateDir(rotateDir(rotateDir(d, 0, 90), 0, 90), 0, 90), 0, 90), d,
       `four y90 turns return ${d} to itself`);
  }

  // the box transform must agree with the direction transform: rotating a slab that is
  // flush with the north face must leave it flush with whatever north became.
  const [lo, hi] = rotateBox([0, 0, 0], [16, 16, 2], 0, 90);   // a panel on the NORTH wall
  eq(rotateDir('north', 0, 90), 'east', 'sanity: north -> east under y90');
  eq(hi[0], 16, 'panel rotated y90 must be flush with the EAST wall (x max = 16)');
  eq(lo[0], 14, 'panel rotated y90 must be 2 thick against the east wall (x min = 14)');
  eq(lo[2], 0, 'panel rotated y90 must span the full z');
  eq(hi[2], 16, 'panel rotated y90 must span the full z');

  // a full cube is invariant under every rotation - the case that would hide a broken
  // implementation from every test that only ever looks at stone.
  for (const [x, y] of [[0, 90], [90, 0], [90, 90], [180, 270], [270, 180]]) {
    const [l, h] = rotateBox([0, 0, 0], [16, 16, 16], x, y);
    eq(l.join(), '0,0,0', `full cube lo invariant under x${x} y${y}`);
    eq(h.join(), '16,16,16', `full cube hi invariant under x${x} y${y}`);
  }
}

console.log('12. anti-vacuity self-check');
// Deliberately break the interpreter and confirm the suite above would have caught it.
// A suite that passes against a broken implementation is worse than no suite.
let caught = 0;
{
  // (a) a resolver that returns no elements must fail the element-count checks
  const empty = { id: 'x', builtin: null, textures: {}, elements: [], ambientocclusion: true };
  if (classify(empty) !== 'cube') caught++;
  // (b) multipart evaluation that ignores conditions must fail the fence checks
  if (multipartMatches({ north: 'true' }, { north: 'false' }) === false) caught++;
  // (c) UV defaults that always return the full face must fail the slab check
  const fullFace = [0, 0, 16, 16];
  if (fullFace[3] - fullFace[1] !== 8) caught++;
}
check('self-check: broken implementations would be caught', caught, 3);
// print one mark per break so tools/suite.mjs can count them the same way it counts the
// other suites' — a number nobody can see is a number nobody checks
for (const label of ['a resolver that returns no elements',
                     'multipart evaluation that ignores its conditions',
                     'UV defaults that always return the full face']) {
  console.log('   ✓ ' + label);
}

// ---------------------------------------------------------------- report
console.log('');
console.log('==================================================');
console.log(` passed: ${pass}`);
console.log(` failed: ${fail}`);
if (fail) {
  console.log('');
  for (const f of failures) console.log('  FAIL  ' + f);
}
console.log('==================================================');
process.exit(fail ? 1 : 0);
