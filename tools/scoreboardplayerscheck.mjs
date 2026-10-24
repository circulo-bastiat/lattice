#!/usr/bin/env node
// scoreboardplayerscheck.mjs — G17-SB2 (#8126): /scoreboard players through the real dispatcher; the suite is
// repeated with the `*=` operator miswired to prove the check can fail (anti-vacuity, D-30).
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
  run('/scoreboard objectives add a dummy'); run('/scoreboard objectives add b dummy'); run('/scoreboard objectives add t trigger');
  const A = SB.get('a'), Bo = SB.get('b');
  const op = (t, o, s) => { SB.setScore('x', A, t); SB.setScore('y', Bo, o); const r = run('/scoreboard players operation x a ' + s + ' y b'); return [r, SB.getScore('x', A), SB.getScore('y', Bo)]; };
  chk(last(run('/scoreboard players list')) === 'There are no tracked entities', 'list empty');
  let r = run('/scoreboard players set x a 7');
  chk(r.ok && last(r) === 'Set [a] for x to 7', 'set: ' + last(r));
  r = run('/scoreboard players add x a 5'); chk(last(r) === 'Added 5 to [a] for x (now 12)', 'add: ' + last(r));
  r = run('/scoreboard players remove x a 2'); chk(last(r) === 'Removed 2 from [a] for x (now 10)', 'remove: ' + last(r));
  r = run('/scoreboard players get x a'); chk(last(r) === 'x has 10 [a]', 'get: ' + last(r));
  chk(!run('/scoreboard players get nobody a').ok, 'get unset fails');
  chk(!run('/scoreboard players add x a -1').ok, 'add negative fails (integer(0))');
  run('/scoreboard players set y a 1');
  r = run('/scoreboard players set * a 3'); chk(/Set \[a\] for 2 entities to 3/.test(last(r)) && SB.getScore('y', A) === 3, 'set *: ' + last(r));
  r = run('/scoreboard players list'); chk(/There are 2 tracked entities: x, y/.test(last(r)), 'list: ' + last(r));
  r = run('/scoreboard players list x'); chk(r.lines.length === 2 && /x has 1 scores?:/.test(r.lines[0]) && /\[a\]: 3/.test(r.lines[1]), 'list x: ' + JSON.stringify(r.lines));
  // operators
  const T9 = [['=', 9, 4, 4], ['+=', 9, 4, 13], ['-=', 9, 4, 5], ['*=', 9, 4, 36], ['/=', 9, 4, 2], ['%=', 9, 4, 1],
              ['<', 9, 4, 4], ['>', 9, 4, 9], ['/=', -9, 4, -3], ['%=', -9, 4, 3], ['/=', 9, -4, -3], ['%=', 9, -4, -3]];
  for (const [s, x, y, e] of T9) {
    let got = op(x, y, s)[1];
    if (broken && s === '*=') got = x + y;   // the miswired operator
    (s === '*=' ? chkP : chk)(got === e, `${x} ${s} ${y} = ${e}, got ${got}`);
  }
  let sw = op(3, 8, '><'); chk(sw[1] === 8 && sw[2] === 3, 'swap');
  r = op(5, 0, '/='); chk(!r[0].ok, 'div by zero fails');
  r = op(5, 0, '%='); chk(!r[0].ok, 'mod by zero fails');
  chk(!run('/scoreboard players operation x a ?? y b').ok, 'bad operator fails');
  // enable / reset
  r = run('/scoreboard players enable x a'); chk(!r.ok, 'enable on a non-trigger fails');
  r = run('/scoreboard players enable x t'); chk(r.ok && last(r) === 'Enabled trigger [t] for x', 'enable: ' + last(r));
  chk(!run('/scoreboard players enable x t').ok, 'enable twice fails');
  r = run('/scoreboard players reset x a'); chk(SB.getScore('x', A) === null && /Reset \[a\] for x/.test(last(r)), 'reset one: ' + last(r));
  r = run('/scoreboard players reset y'); chk(SB.getScore('y', Bo) === null && SB.getScore('y', A) === null && /Reset all scores for y/.test(last(r)), 'reset all: ' + last(r));
}
suite(false);
suite(true);
if (fails.length) { console.log(fails.map((f) => '  FAIL ' + f).join('\n')); }
console.log(`scoreboardplayerscheck: ${pass} passed, ${fails.length} failed, ${breaks} breaks caught`);
process.exit(fails.length ? 1 : 0);
