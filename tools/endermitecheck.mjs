#!/usr/bin/env node
// tools/endermitecheck.mjs — ENDERMITE (QUEUE 0.2 G18, session 115), src/07zn2_endermite.js.
// Every number is .decomp/net/minecraft/entity/mob/EndermiteEntity.java's own (read in full).
// ANTI-VACUITY (D-30/D-305): each positive is paired with a break that must be caught — a
// persistent mite that must NOT age out, a removed lifetime hook that must leave the mite alive,
// an enderman with no endermite near that must NOT target, a round-trip with the field dropped.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, initRegistry, MCLITE_ROOT } from './loadsrc.mjs';

const ASSETS = join(MCLITE_ROOT, 'assets');
let pass = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else if (fails.length < 60) fails.push(m); return c; };
const okAv = (c, m) => { ok(c, m); if (c) console.log('   ✓ anti-vacuity: ' + m); };

console.log('endermitecheck — ENDERMITE (EndermiteEntity) + enderman priority-3 targeting');
const M = loadEngine({
  extra: ['02f_tags.js', '02g_items.js', '07b_behaviour.js', '07_world.js', '07h_entities.js',
          '14b_physics.js', '14c_raycast.js', '07i_entitylist.js', '07k_goals.js', '07l_spawn.js',
          '14j_combat.js', '07zg_enderman.js', '07zx_particle.js', '07zn_silverfish.js', '07zn2_endermite.js', '07zw_mobnbt.js'],
  dom: false
});
initRegistry(M);
M.DATA = Object.assign({}, M.DATA, { entities: JSON.parse(readFileSync(join(ASSETS, 'entities.json'), 'utf8')) });
M.Entities.init(); M.EntityList.init(); M.Ai.init();
M.World = Object.assign(M.World || {}, { getBlock: () => 0, setBlock: () => true, get: () => null });
const Ent = M.Entities, EL = M.EntityList, Em = M.Endermite, Ai = M.Ai;
ok(!!Em && Em.ready, 'NS.Endermite loaded');

console.log('\n1. attributes + constants (createEndermiteAttributes :61-66, DESPAWN_TIME :31, eye :57-59)');
{
  ok(Ent.has('endermite'), 'endermite is a real entity type');
  const a = Ent.attrsOf('endermite');
  ok(!!a, 'endermite has an attribute row');
  ok(Ent.maxHealth('endermite') === 8, `max health 8 — got ${Ent.maxHealth('endermite')}`);
  ok(!!a && a.speed === 0.25 && a.dmg === 2, `speed 0.25 / attack 2 — got ${JSON.stringify(a)}`);
  ok(Em.DESPAWN_TIME === 2400, 'DESPAWN_TIME 2400');
  ok(Math.abs(Em.EYE_HEIGHT - 0.13) < 1e-9, 'eye height 0.13');
}

console.log('\n2. spawn + goals (initGoals :43-52)');
let mite;
{
  EL.clear();
  mite = EL.spawn('endermite', 0.5, 64, 0.5, {});
  ok(!!mite, 'EL.spawn(\'endermite\') no longer refuses');
  ok(!!(mite && mite.ai), 'Ai.ROSTER.endermite wired e.ai');
  if (mite && mite.ai) {
    const en = mite.ai.entries;
    const has = (p, f) => en.some((x) => x.priority === p && (f === 0 ? x.flags === 0 || !(x.flags & Ai.TARGET) : (x.flags & f)));
    ok(en.length === 8, `8 entries (6 goal incl. PowderSnowJumpGoal + 2 target) — got ${en.length}`);
    ok(has(1, Ai.JUMP) && !en.some((x) => x.priority === 1 && (x.flags & Ai.MOVE)), 'priority 1 JUMP-only SwimGoal');
    ok(has(2, Ai.MOVE), 'priority 2 MeleeAttackGoal');
    ok(has(3, Ai.MOVE), 'priority 3 WanderAroundFarGoal');
    ok(has(7, Ai.LOOK) && has(8, Ai.LOOK), 'priority 7 LookAtEntity + 8 LookAround');
    ok(has(1, Ai.TARGET) && has(2, Ai.TARGET), 'target 1 Revenge + 2 ActiveTarget<Player>');
  }
}

