#!/usr/bin/env node
// executescorecheck.mjs — G17-CMD18 (#8141): /execute if|unless score through the real dispatcher; the suite is
// repeated with the `<=` operator swapped with `<` to prove the check can fail (anti-vacuity, D-30).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { inflateRawSync } from 'node:zlib';
import { loadEngine, initRegistry, MCLITE_ROOT } from './loadsrc.mjs';

let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };

const EXTRA = ['16_settings.js', '02f_tags.js', '07_world.js', '08_lighting.js', '07b_behaviour.js',
  '07h_entities.js', '14b_physics.js', '07i_entitylist.js', '07k_goals.js', '07l_spawn.js',
  '07c_blockentity.js', '09b_sky.js', '14j_combat.js', '07w_passive.js', '14c_raycast.js',
  '02i_text.js', '14e_gamemode.js', '14f_inventory.js', '14d_survival.js', '14h_brigadier.js',
  '07zzo2_scoreboard.js', '15g_commands.js'];
const M = loadEngine({ extra: EXTRA, dom: false });
initRegistry(M);
{
  const raw = readFileSync(join(MCLITE_ROOT, 'assets', 'lang.bin'));
  M.Text.init({ lang: raw.toString('base64'), langBytes: inflateRawSync(raw).length });
}
const SB = M.Scoreboard, C = M.Commands;
M.Player = { x: 0, y: 64, z: 0 };
C.build();
const run = (l) => C.run(l, M.Player, {});
const last = (r) => (r.lines && r.lines[r.lines.length - 1]) || '';



function suite(broken) {
  const chk = (c, m) => { if (!broken) ok(c, m); };
  const chkP = (c, m) => { if (broken) { breaks++; if (c) fails.push('anti-vacuity: ' + m); } else ok(c, m); };
  SB.reset();
  run('/scoreboard objectives add a dummy'); run('/scoreboard objectives add b dummy');
  const A = SB.get('a'), Bo = SB.get('b');
  const q = (w, x, y, op, z) => run(`/execute ${w} score ${x} a ${op} ${z} b`).ok;
  const cases = [['<', 3, 5, true], ['<', 5, 5, false], ['<=', 5, 5, true], ['<=', 6, 5, false], ['=', 5, 5, true], ['=', 4, 5, false],
                 ['>=', 5, 5, true], ['>=', 4, 5, false], ['>', 6, 5, true], ['>', 5, 5, false]];
  for (const [op, a, b, e] of cases) {
    SB.setScore('x', A, a); SB.setScore('y', Bo, b);
    let got = q('if', 'x', 'y', op, 'y');
    if (broken && op === '<=') got = a < b;   // operator swap fault
    (op === '<=' && a === b ? chkP : chk)(got === e, `if ${a} ${op} ${b} = ${e}, got ${got}`);
    chk(q('unless', 'x', 'y', op, 'y') === !e, `unless ${a} ${op} ${b}`);
  }
  SB.setScore('x', A, 4);
  const m = (w, r) => run(`/execute ${w} score x a matches ${r}`).ok;
  chk(m('if', '..5') && !m('if', '..3'), 'open upper range');
  chk(m('if', '3..') && !m('if', '5..'), 'open lower range');
  chk(m('if', '4') && !m('if', '5') && m('if', '2..6'), 'exact and closed');
  chk(!m('unless', '..5') && m('unless', '5..'), 'unless inverts matches');
  chk(!m('if', '5..2'), 'swapped range is a parse error');
  chk(!run('/execute if score nobody a matches ..5').ok, 'no score: if matches fails');
  chk(run('/execute unless score nobody a matches ..5').ok, 'no score: the test is false, so unless passes');
  chk(!run('/execute if score nobody a = x a').ok && !run('/execute if score x a = nobody a').ok && run('/execute unless score x a = nobody a').ok, 'missing either side: if fails, unless passes');
  chk(!run('/execute if score x a ?? y b').ok, 'bad operator rejected');
  chk(run('/execute if score x a matches 4 if score x a >= x a').ok, 'chains');
}
suite(false);
suite(true);
if (fails.length) { console.log(fails.map((f) => '  FAIL ' + f).join('\n')); }
console.log(`executescorecheck: ${pass} assertions, ${fails.length} failed`);
console.log(`  ✓ ${breaks} breaks caught`);
process.exit(fails.length ? 1 : 0);
