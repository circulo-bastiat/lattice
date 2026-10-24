#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEngine } from '../loadsrc.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const ASSETS = join(ROOT, 'assets');



const M = loadEngine({
  extra: ['02f_tags.js', '02g_items.js', '14f_inventory.js', '07h_entities.js', '14b_physics.js',
          '07d_mining.js', '07e_loot.js', '07i_entitylist.js', '07y_equip.js', '07m_breed.js',
          '07w_passive.js', '07zd_slime.js', '14d_survival.js', '14j_combat.js', '07ox_enchhelper.js',
          '07p_trade.js', '07zz_xporb.js', '14g_menu.js'],
  initReg: false
});
M.DATA = Object.assign({}, M.DATA, {
  entities: JSON.parse(readFileSync(join(ASSETS, 'entities.json'), 'utf8'))
});
M.Entities.init();
{
  const meta = JSON.parse(readFileSync(join(ASSETS, 'items.meta.json'), 'utf8'));
  M.Items.init({ items: readFileSync(join(ASSETS, 'items.bin')).toString('base64'), itemsBytes: meta.rawBytes });
}
{
  const lootMeta = JSON.parse(readFileSync(join(ASSETS, 'loot.meta.json'), 'utf8'));
  M.Loot.init({ loot: readFileSync(join(ASSETS, 'loot.bin')).toString('base64'), lootBytes: lootMeta.jsonBytes });
}
// a floor at y=64, the entlistcheck/tamecheck idiom -- motion is arithmetic, not terrain
const FLOOR_Y = 64;
M.Physics.shapeAt = (x, y, z) => (y < FLOOR_Y ? M.Physics.FULL_CUBE : null);
M.Physics.blockAt = () => 0; // air: Ph.move reads it for fluids, no World loaded
M.Physics.solidAt = (x, y, z) => M.Physics.shapeAt(x, y, z) !== null;
M.Physics.grounded = (x, y, z, d) => y - d < FLOOR_Y;
M.EntityList.init();
M.Equip.init();
M.Breed.init();
M.Passive.init();
M.Xp.init();


