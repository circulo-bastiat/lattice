#!/usr/bin/env node
// ravagerimmobilecheck.mjs — #2902: RavagerEntity.isImmobile (attack/stun/roar tick > 0) makes LivingEntity.tickMovement
// skip tickNewAi and zero jumping; only the tick state machine runs. Anti-vacuity: break the gate, watch it caught.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';
const A = join(MCLITE_ROOT, 'assets');
const rdj = (f) => JSON.parse(readFileSync(join(A, f), 'utf8'));
const b64 = (f) => readFileSync(join(A, f)).toString('base64');
const EXTRA = ['02f_tags.js', '02g_items.js', '07_world.js', '07b_behaviour.js', '07d_mining.js',
  '07e_loot.js', '07h_entities.js', '07y_equip.js', '14b_physics.js', '14c_raycast.js',
  '07i_entitylist.js', '07k_goals.js', '07l_spawn.js', '14d_survival.js',
  '14f_inventory.js', '14j_combat.js', '14l_use.js', '07za_explosion.js', '07z_potion.js',
  '07m_breed.js', '07q_effects.js'];
function scenario(patch) {
  const M = loadEngine({ extra: EXTRA, dom: false, patch });
  M.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
  M.DATA = Object.assign({}, M.DATA, { entities: rdj('entities.json') });
  const EL = M.EntityList, W = M.World, CH = M.CH;
  M.Entities.init(); M.Entities.attrs = M.DATA.entities.attrs;
  W.init(1); M.Behave.init(W); EL.init(); M.Ai.init(); M.Spawn.init(); M.Breed.init();
  if (M.Combat && M.Combat.init) M.Combat.init();
  if (M.Effects && M.Effects.init) M.Effects.init();
  if (M.Use && M.Use.init) M.Use.init(W);
  for (let cx = -1; cx <= 1; cx++) for (let cz = -1; cz <= 1; cz++) {
    const c = W.makeChunk(cx, cz); c.state = CH.GENERATED; W.chunks.set(W.key(cx, cz), c);
  }
  const e = EL.spawn('ravager', 0.5, 64, 0.5, {});
  let ticks = 0; const inner = e.ai.tick.bind(e.ai); e.ai.tick = () => { ticks++; inner(); };
  e.ravagerStunTick = 10; e.ravagerImmobile = true; e.jumping = true;
  for (let i = 0; i < 5; i++) EL.tickMob(e);
  // #4341: stunned against a wall on the ground, the collision hop still fires (vanilla calls jump() directly)
  const hopE = EL.spawn('ravager', 40.5, 64, 40.5, {}); hopE.ravagerStunTick = 20; hopE.ravagerImmobile = true; hopE.horizontalCollision = true; hopE.onGround = true; hopE.jumping = false;
  let seen; const du = M.Ai.dropUntargetable; M.Ai.dropUntargetable = (x) => { if (x === hopE) seen = hopE.jumping; return du && du(x); };
  EL.tickMob(hopE); M.Ai.dropUntargetable = du;
  const hop = seen === true;   // jumping as left by the goal, before physics consumes it
  const out = { hop, frozen: ticks === 0, stunAdvanced: e.ravagerStunTick === 5, noJump: e.jumping === false };
  for (let i = 0; i < 40; i++) EL.tickMob(e);
  out.resumes = ticks > 0;
  // #3139: stun 1->0 tick still rolls the particle (rnd forced to 0 => roll hits)
  let fx = 0; M.Particle = { spawn: () => { fx++; return {}; } }; EL.random = () => 0;
  e.ravagerStunTick = 1; e.ravagerImmobile = true; EL.tickMob(e);
  out.lastTickParticle = e.ravagerStunTick === 0 && fx === 1;
  // #4340: attackTick=N => exactly N frozen ticks
  e.ravagerStunTick = 0; e.ravagerRoarTick = 0; e.ravagerAttackTick = 3; e.ravagerImmobile = true;
  let frozen = 0; for (let i = 0; i < 6; i++) { const t0 = ticks; EL.tickMob(e); if (ticks === t0) frozen++; }
  out.exactLen = frozen === 3;
  return out;
}
let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
console.log('ravagerimmobilecheck — #2902');
const r = scenario();
ok(r.frozen, 'no goal ticks while immobile'); ok(r.stunAdvanced, 'stun counter still counts down'); ok(r.hop, 'collision hop survives immobile (#4341)'); ok(r.noJump, 'jumping zeroed'); ok(r.resumes, 'goals resume after stun'); ok(r.exactLen, 'attackTick=3 freezes exactly 3 ticks'); ok(r.lastTickParticle, 'particle rolled on the 1->0 stun tick');
const brk = (name, file, from, to, key) => {
  let hit = false, rr;
  try { rr = scenario((f, s) => { if (f === file && s.includes(from)) { hit = true; return s.replace(from, to); } return s; }); } catch (e) { rr = null; }
  if (hit && (!rr || !rr[key])) { breaks++; console.log('   ✓ ' + name + ' caught'); } else fails.push('anti-vacuity: "' + name + '" not caught (matched=' + hit + ')');
};
brk('stale pre-decrement flag', '07k_goals.js', 'e.ravagerImmobile = attackTick > 0 || stunTick > 0 || roarTick > 0;', 'e.ravagerImmobile = immobile;', 'exactLen');
brk('gate gone', '07i_entitylist.js', 'e.ai && e.ravagerImmobile &&', 'false &&', 'frozen');
brk('no state machine', '07i_entitylist.js', 'e.jumping = false; e.ravagerTickMovement();', 'e.jumping = false;', 'stunAdvanced');
brk('hop cancelled after state machine', '07i_entitylist.js', 'e.jumping = false; e.ravagerTickMovement();', 'e.ravagerTickMovement(); e.jumping = false;', 'hop');
brk('particle gated after decrement', '07i_entitylist.js', 'if (wasStunned) EL', 'if (e.ravagerStunTick > 0) EL', 'lastTickParticle');
console.log('   ' + pass + ' checks passed, ' + fails.length + ' failures, ' + breaks + ' breaks caught');
if (fails.length) { for (const f of fails) console.log('   ✗ ' + f); process.exit(1); }
