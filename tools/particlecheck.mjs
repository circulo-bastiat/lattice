#!/usr/bin/env node
// particlecheck.mjs — PLAN G20 (loop/hearts): the PARTICLE substrate, and the three cadences
// this unit wires it to (love-mode/breed-complete HEART, growth/bonemeal HAPPY_VILLAGER, tame
// success/fail HEART/SMOKE).
//
//   node tools/particlecheck.mjs [--verbose]
//
// ⚠ WHAT THIS PROVES. `07zx_particle.js` is a simulation with no draw (`Px.OWED` says why), so
// the only thing to assert against is `.decomp` itself: does a spawned particle's velocity,
// gravity and lifetime match the jar's own particle class, and does each emitter fire at the
// jar's own cadence — not "close", exactly (rule 6, both directions). §1-3 drive `Px` alone;
// §4-6 drive the real `Breed`/`Tame` modules and assert the WIRING, not a re-implementation of
// it in the check.

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
const okAv = (c, m) => { breaks++; if (c) { pass++; if (VERBOSE) console.log('   ✓ ' + m); } else fails.push('anti-vacuity: ' + m); };
const say = (...a) => { if (VERBOSE) console.log(...a); };

console.log('particlecheck — PLAN G20, the particle substrate + love/breed/tame cadences');

const M = loadEngine({
  extra: ['02f_tags.js', '02g_items.js', '07b_behaviour.js', '07_world.js', '07h_entities.js',
          '14b_physics.js', '07i_entitylist.js', '07k_goals.js', '07l_spawn.js', '07m_breed.js',
          '07n_tame.js', '07zx_particle.js', '14j_combat.js', '14c_raycast.js']
});
{
  const meta = JSON.parse(readFileSync(join(ASSETS, 'items.meta.json'), 'utf8'));
  M.Items.init({ items: readFileSync(join(ASSETS, 'items.bin')).toString('base64'), itemsBytes: meta.rawBytes });
}
M.DATA = Object.assign({}, M.DATA, {
  entities: JSON.parse(readFileSync(join(ASSETS, 'entities.json'), 'utf8'))
});
M.Entities.init();
M.EntityList.init();
M.Ai.init();
M.Breed.init();
M.Tame.init();
M.Particle.init();

const Px = M.Particle, Br = M.Breed, Tm = M.Tame, EL = M.EntityList;
ok(Px.ready, 'Particle module reports ready');
ok(Br.ready && Tm.ready, 'Breed/Tame report ready (Particle depends on nothing from them)');
if (!Px.ready) { console.log('\nFAIL  Particle did not initialise'); process.exit(1); }

console.log('\n§1. heart — EmotionParticle (.decomp EmotionParticle.java:8-18)');
{
  Px.clear();
  // ⚠ THE CALLER'S vx/vy/vz ARE DISCARDED. Passing an obviously-live velocity (7,7,7) and
  // getting (0,0.1,0) back is the anti-vacuity proof for the discard itself, not a guess.
  const p = Px.spawn('heart', 5, 10, -3, 7, 7, 7, () => 0.5);
  ok(!!p, 'heart spawn returns a particle');
  ok(p.vx === 0 && p.vy === 0.1 && p.vz === 0, `heart velocity is (0,0.1,0) regardless of the caller's roll (got ${p.vx},${p.vy},${p.vz})`);
  ok(p.gravityStrength === 0, 'heart has no gravity (EmotionParticle never sets gravityStrength)');
  ok(p.velocityMultiplier === 0.86, 'heart velocityMultiplier is 0.86 (EmotionParticle.java:12)');
  ok(p.maxAge === 16, 'heart maxAge is 16 ticks (EmotionParticle.java:14)');
  ok(p.x === 5 && p.y === 10 && p.z === -3, 'heart spawns at the caller\'s point, unmodified');
}

console.log('\n§2. happy_villager — SuspendParticle (.decomp SuspendParticle.java:7-18,80-93)');
{
  Px.clear();
  const p = Px.spawn('happy_villager', 0, 0, 0, 1, 2, 3, () => 0.5);
  ok(Math.abs(p.vx - 0.02) < 1e-9 && Math.abs(p.vy - 0.04) < 1e-9 && Math.abs(p.vz - 0.06) < 1e-9,
    `happy_villager velocity IS the caller's own, scaled *0.02 (got ${p.vx},${p.vy},${p.vz})`);
  ok(p.suspendTick === true, 'happy_villager uses SuspendParticle\'s own tick, not the base one');
  // maxAge = round(20 / (rand*0.8+0.2)) -- rand=0 -> 100, rand=1 -> 20 (SuspendParticle.java:18)
  const lo = Px.spawn('happy_villager', 0, 0, 0, 0, 0, 0, () => 0.999999).maxAge;
  const hi = Px.spawn('happy_villager', 0, 0, 0, 0, 0, 0, () => 0).maxAge;
  ok(lo === 20 && hi === 100, `happy_villager maxAge spans 20..100 ticks (got lo=${lo} hi=${hi})`);
  // this unit's own call site (Breed.emitGrowthPuff) always passes velocity (0,0,0) -- the
  // puff sits still, which is the jar's own behaviour for THIS call site, not an omission.
  const still = Px.spawn('happy_villager', 1, 1, 1, 0, 0, 0, () => 0.5);
  ok(still.vx === 0 && still.vy === 0 && still.vz === 0, 'a (0,0,0)-velocity spawn (the growth-puff call shape) stays put');
}

console.log('\n§3. smoke — FireSmokeParticle/AscendingParticle (.decomp AscendingParticle.java:9-44)');
{
  Px.clear();
  const p = Px.spawn('smoke', 0, 0, 0, 0.3, 0.1, -0.2, () => 0.5);
  ok(p.vx === 0.3 && p.vy === 0.1 && p.vz === -0.2, `smoke velocity is the caller's, UNSCALED (got ${p.vx},${p.vy},${p.vz})`);
  ok(p.gravityStrength === -0.1, 'smoke gravityStrength is -0.1 (rises) (AscendingParticle.java:29)');
  ok(p.velocityMultiplier === 0.96, 'smoke velocityMultiplier is 0.96 (AscendingParticle.java:29)');
  const lo = Px.spawn('smoke', 0, 0, 0, 0, 0, 0, () => 0.999999).maxAge;
  const hi = Px.spawn('smoke', 0, 0, 0, 0, 0, 0, () => 0).maxAge;
  ok(lo === 8 && hi === 40, `smoke maxAge spans 8..40 ticks (got lo=${lo} hi=${hi})`);
}

console.log('\n§4. spawnBurst — the SEVEN-particle bursts (AnimalEntity.java:243-249, TameableEntity.java:87-92)');
{
  Px.clear();
  const n = Px.spawnBurst('heart', 0, 64, 0, () => 0.5);
  ok(n === 7 && Px.list.length === 7, `spawnBurst('heart', ...) spawns exactly 7 particles (got ${n})`);
  const realCount = Px.BURST_COUNT;
  try {
    Px.BURST_COUNT = 3;
    Px.clear();
    const n2 = Px.spawnBurst('heart', 0, 64, 0, () => 0.5);
    okAv(n2 === 3, 'with Px.BURST_COUNT forced to 3, spawnBurst spawns 3, not the real 7 — the count assertion above can fail');
  } finally { Px.BURST_COUNT = realCount; }
}

console.log('\n§5. Px.tick — lifetimes and the two death rules (Particle.java:107-127, SuspendParticle.java:28-38)');
{
  // `if (this.age++ >= this.maxAge) die` -- the CURRENT age is checked before it is
  // incremented, so a particle with maxAge N gets N physics ticks and dies on tick N+1
  // (Particle.java:110-124) -- not "dies on the Nth tick", the off-by-one a naive port gets
  // wrong (D-421's own moral, cited in this file's neighbour 07m_breed.js).
  Px.clear();
  Px.spawn('heart', 0, 0, 0, 0, 0, 0, () => 0.5);
  for (let i = 0; i < 16; i++) Px.tick();
  ok(Px.list.length === 1, 'a heart (maxAge 16) survives 16 ticks of physics');
  Px.tick();
  ok(Px.list.length === 0, 'and is gone on the 17th tick() call');

  Px.clear();
  const hv = Px.spawn('happy_villager', 0, 0, 0, 0, 0, 0, () => 0.999999);   // maxAge 20
  for (let i = 0; i < 20; i++) Px.tick();
  ok(Px.list.length === 1, 'a happy_villager (maxAge 20) survives 20 ticks of physics');
  Px.tick();
  ok(Px.list.length === 0, 'and is gone on the 21st tick() call (SuspendParticle counts maxAge DOWN to 0, same off-by-one)');

  Px.clear();
  const s = Px.spawn('smoke', 0, 0, 0, 0, 1, 0, () => 0.5);
  const y0 = s.y;
  Px.tick();
  // base Particle.tick: velocityY -= 0.04*gravityStrength ( = -0.04*-0.1 = +0.004 ), THEN move,
  // THEN the per-axis velocityMultiplier decay (Particle.java:113-123).
  const expectVy = (1 + 0.004);
  ok(Math.abs(s.vy - expectVy * 0.96) < 1e-9, `smoke's rising gravity applies before the move (vy=${s.vy})`);
  ok(s.y > y0, 'and the particle actually moved up');
}

