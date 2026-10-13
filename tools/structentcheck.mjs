// structentcheck.mjs — #1099: structure-template entities (StructureTemplate.placeEntities).
// The bastion's mob pieces carry piglin_brute / piglin / hoglin entities; the pack must keep them,
// 04t must rotate them with the piece and hand each to exactly ONE chunk, and the world must
// spawn them persistent with initialize(STRUCTURE).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT, initRegistry } from './loadsrc.mjs';

const fails = []; let pass = 0;
const ok = (c, m) => { if (c) pass++; else fails.push(m); };

function run(brk) {
  const MCL = loadEngine({});
  const G = MCL.Gen, JG = MCL.Jigsaw || MCL.Structures.Jigsaw || MCL.JG, T = MCL.Templates;
  G.init(1337, Object.assign(G.defaults(), { climate: 'vanilla' }));
  const JGx = JG || MCL.Jigsaw;
  const res = { packed: 0, brutes: 0, dup: 0, rotOk: true, list: [] };
  for (const id of T.names()) res.packed += (T.get(T.index(id)).ents || []).length;
  if (brk === 'strip') for (const id of T.names()) T.get(T.index(id)).ents = [];
  // the mob piece, placed at all four rotations: a brute's world position must follow the turn
  const ti = T.index('bastion/mobs/melee_piglin');
  const e = T.get(ti);
  if (!brk) ok(e && e.ents && e.ents.length >= 1, 'melee_piglin template carries no entity');
  const seen = [];
  for (let rot = 0; rot < 4; rot++) {
    G.entityLog = [];
    const s = [0, 0, 0]; JGx.rotSize(e, rot, s);
    const p = { kind: 'template', tpl: ti, palIdx: 0, rot: brk === 'norot' ? 0 : rot, ox: 100, oy: 60, oz: 100, writeAir: false, procs: null, proj: JGx.PROJ_RIGID, seed: 1 };
    const SB = new Uint16Array(MCL.CFG.CHUNK_H * 256);
    // every chunk the piece could touch, plus neighbours: dedup means the sum is still one per entity
    for (let cx = 5; cx <= 8; cx++) for (let cz = 5; cz <= 8; cz++) {
      G.entityLog = [];
      JGx.writePiece(SB, cx, cz, p);
      for (const d of G.entityLog) { res.list.push(d); if (d[0] === 'piglin_brute') seen.push([rot, d[1], d[3], d[4], cx, cz]); }
    }
  }
  res.brutes = seen.length;
  for (let rot = 0; rot < 4; rot++) {
    const here = seen.filter((q) => q[0] === rot);
    if (here.length !== e.ents.filter((q) => q.id === 'piglin_brute').length) res.dup++;
    for (const q of here) {
      const en = e.ents[0], s = [0, 0, 0]; JGx.rotSize(e, rot, s);
      if (q[1] < 100 || q[1] > 100 + s[0] || q[2] < 100 || q[2] > 100 + s[2]) res.rotOk = false;
      if (q[3] !== en.yaw + 90 * rot) res.rotOk = false;
    }
  }
  return res;
}

const base = run(null);
ok(base.packed >= 50, `only ${base.packed} template entities packed (61 expected)`);
ok(base.brutes >= 4, `melee_piglin placed at 4 rotations yields ${base.brutes} brutes`);
ok(base.dup === 0, 'an entity was handed to more than one chunk, or none');
ok(base.rotOk, 'entity position/yaw does not follow the piece rotation');

let caught = 0;
const a = run('strip'); if (a.brutes < 4) caught++;
const b = run('norot'); if (!b.rotOk) caught++;

// the main thread: World.spawnStructureEntities makes persistent, structure-initialised mobs
function mainThread(brk) {
  const ASSETS = join(MCLITE_ROOT, 'assets');
  const rdj = (f) => JSON.parse(readFileSync(join(ASSETS, f), 'utf8'));
  const M = loadEngine({ extra: ['02f_tags.js', '02g_items.js', '07_world.js', '09b_sky.js', '14b_physics.js',
    '14f_inventory.js', '07h_entities.js', '07y_equip.js', '07ox_enchhelper.js', '07i_entitylist.js', '07l_spawn.js',
    '07m_breed.js', '14i_hand.js', '14j_combat.js', '14d_survival.js', '07zk_undead.js', '07q_effects.js', '07k_goals.js',
    '07zz_xporb.js', '07zzf_piglin.js'], dom: false });
  if (initRegistry) initRegistry(M);
  M.Items.init({ items: readFileSync(join(ASSETS, 'items.bin')).toString('base64'), itemsBytes: rdj('items.meta.json').rawBytes });
  M.DATA = Object.assign({}, M.DATA, { entities: rdj('entities.json') });
  M.Entities.init(); M.EntityList.init(); M.Equip.init();
  if (M.Breed && M.Breed.init) M.Breed.init();
  if (M.EnchHelper && M.EnchHelper.init) M.EnchHelper.init();
  if (M.Effects && M.Effects.init) M.Effects.init();
  if (M.Xp && M.Xp.init) M.Xp.init();
  M.Combat.init();
  if (M.Ai && M.Ai.init && !M.Ai.ready) M.Ai.init();
  M.Piglin.init();
  M.EntityList.list.length = 0;
  const list = brk ? [] : [['piglin_brute', 12.5, 70, -3.5, 90]];
  M.World.spawnStructureEntities(list, 'k');
  const n = M.World.spawnStructureEntities(list, 'k');   // the same chunk again: nothing
  const e = M.EntityList.list.find((q) => q.type === 'piglin_brute');
  return { e, again: n };
}
const mt = mainThread(false);
ok(mt.e && mt.e.persistent === true, 'structure brute is not persistent');
ok(mt.e && mt.e.homeX === 12.5 && mt.e.homeZ === -3.5, 'brute initialize(STRUCTURE) did not set its home');
ok(mt.again === 0, 'a chunk populated twice');
if (!mainThread(true).e) caught++;
ok(caught === 3, `anti-vacuity: only ${caught}/3 breaks caught`);

for (let i = 0; i < caught; i++) console.log('  ✓ break caught');
console.log(`structentcheck: ${pass} assertions, ${fails.length} failed\n ${caught} breaks caught`);
for (const f of fails) console.log('  FAIL ' + f);
process.exit(fails.length ? 1 : 0);
