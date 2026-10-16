#!/usr/bin/env node
// enderdragonnbtcheck.mjs — #2982: EnderDragonEntity.writeCustomDataToNbt/readCustomDataFromNbt
// (.decomp): int DragonPhase (phase type id) + int DragonDeathTime (ticksSinceDeath) round-trip
// through MobNbt.serializeAll/restoreAll (07zw_mobnbt.js) and ED.initEntity.
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const rdj = (f) => JSON.parse(readFileSync(join(MCLITE_ROOT, 'assets', f), 'utf8'));
let pass = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
let breaks = 0;
const okAv = (c, m) => { breaks++; ok(c, 'anti-vacuity: ' + m); if (c) console.log('   ✓ ' + m); };
console.log('enderdragonnbtcheck -- #2982 DragonPhase / DragonDeathTime NBT');

function fresh() {
  const M = loadEngine({ extra: ['07_world.js', '07h_entities.js', '14b_physics.js', '07k_goals.js',
    '07i_entitylist.js', '07zzl_enderdragon.js', '07zw_mobnbt.js'] });
  M.DATA = Object.assign({}, M.DATA, { entities: rdj('entities.json') });
  M.Entities.init(); M.EntityList.init(); M.EnderDragon.init();
  return M;
}
const A = fresh();
const ED = A.EnderDragon;
const d = A.EntityList.spawn('ender_dragon', 3, 90, -7, {});
const dying = ED.PHASE_TYPES.byName.Dying;
d.dragon.getPhaseManager().setPhase(dying);
d.dragon.ticksSinceDeath = 100;
// D-838: a fight spawns its end_crystal ring with the dragon, so the dragon's is not the only record
const recs = JSON.parse(JSON.stringify(A.MobNbt.serializeAll())).filter((x) => x.type === 'ender_dragon');
ok(recs.length === 1 && recs[0].dragonPhase === dying.id && recs[0].dragonDeathTime === 100,
  'record carries phase id + death time: ' + JSON.stringify(recs[0]));

const B = fresh();
ok(B.MobNbt.restoreAll(recs) === 1, 'one dragon restored');
const r = B.EntityList.list.find((e) => e.type === 'ender_dragon');
ok(r && r.dragon.getPhaseManager().getCurrent().type === B.EnderDragon.PHASE_TYPES.byName.Dying, 'phase restored to Dying');
ok(r && r.dragon.ticksSinceDeath === 100, 'ticksSinceDeath restored to 100, got ' + (r && r.dragon.ticksSinceDeath));

// anti-vacuity: a record stripped of the two tags restores the fresh-spawn defaults
const C = fresh();
const bare = recs.map((x) => { const y = Object.assign({}, x); delete y.dragonPhase; delete y.dragonDeathTime; return y; });
C.MobNbt.restoreAll(bare);
const c = C.EntityList.list.find((e) => e.type === 'ender_dragon');
okAv(c.dragon.getPhaseManager().getCurrent().type !== C.EnderDragon.PHASE_TYPES.byName.Dying, 'without DragonPhase the phase is not Dying');
okAv(!c.dragon.ticksSinceDeath, 'without DragonDeathTime ticksSinceDeath is 0');

if (fails.length) { fails.forEach((f) => console.log('  FAIL ' + f)); console.log(`${fails.length} failed`); process.exit(1); }
console.log(`OK  ${pass} checks passed, 0 failures; ${breaks} breaks caught`);
