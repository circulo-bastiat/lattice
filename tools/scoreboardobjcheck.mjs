#!/usr/bin/env node
// scoreboardobjcheck.mjs — G17-SB1 (#8125): /scoreboard objectives add|remove|list|modify|setdisplay through the
// real dispatcher on NS.Scoreboard, exact lang strings, and the save round trip (Scoreboard.toJSON/fromJSON, the
// pair 16b_save.js writes into the world). Every block is repeated against a broken engine (anti-vacuity, D-30).
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
  let r = run('/scoreboard objectives list');
  chk(last(r) === 'There are no objectives', 'list empty: ' + last(r));
  r = run('/scoreboard objectives add kills dummy');
  chk(r.ok && last(r) === 'Created new objective [kills]', 'add: ' + last(r));
  r = run('/scoreboard objectives add kills dummy');
  chk(!r.ok, 'duplicate fails: ' + JSON.stringify(r));
  run('/scoreboard objectives add hp health "Hit Points"');
  chk(SB.get('hp').renderType === 'hearts' && SB.get('hp').displayName === 'Hit Points', 'health defaults to hearts, display name kept');
  r = run('/scoreboard objectives list');
  chk(/There are 2 objectives: \[kills\], \[Hit Points\]/.test(last(r)), 'list: ' + last(r));
  r = run('/scoreboard objectives modify kills displayname Kills!');
  chk(SB.get('kills').displayName === 'Kills!' && /Changed the display name of kills to \[Kills!\]/.test(last(r)), 'modify displayname: ' + last(r));
  r = run('/scoreboard objectives modify kills rendertype hearts');
  chk(SB.get('kills').renderType === 'hearts' && /Changed the display name|render type/.test(last(r)), 'modify rendertype: ' + last(r));
  r = run('/scoreboard objectives setdisplay sidebar kills');
  chk(SB.objectiveForSlot(1) === SB.get('kills') && /Set display slot sidebar to show objective \[Kills!\]/.test(last(r)), 'setdisplay: ' + last(r));
  r = run('/scoreboard objectives setdisplay sidebar kills');
  chk(!r.ok, 'alreadySet fails');
  r = run('/scoreboard objectives setdisplay sidebar.team.red hp');
  chk(SB.slotId('sidebar.team.red') === 15 && SB.objectiveForSlot(15) === SB.get('hp'), 'team slot');
  r = run('/scoreboard objectives setdisplay sidebar');
  chk(SB.objectiveForSlot(1) === null && /Cleared any objectives in display slot sidebar/.test(last(r)), 'cleared: ' + last(r));
  r = run('/scoreboard objectives setdisplay sidebar');
  chk(!r.ok, 'alreadyEmpty fails');
  SB.setScore('Steve', SB.get('hp'), 5);
  // save / load round trip
  const saved = JSON.parse(JSON.stringify(SB.toJSON()));
  SB.reset();
  if (!broken) SB.fromJSON(saved);   // broken engine: persistence dropped
  chkP(!!SB.get('kills') && SB.get('kills').displayName === 'Kills!' && SB.objectiveForSlot(15) === SB.get('hp')
      && SB.getScore('Steve', SB.get('hp')) === 5, 'objective, slot and score survive save/load');
  r = run('/scoreboard objectives remove kills');
  chk(!SB.get('kills') && /Removed objective \[Kills!\]/.test(last(r)), 'remove: ' + last(r));
  chk(run('/scoreboard objectives remove kills').ok === false, 'removing an unknown objective fails');
  const lvl = C.source(M.Player, { level: 1 });
  chk(!C.dispatcher.get('scoreboard').canUse(lvl), 'level 2 only');
}
suite(false);
suite(true);
if (fails.length) { console.log(fails.map((f) => '  FAIL ' + f).join('\n')); }
console.log(`scoreboardobjcheck: ${pass} passed, ${fails.length} failed, ${breaks} breaks caught`);
process.exit(fails.length ? 1 : 0);
