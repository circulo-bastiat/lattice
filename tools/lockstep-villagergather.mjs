#!/usr/bin/env node
// lockstep-villagergather -- #8875 (G18f-L24): lockstep scenario 'villagergather', 20 salts x 30 ticks. A farmer/butcher/librarian villager with item entities on the ground (bread, wheat, wheat_seeds, stick,
// diamond) and a second villager within 5 blocks (squared). Per tick, engine vs an independent reference written from .decomp (VillagerEntity.canGather/GATHERABLE_ITEMS/loot, VillagerProfession gatherable
// sets, GatherItemsVillagerTask.giveHalfOfStack, LookTargetUtil.give): both 8-slot inventories, the ground item counts and the thrown stacks (item, count, velocity). compareTraces, exact doubles.
// EL.dropStack is intercepted on the engine side (records the throw, spawns nothing); the reference records the same tuple.
import { readFileSync } from 'node:fs';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';
import { compareTraces } from './referee/lockstep/trace.mjs';

const A = MCLITE_ROOT + '/assets/', rdj = (f) => JSON.parse(readFileSync(A + f, 'utf8'));
const EXTRA = ['02f_tags.js', '02g_items.js', '07_world.js', '07b_behaviour.js', '07c_blockentity.js', '07d_mining.js', '07e_loot.js', '07h_entities.js', '07y_equip.js', '14b_physics.js', '14c_raycast.js',
  '07i_entitylist.js', '07l_spawn.js', '14d_survival.js', '14f_inventory.js', '14j_combat.js', '14l_use.js', '07za_explosion.js', '07m_breed.js', '07q_effects.js', '07zu_poi.js', '07o_profession.js',
  '07k_goals.js', '14j_combat.js', '07zv_villagerbrain.js', '07zv4_vbidle.js', '07zv5_vbbreed.js', '07zv6_vbgather.js'];
const M = loadEngine({ extra: EXTRA, dom: false });
M.Items.init({ items: readFileSync(A + 'items.bin').toString('base64'), itemsBytes: rdj('items.meta.json').rawBytes });
M.DATA = Object.assign({}, M.DATA, { entities: rdj('entities.json') });
M.Entities.init(); M.Entities.attrs = M.DATA.entities.attrs; M.Effects.ready = true;
const W = M.World, CH = M.CH, R = M.Reg, SR = M.States, IT = M.Items, EL = M.EntityList, VB = M.VB, Bh = M.Behave;
W.init(1); Bh.init(W); if (M.BlockEntities && M.BlockEntities.init) M.BlockEntities.init(); EL.init(); M.Ai.init(); M.Profession.init();
for (let cx = -2; cx <= 2; cx++) for (let cz = -2; cz <= 2; cz++) { const c = W.makeChunk(cx, cz); c.state = CH.GENERATED; W.chunks.set(W.key(cx, cz), c); }
W.rawBrightness = () => 15;
const Gt = M.VBGather, TICKS = 30, EYE = Math.fround(1.62), F3 = Math.fround(0.3);
const stream = (seed) => { let s = (seed * 2654435761 + 12345) >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; s ^= s >>> 15; return (s >>> 0) / 4294967296; }; };
const PROFS = ['farmer', 'butcher', 'librarian'], B_PROFS = ['farmer', 'butcher', 'librarian', 'nitwit'];
const INV_ITEMS = ['bread', 'wheat', 'carrot', 'potato', 'beetroot', 'wheat_seeds', 'bone_meal', 'stick', 'diamond'];
const GROUND = ['bread', 'wheat', 'wheat_seeds', 'stick', 'diamond', 'carrot', 'bone_meal'];
const GATHER = ['bread', 'potato', 'carrot', 'wheat', 'wheat_seeds', 'beetroot', 'beetroot_seeds'], FARMER_SET = ['wheat', 'wheat_seeds', 'beetroot_seeds', 'bone_meal'];
const FOOD = { bread: 4, carrot: 1, potato: 1, beetroot: 1 };

