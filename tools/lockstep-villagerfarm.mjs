#!/usr/bin/env node
// lockstep-villagerfarm -- #6936 (G17-L196): lockstep scenario 'villagerfarm', 20 salts x 1500 ticks. A farmer on a 3x3 farmland plot (wheat, carrots, potatoes, beetroots at mixed ages, some cells bare),
// seeds + bone meal + wheat in the 8-slot inventory, and a composter. Per tick, engine vs an independent reference written from .decomp (FarmerVillagerTask, BoneMealTask, CropBlock.applyGrowth,
// FarmerWorkTask.craftAndDropBread/compostSeeds, ComposterBlock.addToComposter, the crop loot tables): the blocks list (crop state changes), the farmer inventory, the composter level and the drops.
// compareTraces, exact doubles. The farmer is moved onto a task's target the tick after the walk target is set (no pathfinding in this scenario; both sides do the same).
import { readFileSync } from 'node:fs';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';
import { compareTraces } from './referee/lockstep/trace.mjs';

const A = MCLITE_ROOT + '/assets/', rdj = (f) => JSON.parse(readFileSync(A + f, 'utf8'));
const EXTRA = ['02f_tags.js', '02g_items.js', '07_world.js', '07b_behaviour.js', '07c_blockentity.js', '07d_mining.js', '07e_loot.js', '07h_entities.js', '07y_equip.js', '14b_physics.js', '14c_raycast.js',
  '07i_entitylist.js', '07l_spawn.js', '14d_survival.js', '14f_inventory.js', '14j_combat.js', '14l_use.js', '07za_explosion.js', '07m_breed.js', '07q_effects.js', '07zu_poi.js', '07o_profession.js',
  '07k_goals.js', '07zv_villagerbrain.js', '07zy_composter.js', '07zx_particle.js'];
const M = loadEngine({ extra: EXTRA, dom: false });
M.Items.init({ items: readFileSync(A + 'items.bin').toString('base64'), itemsBytes: rdj('items.meta.json').rawBytes });
M.DATA = Object.assign({}, M.DATA, { entities: rdj('entities.json') });
M.Entities.init(); M.Entities.attrs = M.DATA.entities.attrs; M.Effects.ready = true;
const W = M.World, CH = M.CH, R = M.Reg, SR = M.States, IT = M.Items, EL = M.EntityList, VB = M.VB, Cm = M.Composter, Bh = M.Behave;
W.init(1); Bh.init(W); if (M.BlockEntities && M.BlockEntities.init) M.BlockEntities.init(); EL.init(); M.Ai.init(); M.Profession.init();
for (let cx = -2; cx <= 2; cx++) for (let cz = -2; cz <= 2; cz++) { const c = W.makeChunk(cx, cz); c.state = CH.GENERATED; W.chunks.set(W.key(cx, cz), c); }
W.rawBrightness = () => 15;
const realGrow = M.Fertilizable.cropGrowAge, realBreak = M.Loot.breakDrops, realMax = Bh.maxAge, realChance = JSON.stringify(Cm.CHANCE);

const stream = (seed) => { let s = (seed * 2654435761 + 12345) >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; s ^= s >>> 15; return (s >>> 0) / 4294967296; }; };
const CROPS = ['wheat', 'carrots', 'potatoes', 'beetroots'], MAXA = { wheat: 7, carrots: 7, potatoes: 7, beetroots: 3 };
const SEED_CROP = { wheat_seeds: 'wheat', potato: 'potatoes', carrot: 'carrots', beetroot_seeds: 'beetroots' };
const SEED_ORDER = ['wheat_seeds', 'potato', 'carrot', 'beetroot_seeds'];   // FarmerVillagerTask's per-slot item order
const PLOT = []; for (let x = 0; x < 3; x++) for (let z = 0; z < 3; z++) PLOT.push([x, 64, z]);
const COMP = [10, 64, 10], TICKS = 1500;
const cellName = (name, age) => (name ? name + '[age=' + age + ']' : 'air');

