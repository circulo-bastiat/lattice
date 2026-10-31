#!/usr/bin/env node
// scoreboardcheck.mjs — G26f (#251): Scoreboard substrate. Score ops/sort vs ScoreboardPlayerScore.COMPARATOR,
// teams, the ScoreboardCriterion name set (read from .decomp), slots, save round trip, and the sidebar layout
// (InGameHud.renderScoreboardSidebar). Every block is repeated against a broken engine (anti-vacuity, D-30).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, initRegistry, MCLITE_ROOT } from './loadsrc.mjs';

const M = loadEngine({ extra: ['07zzo2_scoreboard.js', '15k3_scoreboardhud.js'], dom: false });
initRegistry(M);
const SB = M.Scoreboard, SH = M.ScoreboardHud;
let pass = 0, breaks = 0; const fails = [];

// vanilla criterion names: the string literals in ScoreboardCriterion.java
const jsrc = readFileSync(join(MCLITE_ROOT, '.decomp/net/minecraft/scoreboard/ScoreboardCriterion.java'), 'utf8');
const vanilla = new Set([...jsrc.matchAll(/new ScoreboardCriterion\("([^"]+)"/g)].map(m => m[1]));
for (const c of ['black','dark_blue','dark_green','dark_aqua','dark_red','dark_purple','gold','gray','dark_gray','blue','green','aqua','red','light_purple','yellow','white'])
  { vanilla.add('teamkill.' + c); vanilla.add('killedByTeam.' + c); }

const tw = (s) => String(s).length * 6;

function suite() {
  const bad = [];
  const chk = (c, m) => { if (c) pass++; else bad.push(m); };
  SB.reset();
  const o = SB.add('k', 'dummy', 'Kills');
  chk(SB.add('k', 'dummy') === null, 'duplicate objective refused');
  SB.setScore('bob', o, 5); SB.setScore('Amy', o, 5); SB.setScore('zed', o, 9); SB.setScore('lo', o, -2);
  const order = SB.allScores(o).map(e => e.name).join(',');
  chk(order === 'lo,bob,Amy,zed', 'COMPARATOR order lo,bob,Amy,zed got ' + order);
  chk(SB.getScore('nobody', o) === null && SB.getScore('zed', o) === 9, 'get score');
  SB.resetScore('zed', o);
  chk(SB.getScore('zed', o) === null, 'reset removes');
  const missing = [...vanilla].filter(n => !SB.isCriterion(n));
  chk(missing.length === 0, 'criteria missing: ' + missing.join(','));
  chk(SB.criterionDefault('health') === 'hearts' && SB.criterionDefault('dummy') === 'integer', 'default render types');
  const t = SB.addTeam('red'); t.color = 'red'; t.prefix = '[R] ';
  SB.joinTeam('bob', t);
  chk(SB.teamOf('bob') === t && SB.addTeam('red') === null, 'team join / duplicate');
  SB.joinTeam('bob', SB.addTeam('blue'));
  chk(t.members.length === 0, 'join moves out of old team');
  SB.setSlot(1, o);
  chk(SH.sidebarObjective('nobody') === o, 'sidebar default slot');
  const o2 = SB.add('r', 'dummy', 'Red'); SB.setSlot(3 + 12, o2); SB.joinTeam('Amy', t);
  chk(SH.sidebarObjective('Amy') === o2 && SH.sidebarObjective('bob') === o, 'team colour slot');
  SB.setScore('#hidden', o, 1);
  const L = SH.layout(o, 400, 200, tw);
  chk(L.rows.length === 3 && !L.rows.some(r => r.name[0] === '#'), 'hidden # holders skipped');
  chk(L.rows[0].name === 'lo' && L.rows[0].y > L.rows[2].y, 'lowest score drawn at the bottom');
  chk(L.rows[2].y - 9 === L.titleY, 'title sits above the top row');
  chk(L.rows.find(r => r.name === 'Amy').label === '[R] Amy', 'team prefix decorates the name');
  for (let i = 0; i < 20; i++) SB.setScore('p' + String(i).padStart(2, '0'), o, 100 + i);
  chk(SH.layout(o, 400, 200, tw).rows.length === 15, '15 row cap');
  SB.setSlot(2, o);
  chk(SH.belowNameText('p03') === '103 Kills' && SH.belowNameText('ghost') === null, 'belowName text');
  const j = JSON.parse(JSON.stringify(SB.toJSON())); SB.fromJSON(j);
  chk(!!(SB.get('k') && SB.getScore('p05', SB.get('k')) === 105 && SB.teamOf('Amy') && SB.objectiveForSlot(1) === SB.get('k')), 'save round trip');
  return bad;
}
const clean = suite();
const mutations = {
  'sort reversed': () => { const f = SB.allScores; SB.allScores = (o) => f(o).reverse(); return () => { SB.allScores = f; }; },
  'criteria dropped': () => { const f = SB.isCriterion; SB.isCriterion = () => false; return () => { SB.isCriterion = f; }; },
  'persistence dropped': () => { const f = SB.toJSON; SB.toJSON = () => ({}); return () => { SB.toJSON = f; }; },
  'reset no-op': () => { const f = SB.resetScore; SB.resetScore = () => {}; return () => { SB.resetScore = f; }; },
  'team slot ignored': () => { const f = SH.sidebarObjective; SH.sidebarObjective = () => SB.objectiveForSlot(1); return () => { SH.sidebarObjective = f; }; },
  'row cap removed': () => { const f = SB.allScores; SB.allScores = (o) => f(o).concat(Array.from({ length: 5 }, (_, i) => ({ name: 'x' + i, score: 1000 + i }))); return () => { SB.allScores = f; }; },
};
for (const [name, mut] of Object.entries(mutations)) {
  const undo = mut(); const r = suite(); undo();
  if (r.length) breaks++; else fails.push('anti-vacuity: mutation "' + name + '" not caught');
}
fails.push(...clean);
if (fails.length) { console.log(fails.join('\n')); console.log(`scoreboardcheck FAIL (${fails.length})`); process.exit(1); }
console.log(`scoreboardcheck: ${pass} checks ok, ${breaks} breaks caught`);
