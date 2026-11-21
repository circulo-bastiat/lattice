#!/usr/bin/env node
// #11672: proves FollowMobGoal, SitOnOwnerShoulderGoal, BirdNavigation (Fl.MoveControl's air A*), TameableShoulderEntity
// (Fl.mountOnto/dropShoulderEntities) in 07t_fly.js are reached from Ai.ROSTER.parrot and that their rules matter.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const rd = (f) => readFileSync(join(ROOT, 'src', f), 'utf8');
let fails = 0; const ok = (c, m) => { if (!c) { fails++; console.log('FAIL ' + m); } };
ok(/ROSTER\.parrot = function/.test(rd('07t_fly.js')), 'reach: ROSTER.parrot defined');
function scenario(edit) {
  const log = [];
  let s = rd('07t_fly.js');
  if (edit) { if (!s.includes(edit[0])) throw new Error('missing ' + edit[0]); s = s.replace(edit[0], edit[1]); }
  const removed = [];
  const NS = {
    Ai: {
      MOVE: 1, LOOK: 2, JUMP: 4, TARGET: 8, ROSTER: {}, YAW_MAX_DELTA: 0.3,
      GoalSelector: function () { this.add = (p, f, g) => log.push('add' + p + ':' + f + ':' + (g.constructor.name || '')); },
      findSwimPath: (x, y, z, tx, ty, tz, o) => { log.push('path' + [tx, ty, tz].join('/') + o.air); return [{ x: 0, y: 5, z: 0 }, { x: 0, y: 5, z: 3 }, { x: 4, y: 5, z: 3 }]; },
      setMobSpeed: (e, v) => { e.speed = v; }, movementSpeedOf: () => 0.2, rotlerp: (a, b) => b,
    },
    EntityList: { list: [], remove: (e) => removed.push(e.type), spawn: (t) => log.push('spawn' + t) },
    MobNbt: { fieldsFor: () => ['owner'] },
  };
  for (const n of ['LookAtPlayerGoal', 'SwimGoal', 'SitGoal']) NS.Ai[n] = function () {};
  new Function('MCL', s)(NS);
  const F = NS.Fly;
  // roster wiring
  const e0 = { type: 'parrot', x: 0, y: 5, z: 0 };
  for (const n of ['EscapeDangerGoal', 'FollowOwnerGoal', 'FlyOntoTreeGoal']) if (!F[n]) throw new Error('no ' + n);
  NS.Ai.ROSTER.parrot(e0, { random: () => 0.5, players: () => [] });
  log.push('flyMove' + !!e0.flyMove);
  // FollowMobGoal
  const e = { type: 'parrot', x: 0.5, y: 5, z: 0.5, yaw: 0, pitch: 0, onGround: false, age: 200, tamed: true, owner: 'player', flyMove: null };
  e.flyMove = new F.MoveControl(e);
  const cow = { type: 'cow', x: 5.5, y: 5, z: 0.5 };
  NS.EntityList.list = [e, cow, { type: 'parrot', x: 1, y: 5, z: 1 }];
  const fm = new F.FollowMobGoal(e, 1.0, 3.0, 7.0);
  log.push('f' + fm.canUse()); fm.start(); fm.tick();
  log.push('fc' + fm.canContinueToUse());
  cow.x = 2.5; for (let i = 0; i < 12; i++) fm.tick(); log.push('fc' + fm.canContinueToUse());
  cow.x = 50; log.push('f' + fm.canUse());
  cow.x = 2; cow.look = { wanted: { x: e.x, y: e.y, z: e.z } };
  NS.EntityList.list = [e, cow]; fm.canUse(); fm.start(); for (let i = 0; i < 12; i++) fm.tick();
  e.flyMove.tick(); log.push('ey' + e.yaw.toFixed(3));
  fm.stop(); log.push('fc' + fm.canContinueToUse());
  { const cow2 = { type: 'cow', x: 6.5, y: 5, z: 0.5 }; NS.EntityList.list = [e, cow2];
    let calls = 0; const sw = e.flyMove.setWantedPosition; e.flyMove.setWantedPosition = (...a) => { calls++; return sw(...a); };
    fm.canUse(); fm.start(); for (let i = 0; i < 25; i++) fm.tick(); log.push('calls' + calls);
    cow2.x = 1.5; fm.canUse(); log.push('near' + fm.canContinueToUse());
    fm.start(); fm.tick(); log.push('backoff' + calls); e.flyMove.setWantedPosition = sw; }
  // BirdNavigation: steering follows the path node, not the straight line
  const b = { type: 'parrot', x: 0.5, y: 5, z: 0.5, yaw: 0, pitch: 0, onGround: false, width: 0.5 };
  b.flyMove = new F.MoveControl(b);
  b.flyMove.setWantedPosition(4.5, 5, 3.5, 1.0); b.flyMove.tick();
  log.push('b' + b.yaw.toFixed(3) + '/' + b.noGravity + '/' + b.speed + '/' + b.navigating);
  b.flyMove.tick(); log.push('bidle' + b.noGravity);
  // SitOnOwnerShoulder
  const owner = { x: 0.5, y: 5, z: 0.5, onGround: true, width: 0.6, height: 1.8 };
  const sg = new F.SitOnOwnerShoulderGoal(e, () => [owner]);
  log.push('s' + sg.canUse());
  e.age = 50; log.push('s' + sg.canUse()); e.age = 200;
  e.sitting = true; log.push('s' + sg.canUse()); e.sitting = false;
  owner.flying = true; log.push('s' + sg.canUse()); owner.flying = false;
  owner.inWater = true; log.push('s' + sg.canUse()); owner.inWater = false;
  e.owner = 'x'; log.push('s' + sg.canUse()); e.owner = 'player';
  log.push('s' + sg.canUse() + sg.canContinueToUse()); sg.start();
  e.x = 20; sg.tick(); log.push('far' + removed.length); e.x = 0.5;
  owner.vehicle = {}; sg.tick(); log.push('veh' + removed.length); owner.vehicle = null;
  sg.tick(); log.push('mount' + removed.join() + !!owner.shoulderLeft + (owner.shoulderLeft && owner.shoulderLeft.type));
  // second parrot -> right shoulder, third refused
  F.mountOnto({ type: 'parrot' }, owner); log.push('R' + !!owner.shoulderRight);
  log.push('3rd' + F.mountOnto({ type: 'parrot' }, owner));
  // drop
  owner.x = 1; owner.y = 5; owner.z = 1; owner.shoulderAge = 10; F.dropShoulderEntities(owner); log.push('d' + !!owner.shoulderLeft);
  owner.shoulderAge = 30; F.dropShoulderEntities(owner); log.push('d' + !!owner.shoulderLeft + !!owner.shoulderRight);
  return log.join(',');
}
const base = scenario();
const breaks = [
  [['gs.add(3, Ai.MOVE | Ai.LOOK, new Fl.FollowMobGoal(e, 1.0, 3.0, 7.0));', ''], 'follow not registered'],
  [['gs.add(3, 0, new Fl.SitOnOwnerShoulderGoal(e, players));', ''], 'shoulder not registered'],
  [['o.type === e.type || o.type === \'item\'', 'o.type === \'item\''], 'follow same-class filter'],
  [['Math.abs(o.x - e.x) > maxDist + 1 ||', ''], 'follow range'],
  [['if (!target || e.leashHolder) return;', 'if (!target) return;'].map((x, i) => i ? x : x), 'follow leash (no-op equiv)'],
  [['return tx * tx + ty * ty + tz * tz > minDist * minDist;', 'return true;'], 'follow continue distance'],
  [['if (!(d2 <= minDist * minDist)) { wx = target.x;', 'if (false) { wx = target.x;'], 'follow approach'],
  [['if (d2 <= minDist || (tl', 'if ((tl'], 'follow back-off quirk'],
  [['countdown = Fl.FOLLOW_MOB_INTERVAL;', 'countdown = 0;'], 'follow interval'],
  [['if (!(e.age > Fl.SIT_ON_SHOULDER_COOLDOWN)) return false;', ''], 'shoulder age gate'],
  [['if (e.sitting) return false;\n      if (!(e.age', 'if (!(e.age'], 'shoulder sitting'],
  [['if (o.flying) return false; ', ''], 'shoulder flying'],
  [['if (o.inWater) return false; ', ''], 'shoulder water'],
  [['if (!e.tamed || e.owner !== \'player\') return null;', ''], 'shoulder owner'],
  [['this.canContinueToUse = function () { return false; };   // one-shot', 'this.canContinueToUse = function () { return true; };   // one-shot'], 'shoulder one-shot'],
  [['Math.abs(e.x - owner.x) < hw &&', ''], 'shoulder box x'],
  [['if (p.vehicle || !p.onGround || p.inWater) return false;', ''], 'mount gates'],
  [['else if (!p.shoulderRight) p.shoulderRight = rec;\n    else return false;', 'else if (!p.shoulderRight) p.shoulderRight = rec;'], 'mount both full'],
  [['    NS.EntityList.remove(e);\n    return true;', '    return true;'], 'mount removes entity'],
  [['if (!(p.shoulderAge > 20)) return;', ''], 'drop delay'],
  [['{ air: true, mob: e, partial: true, maxNodes: 300 }', '{ air: false, mob: e, partial: true, maxNodes: 300 }'], 'bird air opt'],
  [['path = pp && pp.length > 1 ? pp : null;', 'path = null;'], 'bird path used'],
  [['e.navigating = true;   // BirdNavigation', 'e.navigating = false;   // BirdNavigation'], 'bird navigating flag'],
  [['if (!wanted) { e.noGravity = false;', 'if (!wanted) { e.noGravity = true;'], 'bird idle gravity'],
];
let caught = 0, n = 0;
for (const [ed, name] of breaks) {
  if (name.includes('no-op')) continue;
  n++;
  let got; try { got = scenario(ed); } catch (e) { got = 'throw ' + e.message; }
  if (got !== base) caught++; else { fails++; console.log('NOT CAUGHT ' + name); }
}
console.log(`fly11672check -- ${fails ? fails + ' FAIL' : 'ok'}; ${caught} breaks caught`);
process.exit(fails || caught !== n ? 1 : 0);
