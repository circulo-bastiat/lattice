#!/usr/bin/env node
// lockstep-mobdeath -- #9217 (MOBPROOF-DAMAGE-3, part of #9203): death and drops, the 'mobdeath' lane (a 1-HP burning zombie). Engine trace
// (lockstep/mobdeathlane.mjs) over 20 salts: it must die at the first ON_FIRE tick and its loot (rotten_flesh 0-2, rare iron/carrot/potato) must
// vary with the salt. With MCLITE_LOCKSTEP_SERVER=1 each salt is also run on the real 1.18.2 server (run.mjs runLane mob 'mobdeath') and the item
// spawn tick + Pos compared exact; the pilot (--lanes mobdeath) is the repeatability gate. Feeds tools/mobproof/out/damage-death.json.
import { engineDeathTrace } from './referee/lockstep/mobdeathlane.mjs';
import { T } from './referee/chasescen.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

let bad = 0, breaks = 0, n = 0;
const ok = (c, m) => { n++; if (!c) { bad++; console.log('FAIL ' + m); } };
const caught = (c, m) => { n++; if (c) breaks++; else { bad++; console.log('NOT CAUGHT ' + m); } };
const SALTS = process.env.MCLITE_LOCKSTEP_SALTS ? process.env.MCLITE_LOCKSTEP_SALTS.split(',').map(Number) : Array.from({ length: 20 }, (_, i) => i);
const FLOOR = -60;   // runchase's lane floor y
const traces = SALTS.map((s) => engineDeathTrace(s));
traces.forEach((t, i) => { ok(t.rows.length === T, `salt ${SALTS[i]}: rows`); ok(t.diedAt !== null && t.diedAt <= 21, `salt ${SALTS[i]}: zombie did not burn to death (${t.diedAt})`); });
ok(traces.some((t) => t.ent.itemTick.length > 0) && traces.some((t) => t.ent.itemTick.length === 0), 'drops never vary with the salt');
ok(traces.every((t) => t.ent.itemTick.every((k) => k === t.diedAt)), 'an item spawned off the death tick');
const sig = (t) => JSON.stringify([t.ent.itemTick, t.ent.itemPos]);
ok(sig(engineDeathTrace(SALTS[0])) === sig(traces[0]), 'same salt, same drops');
const drop = traces.find((t) => t.ent.itemTick.length);
const bent = (f) => { const e = JSON.parse(JSON.stringify(drop.ent)); f(e); return JSON.stringify([e.itemTick, e.itemPos]) !== sig(drop); };
caught(bent((e) => { e.itemTick[0]++; }), 'drop one tick late');
caught(bent((e) => { e.itemPos[0][1] += 1e-9; }), 'drop pos 1e-9');
caught(bent((e) => { e.itemTick.length = 0; e.itemPos.length = 0; }), 'drop lost');

const failed = [];
if (process.env.MCLITE_LOCKSTEP_SERVER) {
  const { buildAgent, runLane } = await import('./referee/lockstep/run.mjs');
  const { mkdtempSync } = await import('node:fs'), { tmpdir } = await import('node:os');
  const agent = buildAgent(mkdtempSync(join(tmpdir(), 'mobdeath-agent-')));
  SALTS.forEach((s, i) => {
    const c = runLane({ mob: 'mobdeath', salt: s, agent, tag: 'md', full: true }), v = c.ent[0], e = traces[i].ent;
    const sp = v.itemPos.map(([x, y, z]) => [x, y - FLOOR, z]);
    if (JSON.stringify([v.itemTick, sp]) !== JSON.stringify([e.itemTick, e.itemPos])) { failed.push(`salt ${s}: server ${JSON.stringify([v.itemTick, sp])} engine ${JSON.stringify([e.itemTick, e.itemPos])}`); console.log('DIVERGENCE ' + failed.at(-1)); }
    else console.log(`mobdeath salt ${s}: identical`);
  });
}
const dir = join(dirname(fileURLToPath(import.meta.url)), 'mobproof', 'out'); mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, 'damage-death.json'), JSON.stringify({ zombie: { pass: !bad && !failed.length, checked: ['death tick (ON_FIRE kills a 1-HP mob)', 'loot drop: item spawn tick + Pos, salted draws'], failed: bad || failed.length ? ['see lockstep-mobdeath'] : [] } }));
console.log(`${n} assertions, ${bad} failures, ${breaks} breaks caught (${SALTS.length} salts)`);
process.exit(bad || failed.length ? 1 : 0);
