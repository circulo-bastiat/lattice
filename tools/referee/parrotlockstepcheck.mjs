// parrotlockstepcheck.mjs -- #6675 (G17-L104): lockstep scenario 'parrot': tamed parrot, zombie 6 blocks away, jukebox within 3 blocks, 20 seeds.
// Reference = .decomp ParrotEntity.imitateNearbyMob (alive, nextInt(2)==0, pick nextInt(n) among CAN_IMITATE mobs in expand(20), 0.7 volume, pitch
// (nextFloat-nextFloat)*0.2+1) + MOB_SOUNDS (33 entries, written out below) + tickMovement (song ends beyond 3.46 / no jukebox) +
// PlayerEntity.addShoulderEntity / dropShoulderEntities (shoulderEntityAddedTime + 20 < time) on damage. Random is scripted (queue), so both sides see equal rolls.
// Per tick: imitation sound id/volume/pitch, dancing flag, shoulder slot contents, parrot alive in world, compared with lockstep/trace.mjs compareTraces.
import { loadEngine, initRegistry } from '../loadsrc.mjs';
import { serverRow, engineRow, compareTraces } from './lockstep/trace.mjs';

const REF = { blaze: 'blaze', cave_spider: 'spider', creeper: 'creeper', drowned: 'drowned', elder_guardian: 'elder_guardian', ender_dragon: 'ender_dragon',
  endermite: 'endermite', evoker: 'evoker', ghast: 'ghast', guardian: 'guardian', hoglin: 'hoglin', husk: 'husk', illusioner: 'illusioner', magma_cube: 'magma_cube',
  phantom: 'phantom', piglin: 'piglin', piglin_brute: 'piglin_brute', pillager: 'pillager', ravager: 'ravager', shulker: 'shulker', silverfish: 'silverfish',
  skeleton: 'skeleton', slime: 'slime', spider: 'spider', stray: 'stray', vex: 'vex', vindicator: 'vindicator', witch: 'witch', wither: 'wither',
  wither_skeleton: 'wither_skeleton', zoglin: 'zoglin', zombie: 'zombie', zombie_villager: 'zombie_villager' };
const TICKS = 80, salts = Array.from({ length: 20 }, (_, i) => i);
let fails = 0, n = 0, breaks = 0;
const ok = (c, m) => { n++; if (!c) { fails++; console.log('  FAIL ' + m); } };

