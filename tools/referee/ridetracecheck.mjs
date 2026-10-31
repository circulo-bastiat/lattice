// #6264: lockstep vehicle/passengers/seat. A chicken jockey (Undead.mountJockey): seat + passenger order match the server rows each tick; swapping two passengers diverges on 'passengers'.
import { loadEngine } from '../loadsrc.mjs';
import { serverRow, engineRow, compareTraces } from './lockstep/trace.mjs';
let bad = 0, n = 0; const ok = (c, m) => { n++; if (!c) { bad++; console.log('FAIL ' + m); } };
const M = loadEngine({ extra: ['07s_raid.js', '07zk_undead.js'] });
const chicken = { id: 'c1', type: 'chicken', x: 0, y: 64, z: 0, height: 0.7, yBodyRot: 0 };
const zomb = { id: 'z1', type: 'zombie', growAge: -1, x: 0, y: 64, z: 0 };
ok(M.Undead.mountJockey(zomb, chicken), 'mountJockey');
const F = { fields: ['vehicle', 'passengers', 'seat'] };
const E = [], S = [];
for (let t = 0; t < 5; t++) {
  M.Undead.placePassenger(chicken, zomb);
  E.push(engineRow(t, zomb)); E.push(engineRow(t, chicken)); E.splice(-2, 2, E[E.length - 2]);
  const seat = zomb.y - chicken.y;
  S.push(serverRow(t, { Passengers: [] }, { vehicle: 'c1', seat }));
}
ok(E[0].vehicle === 'c1' && Math.abs(E[0].seat - 0.35) < 1e-9, 'jockey seat = 0.7*0.5 + 0');
ok(compareTraces(S, E, F) === null, 'rider rows match');
const C = [engineRow(0, chicken)], CS = [serverRow(0, { Passengers: ['z1'] })];
ok(chicken.passenger === zomb && compareTraces(CS, C, F) === null, 'vehicle row lists passenger');
let caught = 0;
const two = { id: 'v', passengers: [{ id: 'a' }, { id: 'b' }], x: 0, y: 0, z: 0 };
const d = compareTraces([serverRow(0, { Passengers: ['b', 'a'] })], [engineRow(0, two)], F);
if (d && d.field === 'passengers') caught++; else ok(false, 'passenger swap not caught');
const d2 = compareTraces([serverRow(0, {}, { vehicle: 'c1', seat: 0.5 })], [E[0]], F);
if (d2 && d2.field === 'seat') caught++; else ok(false, 'seat change not caught');
console.log(`${n} assertions, ${bad} failures, ${caught} breaks caught`);
if (bad) process.exit(1);
