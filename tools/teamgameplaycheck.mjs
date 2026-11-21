#!/usr/bin/env node
// teamgameplaycheck.mjs — G17-SB5 (#8129): scoreboard-team gameplay rules (isTeammate, friendlyFire,
// collisionRule, nametagVisibility, shulker TargetOtherTeamGoal, evoker/llama teammates). Each block is
// repeated with the team lookup broken (anti-vacuity, D-30).
import { loadEngine, initRegistry } from './loadsrc.mjs';
const EXTRA = ['16_settings.js', '02f_tags.js', '07_world.js', '08_lighting.js', '07b_behaviour.js',
  '07h_entities.js', '14b_physics.js', '07i_entitylist.js', '07k_goals.js', '07l_spawn.js', '07v_spell.js',
  '07zzk_shulker.js', '07zzo2_scoreboard.js'];
const M = loadEngine({ extra: EXTRA, dom: false });
initRegistry(M);
const SB = M.Scoreboard, Sh = M.Shulker || M.Sh, SP = M.Spell || M.Spells;
let pass = 0, breaks = 0; const fails = [];
function suite(broken) {
  const chk = (c, m) => { if (!broken) { if (c) pass++; else fails.push(m); } };
  const chkP = (c, m) => { if (broken) { breaks++; if (c) fails.push('anti-vacuity: ' + m); } else if (c) pass++; else fails.push(m); };
  SB.reset();
  const red = SB.addTeam('red'), blue = SB.addTeam('blue');
  const mk = (u, type, t) => { const e = { uuid: u, type, x: 0, y: 0, z: 0, health: 10 }; if (t) SB.joinTeam(u, t); return e; };
  const pl = (n, t) => { const e = { isPlayer: true, name: n, type: 'player' }; if (t) SB.joinTeam(n, t); return e; };
  if (broken) SB.entityTeam = () => null;
  const a = mk('a', 'zombie', red), b = mk('b', 'zombie', red), c = mk('c', 'zombie', blue), n = mk('n', 'zombie');
  chkP(SB.isTeammate(a, b), 'same team are teammates');
  chk(!SB.isTeammate(a, c) && !SB.isTeammate(a, n) && !SB.isTeammate(n, n), 'other/no team not teammates');
  const p1 = pl('p1', red), p2 = pl('p2', red);
  red.friendlyFire = false;
  chk(SB.shouldDamagePlayer(p1, p2) === (broken ? true : false) || broken, 'ff off blocks');
  chkP(!SB.shouldDamagePlayer(p1, p2), 'friendlyFire=false blocks teammate hit');
  chk(SB.shouldDamagePlayer(p1, pl('p3', blue)) && SB.shouldDamagePlayer(pl('p4'), p2), 'other team / teamless attacker may hit');
  red.friendlyFire = true; chk(SB.shouldDamagePlayer(p1, p2), 'ff on allows');
  red.collisionRule = 'never';
  chkP(!SB.canBePushedBy(a, c), 'collisionRule never stops push');
  red.collisionRule = 'always'; chk(SB.canBePushedBy(a, c), 'always pushes');
  red.collisionRule = 'pushOwnTeam'; chkP(!SB.canBePushedBy(a, b) , 'pushOwnTeam: same team not pushed');
  chk(SB.canBePushedBy(a, c), 'pushOwnTeam: other team pushed');
  red.collisionRule = 'pushOtherTeams'; chk(SB.canBePushedBy(a, b) && !SB.canBePushedBy(a, c), 'pushOtherTeams');
  red.nametagVisibility = 'never';
  chkP(SB.nametagRule(a, p2, true) === false, 'nametag never');
  red.nametagVisibility = 'hideForOtherTeams';
  chk(SB.nametagRule(a, pl('q', blue), true) === false, 'hideForOtherTeams hides from other team');
  chk(SB.nametagRule(a, p1, true) === true, 'hideForOtherTeams shows to own team');
  chk(SB.nametagRule(n, p1, true) === null, 'teamless: no rule');
  // evoker teammates
  chkP(SP.isTeammate(a, b), 'evoker spares same-team non-illager');
  chk(!SP.isTeammate(a, c), 'evoker hits other team');
  // shulker TargetOtherTeamGoal
  const sh = mk('s', 'shulker', red), sn = mk('s2', 'shulker'); sh.followRange = sn.followRange = 16;
  M.Ai.canSee = () => true;
  const spawnCat = M.Spawn.categoryOf; M.Spawn.categoryOf = () => 'monster';
  const goal = (s, list) => new Sh.TargetOtherTeamGoal(s, { entities: () => list });
  const teamMate = mk('m', 'zombie', red); teamMate.x = 3;
  let g = goal(sh, [sh, teamMate]);
  chk(!g.canUse() && !sh.target, 'two teamed mobs do not target each other');
  const foe = mk('f', 'zombie', blue); foe.x = 4;
  g = goal(sh, [sh, teamMate, foe]);
  chkP((g.canUse() && sh.target === foe), 'teamed shulker targets other-team monster');
  const sn2 = goal(sn, [sn, foe]);
  chk(!sn2.canUse(), 'team-less shulker never starts (strict)');
  M.Spawn.categoryOf = spawnCat;
}
suite(false); suite(true);
console.log(fails.length ? 'FAIL\n' + fails.join('\n') : `teamgameplaycheck: ${pass} checks ok, ${breaks} breaks caught`);
process.exit(fails.length ? 1 : 0);
