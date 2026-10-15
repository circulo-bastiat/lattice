// lockstep-raid -- #6672 (G17-L101): lockstep scenario 'raid', 20 salts x 3 difficulties: a Bad Omen player in a village.
// Reference = .decomp Raid.Member count arrays (Raid.java:795-799), Raid.getBonusCount, Raid.getMaxWaves, Raid.tick (300-tick wave delay, 40-tick win delay),
// Raid.getRavagerSpawnLocation ring (64 +-5 blocks at tier 0), Raid.updateBar. Per tick: raid active flag, wave number, raiders alive, spawn positions, bar total, countdown, clear tick.
import { loadEngine } from '../loadsrc.mjs';
const M = loadEngine({ extra: ['07q_effects.js', '07s_raid.js'] });
const Rd = M.Raid, RM = M.RaidManager;
let fails = 0, breaks = 0, n = 0;
const ok = (c, m) => { n++; if (!c) { fails++; console.log('  FAIL ' + m); } };
const stream = (salt) => { let s = (salt * 2654435761 + 12345) >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; };
// independent copy of Raid.Member (vindicator, evoker, pillager, witch, ravager) -- indexed by wave 0..7
const REF = { vindicator: [0, 0, 2, 0, 1, 4, 2, 5], evoker: [0, 0, 0, 0, 0, 1, 1, 2], pillager: [0, 4, 3, 3, 4, 4, 4, 2], witch: [0, 0, 0, 0, 3, 0, 0, 1], ravager: [0, 0, 0, 1, 0, 1, 0, 2] };
const WAVES = { easy: 3, normal: 5, hard: 7 };
// bonus range per Raid.getBonusCount
function bonusMax(type, w, d) {
  if (type === 'witch') return (d === 'easy' || w <= 2 || w === 4) ? 0 : 1;
  if (type === 'pillager' || type === 'vindicator') return d === 'easy' ? 1 : d === 'normal' ? 1 : 2;
  return 0;
}
function lane(salt, diff, omen) {
  const r = stream(salt);
  const rand = { nextFloat: r, nextInt: (b) => Math.floor(r() * b) };
  const center = { x: 100 + salt, y: 64, z: -40 };
  const raid = Rd.create(1, center, diff);
  const ES = { getStatusEffect: () => ({ amplifier: omen - 1 }), removeStatusEffect() {} };
  Rd.start(raid, {}, ES);
  const bad = [];
  const hp = 20; let alive = [];
  const spawnFn = (type, pos) => { const m = { type, health: hp, x: pos.x, z: pos.z }; alive.push(m); return m; };
  const ctx = { isNearVillage: () => true, spawnFn, rand, heightAt: () => 64, ES: { addStatusEffect() {} }, heroEntities: {} };
  const total = WAVES[diff] + (omen > 1 ? 1 : 0);
  if (raid.waveCount !== WAVES[diff]) bad.push(`waveCount ${raid.waveCount} vs ${WAVES[diff]}`);
  let t = 0, clearT = -1, spawnT = [], victory = -1;
  for (let guard = 0; guard < 4000 && raid.status === Rd.Status.ONGOING; guard++) {
    t++;
    const before = raid.wavesSpawned;
    alive = [];
    Rd.tick(raid, ctx);
    if (raid.wavesSpawned !== before) {
      const w = raid.wavesSpawned, extra = w > WAVES[diff], idx = extra ? WAVES[diff] : w;
      spawnT.push(t);
      const cnt = {}; for (const m of alive) cnt[m.type] = (cnt[m.type] || 0) + 1;
      let sum = 0;
      for (const ty of Object.keys(REF)) {
        const ravLo = REF.ravager[idx], ravHi = ravLo + (extra && diff !== 'easy' ? 1 : 0);   // ravager riders (Raid.spawnNextWave $$7): wave 5 pillager; wave >=7 first evoker, rest vindicator
        const rid = (rv) => ty === 'pillager' && w === 5 ? rv : ty === 'evoker' && w >= 7 ? Math.min(rv, 1) : ty === 'vindicator' && w >= 7 ? Math.max(rv - 1, 0) : 0;
        const base = REF[ty][idx] + rid(ravLo), got = cnt[ty] || 0, hi = REF[ty][idx] + rid(ravHi) + bonusMax(ty, idx, diff) + (ty === 'ravager' && extra && diff !== 'easy' ? 1 : 0);
        if (ty === 'ravager' && !extra) { if (got !== base) bad.push(`wave ${w} ${ty} ${got} vs ${base}`); }
        else if (got < base || got > hi) bad.push(`wave ${w} ${ty} ${got} outside ${base}..${hi}`);
      }
      for (const m of alive) {
        if (m.type !== 'pillager' && m.type !== 'vindicator' && m.type !== 'witch' && m.type !== 'ravager' && m.type !== 'evoker') bad.push('type ' + m.type);
        const d = Math.hypot(m.x - center.x, m.z - center.z);
        if (d < 58 || d > 71) bad.push(`wave ${w} spawn ${d.toFixed(1)} blocks from centre`);
      }
      raid.raiders = alive.slice();
      Rd.updateBar(raid);
      for (const m of alive) sum += m.health;
      if (raid.totalHealth !== sum) bad.push(`wave ${w} bar total ${raid.totalHealth} vs ${sum}`);
      if (raid.bar.percent !== 1) bad.push(`wave ${w} bar percent ${raid.bar.percent}`);
      if (t > 1 && spawnT.length > 1 && t - clearT !== 301) bad.push(`wave ${w} spawned ${t - clearT} ticks after the clear, want 301`);
      // half the raiders die -> bar drops
      raid.raiders.splice(0, Math.floor(raid.raiders.length / 2)); Rd.updateBar(raid);
      if (!(raid.bar.percent < 1)) bad.push(`wave ${w} bar did not drop`);
      raid.raiders.length = 0; clearT = t; Rd.updateBar(raid);
    }
  }
  if (raid.status !== Rd.Status.VICTORY) bad.push('no victory, status ' + raid.status);
  if (spawnT.length !== total) bad.push(`${spawnT.length} waves spawned, want ${total}`);
  if (spawnT[0] !== 1) bad.push('wave 1 at tick ' + spawnT[0]);
  if (clearT >= 0 && t - clearT !== 41) bad.push(`victory ${t - clearT} ticks after the last clear, want 41`);
  return bad;
}
for (const d of ['easy', 'normal', 'hard']) for (let s = 0; s < 20; s++) { const b = lane(s, d, s % 2 ? 2 : 1); ok(!b.length, `raid ${d} salt ${s}: ${b[0]}`); }
const brk = (c, m) => { if (c) { breaks++; console.log('   ✓ break caught: ' + m); } else { fails++; console.log('  ✗ break NOT caught: ' + m); } };
{ const o = Rd.MEMBERS.pillager[1]; Rd.MEMBERS.pillager[1] = 7; const b = lane(0, 'normal', 1); Rd.MEMBERS.pillager[1] = o; brk(b.some((x) => /pillager/.test(x)), 'pillager wave-1 count 4->5: ' + b[0]); }
{ const o = Rd.PRE_WAVE_HORN_TICKS; Rd.PRE_WAVE_HORN_TICKS = 200; const b = lane(1, 'hard', 1); Rd.PRE_WAVE_HORN_TICKS = o; brk(b.some((x) => /301/.test(x)), 'countdown 300->200: ' + b[0]); }
{ const o = Rd.MAX_WAVES.hard; Rd.MAX_WAVES.hard = 6; const b = lane(2, 'hard', 1); Rd.MAX_WAVES.hard = o; brk(b.length > 0, 'hard waves 7->6: ' + b[0]); }
console.log(`lockstep-raid: ${n + breaks} assertions, ${fails} failures, ${breaks} breaks caught`);
process.exit(fails ? 1 : 0);
