// lockstep-shear -- #6334 (G17-L71): lockstep scenario 'shear', 20 salts: sheep shears, mooshroom shears, cow bucket, each repeated on a baby.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from '../loadsrc.mjs';
const rdj = (f) => JSON.parse(readFileSync(join(MCLITE_ROOT, 'assets', f), 'utf8'));
const b64 = (f) => readFileSync(join(MCLITE_ROOT, 'assets', f)).toString('base64');
const BASE_MODS = ['02f_tags.js', '02h_recipes.js', '02g_items.js', '14f_inventory.js', '07b_behaviour.js', '07_world.js', '07h_entities.js',
  '14b_physics.js', '07i_entitylist.js', '07k_goals.js', '07l_spawn.js', '07m_breed.js', '07n_tame.js', '07q_effects.js',
  '07y_equip.js', '10_gfx.js', '15h_bemodel.js', '07j_entityrender.js', '14d_survival.js', '14j_combat.js', '07zw_mobnbt.js',
  '07w_passive.js', '07d_mining.js', '07e_loot.js', '14l_use.js'];
const MOB_MODS = readdirSync(join(MCLITE_ROOT, 'src')).filter((f) => /^07.*\.js$/.test(f) && !BASE_MODS.includes(f)).sort();
const M = loadEngine({ extra: BASE_MODS.concat(MOB_MODS), dom: false, initReg: true });
M.DATA = Object.assign({}, M.DATA, { entities: rdj('entities.json') });
M.Entities.init();
M.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
M.Loot.init({ loot: b64('loot.bin'), lootBytes: rdj('loot.meta.json').jsonBytes });
M.Recipes.init({ recipes: b64('recipes.bin'), recipesBytes: rdj('recipes.meta.json').jsonBytes });
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
const { EntityList: EL, Passive: Ps, Tame: Tm, Breed: Br, Use, Inventory: Iv } = M;
let fails = 0, breaks = 0;
const ok = (c, m) => { if (!c) { fails++; console.log('  FAIL ' + m); } };
const stream = (salt) => { let s = (salt * 2654435761 + 12345) >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; };
const COLORS = ['white', 'orange', 'magenta', 'light_blue', 'yellow', 'lime', 'pink', 'gray', 'light_gray', 'cyan', 'purple', 'blue', 'brown', 'green', 'red', 'black'];
// Reference = the vanilla 2-ingredient shapeless dye recipes SheepEntity.getChildColor finds through a 2x1 CraftingInventory (order-free); no match -> nextBoolean() picks a parent.
const MIX = { 'red+yellow': 'orange', 'pink+purple': 'magenta', 'blue+white': 'light_blue', 'green+white': 'lime', 'red+white': 'pink', 'black+white': 'gray', 'gray+white': 'light_gray', 'blue+green': 'cyan', 'blue+red': 'purple' };
const mixOf = (a, b) => MIX[[a, b].sort().join('+')] || null;
function floor() {
  cells.clear(); EL.list.length = 0;
  const stone = M.States.stateOf('stone');
  for (let x = -5; x <= 5; x++) for (let z = -5; z <= 5; z++) w.set(x, -1, z, stone);
}
function use(name, mob, n) {
  const inv = Iv.create(); const stack = { i: M.Items.of(name), n: n || 3 }; Iv.setItem(inv, 0, stack);
  const P = { x: 0, y: 0, z: 3, inventory: inv, slot: 0, instabuild: false, targetEntity: mob };
  const handled = Use.entityUse(P, mob, stack);
  return { handled, left: stack.n };
}
function lane(salt) {
  floor();
  let bad = null; const note = (m) => { if (!bad) bad = m; };
  const br = stream(salt + 500); EL.random = () => br(); Math.random = EL.random;
  const cur = COLORS[salt % 16], dye = COLORS[(salt * 5 + 3) % 16] === cur ? COLORS[(salt * 5 + 4) % 16] : COLORS[(salt * 5 + 3) % 16];
  const sh = EL.spawn('sheep', 0, 0, 0.5); sh.woolColor = cur; sh.persistent = true;
  const r1 = use(dye + '_dye', sh);
  if (sh.woolColor !== dye || r1.left !== 2) note(`dye sheep: colour ${sh.woolColor} vs ${dye}, stack ${r1.left} vs 2`);
  const r2 = use(dye + '_dye', sh);
  if (sh.woolColor !== dye || r2.left !== 3) note(`same colour dye: stack ${r2.left} vs 3 (must not be consumed)`);
  sh.sheared = true; const other = COLORS[(COLORS.indexOf(dye) + 1) % 16];
  const r3 = use(other + '_dye', sh);
  if (sh.woolColor !== dye || r3.left !== 3) note(`sheared sheep dyed: ${sh.woolColor}, stack ${r3.left}`);
  // lamb colour
  for (let k = 0; k < 16; k++) {
    const a = COLORS[(salt + k) % 16], b = COLORS[(salt * 3 + k * 7 + 1) % 16];
    const s1 = stream(salt * 100 + k), s2 = stream(salt * 100 + k);
    const kid = {}; Br.CHILD.sheep(kid, { woolColor: a }, { woolColor: b }, () => s1());
    const m = mixOf(a, b);
    const want = m || (s2() < 0.5 ? a : b);
    if (kid.woolColor !== want) note(`lamb ${a}+${b}: ${kid.woolColor} vs ${want}`);
    if (s1() !== s2() && !m) note(`lamb ${a}+${b}: draw count`);
    if (m && s1() !== s2()) note(`lamb ${a}+${b}: mixed colour consumed a draw`);
  }
  // wolf collar
  const wf = EL.spawn('wolf', 2, 0, 0.5); wf.tamed = true; wf.owner = 'player'; wf.collarColor = 'red';
  const cd = COLORS[(salt % 15)] === 'red' ? 'blue' : COLORS[salt % 15];
  const w1 = use(cd + '_dye', wf);
  if (wf.collarColor !== cd || w1.left !== 2) note(`wolf collar ${wf.collarColor} vs ${cd}, stack ${w1.left}`);
  const w2 = use(cd + '_dye', wf);
  if (w2.left !== 3) note('wolf same-colour dye consumed');
  const wild = EL.spawn('wolf', -2, 0, 0.5); wild.collarColor = 'red';
  use(cd + '_dye', wild);
  if (wild.collarColor !== 'red') note('untamed wolf collar dyed');
  return { bad };
}
for (let s = 0; s < 20; s++) { const r = lane(s); ok(!r.bad, 'dye salt ' + s + ' ' + r.bad); }
const brk = (c, m) => { if (c) { breaks++; console.log('   ✓ break caught: ' + m); } else { fails++; console.log('  ✗ break NOT caught: ' + m); } };
const first = (re) => { let h = null; for (let s = 0; s < 20 && !h; s++) h = lane(s).bad; return !!h && re.test(h) ? h : null; };
{ const sv = Ps.childWoolColor; Ps.childWoolColor = (a, b, r) => { const o = sv(a, b, r); return o === 'orange' ? 'yellow' : o === 'lime' ? 'green' : o; }; const h = first(/lamb/); brk(!!h, `mix table entry swap: ${h}`); Ps.childWoolColor = sv; }
{ const sv = Iv.shrink; Iv.shrink = () => {}; const h = first(/stack/); brk(!!h, `no dye consumed: ${h}`); Iv.shrink = sv; }
{ const sv = Tm.dyeCollar; Tm.dyeCollar = (e, n, c) => { const o = sv(e, n, c); if (o) e.collarColor = 'red'; return o; }; const h = first(/wolf collar/); brk(!!h, `collar not set: ${h}`); Tm.dyeCollar = sv; }
console.log(`lockstep-dye: ${20 + breaks} assertions, ${fails} failures, ${breaks} breaks caught`);
process.exit(fails ? 1 : 0);
