#!/usr/bin/env node
// spawnfloorcheck.mjs — #1161: land animals in the ocean. SpawnHelper.canSpawn(ON_GROUND) asks the
// floor (`below.allowsSpawning`) itself, so EVERY on_ground type is refused over water / air / a
// non-solid floor, whatever its own rule says (ocelot's rule is a bare nextInt(3) and was placed
// over open water). Measured over every Spawn.LOCATION on_ground type and every rnd draw.
//
//   node tools/spawnfloorcheck.mjs [--verbose]
import { loadEngine, initRegistry } from './loadsrc.mjs';

let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); return c; };
const okAv = (c, m) => { breaks++; ok(c, 'anti-vacuity: ' + m); if (c) console.log('   ✓ ' + m); };
console.log('spawnfloorcheck — #1161, ON_GROUND floor (allowsSpawning) for every on_ground type');

const EXTRA = ['02f_tags.js', '07_world.js', '07b_behaviour.js', '07h_entities.js', '14b_physics.js',
  '07i_entitylist.js', '07k_goals.js', '07l_spawn.js', '09b_sky.js', '07zf_bat.js', '07zi_squid.js'];
const M = loadEngine({ extra: EXTRA, dom: false });
initRegistry(M);
const { World: W, Spawn, States: S } = M;
W.init(1); M.Behave.init(W); Spawn.init();
for (let cx = -1; cx <= 1; cx++) for (let cz = -1; cz <= 1; cz++) {
  const c = W.makeChunk(cx, cz); c.state = M.CH.GENERATED; W.chunks.set(W.key(cx, cz), c);
}
const st = (n) => S.stateOf(n) | 0;
const types = Object.keys(Spawn.RULES).filter((t) => Spawn.locationOf(t) === 'on_ground');
ok(types.length > 20, 'on_ground types found: ' + types.length);

// floor cell y=63, stand cell y=64 (+65 clear). Every floor that is not a solid top must refuse every type.
function placesAny(floor, rnds) {
  const bad = [];
  W.setBlock(3, 63, 3, floor); W.setBlock(3, 64, 3, 0); W.setBlock(3, 65, 3, 0);
  for (const t of types) for (const r of rnds) if (Spawn.checkPlacement(t, 3, 64, 3, 'natural', () => r)) { bad.push(t); break; }
  return bad;
}
const RND = [0, 1, 2];
for (const f of ['water', 'air', 'glass', 'oak_slab', 'lava', 'kelp', 'seagrass', 'short_grass'].filter((n) => n === 'air' || st(n) > 0)) {
  const bad = placesAny(f === 'air' ? 0 : st(f), RND);
  ok(bad.length === 0, `no on_ground type is placed over ${f}: ${bad.join(',')}`);
}
// the control: over stone at least the generic hostile rule is reachable on the same harness's own terms
W.setBlock(3, 63, 3, st('grass_block'));
ok(Spawn.checkPlacement('ocelot', 3, 64, 3, 'natural', () => 1) || !Spawn.locationOk('on_ground', 3, 64, 3),
  'control: ocelot over grass is not refused by the floor half');
ok(Spawn.floorAllows('ocelot', 3, 64, 3), 'floorAllows: grass floor accepted');
// anti-vacuity: break the floor and the class shows up
{
  const real = Spawn.floorAllows; Spawn.floorAllows = () => true;
  okAv(placesAny(st('water'), RND).length > 0, 'floor half disabled -> a type placed over water is caught');
  Spawn.floorAllows = real;
  okAv(placesAny(st('water'), RND).length === 0, 'restored floor -> clean again');
  const rc = Spawn.CLEAR_CHECK; Spawn.CLEAR_CHECK = false;
  okAv(placesAny(st('water'), RND).length > 0, 'CLEAR_CHECK off -> caught');
  Spawn.CLEAR_CHECK = rc;
}
if (fails.length) { console.log(fails.map((f) => '  ✗ ' + f).join('\n')); process.exit(1); }
console.log(`   checks: ${pass} assertions, 0 failed, ${breaks} breaks caught`);
console.log(`OK    ${pass} assertions · ${breaks} breaks caught`);
