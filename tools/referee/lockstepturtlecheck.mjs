// lockstep-turtle -- #6671 (G17-L100): lockstep scenario 'turtle', 20 salts: a pregnant turtle at its home beach.
// Reference = .decomp TurtleEntity.LayEggGoal (counter<1 -> digging, counter=1; counter>200 -> lay, then counter++ while digging; EGGS=nextInt(4)+1; love 600)
// and TurtleEggBlock.randomTick (progress on nextInt(500)==0 or skyAngle in (0.65,0.69); hatch 0->1->2, then break + one baby per egg, baby age -24000) and TurtleEntity.onGrowUp (one scute).
// The egg must appear exactly 200 ticks after the dig starts, with 1..4 eggs, hasEgg cleared, love 600; the hatch roll is replayed against an independent stream.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from '../loadsrc.mjs';
const rdj = (f) => JSON.parse(readFileSync(join(MCLITE_ROOT, 'assets', f), 'utf8'));
const b64 = (f) => readFileSync(join(MCLITE_ROOT, 'assets', f)).toString('base64');
const BASE_MODS = ['02f_tags.js', '02g_items.js', '14f_inventory.js', '07b_behaviour.js', '07_world.js', '07h_entities.js',
  '14b_physics.js', '07i_entitylist.js', '07k_goals.js', '07l_spawn.js', '07m_breed.js', '07n_tame.js', '07q_effects.js',
  '07y_equip.js', '10_gfx.js', '15h_bemodel.js', '07j_entityrender.js', '14d_survival.js', '14j_combat.js', '07zw_mobnbt.js',
  '07w_passive.js', '07d_mining.js', '07e_loot.js'];
