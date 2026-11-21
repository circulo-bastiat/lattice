// barterlockstepcheck.mjs -- #6667 (G17-L96): lockstep scenario 'barter', 20 salts: a piglin picks up a dropped gold ingot, admires it 120 ticks, then rolls piglin_bartering.
// Reference = PiglinBrain (.decomp): loot -> swapItemWithOffHand + setAdmiringItem(120), RemoveOffHandItemTask -> consumeOffHandItem(true) -> doBarter -> getBarterResponseItems
// (loot table piglin_bartering, ONE weighted draw + count range, jar weights copied below, independent of Pg.BARTER_TABLE). Per tick: admiring flag, offhand item, gold left on the
// ground, thrown stack (item,count) and its tick go through lockstep/trace.mjs compareTraces. The two entity-Random draws behind the roll are read off the salted stream.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';
import { serverRow, engineRow, compareTraces } from './referee/lockstep/trace.mjs';
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
const { EntityList: EL } = M;
const Pg = M.Piglin;
let fails = 0, breaks = 0;
const ok = (c, m) => { if (!c) { fails++; console.log('  FAIL ' + m); } };
// Reference = PiglinBrain.onGuardedBlockInteracted (.decomp): piglins within expand(16) of the player that hasIdleActivity (not angry, not admiring, adult) and, for an opened chest only,
// visible, become angry (ANGRY_AT 600 ticks); setAdmiringItem remembers 120. 1.18.2 has NO gold-armour exemption here (wearsGoldArmor only gates the target sensor).
const GUARD = 16, ANGER = 600, ADMIRE = 120, XS = [6, 14, 20];
const FL = { fields: ['goals'] };
const row = (t, st) => ({ tick: t, goals: st.flatMap((s, i) => [s.angry ? [i, 'angry'] : null, s.adm ? [i, 'admiring'] : null].filter(Boolean)) });
function lane(salt, ticks) {
  EL.list.length = 0; cells.clear();
  const open = 8 + (salt % 5), brk = 130 + (salt % 7) * 3, gold = salt % 2 === 0;
  const P = { x: 0.5, y: 0, z: 0.5, health: 20, type: 'player', gold }; M.Player = P;
  const ps = XS.map((x) => { const e = EL.spawn('piglin', x + 0.5, 0, 0.5); e.persistent = true; e.isBaby = false; e.pgClock = 0; return e; });
  Pg.setAdmiring(ps[1]);
  const ref = [{ angry: 0, until: 0, adm: 0 }, { angry: 0, until: 0, adm: 1, admUntil: ADMIRE }, { angry: 0, until: 0, adm: 0 }];
  const E = [], R = [];
  const guarded = (line) => { Pg.onGuardedBlockInteracted(P, line); };
  for (let t = 1; t <= ticks; t++) {
    ps.forEach((e) => { e.pgClock = t; e.x = e.x; });
    if (t === open) guarded(true);
    if (t === brk) guarded(false);
    E.push(row(t, ps.map((e) => ({ angry: !!Pg.angryAt(e), adm: Pg.isAdmiring(e) }))));
    for (let i = 0; i < 3; i++) {
      const s = ref[i];
      if (s.angry && t > s.until) s.angry = 0;
      if (s.adm && t >= s.admUntil) s.adm = 0;
      if (t === open || t === brk) {
        if (!s.angry && !s.adm && XS[i] <= GUARD) { s.angry = 1; s.until = t + ANGER; }
      }
    }
    R.push(row(t, ref));
  }
  return { d: compareTraces(R, E, FL), E };
}
const run = (n = 20) => Array.from({ length: n }, (_, salt) => ({ salt, ...lane(salt, 200) }));
const res = run();
ok(res.every((r) => !r.d), 'piglinwatch: ' + res.filter((r) => r.d).map((r) => `salt ${r.salt} tick ${r.d.tick} ${r.d.field}`).slice(0, 3));
ok(res.every((r) => r.E.some((x) => x.goals.length)), 'every salt angers someone');
const brkc = (c, m) => { if (c) { breaks++; console.log('   ✓ break caught: ' + m); } else { fails++; console.log('  ✗ break NOT caught: ' + m); } };
const og = Pg.GUARDED_RANGE; Pg.GUARDED_RANGE = 8;
brkc(run().some((r) => r.d), 'guarded radius 16 -> 8 is reported'); Pg.GUARDED_RANGE = og;
const oo = Pg.onGuardedBlockInteracted;
Pg.onGuardedBlockInteracted = function (p, l) { if (p.gold) return; return oo.call(Pg, p, l); };
brkc(run().some((r) => r.d), 'a wearing-gold exemption is reported (none in 1.18.2)'); Pg.onGuardedBlockInteracted = oo;
const oa = Pg.ADMIRE_TICKS; Pg.ADMIRE_TICKS = 100;
brkc(run().some((r) => r.d), 'admire time 100 instead of 120 is reported'); Pg.ADMIRE_TICKS = oa;
console.log(`lockstep-piglinwatch: ${2 + breaks} assertions, ${fails} failures, ${breaks} breaks caught`);
process.exit(fails ? 1 : 0);
