#!/usr/bin/env node
// vbhidehome11668check.mjs -- #11668: proves 07zv8_vbhidehome.js (HideInHomeTask, HideInHomeDuringRaidTask) is
// reached from 07zv_villagerbrain.js VB.tick (activity 'hide'/'raid' -> VBHideHome.hideTick/raidTick) and that its
// rules decide the outcome on a stub villager. '<n> breaks caught'.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const rd = (f) => readFileSync(join(ROOT, 'src', f), 'utf8');
let fails = 0; const ok = (c, m) => { if (!c) { fails++; console.log('FAIL ' + m); } };
const vb = rd('07zv_villagerbrain.js');
ok(/activity === 'raid'\) NS\.VBHideHome\.raidTick\(e\)/.test(vb), 'reach: VB.tick calls raidTick');
ok(/activity === 'hide'\) NS\.VBHideHome\.hideTick\(e\)/.test(vb), 'reach: VB.tick calls hideTick');

function scenario(edit) {
  const calls = [];
  const NS = { VB: { WALK_SPEED: 0.1 }, Poi: { HOME: 'home', STATUS: { ANY: 1 },
      getPosition: (pred, _a, _s, bp, d) => { calls.push(d); return NS.__home; } },
    Ai: { findPath: () => [{}, {}, {}], stepToward: (e, p, s) => { calls.push('s' + s.toFixed(3)); }, closeTo: () => false },
    RaidManager: { world: {}, getRaidAt: () => NS.__raid } };
  let s = readFileSync(join(ROOT, 'src', '07zv8_vbhidehome.js'), 'utf8');
  if (edit) { if (!s.includes(edit[0])) throw new Error('edit target missing: ' + edit[0]); s = s.replace(edit[0], edit[1]); }
  new Function('MCL', s)(NS);
  const HH = NS.VBHideHome, out = {};
  const mk = (o) => Object.assign({ x: 0.5, y: 64, z: 0.5 }, o);
  NS.__home = { x: 10, y: 64, z: 0 };
  let e = mk({}); out.hide = HH.hideTick(e) + JSON.stringify(e.vbHidingPlace); out.c1 = calls.splice(0).join();
  NS.__raid = null; e = mk({}); out.noRaid = HH.raidTick(e); NS.__raid = { status: 'victory' }; out.endRaid = HH.raidTick(mk({}));
  NS.__raid = { status: 'ongoing' }; calls.length = 0; e = mk({}); out.raid = HH.raidTick(e); out.c2 = calls.splice(0).join();
  NS.__home = null; e = mk({}); out.nohome = HH.hideTick(e) + String(e.vbHidingPlace);
  e = mk({ vbHome: { x: 3, y: 64, z: 3 } }); out.memHome = HH.hideTick(e) + JSON.stringify(e.vbHidingPlace);
  NS.__home = { x: 0, y: 64, z: 0 }; calls.length = 0; e = mk({}); HH.hideTick(e); out.arrived = calls.join() + String(e.vbHHWalk);
  return JSON.stringify(out);
}
const base = scenario(); const o = JSON.parse(base);
ok(o.hide === 'true{"x":10,"y":64,"z":0}', 'hide: ' + o.hide);
ok(o.c1 === '32,s0.125', 'hide dist/speed ' + o.c1);
ok(o.noRaid === false && o.endRaid === false, 'raid gate');
ok(o.raid === true && o.c2 === '24,s0.140', 'raid dist/speed ' + o.c2);
ok(o.nohome === 'falseundefined', 'no home ' + o.nohome);
ok(o.memHome === 'true{"x":3,"y":64,"z":3}', 'home memory');
ok(o.arrived === '32null', 'arrived no walk ' + o.arrived);
const breaks = [
  [['HH.HIDE_DIST = 32;', 'HH.HIDE_DIST = 16;'], 'hide dist'],
  [['HH.HIDE_SPEED = 1.25', 'HH.HIDE_SPEED = 1'], 'hide speed'],
  [['HH.RAID_DIST = 24;', 'HH.RAID_DIST = 8;'], 'raid dist'],
  [['HH.RAID_SPEED = 1.4', 'HH.RAID_SPEED = 1'], 'raid speed'],
  [["r.status !== 'ongoing'", "false"], 'raid status gate'],
  [['if (!r || ', 'if ('], 'raid null gate'],
  [['return e.vbHome || null;', 'return null;'], 'home memory'],
  [['if (!home) return false; ', 'if (!home) return true; '], 'no-home result'],
  [['if (!within(e, home, HH.COMPLETION)) step', 'if (true) step'], 'completion range'],
];
let caught = 0;
for (const [ed, name] of breaks) {
  let got; try { got = scenario(ed); } catch (e) { got = 'throw'; }
  if (got !== base) caught++; else { fails++; console.log('NOT CAUGHT ' + name); }
}
console.log(`vbhidehome11668check -- ${fails ? fails + ' FAIL' : 'ok'}; ${caught} breaks caught`);
process.exit(fails || caught !== breaks.length ? 1 : 0);
