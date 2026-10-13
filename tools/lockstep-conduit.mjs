#!/usr/bin/env node
// lockstep-conduit -- #6800 (G17-L149): lockstep scenario 'conduit', 20 salts. A conduit at (0,10,0) in a water cube with a frame of 15..42
// prismarine-family blocks (one frame block is removed mid-run), a player, a drowned and a skeleton drifting through the 8-block zone.
// BE.tickConduit is compared per tick with ConduitBlockEntity.serverTick/updateActivatingBlocks/givePlayersEffects/attackHostileEntity
// (.decomp): 40-tick rescan, active at >= 16, eye at >= 42, range (n/7)*16, conduit_power 260 re-applied every 40, the hunting target
// (random wet Monster in the box expanded by 8, kept while alive and < 8 from the block), damage 4, the sound ids, rotation.
import { loadEngine } from './loadsrc.mjs';

const SALTS = 20, TICKS = 480, CX = 0, CY = 10, CZ = 0;
const stream = (salt) => { let s = (salt * 2654435761 + 977) >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; };
const MATS = ['prismarine', 'prismarine_bricks', 'sea_lantern', 'dark_prismarine'];
const ring = [];
for (let x = -2; x <= 2; x++) for (let y = -2; y <= 2; y++) for (let z = -2; z <= 2; z++) {
  const ax = Math.abs(x), ay = Math.abs(y), az = Math.abs(z);
  if ((ax > 1 || ay > 1 || az > 1) && ((x === 0 && (ay === 2 || az === 2)) || (y === 0 && (ax === 2 || az === 2)) || (z === 0 && (ax === 2 || ay === 2)))) ring.push([x, y, z]);
}
function scen(salt) {
  const r = stream(salt), n = salt === 1 ? 42 : salt === 2 ? 15 : salt === 3 ? 16 : salt === 4 ? 43 - 1 : 16 + Math.floor(r() * 27);
  const order = ring.map((p) => [r(), p]).sort((a, b) => a[0] - b[0]).map((a) => a[1]).slice(0, n);
  const frame = order.map((p, i) => [p, MATS[(i + salt) % 4]]);
  const mk = (type, x0, dx) => ({ type, x: x0, y: CY - 1 + r() * 2, z: (r() - 0.5) * 10, dx, width: 0.6, height: 1.95, inWater: true, health: 20, dead: false });
  const ents = [mk('drowned', 4 + r() * 4, 0.04 + r() * 0.03), mk('skeleton', 9 + r() * 3, -(0.03 + r() * 0.03))];
  const player = { x: 3 + r() * 30, y: CY + r() * 3, z: (r() - 0.5) * 20, dx: (r() - 0.5) * 0.2, wetUntil: 150 + Math.floor(r() * 200), dead: false };
  return { frame, ents, player, breakAt: 100 + Math.floor(r() * 150), breakIdx: Math.floor(r() * n) };
}

function world(sc, S) {
  const cells = new Map(), k = (x, y, z) => x + ',' + y + ',' + z, water = S.stateOf('water');
  for (let x = -1; x <= 1; x++) for (let y = -1; y <= 1; y++) for (let z = -1; z <= 1; z++) cells.set(k(CX + x, CY + y, CZ + z), water);
  for (const [p, m] of sc.frame) cells.set(k(CX + p[0], CY + p[1], CZ + p[2]), S.stateOf(m));
  return { cells, k, water, getBlock: (x, y, z) => cells.get(k(x, y, z)) || 0 };
}
const fl = Math.fround;

function engine(salt, patch) {
  const M = loadEngine({ patch, extra: ['07c_blockentity.js'], dom: false });
  const sc = scen(salt), W = world(sc, M.States), r = stream(salt + 5000), log = [];
  M.World = W;
  M.Sound = { play: (n) => log.push('S' + n) };
  M.Effects = { addStatusEffect: (en, id, d, a) => log.push('E' + id + ',' + d + ',' + a) };
  M.Combat = { hurt: (en, amt) => { log.push('H' + en.type + ',' + amt); en.health -= amt; if (en.health <= 0) en.dead = true; } };
  M.Tame = { isMonster: (t) => t === 'drowned' || t === 'skeleton' };
  M.Use = { touchingWaterOrRain: (p) => p.wet };
  M.EntityList = { list: sc.ents, random: r };
  M.Behave = { gameTime: 0 };
  const P = M.Player = Object.assign({}, sc.player);
  const e = { type: 'conduit', x: CX, y: CY, z: CZ, ticks: 0, ticksActive: 0, active: false, eyeOpen: false, frame: [] };
  const rows = [];
  for (let t = 0; t < TICKS; t++) {
    M.Behave.gameTime = t; log.length = 0;
    if (t === sc.breakAt) { const [p] = sc.frame[sc.breakIdx]; W.cells.set(W.k(CX + p[0], CY + p[1], CZ + p[2]), 0); }
    P.wet = t < sc.player.wetUntil;
    M.BlockEntities.tickConduit(e);
    rows.push(snap(e, sc.ents, log, M.BlockEntities.conduitRotation(e, 0.5)));
    for (const en of sc.ents) en.x += en.dx; P.x += sc.player.dx;
  }
  return rows;
}
const snap = (e, ents, log, rot) => [e.active, e.eyeOpen, e.frame.length, e.ticks, e.ticksActive, (e.target && e.target.type) || '-', ents.map((x) => x.health).join('/'), rot, log.join(';')].join('|');

