// raidercelebratelockstepcheck.mjs -- #8727 (G18b-L46): lockstep scenario 'raidercelebrate', 20 salts: pillager, vindicator and witch after a lost raid
// (Raid.hasLost) run CelebrateGoal; a raider walking to a dropped ominous banner runs PickupBannerAsLeaderGoal.
// Reference = .decomp RaiderEntity.CelebrateGoal (canStart: alive, no target, raid.hasLost; start/stop setCelebrating; tick: nextInt(100)==0 sound, !hasVehicle && nextInt(50)==0 jump)
// and PickupBannerAsLeaderGoal (canLead, no living wave captain, banner within 16x8x16; loot when the target is within 1.414; patrolLeader/captain set on loot).
import { loadEngine } from '../loadsrc.mjs';
const M = loadEngine({ extra: ['07_world.js', '07b_behaviour.js', '07h_entities.js', '07y_equip.js', '07q_effects.js', '07v_spell.js', '07s_raid.js', '07k_goals.js'] });
const Ai = M.Ai, Rd = M.Raid;
let fails = 0, breaks = 0, cells = 0;
const ok = (c, m) => { if (!c) { fails++; console.log('  FAIL ' + m); } };
const brk = (c, m) => { if (c) { breaks++; console.log('   ✓ break caught: ' + m); } else { fails++; console.log('  ✗ break NOT caught: ' + m); } };
const stream = (salt) => { let s = (salt * 2654435761 + 12345) >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; };
const list = [];
M.EntityList = { list, randomOf: (e) => e.rnd, remove: (o) => { o.removed = true; } };
M.Sound = Object.assign(M.Sound || {}, { mobSound: () => {} });
const raid = { status: Rd.Status.LOSS, waveCaptain: {} };
M.RaidManager = { world: { raids: { 1: raid } } };
const BANNER = { i: 1, t: { b: 1 } };
M.Equip.isOminousBanner = (s) => !!s && s.t && s.t.b === 1;
M.Items = { HEAD: 5 }; Object.assign(M.Equip, { getEquipped: () => null, setEquipped() {}, setDropChance() {}, dropChance: () => 0, getOminousBanner: () => BANNER });
Ai.stepToward = () => {}; Ai.closeTo = () => false;
let promoteRange = 0;   // break knob: widen the pickup range
Ai.findPath = (x, y, z, tx, ty, tz) => [{ x, y, z }, { x: tx, y: ty, z: tz }];
const mk = (type, x, rnd) => ({ type, x, y: 64, z: 0, raidId: 1, wave: 1, rnd, height: 1.95 });

function celebrate(salt) {
  const out = [];
  ['pillager', 'vindicator', 'witch'].forEach((type, ti) => {
    const seed = stream(salt * 3 + ti), ref = stream(salt * 3 + ti);
    const e = mk(type, 0, seed);
    const g = new Ai.CelebrateGoal(e, {});
    let wantCel = false, jumps = 0, wantJumps = 0, sounds = 0, wantSounds = 0;
    M.Sound.mobSound = () => sounds++;
    for (let t = 0; t < 400; t++) {
      const loss = t >= 20 && t < 380, tgt = t >= 200 && t < 230;   // raid lost; a combat target interrupts for 30 ticks
      raid.status = loss ? Rd.Status.LOSS : Rd.Status.ONGOING; e.target = tgt ? {} : null;
      const can = !e.target && loss;
      if (can && !wantCel) wantCel = true; else if (!can && wantCel) wantCel = false;
      if (wantCel && !wantJumps && false) { /* unreachable */ }
      if (g.__on && !g.canContinueToUse()) { g.stop(); g.__on = false; }
      else if (!g.__on && g.canUse()) { g.start(); g.__on = true; }
      e.jumping = false;
      if (g.__on) g.tick();
      if (wantCel) { if (ref() < 1 / 100) wantSounds++; if (ref() < 1 / 50) { wantJumps++; if (!e.jumping) out.push(`salt ${salt} ${type} t${t}: no jump pulse`); } else if (e.jumping) out.push(`salt ${salt} ${type} t${t}: unwanted jump`); }
      if (!!e.celebrating !== wantCel) out.push(`salt ${salt} ${type} t${t}: celebrating ${!!e.celebrating} want ${wantCel}`);
      if (e.jumping) jumps++;
      cells++;
    }
    if (jumps !== wantJumps) out.push(`salt ${salt} ${type}: jumps ${jumps} want ${wantJumps}`);
    if (sounds !== wantSounds) out.push(`salt ${salt} ${type}: sounds ${sounds} want ${wantSounds}`);
  });
  return out;
}

