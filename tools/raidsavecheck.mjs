#!/usr/bin/env node
// raidsavecheck.mjs — #5783: an ongoing raid survives save/load (raids.dat: RM.toJSON/fromJSON + raiders' RaidId,
// relinked by RM.relink after MobNbt.restoreAll). A saved-and-reloaded raid must advance exactly like an unsaved twin.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';
let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const okAv = (c, m) => { breaks++; if (c) pass++; else fails.push('anti-vacuity: ' + m); };
const EXTRA = ['02f_tags.js', '02g_items.js', '14f_inventory.js', '07_world.js', '07b_behaviour.js',
  '07h_entities.js', '14b_physics.js', '07i_entitylist.js', '14i_hand.js', '14j_combat.js',
  '07k_goals.js', '07l_spawn.js', '07o_profession.js', '07q_effects.js', '07s_raid.js',
  '09b_sky.js', '07x_patrol.js', '07y_equip.js', '07zw_mobnbt.js'];
const L = loadEngine({ extra: EXTRA, dom: false });
L.DATA = Object.assign({}, L.DATA, {
  entities: JSON.parse(readFileSync(join(MCLITE_ROOT, 'assets', 'entities.json'), 'utf8'))
});
L.Entities.init();
{
  const imeta = JSON.parse(readFileSync(join(MCLITE_ROOT, 'assets', 'items.meta.json'), 'utf8'));
  L.Items.init({ items: readFileSync(join(MCLITE_ROOT, 'assets', 'items.bin')).toString('base64'), itemsBytes: imeta.rawBytes });
}
L.Ai.init();
L.EntityList.init();
L.Hand.init();
L.Combat.init();
L.Profession.init();
L.Effects.ready = true;
L.Equip.init();
L.Raid.init();
L.Patrol.init();
ok(L.Raid.ready && L.RaidManager.ready && !!L.RaidManager.world,
  'the live engine\'s Raid/RaidManager report ready with a live raid table (RM.world, Rd.init\'s own singleton)');
ok(L.EntityList.canSpawn('pillager') === true,
  'mob existence is closed (loop/illagers-s92) — EL.spawn actually places a pillager in this engine');

const Lrd = L.Raid, Lrm = L.RaidManager, LW = L.World, LCH = L.CH, LEL = L.EntityList;
const warmLive = () => { for (let t = 0; t < 400; t++) { Lrd.tickLive(L); const r = Object.values(Lrm.world.raids)[0]; if (r && r.wavesSpawned > 0) break; } };   // the jar's Raid waits 300 ticks (preRaidTicks) before wave 1
const LProf = L.Profession, LES = L.Effects, LCb = L.Combat;
const Lstate = (n) => L.States.stateOf(n) | 0;
const LSTONE = Lstate('stone');
const LWORKSTATION = Lstate('lectern');
const PLAT_Y = 8;

// a ring candidate's angle is a REAL random draw in `Rd.buildLiveCtx` (unlike §9's own
// deterministic one), so the platform below has to cover the WHOLE disk `Rd.ringSpawnPos`
// can land in (tier 0's own 64-block radius + up to 5 jitter, any direction), not just one
// spot on it — a thin strip only covering one angle would fail nondeterministically.
function freshWorld() {
  LW.init(1);
  L.Behave.init(LW);
  for (let cx = -5; cx <= 5; cx++) for (let cz = -5; cz <= 5; cz++) {
    const c = LW.makeChunk(cx, cz);
    c.state = LCH.GENERATED;
    LW.chunks.set(LW.key(cx, cz), c);
  }
  ok(LW.loadedAt(0, 0), 'a chunk is loaded to place into');
}
// `W.heightAt` reads a chunk's own baked `hmap` (07_world.js:1424-1428), which `setBlock` never
// updates (it is only baked at worldgen time) — a synthetic column needs it set by hand, or
// every live spawn-height lookup below would read the sentinel WORLD_MIN_Y-1, not the platform.
function plateWithHeightmap(x0, x1, z0, z1, y) {
  for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) LW.setBlock(x, y, z, LSTONE);
  const touched = new Set();
  for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) touched.add((x >> 4) + ',' + (z >> 4));
  for (const key of touched) {
    const [cx, cz] = key.split(',').map(Number);
    const c = LW.get(cx, cz);
    for (let lx = 0; lx < 16; lx++) for (let lz = 0; lz < 16; lz++) {
      const wx = (cx << 4) + lx, wz = (cz << 4) + lz;
      if (wx < x0 || wx > x1 || wz < z0 || wz > z1) continue;
      c.hmap[(lz << 4) | lx] = y - L.CFG.WORLD_MIN_Y;
    }
  }
}
function mkLivePlayer(over) {
  return Object.assign({ x: 0, y: PLAT_Y + 1, z: 0, yaw: 0, pitch: 0, vx: 0, vz: 0, onGround: true }, over || {});
}
// a deterministic ring pick (mkRand's own shape, defined at the top of this file): nextFloat

