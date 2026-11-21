#!/usr/bin/env node
// lockstep-explosiondamage -- #9214 (MOBPROOF-DAMAGE-3, part of #9203): explosion damage on a mob. Server half: lane `explosiondamage`
// (lanes.d, pilot.mjs --lanes explosiondamage): a NoAI zombie with a primed TNT (Fuse 20) 6 blocks along the corridor, Pos/Health/HurtTime
// per tick, run twice per salt on the real 1.18.2 server under the SeedAgent. The golden below is that server's trace (salt 0, identical
// on both reps): damage floor((s*s+s)/2*7*8+1) = 9 through armor 2 -> 20 - 8.856 = 11.144, HurtTime 10 counting down. The engine runs the same
// scene (real TntEntity -> Explosion.damageEntities -> Combat.hurt) and must match per tick: health, hurt timer, position.
import { engineZombieTrace, harnessM } from './referee/lockstep/zombielane.mjs';
import { compareTraces } from './referee/lockstep/trace.mjs';
import { startX } from './referee/chasescen.mjs';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const BLAST = 20, T = 60, F = ['health', 'hurtTime', 'pos'], FT = ['hurtTime'];   // exact fields: the blast tick and hurt timer match the server; health and pos are pinned KNOWN below
const R = (v) => Math.round(v * 1e3) / 1e3;
const ARMOR = 2;   // zombie generic.armor (jar golden)
// vanilla rules: LivingEntity.applyArmorToDamage: dmg * (1 - clamp(armor - dmg / (2 + toughness/4), armor/5, 20) / 25); HurtTime = 10 for a fresh hit
const armored = (d) => d * (1 - Math.min(20, Math.max(ARMOR - d / 2, ARMOR / 5)) / 25);
const SERVER_DMG = 9;   // raw explosion damage the server dealt (20 -> 11.144 through armor)
function vanilla() {
  const rows = []; let hp = 20, ht = 0;
  for (let t = 0; t < T; t++) {
    if (t === BLAST) { hp = hp - armored(SERVER_DMG); ht = 10; }
    else if (t > BLAST && ht > 0) ht--;
    rows.push({ tick: t, health: R(hp), hurtTime: ht, pos: [startX(), 0, 0.5] });
  }
  return rows;
}
function engine(patch) {
  let tnt = null;
  for (const n of ['Explosion', 'Tnt']) if (harnessM()[n] && harnessM()[n].init) harnessM()[n].init();
  const rows = engineZombieTrace(0, { noAI: true, T, onTick: (t, EL) => {
    if (t === 1) { tnt = EL.spawn('tnt', startX() + 6, 0, 0.5, { fuse: BLAST - 1, vx: 0, vy: 0, vz: 0 }); if (patch) patch(EL, tnt); }
  } });
  return rows.map((r) => ({ tick: r.tick, health: R(r.health), hurtTime: r.hurtTime, pos: r.pos.map(R) }));
}
let bad = 0, breaks = 0;
const ok = (c, m) => { if (!c) { bad++; console.log('FAIL ' + m); } };
const caught = (c, m) => { if (c) breaks++; else { bad++; console.log('NOT CAUGHT ' + m); } };
const V = vanilla(), E = engine();
// Health now matches (#9225: Explosion.getExposure's ray ending exactly on a face is a miss, Box.traceCollisionSide `t < 1.0`; the TNT is summoned
// with zero motion like the server's /summon). The NoAI zombie's Pos no longer moves, matching the server (knockback divergence fixed upstream).
ok(compareTraces(V, E, { fields: FT }) === null, 'hurt timer / blast tick diverged: ' + JSON.stringify(compareTraces(V, E, { fields: FT })));
const d1 = compareTraces(V, E, { fields: ['health'] }), d2 = compareTraces(V, E, { fields: ['pos'] });
ok(d1 === null, 'health diverged from the real server (#9225: exposure ray ending on a face is a miss): ' + JSON.stringify(d1));
ok(d2 === null, 'NoAI zombie position diverged from the server (knockback is now skipped): ' + JSON.stringify(d2));
ok(E.some((r) => r.health < 20), 'the blast never hurt the zombie');
const mut = (f, fn) => E.map((r, t) => (t === BLAST + 3 ? { ...r, [f]: fn(r[f]) } : r));
caught(compareTraces(V, mut('health', (h) => h + 0.5), { fields: ['health'] })?.tick === BLAST + 3, 'health moves');
caught(compareTraces(V, mut('hurtTime', (h) => h + 1), { fields: FT })?.field === 'hurtTime', 'hurt timer');
caught(compareTraces(V, mut('pos', (p) => [p[0] + 0.1, p[1], p[2]]), { fields: ['pos'] })?.tick === BLAST + 3, 'position moves');
caught(compareTraces(V, E.map((r, t) => (t >= BLAST ? { ...r, hurtTime: 0 } : r)), { fields: FT }) !== null, 'no damage');
const farTnt = engine((EL, tnt) => { tnt.x = startX() + 9; });
caught(farTnt.every((r) => r.health === 20), 'distance changes damage');
const dir = join(dirname(fileURLToPath(import.meta.url)), 'mobproof', 'out'); mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, 'damage-explosion.json'), JSON.stringify({ zombie: { pass: !bad, checked: ['explosion damage (floor((s*s+s)/2*7*diameter+1), armor 2) per tick vs the real-server lane explosiondamage', 'hurt timer', 'position under NoAI'], failed: bad ? ['see lockstep-explosiondamage'] : [], knownDivergences: [] } }));
for (let i = 0; i < breaks; i++) console.log("✓ break caught");
console.log(`explosiondamage: ${bad ? "FAILED" : "0 divergences"}: 9 assertions, ${bad} failures, ${breaks} breaks caught`);
process.exit(bad ? 1 : 0);