function pickup(salt) {
  const out = [], r = stream(salt + 500);
  raid.status = Rd.Status.ONGOING;
  for (const type of ['pillager', 'vindicator', 'witch']) {
    for (const dx of [0.5, 1, 1.3, 2, 3.5, 10, 20]) {
      const jitter = Math.floor(r() * 4) / 100;
      list.length = 0; raid.waveCaptain = {};
      const e = mk(type, 100, stream(salt)), it = { type: 'item', item: BANNER.i, tag: BANNER.t, x: 100 + dx + jitter, y: 64, z: 0 };
      list.push(e, it);
      const g = new Ai.PickupBannerAsLeaderGoal(e, {});
      const lead = !!Rd.CAN_LEAD[type], inBox = dx <= 16;
      const started = g.canUse();
      if (started !== (lead && inBox)) out.push(`salt ${salt} ${type} dx${dx}: canUse ${started}`);
      let got = -1;
      if (started) {
        g.start();
        for (let t = 0; t < 60 && got < 0; t++) {
          if (promoteRange && Math.abs(it.x - e.x) <= promoteRange) e.x = it.x;
          g.tick();
          if (e.headItem === 'ominous_banner') got = t;
          else { const d = it.x - e.x; if (d * d > 2.0) e.x += Math.sign(d) * Math.min(Math.abs(d), 0.35); }
        }
        // reference: walk 0.35/tick until the target is within 1.414, then loot on that tick
        let x = 100, want = -1;
        for (let t = 0; t < 60 && want < 0; t++) { const d = it.x - x; if (Math.abs(d) <= 1.414) want = t; else x += Math.sign(d) * Math.min(Math.abs(d), 0.35); }
        if (want < 0 || Math.abs(dx) < 0) want = -1;
        if (dx > 0.0 && got !== want) out.push(`salt ${salt} ${type} dx${dx}: pickup tick ${got} want ${want}`);
        if (got >= 0 && !(it.removed && e.patrolLeader && raid.waveCaptain[1] === e)) out.push(`salt ${salt} ${type} dx${dx}: leader flag/captain/item not updated`);
        if (got < 0 && (e.patrolLeader || it.removed)) out.push(`salt ${salt} ${type} dx${dx}: partial pickup`);
      }
      cells++;
    }
  }
  return out;
}
const pass = () => Array.from({ length: 20 }, (_, i) => i).flatMap((s) => celebrate(s).concat(pickup(s)));
const base = pass();
ok(base.length === 0, 'lane: ' + base.slice(0, 3).join(' | '));
ok(cells > 1000, 'lane covers ' + cells + ' cells');
const realC = Ai.CelebrateGoal;
Ai.CelebrateGoal = function (e, c) { const g = new realC(e, c); const t = g.tick; g.tick = function () { t.call(g); e.jumping = false; }; return g; };
brk(pass().length > 0, 'dropped celebration jump caught');
Ai.CelebrateGoal = function (e, c) { const g = new realC(e, c); const s = g.start; g.start = function () { s.call(g); e.celebrating = false; }; return g; };
brk(pass().length > 0, 'celebrating flag never set caught');
Ai.CelebrateGoal = realC;
promoteRange = 2;
brk(pass().length > 0, 'banner pickup range changed to 2 blocks caught');
promoteRange = 0;
brk(pass().length === 0, 'unfaulted lane passes after restore');
console.log(`raidercelebratelockstepcheck: ${3 + breaks} assertions, ${fails} failures, ${breaks} breaks caught`);
process.exit(fails ? 1 : 0);
