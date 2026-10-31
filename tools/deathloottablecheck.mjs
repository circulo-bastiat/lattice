// #8214 DeathLootTable / DeathLootTableSeed: Cb.lootTableId honours e.deathLootTable, the seed fixes the roll,
// /summon NBT (C.applyNbt) sets both. Breaks its own engine (field ignored) to prove it can fail.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';
const A = join(MCLITE_ROOT, 'assets');
const rdj = (f) => JSON.parse(readFileSync(join(A, f), 'utf8'));
const b64 = (f) => readFileSync(join(A, f)).toString('base64');
const BASE = ['02f_tags.js', '02g_items.js', '07b_behaviour.js', '07_world.js', '07h_entities.js', '14b_physics.js', '07i_entitylist.js',
  '07k_goals.js', '07l_spawn.js', '07m_breed.js', '07n_tame.js', '07q_effects.js', '07y_equip.js', '07d_mining.js', '07e_loot.js', '14j_combat.js'];
const M = loadEngine({ extra: BASE, dom: false, initReg: true });
M.DATA = Object.assign({}, M.DATA, { entities: rdj('entities.json') });
M.Entities.init();
M.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
M.Loot.init({ loot: b64('loot.bin'), lootBytes: rdj('loot.meta.json').jsonBytes });
M.EntityList.init();
const EL = M.EntityList, Cb = M.Combat;
let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const FLESH = M.Items.of("rotten_flesh"); const name = (i) => (i === FLESH ? "rotten_flesh" : String(i));
function kill(e) {
  const got = [];
  const orig = EL.dropStack; EL.dropStack = (x, y, z, it, n) => got.push(name(it) + 'x' + n);
  try { Cb.dropLoot(e); } finally { EL.dropStack = orig; }
  return got.sort().join(',');
}
const mk = (f) => Object.assign({ type: 'pig', x: 0, y: 64, z: 0, health: 0, maxHealth: 10 }, f);
const run = () => {
  const out = {};
  out.zombie = kill(mk({ deathLootTable: 'minecraft:entities/zombie', deathLootTableSeed: 5 }));
  out.pig = kill(mk({ deathLootTableSeed: 5 }));
  out.bad = kill(mk({ deathLootTable: 'minecraft:entities/nonexistent_xyz' }));
  const s = [1, 2, 3, 4, 5, 6, 7, 8].map(() => kill(mk({ type: 'zombie', deathLootTable: 'minecraft:entities/zombie', deathLootTableSeed: 12345 })));
  out.same = s.every((x) => x === s[0]);
  out.vary = new Set(Array.from({ length: 40 }, (_, i) => kill(mk({ type: 'zombie', deathLootTable: 'minecraft:entities/zombie', deathLootTableSeed: i + 1 })))).size > 1;
  return out;
};
const r = run(); if (process.env.DBG) console.log(r, Object.keys(M).filter(k=>/Command/.test(k)), M.Items.name && 1);
ok(Cb.lootTableId(mk({ deathLootTable: 'minecraft:entities/zombie' })) === 'entities/zombie', 'lootTableId reads deathLootTable');
ok(Cb.lootTableId(mk({})) === 'entities/pig', 'default table unchanged');
ok(/rotten_flesh/.test(r.zombie) || r.zombie === '', 'zombie table drops only zombie items');
ok(!/porkchop/.test(r.zombie), 'pig with zombie table does not drop porkchop');
ok(r.bad === '', 'unknown table drops nothing, got ' + r.bad);
ok(r.same, 'same seed -> identical drops');
ok(r.vary, 'different seeds vary');
// zombie table must be able to give flesh across seeds
let flesh = false; for (let i = 1; i < 60 && !flesh; i++) flesh = /rotten_flesh/.test(kill(mk({ deathLootTable: 'minecraft:entities/zombie', deathLootTableSeed: i })));
ok(flesh, 'pig with DeathLootTable zombie drops rotten_flesh');
// applyNbt (summon)
try {
  const M2 = loadEngine({ extra: BASE.concat(['15g_commands.js']), dom: false, initReg: true });
  const e = {}; M2.Commands.applyNbt(e, { DeathLootTable: 'minecraft:entities/zombie', DeathLootTableSeed: 77 }); if (process.env.DBG) console.log(e);
  ok(e.deathLootTable === 'minecraft:entities/zombie' && e.deathLootTableSeed === 77, 'applyNbt sets both fields');
} catch (err) { fails.push('applyNbt load: ' + err.message); }
// round trip
ok(/'deathLootTable', 'deathLootTableSeed'/.test(readFileSync(join(MCLITE_ROOT, 'src/07zw_mobnbt.js'), 'utf8')), 'MobNbt COMMON persists both');
// anti-vacuity: engine that ignores the field must be caught
{
  const orig = Cb.lootTableId; Cb.lootTableId = (e) => 'entities/' + e.type;
  const rb = kill(mk({ deathLootTable: 'minecraft:entities/nonexistent_xyz' }));
  breaks++; if (rb === '') fails.push('anti-vacuity: ignoring the field was not detected'); 
  Cb.lootTableId = orig;
}
if (fails.length) { console.log('FAIL\n' + fails.join('\n')); process.exit(1); }
console.log(`deathloottablecheck: ${pass} passed, ${breaks} breaks caught`);