console.log('\n§6. wired — Breed.tickLove/tickAge/breed and Tame.feed actually call Px (not a parallel implementation)');
{
  const EN = () => { const e = EL.spawn('cow', 0, 64, 0); return e; };

  say(' -- love mode: heartInterval', M.Entities.BREED.heartInterval, 'inLoveTicks', M.Entities.BREED.inLoveTicks);
  {
    Px.clear();
    const e = EN();
    Br.setInLove(e, null);
    ok(e.inLove === Br.C.inLoveTicks, 'setInLove sets the full 600-tick timer');
    let spawnsAtZero = 0;
    for (let i = 0; i < Br.C.inLoveTicks; i++) {
      Br.tickLove(e);
      if (e.inLove === 0) spawnsAtZero++;
    }
    ok(e.inLove === 0, 'love mode runs all the way out over inLoveTicks ticks');
    const expected = Br.C.inLoveTicks / Br.C.heartInterval;   // 600/10 = 60
    ok(Px.list.length === expected, `love mode spawned exactly ${expected} hearts over its run (600/heartInterval) — got ${Px.list.length}`);
    ok(Px.list.every((p) => p.type === 'heart'), 'and every one of them is a heart');

    const realInterval = Br.C.heartInterval;
    try {
      Br.C.heartInterval = 25;
      Px.clear();
      const e2 = EN();
      Br.setInLove(e2, null);
      for (let i = 0; i < Br.C.inLoveTicks; i++) Br.tickLove(e2);
      okAv(Px.list.length === Br.C.inLoveTicks / 25, `with heartInterval forced to 25, love mode spawns ${Br.C.inLoveTicks / 25}, not 60 — the count above can fail`);
    } finally { Br.C.heartInterval = realInterval; }
  }

  say(' -- growth puff: growParticleInterval', M.Entities.BREED.growParticleInterval, 'forcedAgeTimer', M.Entities.BREED.forcedAgeTimer);
  {
    Px.clear();
    const e = EN();
    Br.setBaby(e, true);
    Br.ageUp(e, 12000, true);        // any forced feed sets e.forcedAgeTimer = Br.C.forcedAgeTimer
    ok(e.forcedAgeTimer === Br.C.forcedAgeTimer, 'a forced feed starts the puff timer at Br.C.forcedAgeTimer (40)');
    while (e.forcedAgeTimer > 0) Br.tickAge(e);
    const expected = Br.C.forcedAgeTimer / Br.C.growParticleInterval;   // 40/4 = 10
    ok(Px.list.length === expected, `growth puff spawned exactly ${expected} times (forcedAgeTimer/growParticleInterval) — got ${Px.list.length}`);
    ok(Px.list.every((p) => p.type === 'happy_villager'), 'and every one of them is happy_villager');

    const realInterval = Br.C.growParticleInterval;
    try {
      Br.C.growParticleInterval = 8;
      Px.clear();
      const e2 = EN();
      Br.setBaby(e2, true);
      Br.ageUp(e2, 12000, true);
      while (e2.forcedAgeTimer > 0) Br.tickAge(e2);
      okAv(Px.list.length === Br.C.forcedAgeTimer / 8, `with growParticleInterval forced to 8, the puff count changes to ${Br.C.forcedAgeTimer / 8} — the count above can fail`);
    } finally { Br.C.growParticleInterval = realInterval; }
  }

  say(' -- breed complete: 7 hearts off the FIRST parent only');
  {
    Px.clear();
    const a = EL.spawn('cow', 0, 64, 0), b = EL.spawn('cow', 1, 64, 0);
    Br.setAge(a, 0); Br.setAge(b, 0);
    Br.setInLove(a, null); Br.setInLove(b, null);
    const child = Br.breed(a, b, { random: () => 0.5 });
    ok(!!child, 'the pair actually bred (sanity, not the point of this section)');
    ok(Px.list.length === 7 && Px.list.every((p) => p.type === 'heart'), `breed-complete spawns exactly 7 hearts — got ${Px.list.length}`);
  }

  say(' -- tame: 7 hearts on success, 7 smoke on failure');
  {
    Px.clear();
    const wolf = EL.spawn('wolf', 10, 64, 0);
    const res = Tm.feed(wolf, 'bone', { random: () => 0 });   // roll 0 -> success, every time
    ok(res && res.tamed === true, 'a rand()=0 roll always succeeds (CHANCE_DENOM math)');
    ok(Px.list.length === 7 && Px.list.every((p) => p.type === 'heart'), `tame success spawns exactly 7 hearts — got ${Px.list.length}`);

    Px.clear();
    const wolf2 = EL.spawn('wolf', 11, 64, 0);
    const res2 = Tm.feed(wolf2, 'bone', { random: () => 0.999999 });   // roll CHANCE_DENOM-1 -> fail
    ok(res2 && res2.tamed === false, 'a rand()~1 roll fails (still consumes the food)');
    ok(Px.list.length === 7 && Px.list.every((p) => p.type === 'smoke'), `tame failure spawns exactly 7 smokes — got ${Px.list.length}`);
  }
}

console.log('\n§7. Px.spawn refuses an unknown type (07i\'s own "a refusal, not a silent no-op" rule)');
{
  Px.clear();
  ok(Px.spawn('sparkle', 0, 0, 0, 0, 0, 0) === null, 'an unrecognised type returns null');
  ok(Px.list.length === 0, 'and nothing was pushed');
}

console.log('\n§8. loop/particledraw — the draw substrate (Px.frameLayer/Px.sizeOf/Px.buildQuads), no GPU');
{
  // Real extractor output, not hand-typed — drift between extract-particletex.mjs's own
  // packing order and this check would show up here, not just in the live game.
  const ptMeta = JSON.parse(readFileSync(join(ASSETS, 'particle-tex.meta.json'), 'utf8'));
  ok(ptMeta.layers && typeof ptMeta.layers.heart === 'number' && typeof ptMeta.layers.happy_villager === 'number'
    && Array.isArray(ptMeta.layers.smoke) && ptMeta.layers.smoke.length === 8,
    'particle-tex.meta.json names heart/happy_villager/8 smoke layers');
  M.DATA = Object.assign({}, M.DATA, { particleLayers: ptMeta.layers });

  say(' -- frameLayer: heart/happy_villager are their one fixed layer');
  {
    Px.clear();
    const h = Px.spawn('heart', 0, 0, 0, 0, 0, 0, () => 0.5);
    ok(Px.frameLayer(h) === ptMeta.layers.heart, `heart always draws layer ${ptMeta.layers.heart} (got ${Px.frameLayer(h)})`);
    const v = Px.spawn('happy_villager', 0, 0, 0, 0, 0, 0, () => 0.5);
    ok(Px.frameLayer(v) === ptMeta.layers.happy_villager, `happy_villager always draws layer ${ptMeta.layers.happy_villager} (got ${Px.frameLayer(v)})`);
  }

  say(' -- frameLayer: smoke walks its own 8-frame list by age*(n-1)/maxAge (ParticleManager.java:499)');
  {
    Px.clear();
    const s = Px.spawn('smoke', 0, 0, 0, 0, 0, 0, () => 0.5);
    s.maxAge = 16;   // a round number makes the frame boundaries exact, not a re-typed constant
    const frames = ptMeta.layers.smoke;
    const seen = [];
    for (s.age = 0; s.age < s.maxAge; s.age++) seen.push(Px.frameLayer(s));
    const want = [];
    for (let age = 0; age < 16; age++) want.push(frames[Math.floor(age * (frames.length - 1) / 16)]);
    ok(JSON.stringify(seen) === JSON.stringify(want), `smoke's own frame walk matches SimpleSpriteProvider.getSprite's formula (got ${seen}, want ${want})`);
    ok(seen[0] === frames[0], 'age 0 draws the FIRST json-order frame (generic_7, .decomp AscendingParticle.java:45 setSpriteForAge at spawn)');
    // NOT frames[frames.length-1] -- integer division means the LAST tick alive (age ==
    // maxAge-1, since Px.tick's own death test is `age >= maxAge`, checked before the draw)
    // never quite reaches the final json-order frame; `want`'s own formula above already
    // proves every tick's index exactly, this just spells out why "last alive" isn't "last
    // frame" so a future reader doesn't mistake the `seen === want` check for a weaker one.
    ok(seen[seen.length - 1] === want[want.length - 1], 'the last tick alive draws exactly the formula\'s own last index, not necessarily the last frame');
  }

  say(' -- sizeOf: happy_villager is a flat p.scale, heart/smoke grow (age/maxAge*32, clamped)');
  {
    Px.clear();
    const v = Px.spawn('happy_villager', 0, 0, 0, 0, 0, 0, () => 0.5);
    ok(Px.sizeOf(v) === v.scale, 'happy_villager getSize never overrides scale (SuspendParticle has no getSize override)');

    const h = Px.spawn('heart', 0, 0, 0, 0, 0, 0, () => 0.5);
    h.age = 0;
    ok(Px.sizeOf(h) === 0, 'age 0 -> the growth clamp is exactly 0 (EmotionParticle.java:28, clamp(0,0,1))');
    h.age = Math.ceil(h.maxAge / 32);   // >= 1/32 of the way through -> fully grown
    ok(Math.abs(Px.sizeOf(h) - h.scale) < 1e-9, `past 1/32 of maxAge the clamp saturates to full scale (got ${Px.sizeOf(h)}, want ${h.scale})`);
  }

  say(' -- Px.spawn now rolls a draw-only p.scale (BillboardParticle.java:12) per type, and smoke a p.shade');
  {
    Px.clear();
    const base = 0.1 * (0.5 * 0.5 + 0.5) * 2;   // rand()=>0.5 throughout
    const h = Px.spawn('heart', 0, 0, 0, 0, 0, 0, () => 0.5);
    ok(Math.abs(h.scale - base * 1.5) < 1e-9, `heart scale is base*1.5 (EmotionParticle.java:16) — got ${h.scale}`);
    const v = Px.spawn('happy_villager', 0, 0, 0, 0, 0, 0, () => 0.5);
    ok(Math.abs(v.scale - base * (0.5 * 0.6 + 0.5)) < 1e-9, `happy_villager scale is base*(rand*0.6+0.5) (SuspendParticle.java:14) — got ${v.scale}`);
    const s = Px.spawn('smoke', 0, 0, 0, 0, 0, 0, () => 0.5);
    ok(Math.abs(s.scale - base * 0.75) < 1e-9, `smoke scale is base*0.75 (AscendingParticle.java:42, size=1.0) — got ${s.scale}`);
    ok(s.shade >= 0 && s.shade <= 0.3, `smoke shade is rand()*0.3 (FireSmokeParticle's own hardcoded grayShade) — got ${s.shade}`);
  }

  say(' -- Px.buildQuads: 4 eye-relative vertices per drawable particle, none with no atlas loaded');
  {
    Px.clear();
    M.DATA = Object.assign({}, M.DATA, { particleLayers: null });   // no atlas loaded yet
    Px._resetLayerCacheForTest();
    Px.spawn('heart', 5, 70, -2, 0, 0, 0, () => 0.5);
    const camNoAtlas = { x: 0, y: 64, z: 0, right: [1, 0, 0], up: [0, 1, 0] };
    ok(Px.buildQuads(camNoAtlas).length === 0, 'with no particleLayers loaded yet, buildQuads draws nothing (not a crash)');

    M.DATA = Object.assign({}, M.DATA, { particleLayers: ptMeta.layers });
    Px._resetLayerCacheForTest();
    Px.clear();
    const h = Px.spawn('heart', 5, 70, -2, 0, 0, 0, () => 0.5);
    h.age = h.maxAge;   // fully grown, so size > 0 and the quad is not skipped
    const cam = { x: 5, y: 70, z: -2, right: [1, 0, 0], up: [0, 1, 0] };
    const verts = Px.buildQuads(cam);
    ok(verts.length === 4 * Px.VERTEX_FLOATS, `one drawable heart is exactly one quad (4 vertices x ${Px.VERTEX_FLOATS} floats) — got ${verts.length}`);
    const size = Px.sizeOf(h);
    ok(Math.abs(verts[0] + size) < 1e-9 && Math.abs(verts[1] + size) < 1e-9 && Math.abs(verts[2]) < 1e-9,
      `corner 0 is (centre - size*right - size*up), eye-relative (D-179) — got (${verts[0]},${verts[1]},${verts[2]}), size ${size}`);
  }

  say(' -- #3761: squid_ink / glow_squid_ink / bubble are drawn (frameLayer >= 0), ink is wrapped-byte dark');
  {
    Px.clear();
    for (const t of ['squid_ink', 'glow_squid_ink', 'bubble']) {
      const q = Px.spawn(t, 0, 0, 0, 0, 0, 0, () => 0.5);
      ok(Px.frameLayer(q) >= 0, `${t} has an atlas layer (frameLayer ${Px.frameLayer(q)})`);
    }
    const ink = Px.spawn('squid_ink', 0, 0, 0, 0, 0, 0, () => 0.5);
    for (const t of ['squid_ink', 'glow_squid_ink']) {   // SimpleSpriteProvider.getSprite: frames[age*(n-1)/maxAge]
      const fr = ptMeta.layers[t], q = Px.spawn(t, 0, 0, 0, 0, 0, 0, () => 0.5);
      for (const age of [0, Math.floor(q.maxAge / 2), q.maxAge - 1]) {
        q.age = age;
        const want = fr[Math.floor(age * (fr.length - 1) / q.maxAge)];
        ok(Px.frameLayer(q) === want && want >= 0, `${t} age ${age}/${q.maxAge} draws frame layer ${want} (got ${Px.frameLayer(q)})`);
      }
    }
    ok(Px.colorOf(ink)[0] < 0.01, 'squid_ink colour is the byte-wrapped 255*255 (near black), not clamped white');
    M.DATA = Object.assign({}, M.DATA, { particleLayers: Object.assign({}, ptMeta.layers, { bubble: undefined }) });
    Px._resetLayerCacheForTest();
    okAv(Px.frameLayer(Px.spawn('bubble', 0, 0, 0, 0, 0, 0, () => 0.5)) === -1, 'dropping the bubble layer makes bubble undrawable — the check is not looking');
    M.DATA = Object.assign({}, M.DATA, { particleLayers: ptMeta.layers });
    Px._resetLayerCacheForTest();
  }

  say(' -- #6059: angry_villager / composter / bubble_column_up draw their vanilla frame (age*(n-1)/maxAge)');
  {
    for (const t of ['angry_villager', 'composter', 'bubble_column_up']) {
      Px.clear();
      const q = Px.spawn(t, 0, 0, 0, 0, 0, 0, () => 0.5);
      const fr = ptMeta.layers[t], n = fr.length;
      const want = (a) => fr[Math.max(0, Math.min(n - 1, Math.floor(a * (n - 1) / q.maxAge)))];
      for (const a of [0, Math.floor(q.maxAge / 2), q.maxAge - 1]) {
        q.age = a;
        ok(Px.frameLayer(q) === want(a) && Px.frameLayer(q) !== -1, `${t} at age ${a}/${q.maxAge} draws layer ${want(a)} (got ${Px.frameLayer(q)})`);
      }
      M.DATA = Object.assign({}, M.DATA, { particleLayers: Object.assign({}, ptMeta.layers, { [t]: undefined }) });
      Px._resetLayerCacheForTest();
      okAv(Px.frameLayer(q) === -1, `dropping the ${t} layer makes it undrawable — the check is not looking`);
      M.DATA = Object.assign({}, M.DATA, { particleLayers: ptMeta.layers });
      Px._resetLayerCacheForTest();
    }
  }

  say(' -- #6058: splash / mycelium / dolphin / witch each draw their json frames (age 0, mid-life, last tick)');
  {
    Px.clear();
    for (const t of ['splash', 'mycelium', 'dolphin', 'witch']) {
      const fr = ptMeta.layers[t];
      ok(Array.isArray(fr) && fr.length === (t === 'splash' || t === 'witch' ? (t === 'splash' ? 4 : 8) : 1), `${t} has its json frame list packed (${JSON.stringify(fr)})`);
      const q = Px.spawn(t, 0, 0, 0, 0, 0, 0, () => 0.5);
      q.spriteRoll = 0; q.maxAge = 16;
      const want = (a) => fr[Math.min(fr.length - 1, Math.floor(a * (fr.length - 1) / 16))];
      for (const a of [0, 8, 15]) {
        q.age = a;
        const got = Px.frameLayer(q);
        ok(got >= 0, `${t} age ${a} draws (not -1): ${got}`);
        if (t !== 'splash') ok(got === want(a), `${t} age ${a} is frame ${want(a)} (got ${got})`);
        else ok(fr.includes(got), `${t} age ${a} is one of splash_0..3 (got ${got})`);
      }
    }
    M.DATA = Object.assign({}, M.DATA, { particleLayers: Object.assign({}, ptMeta.layers, { splash: undefined, rain: undefined, mycelium: undefined, dolphin: undefined, witch: undefined }) });
    Px._resetLayerCacheForTest();
    for (const t of ['splash', 'mycelium', 'dolphin', 'witch']) okAv(Px.frameLayer(Px.spawn(t, 0, 0, 0, 0, 0, 0, () => 0.5)) === -1, `dropping the ${t} layer makes it undrawable — the check is not looking`);
    M.DATA = Object.assign({}, M.DATA, { particleLayers: ptMeta.layers });
    Px._resetLayerCacheForTest();
  }

  say(' -- anti-vacuity: drop "heart" from particleLayers, prove frameLayer stops drawing it (and only it)');
  {
    Px.clear();
    const brokenLayers = { happy_villager: ptMeta.layers.happy_villager, smoke: ptMeta.layers.smoke };
    M.DATA = Object.assign({}, M.DATA, { particleLayers: brokenLayers });
    Px._resetLayerCacheForTest();
    const h = Px.spawn('heart', 0, 0, 0, 0, 0, 0, () => 0.5);
    const v = Px.spawn('happy_villager', 0, 0, 0, 0, 0, 0, () => 0.5);
    okAv(Px.frameLayer(h) === -1, 'dropping "heart" from particleLayers makes heart undrawable (frameLayer -1) — the check is not looking');
    okAv(Px.frameLayer(v) === ptMeta.layers.happy_villager, 'dropping "heart" broke an unrelated type ("happy_villager") — the check is not isolated');

    // restore, for anything appended after this section (none today, but the next worker's own)
    M.DATA = Object.assign({}, M.DATA, { particleLayers: ptMeta.layers });
    Px._resetLayerCacheForTest();
  }
}

