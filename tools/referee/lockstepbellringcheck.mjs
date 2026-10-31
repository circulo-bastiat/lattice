// lockstep-bellring -- #7949 (G18f-L12): lockstep scenario 'bell', 20 salts: raiders + villagers around a bell rung by hand / arrow / redstone.
// Reference = .decomp BellBlockEntity.tick/activate/raidersHearBell/applyGlowToRaiders: ringTicks counts to 50, resonate starts at ringTicks>=5 with a raider within 32,
// 40 ticks later every live raider within 48 gets Glowing 60; BellBlock.ring -> notifyMemoriesOfBell stamps HEARD_BELL_TIME on villagers within 32. Per tick the whole state is compared.
import { loadEngine } from '../loadsrc.mjs';
const M = loadEngine({ extra: ['07s_raid.js', '07zv7_vbbell.js'], dom: false });
let fails = 0, breaks = 0;
const ok = (c, m) => { if (!c) { fails++; console.log('  FAIL ' + m); } };
const stream = (salt) => { let s = (salt * 2654435761 + 777) >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; };
const bes = new Map(), events = [];
M.GameEvent = { emit: (n) => events.push(n) };
M.BlockEntities = { get: (x, y, z) => bes.get(x + ',' + y + ',' + z), create: (x, y, z, t) => { const b = { x, y, z, type: t }; bes.set(x + ',' + y + ',' + z, b); return b; } };
M.Effects = { addStatusEffect: (e, id, dur) => { (e.fx = e.fx || []).push([id, dur]); } };
M.EntityList = { list: [] };
const RT = ['pillager', 'vindicator', 'evoker', 'ravager', 'witch', 'illusioner'];
const SIDES = ['north', 'south', 'east', 'west'];
// independent reference of one bell
function ref(bx, by, bz, ents) {
  const s = { ringing: false, ticks: 0, resT: 0, res: false }, w = (e, d) => { const dx = e.x - (bx + .5), dy = e.y - (by + .5), dz = e.z - (bz + .5); return dx * dx + dy * dy + dz * dz < d * d; };
  const raider = (e, d) => !e.dead && RT.includes(e.type) && w(e, d);
  return {
    s, activate() { if (s.ringing) s.ticks = 0; else s.ringing = true; s.resT = 0; s.res = false; },
    tick() {
      if (s.ringing) s.ticks++;
      if (s.ticks >= 50) { s.ringing = false; s.ticks = 0; }
      if (s.ticks >= 5 && s.resT === 0 && ents.some((e) => raider(e, 32))) s.res = true;
      if (s.res) { if (s.resT < 40) s.resT++; else { ents.forEach((e) => { if (raider(e, 48)) e.rfx = (e.rfx || 0) + 60; }); s.res = false; } }
    },
  };
}
const dist = (e, bx, by, bz) => Math.hypot(e.x - (bx + .5), e.y - (by + .5), e.z - (bz + .5));
// independent reference of HideWhenBellRings + ForgetBellRing: heard at age h, hides, hidden ticks counted at home, forgotten at h+300 or after 300 hidden ticks
function lane(salt) {
  const r = stream(salt), bx = 10, by = 64, bz = -5, mode = salt % 3;   // 0 use, 1 arrow, 2 redstone
  bes.clear(); events.length = 0;
  const ents = [], at = (d) => { const a = r() * 6.283; return { x: bx + .5 + Math.cos(a) * d, y: by + .5, z: bz + .5 + Math.sin(a) * d }; };
  ents.push({ type: ['pillager', 'vindicator', 'evoker'][salt % 3], ...at(10 + r() * 20) }, { type: 'pillager', ...at(40 + r() * 6) });
  [10, 30, 40].forEach((d, i) => { const p = at(d + (i === 1 ? 1.5 : 0)); const v = { type: 'villager', vbAge: 100 + salt, ...p }; if (r() < .6) v.vbHome = { x: Math.floor(p.x), y: by, z: Math.floor(p.z) }; ents.push(v); });
  M.EntityList.list = ents;
  const R = ref(bx, by, bz, ents), side = SIDES[Math.floor(r() * 4)];
  const rs = new Map();
  const ring = (t) => {
    if (mode === 0 || t === 0) M.VBBell.ring(bx, by, bz, side); else M.VBBell.ring(bx, by, bz, side);
    R.activate();
    for (const e of ents) if (e.type === 'villager') { const s = rs.get(e) || { h: null, hid: false, ht: 0 }; rs.set(e, s); if (dist(e, bx, by, bz) < 32) s.h = e.vbAge; }
  };
  ring(0);
  const be = bes.get(bx + ',' + by + ',' + bz);
  if (!be || be.lastSideHit !== side) return 'no bell entity / side';
  if (events.filter((n) => n === 'ring_bell').length !== 1) return 'ring_bell game event count ' + events.length;
  const rerings = mode === 1 ? [20] : mode === 2 ? [30] : [];
  for (let t = 1; t <= 400; t++) {
    if (rerings.includes(t)) ring(t);
    R.tick(); M.Bell.tick(be);
    const a = [be.ringing, be.ticks, be.resonateTime, be.resonating].join(), b = [R.s.ringing, R.s.ticks, R.s.resT, R.s.res].join();
    if (a !== b) return `tick ${t} state ${a} vs ref ${b}`;
    for (const e of ents) if (e.type === 'villager') {
      e.vbAge++;
      const hid = M.VBBell.tick(e, e.vbAge), s = rs.get(e);
      let exp = false;
      if (s.h !== null) {
        if (!s.hid) { s.hid = true; s.ht = 0; }
        if (s.ht <= 300 && s.h + 300 > e.vbAge) { if (e.vbHome && Math.hypot(e.vbHome.x + .5 - e.x, e.vbHome.y + .5 - e.y, e.vbHome.z + .5 - e.z) < 3) s.ht++; exp = true; }
        else { s.h = null; s.hid = false; s.ht = 0; }
      }
      if (hid !== exp) return `tick ${t} villager hide ${hid} vs ref ${exp}`;
    }
  }
  for (const e of ents) {
    const g = (e.fx || []).reduce((n, f) => n + (f[0] === 'glowing' ? f[1] : 0), 0);
    if (g !== (e.rfx || 0)) return `${e.type} glow ${g} vs ${e.rfx || 0}`;
  }
  return null;
}
let hides = 0;
for (let s = 0; s < 20; s++) { const r = lane(s); ok(!r, `bellring salt ${s}: ${r}`); if (M.EntityList.list.some((e) => e.rfx)) hides++; }
ok(hides > 5, `salts exercise glow (${hides})`);
const brk = (c, m) => { if (c) { breaks++; console.log('   ✓ break caught: ' + m); } else { fails++; console.log('  ✗ break NOT caught: ' + m); } };
const any = () => { for (let s = 0; s < 20; s++) if (lane(s)) return true; return false; };
{ const o = M.Effects.addStatusEffect; M.Effects.addStatusEffect = (e, id, d) => o(e, id, 100); brk(any(), 'glow duration 60 -> 100'); M.Effects.addStatusEffect = o; }
{ const o = M.VBBell.HEAR_DIST; M.VBBell.HEAR_DIST = 48; brk(any(), 'villager hearing range 32 -> 48'); M.VBBell.HEAR_DIST = o; }
{ const o = M.VBBell.HEAR_DIST; M.VBBell.HEAR_DIST = 24; brk(any(), 'villager hearing range 32 -> 24'); M.VBBell.HEAR_DIST = o; }
{ const o = M.VBBell.HEARD_WINDOW; M.VBBell.HEARD_WINDOW = 200; brk(any(), 'hide window 300 -> 200'); M.VBBell.HEARD_WINDOW = o; }
{ const t = M.Bell.tick; M.Bell.tick = (b) => { t(b); if (b.ticks === 49) { b.ringing = false; b.ticks = 0; } }; brk(any(), 'ring ends at 49 ticks'); M.Bell.tick = t; }
console.log(`lockstep-bellring: ${20 + breaks} assertions, ${fails} failures, ${breaks} breaks caught`);
process.exit(fails ? 1 : 0);
