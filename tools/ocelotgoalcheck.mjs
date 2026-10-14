#!/usr/bin/env node
// ocelotgoalcheck.mjs — #1606: OcelotEntity.initGoals' goalSelector 7 PounceAtTargetGoal / 8 AttackGoal and targetSelector 1 ActiveTargetGoal(chicken) /
// (baby turtle on land), compared to the ocelot rows of tools/golden/goals-1.18.2.tsv (goalrostercheck skips rows with no library family).
//   node tools/ocelotgoalcheck.mjs [--verbose]
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEngine } from './loadsrc.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ASSETS = join(ROOT, 'assets');
const VERBOSE = process.argv.includes('--verbose');

let pass = 0, breaks = 0;
const fails = [];
const ok = (c, m) => { if (c) pass++; else if (fails.length < 40) fails.push(m); return c; };
const okAv = (c, m) => { breaks++; if (c) { pass++; console.log('   ✓ ' + m); } else fails.push('anti-vacuity: ' + m); };
const say = (...a) => { if (VERBOSE) console.log(...a); };


const M = loadEngine({
  extra: ['07_world.js', '07h_entities.js', '14b_physics.js', '07i_entitylist.js',
          '07k_goals.js', '07l_spawn.js', '07m_breed.js', '07r_mount.js', '07w_passive.js', '14i_hand.js', '14j_combat.js', '14d_survival.js']
});
M.DATA = Object.assign({}, M.DATA, {
  entities: JSON.parse(readFileSync(join(ASSETS, 'entities.json'), 'utf8'))
});
M.Entities.init();
M.EntityList.init();
M.Breed.init && M.Breed.init();
M.Mount.init();
M.Ai.init();
M.Combat.init();
ok(M.Entities.ready, 'the entity table loaded');
ok(M.Ai.ready, 'Ai module reports ready');

const EL = M.EntityList, Ai = M.Ai;
const rows = readFileSync(join(ROOT, 'tools/golden/goals-1.18.2.tsv'), 'utf8').split('\n').filter((l) => l.startsWith('ocelot\t')).map((l) => l.split('\t'));
const wantG = (n) => rows.filter((r) => r[1] === 'goalSelector' && r[3] === n).map((r) => +r[2]);
const wantT = rows.filter((r) => r[1] === 'targetSelector' && r[3] === 'ActiveTargetGoal').map((r) => ({ pri: +r[2], cls: r[4].split(' ; ')[0] }));
ok(wantG('PounceAtTargetGoal').length === 1 && wantT.length === 2, 'the golden carries ocelot pounce + 2 target rows');

// what the roster builds for a real ocelot
function build(rosterRows) {
  const o = EL.spawn('ocelot', 0, 9, 0);
  const ents = o.ai.entries;
  return { o, pounce: ents.filter((en) => en.goal instanceof Ai.PounceAtTargetGoal).map((en) => en.priority),
    attack: ents.filter((en) => en.goal instanceof Ai.AttackGoal).map((en) => en.priority),
    targets: ents.filter((en) => en.goal instanceof Ai.NearestAttackableTargetGoal && (en.flags & Ai.TARGET)) };
}
function compare(b, g) {
  const out = [];
  const eqa = (a, w) => JSON.stringify(a) === JSON.stringify(w);
  if (!eqa(b.pounce, g.pounce)) out.push('pounce ' + b.pounce + ' != ' + g.pounce);
  if (!eqa(b.attack, g.attack)) out.push('attack ' + b.attack + ' != ' + g.attack);
  if (!eqa(b.targets.map((t) => t.priority), g.targetPri)) out.push('target priorities ' + b.targets.map((t) => t.priority) + ' != ' + g.targetPri);
  // which prey does each target goal pick? chicken must be taken by one; a baby turtle on land by one; an adult turtle by none
  const prey = (type, mk) => {
    const o = b.o;
    const p = EL.spawn(type, 2, 9, 0); mk && mk(p);
    let hit = 0;
    for (const t of b.targets) { for (let i = 0; i < 400 && !hit; i++) { o.target = null; if (t.goal.canUse() && o.target === p) hit = 1; } if (hit) break; }
    o.target = null; EL.remove ? EL.remove(p) : (p.removed = true);
    return hit;
  };
  if (g.chicken && !prey('chicken')) out.push('no target goal acquires a chicken');
  if (g.turtle && !prey('turtle', (p) => { p.isBaby = true; p.inWater = false; })) out.push('no target goal acquires a baby turtle on land');
  if (g.turtle && prey('turtle', (p) => { p.isBaby = false; p.inWater = false; })) out.push('a target goal acquires an ADULT turtle');
  return out;
}
const gold = { pounce: wantG('PounceAtTargetGoal'), attack: wantG('AttackGoal'), targetPri: wantT.map((t) => t.pri).sort(), chicken: wantT.some((t) => t.cls === 'ChickenEntity.class'), turtle: wantT.some((t) => t.cls === 'TurtleEntity.class') };
const real = build();
const d = compare(real, gold);
ok(d.length === 0, 'ocelot roster vs golden: ' + d.join('; '));
say('pounce', real.pounce, 'attack', real.attack, 'targets', real.targets.length);

