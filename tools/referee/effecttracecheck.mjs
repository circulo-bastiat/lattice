// #6260: trace field 'effects' = [[id, amplifier, duration]] sorted by id; server ActiveEffects vs NS.Effects e.effects. Cave spider bite poison, tick by tick; off-by-one duration must diverge at the bite tick.
import { loadEngine } from '../loadsrc.mjs';
import { serverRow, engineRow, compareTraces } from './lockstep/trace.mjs';
let bad = 0, n = 0; const ok = (c, m) => { n++; if (!c) { bad++; console.log('FAIL ' + m); } };
const M = loadEngine({ extra: ['07q_effects.js'] });
const ES = M.Effects || M.EffectStore || M.ES;
ok(ES && ES.IDS && ES.instance, 'effect store loaded');
const ids = ES.IDS, F = { fields: ['effects'] };
// cave spider bite: poison 7s on normal (140), 15s on hard (300); amplifier 0
const run = (dur, serverDur) => {
  const e = { type: 'player', effects: {} };
  ES.addInstance(e, ES.instance('poison', dur, 0));
  const S = [], E = [];
  for (let t = 0; t < 5; t++) {
    S.push(serverRow(t, { ActiveEffects: [{ Id: ids.poison, Amplifier: 0, Duration: serverDur - t }, { Id: ids.slowness || 2, Amplifier: 0, Duration: 9 }].slice(0, 1) }));
    E.push(engineRow(t, e, { effectIds: ids }));
    ES.tick(e);
  }
  const c = compareTraces(S, E, F); if (c && process.env.DBG) console.log(JSON.stringify(c), JSON.stringify(E[0].effects)); return c;
};
for (const d of [140, 300]) ok(run(d, d) === null, 'poison ' + d + ' matches tick by tick');
let caught = 0;
const r = run(139, 140);
if (r && r.tick === 0 && r.field === 'effects') caught++; else ok(false, 'off-by-one duration not caught at bite tick');
const r2 = serverRow(0, { ActiveEffects: [{ Id: 19, Amplifier: 1, Duration: 5 }] });
const e2 = { type: 'player', effects: {} }; ES.addInstance(e2, ES.instance('poison', 5, 0));
if (compareTraces([r2], [engineRow(0, e2, { effectIds: ids })], F)) caught++; else ok(false, 'amplifier diff not caught');
console.log(`${n} assertions, ${bad} failures, ${caught} breaks caught`);
if (bad) process.exit(1);