function setup(salt) {
  const r = stream(salt + 500), pick = (a) => a[Math.floor(r() * a.length)];
  const mkInv = () => { const inv = Array(8).fill(null); let n = 0; for (const it of INV_ITEMS) if (n < 8 && r() < 0.45) inv[n++] = { name: it, n: 1 + Math.floor(r() * 64) }; return inv; };
  const A = { prof: PROFS[salt % 3], pos: [1.5, 64, 1.5], inv: mkInv() }, B = { prof: pick(B_PROFS), pos: [1.5 + r() * 1.4, 64, 1.5 + r() * 1.4], inv: mkInv() };
  if (salt % 4 === 0) { A.inv = Array(8).fill(null).map((_, i) => ({ name: i === 0 ? 'stick' : 'diamond', n: 64 })); A.inv[5] = { name: 'bread', n: 60 }; }   // full: only what fits is taken
  const ground = [];
  for (const it of GROUND) if (r() < 0.8) ground.push({ name: it, n: 1 + Math.floor(r() * 64), pos: [1.5 + (r() - 0.5) * 1.2, 64, 1.5 + (r() - 0.5) * 1.2] });
  ground.push({ name: 'wheat', n: 5, pos: [9.5, 64, 9.5] });   // out of reach
  return { A, B, ground };
}

function engineTrace(salt, tamper) {
  const { A, B, ground } = setup(salt);
  if (tamper) tamper();
  EL.clear(); M.Village = M.Village || {}; const realTalk = M.Village.talkWithVillager; M.Village.talkWithVillager = () => {};
  const mk = (d) => { const e = EL.spawn('villager', d.pos[0], d.pos[1], d.pos[2]); e.ai = new M.Ai.GoalSelector(); e.profession = d.prof; const inv = VB.ensureVillagerInventory(e); d.inv.forEach((s, i) => { inv[i] = s ? { i: IT.of(s.name), n: s.n } : null; }); e.vbAge = 0; return e; };
  const a = mk(A), b = mk(B), items = ground.map((g) => { const o = EL.spawn('item', g.pos[0], g.pos[1], g.pos[2], { item: IT.of(g.name), count: g.n }); o.pickupDelay = 0; return o; });
  const thrown = [], realDrop = EL.dropStack; EL.dropStack = (x, y, z, item, count, o) => { thrown.push([typeof item === 'number' ? IT.nameOf(item) : item, count, x, y, z, o.vx, o.vy, o.vz]); return null; };
  VB.ready = true;
  const inv = (e) => e.villagerInventory.map((s) => (s ? [IT.nameOf(s.i), s.n] : null)), rows = [];
  for (let t = 0; t < TICKS; t++) {
    thrown.length = 0;
    Gt.lootTick(a); Gt.lootTick(b); Gt.tick(a, t, t); Gt.tick(b, t, t);
    rows.push({ tick: t, held: inv(a), held2: inv(b), ground: items.map((o) => (o.removed ? 0 : o.count)), drops: thrown.map((x) => x.slice()) });
  }
  EL.dropStack = realDrop; M.Village.talkWithVillager = realTalk;
  return rows;
}