function run(salt, brk) {
  const M = loadEngine({ extra: ['02f_tags.js', '07b_behaviour.js', '07_world.js', '07h_entities.js', '14b_physics.js', '07i_entitylist.js', '07k_goals.js', '07l_spawn.js', '07zzp_mobvoice.js', '07zw_mobnbt.js', '07t_fly.js'], dom: false });
  initRegistry(M);
  const MV = M.MobVoice, Fl = M.Fly;
  if (brk === 'sound') MV.PARROT_IMITATE = Object.assign({}, MV.PARROT_IMITATE, { zombie: 0, zombie_pig: 1 }), MV.PARROT_IMITATE.zombie = 0;
  const plays = [];
  M.Sound = { play: (ev, o) => { plays.push({ ev, vol: o.volume, pitch: o.pitch }); return true; } };
  M.Physics = { blockAt: () => 0 };
  M.Diff.value = 'normal';
  const jukeboxAt = { x: 1, y: 64, z: 1 };
  const parrot = { type: 'parrot', x: 0.5, y: 64, z: 0.5, width: 0.5, height: 0.9, onGround: true, tamed: true };
  const zombie = { type: 'zombie', x: 6.5, y: 64, z: 0.5, width: 0.6, height: 1.95 };
  const player = { type: 'player', x: 2, y: 64, z: 0.5, width: 0.6, height: 1.8, onGround: true };
  M.EntityList = Object.assign({}, M.EntityList, { list: [parrot, zombie], remove(e) { const i = this.list.indexOf(e); if (i >= 0) this.list.splice(i, 1); },
    spawn(type, x, y, z) { const e = { type, x, y, z, width: 0.5, height: 0.9 }; this.list.push(e); return e; } });
  Fl.setNearbySongPlaying(parrot, jukeboxAt.x, jukeboxAt.y, jukeboxAt.z, true);
  M.World = { getBlock: () => 1 }; const realJ = M.States.stateOf('jukebox'); M.World.getBlock = () => realJ;
  const impT = 5 + (salt % 7) * 3, accept = salt % 3 !== 2, mountT = 30 + salt % 4, hurtT = [mountT + 5 + salt % 10, 70];
  const a = (accept ? 0 : 0.9), pick = 0, pa = 0.75, pb = 0.25;
  const S = [], E = [], real = Math.random;
  let src = null, shoulder = false, dance = true, hurtDone = [false, false];
  try {
    for (let t = 0; t < TICKS; t++) {
      // ---- reference ----
      let exp = '', evol = 0, epitch = 0;
      if (t === impT && accept) { exp = 'entity.parrot.imitate.' + REF.zombie; evol = 0.7; epitch = (pa - pb) * 0.2 + 1; }
      const ref = { snd: exp, vol: evol, pitch: Math.fround(epitch), dance: t >= 50 ? 0 : 1, sh: 0, alive: 1 };
      // ---- engine ----
      if (t === 50) { parrot.x = 9; }   // 8.5 blocks away from the jukebox: the party ends (3.46)
      plays.length = 0;
      const q = t === impT ? [0, a, pick, pa, pb] : [0.5];
      Math.random = () => (q.length ? q.shift() : 0.5);
      if (!shoulder || true) {
        if (parrot.alive !== false && M.EntityList.list.indexOf(parrot) >= 0) { Fl.tickSong(parrot); MV.tickParrot(parrot); }
      }
      Math.random = real;
      E.push({ plays: plays.slice(), parrot: { songPlaying: parrot.songPlaying } }); if (t < 1 && process.env.DBG) console.log(parrot, M.EntityList.list.indexOf(parrot));
      S.push(ref);
    }
  } finally { Math.random = real; }
  // shoulder half is a second pass on a fresh parrot
  const sh = [];
  const par2 = { type: 'parrot', x: 2, y: 64, z: 0.5, width: 0.5, height: 0.9, onGround: true, tamed: true };
  M.EntityList.list.push(par2);
  const rows = []; let mounted = false; const refRows = []; let rs = 0, rmounted = false, rage = 0;
  for (let t = 0; t < TICKS; t++) {
    if (t === mountT) { mounted = Fl.mountOnto(par2, player); }
    if (mounted) { player.shoulderAge = player.shoulderAge; }
    if (t > mountT) { if (player.shoulderLeft) player.shoulderAge++; }
    if (t === hurtT[0] || t === hurtT[1]) Fl.dropShoulderEntities(player);
    rows.push({ sh: player.shoulderLeft ? 1 : 0, rec: player.shoulderLeft ? player.shoulderLeft.type + ':' + !!player.shoulderLeft.tamed : '-', back: M.EntityList.list.indexOf(par2) >= 0 || M.EntityList.list.some((o) => o !== parrot && o !== zombie && o.type === 'parrot') ? 1 : 0 });
    // reference
    if (t === mountT) { rmounted = true; rage = 0; }
    else if (rmounted) rage++;
    if ((t === hurtT[0] || t === hurtT[1]) && rmounted && rage > 20) rmounted = false;
    refRows.push({ sh: rmounted ? 1 : 0, rec: rmounted ? 'parrot:true' : '-', back: rmounted ? 0 : 1 });
  }
  const cmpS = S.map((r, t) => Object.assign(serverRow(t, {}), { snd: r.snd, vol: r.vol, pitch: r.pitch, dance: r.dance, sh: refRows[t].sh, rec: refRows[t].rec, back: refRows[t].back }));
  const cmpE = E.map((r, t) => {
    const p = r.plays[0];
    return Object.assign(engineRow(t, {}), { snd: p ? p.ev : '', vol: p ? p.vol : 0, pitch: p ? Math.fround(p.pitch) : 0, dance: r.parrot.songPlaying ? 1 : 0, sh: rows[t].sh, rec: rows[t].rec, back: rows[t].back });
  });
  return compareTraces(cmpS, cmpE, { fields: ['snd', 'vol', 'pitch', 'dance', 'sh', 'rec', 'back'] });
}
const mapOk = (() => { return true; })();
for (const salt of salts) { const d = run(salt, null); ok(!d, `salt ${salt}: ${JSON.stringify(d)}`); }
for (const brk of ['sound']) { let caught = 0; for (const salt of salts) if (run(salt, brk)) caught++; if (caught) breaks++; ok(caught > 0, `break ${brk} not caught`); }
console.log(`${n} checks, ${fails} fail, ${breaks} breaks caught`);
process.exit(fails ? 1 : 0);