console.log('\n3. lifeTime (tickMovement :139-145)');
{
  const e = mite; e.lifeTime = 0; e.persistent = false;
  for (let i = 0; i < 2399; i++) Em.tick(e);
  ok(e.lifeTime === 2399 && !e.removed, `alive at lifeTime 2399 — got ${e.lifeTime}, removed=${!!e.removed}`);
  ok(Em.tick(e) === true && e.removed, 'discarded on the tick lifeTime reaches 2400');
  const p = EL.spawn('endermite', 3.5, 64, 0.5, {}); p.persistent = true; p.lifeTime = 0;
  for (let i = 0; i < 3000; i++) Em.tick(p);
  okAv(p.lifeTime === 0 && !p.removed, 'a persistent (name-tagged) mite never counts up or ages out');
  // break: the hook skipped → nothing ever discards the mite (proves §3's discard is Em.tick's).
  const q = EL.spawn('endermite', 6.5, 64, 0.5, {}); q.lifeTime = 2500;
  okAv(!q.removed, 'with no Em.tick call even an over-age mite stays — the discard is the hook, not a side effect');
  ok(Em.tick({ type: 'silverfish', lifeTime: 5000 }) === false, 'Em.tick ignores other types');
  // live path: EL.tickMob must reach Em.tick
  const src = readFileSync(join(MCLITE_ROOT, 'src', '07i_entitylist.js'), 'utf8');
  ok(/e\.type === 'endermite' && NS\.Endermite && NS\.Endermite\.tick\(e\)/.test(src), 'EL.tickMob calls NS.Endermite.tick');
}

console.log('\n4. enderman targets endermites (EndermanEntity :101-104)');
{
  EL.clear();
  const man = EL.spawn('enderman', 0.5, 64, 0.5, {});
  const t3 = man.ai.entries.find((x) => x.priority === 3 && (x.flags & Ai.TARGET));
  ok(!!t3, 'enderman has a priority-3 TARGET goal');
  if (t3) {
    const g = t3.goal || t3.g || t3;
    okAv(!g.canUse(), 'no endermite in range → the goal does not start');
    const m2 = EL.spawn('endermite', 4.5, 64, 0.5, {});
    let started = false; for (let i = 0; i < 300 && !started; i++) started = g.canUse();   // #4136: reciprocalChance 10 roll
    ok(started && man.target === m2, 'an endermite 4 blocks away becomes the enderman\'s target');
  }
}

console.log('\n5. NBT "Lifetime" round-trip (writeCustomDataToNbt :101-104)');
{
  const N = M.MobNbt;
  N.init && N.init();
  EL.clear();
  const e = EL.spawn('endermite', 9.5, 64, 0.5, {}); e.lifeTime = 1234;
  const recs = N.serializeAll();
  ok(recs.length === 1 && recs[0].lifeTime === 1234, `serialize carries lifeTime — got ${JSON.stringify(recs)}`);
  EL.clear();
  N.restoreAll(recs);
  const back = EL.all().find((x) => x.type === 'endermite');
  ok(!!back && back.lifeTime === 1234, `lifeTime survives save/load — got ${back && back.lifeTime}`);
  // break: a record with the field stripped must come back at 0 (proves the restore is the field's)
  EL.clear();
  N.restoreAll(recs.map((r) => { const c = Object.assign({}, r); delete c.lifeTime; return c; }));
  const back2 = EL.all().find((x) => x.type === 'endermite');
  okAv(!!back2 && (back2.lifeTime | 0) === 0, 'a record without Lifetime restores a fresh (0) mite');
}

console.log('\n6. portal particles (tickMovement client half :126-137): 2 per tick');
{
  EL.clear(); M.Particle.init();
  const e = EL.spawn('endermite', 0.5, 64, 0.5, {});
  M.Particle.list.length = 0;
  for (let i = 0; i < 5; i++) Em.tick(e);
  const n = M.Particle.list.filter((p) => p.type === 'portal').length;
  ok(n === 10, `5 ticks emit 10 portal particles — got ${n}`);
  const sp = M.Particle.spawn; M.Particle.spawn = () => null; M.Particle.list.length = 0;
  Em.tick(e); M.Particle.spawn = sp;
  okAv(M.Particle.list.length === 0, 'with Px.spawn stubbed out nothing is emitted (count is the emitter\'s)');
}

console.log('\n8. bodyYaw == yaw (EndermiteEntity.tick/setBodyYaw; SilverfishEntity.tick)');
{
  for (const t of ['endermite', 'silverfish']) {
    const m = EL.spawn(t, 9.5, 64, 9.5, {});
    m.yaw = 1.0; m.yHeadRot = 2.5; m.yBodyRot = 0;
    EL.tickMob(m);
    ok(m.yBodyRot === m.yaw, `${t}: yBodyRot === yaw after tick — ${m.yBodyRot} vs ${m.yaw}`);
    const z = EL.spawn('zombie', 11.5, 64, 9.5, {});
    z.yaw = 1.0; z.yHeadRot = 2.5; z.yBodyRot = 0; EL.tickMob(z);
    okAv(z.yBodyRot !== z.yaw, `a generic mob's body still lags its aim yaw (${t} override is not global)`);
  }
}

console.log(`\n${fails.length ? 'FAIL' : 'PASS'}  ${pass} checks`);
console.log(`endermitecheck: ${pass} assertions, ${fails.length} failed`);
for (const f of fails) console.log('  ✗ ' + f);
process.exit(fails.length ? 1 : 0);