// §10. s118 — the pearl's portal specks and the egg's crumbs DRAW (they ticked and drew nothing, D-635)
{
  console.log('\n§10. s118 — portal + item_crack have layers, sizes, colours and UVs (PortalParticle/CrackParticle/Particle.java)');
  const ptMeta2 = JSON.parse(readFileSync(join(ASSETS, 'particle-tex.meta.json'), 'utf8'));
  M.DATA = Object.assign({}, M.DATA, { particleLayers: ptMeta2.layers });
  Px._resetLayerCacheForTest();
  Px.clear();
  ok(ptMeta2.tile === 32, `the particle array is 32x32 (D-658: the sweep frames' own size) — got ${ptMeta2.tile}`);
  ok(Array.isArray(ptMeta2.layers.portal) && ptMeta2.layers.portal.length === 8, 'portal has its 8 generic_N frames');
  ok(ptMeta2.layers.portal.every((li, i) => ptMeta2.layerNames[li] === 'generic_' + i), 'portal frame i is generic_i (portal.json order), reusing smoke\'s packed layers');
  ok(ptMeta2.layerNames[ptMeta2.layers.item && ptMeta2.layers.item.egg] === 'item:egg', 'the egg icon has its own layer');
  // every type Px.spawn accepts has a drawable layer (the bug: two types ticked and drew nothing)
  for (const t of ['heart', 'happy_villager', 'smoke', 'portal', 'item_crack']) {
    const q = Px.spawn(t, 0, 64, 0, 0, 0, 0, () => 0.37, 'egg');
    ok(q && Px.frameLayer(q) >= 0, `${t} resolves to a real layer (got ${q && Px.frameLayer(q)})`);
  }
  // portal: ONE random frame for life (getSprite(random)), ease-out size, its own colour
  const seq = [0.9, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.99];
  let k = 0; const rr = () => seq[k++ % seq.length];
  const po = Px.spawn('portal', 0, 64, 0, 0, 0, 0, rr);
  const f0 = Px.frameLayer(po); po.age = Math.floor(po.maxAge / 2);
  ok(Px.frameLayer(po) === f0, 'a portal speck keeps the frame it was born with (not age-walked)');
  ok(f0 === ptMeta2.layers.portal[Math.floor(po.spriteRoll * 8)], 'the frame is portal[floor(roll*8)]');
  po.age = po.maxAge / 2;
  ok(Math.abs(Px.sizeOf(po) - po.scale * 0.75) < 1e-9, `portal size at half life is scale*(1-(1-0.5)^2)=0.75*scale (PortalParticle.java:40-46) — got ${Px.sizeOf(po) / po.scale}`);
  const pc = Px.colorOf(po);
  ok(pc[0] === po.red && pc[1] === po.green && pc[2] === po.blue && Math.abs(po.green / po.blue - 0.3) < 1e-9, 'portal colour is (0.9,0.3,1)*shade');
  // item_crack: maxAge 4..40 from Particle.java:56, not the old fixed 20; sampleU/V window UVs
  let lo = 1e9, hi = -1;
  for (let i = 0; i < 200; i++) { const c = Px.spawn('item_crack', 0, 64, 0, 0, 0, 0, Math.random, 'egg'); lo = Math.min(lo, c.maxAge); hi = Math.max(hi, c.maxAge); Px.list.pop(); }
  ok(lo >= 4 && hi <= 40 && hi > 20, `item_crack maxAge spans (int)(4/(r*0.9+0.1)) = 4..40 — got ${lo}..${hi}`);
  const still = Px.spawn('item_crack', 0, 64, 0, 0, 0, 0, () => 0.5, 'egg');
  ok(Math.abs(still.vy - 0.01) < 1e-9, `a crumb with no caller velocity still gets the base constructor's +0.1 up, *0.1 (Particle.java:67, CrackParticle.java:15) — vy ${still.vy}`);
  Px.clear();
  const cr = Px.spawn('item_crack', 3, 64, 0, 0, 0, 0, () => 0.5, 'egg');
  const qv = Px.buildQuads({ x: 3, y: 64, z: 0, right: [1, 0, 0], up: [0, 1, 0] });
  const us = [0, 1, 2, 3].map(i => qv[i * Px.VERTEX_FLOATS + 3]), vs = [0, 1, 2, 3].map(i => qv[i * Px.VERTEX_FLOATS + 4]);
  const w = Math.max(...us) - Math.min(...us), h = Math.max(...vs) - Math.min(...vs);
  ok(Math.abs(w - 0.25) < 1e-9 && Math.abs(h - 0.25) < 1e-9, `a crumb shows a 4/16 window of the icon (CrackParticle.java:38-56) — got ${w}x${h}`);
  ok(Math.abs(Math.min(...us) - cr.sampleU / 4) < 1e-9 && Math.abs(Math.min(...vs) - cr.sampleV / 4) < 1e-9, 'the window starts at (sampleU/4, sampleV/4)');
  ok(qv[5] === ptMeta2.layers.item.egg, 'the crumb samples the egg icon layer');
  // anti-vacuity, both new types: drop their layers -> undrawable; a whole-tile UV -> caught
  M.DATA = Object.assign({}, M.DATA, { particleLayers: Object.assign({}, ptMeta2.layers, { portal: undefined, item: undefined }) });
  Px._resetLayerCacheForTest();
  okAv(Px.frameLayer(po) === -1 && Px.frameLayer(cr) === -1, 'dropping portal/item layers makes both undrawable — the check is looking');
  {
    // the same crumb drawn through the whole-tile path (as s117 would have) must fail the 4/16 test
    M.DATA = Object.assign({}, M.DATA, { particleLayers: ptMeta2.layers }); Px._resetLayerCacheForTest();
    Px.clear(); const wt = Px.spawn('happy_villager', 3, 64, 0, 0, 0, 0, () => 0.5);
    const q2 = Px.buildQuads({ x: 3, y: 64, z: 0, right: [1, 0, 0], up: [0, 1, 0] });
    const u2 = [0, 1, 2, 3].map(i => q2[i * Px.VERTEX_FLOATS + 3]);
    okAv(wt && !(Math.abs(Math.max(...u2) - Math.min(...u2) - 0.25) < 1e-9), 'a whole-tile quad is caught by the 4/16 window assertion');
  }
  M.DATA = Object.assign({}, M.DATA, { particleLayers: ptMeta2.layers });
  Px._resetLayerCacheForTest();
  Px.clear();
}

