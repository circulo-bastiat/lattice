// lockstep-plate -- #6798 (G17-L147): lockstep scenario 'plate', 20 salts. Each plate type (oak, stone, light/heavy weighted) under a zombie, an item, an arrow and a baby chicken,
// spawned/removed at salted ticks. Reference = an independent model of .decomp AbstractPressurePlateBlock / PressurePlateBlock / WeightedPressurePlateBlock:
// entity box (0.125 inset, 0.25 tall) vs the entity's own box, stone = LivingEntity only, wood = any, weighted power = ceil(min(count,max)/max*15) (max 15 / 150),
// onEntityCollision only while output is 0, scheduledTick re-check every 20 ticks (10 weighted) while pressed. The powered/power series is compared every tick.
import { loadEngine } from '../loadsrc.mjs';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MCLITE_ROOT } from '../loadsrc.mjs';
const rdj = (f) => JSON.parse(readFileSync(join(MCLITE_ROOT, 'assets', f), 'utf8'));
const b64 = (f) => readFileSync(join(MCLITE_ROOT, 'assets', f)).toString('base64');
const EXTRA = ['07_world.js', '02g_items.js', '14f_inventory.js', '07h_entities.js', '14b_physics.js', '07i_entitylist.js', '14i_hand.js', '14j_combat.js', '14d_survival.js', '14l_use.js', '02f_tags.js', '07b_behaviour.js', '07c_blockentity.js', '07f_redstone.js'];
const PLATES = [['oak_pressure_plate', 'e', 15, 20], ['stone_pressure_plate', 'l', 15, 20], ['light_weighted_pressure_plate', 'w', 15, 10], ['heavy_weighted_pressure_plate', 'w', 150, 10]];
const KINDS = ['zombie', 'item', 'arrow', 'chicken'];
const T = 70;
let fails = 0, breaks = 0, cases = 0;
const ok = (c, m) => { if (!c) { fails++; console.log('  FAIL ' + m); } };
const stream = (salt) => { let s = (salt * 2654435761 + 977) >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; };