function setup(salt) {
  const r = stream(salt + 1000);
  const cells = new Map(), ageOfCell = [];
  for (let x = -3; x <= 12; x++) for (let z = -3; z <= 12; z++) for (let y = 62; y <= 66; y++) W.setBlock(x, y, z, 0);
  for (let x = -3; x <= 12; x++) for (let z = -3; z <= 12; z++) W.setBlock(x, 62, z, SR.stateOf('stone'));
  for (const [x, y, z] of PLOT) {
    W.setBlock(x, y - 1, z, SR.stateOf('farmland'));
    const k = Math.floor(r() * 6);   // 0..3 a crop, 4..5 bare
    if (k < 4) { const c = CROPS[k], a = Math.floor(r() * (MAXA[c] + 1)); W.setBlock(x, y, z, Bh.setProp(SR.stateOf(c), 'age', a)); cells.set(x + ',' + y + ',' + z, { name: c, age: a }); }
    else cells.set(x + ',' + y + ',' + z, { name: null, age: 0 });
  }
  W.setBlock(COMP[0], COMP[1], COMP[2], SR.stateOf('composter'));
  const inv = Array(8).fill(null), put = (n, item, c) => { inv[n] = { name: item, n: c }; };
  const picks = ['wheat_seeds', 'potato', 'carrot', 'beetroot_seeds', 'wheat', 'bone_meal', 'bread'];
  let slot = 0;
  for (const it of picks) { if (slot < 8 && r() < 0.8) put(slot++, it, 1 + Math.floor(r() * (it === 'bone_meal' ? 6 : 24))); }
  return { cells, inv };
}

function engineTrace(salt, tamper) {
  const { inv: inv0 } = setup(salt);
  if (tamper) tamper();
  const vS = stream(salt + 1), lS = stream(salt + 2), cS = stream(salt + 3);
  VB.rand = vS; M.Loot.breakDrops = (st, c) => realBreak(st, Object.assign({}, c, { rng: { nextFloat: lS, nextInt: (n) => Math.floor(lS() * n) } })); M.fbRand = cS; EL.random = stream(salt + 4);
  EL.clear();
  const f = EL.spawn('villager', 1.5, 64, 1.5); f.ai = new M.Ai.GoalSelector(); f.profession = 'farmer';
  const inv = VB.ensureVillagerInventory(f);
  inv0.forEach((s, i) => { inv[i] = s ? { i: IT.of(s.name), n: s.n } : null; });
  const key = ([x, y, z]) => x + ',' + y + ',' + z;
  const snap = () => PLOT.map((p) => { const st = W.getBlock(p[0], p[1], p[2]); if (!st) return 'air'; const nm = SR.name(st); const v = M.Reg.PROP.age === undefined ? -1 : SR.propValue(st, R.PROP.age); return nm + '[age=' + (v < 0 ? 0 : R.valueNames[v]) + ']'; });
  let prev = snap(), readyAt = -1; const rows = [];
  EL.dropTrace = [];
  for (let t = 0; t < TICKS; t++) {
    EL.dropTrace.length = 0;
    f.vbAge = t; f.vbWalkTarget = null;
    VB.tickWorkRandom(f, t);
    if (f.vbWalkTarget) { f.x = f.vbWalkTarget.x + 0.5; f.y = f.vbWalkTarget.y; f.z = f.vbWalkTarget.z + 0.5; }
    if (t % 40 === 20) { const was = Cm.level(...COMP); VB.farmerAdditionalWork(f, { x: COMP[0], y: COMP[1], z: COMP[2] }); if (was !== 7 && Cm.level(...COMP) === 7) readyAt = t + 20; }
    if (t % 30 === 5) { // a bread dropped in by hand (ComposterBlock.compost)
      const bi = inv.findIndex((s) => s && s.i === IT.of('bread'));
      if (bi >= 0 && Cm.level(...COMP) < 7) { const was = Cm.level(...COMP); Cm.addItem(COMP[0], COMP[1], COMP[2], 'bread', M.fbRand); inv[bi].n--; if (inv[bi].n <= 0) inv[bi] = null; if (was < 7 && Cm.level(...COMP) === 7) readyAt = t + 20; }
    }
    if (t === readyAt) Cm.scheduledTick(COMP[0], COMP[1], COMP[2]);
    const now = snap(), blocks = [];
    now.forEach((n, i) => { if (n !== prev[i]) blocks.push([...PLOT[i], prev[i], n]); });
    prev = now;
    rows.push({ tick: t, pos: [f.x, f.y, f.z], blocks, held: inv.map((s) => (s ? [IT.nameOf(s.i), s.n] : null)), fluid: [Cm.level(...COMP)], drops: EL.dropTrace.map(([i, c]) => [typeof i === 'number' ? IT.nameOf(i) : i, c]).sort() });
  }
  return rows;
}

