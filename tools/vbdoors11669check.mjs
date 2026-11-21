#!/usr/bin/env node
// vbdoors11669check -- #11669: proves 07zv9_vbdoors.js (OpenDoorsTask) is reached from 07zv_villagerbrain.js
// (VBDoors.tick in the villager tick) and that cutting each rule changes the outcome. '<n> breaks caught'.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const rd = (f) => readFileSync(join(ROOT, 'src', f), 'utf8');
let fails = 0; const ok = (c, m) => { if (!c) { fails++; console.log('FAIL ' + m); } };
ok(/NS\.VBDoors\.tick\(e, tnow\)/.test(rd('07zv_villagerbrain.js')), 'reach: villager brain ticks VBDoors');
function scenario(edit) {
  const doors = {}; const key = (x, y, z) => x + ',' + y + ',' + z;
  const NS = { EntityList: { list: [] }, Ai: {
    doorAt(x, y, z) { return doors[key(x, y, z)] || null; },
    setDoorOpen(x, y, z, o) { doors[key(x, y, z)].closed = !o; } } };
  let s = rd('07zv9_vbdoors.js');
  if (edit) { if (!s.includes(edit[0])) throw new Error('edit target missing'); s = s.replace(edit[0], edit[1]); }
  new Function('MCL', s)(NS);
  const V = NS.VBDoors, out = {};
  const P = (x) => ({ x, y: 64, z: 0 });
  const mk = (o) => Object.assign({ type: 'villager', x: 0.5, y: 64, z: 0.5, vbWander: { running: true, idx: 1, path: [P(0), P(1), P(5)] } }, o);
  doors['1,64,0'] = { wood: true, closed: true }; doors['0,64,0'] = { wood: true, iron: true, closed: true };
  const a = mk({});
  V.tick(a, 1); out.opened = doors['1,64,0'].closed; out.can = a.canOpenDoors; out.rem = (a.vbDoorsToClose || []).length;
  out.ticks = a.vbDoorTicks;
  doors['1,64,0'].closed = true; V.tick(a, 2); out.ticks2 = a.vbDoorTicks; out.held = doors['1,64,0'].closed;
  // iron door never opened
  const b = mk({ vbWander: { running: true, idx: 1, path: [P(1), P(0), P(5)] } }); doors['1,64,0'].closed = true;
  V.tick(b, 1); out.iron = doors['0,64,0'].closed;
  // move on: door behind, villager within 2 -> closed again
  const c = mk({ x: 1.5 }); doors['1,64,0'].closed = false; c.vbDoorsToClose = [P(1)];
  c.vbWander.idx = 2; c.vbWander.path = [P(0), P(3), P(4)]; c.x = 2.5; V.tick(c, 1); out.closed = doors['1,64,0'].closed; out.left = c.vbDoorsToClose.length;
  // far away: forgotten, stays open
  const d = mk({ x: 40.5 }); doors['1,64,0'].closed = false; d.vbDoorsToClose = [P(1)];
  d.vbWander.idx = 2; d.vbWander.path = [P(0), P(3), P(4)]; V.tick(d, 1); out.far = doors['1,64,0'].closed; out.farLeft = d.vbDoorsToClose.length;
  // other villager at door keeps it open
  const e = mk({ x: 2.5 }); const o = mk({ x: 1.5, vbWander: { running: true, idx: 1, path: [P(0), P(1), P(2)] } });
  doors['1,64,0'].closed = false; e.vbDoorsToClose = [P(1)]; e.vbWander.idx = 2; e.vbWander.path = [P(0), P(3), P(4)];
  NS.EntityList.list = [e, o]; V.tick(e, 1); out.other = doors['1,64,0'].closed; NS.EntityList.list = [];
  // no path: still closes behind
  const f = mk({ x: 2.5, vbWander: null }); doors['1,64,0'].closed = false; f.vbDoorsToClose = [P(1)]; V.tick(f, 1); out.nopath = doors['1,64,0'].closed;
  return JSON.stringify(out);
}
const base = scenario(); const o = JSON.parse(base);
ok(o.opened === false && o.can === true && o.rem === 1 && o.ticks === 20, 'opens wooden door ahead and remembers');
ok(o.ticks2 === 19 && o.held === true, 'cadence counts down'); ok(o.iron === true, 'iron door stays shut');
ok(o.closed === true && o.left === 0, 'closes door behind'); ok(o.far === false && o.farLeft === 0, 'far: forgotten');
ok(o.other === false, 'other villager holds door'); ok(o.nopath === true, 'closes without path');
const breaks = [
  ['d && d.wood && !d.iron ? d : null', 'd ? d : null'],
  ['if (d.closed) { NS.Ai.setDoorOpen(n.x, n.y, n.z, true); remember(e, n); }', 'if (d.closed) { NS.Ai.setDoorOpen(n.x, n.y, n.z, true); }'],
  ['dx * dx + dy * dy + dz * dz < 4', 'true'],
  ['if (reached(e, p, last, cur)) continue;', ''],
  ['if (VBD.otherAtDoor(e, p)) continue;', ''],
  ['e.vbDoorTicks = 20;', 'e.vbDoorTicks = 5;'],
  ['if (e.vbDoorTicks !== 0) return;', ''],
  ['if (!near(e, p)) continue;', ''],
  ['if (!path || w.idx <= 0 || w.idx >= path.length) { VBD.closeBehind(e, null, null); return; }', 'if (!path || w.idx <= 0 || w.idx >= path.length) return;'],
  ['e.canOpenDoors = true;', ''],
].map((b) => [b, b[0]]);
let caught = 0;
for (const [ed, name] of breaks) {
  let got; try { got = scenario(ed); } catch (e) { got = 'throw'; }
  if (got !== base) caught++; else { fails++; console.log('NOT CAUGHT ' + name); }
}
console.log(`vbdoors11669check -- ${fails ? fails + ' FAIL' : 'ok'}; ${caught} breaks caught`);
process.exit(fails || caught !== breaks.length ? 1 : 0);
