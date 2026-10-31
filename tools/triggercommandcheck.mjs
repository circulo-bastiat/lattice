#!/usr/bin/env node
// triggercommandcheck.mjs — G17-SB4 (#8128): /trigger through the real dispatcher; the suite is
// repeated with the re-lock removed to prove the check can fail (anti-vacuity, D-30).
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


const setLocked = SB.setLocked;
function suite(broken) {
  const chk = (c, m) => { if (!broken) ok(c, m); };
  const chkP = (c, m) => { if (broken) { breaks++; if (c) fails.push('anti-vacuity: ' + m); } else ok(c, m); };
  SB.setLocked = broken ? function (h, o, lk) { if (lk) return; return setLocked(h, o, lk); } : setLocked;
  SB.reset();
  run('/scoreboard objectives add t trigger'); run('/scoreboard objectives add d dummy');
  const T = SB.get('t');
  let r = run('/trigger t');
  chk(!r.ok && /unprimed|enabled|not.*trigger/i.test(last(r)) , 'not enabled fails: ' + last(r));
  run('/scoreboard players enable Player t');
  r = run('/trigger t'); chk(r.ok && SB.getScore('Player', T) === 1, 'simple: ' + last(r));
  r = run('/trigger t'); chkP(!r.ok, 'second attempt fails (re-locked)');
  chk(SB.getScore('Player', T) === 1, 'score unchanged after failure');
  run('/scoreboard players enable Player t');
  r = run('/trigger t add 5'); chk(r.ok && SB.getScore('Player', T) === 6, 'add: ' + last(r));
  chkP(!run('/trigger t add 5').ok, 'add re-locked');
  run('/scoreboard players enable Player t');
  r = run('/trigger t set 9'); chk(r.ok && SB.getScore('Player', T) === 9, 'set: ' + last(r));
  run('/scoreboard players enable Player t');
  chk(run('/trigger t add -4').ok && SB.getScore('Player', T) === 5, 'add negative allowed');
  r = run('/trigger d'); chk(!r.ok, 'non-trigger fails: ' + last(r));
  const lk = run('/trigger t'); chk(!lk.ok && last(lk) !== last(r), 'unprimed and invalid are different messages');
  chk(!run('/trigger nope').ok, 'unknown objective fails');
}
suite(false);
suite(true);
SB.setLocked = setLocked;
if (fails.length) { console.log(fails.map((f) => '  FAIL ' + f).join('\n')); }
console.log(`triggercommandcheck: ${pass} passed, ${fails.length} failed, ${breaks} breaks caught`);
process.exit(fails.length ? 1 : 0);