const EL = M.EntityList, Xp = M.Xp;
// lockstep-xpmerge -- #8795 (G17-L245): 12 mixed-value orbs in two clusters 1 block apart, player 6 blocks away, 120 ticks.
// Reference (written here, not asking Xp) = .decomp ExperienceOrbEntity.tick/expensiveUpdate/merge/roundToOrbSize/onPlayerCollision:
// age%20==1 refresh, target = nearest player within 8, box expand(0.5) vs 0.5-wide orb (|d|<1.0), same amount and (id diff)%40==0,
// pickingCount sum, age min, pull = unit vector * (1-dist/8)^2 * 0.1 toward player y+eye/2, 6000 despawn, pickup delay 2.
const REF_SIZES = [2477, 1237, 617, 307, 149, 73, 37, 17, 7, 3, 1];
const refRound = (v) => { for (const s of REF_SIZES) if (v >= s) return s; return 1; };
const stream = (salt) => { let s = (salt * 2654435761 + 8795) >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; };
let fails = 0, breaks = 0;
const ok = (c, m) => { if (!c) { fails++; console.log('  FAIL ' + m); } };
const EYE = 1.62, HALF = 0.25;
function lane(salt) {
  const r = stream(salt), BX = 2000 + salt * 40, BZ = 2000;
  for (const o of EL.list.slice()) if (o.type === 'experience_orb') EL.remove(o);
  const P = { x: BX + 6, y: 64, z: BZ, width: 0.6, height: 1.8, eyeHeight: EYE, dead: false, PICKUP_INFLATE: [1.0, 0.5, 1.0], xpPickupDelay: 0 };
  M.Survival.init(P); M.Player = P;
  const orbs = [];
  for (let i = 0; i < 12; i++) {
    const total = [1, 3, 7, 17, 20, 37][Math.floor(r() * 6)] + (r() < 0.3 ? 3 : 0), v = refRound(total);
    if (Xp.roundToOrbSize(total) !== v) return { t: -1, what: `roundToOrbSize(${total}) ${Xp.roundToOrbSize(total)} != ${v}` };
    const cl = i % 2, o = EL.spawn('experience_orb', BX + cl * 1 + r() * 0.5, 64, BZ + r() * 0.5);
    o.value = v; o.pickingCount = 1; o.orbAge = Math.floor(r() * 30); o.removed = false; o.xpTarget = false;
    o.id = 100000 + salt * 1000 + (r() < 0.7 ? 40 * Math.floor(r() * 3) : 1 + Math.floor(r() * 39));
    orbs.push(o);
  }
  let delay = 0; const gotRef = [], gotEng = [];
  for (let t = 0; t < 120; t++) {
    for (const e of orbs.slice()) {
      if (e.removed) continue;
      const age1 = e.orbAge + 1;
      let target = e.xpTarget, cnt = e.pickingCount, age = e.orbAge;
      const gone = [];
      if (age1 % 20 === 1) {
        const d2 = (P.x - e.x) ** 2 + (P.y - e.y) ** 2 + (P.z - e.z) ** 2;
        target = d2 < 64;   // getClosestPlayer(this, 8.0)
        for (const o of orbs) {
          if (o === e || o.removed || o.value !== e.value || (o.id - e.id) % 40 !== 0) continue;
          if (Math.abs(o.x - e.x) < HALF * 2 + 0.5 && Math.abs(o.z - e.z) < HALF * 2 + 0.5 && o.y < e.y + 0.5 + 0.5 && o.y + 0.5 > e.y - 0.5) { cnt += o.pickingCount; age = Math.min(age, o.orbAge); gone.push(o); }
        }
      }
      let dv = [0, 0, 0];
      if (target) {
        const dx = P.x - e.x, dy = P.y + EYE / 2 - e.y, dz = P.z - e.z, q = dx * dx + dy * dy + dz * dz;
        if (q < 64) { const s = 1 - Math.sqrt(q) / 8, f = s * s * 0.1, n = Math.sqrt(q); dv = [dx / n * f, dy / n * f, dz / n * f]; }
      }
      // engine pull on a clone (age parked off the refresh) must add exactly dv
      const c = { ...e, orbAge: 5, xpTarget: target }; Xp.pull(c);
      const pv = [c.vx - e.vx, c.vy - e.vy, c.vz - e.vz];
      if (pv.some((x, i) => Math.abs(x - dv[i]) > 1e-12)) return { t, what: `pull ${pv} != ${dv}` };
      EL.tickOne(e);
      const exAge = age + 1, despawn = exAge >= 6000;
      if (e.removed !== despawn || (!despawn && (e.pickingCount !== cnt || e.orbAge !== exAge))) return { t, what: `orb ${e.id}: count ${e.pickingCount}/${cnt} age ${e.orbAge}/${exAge} removed ${e.removed}` };
      for (const o of gone) if (!o.removed) return { t, what: `orb ${o.id} not merged into ${e.id}` };
      if (gone.length === 0 && age1 % 20 === 1) for (const o of orbs) if (!o.removed && o.id !== e.id && false) return {};
    }
    // pickup: delay counts down first, then the first touched orb (list order) is taken
    if (delay > 0) delay--;
    let exp = 0, exOrb = null;
    if (delay === 0) for (const o of orbs) {
      if (o.removed) continue;
      if (o.x + HALF < P.x - 0.3 - 1 || o.x - HALF > P.x + 0.3 + 1 || o.y + 0.5 < P.y - 0.5 || o.y > P.y + 1.8 + 0.5 || o.z + HALF < P.z - 0.3 - 1 || o.z - HALF > P.z + 0.3 + 1) continue;
      exp = o.value; exOrb = o; delay = 2; break;
    }
    const cb = exOrb ? exOrb.pickingCount : 0, got = Xp.pickupTick();
    if (got !== exp) return { t, what: `pickup ${got} != ${exp}` };
    if (exOrb && exOrb.pickingCount !== cb - 1) return { t, what: 'pickingCount after pickup' };
    if (got) gotEng.push(t);
  }
  return { ok: true, picked: gotEng.length, merged: orbs.filter((o) => o.removed).length };
}
const run = () => { const res = []; for (let s = 0; s < 20; s++) res.push(lane(s)); return res; };
const base = run(), bad = base.filter((x) => !x.ok);
ok(!bad.length, `${bad.length}/20 salts diverge ${bad[0] ? JSON.stringify(bad[0]) : ''}`);
ok(base.some((x) => x.merged > 0), 'scenario merges at least one orb');
ok(base.some((x) => x.picked > 0), 'scenario reaches a pickup');
const brk = (c, m) => { if (c) { breaks++; console.log('   ✓ break caught: ' + m); } else { fails++; console.log('  ✗ break NOT caught: ' + m); } };
const rr = Xp.roundToOrbSize; Xp.roundToOrbSize = (v) => (v >= 17 && v < 37 ? 7 : rr(v));
brk(run().some((x) => !x.ok), 'rounding bucket table off by one entry (17 -> 7)'); Xp.roundToOrbSize = rr;
const fr = Xp.FOLLOW_RANGE, fq = Xp.FOLLOW_RANGE_SQ; Xp.FOLLOW_RANGE = 7; Xp.FOLLOW_RANGE_SQ = 49;
brk(run().some((x) => !x.ok), 'attraction radius 8 -> 7'); Xp.FOLLOW_RANGE = fr; Xp.FOLLOW_RANGE_SQ = fq;
console.log(`xpmergecheck: ${20 + 3 + breaks} assertions, ${fails} failures, ${breaks} breaks caught`);
process.exit(fails ? 1 : 0);
