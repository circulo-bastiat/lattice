// 07zzo2_scoreboard.js -- G17-SB1: the SCOREBOARD substrate. Translates .decomp/net/minecraft/scoreboard/
// {Scoreboard,ServerScoreboard,ScoreboardObjective,ScoreboardCriterion}.java: objectives (name, criterion,
// display name, render type), the 19 display slots (list, sidebar, belowName, sidebar.team.<colour>) and
// the per-holder scores, plus the save round trip (`toJSON`/`fromJSON`, kept in the world save).
//
// G17-SB3 adds the TEAMS (Team.java/AbstractTeam.java): SB.teams, member -> team, Entity.getScoreboardTeam.
// OWED: criteria driven by game events (deathCount, health, stats...),
// (the sidebar drawing is 15k3_scoreboardhud.js).
(function (NS) {
  'use strict';

  var COLORS = ['black', 'dark_blue', 'dark_green', 'dark_aqua', 'dark_red', 'dark_purple', 'gold', 'gray',
                'dark_gray', 'blue', 'green', 'aqua', 'red', 'light_purple', 'yellow', 'white'];   // Formatting.byColorIndex
  var SB = NS.Scoreboard = { objectives: Object.create(null), slots: [], scores: Object.create(null), unlocked: Object.create(null) };

  // ScoreboardCriterion: name -> default render type ("hearts" only for health).
  var CRIT = { dummy: 'integer', trigger: 'integer', deathCount: 'integer', health: 'hearts', food: 'integer',
               air: 'integer', armor: 'integer', xp: 'integer', level: 'integer', playerKillCount: 'integer',
               totalKillCount: 'integer' };
  COLORS.forEach(function (c) { CRIT['teamkill.' + c] = 'integer'; CRIT['killedByTeam.' + c] = 'integer'; });
  SB.RENDER_TYPES = ['integer', 'hearts'];
  SB.criterionDefault = function (name) { return CRIT[name] || null; };
  SB.isCriterion = function (name) { return CRIT[name] !== undefined || /^minecraft\.[a-z_]+:minecraft\./.test(name); };

  /** Scoreboard.getDisplaySlotName: 0 list, 1 sidebar, 2 belowName, 3..18 sidebar.team.<colour>. */
  SB.slotName = function (i) {
    if (i === 0) return 'list';
    if (i === 1) return 'sidebar';
    if (i === 2) return 'belowName';
    if (i >= 3 && i <= 18) return 'sidebar.team.' + COLORS[i - 3];
    return null;
  };
  SB.slotId = function (name) {
    for (var i = 0; i < 19; i++) if (SB.slotName(i) === name) return i;
    return -1;
  };
  SB.slotNames = function () {
    var a = []; for (var i = 0; i < 19; i++) { var n = SB.slotName(i); if (n) a.push(n); } return a;
  };

  SB.reset = function () { SB.objectives = Object.create(null); SB.slots = []; SB.scores = Object.create(null); SB.unlocked = Object.create(null); SB.teams = Object.create(null); SB.memberTeam = Object.create(null); };
  SB.reset();

  // ── teams (Scoreboard.addTeam/addPlayerToTeam, Team defaults) ──
  SB.VISIBILITY = ['always', 'hideForOtherTeams', 'hideForOwnTeam', 'never'];   // AbstractTeam.VisibilityRule
  SB.COLLISION = ['always', 'pushOtherTeams', 'pushOwnTeam', 'never'];          // AbstractTeam.CollisionRule
  SB.colorNames = function () { return COLORS.concat(['reset']); };
  SB.getTeam = function (name) { return SB.teams[name] || null; };
  SB.teamList = function () { return Object.keys(SB.teams).map(function (k) { return SB.teams[k]; }); };
  SB.addTeam = function (name) {
    if (SB.teams[name]) return null;
    return SB.teams[name] = { name: name, displayName: name, prefix: '', suffix: '', color: 'reset', friendlyFire: true,
      seeFriendlyInvisibles: true, nametagVisibility: 'always', deathMessageVisibility: 'always', collisionRule: 'always', members: [] };
  };
  /** Team.getFormattedName: the display name wrapped in [ ] (the hover/colour styling is the renderer's). */
  SB.teamName = function (t) { return '[' + t.displayName + ']'; };
  SB.clearMember = function (holder) {
    var t = SB.memberTeam[holder]; if (!t) return false;
    var i = t.members.indexOf(holder); if (i >= 0) t.members.splice(i, 1);
    delete SB.memberTeam[holder]; return true;
  };
  SB.joinTeam = function (holder, t) {
    if (SB.memberTeam[holder]) SB.clearMember(holder);
    t.members.push(holder); SB.memberTeam[holder] = t;
  };
  SB.removeTeam = function (t) {
    t.members.slice().forEach(SB.clearMember);
    delete SB.teams[t.name];
  };
  /** Entity.getScoreboardTeam: players are held by name, every other entity by UUID. */
  SB.holderOf = function (e, name) { return e.isPlayer || e.kind === 'player' || !e.uuid ? (name || e.name) : e.uuid; };
  SB.teamOf = function (holder) { return SB.memberTeam[holder] || null; };
  /** Entity.getScoreboardTeam (a mob's team is `e.team` when a fixture sets one, else the member lookup). */
  SB.entityTeam = function (e) { return e ? (e.team || SB.teamOf(SB.holderOf(e))) : null; };
  /** Entity.isTeammate: this has a team and it is the other's team. */
  SB.isTeammate = function (a, b) { var t = SB.entityTeam(a); return !!t && t === SB.entityTeam(b); };
  /** PlayerEntity.shouldDamagePlayer: no team -> true; other team -> true; same team -> friendlyFire. */
  SB.shouldDamagePlayer = function (attacker, victim) {
    var t = SB.entityTeam(attacker);
    return !t || t !== SB.entityTeam(victim) || !!t.friendlyFire;
  };
  /** EntityPredicates.canBePushedBy(self).test(other), team half only (isPushable/spectator are the caller's). */
  SB.canBePushedBy = function (self, other) {
    var a = SB.entityTeam(self), b = SB.entityTeam(other);
    var ra = a ? a.collisionRule : 'always', rb = b ? b.collisionRule : 'always';
    if (ra === 'never' || rb === 'never') return false;
    var same = !!a && a === b;
    if ((ra === 'pushOwnTeam' || rb === 'pushOwnTeam') && same) return false;
    return (ra !== 'pushOtherTeams' && rb !== 'pushOtherTeams') || same;
  };
  /** LivingEntityRenderer.hasLabel team switch; null = no team rule applies (fall through). */
  SB.nametagRule = function (e, viewer, invisibleOk) {
    var t = SB.entityTeam(e); if (!t || e === viewer) return null;
    var v = SB.entityTeam(viewer), same = !!v && t === v;
    switch (t.nametagVisibility) {
      case 'always': return invisibleOk;
      case 'never': return false;
      case 'hideForOtherTeams': return !v ? invisibleOk : same && (t.seeFriendlyInvisibles || invisibleOk);
      case 'hideForOwnTeam': return !v ? invisibleOk : !same && invisibleOk;
    }
    return true;
  };
  SB.get = function (name) { return SB.objectives[name] || null; };
  SB.list = function () { return Object.keys(SB.objectives).map(function (k) { return SB.objectives[k]; }); };
  SB.add = function (name, criterion, displayName) {
    if (SB.objectives[name]) return null;
    var o = SB.objectives[name] = { name: name, criterion: criterion, displayName: displayName === undefined ? name : displayName,
                                    renderType: CRIT[criterion] || 'integer' };
    return o;
  };
  SB.remove = function (o) {
    delete SB.objectives[o.name];
    for (var i = 0; i < SB.slots.length; i++) if (SB.slots[i] === o.name) SB.slots[i] = null;
    delete SB.scores[o.name]; delete SB.unlocked[o.name];
  };
  SB.objectiveForSlot = function (i) { return SB.slots[i] ? SB.get(SB.slots[i]) : null; };
  SB.setSlot = function (i, o) { SB.slots[i] = o ? o.name : null; };
  SB.setScore = function (holder, o, v) {
    (SB.scores[o.name] = SB.scores[o.name] || Object.create(null))[holder] = v | 0;
  };
  SB.getScore = function (holder, o) { var s = SB.scores[o.name]; return s && s[holder] !== undefined ? s[holder] : null; };

  // Locked flag (ScoreboardPlayerScore.locked, true until /scoreboard players enable); only trigger reads it.
  SB.isLocked = function (holder, o) { var u = SB.unlocked[o.name]; return !(u && u[holder]); };
  SB.setLocked = function (holder, o, lk) {
    var u = SB.unlocked[o.name] = SB.unlocked[o.name] || Object.create(null);
    if (lk) delete u[holder]; else u[holder] = true;
  };
  SB.knownHolders = function () {
    var h = Object.create(null);
    Object.keys(SB.scores).forEach(function (k) { Object.keys(SB.scores[k]).forEach(function (n) { h[n] = 1; }); });
    return Object.keys(h).sort();
  };
  /** Scoreboard.resetPlayerScore: one objective, or (null) every objective. */
  SB.resetScore = function (holder, o) {
    Object.keys(SB.scores).forEach(function (k) { if (!o || o.name === k) delete SB.scores[k][holder]; });
  };
  /** Scoreboard.getAllPlayerScores: [{name, score}] sorted by ScoreboardPlayerScore.COMPARATOR (score, then name descending, ignoring case). */
  SB.allScores = function (o) {
    var s = SB.scores[o.name] || {}, a = Object.keys(s).map(function (n) { return { name: n, score: s[n] }; });
    a.sort(function (x, y) {
      if (x.score !== y.score) return x.score > y.score ? 1 : -1;
      var p = y.name.toLowerCase(), q = x.name.toLowerCase(); return p < q ? -1 : p > q ? 1 : 0;
    });
    return a;
  };
  SB.holderScores = function (holder) {
    return SB.list().filter(function (o) { return SB.getScore(holder, o) !== null; });
  };

  SB.toJSON = function () {
    return { objectives: SB.list().map(function (o) { return { name: o.name, criterion: o.criterion, displayName: o.displayName, renderType: o.renderType }; }),
             slots: SB.slots.slice(), scores: JSON.parse(JSON.stringify(SB.scores)),
             teams: SB.teamList().map(function (t) { return JSON.parse(JSON.stringify(t)); }) };
  };
  SB.fromJSON = function (j) {
    SB.reset();
    ((j && j.teams) || []).forEach(function (o) {
      var t = SB.addTeam(o.name); if (!t) return;
      Object.keys(o).forEach(function (k) { if (k !== 'members' && k !== 'name') t[k] = o[k]; });
      (o.members || []).forEach(function (m) { SB.joinTeam(m, t); });
    });
    if (!j || !j.objectives) return;
    j.objectives.forEach(function (o) {
      var n = SB.add(o.name, o.criterion, o.displayName); if (n) n.renderType = o.renderType || n.renderType;
    });
    (j.slots || []).forEach(function (n, i) { if (n && SB.objectives[n]) SB.slots[i] = n; });
    Object.keys(j.scores || {}).forEach(function (k) { if (SB.objectives[k]) SB.scores[k] = Object.assign(Object.create(null), j.scores[k]); });
  };
})(MCL);
