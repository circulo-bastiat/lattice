#!/usr/bin/env node
// lockstep/goldenapplecompare.mjs -- #9265: the real 1.18.2 server vs the engine for the 'goldenapple' lane, per salt, per tick, 'entities' + 'pos'-free.
// Server: runLane({mob:'goldenapple'}) (the agent feeds the apple at tick call GOLD_FEED); engine: engineGoldenAppleTrace with the timer the server drew (see goldenapplelane.timerOf).
//   node tools/referee/lockstep/goldenapplecompare.mjs [--from 0] [--seeds 20] [--budget-min 8]   (server rep0 per salt is cached in $TMPDIR; prints {"golden":"partial"} until all are done)
import { mkdtempSync, existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'; import { tmpdir } from 'os'; import { join } from 'path';
import { buildAgent, runLane, GOLD_FEED } from './run.mjs';
import { engineGoldenAppleTrace, timerOf } from './goldenapplelane.mjs';
import { compareTraces } from './trace.mjs';
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const FROM = +arg('--from', 0), N = +arg('--seeds', 20), BUDGET = +arg('--budget-min', 8) * 6e4, t0 = Date.now();
const cache = join(tmpdir(), 'goldenapple-server'); mkdirSync(cache, { recursive: true });
let agent = null;
const div = [];
let done = 0;
for (let salt = FROM; salt < FROM + N; salt++) {
  const f = join(cache, `s${salt}-${GOLD_FEED}.json`);
  if (!existsSync(f)) {
    if (Date.now() - t0 > BUDGET) continue;
    agent = agent || buildAgent(mkdtempSync(join(tmpdir(), 'ga-agent-')));
    const reps = JSON.parse(runLane({ mob: 'goldenapple', salt, agent, tag: 'ga' }));
    if (!reps.every((r) => JSON.stringify(r) === JSON.stringify(reps[0]))) { console.log(JSON.stringify({ unstable: salt })); continue; }
    writeFileSync(f, JSON.stringify(reps[0]));
  }
  const S = JSON.parse(readFileSync(f, 'utf8')), timer = timerOf(S);
  const A = S.map((r, tick) => ({ tick, entities: r })), B = engineGoldenAppleTrace(salt, GOLD_FEED, { timer }).map((r) => ({ tick: r.tick, entities: r.entities.map(([t, , c, fx]) => [t, 0, c, fx]) }));
  const d = compareTraces(A, B, { fields: ['entities'] });
  done++;
  if (d) div.push({ salt, tick: d.tick, field: d.field, server: d.a, engine: d.b });
}
console.log(JSON.stringify({ divergences: div, compared: done, of: N }));
console.log(JSON.stringify({ golden: done + 0 >= N - 0 && existsSync(join(cache, `s${FROM + N - 1}-${GOLD_FEED}.json`)) && Array.from({ length: N }, (_, i) => existsSync(join(cache, `s${FROM + i}-${GOLD_FEED}.json`))).every(Boolean) ? 'done' : 'partial' }));
