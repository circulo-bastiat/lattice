#!/usr/bin/env node
// scoreboardclassescheck.mjs -- #11696: proves 07zzo2_scoreboard.js's six classes (AbstractTeam rules,
// ScoreboardCriterion, ScoreboardObjective, ScoreboardPlayerScore, ServerScoreboard events, Team) through the
// real /scoreboard and /team commands plus tickPlayer/onKill entries. Each break must be caught (D-30).
import { inflateRawSync } from 'node:zlib';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, initRegistry, MCLITE_ROOT } from './loadsrc.mjs';
const EXTRA = ['16_settings.js', '02f_tags.js', '07_world.js', '08_lighting.js', '07b_behaviour.js',
  '07h_entities.js', '14b_physics.js', '07i_entitylist.js', '07k_goals.js', '07l_spawn.js',
  '07c_blockentity.js', '09b_sky.js', '14j_combat.js', '07w_passive.js', '14c_raycast.js',
  '02i_text.js', '02n_nbt.js', '14e_gamemode.js', '14f_inventory.js', '14d_survival.js', '14h_brigadier.js',
  '07zzo2_scoreboard.js', '15g_commands.js'];
const M = loadEngine({ extra: EXTRA, dom: false });
initRegistry(M);
{ const raw = readFileSync(join(MCLITE_ROOT, 'assets', 'lang.bin'));
  M.Text.init({ lang: raw.toString('base64'), langBytes: inflateRawSync(raw).length }); }
const SB = M.Scoreboard, C = M.Commands;
M.Player = { x: 0, y: 64, z: 0, name: 'Player', health: 20, food: 20, air: 300 };
C.build();
const run = (l) => C.run(l, M.Player, {});
const orig = {}; for (const k of Object.keys(SB)) orig[k] = SB[k];

function suite() {
  const bad = []; const chk = (c, m) => { if (!c) bad.push(m); };
  SB.reset();
  // ScoreboardCriterion: default render type, validity
  chk(run('/scoreboard objectives add hp health').ok, 'add health objective');
  chk(SB.get('hp') && SB.get('hp').renderType === 'hearts', 'health criterion renders hearts');
  chk(run('/scoreboard objectives add d dummy "Dummy"').ok && SB.get('d').renderType === 'integer', 'dummy integer');
  chk(!run('/scoreboard objectives add bad nosuchcrit').ok, 'unknown criterion refused');
  chk(!run('/scoreboard objectives add d dummy').ok, 'duplicate objective refused');
  // ScoreboardObjective: display slot
  chk(run('/scoreboard objectives setdisplay sidebar d').ok && SB.objectiveForSlot(1) === SB.get('d'), 'sidebar slot set');
  // ScoreboardPlayerScore: set/add/ordering/reset
  run('/scoreboard players set bob d 5'); run('/scoreboard players set Amy d 5'); run('/scoreboard players add zed d 9');
  chk(SB.getScore('zed', SB.get('d')) === 9, 'players add');
  chk(SB.allScores(SB.get('d')).map(e => e.name).join(',') === 'bob,Amy,zed', 'COMPARATOR order');
  run('/scoreboard players reset bob d');
  chk(SB.getScore('bob', SB.get('d')) === null, 'players reset');
  // ServerScoreboard: criterion events
  SB.add('dc', 'deathCount'); SB.onPlayerDeath(M.Player); SB.onPlayerDeath(M.Player);
  chk(SB.getScore('Player', SB.get('dc')) === 2, 'deathCount increments');
  M.Player.health = 7.5; SB.tickPlayer(M.Player);
  chk(SB.getScore('Player', SB.get('hp')) === 8, 'health ceil on tick');
  // Team + AbstractTeam
  chk(run('/team add red').ok && !run('/team add red').ok, 'team add/duplicate');
  run('/team modify red color red'); run('/team modify red friendlyFire false');
  run('/team modify red collisionRule never'); run('/team modify red nametagVisibility hideForOtherTeams');
  run('/team join red Player'); run('/team join red Steve');
  const t = SB.getTeam('red');
  chk(t && t.color === 'red' && t.friendlyFire === false && t.collisionRule === 'never' && t.nametagVisibility === 'hideForOtherTeams', 'team rules set');
  chk(t.members.length === 2 && SB.teamOf('Steve') === t, 'team members');
  const a = { isPlayer: true, name: 'Player' }, b = { isPlayer: true, name: 'Steve' };
  chk(SB.isTeammate(a, b), 'teammates');
  chk(!SB.shouldDamagePlayer(a, b), 'friendlyFire false blocks damage');
  chk(!SB.canBePushedBy(a, b), 'collision never');
  chk(SB.nametagRule(b, { isPlayer: true, name: 'Zed' }, true) === true && SB.nametagRule(b, { isPlayer: true, name: 'Zed' }, false) === false, 'nametag hideForOtherTeams');
  // teamkill criterion
  SB.add('tk', 'teamkill.red'); M.Player.type = 'player';
  SB.onKill(M.Player, { type: 'player', name: 'Steve' });
  chk(SB.getScore('Player', SB.get('tk')) === 1, 'teamkill.red scored');
  // save round trip
  const j = JSON.parse(JSON.stringify(SB.toJSON())); SB.reset(); SB.fromJSON(j);
  chk(SB.getTeam('red') && SB.teamOf('Steve') && SB.get('d') && SB.objectiveForSlot(1) === SB.get('d') && SB.getScore('zed', SB.get('d')) === 9, 'save round trip');
  chk(run('/team remove red').ok && !SB.getTeam('red') && !SB.teamOf('Steve'), 'team remove clears members');
  run('/scoreboard objectives remove d');
  chk(!SB.get('d') && !SB.objectiveForSlot(1), 'objective remove clears slot');
  return bad;
}
const clean = suite();
if (clean.length) { console.log(clean.join('\n')); console.log('FAIL'); process.exit(1); }
const muts = {
  'criterion default': () => { SB.add = (n, c, d) => { const o = orig.add(n, c, d); if (o) o.renderType = 'integer'; return o; }; },
  'duplicate allowed': () => { SB.add = (n, c, d) => { delete SB.objectives[n]; return orig.add(n, c, d); }; },
  'unknown criterion ok': () => { SB.isCriterion = () => true; },
  'comparator reversed': () => { SB.allScores = (o) => orig.allScores(o).reverse(); },
  'reset noop': () => { SB.resetScore = () => {}; },
  'death event dropped': () => { SB.onPlayerDeath = () => {}; },
  'tick floor': () => { SB.tickPlayer = (P, h) => { P.health = Math.floor(P.health); orig.tickPlayer(P, h); }; },
  'friendly fire ignored': () => { SB.shouldDamagePlayer = () => true; },
  'collision ignored': () => { SB.canBePushedBy = () => true; },
  'nametag ignored': () => { SB.nametagRule = () => null; },
  'team remove keeps members': () => { SB.removeTeam = (t) => { delete SB.teams[t.name]; }; },
  'persistence dropped': () => { SB.toJSON = () => ({}); },
  'objective remove keeps slot': () => { SB.remove = (o) => { delete SB.objectives[o.name]; }; },
};
let caught = 0;
for (const [n, f] of Object.entries(muts)) {
  for (const k of Object.keys(orig)) SB[k] = orig[k];
  f(); let r; try { r = suite(); } catch (e) { r = ['threw']; }
  for (const k of Object.keys(orig)) SB[k] = orig[k];
  if (r.length) caught++; else console.log('x break not caught: ' + n);
}
console.log(caught + ' breaks caught');
process.exit(caught === Object.keys(muts).length ? 0 : 1);