// independent transcription of ConduitBlockEntity.serverTick (.decomp:96-125, 131-230)
function reference(salt, o = {}) {
  const sc = scen(salt), r = stream(salt + 5000), MIN = o.min || 16, RNG = o.range || 16, DUR = o.dur || 260, DMG = o.dmg || 4, ATK = o.atk || 8;
  const ents = sc.ents, P = Object.assign({}, sc.player), blocks = new Map(sc.frame.map(([p, m]) => [p.join(','), m]));
  let ticks = 0, tA = 0, active = false, eye = false, frame = 0, target = null, nextAmb = 0;
  const rows = [];
  for (let t = 0; t < TICKS; t++) {
    const log = []; ticks++;
    if (t === sc.breakAt) blocks.delete(sc.frame[sc.breakIdx][0].join(','));
    const wet = t < sc.player.wetUntil;
    if (t % 40 === 0) {
      frame = blocks.size;                       // the 3x3x3 is water throughout; every block in the map is on the ring
      const on = frame >= MIN;
      if (on !== active) log.push(on ? 'Sblock.conduit.activate' : 'Sblock.conduit.deactivate');
      active = on; eye = frame >= 42;
      if (on) {
        const rad = Math.trunc(frame / 7) * RNG, px = Math.floor(P.x), py = Math.floor(P.y), pz = Math.floor(P.z);
        if (px * px + (py - CY) * (py - CY) + pz * pz < rad * rad && wet) log.push('Econduit_power,' + DUR + ',0');
        if (frame < 42) target = null;
        else if (!target) {
          const c = ents.filter((x) => !x.dead && x.x - 0.3 < CX + 9 && x.x + 0.3 > CX - 8 && x.y < CY + 9 && x.y + 1.95 > CY - 8 && x.z - 0.3 < CZ + 9 && x.z + 0.3 > CZ - 8);
          if (c.length) target = c[Math.floor(r() * c.length)];
        } else {
          const dx = Math.floor(target.x), dy = Math.floor(target.y) - CY, dz = Math.floor(target.z);
          if (target.dead || dx * dx + dy * dy + dz * dz >= ATK * ATK) target = null;
        }
        if (target) { log.push('Sblock.conduit.attack.target'); log.push('H' + target.type + ',' + DMG); target.health -= DMG; if (target.health <= 0) target.dead = true; }
      }
    }
    if (active) {
      tA++;
      if (t % 80 === 0) log.push('Sblock.conduit.ambient');
      if (t > nextAmb) { nextAmb = t + 60 + Math.floor(r() * 40); log.push('Sblock.conduit.ambient.short'); }
    }
    rows.push([active, eye, frame, ticks, tA, (target && target.type) || '-', ents.map((x) => x.health).join('/'), fl((tA + 0.5) * -0.0375), log.join(';')].join('|'));
    for (const en of ents) en.x += en.dx; P.x += sc.player.dx;
  }
  return rows;
}
function run(o = {}) {
  let bad = 0, first = '', hunted = 0, eyes = 0, acts = 0, effs = 0;
  for (let salt = 1; salt <= SALTS; salt++) {
    const a = engine(salt, o.patch), b = reference(salt, o);
    for (let i = 0; i < TICKS; i++) if (a[i] !== b[i]) { bad++; if (!first) first = `salt ${salt} tick ${i}: engine ${a[i]} ref ${b[i]}`; break; }
    if (!o.patch && !o.min && !o.range && !o.dur && !o.dmg && !o.atk) for (const row of b) { if (row.includes('Hdrowned') || row.includes('Hskeleton')) hunted++; if (row.split('|')[1] === 'true') eyes++; if (row.startsWith('true')) acts++; if (row.includes('Econduit_power')) effs++; }
  }
  return { bad, first, hunted, eyes, acts, effs };
}
let fails = 0, breaks = 0; const notes = [];
const base = run();
if (base.bad) { fails++; console.log(`  FAIL ${base.bad} divergences; first: ${base.first}`); }
if (!base.hunted || !base.eyes || !base.acts || !base.effs) { fails++; console.log('  FAIL vacuous: ' + JSON.stringify(base)); }
const brk = [
  ['reference frame minimum 16->17', { min: 17 }],
  ['reference range 16->8', { range: 8 }],
  ['reference duration 260->220', { dur: 220 }],
  ['reference damage 4->3', { dmg: 3 }],
  ['reference hunt radius 8->6', { atk: 6 }],
  ['engine frame minimum 16->17', { patch: (f, s) => f === '07c_blockentity.js' ? s.replace('e.frame.length >= 16', 'e.frame.length >= 17') : s }],
  ['engine effect 260->200', { patch: (f, s) => f === '07c_blockentity.js' ? s.replace("'conduit_power', 260", "'conduit_power', 200") : s }],
];
for (const [name, o] of brk) {
  const d = run(o);
  if (d.bad) { breaks++; notes.push(`   ✓ ${name} caught: ${d.first}`); } else { fails++; console.log(`  FAIL ${name} not caught`); }
}
console.log(`${brk.length + 2 - fails} assertions, ${fails} failures, ${breaks} breaks caught (${SALTS} salts, ${base.bad} divergences)`);
notes.forEach((n) => console.log(n));
process.exit(fails ? 1 : 0);