const MOB_MODS = readdirSync(join(MCLITE_ROOT, 'src')).filter((f) => /^07.*\.js$/.test(f) && !BASE_MODS.includes(f)).sort();
const M = loadEngine({ extra: BASE_MODS.concat(MOB_MODS), dom: false, initReg: true });
M.DATA = Object.assign({}, M.DATA, { entities: rdj('entities.json') });
M.Entities.init();
M.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
M.Loot.init({ loot: b64('loot.bin'), lootBytes: rdj('loot.meta.json').jsonBytes });
const cells = new Map(), key = (x, y, z) => x + ',' + y + ',' + z;
const w = { get: (x, y, z) => cells.get(key(x, y, z)) || 0, set: (x, y, z, s) => { if (s) cells.set(key(x, y, z), s); else cells.delete(key(x, y, z)); } };
w.getBlock = w.get; w.setBlock = w.set; w.getLight = () => 0; w.tickingAt = () => true;
M.World = Object.assign(M.World || {}, w);
if (M.Behave && M.Behave.init) M.Behave.init(w);
M.Physics.shapeAt = (x, y, z) => { const id = w.get(Math.floor(x), Math.floor(y), Math.floor(z)); return id && M.States.solid[id] === 1 ? M.Physics.shapesFor(id) : null; };
M.Physics.solidAt = (x, y, z) => M.Physics.shapeAt(x, y, z) !== null;
M.EntityList.init(); M.Ai.init(); M.Equip.init(); M.Breed.init(); M.Tame.init(); M.Passive.init();
if (M.Squid && M.Squid.init) M.Squid.init();
if (M.Fish && M.Fish.init) M.Fish.init();
M.Diff = { get: () => 'normal' }; M.Player = { x: 0, y: 300, z: 60 };
if (M.Goat && M.Goat.init) M.Goat.init();
M.Mount.init();
let fails = 0, breaks = 0;
const ok = (c, m) => { if (!c) { fails++; console.log("  FAIL " + m); } };
const stream = (salt) => { let s = (salt * 2654435761 + 12345) >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; };
const { EntityList: EL } = M, Tu = M.Turtle;
const sand = M.States.stateOf('sand'), air = 0;
const EGG_Y = 0;
function beach() {
  cells.clear(); EL.list.length = 0;
  for (let x = -14; x <= 14; x++) for (let z = -14; z <= 14; z++) w.set(x, -1, z, sand);
}
// returns { bad, layTick, eggs }
function lane(salt) {
  beach();
  const r = stream(salt); EL.random = r; Math.random = r;
  const e = EL.spawn('turtle', 0.5, 0, 0.5);
  e.persistent = true; Tu.setHomePos(e, 0, 0, 0); e.hasEgg = true;
  let digStart = 0, bad = null, layTick = 0, eggs = 0;
  for (let t = 1; t <= 1500 && !layTick; t++) {
    EL.tick();
    if (!digStart && e.diggingSand) digStart = t;
    for (let x = -14; x <= 14 && !layTick; x++) for (let z = -14; z <= 14; z++) {
      const st = w.get(x, EGG_Y, z);
      if (st && M.States.block[st] === M.Reg.id.turtle_egg) { layTick = t; eggs = Tu.eggCount(st); break; }
    }
  }
  if (!layTick) return { bad: 'no egg laid in 1500 ticks' };
  if (layTick - digStart !== 200) bad = `egg at tick ${layTick}, dig began ${digStart}: ${layTick - digStart} != 200`;
  else if (eggs < 1 || eggs > 4) bad = `egg count ${eggs}`;
  else if (e.hasEgg) bad = 'hasEgg not cleared';
  else if (e.inLove < 599 || e.inLove > 600) bad = 'love ' + e.inLove;
  return { bad, eggs, layTick };
}
// hatch: replay the 1-in-500 roll against an independent stream; stages 0,1,2 then babies + scute
function hatch(salt) {
  beach();
  const egg = M.States.stateOf('turtle_egg');
  let st = egg; st = M.Behave.setProp(st, 'eggs', 3);
  w.set(0, EGG_Y, 0, st);
  const roll = stream(1000 + salt), junk = stream(77 + salt), ref = stream(1000 + salt);
  let first = true; const mine = () => { if (first) { first = false; return roll(); } return junk(); };   // the first draw is the 1-in-500 roll; sounds draw after it
  let stage = 0, steps = 0;
  for (let n = 0; n < 200000; n++) {
    const cur = w.get(0, EGG_Y, 0);
    const want = ((ref() * 500) | 0) === 0; first = true;
    const did = Tu.eggRandomTick(0, EGG_Y, 0, cur, mine, 0);
    if (did !== want) return `tick ${n} progressed ${did} vs ${want}`;
    if (did) {
      steps++;
      if (stage < 2) { stage++; if (Tu.eggHatch(w.get(0, EGG_Y, 0)) !== stage) return `stage ${Tu.eggHatch(w.get(0, EGG_Y, 0))} vs ${stage}`; }
      else break;
    }
  }
  if (steps !== 3) return 'steps ' + steps;
  if (w.get(0, EGG_Y, 0) !== 0) return 'egg block not removed';
  const babies = EL.list.filter((x) => x.type === 'turtle');
  if (babies.length !== 3) return 'babies ' + babies.length;
  for (const b of babies) if (b.growAge !== -24000 || !M.Breed.isBaby(b)) return 'baby age ' + b.growAge;
  const before = EL.list.length;
  EL.random = stream(salt); babies[0].growAge = -1;
  M.Breed.setAge && 0;
  EL.tick();
  const scute = EL.list.filter((x) => x.type === 'item' && x.item === 'scute').length;
  return scute === 1 ? null : 'scute drops ' + scute + ' (entities ' + before + ')';
}
const seenEggs = new Set();
for (let s = 0; s < 20; s++) { const r = lane(s); ok(!r.bad, 'turtle salt ' + s + ' ' + r.bad); if (r.eggs) seenEggs.add(r.eggs); }
ok(seenEggs.size >= 2, 'egg counts vary across salts: ' + [...seenEggs]);
for (let s = 0; s < 20; s++) { const h = hatch(s); ok(!h, 'hatch salt ' + s + ' ' + h); }
const brk = (c, m) => { if (c) { breaks++; console.log('   ✓ break caught: ' + m); } else { fails++; console.log('  ✗ break NOT caught: ' + m); } };
const d = Tu.DIG_TICKS; Tu.DIG_TICKS = 199;
{ const r = lane(3); brk(!!r.bad, `layEggCounter 199 reported: ${r.bad}`); }
Tu.DIG_TICKS = d;
const rp = Tu.eggShouldHatchProgress; Tu.eggShouldHatchProgress = (rnd) => ((rnd() * 400) | 0) === 0;
{ const h = hatch(1); brk(!!h, `1-in-400 roll reported: ${h}`); }
Tu.eggShouldHatchProgress = rp;
console.log(`lockstep-turtle: ${40 + breaks} assertions, ${fails} failures, ${breaks} breaks caught`);
process.exit(fails ? 1 : 0);
