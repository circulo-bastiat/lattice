// #6324: lockstep scenario 'lightning': a bolt strikes a standing cow, creeper, pig, villager and a player-equivalent dummy.
// Per tick: entity list, health, fire ticks, charged flag, converted type. Reference = vanilla 1.18.2 (.decomp Entity.thunderHit:
// remainingFireTicks +1 -> setOnFireFor(8) = 160, hurt 5.0; Creeper charged; Pig -> zombified_piglin, Villager -> witch, both
// persistent, no damage/fire; Mooshroom.thunderHit is not in 1.18.2). 20 salts = 20 spawn positions; the fault 160 -> 120 is caught.
import { loadEngine, initRegistry, MCLITE_ROOT } from '../loadsrc.mjs';
import { serverRow, engineRow, compareTraces } from './lockstep/trace.mjs';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ASSETS = join(MCLITE_ROOT, 'assets');

const M = loadEngine({
  extra: ['02f_tags.js', '02g_items.js', '07d_mining.js', '07e_loot.js', '07b_behaviour.js',
          '07h_entities.js', '14b_physics.js', '07i_entitylist.js', '07k_goals.js',
          '07y_equip.js', '07m_breed.js', '07zn_mooshroom.js', '07l_spawn.js', '09b_sky.js',
          '14j_combat.js', '07s_raid.js', '07zzc_lightning.js'],
  dom: false
});
initRegistry(M);
{
  const meta = JSON.parse(readFileSync(join(ASSETS, 'items.meta.json'), 'utf8'));
  M.Items.init({ items: readFileSync(join(ASSETS, 'items.bin')).toString('base64'), itemsBytes: meta.rawBytes });
}
M.DATA = Object.assign({}, M.DATA, {
  entities: JSON.parse(readFileSync(join(ASSETS, 'entities.json'), 'utf8'))
});
M.Entities.init();
M.EntityList.init();
M.Ai.init();
M.Equip.init();

const EL = M.EntityList, Lgt = M.Lightning, Eq = M.Equip, IT = M.Items;

// a fake world (the same shape silverfishcheck's own stub uses): a Map keyed "x,y,z" -> state id.
const CELLS = new Map();
const key = (x, y, z) => x + ',' + y + ',' + z;
M.World = {
  getBlock: (x, y, z) => CELLS.get(key(x, y, z)) || 0,
  setBlock: (x, y, z, st) => { CELLS.set(key(x, y, z), st); return true; },
  get: () => null,
  heightAt: () => 63,
  biomeAt: () => 1,
  chunks: new Map(),
  tickingAt: () => true
};
M.CH = { GENERATED: 2 };
M.Behave.init(M.World);
M.Commands = { rules: {}, ruleGet(name) { return (name in this.rules) ? this.rules[name] : 'true'; } };
M.Diff = { value: 'normal', get() { return this.value; } };
const RealSky = M.Sky;   // 09b_sky.js's own, kept for section 8 (the stub below replaces it)
M.Sky = {
  weather: { raining: true, thundering: true, rainLevel: 1, thunderLevel: 1 },
  newWeather() { return this.weather; },
  isThundering() { return true; },
  isRainingAt() { return true; }
};
M.Player = { x: 0, y: 64, z: 0, dead: false };


const Cb = M.Combat;
let bad = 0, n = 0, caught = 0; const ok = (c, m) => { n++; if (!c) { bad++; console.log('FAIL ' + m); } };
const TYPES = ['cow', 'creeper', 'pig', 'villager', 'dummy'];
const fire = (e) => e.remainingFireTicks | 0;
function run(salt) {
  EL.clear(); CELLS.clear();
  const bx = 100 * salt, ents = TYPES.map((t, i) => (t === 'dummy' ? EL.spawn('cow', bx + 0.2 * i, 64, 0.2, {}) : EL.spawn(t, bx + 0.2 * i, 64, 0.2, {})));
  ents[4].maxHealth = ents[4].health = 20;   // the player-equivalent: 20 hp, takes the generic hit
  const bolt = EL.spawn('lightning_bolt', bx, 64, 0, {});
  const rows = [];
  for (let t = 0; t < 4; t++) {
    if (t === 1) Lgt.strikeEntities(bolt);
    rows.push(TYPES.map((ty, i) => { const e = ents[i]; return engineRow(t, Object.assign({}, e, { fireTicks: e.removed ? null : fire(e) }), {}); }).map((r, i) => Object.assign(r, { charged: !!ents[i].charged, removed: !!ents[i].removed })));
    for (const e of ents) if (!e.removed && e.remainingFireTicks > 0) e.remainingFireTicks--;
  }
  return { rows, ents, bx };
}
const expect = (salt, r) => {   // vanilla trace: per tick, per entity [health, fire, charged, removed]
  const hp0 = r.rows[0].map((x) => x.health);
  return r.rows.map((tick, t) => tick.map((_, i) => {
    const struck = t >= 1, gone = struck && (i === 2 || i === 3);
    if (gone) return [null, null, false, true];
    return [struck ? hp0[i] - 5 : hp0[i], struck ? 160 - (t - 1) : 0, struck && i === 1, false];
  }));
};
for (let salt = 0; salt < 20; salt++) {
  const r = run(salt), exp = expect(salt, r);
  const cmp = (rows) => { for (let t = 0; t < rows.length; t++) for (let i = 0; i < 5; i++) {
    const x = rows[t][i], e = exp[t][i], got = [x.removed ? null : x.health, x.removed ? null : x.fireTicks, x.charged, x.removed];
    const A = [serverRow(t, { Health: e[0], Fire: e[1] }, {})], B = [engineRow(t, { health: got[0], fireTicks: got[1] })];
    const d = compareTraces(A, B, { fields: ['health', 'fireTicks'] }); if (d) return { d, i, t };
    if (e[2] !== got[2] || e[3] !== got[3]) return { d: { field: 'charged/removed' }, i, t };
  } return null; };
  const res = cmp(r.rows); ok(res === null, `salt ${salt}: ${res && JSON.stringify(res)}`);
  const alive = EL.list.filter((e) => !e.removed).map((e) => e.type);
  ok(alive.includes('zombified_piglin') && alive.includes('witch') && !alive.includes('pig') && !alive.includes('villager'), `salt ${salt}: pig -> zombified_piglin, villager -> witch (${alive})`);
  ok(EL.list.filter((e) => e.type === 'witch' || e.type === 'zombified_piglin').every((e) => e.persistent === true), `salt ${salt}: converted mobs persistent`);
  if (salt === 0) {   // fault: 6 s fire (120 ticks) must be reported at the strike tick
    const real = Cb.igniteForSeconds; Cb.igniteForSeconds = (e, s) => real(e, s - 2);
    const f = run(0); Cb.igniteForSeconds = real;
    const d = cmp(f.rows); if (d && d.t === 1 && d.d.field === 'fireTicks') caught++; else ok(false, 'fire 160 -> 120 not caught at strike tick: ' + JSON.stringify(d));
  }
}
console.log(`${n} assertions, ${bad} failures, ${caught} breaks caught`);
if (bad) process.exit(1);
