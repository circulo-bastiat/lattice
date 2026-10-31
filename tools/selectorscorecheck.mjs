#!/usr/bin/env node
// selectorscorecheck.mjs -- #8130: selector options scores={..} and team= (EntitySelectorOptions) over NS.Scoreboard.
// Anti-vacuity: the same scenario against edited sources must fail ('<n> breaks caught').
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const CMD = readFileSync(join(ROOT, 'src/15g_commands.js'), 'utf8');
function scenario(cmdSrc) {
  const NS = {};
  for (const f of ['00_ns', '01_util', '07zzo2_scoreboard', '14h_brigadier']) new Function('MCL', readFileSync(join(ROOT, `src/${f}.js`), 'utf8'))(NS);
  new Function('MCL', cmdSrc)(NS);
  const fails = [], ok = (c, m) => { if (!c) fails.push(m); };
  const SB = NS.Scoreboard;
  NS.Player = { x: 0, y: 64, z: 0 };
  NS.EntityList = { all: () => ents };
  const ents = [{ type: 'cow', uuid: 'u1', x: 0, y: 64, z: 0 }, { type: 'cow', uuid: 'u2', x: 0, y: 64, z: 0 }, { type: 'cow', uuid: 'u3', x: 0, y: 64, z: 0 }];
  const src = { name: 'Player', x: 0, y: 64, z: 0 };
  const names = (s) => NS.Commands.resolve(NS.Commands.arg.entity(false, false).parse(new NS.Brig.Reader(s, 0), src), src).map((t) => t.kind === 'player' ? 'P' : t.e.uuid).sort().join(',');
  const kills = SB.add('kills', 'dummy'), deaths = SB.add('deaths', 'dummy');
  SB.setScore('Player', kills, 5); SB.setScore('u1', kills, 2); SB.setScore('u2', kills, 3); SB.setScore('u2', deaths, 9);
  ok(names('@e[scores={kills=3..}]') === 'P,u2', 'kills=3.. -> P,u2 got ' + names('@e[scores={kills=3..}]'));
  ok(names('@e[scores={kills=..2}]') === 'u1', 'kills=..2');
  ok(names('@e[scores={kills=2}]') === 'u1', 'kills=2 exact');
  ok(names('@e[scores={kills=1..,deaths=9}]') === 'u2', 'two objectives both required');
  ok(names('@e[scores={nope=0..}]') === '', 'unknown objective matches nobody');
  const a = SB.addTeam('red'), b = SB.addTeam('blue');
  SB.joinTeam('Player', a); SB.joinTeam('u1', a); SB.joinTeam('u2', b);
  ok(names('@e[team=red]') === 'P,u1', 'team=red');
  ok(names('@e[team=!red]') === 'u2,u3', 'team=!red includes teamless');
  ok(names('@e[team=]') === 'u3', 'team= is teamless only');
  ok(names('@e[team=!]') === 'P,u1,u2', 'team=! is any team');
  ok(names('@e[team=nope]') === '', 'unknown team');
  return fails;
}
const fails = scenario(CMD);
const mut = (a, b) => { if (!CMD.includes(a)) throw new Error('anchor gone: ' + a); return CMD.replace(a, b); };
const mutants = [
  ['scores ignored', mut("if (sel.opts && sel.opts.scores) {", "if (false) {")],
  ['unscored holder passes', mut("return v !== null && (x[1].min", "return (v === null || true) && (x[1].min")],
  ['team ignored', mut("if (sel.opts && sel.opts.team) {", "if (false) {")],
  ['team negation ignored', mut("!== sel.opts.team.negated;", "=== true;")],
];
let caught = 0;
for (const [name, s] of mutants) {
  let bad; try { bad = scenario(s); } catch (e) { bad = [e.message]; }
  if (bad.length) { caught++; console.log('   ✓ broken (' + name + ') -> ' + bad[0]); } else fails.push('mutant NOT caught: ' + name);
}
if (fails.length) { console.log('selectorscorecheck: FAIL'); fails.forEach((m) => console.log('   x ' + m)); process.exit(1); }
console.log(`selectorscorecheck: 10 assertions, 0 failures, ${caught} breaks caught`);