// §11. s119 — the snowball's own crumbs (SnowballEntity.handleStatus(3)): 8 item_crack of the
// snowball icon, velocity (0,0,0), on EVERY collision — and the JOIN: Cb.tickSnowball must fire them.
{
  console.log('\n§11. s119 — snowball crumbs (SnowballEntity.java handleStatus/onCollision)');
  const ptMeta3 = JSON.parse(readFileSync(join(ASSETS, 'particle-tex.meta.json'), 'utf8'));
  M.DATA = Object.assign({}, M.DATA, { particleLayers: ptMeta3.layers });
  Px._resetLayerCacheForTest();
  Px.clear();
  ok(ptMeta3.layerNames[ptMeta3.layers.item && ptMeta3.layers.item.snowball] === 'item:snowball', 'the snowball icon has its own layer');
  const n = Px.spawnSnowballBurst(1, 64, 1, () => 0.5);
  ok(n === 8 && Px.list.length === 8, `a snowball burst is 8 crumbs — got ${n}`);
  ok(Px.list.every(c => c.type === 'item_crack' && c.item === 'snowball'), 'every crumb is an item_crack of the snowball');
  ok(Px.list.every(c => Math.abs(c.vx) < 1e-9 && Math.abs(c.vy - 0.01) < 1e-9 && Math.abs(c.vz) < 1e-9),
     'with r=0.5 a snowball crumb has only the base +0.1*0.1 lift (caller velocity is literal 0, not the egg\'s (r-0.5)*0.08)');
  ok(Px.list.every(c => Px.frameLayer(c) === ptMeta3.layers.item.snowball), 'snowball crumbs draw the snowball icon');
  // the JOIN, both collision kinds: ground and entity
  const Cb = M.Combat, EL = M.EntityList;
  const saveList = EL.list;
  Px.clear();
  EL.list = [];
  const sb = { type: 'snowball', x: 0, y: 64, z: 0, onGround: true, removed: false };
  EL.list.push(sb);
  Cb.tickSnowball(sb);
  ok(sb.removed && Px.list.length === 8 && Px.list[0].item === 'snowball', `a snowball landing on a block bursts 8 crumbs — got ${Px.list.length}`);
  Px.clear();
  const tgt = { type: 'pig', x: 5, y: 64, z: 5, width: 0.9, height: 0.9, maxHealth: 10, health: 10, vx: 0, vy: 0, vz: 0 };
  const sb2 = { type: 'snowball', x: 5, y: 64.3, z: 5, onGround: false, removed: false };
  EL.list = [tgt, sb2];
  Cb.tickSnowball(sb2);
  ok(sb2.removed && Px.list.length === 8, `a snowball hitting a mob bursts 8 crumbs — got ${Px.list.length}`);
  // anti-vacuity: unhook the burst -> both joins must fail
  const real = Px.spawnSnowballBurst;
  Px.spawnSnowballBurst = () => 0;
  Px.clear();
  const sb3 = { type: 'snowball', x: 0, y: 64, z: 0, onGround: true, removed: false };
  EL.list = [sb3]; Cb.tickSnowball(sb3);
  okAv(Px.list.length !== 8, 'a tickSnowball with the burst unhooked leaves no crumbs — the join assertion can fail');
  Px.spawnSnowballBurst = real;
  // anti-vacuity: the egg's velocity shape instead of zeros is caught
  Px.clear();
  for (let i = 0; i < 8; i++) Px.spawn('item_crack', 0, 64, 0, (0.9 - 0.5) * 0.08, 0, 0, () => 0.5, 'snowball');
  okAv(!Px.list.every(c => Math.abs(c.vx) < 1e-9), 'an egg-shaped (r-0.5)*0.08 velocity is caught by the zero-velocity assertion');
  EL.list = saveList;
  Px.clear();
}

// §9. s108 — the JOIN (rule 7): who calls Px.tick()? `Main.worldTick` (src/17_main.js) must, once
// per game tick, the way MinecraftClient.tick calls particleManager.tick() (.decomp
// MinecraftClient.java:1709). A spawned heart with no ticker sits at its spawn point forever —
// the exact bug §1-8 could not see because they call Px.tick() themselves.
{
  console.log('\n§9. s108 — Px.tick is driven by the live game tick (Main.worldTick)');
  const main = readFileSync(join(ROOT, 'src', '17_main.js'), 'utf8');
  const bodyOf = (src) => {
    const i = src.indexOf('worldTick = function');
    if (i < 0) return '';
    const j = src.indexOf('\n  };', i);
    return src.slice(i, j < 0 ? undefined : j);
  };
  const ticks = (body) => /NS\.Particle\.tick\(\)/.test(body.replace(/\/\/.*$/gm, ''));
  const body = bodyOf(main);
  ok(body.length > 0, 'Main.worldTick found in src/17_main.js');
  ok(ticks(body), 'Main.worldTick calls NS.Particle.tick() (particles age and die in real play)');
  // anti-vacuity: the same file with the call removed must be caught
  const broken = main.replace(/if \(NS\.Particle && NS\.Particle\.ready\) NS\.Particle\.tick\(\);/, '');
  okAv(broken !== main && !ticks(bodyOf(broken)), 'removing the worldTick Px.tick() call is caught');
}

