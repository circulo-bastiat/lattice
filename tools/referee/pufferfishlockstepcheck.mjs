// lockstep-pufferfish -- #6858 (G17-L157): pufferfish puff state 0-2 from threats, inflate/deflate timers, hitbox per state, sting poison 60*state (1.18.2 has no hunger/nausea), sounds, 20 salts.
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
const { EntityList: EL, Effects: Ef, Fish: Fi } = M;
let fails = 0, breaks = 0;
const ok = (c, m) => { if (!c) { fails++; console.log('  FAIL ' + m); } };
function pond() {
  cells.clear(); EL.list.length = 0;
  const stone = M.States.stateOf('stone');
  for (let x = -8; x <= 8; x++) for (let z = -8; z <= 8; z++) w.set(x, -1, z, stone);
}
// Reference = PufferfishEntity.tick (InflateGoal start/stop folded) as a pure state machine over a per-tick "threat" bool.
function refStep(r, threat) {
  if (threat) { if (!r.inflate) { r.inflate = 1; r.deflate = 0; } } else r.inflate = 0;
  if (r.inflate > 0) {
    if (r.puff === 0) { r.puff = 1; r.snd.push('blow_up'); } else if (r.inflate > 40 && r.puff === 1) { r.puff = 2; r.snd.push('blow_up'); }
    r.inflate++;
  } else if (r.puff !== 0) {
    if (r.deflate > 60 && r.puff === 2) { r.puff = 1; r.snd.push('blow_out'); } else if (r.deflate > 100 && r.puff === 1) { r.puff = 0; r.snd.push('blow_out'); }
    r.deflate++;
  }
}
const SCALE = [0.5, 0.7, 1.0];
function lane(salt) {
  pond();
  let bad = null; const note = (m) => { if (!bad) bad = m; };
  const P = M.Player; P.x = 40; P.y = 0; P.z = 40; P.health = 20; P.maxHealth = 20; P.mode = undefined; P.width = 0.6; P.height = 1.8;
  Ef.removeStatusEffect(P, 'poison');
  const pf = EL.spawn('pufferfish', 0, 0, 0.5); pf.inWater = true;
  const sq = EL.spawn('squid', 1, 0, 0.5); sq.inWater = true; if (globalThis.__squidThreat) sq.type = 'zombie';
  const zb = EL.spawn('zombie', 6 + salt % 2, 0, 0.5);
  const bw = pf.baseWidth, bh = pf.baseHeight;
  const sounds = []; const sv = Fi.sound; Fi.sound = (e, id) => { if (e === pf) sounds.push(id.split('.').pop()); };
  const ref = { puff: 0, inflate: 0, deflate: 0, snd: [] };
  const enterAt = 10 + salt, leaveAt = enterAt + 50 + salt * 3, zbAt = leaveAt + 20, total = zbAt + 260;
  let stung = false;
  for (let t = 0; t < total; t++) {
    // player enters at 1.5 blocks (inside the 2.0 expand), leaves to 40; zombie then arrives within 1.5
    const inside = t >= enterAt && t < leaveAt;
    P.x = inside ? 1.5 + (salt % 3) * 0.3 : 40; P.z = inside ? 0.5 : 40; P.y = 0;
    zb.x = t >= zbAt && t < zbAt + 80 ? 0 + 1.9 : 6;
    // geometry of the engine: threat when box expand(2.0) meets target; recompute independently
    const hw = SCALE[ref.puff] * bw / 2, hh = SCALE[ref.puff] * bh;
    const meets = (o, ow, oh) => Math.abs(o.x - pf.x) < hw + 2 + ow / 2 && Math.abs(o.z - pf.z) < hw + 2 + ow / 2 && o.y < pf.y + hh + 2 && o.y + oh > pf.y - 2;
    const threat = meets(P, 0.6, 1.8) || meets(zb, zb.width, zb.height);
    refStep(ref, threat);
    Fi.puffTick(pf);
    if (pf.puffState !== ref.puff) { note(`tick ${t} puff ${pf.puffState} vs ${ref.puff}`); break; }
    if ((pf.inflateTicks | 0) !== ref.inflate || (pf.deflateTicks | 0) !== ref.deflate) { note(`tick ${t} timers ${pf.inflateTicks}/${pf.deflateTicks} vs ${ref.inflate}/${ref.deflate}`); break; }
    if (Math.abs(pf.width - bw * SCALE[ref.puff]) > 1e-9 || Math.abs(pf.height - bh * SCALE[ref.puff]) > 1e-9) { note(`tick ${t} hitbox ${pf.width}x${pf.height} state ${ref.puff}`); break; }
    if (sounds.join() !== ref.snd.join()) { note(`tick ${t} sounds ${sounds} vs ${ref.snd}`); break; }
    if (squidIgnored(t)) { /* squid never counts as a threat: covered by the reference having none */ }
  }
  function squidIgnored() { return true; }
  if (!bad && ref.snd.indexOf('blow_out') < 0) note('never deflated');
  // contact effects: state 2 at player collision -> poison 120, amplifier 0, 3 damage; state 1 -> 60, 2 damage; no hunger/nausea in 1.18.2
  for (const st of [1, 2]) {
    Ef.removeStatusEffect(P, 'poison'); Ef.removeStatusEffect(P, 'hunger'); Ef.removeStatusEffect(P, 'nausea');
    P.x = 0.5; P.y = 0; P.z = 0.5; P.health = 20; P.invulnerableTime = 0; P.hurtTime = 0; P.lastDamage = 0;
    EL.list.length = 0; EL.list.push(pf); Fi.setPuffState(pf, st); pf.x = 0; pf.z = 0.5;
    Fi.stingNearby(pf);
    const po = Ef.getStatusEffect(P, 'poison');
    if (!po || po.duration !== 60 * st || po.amplifier !== 0) note(`poison state ${st}: ${po && po.duration}/${po && po.amplifier} vs ${60 * st}/0`);
    if (P.health !== 20 - (1 + st)) note(`sting damage state ${st}: ${20 - P.health} vs ${1 + st}`);
    if (Ef.getStatusEffect(P, 'hunger') || Ef.getStatusEffect(P, 'nausea')) note('hunger/nausea applied (1.18.2 has none)');
  }
  Fi.sound = sv;
  return { bad };
}
for (let s = 0; s < 20; s++) { const r = lane(s); ok(!r.bad, 'pufferfish salt ' + s + ' ' + r.bad); }
const brk = (c, m) => { if (c) { breaks++; console.log('   ✓ break caught: ' + m); } else { fails++; console.log('  ✗ break NOT caught: ' + m); } };
const first = () => { let h = null; for (let s = 0; s < 20 && !h; s++) h = lane(s).bad; return h; };
{ const sv = Fi.puffScale; Fi.puffScale = (s) => (s === 0 ? 0.5 : (s === 1 ? 0.8 : 1.0)); const h = first(); brk(!!h, `semi scale 0.8: ${h}`); Fi.puffScale = sv; }
{ globalThis.__squidThreat = true; const h = first(); brk(!!h, `squid a threat: ${h}`); globalThis.__squidThreat = false; }
{ const sv = Fi.puffTick; Fi.puffTick = (e) => { sv(e); if (e.puffState === 2 && e.inflateTicks === 0 && e.deflateTicks > 30) { Fi.setPuffState(e, 1); } }; const h = first(); brk(!!h, `early deflate: ${h}`); Fi.puffTick = sv; }
{ const sv = Fi.stingNearby; Fi.stingNearby = (e) => { sv(e); Ef.addStatusEffect(M.Player, 'hunger', 100, 0); }; const h = first(); brk(!!h, `hunger applied: ${h}`); Fi.stingNearby = sv; }
console.log(`lockstep-pufferfish: ${20 + breaks} assertions, ${fails} failures, ${breaks} breaks caught`);
process.exit(fails ? 1 : 0);