L.MobNbt.ready = true;
const MN = L.MobNbt;

// Build: raid in wave 1, two raiders dead. mode: 'twin' (untouched) | 'saved' (round-trip) | 'broken' (round-trip, no relink)
function scenario(mode) {
  freshWorld();
  plateWithHeightmap(-75, 75, -75, 75, PLAT_Y);
  LEL.list.length = 0; Lrm.world = Lrm.create();
  const wp = { x: 2, y: PLAT_Y + 1, z: 0 };
  LW.setBlock(wp.x, wp.y, wp.z, LWORKSTATION);
  LProf.claimed = {};
  LProf.tryClaim({ id: 900, type: 'villager', x: 1, y: PLAT_Y + 1, z: 0, profession: 'none' });
  const player = mkLivePlayer({ x: 3, y: PLAT_Y + 1, z: 0 });
  L.Player = player;
  LES.addStatusEffect(player, 'bad_omen', 1000, 2, false, true);
  warmLive();
  let raid = Object.values(Lrm.world.raids)[0];
  const info = { start: raid && raid.wavesSpawned };
  for (let i = 0; i < 2; i++) { const m = raid.raiders[0]; m.dead = true; Lrd.handleRaiderDeath(Lrm.world, m, undefined); m.removed = true; LEL.list.splice(LEL.list.indexOf(m), 1); }
  info.left0 = raid.raiders.length; info.bad0 = raid.badOmenLevel; info.status0 = raid.status; info.id = raid.id;
  if (mode !== 'twin') {
    const rj = JSON.parse(JSON.stringify(Lrm.toJSON(Lrm.world)));
    const recs = JSON.parse(JSON.stringify(MN.serializeAll()));
    LEL.list.length = 0; Lrm.world = Lrm.create();
    Lrm.fromJSON(Lrm.world, rj);
    MN.restoreAll(recs);
    if (mode === 'saved') Lrm.relink(Lrm.world, LEL.list);
    raid = Lrm.world.raids[info.id];
  }
  info.has = !!raid;
  if (!raid) return info;
  info.wave1 = raid.wavesSpawned; info.left1 = raid.raiders.length; info.bad1 = raid.badOmenLevel; info.status1 = raid.status;
  info.captain = !!raid.waveCaptain[1];
  for (const m of raid.raiders.slice()) { m.dead = true; Lrd.handleRaiderDeath(Lrm.world, m, undefined); m.removed = true; const k = LEL.list.indexOf(m); if (k >= 0) LEL.list.splice(k, 1); }
  for (let t = 0; t < 700; t++) Lrd.tickLive(L);
  const r2 = Lrm.world.raids[info.id];
  info.wave2 = r2 ? r2.wavesSpawned : -1; info.status2 = r2 ? r2.status : 'gone';
  return info;
}
const twin = scenario('twin');
ok(twin.start === 1 && twin.left0 >= 2, 'twin: wave 1 live, raiders left after two kills: ' + JSON.stringify(twin));
const saved = scenario('saved');
ok(saved.has, 'raid exists after load');
ok(saved.wave1 === 1 && saved.bad1 === saved.bad0 && saved.status1 === 'ongoing', 'wave/badOmen/status survive: ' + JSON.stringify(saved));
ok(saved.left1 === saved.left0, 'raiders left relinked: ' + saved.left1 + ' vs ' + saved.left0);
ok(saved.wave2 === twin.wave2 && saved.wave2 === 2, 'killing the rest advances to wave 2 like the twin: ' + saved.wave2 + ' vs ' + twin.wave2);
const broken = scenario('broken');
okAv(broken.left1 === 0 && broken.left0 > 0, 'without relink the raid diverges from the twin: ' + JSON.stringify(broken));
okAv(MN.serializeAll !== undefined && twin.bad0 === 3, 'bad omen amplifier 2 -> level 3 in the twin, so the level check is not vacuous');

console.log('\n' + (fails.length ? 'FAIL' : 'PASS') + '  raidsave: ' + breaks + ' breaks caught, ' + pass + ' ok, ' + fails.length + ' failed');
for (const f of fails) console.log('   x ' + f);
process.exit(fails.length ? 1 : 0);