// §12. D-658 — Player.attack's hit particles: DamageParticle (crit / enchanted_hit /
// damage_indicator), SweepAttackParticle and EmitterParticle, each read whole off .decomp.
const hitSection = () => {
  const f = [];
  const t = (c, m) => { if (!c) f.push(m); };
  const near = (a, b) => Math.abs(a - b) < 1e-9;
  const L = JSON.parse(readFileSync(join(ASSETS, 'particle-tex.meta.json'), 'utf8'));
  M.DATA = Object.assign({}, M.DATA, { particleLayers: L.layers });
  Px._resetLayerCacheForTest();
  Px.clear();
  const seq = (vals) => { let i = 0; return () => vals[i++ % vals.length]; };
  // DamageParticle via Factory (CRIT): rand stream = baseScale, jx, jy, jz, m1, m2, grey, maxAge
  const R = [0.5, 0.75, 0.5, 0.25, 0.5, 0.5, 0.5, 0.5];
  const p = Px.spawn('crit', 1, 2, 3, 0.5, 0.2, -0.5, seq(R));
  t(p && p.type === 'crit', 'crit is a known particle type');
  if (p) {
    const jx = 0.2, jy = 0, jz = -0.2, jl = Math.sqrt(jx * jx + jz * jz), jm = (0.5 + 0.5 + 1) * 0.15;
    let vx = (jx / jl * jm * 0.4) * 0.1 + 0.5 * 0.4, vy = (0 * jm * 0.4 + 0.1) * 0.1 + 0.2 * 0.4;
    let vz = (jz / jl * jm * 0.4) * 0.1 - 0.5 * 0.4;
    vy -= 0.04 * 0.5;                                  // the constructor's own tick: gravity 0.5
    t(near(p.x, 1 + vx) && near(p.y, 2 + vy) && near(p.z, 3 + vz), 'the constructor did not tick once (Particle.java:110-124 through DamageParticle.java:25)');
    t(near(p.vx, vx * 0.7) && near(p.vy, vy * 0.7), 'velocityMultiplier is not 0.7');
    t(p.age === 1 && p.maxAge === Math.max(Math.floor(6 / (0.5 * 0.8 + 0.6)), 1), `maxAge ${p.maxAge} is not max((int)(6/(r*0.8+0.6)),1)`);
    t(near(p.red, 0.75) && near(p.green, 0.75 * 0.96) && near(p.blue, 0.75 * 0.9), 'grey is not rand*0.3+0.6 faded once (green*0.96, blue*0.9)');
    t(near(p.scale, 0.1 * (0.5 * 0.5 + 0.5) * 2 * 0.75), 'scale is not the billboard roll * 0.75');
    const g0 = p.green; Px.tick(); t(near(p.green, g0 * 0.96), 'Px.tick does not fade green by 0.96 a tick');
  }
  const d = Px.spawn('damage_indicator', 0, 0, 0, 0, 0, 0, seq(R));
  t(d && d.maxAge === 20 && near(d.vy, ((0 + 0.1) * 0.1 + 1.0 * 0.4 - 0.04 * 0.5) * 0.7), 'damage_indicator: DefaultFactory adds 1.0 to vy (x0.4) and sets maxAge 20');
  const e = Px.spawn('enchanted_hit', 0, 0, 0, 0, 0, 0, seq(R));
  t(e && near(e.red, 0.75 * 0.3) && near(e.green, 0.75 * 0.96 * 0.8), 'enchanted_hit: red*0.3, green*0.8 after the constructor');
  // SweepAttackParticle: never moves, lives age 0..4 (5 ticks drawn), frames sprites[age*7/4]
  Px.clear();
  const s = Px.spawn('sweep_attack', 5, 6, 7, 0, 0, 0, seq([0.5, 0.5]));
  t(s && s.maxAge === 4 && near(s.scale, 1) && near(s.red, 0.7), 'sweep: maxAge 4, scale 1-0*0.5, grey rand*0.6+0.4');
  const frames = [];
  for (let k = 0; k < 8 && Px.list.includes(s); k++) { frames.push(Px.frameLayer(s)); Px.tick(); }
  const want = [0, 1, 3, 5, 7].map((i) => L.layers.sweep_attack[i]);
  t(JSON.stringify(frames) === JSON.stringify(want), `sweep frames ${frames} are not sweep_0,1,3,5,7 (${want})`);
  t(s.x === 5 && s.y === 6 && s.z === 7, 'a sweep moved');
  t(L.layers.sweep_attack.length === 8 && typeof L.layers.crit === 'number' && typeof L.layers.damage_indicator === 'number',
    'the atlas carries the hit sprites');
  // #6056: ExplosionLargeParticle draws explosion_0..15 by age*(n-1)/maxAge
  Px.clear();
  const xp = Px.spawn('explosion', 1, 2, 3, 0, 0, 0, seq([0.5, 0.5]));
  const XL = L.layers.explosion;
  t(Array.isArray(XL) && XL.length === 16, 'the atlas carries the 16 explosion frames');
  if (xp && XL) {
    xp.age = 0; t(Px.frameLayer(xp) === XL[0], 'explosion age 0 is frame 0');
    xp.age = Math.floor(xp.maxAge / 2); t(Px.frameLayer(xp) === XL[Math.floor(xp.age * 15 / xp.maxAge)], 'explosion mid-life frame');
    xp.age = xp.maxAge; t(Px.frameLayer(xp) === XL[15], 'explosion last tick is frame 15');
  }
  // EmitterParticle: 16 tries a tick, points outside the unit ball skipped, 3 ticks in all
  Px.clear();
  const ent = { x: 10, y: 64, z: 10, width: 0.6, height: 1.8 };
  // D-659: a FIXED roll (the unit ball's centre, every try lands) — with Math.random the
  // 32-tries break below was caught only when more than 16 of 32 random tries landed (~60%).
  const em = Px.addEmitter(ent, 'crit', undefined, () => 0.5);
  const firstTick = Px.list.length;
  t(em && firstTick > 0 && firstTick <= 16, `one emitter tick added ${firstTick} particles (1..16)`);
  t(Px.list.every((q) => Math.abs(q.x - 10) < 0.6 / 4 + 0.45 && q.y > 64 + 1.8 * 0.25 - 0.45 && q.y < 64 + 1.8 * 0.75 + 0.55),
    'an emitted particle is outside offsetX(dx/4)/getBodyY(0.5+dy/4)');
  // all tries outside the ball -> nothing (the skip is a skip, not a re-roll)
  Px.clear();
  Px.addEmitter(ent, 'crit', undefined, () => 0.999);
  t(Px.list.length === 0, 'a try outside the unit ball still spawned');
  Px.clear();
  Px.addEmitter(ent, 'crit', undefined, Math.random);
  let ticks = 1; while (Px.emitters.length && ticks < 10) { Px.tick(); ticks++; }
  t(ticks === 3, `the emitter ran ${ticks} ticks, not EmitterParticle's 3`);
  Px.clear();
  return f;
};
{
  console.log('\n§12. D-658 — hit particles: DamageParticle, SweepAttackParticle, EmitterParticle');
  const f = hitSection();
  for (const m of f) ok(false, '§12 ' + m);
  if (!f.length) pass++;
  const brk = (name, set, undo) => { set(); let n; try { n = hitSection().length; } catch (e) { n = 1; } undo(); okAv(n > 0, name); };
  const sp = Px.spawn;
  brk('a damage particle with no constructor tick is caught', () => {
    Px.spawn = function (type) { const q = sp.apply(this, arguments); if (q && q.dmgTint && type === 'crit') { q.age = 0; q.x -= 0.01; } return q; };
  }, () => { Px.spawn = sp; });
  const fl = Px.frameLayer;
  brk('a sweep that shows one frame all life is caught', () => {
    Px.frameLayer = (q) => (q.type === 'sweep_attack' ? M.DATA.particleLayers.sweep_attack[0] : fl(q));
  }, () => { Px.frameLayer = fl; });
  const tries = Px.EMITTER_TRIES;
  brk('an emitter of 32 tries a tick is caught', () => { Px.EMITTER_TRIES = 32; }, () => { Px.EMITTER_TRIES = tries; });
  const age = Px.EMITTER_DEFAULT_AGE;
  brk('an emitter that lives 4 ticks is caught', () => { Px.EMITTER_DEFAULT_AGE = 4; }, () => { Px.EMITTER_DEFAULT_AGE = age; });
}

