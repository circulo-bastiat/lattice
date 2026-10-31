#!/usr/bin/env node
// teamcommandcheck.mjs — G17-SB3 (#8127): /team and /teammsg through the
// real dispatcher on NS.Scoreboard teams, exact lang strings. Every block is repeated against a broken engine (anti-vacuity, D-30).
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


const ZOMBIE = { isPlayer: false, uuid: 'aaaa-bbbb', name: 'Zombie' };
function suite(broken) {
  const chk = (c, m) => { if (!broken) ok(c, m); };
  const chkP = (c, m) => { if (broken) { breaks++; if (c) fails.push('anti-vacuity: ' + m); } else ok(c, m); };
  SB.reset();
  if (broken) { SB.joinTeam = function () {}; }
  let r = run('/team list');
  chk(last(r) === 'There are no teams', 'list empty: ' + last(r));
  r = run('/team add red');
  chk(r.ok && last(r) === 'Created team [red]', 'add: ' + last(r));
  chk(!run('/team add red').ok, 'duplicate fails');
  r = run('/team join red Steve');
  chkP(SB.teamOf('Steve') === SB.getTeam('red') && /Added Steve to team \[red\]/.test(last(r)), 'join by name: ' + last(r));
  chkP(SB.getTeam('red').members.join() === 'Steve', 'member listed');
  M.Player.name = 'Alex';
  SB.joinTeam(SB.holderOf(ZOMBIE), SB.getTeam('red'));
  chkP(SB.teamOf(SB.holderOf(ZOMBIE)) === SB.getTeam('red'), 'entity team lookup by uuid');
  r = run('/team list red');
  chkP(/Team \[red\] has 2 members: /.test(last(r)), 'list members: ' + last(r));
  const mod = (s) => run('/team modify red ' + s);
  r = mod('color red'); chk(SB.getTeam('red').color === 'red' && /Updated the color for team \[red\] to red/.test(last(r)), 'color: ' + last(r));
  chk(!mod('color red').ok, 'color unchanged fails');
  r = mod('friendlyFire false'); chk(SB.getTeam('red').friendlyFire === false && /Disabled friendly fire/i.test(last(r)), 'friendlyFire: ' + last(r));
  chk(!mod('friendlyFire false').ok, 'friendlyFire already disabled');
  r = mod('seeFriendlyInvisibles false'); chk(SB.getTeam('red').seeFriendlyInvisibles === false, 'seeFriendlyInvisibles');
  r = mod('nametagVisibility never'); chk(SB.getTeam('red').nametagVisibility === 'never', 'nametagVisibility: ' + last(r));
  r = mod('deathMessageVisibility hideForOwnTeam'); chk(SB.getTeam('red').deathMessageVisibility === 'hideForOwnTeam', 'deathMessageVisibility');
  r = mod('collisionRule pushOtherTeams'); chk(SB.getTeam('red').collisionRule === 'pushOtherTeams', 'collisionRule: ' + last(r));
  chk(!mod('collisionRule pushOtherTeams').ok, 'collisionRule unchanged fails');
  mod('prefix [R]'); mod('suffix !');
  chk(SB.getTeam('red').prefix === '[R]' && SB.getTeam('red').suffix === '!', 'prefix/suffix');
  r = mod('displayName Reds'); chk(SB.getTeam('red').displayName === 'Reds', 'displayName');
  chk(!run('/team modify nope color red').ok, 'unknown team fails');
  r = run('/team leave Steve');
  chk(SB.teamOf('Steve') === null && /Removed Steve from any team/.test(last(r)), 'leave: ' + last(r));
  chk(!run('/teammsg hi').ok, 'teammsg without a team fails');
  const had = SB.getTeam('red').members.length;
  r = run('/team empty red');
  chkP(had === 1 && SB.getTeam('red').members.length === 0 && SB.teamOf(SB.holderOf(ZOMBIE)) === null, 'empty clears membership: ' + last(r));
  chk(!run('/team empty red').ok, 'empty twice fails');
  SB.joinTeam('Steve', SB.getTeam('red'));
  const saved = JSON.parse(JSON.stringify(SB.toJSON()));
  SB.reset(); SB.fromJSON(saved);
  chkP(SB.getTeam('red') && SB.getTeam('red').color === 'red' && SB.teamOf('Steve') === SB.getTeam('red'), 'team survives save/load');
  const pre = SB.teamOf('Steve') === SB.getTeam('red');
  r = run('/team remove red');
  chkP(pre && !SB.getTeam('red') && SB.teamOf('Steve') === null, 'remove clears membership: ' + last(r));
  chk(!C.dispatcher.get('team').canUse(C.source(M.Player, { level: 1 })), 'level 2 only');
}
suite(false);
const origJoin = SB.joinTeam;
suite(true);
SB.joinTeam = origJoin;
if (fails.length) { console.log(fails.map((f) => '  FAIL ' + f).join('\n')); }
console.log(`teamcommandcheck: ${pass} passed, ${fails.length} failed, ${breaks} breaks caught`);
process.exit(fails.length ? 1 : 0);
