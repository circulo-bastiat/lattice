// #6263: lockstep compares EFFECTIVE attributes (modifiers applied). A baby zombie is 0.23*1.5=0.345; dropping the modifier must fail.
import { serverRow, engineRow, compareTraces } from './lockstep/trace.mjs';
let bad = 0, n = 0; const ok = (c, m) => { n++; if (!c) { bad++; console.log('FAIL ' + m); } };
const mv = (mods) => ({ Attributes: [{ Name: 'minecraft:generic.movement_speed', Base: 0.23, Modifiers: mods }] });
const baby = [{ Name: 'Baby speed boost', Amount: 0.5, Operation: 1 }];
const spr = [{ Name: 'Sprinting speed boost', Amount: 0.3, Operation: 2 }];
const S = [serverRow(0, mv(baby)), serverRow(1, mv(baby.concat(spr))), serverRow(2, mv([]))];
ok(S[0].attributesEff.movement_speed === 0.23 * 1.5, 'baby = 0.23*1.5');
ok(S[0].attributes.movement_speed === 0.23, 'base stays 0.23');
ok(S[1].attributesEff.movement_speed === 0.23 * 1.5 * 1.3, 'baby + sprint');
const mk = (vals) => vals.map((v, t) => engineRow(t, {}, { attributesEff: { movement_speed: v } }));
const good = [0.23 * 1.5, 0.23 * 1.5 * 1.3, 0.23];
ok(compareTraces(S, mk(good), { fields: ['attributesEff'] }) === null, 'matching traces equal');
let caught = 0;
for (const [t, v] of [[0, 0.23], [1, 0.23 * 1.5], [2, 0.23 * 1.5]]) {
  const g = good.slice(); g[t] = v;
  const d = compareTraces(S, mk(g), { fields: ['attributesEff'] });
  if (d && d.tick === t && d.field === 'attributesEff') caught++; else ok(false, 'break at ' + t + ' not caught');
}
console.log(`${n} assertions, ${bad} failures, ${caught} breaks caught`);
if (bad) process.exit(1);
