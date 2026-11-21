// lockstep-zombify -- #6668 (G17-L97): lockstep scenario 'zombify', 20 salts: piglin, piglin_brute, hoglin in the overworld.
// Reference = .decomp AbstractPiglinEntity/HoglinEntity.mobTick (timeInOverworld++ each overworld tick, zombify when > 300), MobEntity.convertTo (equipment, baby, persistence kept), zombification sound.
// Per tick: the counter equals the tick number; conversion happens exactly at tick 301 (not before); new type, one new entity (id order after the originals), equipment copied, sound played.
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
const { EntityList: EL, Mount: Mn, Passive: Ps } = M;
let fails = 0, breaks = 0;
const ok = (c, m) => { if (!c) { fails++; console.log('  FAIL ' + m); } };
const stream = (salt) => { let s = (salt * 2654435761 + 12345) >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; };
const salts = Array.from({ length: 20 }, (_, i) => i);
const KINDS = [['piglin', 'zombified_piglin'], ['piglin_brute', 'zombified_piglin'], ['hoglin', 'zoglin']];
const AFTER = () => 300;
function floor() {
  cells.clear(); EL.list.length = 0;
  const stone = M.States.stateOf('stone');
  for (let x = -8; x <= 8; x++) for (let z = -5; z <= 5; z++) w.set(x, -1, z, stone);
  for (let i = -8; i <= 8; i++) for (const [x, z] of [[i, -5], [i, 5]]) for (let y = 0; y < 2; y++) w.set(x, y, z, stone);
  for (let i = -5; i <= 5; i++) for (const x of [-8, 8]) for (let y = 0; y < 2; y++) w.set(x, y, i, stone);
}
let sounds = [];
M.Sound = M.Sound || {}; M.Sound.mobSound = (e, ev) => { sounds.push(e.type + ':' + ev); };
function lane(salt, after) {
  floor(); sounds = [];
  const r = stream(salt); EL.random = r; Math.random = r;
  const mobs = KINDS.map(([t], i) => { const e = EL.spawn(t, -3 + 3 * i + 0.5, 0, 0.5); e.persistent = true; return e; });
  const sword = M.Items.of ? M.Items.of('iron_sword') : 0;
  mobs[0].equip = (mobs[0].equip || []).slice(); mobs[0].equip[0] = { i: sword, n: 1, d: 0, t: null };
  const ids = mobs.map((e) => e.id);
  let bad = null; const note = (m) => { if (!bad) bad = m; };
  const done = [false, false, false];
  for (let t = 1; t <= 320 && !bad; t++) {
    const snap = mobs.map((e) => JSON.stringify(e.equip));
    EL.tick();
    mobs.forEach((e, i) => {
      if (done[i]) return;
      if (!e.removed) {
        if ((e.timeInOverworld | 0) !== t) note(`tick ${t} ${e.type} timeInOverworld ${e.timeInOverworld} vs ${t}`);
        return;
      }
      done[i] = true;
      if (t !== after + 1) note(`tick ${t} ${KINDS[i][0]} converted at ${t} vs ${after + 1}`);
      const z = EL.list.find((x) => x.type === KINDS[i][1] && !mobs.includes(x) && !EL.list.slice(0, 0).includes(x));
      if (!sounds.some((s) => s.startsWith(KINDS[i][0] + ':'))) note(`tick ${t} no zombify sound for ${KINDS[i][0]}`);
      const zs = EL.list.filter((x) => x.type === KINDS[i][1]);
      if (!zs.length) { note(`tick ${t} no ${KINDS[i][1]}`); return; }
      const nz = i === 2 ? zs[0] : zs[i];
      if (!(nz.id > ids[i])) note(`tick ${t} id order ${nz.id} <= ${ids[i]}`);
      if (!(nz.health > 0)) note(`tick ${t} health ${nz.health}`);
      if (JSON.stringify(nz.equip) !== JSON.stringify(e.equip)) note(`tick ${t} ${KINDS[i][0]} equipment ${JSON.stringify(nz.equip)} vs ${JSON.stringify(e.equip)}`);
    });
  }
  if (!bad && !done.every(Boolean)) note('not all converted');
  return { bad };
}
for (const s of salts) { const r = lane(s, 300); ok(!r.bad, 'zombify salt ' + s + ' ' + r.bad); }
const brk = (c, m) => { if (c) { breaks++; console.log('   ✓ break caught: ' + m); } else { fails++; console.log('  ✗ break NOT caught: ' + m); } };
{ const r = lane(3, 299); brk(!!r.bad && /tick 301/.test(r.bad), `300 -> 299 reported: ${r.bad}`); }
{ const z = M.Piglin ? null : null; const pg = Object.values(M).find((m) => m && m.zombify && m.ZOMBIFY_AFTER === 300 && m.shouldZombify);
  if (pg) { pg.ZOMBIFY_AFTER = 299; const r = lane(4, 300); brk(!!r.bad, `engine 299 reported: ${r.bad}`); pg.ZOMBIFY_AFTER = 300; } }
{ const hg = Object.values(M).find((m) => m && m.zombify && m.canConvert); const zf = hg.zombify; hg.zombify = (e) => { e.removed = true; return null; }; const r = lane(5, 300); brk(!!r.bad, `hoglin no zoglin reported: ${r.bad}`); hg.zombify = zf; }
console.log(`lockstep-zombify: ${20 + breaks} assertions, ${fails} failures, ${breaks} breaks caught`);
process.exit(fails ? 1 : 0);