function refTrace(salt) {
  const { cells, inv } = setup(salt);
  const vS = stream(salt + 1), lS = stream(salt + 2), cS = stream(salt + 3);
  const ck = (x, y, z) => x + ',' + y + ',' + z;
  const crop = (x, y, z) => cells.get(ck(x, y, z));
  const farmlandBelow = (x, y, z) => (y === 64 && x >= 0 && x <= 2 && z >= 0 && z <= 2);
  const mature = (c) => c && c.name && c.age >= MAXA[c.name];
  const count = (n) => inv.reduce((a, s) => a + (s && s.name === n ? s.n : 0), 0);
  const take = (n, k) => { for (let i = 0; i < 8 && k > 0; i++) if (inv[i] && inv[i].name === n) { const d = Math.min(k, inv[i].n); inv[i].n -= d; k -= d; if (!inv[i].n) inv[i] = null; } };
  const give = (n, k) => { for (let i = 0; i < 8 && k > 0; i++) if (inv[i] && inv[i].name === n && inv[i].n < 64) { const d = Math.min(64 - inv[i].n, k); inv[i].n += d; k -= d; } for (let i = 0; i < 8 && k > 0; i++) if (!inv[i]) { const d = Math.min(64, k); inv[i] = { name: n, n: d }; k -= d; } return k; };
  let drops, changes, level = 0, readyAt = -1;
  const setCell = (x, y, z, name, age) => { const o = crop(x, y, z); if (o.name === name && o.age === age) return; changes.push([x, y, z, cellName(o.name, o.age), cellName(name, age)]); cells.set(ck(x, y, z), { name, age }); };
  const pos = { x: 1.5, y: 64, z: 1.5 };
  const near = (p) => { const dx = p.x + 0.5 - pos.x, dy = p.y + 0.5 - pos.y, dz = p.z + 0.5 - pos.z; return dx * dx + dy * dy + dz * dz < 1; };   // BlockPos.isWithinDistance(Position, 1.0)
  let ft = { active: false, targets: [], target: null, ran: 0, next: 0 }, bm = { active: false, pos: null, start: 0, dur: 0, lastEnd: 0 }, walk = null;
  const scan = (pred) => { const out = []; const bx = Math.floor(pos.x), by = Math.floor(pos.y), bz = Math.floor(pos.z); for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) { const p = { x: bx + dx, y: by + dy, z: bz + dz }; if (pred(p.x, p.y, p.z)) out.push(p); } return out; };
  const suitable = (x, y, z) => { const c = crop(x, y, z); if (!c) return false; return (c.name && mature(c)) || (!c.name && farmlandBelow(x, y, z)); };
  const nextInt = (n) => Math.floor(vS() * n);
  const pickT = () => (ft.targets.length ? ft.targets[nextInt(ft.targets.length)] : null);
  const loot = (name) => {   // crop loot at max age: wheat/beetroot 1 + (1 + binomial); carrot/potato 1 + (1 + binomial)(3, 4/7 as float) of the crop item (+ 2% poisonous potato)
    const out = {}, add = (n, c) => { out[n] = (out[n] || 0) + c; };
    const p = Math.fround(0.5714286); let b = 0; for (let i = 0; i < 3; i++) if (lS() < p) b++;
    if (name === 'wheat') { add('wheat', 1); add('wheat_seeds', 1 + b); }
    else if (name === 'beetroots') { add('beetroot', 1); add('beetroot_seeds', 1 + b); }
    else { const it = name === 'carrots' ? 'carrot' : 'potato'; add(it, 2 + b); if (name === 'potatoes' && lS() < 0.02) add('poisonous_potato', 1); }
    return Object.entries(out);
  };
  const ftTick = (now) => {
    const t = ft.target;
    if (!t || near(t)) {
      if (t && now > ft.next) {
        const c = crop(t.x, t.y, t.z), wasMature = mature(c), wasAir = !c.name, wasCrop = !!c.name;
        if (wasMature) { for (const d of loot(c.name)) drops.push(d); setCell(t.x, t.y, t.z, null, 0); }
        if (wasAir && farmlandBelow(t.x, t.y, t.z)) {
          for (let i = 0; i < 8; i++) { const s = inv[i]; const crp = s && SEED_CROP[s.name]; if (crp) { setCell(t.x, t.y, t.z, crp, 0); s.n--; if (!s.n) inv[i] = null; break; } }
        }
        if (wasCrop && !wasMature) { ft.targets = ft.targets.filter((q) => q !== t); ft.target = pickT(); if (ft.target) { ft.next = now + 20; walk = ft.target; } }
      }
      ft.ran++;
    } else if (now > ft.next) walk = t;
    if (ft.ran >= 200) { ft.active = false; ft.ran = 0; ft.next = now + 40; walk = null; }
  };
  const bmPos = () => { let best = null, n = 0; for (const p of scan((x, y, z) => { const c = crop(x, y, z); return c && c.name && !mature(c); })) { n++; if (nextInt(n) === 0) best = p; } return best; };
  const bmTick = (now) => {
    if (bm.pos && now >= bm.start && near(bm.pos)) {
      const k = inv.findIndex((s) => s && s.name === 'bone_meal');
      if (k >= 0) {
        const c = crop(bm.pos.x, bm.pos.y, bm.pos.z);
        if (c && c.name && !mature(c)) {
          let g = 2 + Math.floor(vS() * 4); if (c.name === 'beetroots') g = Math.floor(g / 3);
          setCell(bm.pos.x, bm.pos.y, bm.pos.z, c.name, Math.min(MAXA[c.name], c.age + g));
          inv[k].n--; if (!inv[k].n) inv[k] = null;
        }
        bm.pos = bmPos(); if (bm.pos) { walk = bm.pos; bm.start = now + 40; }
      }
      bm.dur++;
    }
    if (!bm.pos || bm.dur >= 80) { bm.active = false; bm.lastEnd = now; walk = null; }
  };
  const W6 = [7, 2, 5, 5, 2, 4];   // farmer: villagerWork, goToIfNearby, goToNearby, goToSecondary, farmerVillagerTask, boneMeal
  const chance = (n) => Math.fround({ bread: 0.85, wheat_seeds: 0.3, beetroot_seeds: 0.3 }[n]);
  const compost = (n) => { if (level < 7) { if (level === 0 || cS() < chance(n)) { level++; if (level === 7) return true; } } return false; };
  const rows = [];
  for (let t = 0; t < TICKS; t++) {
    drops = []; changes = []; walk = null;
    if (ft.active) ftTick(t);
    else if (bm.active) bmTick(t);
    else {
      const order = W6.map((w, i) => [i, -Math.pow(vS(), 1 / w)]).sort((a, b) => a[1] - b[1]);
      for (const [i] of order) {
        if (i === 4) { ft.targets = scan(suitable); ft.target = pickT(); if (ft.target) { ft.active = true; ft.ran = 0; ftTick(t); break; } }
        if (i === 5) {
          if (t % 10 === 0 && (bm.lastEnd === 0 || bm.lastEnd + 160 <= t) && count('bone_meal') > 0) {
            bm.pos = bmPos();
            if (bm.pos) { bm.active = true; walk = bm.pos; bm.start = t; bm.dur = 0; bmTick(t); break; }
          }
        }
      }
    }
    if (walk) { pos.x = walk.x + 0.5; pos.y = walk.y; pos.z = walk.z + 0.5; }
    if (t % 40 === 20) {   // FarmerWorkTask.performAdditionalWork
      if (count('bread') <= 36) { const l = Math.min(3, Math.floor(count('wheat') / 3)); if (l) { take('wheat', l * 3); give('bread', l); } }
      if (level === 8) { level = 0; drops.push(['bone_meal', 1]); }   // emptyFullComposter (bone meal drop)
      {
        let budget = 20; const seen = [0, 0];
        const wasLevel = level;
        outer: for (let i = 7; i >= 0 && budget > 0; i--) {
          const s = inv[i], ci = s ? ['wheat_seeds', 'beetroot_seeds'].indexOf(s.name) : -1;
          if (ci < 0) continue;
          const have = s.n; seen[ci] += have;
          const n = Math.min(Math.min(seen[ci] - 10, budget), have);
          if (n <= 0) continue;
          budget -= n;
          for (let k = 0; k < n; k++) { if (level < 7) { s.n--; if (!s.n) inv[i] = null; } const up = compost(s ? 'wheat_seeds' : ''); if (level === 7) { if (wasLevel !== 7) readyAt = t + 20; break outer; } }
        }
      }
    }
    if (t % 30 === 5) { const bi = inv.findIndex((s) => s && s.name === 'bread'); if (bi >= 0 && level < 7) { inv[bi].n--; if (!inv[bi].n) inv[bi] = null; if (compost('bread') ) readyAt = t + 20; } }
    if (t === readyAt && level === 7) level = 8;
    changes.sort((a, b) => a[0] - b[0] || a[2] - b[2]);
    rows.push({ tick: t, pos: [pos.x, pos.y, pos.z], blocks: changes, held: inv.map((s) => (s ? [s.name, s.n] : null)), fluid: [level], drops: drops.sort() });
  }
  return rows;
}
const F = ['pos', 'blocks', 'held', 'fluid', 'drops'];
const first = (a, b) => compareTraces(a, b, { fields: F });
let bad = 0, breaks = 0;
const SALTS = Array.from({ length: 20 }, (_, i) => i);
const refs = SALTS.map((s) => refTrace(s));
for (const s of SALTS) { const d = first(engineTrace(s), refs[s]); if (d) { bad++; console.log('DIVERGE salt ' + s + ' ' + JSON.stringify(d).slice(0, 400)); } }
// anti-vacuity (D-30): each broken engine must diverge from the reference on at least one salt
const broke = (name, tamper, restore) => {
  let n = 0;
  for (const s of SALTS) { const d = first(engineTrace(s, tamper), refs[s]); if (d) n++; }
  restore();
  if (n) breaks++; else { bad++; console.log('NOT CAUGHT ' + name); }
  if (process.argv.includes('--verbose')) console.log('  break "' + name + '": ' + n + '/20 salts diverge');
};
broke('ripe test max age -> max age - 1', () => { Bh.maxAge = (b) => realMax(b) - 1; }, () => { Bh.maxAge = realMax; });
broke('composter chance 85 -> 65', () => { for (const k in Cm.CHANCE) if (Cm.CHANCE[k] === 0.85) Cm.CHANCE[k] = 0.65; }, () => { Cm.CHANCE = JSON.parse(realChance); });
broke('bone meal growth 2..5 -> 2..4', () => { M.Fertilizable.cropGrowAge = (a, mx, r) => Math.min(mx, a + 2 + Math.floor(r() * 3)); }, () => { M.Fertilizable.cropGrowAge = realGrow; });
broke('farmer keeps 10 seeds -> 9', () => { VB.FARMER_SEED_KEEP = 9; }, () => { VB.FARMER_SEED_KEEP = 10; });
console.log(`${breaks} breaks caught, ${bad} divergences (villagerfarm ${SALTS.length} salts x ${TICKS} ticks), ${SALTS.length * 5 + breaks} assertions, ${bad} failures`);
process.exit(bad ? 1 : 0);