function run(salt, plate, mutate) {
  const [name, rule, max, delay] = plate;
  const rnd = stream(salt * 7 + name.length), ni = (n) => Math.floor(rnd() * n);
  const M = loadEngine({ extra: EXTRA, dom: false });
  M.DATA = Object.assign({}, M.DATA, { entities: rdj('entities.json') });
  M.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
  M.Entities.init(); M.EntityList.init(); if (M.Combat && M.Combat.init) M.Combat.init();
  const EL = M.EntityList, W = M.World, CH = M.CH, S = M.States, B = M.Behave;
  W.init(1);
  for (let cx = -2; cx <= 2; cx++) for (let cz = -2; cz <= 2; cz++) { const c = W.makeChunk(cx, cz); c.state = CH.GENERATED; W.chunks.set(W.key(cx, cz), c); }
  for (let x = -8; x <= 8; x++) for (let z = -8; z <= 8; z++) W.setBlock(x, -1, z, S.stateOf('stone') | 0);
  const w = { get: (x, y, z) => W.getBlock(x, y, z), set: (x, y, z, st) => W.setBlock(x, y, z, st), getLight: () => 15 << 4 };
  w.getBlock = w.get; w.setBlock = w.set;
  B.init(w); if (M.BlockEntities && M.BlockEntities.init) M.BlockEntities.init(); M.Redstone.init(); if (M.Use && M.Use.init) M.Use.init(w);
  if (mutate) mutate(M);
  W.setBlock(0, 0, 0, S.stateOf(name) | 0); B.changed(0, 0, 0);
  for (let i = 0; i < 20; i++) { B.tick(); M.BlockEntities.tick(); EL.tick(); }
  // salted plan: 1..4 entities, each a kind, spawn tick, kill tick, offset on the plate
  const plan = [], n = 1 + ni(4);
  for (let i = 0; i < n; i++) { const t = 3 + ni(20); plan.push({ kind: KINDS[ni(4)], t, kill: rnd() < 0.7 ? t + 2 + ni(45) : 999, dx: 0.5 + (rnd() - 0.5) * 0.4, dz: 0.5 + (rnd() - 0.5) * 0.4 }); }
  const live = [], eng = [], ref = [];
  let out = 0, due = -1;
  const measure = () => { // independent getSignalStrength over the live entities
    let c = 0;
    for (const e of live) {
      if (e.removed) continue;
      const hw = e.width / 2;
      if (!(e.x + hw > 0.125 && e.x - hw < 0.875 && e.y + e.height > 0 && e.y < 0.25 && e.z + hw > 0.125 && e.z - hw < 0.875)) continue;
      if (rule === 'l' && e.type !== 'zombie' && e.type !== 'chicken') continue;
      c++;
    }
    if (rule === 'w') return c ? Math.ceil(Math.fround(Math.fround(Math.min(c, max) / max) * 15)) : 0;
    return c ? 15 : 0;
  };
  for (let k = 1; k <= T; k++) {
    for (const p of plan) {
      if (p.t === k) {
        const opts = { vx: 0, vy: 0, vz: 0 };
        if (p.kind === 'item') { opts.item = 'stone'; opts.count = 1; }
        const e = EL.spawn(p.kind, p.dx, 0.1, p.dz, opts);
        if (!e) throw new Error('spawn ' + p.kind);
        if (p.kind === 'item') e.pickupDelay = EL.PICKUP_NEVER;
        if (p.kind === 'chicken') { e.age = -24000; e.baby = true; e.isBaby = true; e.height = 0.4; e.width = 0.2; }
        if (p.kind !== 'zombie' && p.kind !== 'chicken') e.noPhysics = false;
        p.e = e; live.push(e);
      }
      if (p.kill === k && p.e) p.e.removed = true;
    }
    const st = W.getBlock(0, 0, 0);
    eng.push(rule === 'w' ? (parseInt(B.propName(st, 'power'), 10) || 0) : (B.propName(st, 'powered') === 'true' ? 1 : 0) * 15);
    ref.push(out);
    // reference tick: scheduled re-check (block tick phase), then entity collision phase
    if (due === k) { due = -1; if (out > 0) { const now = measure(); out = now; if (now > 0) due = k + delay; } }
    B.tick(); M.BlockEntities.tick(); EL.tick();
    if (out === 0) { const now = measure(); if (now !== out) { out = now; if (now > 0) due = k + delay; } }
  }
  return { eng, ref, plan };
}
const cmp = (r) => { const i = r.eng.findIndex((v, k) => v !== r.ref[k]); return i < 0 ? null : `tick ${i + 1}: engine ${r.eng[i]} vs reference ${r.ref[i]}`; };
let pressed = 0, weightedMid = 0;
for (let s = 0; s < 20; s++) for (const pl of PLATES) {
  cases++;
  let r; try { r = run(s, pl); } catch (e) { ok(false, `salt ${s} ${pl[0]}: ${e.message}`); continue; }
  const d = cmp(r); ok(!d, `salt ${s} ${pl[0]} [${r.plan.map((p) => p.kind + '@' + p.t + '-' + p.kill).join(' ')}]: ${d}`);
  if (r.eng.some((v) => v > 0)) pressed++;
  if (pl[2] === 150 && r.eng.some((v) => v > 0 && v < 15)) weightedMid++;
}
ok(pressed > cases / 3, `salts press plates (${pressed}/${cases})`);
const brk = (m, mut) => { let caught = false; for (let s = 0; s < 20 && !caught; s++) for (const pl of PLATES) { try { const r = run(s, pl, mut); if (cmp(r)) { caught = true; break; } } catch (e) { caught = true; break; } } if (caught) { breaks++; console.log('   ✓ break caught: ' + m); } else { fails++; console.log('  ✗ break NOT caught: ' + m); } };
brk('stone plate counts every entity', (M) => { const o = M.EntityList.spawn; M.EntityList.spawn = function () { const e = o.apply(this, arguments); if (e && e.maxHealth === undefined) e.maxHealth = 1; return e; }; });
brk('re-check delay 20 -> 10', (M) => { M.Use.PLATE_TICKS = 10; });
brk('heavy plate max 150 -> 15', (M) => { M.Use.PLATE_WEIGHT.heavy_weighted_pressure_plate = 15; });
console.log(`lockstep-plate: ${cases + 1 + breaks} assertions, ${fails} failures, ${breaks} breaks caught (${cases} plate x salt cases, ${weightedMid} heavy partial powers)`);
process.exit(fails ? 1 : 0);
