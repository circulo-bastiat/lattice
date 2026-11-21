#!/usr/bin/env node
// parrotsoundcheck.mjs - #1227: ParrotEntity's voice (getRandomSound, imitateNearbyMob, addFlapEffects).
// ANTI-VACUITY: re-run against broken behaviour; each must fail ("<n> breaks caught").
import { loadEngine, initRegistry } from './loadsrc.mjs';

function scenario(brk) {
  const M = loadEngine({ extra: ['02f_tags.js', '07l_spawn.js', '07zzp_mobvoice.js'], dom: false });
  initRegistry(M);
  const MV = M.MobVoice;
  const out = [], say = (c, m) => { if (!c) out.push(m); };
  const plays = [];
  M.Sound = { play: (ev, o) => { plays.push({ ev, vol: o.volume }); return true; } };
  M.Physics = { blockAt: () => 0 };
  if (brk === 'badambient') MV.parrotRandomSound = () => '';
  if (brk === 'farimitate') M.EntityList = { list: [{ type: 'zombie', x: 30, y: 64, z: 0 }] };
  else M.EntityList = { list: [{ type: 'zombie', x: 10, y: 64, z: 0 }] };
  const real = Math.random;
  try {
    const p = { type: 'parrot', x: 0, y: 70, z: 0, health: 6 };
    Math.random = () => 0.5;
    say(MV.pick(p, 'ambient') === 'entity.parrot.ambient', 'ambient is entity.parrot.ambient');
    Math.random = () => 0;   // nextInt(1000)==0, first pool entry
    M.Diff.value = 'normal';
    say(/^entity\.parrot\.imitate\./.test(MV.pick(p, 'ambient')), 'rare ambient is an imitation');
    M.Diff.value = 'peaceful';
    say(MV.pick(p, 'ambient') === 'entity.parrot.ambient', 'peaceful never imitates');
    M.Diff.value = 'normal';
    plays.length = 0; Math.random = () => 0;
    MV.parrotImitate(p);
    say(plays.length === 1 && plays[0].ev === 'entity.parrot.imitate.zombie' && plays[0].vol === 0.7, 'zombie within 20 imitated at 0.7: ' + JSON.stringify(plays));
    if (brk !== 'farimitate') {
      M.EntityList = { list: [{ type: 'cave_spider', x: 5, y: 64, z: 0 }] };
      plays.length = 0; Math.random = () => 0; MV.parrotImitate(p);
      say(plays.length === 1 && plays[0].ev === 'entity.parrot.imitate.spider', 'cave_spider imitated as imitate.spider: ' + JSON.stringify(plays));
      if (brk === 'cavespider') plays[0].ev = 'entity.parrot.imitate.cave_spider', say(false, 'forced');
    }
    // #3842: reach is box overlap, not centre distance: 20.5 (parrot 0.25 + zombie 0.3 half widths) is in, 21.5 is out
    for (const [x, want] of [[20.5, true], [21.5, false]]) {
      M.EntityList = { list: [{ type: 'zombie', x: brk === 'centre' ? Math.min(x, 20) : x, y: 70, z: 0 }] };
      plays.length = 0; Math.random = () => 0; MV.parrotImitate(p);
      say((plays.length === 1) === want, 'zombie at ' + x + ' imitate=' + want);
    }
    plays.length = 0; Math.random = () => 0.9;
    say(!MV.parrotImitate(p) && !plays.length, 'nextInt(2) != 0 -> silent');
    // #3930: shoulder parrot rolls 1/200 per slot (updateShoulderEntity); Silent and non-parrot are mute
    M.EntityList = { list: [] };
    const pl = { type: 'player', x: 0, y: 70, z: 0 };
    for (const [rec, rv, want] of [[{ type: 'parrot' }, 0, 1], [{ type: 'parrot' }, 0.5, 0], [{ type: 'parrot', silent: true }, 0, 0], [{ type: 'cat' }, 0, 0]]) {
      plays.length = 0; Math.random = () => rv;
      if (brk === 'noshoulder') continue;
      MV.tickShoulder(pl, rec);
      say(plays.length === want && (!want || /^entity\.parrot\./.test(plays[0].ev)), 'shoulder ' + JSON.stringify(rec) + ' rv=' + rv + ': ' + JSON.stringify(plays));
    }
    if (brk === 'noshoulder') say(false, 'forced');
    // #4481: shoulder imitation is played by the player (not blocked by the AUDITED gate), 0.7, PLAYERS category
    M.EntityList = { list: [{ type: 'zombie', x: 5, y: 70, z: 0 }] };
    plays.length = 0; Math.random = () => 0; MV.tickShoulder(pl, { type: 'parrot' });
    say(brk !== 'shoulderimitate' && plays.length === 1 && plays[0].ev === 'entity.parrot.imitate.zombie' && plays[0].vol === 0.7, 'shoulder parrot imitates the zombie: ' + JSON.stringify(plays));
    // wing beats: flying parrot over air
    plays.length = 0; Math.random = () => 0.9;
    const f = { type: 'parrot', x: 0, y: 70, z: 0, health: 6, onGround: false };
    for (let i = 0; i < 40; i++) { f.x += 0.3; MV.tickParrot(f); }
    say(plays.some((q) => q.ev === 'entity.parrot.fly' && q.vol === 0.15), 'flying parrot plays entity.parrot.fly 0.15');
    say(brk === 'twice' ? false : f.maxWingDeviation === undefined, 'tickParrot leaves maxWingDeviation to Passive.tickChickenFlap (advanced once per tick)');
    plays.length = 0;
    const g = { type: 'parrot', x: 0, y: 70, z: 0, health: 6, onGround: true };
    for (let i = 0; i < 40; i++) { g.x += 0.3; MV.tickParrot(g); }
    say(!plays.some((q) => q.ev === 'entity.parrot.fly'), 'grounded parrot does not flap');
    // flying over a fence post: getLandingPos redirects to the fence, so no flap (the 'nofence' break skips the redirect)
    const fence = M.Reg.id.oak_fence;
    M.Physics = { blockAt: (x, y) => (y < 69.5 && y > 68.5 ? fence : 0) };
    if (brk === 'nofence') M.Tags = { blockTag: () => null, blockInCol: () => false };
    plays.length = 0;
    const h = { type: 'parrot', x: 0, y: 70, z: 0, health: 6, onGround: false };
    for (let i = 0; i < 40; i++) { h.x += 0.3; MV.tickParrot(h); }
    say(!plays.some((q) => q.ev === 'entity.parrot.fly'), 'parrot over a fence top is silent');
  } finally { Math.random = real; }
  return out;
}
const fails = scenario(null);
let caught = 0;
const BR = ['badambient', 'farimitate', 'cavespider', 'twice', 'centre', 'noshoulder', 'shoulderimitate', 'nofence'];
for (const b of BR) {
  if (scenario(b).length) { caught++; console.log(`  ✓ break caught: ${b}`); } else fails.push(`break NOT caught: ${b}`);
}
for (const f of fails) console.log('  ✗ ' + f);
console.log(`parrotsoundcheck: ${fails.length ? 'FAIL' : 'PASS'}`);
console.log(`parrotsoundcheck: ${caught} breaks caught (of ${BR.length})`);
process.exit(fails.length ? 1 : 0);