// ═══ §13. D-659 — BLOCK DUST: BlockDustParticle + ParticleManager.addBlockBreak(ing)Particles ═══
// Referees: .decomp (ParticleManager.java:405-487, BlockDustParticle.java:20-63, Particle.java:
// 59-69/107-128/180-210, BlockColors.java:17-66) and a JDK run of RedstoneWireBlock's COLORS table
// through MathHelper.packRgb (`java W.java`, 24 Sept 2026: power 0 -> 4980736, 15 -> 16724480).
const dustSection = () => {
  const f = [];
  const t = (c, m) => { if (!c) f.push(m); };
  const R = M.Reg, S = M.States;
  const st = (n) => { const b = R.id[n]; return R.realFirst[b] + R.defaultState[b]; };
  // (a) the sprite is the model's #particle, not the +X face
  t(S.particleTile(st('grass_block')) === S.particleTile(st('dirt')), 'grass_block dust is not the dirt sprite');
  t(S.particleTile(st('chest')) === S.particleTile(st('oak_planks')) && S.particleTile(st('chest')) >= 0, 'a chest does not dust oak planks');
  t(S.particleTile(st('stone')) === S.iconTile(st('stone')), 'stone dust is not the stone sprite');
  t(S.particleTile(st('air')) === -1, 'air has a particle sprite');
  // (b) the break burst: a cube is 4x4x4, a slab 4x2x4, a flower-sized box 2x3x2 (the min-2 rule)
  const rh = () => 0.5;
  Px.clear();
  t(Px.addBlockBreakParticles(3, 64, 5, st('stone'), null, rh) === 64 && Px.list.length === 64, 'a cube broke into ' + Px.list.length + ', not 64');
  const p0 = Px.list[0];
  // grid cell (0,0,0): pos 0.125, v = (-0.375)^3 -> normalised * (0.5+0.5+1)*0.15*0.4 (+0.1 up)
  const c = -0.12 / Math.sqrt(3);
  t(Math.abs(p0.x - 3.125) < 1e-9 && Math.abs(p0.y - 64.125) < 1e-9 && Math.abs(p0.z - 5.125) < 1e-9, 'the first grid point is not at 1/8');
  t(Math.abs(p0.vx - c) < 1e-9 && Math.abs(p0.vy - (c + 0.1)) < 1e-9 && Math.abs(p0.vz - c) < 1e-9, `grid velocity ${p0.vx},${p0.vy} is not Particle's renormalised roll`);
  t(p0.maxAge === 7 && Math.abs(p0.scale - 0.075) < 1e-9 && p0.sampleU === 1.5 && p0.gravityStrength === 1, 'maxAge/scale/sample/gravity are not the jar\'s');
  t(p0.red === 0.6 && p0.green === 0.6 && p0.blue === 0.6, 'stone dust is not 0.6 grey');
  Px.clear();
  t(Px.addBlockBreakParticles(0, 64, 0, st('stone'), [[0, 0, 0, 1, 0.5, 1]], rh) === 32, 'a slab box is not 4x2x4');
  Px.clear();
  t(Px.addBlockBreakParticles(0, 64, 0, st('stone'), [[0.3125, 0, 0.3125, 0.6875, 0.625, 0.6875]], rh) === 12, 'a flower box is not 2x3x2');
  Px.clear();
  t(Px.addBlockBreakParticles(0, 64, 0, st('stone'), [[0, 0, 0, 1, 0.0625, 1]], rh) === 32, 'a carpet box is not 4x2x4 (the min-2 rule)');
  // (b2) #6036: the caller's boxes are the OUTLINE shape (getOutlineShape), so a block with no
  // collision shape (poppy, grass) bursts from its small box, not the 64-cube.
  {
    const R = M.Reg, Ry = M.Ray;
    const want = (bx) => { let n = 0; for (const q of bx) { const c = [0, 1, 2].map(i => Math.max(2, Math.ceil(Math.min(1, q[i + 3] - q[i]) / 0.25))); n += c[0] * c[1] * c[2]; } return n; };
    const bounds = (bx) => bx.reduce((a, q) => [Math.min(a[0], q[0]), Math.min(a[1], q[1]), Math.min(a[2], q[2]), Math.max(a[3], q[3]), Math.max(a[4], q[4]), Math.max(a[5], q[5])], [1, 1, 1, 0, 0, 0]);
    const expect = { poppy: 12, stone: 64, oak_stairs: 48 };
    for (const nm of ['poppy', 'grass', 'stone', 'oak_stairs']) {
      const id = st(nm), bx = Ry.selectionBoxes(id, 0, 64, 0), ot = R.outlineShape(id);
      Px.clear();
      const n = Px.addBlockBreakParticles(0, 64, 0, id, bx, rh);
      const lo = bounds(bx);
      let inside = true;
      for (const p of Px.list) if (p.x < lo[0] - 1e-9 || p.x > lo[3] + 1e-9 || p.y < 64 + lo[1] - 1e-9 || p.y > 64 + lo[4] + 1e-9 || p.z < lo[2] - 1e-9 || p.z > lo[5] + 1e-9) inside = false;
      t(n === want(ot && ot.length ? ot : bx) && Px.list.length === n, nm + ' burst ' + n + ' != ParticleManager ' + want(ot || []));
      t(inside, nm + ' particles outside the outline bounding box');
      if (expect[nm] !== undefined) t(n === expect[nm], nm + ' burst ' + n + ', want ' + expect[nm]);
      if (nm === 'poppy' || nm === 'grass') t(n < 64, nm + ' reverted to the 64-particle cube');
      say(nm, n, JSON.stringify(lo));
    }
  }
  // (b3) #5771: callers that pass NO boxes (silverfish, turtle egg, ...) still get the outline shape
  for (const [nm, want] of [['poppy', 12], ['torch', 12], ['oak_fence', 40], ['stone', 64], ['oak_stairs', 48]]) {
    Px.clear();
    const n = Px.addBlockBreakParticles(0, 64, 0, st(nm), null, rh);
    if (nm === 'stone' || nm === 'oak_stairs') t(n === want, nm + ' (no boxes) burst ' + n + ', want ' + want);
    else if (nm === 'poppy') t(n === 12, 'poppy (no boxes) burst ' + n + ' -- full cube?');
    else t(n < 64 && n > 0, nm + ' (no boxes) burst ' + n + ' is the full cube');
  }
  // (c) colour: grass_block is EXCLUDED, leaves take foliage, spruce/birch fixed, wire by power
  Px.clear();
  const g = Px.spawnBlockDust(0, 70, 0, 0, 1, 0, st('grass_block'), 0, 70, 0, rh);
  t(g && g.red === 0.6 && g.green === 0.6, 'grass_block dust was tinted');
  const sp = Px.spawnBlockDust(0, 70, 0, 0, 1, 0, st('spruce_leaves'), 0, 70, 0, rh);
  t(sp && Math.abs(sp.green - 0.6 * 0x99 / 255) < 1e-9 && Math.abs(sp.red - 0.6 * 0x61 / 255) < 1e-9, 'spruce dust is not 0.6 x 0x619961');
  const oak = Px.spawnBlockDust(0, 70, 0, 0, 1, 0, st('oak_leaves'), 0, 70, 0, rh);
  t(oak && oak.green < 0.6 && oak.green > oak.red, 'oak leaf dust is not foliage-tinted');
  t(Px.wireColor(0) === 4980736 && Px.wireColor(15) === 16724480, `wire colours ${Px.wireColor(0)}/${Px.wireColor(15)} are not the JDK's`);
  // (d) the hit particle: on the +Y face 0.1 out, move(0.2F), scale(0.6F)
  Px.clear();
  let seed = 7; const lcg = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  let bad = 0;
  for (let k = 0; k < 50; k++) {
    Px.clear();
    const h = Px.addBlockBreakingParticles(0, 64, 0, st('stone'), 0, 1, 0, null, lcg);
    if (!h || Math.abs(h.y - (65 + Math.fround(0.1))) > 1e-9 || h.x < 0.1 - 1e-6 || h.x > 0.9 + 1e-6) bad++;
    // |v| after the renormalise is (r+r+1)*0.15*0.4 in [0.06, 0.18]; move(0.2F) takes a fifth
    else if (Math.hypot(h.vx, h.vz) > 0.18 * 0.2 + 1e-6 || Math.abs(h.vy - 0.1) > 0.18 * 0.2 + 1e-6) bad++;
    else if (Math.abs(h.width - 0.12) > 1e-6 || h.scale > 0.1 * 0.6 + 1e-9) bad++;
  }
  t(bad === 0, `${bad}/50 hit particles off the face, not move(0.2)/scale(0.6)`);
  const below = Px.addBlockBreakingParticles(0, 64, 0, st('stone'), 0, -1, 0, null, lcg);
  t(below && Math.abs(below.y - (64 - Math.fround(0.1))) < 1e-9, 'a -Y hit is not 0.1 under the block');
  // (e) Particle.tick collides: a floor at y=64 stops it, x/z x0.7 on the ground
  const Ph = M.Physics, clip0 = Ph.clip;
  Ph.clip = (x0, y0, z0, x1, y1, z1, axis, d) => (axis === 1 && d < 0 ? Math.max(d, 64 - y0) : d);
  Px.clear();
  const fall = Px.spawnBlockDust(0.5, 64.3, 0.5, 0, 0, 0, st('stone'), 0, 64, 0, rh);
  fall.maxAge = 40; fall.vx = 0.1; fall.vy = 0;
  for (let k = 0; k < 20; k++) Px.tick();
  Ph.clip = clip0;
  t(Math.abs(fall.y - 64) < 1e-9 && fall.onGround, `dust fell to ${fall.y}, not onto the floor`);
  t(fall.vx < 0.1 * Math.pow(0.98 * 0.7, 10), 'grounded dust did not slow x0.7');
  // (f) the draw: a dust layer AFTER the packed ones, UVs inside its 16x16 cell, the right bytes up
  Px.clear();
  if (!M.DATA.particleTiles) {
    const pm = JSON.parse(readFileSync(join(ASSETS, 'particle-tex.meta.json'), 'utf8'));
    M.DATA = Object.assign({}, M.DATA, { particleLayers: pm.layers, particleTile: pm.tile,
      particleTiles: readFileSync(join(ASSETS, 'particle-tex.bin')).toString('base64'), particleTilesBytes: pm.rawBytes });
    Px._resetLayerCacheForTest();
  }
  const d = Px.spawnBlockDust(0, 70, 0, 0, 1, 0, st('stone'), 0, 70, 0, rh);
  const q = Px.buildQuads({ x: 0, y: 70, z: -3, right: [1, 0, 0], up: [0, 1, 0] });
  const ds = Px._dustState();
  t(q.length === 40 && q[5] >= ds.layer0 && ds.tiles.indexOf(d.tile) >= 0, 'the dust quad is not on a dust layer holding its sprite');
  const o = Px._dustCellOrigin(d.slot);
  t(q[3] >= o[0] - 1e-9 && q[3] <= o[0] + o[2] + 1e-9 && q[4] >= o[1] - 1e-9 && q[4] <= o[1] + o[2] + 1e-9, 'dust UVs leave their cell');
  const A0 = M.Atlas; const data = new Uint8Array((d.tile + 1) * 1024); data[d.tile * 1024] = 77;
  M.Atlas = { mips: [{ data }] };
  const writes = [];
  Px._dustDirty([], (layer, x, y, rgba) => writes.push([layer, x, y, rgba[0], rgba.length]));
  M.Atlas = A0;
  t(writes.length === 1 && writes[0][0] === ds.layer0 + Math.floor(d.slot / (ds.slots / Px.DUST_LAYERS)) && writes[0][3] === 77 && writes[0][4] === 1024,
    'the dust upload is not the sprite\'s own 16x16 bytes into its cell');
  Px.clear();
  return f;
};
{
  console.log('\n§13. D-659 — block dust: BlockDustParticle, addBlockBreakParticles, addBlockBreakingParticles');
  const f = dustSection();
  for (const m of f) ok(false, '§13 ' + m);
  if (!f.length) pass++;
  const brk = (name, set, undo) => { set(); let n; try { n = dustSection().length; } catch (e) { n = 1; } undo(); okAv(n > 0, name); };
  const pt = M.States.particleTile;
  brk('dust drawn from the +X face (iconTile) is caught', () => { M.States.particleTile = (s) => M.States.iconTile(s); }, () => { M.States.particleTile = pt; });
  const bc = Px.blockColor;
  brk('dust with no colour provider is caught', () => { Px.blockColor = () => -1; }, () => { Px.blockColor = bc; });
  const cm = Px.collideMove;
  brk('dust that never collides is caught', () => { Px.collideMove = (p, dx, dy, dz) => { p.x += dx; p.y += dy; p.z += dz; p.onGround = false; }; }, () => { Px.collideMove = cm; });
  const mn = Px.DUST_MIN_PER_AXIS;
  brk('a burst without the min-2-per-axis rule is caught', () => { Px.DUST_MIN_PER_AXIS = 1; }, () => { Px.DUST_MIN_PER_AXIS = mn; });
  // #6039: shulker boxes (17), bell, conduit: dust drawn from the entity-texture layers
  const entSection = () => {
    const f = [];
    const R = M.Reg, rh = () => 0.5;
    const st = (n) => { const b = R.id[n]; return R.realFirst[b] + R.defaultState[b]; };
    const t = (c, m) => { if (!c) f.push(m); };
    const L = JSON.parse(readFileSync(join(ASSETS, 'particle-tex.meta.json'), 'utf8'));
    const cols = ['white', 'orange', 'magenta', 'light_blue', 'yellow', 'lime', 'pink', 'gray', 'light_gray', 'cyan', 'purple', 'blue', 'brown', 'green', 'red', 'black'];
    const names = ['shulker_box', 'bell', 'conduit'].concat(cols.map((c) => c + '_shulker_box'));
    t(names.length === 19, 'expected 17 shulker + bell + conduit');
    const seen = new Set();
    for (const n of names) {
      Px.clear();
      const p = Px.spawnBlockDust(0, 70, 0, 0, 1, 0, st(n), 0, 70, 0, rh);
      if (!p) { f.push(n + ' breaks with no dust'); continue; }
      t(p.entLayer >= 0 && L.layerNames[p.entLayer] === 'dust:' + n, n + ' dust sprite is ' + L.layerNames[p.entLayer] + ', not its own entity texture');
      seen.add(p.entLayer);
      const q = Px.buildQuads({ x: 0, y: 70, z: -3, right: [1, 0, 0], up: [0, 1, 0] });
      t(q.length === 40 && q[5] === p.entLayer, n + ' quad is on layer ' + q[5] + ', not ' + p.entLayer);
      t(q[3] >= 0 && q[3] <= 1 && q[4] >= 0 && q[4] <= 1, n + ' UV outside the whole sprite');
    }
    t(seen.size === 19, 'the 19 dust sprites are not 19 distinct layers (' + seen.size + ')');
    Px.clear();
    return f;
  };
  {
    const f2 = entSection();
    for (const m of f2) ok(false, '§13 #6039 ' + m);
    if (!f2.length) pass++;
    const eb = Px.entityDustLayer;
    const brk2 = (name, set, undo) => { set(); let n; try { n = entSection().length; } catch (e) { n = 1; } undo(); okAv(n > 0, name); };
    brk2('entity dust falling back to the block-atlas lookup is caught', () => { Px.entityDustLayer = () => -1; }, () => { Px.entityDustLayer = eb; });
    brk2('every entity dust on one layer is caught', () => { Px.entityDustLayer = (s) => eb(M.Reg.realFirst[M.Reg.id.bell] + M.Reg.defaultState[M.Reg.id.bell]); }, () => { Px.entityDustLayer = eb; });
  }
  const hm = Px.HIT_MOVE;
  brk('a hit particle without move(0.2F) is caught', () => { Px.HIT_MOVE = 1; }, () => { Px.HIT_MOVE = hm; });
}

