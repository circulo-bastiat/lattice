#!/usr/bin/env node
// strongholdspawnercheck.mjs — #855: the stronghold portal-room spawner carries silverfish
// (vanilla StrongholdGenerator.PortalRoom: spawner.setEntityId(SILVERFISH)). Run in the bare WORKER
// bundle, so the id must arrive through Gen.spawnerLog -> genColumn().spawners.
//
//   node tools/strongholdspawnercheck.mjs
import { loadEngine } from './loadsrc.mjs';

let pass = 0; const fails = []; let breaks = 0;
const ok = (c, m) => { if (c) pass++; else fails.push(m); return c; };
const okAv = (c, m) => { if (ok(c, 'anti-vacuity: ' + m)) { breaks++; console.log('  ✓ break caught: ' + m); } };
console.log('strongholdspawnercheck -- #855, portal-room spawner is a silverfish spawner');

const SEED = 20260924;
const WK = loadEngine({});
WK.Gen.init(SEED, Object.assign(WK.Gen.defaults(), { climate: 'vanilla', features: true }));
const ST = WK.Structures;
const pl = ST.sets.find((x) => x.name === 'strongholds').placement;
const ring = ST.ringPositions(pl);
const SP = WK.States.stateOf('spawner');

// the first stronghold whose start we can read
let start = null;
for (let i = 0; i < ring.length && !start; i += 2) {
  for (let dz = -8; dz <= 8 && !start; dz++) for (let dx = -8; dx <= 8 && !start; dx++) {
    for (const s of ST.startsNear(ring[i] + dx, ring[i + 1] + dz)) if (s.def.name === 'stronghold') { start = s; break; }
  }
}
ok(!!start, 'found a stronghold start');
const room = start && start.pieces.find((p) => p.mob !== undefined);
ok(!!room, 'exactly one piece names a spawner mob (the portal room)');
ok(start && start.pieces.filter((p) => p.mob).length === 1, 'only the portal room names a mob');
ok(room && room.mob === 'silverfish', 'the portal room names silverfish');

function spawnersOver(p) {
  const out = [];
  for (let cx = p.x0 >> 4; cx <= p.x1 >> 4; cx++) for (let cz = p.z0 >> 4; cz <= p.z1 >> 4; cz++) {
    const col = WK.Gen.genColumn(cx, cz);
    for (const s of col.spawners || []) out.push(s.slice());
  }
  return out;
}
if (room) {
  const got = spawnersOver(room).filter((s) => s[0] >= room.x0 && s[0] <= room.x1 && s[2] >= room.z0 && s[2] <= room.z1);
  ok(got.length === 1 && got[0][3] === 'silverfish', `worker genColumn logs one silverfish spawner in the portal room (${JSON.stringify(got)})`);
  // ---- anti-vacuity: strip the mob from the piece and regenerate; the record must vanish
  const saved = room.mob; room.mob = undefined;
  const cut = spawnersOver(room).filter((s) => s[0] >= room.x0 && s[0] <= room.x1 && s[2] >= room.z0 && s[2] <= room.z1);
  okAv(cut.length === 0, 'with the piece\'s mob removed no silverfish spawner is recorded');
  room.mob = saved;
}
for (const f of fails) console.log('  ✗ ' + f);
console.log(`strongholdspawnercheck: ${pass} assertions, ${fails.length} failures, ${breaks} breaks caught`);
process.exit(fails.length ? 1 : 0);
