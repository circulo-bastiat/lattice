// raidcaptainlockstepcheck.mjs -- #8725 (G18f-L19): lockstep scenario 'raidcaptain', 20 salts: a pillager patrol leader wearing the ominous banner killed by a player
// at no Bad Omen and at levels 1..5, a non-leader pillager, a leader without the banner, an outpost captain, a non-player killer.
// Reference = .decomp RaiderEntity.onDeath (:131-160): level = 1 + amplifier (old effect removed) else 0; clamp(0,4); duration 120000; only when patrol leader + banner + player.
import { loadEngine } from '../loadsrc.mjs';
const M = loadEngine({ extra: ['07_world.js', '07b_behaviour.js', '07h_entities.js', '07y_equip.js', '07q_effects.js', '07v_spell.js', '07s_raid.js'] });
const Rd = M.Raid, ES = M.Effects;
let fails = 0, breaks = 0, cells = 0;
const ok = (c, m) => { if (!c) { fails++; console.log('  FAIL ' + m); } };
const brk = (c, m) => { if (c) { breaks++; console.log('   ✓ break caught: ' + m); } else { fails++; console.log('  ✗ break NOT caught: ' + m); } };
const stream = (salt) => { let s = (salt * 2654435761 + 12345) >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; };
// vanilla model: returns the expected {amp,dur} or null (no effect change)
function want(v, cur) {
  if (!(v.patrolLeader && v.ominousBanner && v.byPlayer)) return cur;
  let l = 1; if (cur) l += cur.amp; else l--;
  l = Math.max(0, Math.min(4, l));
  return { amp: l, dur: 120000 };
}
function lane(salt) {
  const out = [], r = stream(salt);
  const kinds = [
    { n: 'leader', patrolLeader: true, ominousBanner: true, byPlayer: true },
    { n: 'nonleader', patrolLeader: false, ominousBanner: false, byPlayer: true },
    { n: 'nonleader-banner', patrolLeader: false, ominousBanner: true, byPlayer: true },
    { n: 'nobanner', patrolLeader: true, ominousBanner: false, byPlayer: true },
    { n: 'outpost', patrolLeader: true, ominousBanner: true, byPlayer: true, outpost: true },
    { n: 'mobkill', patrolLeader: true, ominousBanner: true, byPlayer: false },
  ];
  for (const k of kinds) for (let lvl = -1; lvl <= 4; lvl++) {
    const p = { effects: {} };
    let cur = null;
    if (lvl >= 0) { const dur = 1000 + Math.floor(r() * 100000); ES.addStatusEffect(p, 'bad_omen', dur, lvl, false, false); cur = { amp: lvl, dur }; }
    const v = { type: 'pillager', patrolLeader: k.patrolLeader, ominousBanner: k.ominousBanner };
    Rd.onPatrolLeaderDeath(v, k.byPlayer ? p : null, ES);
    const w = want(k, cur), got = ES.getStatusEffect(p, 'bad_omen');
    const g = got ? { amp: got.amplifier, dur: got.duration } : null;
    if (JSON.stringify(g) !== JSON.stringify(w)) out.push(`salt ${salt} ${k.n} lvl${lvl}: got ${JSON.stringify(g)} want ${JSON.stringify(w)}`);
    cells++;
  }
  return out;
}
const pass = () => Array.from({ length: 20 }, (_, i) => i).flatMap(lane);
const base = pass();
ok(base.length === 0, 'lane: ' + base.slice(0, 3).join(' | '));
ok(cells >= 720, 'lane covers ' + cells + ' cells');
const c = Rd.PATROL_BAD_OMEN_CLAMP, d = Rd.PATROL_BAD_OMEN_DURATION;
Rd.PATROL_BAD_OMEN_CLAMP = 5;
brk(pass().length > 0, 'stack cap 5 instead of 4 caught');
Rd.PATROL_BAD_OMEN_CLAMP = 3;
brk(pass().length > 0, 'stack cap 3 caught');
Rd.PATROL_BAD_OMEN_CLAMP = c; Rd.PATROL_BAD_OMEN_DURATION = 12000;
brk(pass().length > 0, 'duration 12000 caught');
Rd.PATROL_BAD_OMEN_DURATION = d;
brk(pass().length === 0, 'unfaulted lane passes after restore');
console.log(`raidcaptainlockstepcheck: ${3 + breaks} assertions, ${fails} failures, ${breaks} breaks caught`);
process.exit(fails ? 1 : 0);