// ═══ §14. D-661 — Particle.getBrightness: particles are lit where they are (were full-bright) ═══
// Referee: .decomp client/particle — Particle.java getBrightness (the cell floor(x,y,z), 0 when the
// chunk is not loaded), BlockDustParticle.java:66-69 (0 -> the source block's cell), PortalParticle
// .java:51-63 (block half += (int)(t^4*15*16), cap 240), SweepAttackParticle.java:22 (15728880),
// and WorldRenderer.getLightmapCoordinates (sky<<20 | block<<4). Levels are lightmap/16.
const lightSection = () => {
  const f = [];
  const t = (c, m) => { if (!c) f.push(m); };
  const W0 = M.World, gfx0 = M.Gfx;
  // a fake world: chunk (5,5) is not loaded; cell y=64 is open sky (15,0); y=10 is a cave (0,0);
  // y=30 is a torch-lit cave (0,12); the "source block" at (1,20,1) reads (9,4)
  const cell = (x, y, z) => (y === 64 ? (15 << 4) : y === 30 ? 12 : (x === 1 && y === 20 && z === 1) ? ((9 << 4) | 4) : 0);
  M.World = { get: (cx, cz) => (cx === 5 && cz === 5 ? null : {}), getLight: cell };
  M.Gfx = { skyDarken: 1 };
  try {
    const L = (p) => Px.lightOf(p).join(',');
    t(L({ type: 'rain', x: 2.5, y: 64.2, z: 2.5 }) === '15,0', 'a splash under open sky is not (15,0): ' + L({ type: 'rain', x: 2.5, y: 64.2, z: 2.5 }));
    t(L({ type: 'smoke', x: 2.5, y: 30.9, z: 2.5 }) === '0,12', 'smoke by a torch is not (0,12)');
    t(L({ type: 'crit', x: 80.5, y: 64.5, z: 80.5 }) === '0,0', 'a particle in an unloaded chunk is not dark (0,0)');
    t(L({ type: 'sweep_attack', x: 2.5, y: 10.5, z: 2.5 }) === '15,15', 'a sweep in a cave is not full-bright');
    // BlockDustParticle's fallback — and ONLY dust, and only when its own cell reads 0
    t(L({ type: 'block', x: 2.5, y: 10.5, z: 2.5, bx: 1, by: 20, bz: 1 }) === '9,4', 'buried dust does not fall back to its source block');
    t(L({ type: 'block', x: 2.5, y: 30.5, z: 2.5, bx: 1, by: 20, bz: 1 }) === '0,12', 'lit dust fell back to its source block anyway');
    t(L({ type: 'item_crack', x: 2.5, y: 10.5, z: 2.5, bx: 1, by: 20, bz: 1 }) === '0,0', 'a non-dust particle took the dust fallback');
    t(L({ type: 'block', x: 2.5, y: 10.5, z: 2.5, bx: 80, by: 20, bz: 80 }) === '0,0', 'dust fell back into an unloaded chunk');
    // PortalParticle's ramp: t=0 none, t=0.5 -> +(int)(0.0625*240)=15/16, t=1 -> capped at 240
    const por = (age) => Px.lightOf({ type: 'portal', x: 2.5, y: 30.5, z: 2.5, age, maxAge: 10 });
    t(por(0)[1] === 12, 'a new portal speck is brightened');
    t(por(5)[1] === 12 + 15 / 16, 'portal at half life is ' + por(5)[1] + ', not 12 + 15/16');
    t(por(10)[1] === 15 && por(10)[0] === 0, 'an old portal speck is not capped at 240 (block 15), sky untouched');
    // the colour the GPU gets is the colour times the light curve, and a cave is darker than the sky
    Px.clear();
    const stone = M.Reg.realFirst[M.Reg.id.stone] + M.Reg.defaultState[M.Reg.id.stone];
    const lit = Px.spawnBlockDust(2.5, 64.5, -0.5, 0, 0, 0, stone, 2, 70, 2, () => 0.5);
    const dark = Px.spawnBlockDust(2.5, 10.5, -0.5, 0, 0, 0, stone, 80, 10, 80, () => 0.5);   // source unloaded: no fallback
    const bl = Px.brightnessOf(lit), bd = Px.brightnessOf(dark);
    t(bl === 1 && bd > 0 && bd < 0.2, `the light curve is not full at (15,0) and near-ambient at (0,0): ${bl}, ${bd}`);
    M.Gfx = { skyDarken: 0.25 };
    t(Px.brightnessOf(lit) < bl && Px.brightnessOf(lit) > bd, 'skyDarken does not darken a sky-lit particle');
    M.Gfx = { skyDarken: 1 };
    const q = Px.buildQuads({ x: 2.5, y: 64.5, z: -3, right: [1, 0, 0], up: [0, 1, 0] });
    const n = Px.VERTEX_FLOATS;
    if (q.length === 8 * n) {
      const cl = Px.colorOf(lit);
      t(Math.abs(q[6] - cl[0] * bl) < 1e-6 && Math.abs(q[4 * n + 6] - cl[0] * bd) < 1e-6 && q[4 * n + 9] === cl[3],
        `the vertex colour is not colour x brightness (${q[6]}, ${q[4 * n + 6]})`);
    } else t(false, 'the two lit/dark particles did not both draw (' + q.length / n + ' vertices)');
  } finally { Px.clear(); M.World = W0; M.Gfx = gfx0; }
  return f;
};
{
  console.log('\n§14. D-661 — Particle.getBrightness: particles are lit where they are');
  let f; try { f = lightSection(); } catch (e) { f = ['threw: ' + e.message]; }
  for (const m of f) ok(false, '§14 ' + m);
  if (!f.length) pass++;
  const brk = (name, set, undo) => { set(); let n; try { n = lightSection().length; } catch (e) { n = 1; } undo(); okAv(n > 0, name); };
  const lo = Px.lightOf;
  brk('full-bright particles (the old draw) are caught', () => { Px.lightOf = () => [15, 15]; }, () => { Px.lightOf = lo; });
  brk('dust with no source-block fallback is caught', () => { Px.lightOf = (p) => lo(Object.assign({}, p, { bx: undefined })); }, () => { Px.lightOf = lo; });
  brk('a portal with no brightness ramp is caught', () => { Px.lightOf = (p) => lo(p.type === 'portal' ? Object.assign({}, p, { age: 0 }) : p); }, () => { Px.lightOf = lo; });
  brk('light sampled but never applied to the colour is caught', () => { Px.lightOff = true; }, () => { Px.lightOff = false; });
}

