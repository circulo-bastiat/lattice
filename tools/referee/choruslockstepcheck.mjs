// choruslockstepcheck.mjs -- #6725 (G17-L129): lockstep scenario 'chorus', 20 salts: a scripted player eats chorus fruit in a plain+cave+pool arena.
// Reference = ChorusFruitItem.finishUsing (.decomp): 16 tries of x=(nextDouble-.5)*16, y=clamp(y+nextInt(16)-8), z=(nextDouble-.5)*16, requestTeleport
// (walk down to solid floor, no fluid in the box, no collision), two sounds on success, fallDistance 0, cooldown 20. Written independently of Enderman.teleportBox.
import { loadEngine } from '../loadsrc.mjs';
import { compareTraces } from './lockstep/trace.mjs';
const M = loadEngine({ extra: ['02f_tags.js', '02g_items.js', '07_world.js', '07h_entities.js', '14b_physics.js', '07zg_enderman.js', '14l_use.js'], dom: false, initReg: true });
const S = M.States, stone = S.stateOf('stone'), water = S.stateOf('water');
const cells = new Map(), key = (x, y, z) => x + ',' + y + ',' + z;
const get = (x, y, z) => cells.get(key(x, y, z)) || 0;
M.World = Object.assign(M.World || {}, { getBlock: get, get, BOTTOM_Y: -64 });
M.Physics.shapeAt = (x, y, z) => { const id = get(Math.floor(x), Math.floor(y), Math.floor(z)); return id === stone ? M.Physics.shapesFor(id) : null; };
let fails = 0, breaks = 0;
const ok = (c, m) => { if (!c) { fails++; console.log('  FAIL ' + m); } };
const stream = (salt) => { let s = (salt * 2654435761 + 12345) >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; };
function buildArena() {
  cells.clear();
  for (let x = -20; x <= 20; x++) for (let z = -20; z <= 20; z++) {
    for (let y = -6; y <= -1; y++) cells.set(key(x, y, z), stone);
    if (x > 2 && x < 9 && z > -6 && z < 0) { for (let y = -1; y >= 0; y--) cells.delete(key(x, y, z)); cells.set(key(x, -1, z), water); }   // pool
    if (x < -3 && z > 3) for (let y = 0; y <= 6; y++) cells.set(key(x, y, z), stone);                                                        // solid hill
    if (x < -3 && z > 3 && x > -9 && z < 10) for (let y = 1; y <= 3; y++) cells.delete(key(x, y, z));                                      // cave inside it
  }
}
const solid = (x, y, z) => get(x, y, z) === stone;
function ref(salt, ticks, range) {
  const r = stream(salt), out = [], draws = { n: 0 };
  const d = () => { draws.n++; return r(); };
  let p = { x: 0.5, y: 0, z: 0.5 }, cd = 0, fall = 5;
  for (let t = 1; t <= ticks; t++) {
    let snd = 0, moved = 0;
    if (t % 25 === 1 && cd === 0) {
      fall = 7; const ox = p.x, oy = p.y, oz = p.z;
      for (let i = 0; i < 16; i++) {
        const x = p.x + (d() - 0.5) * range, y = Math.min(Math.max(p.y + Math.floor(d() * 16) - 8, -64), 255), z = p.z + (d() - 0.5) * range;
        let by = Math.floor(y); const by0 = by, bx = Math.floor(x), bz = Math.floor(z);
        while (by > -64 && !solid(bx, by - 1, bz)) by--;
        if (!solid(bx, by - 1, bz)) continue;
        const ey = y - (by0 - by); let bad = false;
        for (let ix = Math.floor(x - 0.3); ix <= Math.floor(x + 0.3 - 1e-7); ix++) for (let iy = Math.floor(ey); iy <= Math.floor(ey + 1.8 - 1e-7); iy++) for (let iz = Math.floor(z - 0.3); iz <= Math.floor(z + 0.3 - 1e-7); iz++)
          if (get(ix, iy, iz) === water || solid(ix, iy, iz)) bad = true;
        if (bad) continue;
        p = { x, y: ey, z }; fall = 0; snd = 2; moved = 1; void ox; void oy; void oz; break;
      }
      cd = 20;
    }
    out.push({ tick: t, pos: [p.x, p.y, p.z], moved, snd, cd, fall, draws: draws.n });
    if (cd > 0) cd--;
  }
  return out;
}
function eng(salt, ticks) {
  buildArena();
  const r = stream(salt); let n = 0; const rr = () => { n++; return r(); };
  const P = { x: 0.5, y: 0, z: 0.5, width: 0.6, height: 1.8, fallDistance: 5, itemCooldowns: {} };
  let snd = 0; M.Sound = { play: () => { snd++; return true; } };
  const out = [];
  for (let t = 1; t <= ticks; t++) {
    snd = 0; const before = P.x + ',' + P.y + ',' + P.z;
    if (t % 25 === 1 && !(P.itemCooldowns.chorus_fruit > 0)) { P.fallDistance = 7; M.Use.chorusTeleport(P, rr); }
    out.push({ tick: t, pos: [P.x, P.y, P.z], moved: before !== P.x + ',' + P.y + ',' + P.z ? 1 : 0, snd, cd: P.itemCooldowns.chorus_fruit || 0, fall: P.fallDistance, draws: n });
    M.Use.tickItemCooldowns(P);
  }
  return out;
}
const FL = { fields: ['pos', 'goals'] };
const run = (range) => Array.from({ length: 20 }, (_, salt) => {
  buildArena();
  const a = ref(salt, 150, range), b = eng(salt, 150);
  const f = (x) => ({ tick: x.tick, pos: x.pos, goals: [[x.moved, 'm'], [x.snd, 's'], [x.cd, 'cd'], [x.fall, 'f'], [x.draws, 'draws']] });
  return { salt, d: compareTraces(a.map(f), b.map(f), FL), moves: a.filter((x) => x.moved).length };
});
const res = run(16);
ok(res.every((r) => !r.d), 'chorus lane: ' + res.filter((r) => r.d).slice(0, 3).map((r) => `salt ${r.salt} tick ${r.d.tick} ${r.d.field} ${r.d.a} vs ${r.d.b}`));
ok(res.reduce((a, r) => a + r.moves, 0) > 20, 'salts actually teleport');
const brk = (c, m) => { if (c) { breaks++; console.log('   ✓ break caught: ' + m); } else { fails++; console.log('  ✗ break NOT caught: ' + m); } };
brk(run(15).some((r) => r.d), 'range 15 instead of 16 is reported');
console.log(`choruslockstepcheck: ${2 + breaks} assertions, ${fails} failures, ${breaks} breaks caught`);
process.exit(fails ? 1 : 0);
