// playerlanecheck.mjs -- #6349 (G17-L60): the scripted-player lane harness: script validation, server command/packet split,
// engine driver, and the per-tick player+entity comparator (pos, velocity, health).
import { validateScript, serverCommands, usePackets, logCommands, driveEngine, compareLane } from './lockstep/playerlane.mjs';
let fails = 0, breaks = 0;
const ok = (c, m) => { if (!c) { fails++; console.log('  FAIL ' + m); } };
const brk = (c, m) => { if (c) { breaks++; console.log('   ✓ break caught: ' + m); } else { fails++; console.log('  ✗ break NOT caught: ' + m); } };
const T = 20, script = [{ tick: 0, op: 'give', item: 'ender_pearl' }, { tick: 1, op: 'look', yaw: 90, pitch: -45 }, { tick: 3, op: 'use' }];
ok(validateScript(script, T).length === 0, 'good script validates');
const sc = serverCommands(script, 'bot0');
ok(sc[0][0] === 'give bot0 minecraft:ender_pearl 1' && sc[1][0] === 'tp bot0 ~ ~ ~ 90 -45' && !sc[3], 'look/give become commands, use does not');
ok(usePackets(script).join() === '3', 'use is a packet at its tick');
ok(logCommands('bot0', ['ender_pearl']).length === 4, 'log lines: player, health, entity pos+vel');
// a toy engine: pearl appears on use, flies with constant velocity; player takes 5 damage at tick 12
const mk = (vx) => { let t = 0, pearl = null; const api = {
  look() {}, give() {}, use() { pearl = { type: 'ender_pearl', x: 0, y: 1, z: 0, vx, vy: 0.1, vz: 0 }; },
  step() { t++; if (pearl) { pearl.x += pearl.vx; pearl.y += pearl.vy; } },
  snapshot: () => ({ player: { x: 0, y: 0, z: 0, health: t >= 12 ? 15 : 20 }, entities: pearl ? [{ ...pearl }] : [] }) }; return api; };
const A = driveEngine(script, T, mk(1.5)), B = driveEngine(script, T, mk(1.5));
ok(A.length === T && A[4].entities.length === 1 && A[2].entities.length === 0, 'engine rows: pearl appears after use');
ok(compareLane(A, B) === null, 'identical lanes compare equal');
const d1 = compareLane(A, driveEngine(script, T, mk(1.5000001)));
brk(d1 && d1.field === 'e0vel' && d1.tick === 3, 'a velocity drift is reported on the entity');
const d2 = compareLane(A, driveEngine([{ tick: 4, op: 'use' }], T, mk(1.5)));
brk(d2 && d2.tick === 3 && d2.field === 'nEnt', 'use one tick late: entity missing at the early tick');
const C = B.map((r) => ({ ...r, health: r.tick >= 12 ? 14 : r.health }));
brk((compareLane(A, C) || {}).field === 'health' && compareLane(A, C).tick === 12, 'player health mismatch reported at its tick');
brk((compareLane(A, B.map((r) => ({ ...r, entities: r.tick === 6 ? [] : r.entities }))) || {}).tick === 6, 'missing entity reported');
brk(validateScript([{ tick: 99, op: 'use' }, { tick: 1, op: 'dance' }], T).length === 2, 'bad script steps rejected');
console.log(`playerlanecheck: ${breaks + 6} assertions, ${fails} failures, ${breaks} breaks caught`);
process.exit(fails ? 1 : 0);
