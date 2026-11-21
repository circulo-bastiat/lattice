// lockstep-raidwaves.mjs -- #7950 (G18f-L13): lockstep scenario 'raidwaves', 20 salts x (easy, normal, hard) x Bad Omen I..V: a player's omen starts a raid, which runs wave after wave to VICTORY (or to LOSS when the village is destroyed mid-raid). Per tick: status, raid centre, waves spawned, pre-raid countdown (300, then 300 before every later wave), raider count, the composition spawned that tick (vindicator, evoker, pillager, witch, ravager + ravager riders), the spawn position (Raid.getRavagerSpawnLocation: 20 tries per tier, 1 try x3 for the pre-calculated spot, 32*(2-tier) ring + nextInt(5)), the boss bar percent, the 40-tick win delay, the 600-tick finish cooldown and the Hero of the Village amplifier (badOmenLevel-1).
// Reference = .decomp net/minecraft/village/raid/Raid.java (tick, spawnNextWave, getBonusCount, getRavagerSpawnLocation, Member tables), written independently below with its own state. world.random (positions) and raid.random (bonus counts) are separate streams, as in the jar. OWED: MathHelper's sine table (both sides use Math.cos), the real isNearOccupiedPointOfInterest (a flag here), kill timing is scripted.
import { loadEngine } from './loadsrc.mjs';
const M = loadEngine({ extra: ['07s_raid.js'], dom: false });
const Rd = M.Raid;
let fails = 0, breaks = 0;
const ok = (c, m) => { if (!c) { fails++; if (fails < 12) console.log('  FAIL ' + m); } };
const stream = (seed) => { let s = (seed * 2654435761 + 12345) >>> 0; const f = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; return { nextFloat: f, nextInt: (n) => Math.floor(f() * n) }; };
// ---- independent reference (Raid.java) ----
const MEMBERS = [['vindicator', [0, 0, 2, 0, 1, 4, 2, 5]], ['evoker', [0, 0, 0, 0, 0, 1, 1, 2]], ['pillager', [0, 4, 3, 3, 4, 4, 4, 2]], ['witch', [0, 0, 0, 0, 3, 0, 0, 1]], ['ravager', [0, 0, 0, 1, 0, 1, 0, 2]]];
const MAXW = { easy: 3, normal: 5, hard: 7 };
function bonus(name, rr, wave, diff, extra) {
  const easy = diff === 'easy', normal = diff === 'normal'; let n;
  if (name === 'witch') { if (easy || wave <= 2 || wave === 4) return 0; n = 1; }
  else if (name === 'pillager' || name === 'vindicator') n = easy ? rr.nextInt(2) : normal ? 1 : 2;
  else if (name === 'ravager') n = (!easy && extra) ? 1 : 0;
  else return 0;
  return n > 0 ? rr.nextInt(n + 1) : 0;
}
function refRaid(diff, level, center) { return { diff, level, center: { ...center }, waveCount: MAXW[diff], spawned: 0, pre: 300, post: 0, fin: 0, ticks: 0, status: 'ongoing', raiders: [], total: 0, pct: 0, precalc: null }; }
function refSpawnLoc(J, tier, tries, wr, spawnable) {
  const sc = tier === 0 ? 2 : 2 - tier;
  for (let i = 0; i < tries; i++) {
    const a = wr.nextFloat() * (Math.PI * 2);
    const x = J.center.x + Math.floor(Math.cos(a) * 32 * sc) + wr.nextInt(5), z = J.center.z + Math.floor(Math.sin(a) * 32 * sc) + wr.nextInt(5);
    if (spawnable(x, 64, z)) return { x, y: 64, z };
  }
  return null;
}
function refTick(J, o) {
  if (J.status === 'stopped') return;
  if (J.status !== 'ongoing') { J.fin++; if (J.fin >= 600) { J.status = 'stopped'; return; } if (J.fin % 20 === 0 && J.status === 'victory') J.pct = 0; return; }
  if (!o.near) { J.status = J.spawned > 0 ? 'loss' : 'stopped'; }
  J.ticks++; if (J.ticks >= 48000) { J.status = 'stopped'; return; }
  const n0 = J.raiders.length, more = J.level > 1 ? !(J.spawned > J.waveCount) : !(J.spawned === J.waveCount);
  if (n0 === 0 && more) {
    if (J.pre <= 0) { if (J.pre === 0 && J.spawned > 0) { J.pre = 300; return; } }
    else {
      let redo = !J.precalc && J.pre % 5 === 0;
      if (redo) { J.precalc = null; const t = J.pre < 100 ? 1 : 0; for (let i = 0; i < 3 && !J.precalc; i++) J.precalc = refSpawnLoc(J, t, 1, o.wr, o.spawnable); }
      J.pre--; J.pct = Math.max(0, Math.min(1, (300 - J.pre) / 300));
    }
  }
  let t = 0; const out = [];
  const can = () => J.pre === 0 && (J.spawned < J.waveCount || (J.spawned === J.waveCount && J.raiders.length === 0 && J.level > 1)) && J.raiders.length === 0;
  while (can()) {
    const p = J.precalc || refSpawnLoc(J, t, 20, o.wr, o.spawnable);
    if (p) { o.spawn(J, p); } else t++;
    if (t > 3) { J.status = 'stopped'; break; }
  }
  if (J.spawned > 0 && !(J.level > 1 ? !(J.spawned > J.waveCount) : !(J.spawned === J.waveCount)) && J.raiders.length === 0) {
    if (J.post < 40) J.post++; else { J.status = 'victory'; J.hero = J.level - 1; }
  }
}
function refSpawn(J, p, o) {
  const wave = J.spawned + 1, extra = J.spawned === J.waveCount && J.raiders.length === 0 && J.level > 1; let idx = 0; J.total = 0;
  const add = (type) => { const r = { type, killAt: o.t + 5 + (wave * 7 + idx * 3 + o.salt) % 40 }; idx++; J.raiders.push(r); J.total += 1; o.comp.push(type); };
  for (const [name, arr] of MEMBERS) {
    const c = (extra ? arr[J.waveCount] : arr[wave]) + bonus(name, o.rr, wave, J.diff, extra); let k = 0;
    for (let i = 0; i < c; i++) {
      add(name);
      if (name === 'ravager') { let rd = null; if (wave === MAXW.normal) rd = 'pillager'; else if (wave >= MAXW.hard) rd = k === 0 ? 'evoker' : 'vindicator'; k++; if (rd) add(rd); }
    }
  }
  J.precalc = null; J.spawned++; J.pct = J.total > 0 ? Math.min(1, J.raiders.length / J.total) : 0; o.at = p;
}
// ---- the lane ----
function lane(salt, diff, hook) {
  const level = salt % 5 + 1, center = { x: 100 + salt, y: 64, z: -50 + salt * 3 }, loseAt = salt % 4 === 3 ? 1200 + salt * 30 : -1;
  const spawnable = (x, y, z) => ((Math.imul(x, 73856093) ^ Math.imul(z, 19349663) ^ salt) >>> 0) % 100 < 6;
  const seedBase = salt * 31 + diff.length, wrE = stream(seedBase), rrE = stream(seedBase + 9), wrR = stream(seedBase), rrR = stream(seedBase + 9);
  const J = refRaid(diff, level, center); const o = { wr: wrR, rr: rrR, spawnable, near: true, t: 0, salt, comp: [], at: null, spawn: null }; o.spawn = (j, p) => refSpawn(j, p, o);
  const raid = Rd.create(1, center, diff, 300);
  const ES = { applied: null, getStatusEffect: () => ({ amplifier: level - 1 }), removeStatusEffect() {}, addStatusEffect(e, id, dur, amp) { this.applied = { id, dur, amp }; } };
  Rd.start(raid, {}, ES);
  if (hook) hook(raid);
  J.level = raid.badOmenLevel; ok(J.level === level, `salt ${salt} omen level ${raid.badOmenLevel} != ${level}`);
  let near = true; const eComp = [], hero = { player: {} }; let eAt = null;
  const ctx = { isNearVillage: () => near, moveRaidCenter() {}, rand: wrE, raidRand: rrE, mobRand: stream(77), ES, heroEntities: hero,
    heightAt: () => 64, spawnPos: (r, tier, rand, tries) => Rd.findRaiderSpawnPos(r, tier, tries, { rand, heightAt: () => 64, isSpawnable: spawnable }),
    spawnFn: (type, pos) => { eComp.push(type); eAt = pos; return { type, health: 1, killAt: 0 }; } };
  for (let t = 0; t < 4600; t++) {
    near = !(loseAt >= 0 && t >= loseAt); o.near = near; o.t = t; o.comp.length = 0; eComp.length = 0;
    for (let i = J.raiders.length - 1; i >= 0; i--) if (J.raiders[i].killAt <= t) { J.raiders.splice(i, 1); J.pct = J.total > 0 ? Math.min(1, J.raiders.length / J.total) : 0; }
    for (let i = raid.raiders.length - 1; i >= 0; i--) if (raid.raiders[i].killAt <= t) Rd.removeFromWave(raid, raid.raiders[i], 'player');
    const before = raid.wavesSpawned;
    if (raid.status === 'ongoing' || raid.status === 'victory' || raid.status === 'loss') refTick(J, o); else if (J.status !== 'stopped') refTick(J, o);
    Rd.tick(raid, ctx);
    if (raid.wavesSpawned > before) for (const m of raid.raiders) if (!m.killAt) m.killAt = t + 5 + (raid.wavesSpawned * 7 + raid.raiders.indexOf(m) * 3 + salt) % 40;
    const tag = `salt ${salt} ${diff} omen ${level} tick ${t} `;
    if (raid.status !== J.status) return tag + `status ${raid.status} != ${J.status}`;
    if (raid.wavesSpawned !== J.spawned) return tag + `waves ${raid.wavesSpawned} != ${J.spawned}`;
    if (raid.preRaidTicks !== J.pre) return tag + `preRaid ${raid.preRaidTicks} != ${J.pre}`;
    if (raid.raiders.length !== J.raiders.length) return tag + `raiders ${raid.raiders.length} != ${J.raiders.length} (engine ${eComp.join()} ref ${o.comp.join()})`;
    if (raid.postRaidTicks !== J.post) return tag + `post ${raid.postRaidTicks} != ${J.post}`;
    if (raid.ticksActive !== J.ticks) return tag + `ticksActive ${raid.ticksActive} != ${J.ticks}`;
    if (raid.center.x !== J.center.x || raid.center.z !== J.center.z) return tag + 'centre moved';
    if (eComp.join() !== o.comp.join()) return tag + `composition ${eComp.join()} != ${o.comp.join()}`;
    if (eComp.length && (!eAt || !o.at || eAt.x !== o.at.x || eAt.z !== o.at.z)) return tag + `spawn pos ${eAt && eAt.x},${eAt && eAt.z} != ${o.at && o.at.x},${o.at && o.at.z}`;
    if (raid.status !== 'stopped' && Math.abs(raid.bar.percent - J.pct) > 1e-9) return tag + `bar ${raid.bar.percent} != ${J.pct}`;
    if (raid.status === 'victory' && J.hero !== undefined && !J.heroChecked) { J.heroChecked = true; }
    if (raid.status === 'victory' && !J.gaveHero) { J.gaveHero = true; if (!ES.applied || ES.applied.amp !== J.hero || ES.applied.dur !== 48000) return tag + `hero ${JSON.stringify(ES.applied)} != amp ${J.hero}`; }
  }
  return null;
}
function run(label, hook) {
  const bad = []; let lanes = 0;
  for (const diff of ['easy', 'normal', 'hard']) for (let salt = 0; salt < 20; salt++) { lanes++; const r = lane(salt, diff, hook); if (r) bad.push(r); }
  return { bad, lanes };
}
const base = run('base');
for (const b of base.bad.slice(0, 6)) console.log('  DIVERGE ' + b);
ok(base.bad.length === 0, 'divergences');
// anti-vacuity: break the engine's own data and demand a divergence
const log = [];
const brk = (name, mut, undo) => { mut(); const r = run(name); undo(); if (r.bad.length) { breaks++; log.push(`   ✓ break caught: ${name} (${r.bad.length}/${r.lanes} lanes)`); } else { fails++; console.log(`  ✗ break NOT caught: ${name}`); } };
brk('one fewer pillager in wave 2', () => { Rd.MEMBERS.pillager[2]--; }, () => { Rd.MEMBERS.pillager[2]++; });
brk('hard raid has 6 waves', () => { Rd.MAX_WAVES.hard = 6; }, () => { Rd.MAX_WAVES.hard = 7; });
brk('first wave spawns at once (no 300 countdown)', () => { Rd.PRE_WAVE_HORN_TICKS = 140; }, () => { Rd.PRE_WAVE_HORN_TICKS = 300; });
brk('win delay 39', () => { Rd.POST_RAID_WIN_DELAY = 39; }, () => { Rd.POST_RAID_WIN_DELAY = 40; });
brk('hero duration 24000', () => { Rd.HERO_DURATION = 24000; }, () => { Rd.HERO_DURATION = 48000; });
brk('spawn ring radius 31', () => { Rd.SPAWN_RING_RADIUS = 31; }, () => { Rd.SPAWN_RING_RADIUS = 32; });
console.log(`${base.lanes} lanes, ${base.bad.length} divergences, ${breaks} breaks caught`);
for (const l of log) console.log(l);
process.exit(fails ? 1 : 0);
