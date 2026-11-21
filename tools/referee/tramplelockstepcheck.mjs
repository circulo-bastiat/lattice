// trample lockstep check -- #8194 (G17-L230): lockstep scenario 'trample'.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from '../loadsrc.mjs';
const rdj = (f) => JSON.parse(readFileSync(join(MCLITE_ROOT, 'assets', f), 'utf8'));
const b64 = (f) => readFileSync(join(MCLITE_ROOT, 'assets', f)).toString('base64');
const BASE_MODS = ['02f_tags.js', '02g_items.js', '14f_inventory.js', '07b_behaviour.js', '07_world.js', '07h_entities.js',
  '14b_physics.js', '07i_entitylist.js', '07k_goals.js', '07l_spawn.js', '07m_breed.js', '07n_tame.js', '07q_effects.js',
  '07y_equip.js', '10_gfx.js', '15h_bemodel.js', '07j_entityrender.js', '14d_survival.js', '14j_combat.js', '07zw_mobnbt.js',
  '07w_passive.js', '07d_mining.js', '07e_loot.js', '14l_use.js'];
const MOB_MODS = readdirSync(join(MCLITE_ROOT, 'src')).filter((f) => /^07.*\.js$/.test(f) && !BASE_MODS.includes(f)).sort();
const M = loadEngine({ extra: BASE_MODS.concat(MOB_MODS), dom: false, initReg: true });
M.DATA = Object.assign({}, M.DATA, { entities: rdj('entities.json') });
M.Entities.init();
M.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
M.Loot.init({ loot: b64('loot.bin'), lootBytes: rdj('loot.meta.json').jsonBytes });
const cells = new Map(), key = (x, y, z) => x + ',' + y + ',' + z;
const w = { get: (x, y, z) => cells.get(key(x, y, z)) || 0, set: (x, y, z, s) => { if (s) cells.set(key(x, y, z), s); else cells.delete(key(x, y, z)); return true; } };
w.getBlock = w.get; w.setBlock = w.set; w.getLight = () => 0; w.tickingAt = () => true; w.canSurvive = () => true;
M.World = Object.assign(M.World || {}, w);
if (M.Behave && M.Behave.init) M.Behave.init(w);
M.Physics.shapeAt = (x, y, z) => { const id = w.get(Math.floor(x), Math.floor(y), Math.floor(z)); return id && M.States.solid[id] === 1 ? M.Physics.shapesFor(id) : null; };
M.Physics.solidAt = (x, y, z) => M.Physics.shapeAt(x, y, z) !== null;
M.EntityList.init(); M.Ai.init(); M.Equip.init(); M.Breed.init(); M.Tame.init(); M.Passive.init();
if (M.Squid && M.Squid.init) M.Squid.init();
if (M.Fish && M.Fish.init) M.Fish.init();
M.Diff = { get: () => 'normal' }; M.Player = { x: 0, y: 300, z: 60 };
if (M.Goat && M.Goat.init) M.Goat.init();
M.Reg.buildPhysics(rdj('block-physics.json'));
M.Use.init(w);
const { EntityList: EL, States: S, Physics: Ph, Reg: R } = M;
let fails = 0, breaks = 0;
const ok = (c, m) => { if (!c) { fails++; console.log('  FAIL ' + m); } };
const stream = (salt) => { let s = (salt * 2654435761 + 12345) >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; };
const salts = Array.from({ length: 20 }, (_, i) => i);
const farmSt = (moist) => { const st = S.stateOf('farmland'); return st; };
const nameOf = (st) => st ? R.names[S.block[st]] : 'air';
let grief = 'true';
M.Commands = Object.assign(M.Commands || {}, { ruleGet: () => grief });
// Reference = .decomp FarmlandBlock.onLandedUpon: nextFloat < fallDistance - 0.5, a LivingEntity, a player or DO_MOB_GRIEFING,
// width*width*height > 0.512; then setToDirt. Fall distance is the drop from the start to the 15/16 farmland top.
const TOP = 0.9375;
const THRESH = { v: 0.5 };
const GRIEF = { v: true };
const KINDS = { pig: [0.9, 0.9], zombie: [0.6, 1.95], villager: [0.6, 1.95] };
function lane(salt, kind, h, dry, griefOn) {
  cells.clear(); EL.list.length = 0; grief = griefOn ? 'true' : 'false';
  for (let x = -3; x <= 3; x++) for (let z = -3; z <= 3; z++) w.set(x, -2, z, S.stateOf('stone'));
  w.set(0, -1, 0, farmSt(!dry)); w.set(0, 0, 0, S.stateOf('wheat'));
  const r = stream(salt + 500); M.Player = { x: 30, y: 0, z: 30 }; Math.random = stream(salt);
  // spawn beside the crop column is wrong: the body must land ON the farmland, so put it at the farmland column top
  const m = EL.spawn(kind, 0.5, TOP - 1 + h, 0.5); m.persistent = true; m.noAi = true; m.rand = r; m.invulnerableTime = 0;
  const refRoll = stream(salt + 500)();
  const baby = !!(m.baby || m.isBaby || (m.age !== undefined && m.age < 0)); const [ew, eh] = baby ? KINDS[kind].map((v) => v * 0.5) : KINDS[kind];
  const eligible = refRoll < (h - THRESH.v) && (griefOn || false) && ew * ew * eh > 0.512;
  // the mob stands on y = TOP - 1 + ... ; fall distance measured by the engine itself, compare outcome to the reference gate
  let landedAt = -1, fd = 0;
  for (let t = 0; t < 40; t++) {
    m.x = 0.5; m.z = 0.5; m.vx = 0; m.vz = 0; EL.tick();
    if (landedAt < 0 && m.landedFrom !== undefined) { landedAt = t; fd = m.landedFrom; }
  }
  if (landedAt < 0) return { n: 'never landed' };
  const want = (refRoll < (fd - THRESH.v) && (griefOn || !GRIEF.v) && ew * ew * eh > 0.512) ? 'dirt' : 'farmland';
  const got = nameOf(w.get(0, -1, 0));
  if (got !== want) return { n: 'block', fd, ref: want, got };
  if (want === 'farmland' && w.get(0, -1, 0) !== farmSt(!dry)) return { n: 'farmland state changed' };
  if (m.y < (want === 'dirt' ? 0 : TOP - 1) - 1e-6) return { n: 'lander inside block', y: m.y };
  return null;
}
let cases = 0;
for (const kind of Object.keys(KINDS)) for (const h of [0.4, 1.0, 3.0]) for (const dry of [false, true]) for (const g of [true, false]) {
  const bad = salts.map((s) => lane(s, kind, h, dry, g)).filter(Boolean); cases++;
  ok(!bad.length, `${kind} h=${h} dry=${dry} grief=${g}: ${bad.length}/20 diverge ${bad[0] ? JSON.stringify(bad[0]) : ''}`);
}
const brk = (c, m) => { if (c) { breaks++; console.log('   ✓ break caught: ' + m); } else { fails++; console.log('  ✗ break NOT caught: ' + m); } };
const anyBad = () => [0, 1, 2, 3, 4, 5].some((s) => [0.4, 1.0, 3.0].some((h) => lane(s, 'zombie', h, false, true) || lane(s, 'zombie', h, false, false)));
THRESH.v = 1.0; brk(anyBad(), 'fallDistance - 0.5 threshold off by 0.5 caught'); THRESH.v = 0.5;
GRIEF.v = false; brk(anyBad(), 'mobGriefing gate removed caught'); GRIEF.v = true;
console.log(`tramplelockstepcheck: ${cases + breaks} assertions, ${fails} failures, ${breaks} breaks caught`);
process.exit(fails ? 1 : 0);