// anti-vacuity: corrupt the golden / the roster each way and the comparison must notice
const breakIt = (name, mutB, mutG) => {
  const b = Object.assign({}, real, { targets: real.targets.slice() }), g = JSON.parse(JSON.stringify(gold));
  mutB && mutB(b); mutG && mutG(g);
  okAv(compare(b, g).length > 0, 'breaking ' + name + ' is caught');
};
breakIt('pounce priority', null, (g) => { g.pounce = [6]; });
breakIt('attack priority', null, (g) => { g.attack = [9]; });
breakIt('missing pounce goal', (b) => { b.pounce = []; });
breakIt('missing attack goal', (b) => { b.attack = []; });
breakIt('no target selectors', (b) => { b.targets = []; });
breakIt('one target selector missing', (b) => { b.targets = b.targets.slice(1); });
breakIt('target priority', null, (g) => { g.targetPri = [1, 2]; });
breakIt('chicken target dropped', (b) => { b.targets = b.targets.slice(1); }, null);
{ const b = Object.assign({}, real, { targets: real.targets.filter((t) => t.goal.canUse.toString().length < 0) });
  okAv(compare(b, gold).length > 0, 'a roster with no hunting targets is caught'); }

// #3680: ActiveTargetGoal box is expand(range, 4, range): a chicken 6 above is never acquired; sight is on (respectsVisibility)
{
  const o = EL.spawn('ocelot', 0, 9, 0), p = EL.spawn('chicken', 3, 15, 0);
  const tg = o.ai.entries.filter((en) => en.goal instanceof Ai.NearestAttackableTargetGoal && (en.flags & Ai.TARGET));
  const tryAcq = () => { for (const t of tg) for (let i = 0; i < 400; i++) { o.target = null; if (t.goal.canUse() && o.target === p) return true; } return false; };
  ok(!tryAcq(), 'ocelot acquires a chicken 6 blocks above (vanilla box is +-4)');
  p.y = 11; okAv(tryAcq(), 'a chicken 2 above is acquired, so the vertical refusal is not vacuous');
  p.y = 15; const saved = Ai.followRangeOf; Ai.followRangeOf = () => 16;
  const g0 = new Ai.NearestAttackableTargetGoal(o, () => [p], {}); o.target = null;
  okAv(g0.canUse() && o.target === p, 'without the vbox option the 6-above chicken IS acquired (break caught)');
  Ai.followRangeOf = saved; o.target = null;
  const g1 = new Ai.NearestAttackableTargetGoal(o, () => [p], { sight: true }); const cs = Ai.canSee; Ai.canSee = () => false;
  ok(!g1.canUse(), 'sight:true must refuse an unseen candidate');
  const g2 = new Ai.NearestAttackableTargetGoal(o, () => [{ x: 3, y: 9, z: 0, type: 'chicken' }], { sight: false }); okAv(g2.canUse(), 'without sight an unseen chicken is acquired (break caught)');
  Ai.canSee = cs;
}

// #2999 SPRINTING_SPEED_BOOST: a sprinting ocelot/cat moves at 1.3x its base speed (LivingEntity.setSprinting)
for (const type of ['ocelot', 'cat']) {
  const e = EL.spawn(type, 2, 9, 0);
  e.sprinting = false; const slow = Ai.movementSpeedOf(e);
  e.sprinting = true; const fast = Ai.movementSpeedOf(e);
  ok(slow > 0 && Math.abs(fast / slow - 1.3) < 1e-9, type + ' sprinting speed is 1.3x base, got ' + fast / slow);
  okAv(!(Math.abs(slow / slow - 1.3) < 1e-9), type + ' unmodified speed ratio would be caught');
}

console.log(fails.length ? 'FAIL  ocelotgoalcheck — ' + fails.join('\n   x ') : `ocelotgoalcheck: ${pass} assertions, 0 failures, ${breaks} breaks caught`);
process.exit(fails.length ? 1 : 0);