function refTrace(salt) {
  const { A, B, ground } = setup(salt);
  const va = { prof: A.prof, pos: A.pos, inv: A.inv }, vb = { prof: B.prof, pos: B.pos, inv: B.inv };
  const gset = (p) => (p === 'farmer' ? FARMER_SET : []);
  const add = (v, name, c) => { for (const s of v.inv) if (s && s.name === name && s.n < 64 && c > 0) { const k = Math.min(64 - s.n, c); s.n += k; c -= k; } for (let i = 0; i < 8 && c > 0; i++) if (!v.inv[i]) { const k = Math.min(64, c); v.inv[i] = { name, n: k }; c -= k; } return c; };
  const count = (v, n) => v.inv.reduce((s, x) => s + (x && x.name === n ? x.n : 0), 0);
  const food = (v) => v.inv.reduce((s, x) => s + (x && FOOD[x.name] ? FOOD[x.name] * x.n : 0), 0);
  const gs = ground.map((g) => ({ name: g.name, n: g.n, pos: g.pos }));
  let thrown;
  const loot = (v) => {
    for (const g of gs) {
      if (g.n <= 0) continue;
      if (!(GATHER.includes(g.name) || gset(v.prof).includes(g.name))) continue;
      const hw = 0.3, ihw = 0.125;
      if (g.pos[0] + ihw < v.pos[0] - hw - 1 || g.pos[0] - ihw > v.pos[0] + hw + 1) continue;
      if (g.pos[1] + 0.25 < v.pos[1] - 0.5 || g.pos[1] > v.pos[1] + 1.95 + 0.5) continue;
      if (g.pos[2] + ihw < v.pos[2] - hw - 1 || g.pos[2] - ihw > v.pos[2] + hw + 1) continue;
      g.n = add(v, g.name, g.n);
    }
  };
  const give = (v, p, names) => {
    for (let i = 0; i < 8; i++) {
      const s = v.inv[i]; if (!s || !names.includes(s.name)) continue;
      let k; if (s.n > 32) k = Math.floor(s.n / 2); else if (s.n > 24) k = s.n - 24; else continue;
      s.n -= k; const nm = s.name; if (!s.n) v.inv[i] = null;
      const sx = v.pos[0], sy = v.pos[1] + EYE - F3, sz = v.pos[2], dx = p.pos[0] - v.pos[0], dy = p.pos[1] - v.pos[1], dz = p.pos[2] - v.pos[2], L = Math.sqrt(dx * dx + dy * dy + dz * dz);
      thrown.push([nm, k, sx, sy, sz, L < 1e-5 ? 0 : dx / L * F3, L < 1e-5 ? 0 : dy / L * F3, L < 1e-5 ? 0 : dz / L * F3]); return;
    }
  };
  const tick = (v, p) => {
    const dx = p.pos[0] - v.pos[0], dy = p.pos[1] - v.pos[1], dz = p.pos[2] - v.pos[2];
    if (dx * dx + dy * dy + dz * dz > 5.0) return;
    if (food(v) >= 24 && (v.prof === 'farmer' || food(p) < 12)) give(v, p, Object.keys(FOOD));
    if (p.prof === 'farmer' && count(v, 'wheat') > 32) give(v, p, ['wheat']);
    const items = gset(p.prof).filter((n) => !gset(v.prof).includes(n));
    if (items.length && v.inv.some((s) => s && items.includes(s.name))) give(v, p, items);
  };
  const snap = (v) => v.inv.map((s) => (s ? [s.name, s.n] : null)), rows = [];
  for (let t = 0; t < TICKS; t++) {
    thrown = [];
    loot(va); loot(vb); tick(va, vb); tick(vb, va);
    rows.push({ tick: t, held: snap(va), held2: snap(vb), ground: gs.map((g) => Math.max(0, g.n)), drops: thrown });
  }
  return rows;
}
const F = ['held', 'held2', 'ground', 'drops'];
const first = (a, b) => compareTraces(a, b, { fields: F });
let bad = 0, breaks = 0;
const SALTS = Array.from({ length: 20 }, (_, i) => i);
const refs = SALTS.map((s) => refTrace(s));
for (const s of SALTS) { const d = first(engineTrace(s), refs[s]); if (d) { bad++; console.log('DIVERGE salt ' + s + ' ' + JSON.stringify(d).slice(0, 400)); } }
const broke = (name, tamper, restore) => {
  let n = 0;
  for (const s of SALTS) { const d = first(engineTrace(s, tamper), refs[s]); if (d) n++; }
  restore();
  if (n) breaks++; else { bad++; console.log('NOT CAUGHT ' + name); }
  if (process.argv.includes('--verbose')) console.log('  break "' + name + '": ' + n + '/20 salts diverge');
};
const realMax = IT.maxStack, realGather = Gt.GATHERABLE_ITEMS.slice(), realShare = Gt.WHEAT_SHARE_MIN, realProf = JSON.stringify(Gt.PROFESSION_GATHERABLE);
broke('halve threshold: max stack 64 -> 48', () => { IT.maxStack = () => 48; }, () => { IT.maxStack = realMax; });
broke('wheat dropped from GATHERABLE_ITEMS', () => { Gt.GATHERABLE_ITEMS = realGather.filter((n) => n !== 'wheat'); }, () => { Gt.GATHERABLE_ITEMS = realGather; });
broke('wheat share line 32 -> 48', () => { Gt.WHEAT_SHARE_MIN = 48; }, () => { Gt.WHEAT_SHARE_MIN = realShare; });
broke('farmer set loses bone_meal', () => { Gt.PROFESSION_GATHERABLE = { farmer: ['wheat', 'wheat_seeds', 'beetroot_seeds'] }; }, () => { Gt.PROFESSION_GATHERABLE = JSON.parse(realProf); });
console.log(`${breaks} breaks caught, ${bad} divergences (villagergather ${SALTS.length} salts x ${TICKS} ticks), ${SALTS.length * 4 + breaks} assertions, ${bad} failures`);
process.exit(bad ? 1 : 0);