// ═══ §15. D-664 — GlowParticle + WorldRenderer.processWorldEvent 3002-3005 (.decomp GlowParticle
// .java read whole; ParticleUtil.java; WorldRenderer.java:3113-3130). Numbers are the jar's:
// ElectricSpark vel*0.25, age 2..3, (1,0.9,1); WaxOn vel (x/2,y,z/2)*0.01, age 10..39, (0.91,0.55,
// 0.08); WaxOff same shape, (1,0.9,1); Scrape vel*0.01, one of two greens; all scale*0.75, mult 0.96,
// the field_28787 slide, block light ramped by age. 3002 on an axis: ONE roll 10..19; else and
// 3003-3005: six faces, each its own 3..5.
const glowSection = () => {
  const f = [];
  const t = (c, m) => { if (!c) f.push(m); };
  const W0 = M.World;
  try {
    Px.clear();
    const near = (a, b) => Math.abs(a - b) < 1e-9;
    const sp = Px.spawn('electric_spark', 0, 0, 0, 1, -1, 0.5, () => 0.5);
    t(sp && near(sp.vx, 0.25) && near(sp.vy, -0.25) && near(sp.vz, 0.125), 'electric_spark velocity is not the caller\'s *0.25');
    t(sp && sp.red === 1 && sp.green === 0.9 && sp.blue === 1, 'electric_spark is not (1,0.9,1)');
    const on = Px.spawn('wax_on', 0, 0, 0, 1, 1, 1, () => 0.5);
    t(on && near(on.vx, 0.005) && near(on.vy, 0.01) && near(on.vz, 0.005), `wax_on velocity is not (x/2,y,z/2)*0.01: ${on && [on.vx, on.vy, on.vz]}`);
    t(on && on.red === 0.91 && on.green === 0.55 && on.blue === 0.08, 'wax_on is not (0.91,0.55,0.08)');
    const off = Px.spawn('wax_off', 0, 0, 0, 1, 1, 1, () => 0.5);
    t(off && near(off.vx, 0.005) && off.red === 1 && off.green === 0.9, 'wax_off is not WaxOffFactory\'s');
    const sc = Px.spawn('scrape', 0, 0, 0, 1, 1, 1, () => 0.5);
    t(sc && near(sc.vx, 0.01) && near(sc.vz, 0.01), 'scrape velocity is not *0.01 on every axis');
    const greens = new Set();
    for (let i = 0; i < 64; i++) { const q = Px.spawn('scrape', 0, 0, 0, 0, 0, 0); if (q) greens.add(q.red); }
    t(greens.size === 2 && greens.has(0.29) && greens.has(0.43), 'scrape does not roll between its two greens: ' + [...greens]);
    // lifetimes, both ends
    const ages = { electric_spark: new Set(), wax_on: new Set() };
    for (let i = 0; i < 400; i++) for (const k of Object.keys(ages)) { const q = Px.spawn(k, 0, 0, 0, 0, 0, 0); if (q) ages[k].add(q.maxAge); Px.clear(); }
    const es = [...ages.electric_spark].sort((a, b) => a - b), wo = [...ages.wax_on].sort((a, b) => a - b);
    t(es.join() === '2,3', 'electric_spark maxAge is not nextInt(2)+2: ' + es);
    t(wo[0] === 10 && wo[wo.length - 1] === 39, `wax_on maxAge is not 10..39: ${wo[0]}..${wo[wo.length - 1]}`);
    const small = Px.spawn('wax_on', 0, 0, 0, 0, 0, 0, () => 0), big = Px.spawn('wax_on', 0, 0, 0, 0, 0, 0, () => 0.99999);
    t(near(small.scale, 0.075) && big.scale < 0.15 && big.scale > 0.149, 'glow scale is not BillboardParticle\'s roll *0.75');
    // the slide: y unchanged -> x/z *1.1 before the 0.96 decay; y moving -> no slide
    Px.clear();
    const flat = Px.spawn('electric_spark', 0, 0, 0, 1, 0, 1, () => 0.5), rising = Px.spawn('electric_spark', 0, 0, 0, 1, 1, 1, () => 0.5);
    flat.maxAge = rising.maxAge = 5;
    Px.tick();
    t(near(flat.vx, 0.25 * 1.1 * 0.96) && near(flat.x, 0.25), `a spark that did not move in y did not slide: ${flat.vx}`);
    t(near(rising.vx, 0.25 * 0.96), `a spark moving in y slid anyway: ${rising.vx}`);
    t(near(flat.vy, 0) && flat.gravityStrength === 0, 'a glow particle has gravity');
    // the sprite, the size, the colour the draw takes
    Px.clear();
    const L = M.DATA.particleLayers;
    const g = Px.spawn('scrape', 0, 0, 0, 0, 0, 0, () => 0.9);
    t(L && typeof L.glow === 'number' && Px.frameLayer(g) === L.glow, 'a glow particle does not draw the glow sprite');
    t(Px.sizeOf(g) === g.scale, 'GlowParticle has no getSize override, but its size is not its scale');
    t(Px.colorOf(g).slice(0, 3).join() === [g.red, g.green, g.blue].join(), 'a glow particle is drawn white, not its factory colour');
    // GlowParticle.getBrightness: block half += (int)(age/maxAge * 240), cap 240; sky untouched
    M.World = { get: () => ({}), getLight: () => (6 << 4) | 3 };
    const lb = (age) => Px.lightOf(Object.assign({}, g, { age, maxAge: 10 }));
    t(lb(0).join() === '6,3', 'a new glow particle is brightened: ' + lb(0));
    t(lb(5)[1] === 3 + 120 / 16 && lb(5)[0] === 6, 'a glow at half life is not block +120/16: ' + lb(5));
    t(lb(10)[1] === 15, 'an old glow particle is not capped at 240');
    M.World = W0;
    // the world events: counts and shapes
    Px.clear();
    const lo = Px.worldEvent(3003, 4, 60, 4, 0, () => 0), hi = Px.worldEvent(3003, 4, 60, 4, 0, () => 0.99999);
    t(lo === 18 && hi === 30, `3003 is not six faces of 3..5 (${lo}, ${hi})`);
    t(Px.list.every((q) => q.type === 'wax_on'), '3003 spawned something other than wax_on');
    // each face particle sits 0.55 out on its own normal
    t(Px.list.slice(0, 18).every((q) => [q.x - 4.5, q.y - 60.5, q.z - 4.5].filter((d) => near(Math.abs(d), 0.55)).length === 1),
      'a face particle is not 0.55 out along exactly one normal');
    Px.clear();
    t(Px.worldEvent(3004, 0, 0, 0, 0) >= 18 && Px.list.every((q) => q.type === 'wax_off'), '3004 is not wax_off on six faces');
    Px.clear();
    t(Px.worldEvent(3005, 0, 0, 0, 0) >= 18 && Px.list.every((q) => q.type === 'scrape'), '3005 is not scrape on six faces');
    Px.clear();
    const axN = [Px.worldEvent(3002, 0, 0, 0, 1, () => 0), Px.worldEvent(3002, 0, 0, 0, 1, () => 0.99999)];
    t(axN.join() === '10,19', '3002 on an axis is not one roll of 10..19: ' + axN);
    Px.clear();
    Px.worldEvent(3002, 0, 0, 0, 1);
    t(Px.list.length >= 10 && Px.list.every((q) => q.type === 'electric_spark' && q.vx === 0 && q.vz === 0 &&
      Math.abs(q.x - 0.5) <= 0.125 && Math.abs(q.z - 0.5) <= 0.125 && Math.abs(q.y - 0.5) <= 0.5),
      '3002 on the Y axis is not a 0.125-wide column with velocity only along y');
    Px.clear();
    const all = Px.worldEvent(3002, 0, 0, 0, -1);
    t(all >= 18 && all <= 30, '3002 with -1 is not six faces of 3..5: ' + all);
    Px.clear();
    t(Px.worldEvent(3009, 0, 0, 0, 0) === 0 && Px.list.length === 0, 'an unknown world event spawned particles');
  } finally { Px.clear(); M.World = W0; }
  return f;
};
{
  console.log('\n§15. D-664 — GlowParticle: electric sparks, wax on/off, scrape (world events 3002-3005)');
  let f; try { f = glowSection(); } catch (e) { f = ['threw: ' + e.message]; }
  for (const m of f) ok(false, '§15 ' + m);
  if (!f.length) pass++;
  const brk = (name, set, undo) => { set(); let n; try { n = glowSection().length; } catch (e) { n = 1; } undo(); okAv(n > 0, name); };
  const G = Px.GLOW;
  brk('wax_on moving at the full 0.01 on x is caught', () => { G.wax_on.vxz = 0.01; }, () => { G.wax_on.vxz = 0.01 / 2; });
  brk('a spark living nextInt(3)+2 is caught', () => { G.electric_spark.ageSpan = 3; }, () => { G.electric_spark.ageSpan = 2; });
  const sp = Px.spawn;
  brk('a glow particle with no slide is caught', () => { Px.spawn = function () { const q = sp.apply(this, arguments); if (q && q.glow) q.slide = false; return q; }; }, () => { Px.spawn = sp; });
  const lo = Px.lightOf;
  brk('a glow particle with no brightness ramp is caught', () => { Px.lightOf = (p) => lo(p.glow ? Object.assign({}, p, { age: 0 }) : p); }, () => { Px.lightOf = lo; });
  const sa = Px.spawnAlongAxis;
  brk('3002 on an axis drawn as six faces is caught', () => { Px.spawnAlongAxis = (type, ax, x, y, z, s, a, b, r) => Px.spawnOnFaces(type, x, y, z, 3, 5, r); }, () => { Px.spawnAlongAxis = sa; });
  const fl = Px.frameLayer;
  brk('a glow particle with no sprite is caught', () => { Px.frameLayer = (q) => (q.glow ? -1 : fl(q)); }, () => { Px.frameLayer = fl; });
}

{
  console.log('\n§16 — block dust grass (grass_block itself is untinted, §6) tint is the 5x5 BiomeColors blend');
  const NSx = M;
  const T0 = NSx.Tint;
  const gb = NSx.Reg.id.grass;
  const st = NSx.Reg.realFirst[gb] + NSx.Reg.defaultState[gb];
  const colAt = (x) => (x >= 10 ? 0x00ff00 : 0xff0000);
  const run = () => {
    NSx.Tint = { data: true, sample: (ch, x) => colAt(x) };
    try { return Px.blockColor(st === null ? 0 : st, 10.5, 0, 0.5); } finally { NSx.Tint = T0; }
  };
  const want = (3 * 0xff0000 / 0xff0000 >= 0) ? ((((2 * 255) / 5) | 0) << 16) | ((((3 * 255) / 5) | 0) << 8) : 0;
  const got = run();
  if (st === null) ok(false, '§16 no grass_block state lookup'); else {
  ok(got === want, '§16 blended border colour ' + got.toString(16) + ' != ' + want.toString(16));
  ok(got !== colAt(10), '§16 equals the single-column sample');
  pass++;
  const bs = Px.blockColor;
  Px.blockColor = (s2, x, y, z) => { NSx.Tint = { data: true, sample: (ch, X) => colAt(X) }; try { return NSx.Tint.sample(1, Math.floor(x)); } finally { NSx.Tint = T0; } };
  const g2 = Px.blockColor(st, 10.5, 0, 0.5); Px.blockColor = bs;
  okAv(g2 === colAt(10) && g2 !== want, 'single-column sampler reverting is caught');
  }
}

console.log('\n§17. #6060 vibration particle: drawn with animated vibration frames, quad on the origin->sensor lerp');
{
  Px.clear();
  const vf = ptMeta17().vibration;
  function ptMeta17() { return JSON.parse(readFileSync(join(ASSETS, 'particle-tex.meta.json'), 'utf8')).layers; }
  ok(Array.isArray(vf) && vf.length >= 1, '§17 particleLayers carries vibration frames');
  M.DATA = Object.assign({}, M.DATA, { particleLayers: ptMeta17() });
  Px._resetLayerCacheForTest();
  const v = Px.spawn('vibration', 0.5, 0.5, 0.5, 0, 0, 0, null, null, { dx: 10, dy: 0, dz: 4, arrival: 10 });
  const n = vf.length;
  for (const age of [0, 5, 9]) {
    v.age = age;
    Px.animTick = age;
    ok(Px.frameLayer(v) === vf[age % n], '§17 animated frame at tick ' + age);
    ok(Px.frameLayer(v) >= 0, '§17 drawn at age ' + age);
  }
  const at = (a) => { Px.clear(); const q = Px.spawn('vibration', 0.5, 0.5, 0.5, 0, 0, 0, null, null, { dx: 10, dy: 0, dz: 4, arrival: 10 }); for (let i = 0; i < a; i++) Px.tick(); return q; };
  const near = (a, b) => Math.abs(a - b) < 1e-9;
  for (const [a, f] of [[0, 0], [5, 0.5], [10, 1]]) {
    const q = at(a);
    ok(near(q.x, 0.5 + 10 * f) && near(q.y, 0.5 - 0.0 * f) && near(q.z, 0.5 + 4 * f), '§17 lerp position at age ' + a);
  }
  M.DATA = Object.assign({}, M.DATA, { particleLayers: Object.assign({}, ptMeta17(), { vibration: undefined }) });
  Px._resetLayerCacheForTest();
  okAv(Px.frameLayer(v) === -1, '§17 dropping the vibration layer makes it undrawable');
  M.DATA = Object.assign({}, M.DATA, { particleLayers: ptMeta17() });
  Px._resetLayerCacheForTest();
}

// §18 #6243: sprinting entities spawn block dust under their feet (Entity.spawnSprintingParticles)
{
  const W0 = M.World, Ph = M.Physics;
  const stone = M.States.stateOf('stone');
  const run = (e, st) => {
    M.World = Object.assign({}, W0, { getBlock: (x, y, z) => (y < 64 ? st : 0) });
    Px.clear(); Ph.updateFluids(e); return Px.list.length;
  };
  try {
    const mk = (o) => Object.assign({ x: 0.5, y: 64, z: 0.5, vx: 0.1, vy: 0, vz: 0, sprinting: true, inWater: false }, o);
    ok(run(mk({}), stone) === 1, '§18 sprinting on stone spawns one dust');
    const q = Px.list[0];
    ok(q && q.vy > 0, '§18 dust rises (vy 1.5 dominates the jitter)');
    ok(run(mk({ type: 'zombie', width: 0.3 }), stone) === 1, '§18 sprinting mob spawns dust');
    ok(run(mk({ sprinting: false }), stone) === 0, '§18 not sprinting spawns none');
    ok(run(mk({}), 0) === 0, '§18 over air spawns none');
    okAv(run(mk({}), stone) === 1, '§18 gate removed would spawn while sprinting; baseline 1');
    okAv(run(mk({ sprinting: false }), stone) === 0, '§18 isSprinting gate: non-sprinter spawns none');
  } finally { M.World = W0; Px.clear(); }
}

console.log('================ particlecheck ===============');
console.log(` assertions passed .. ${pass}`);
console.log(` failures ........... ${fails.length}`);
console.log(` breaks caught ...... ${breaks}`);
console.log('==============================================');
for (const f of fails) console.log('FAIL  ' + f);
process.exit(fails.length ? 1 : 0);
