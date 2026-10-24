#!/usr/bin/env node
// lockstep-witchraid -- #7103: witch RaidGoal target selection, 20 salts. Reference from RaidGoal/ActiveTargetGoal/WitchEntity in .decomp:
// canStart = cooldown<=0 && nextBoolean && active raid && closest raider (box expand(16,4,16), feet range 16, mustSee, not witch, nearest by EYE-Y); start sets cooldown 200.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from '../loadsrc.mjs';
const ASSETS = join(MCLITE_ROOT, 'assets');
const rdj = (f) => JSON.parse(readFileSync(join(ASSETS, f), 'utf8'));
const b64 = (f) => readFileSync(join(ASSETS, f)).toString('base64');
const EXTRA = ['02f_tags.js', '02g_items.js', '07_world.js', '07b_behaviour.js', '07d_mining.js',
               '07e_loot.js', '07h_entities.js', '07y_equip.js', '14b_physics.js', '14c_raycast.js',
               '07i_entitylist.js', '07k_goals.js', '07l_spawn.js', '14d_survival.js',
               '14j_combat.js', '07za_explosion.js', '07m_breed.js', '07zj_fox.js'];
const MCL = loadEngine({ extra: EXTRA, dom: false });
MCL.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
MCL.DATA = Object.assign({}, MCL.DATA, { entities: rdj('entities.json') });
const EL = MCL.EntityList, Ai = MCL.Ai, W = MCL.World, Ent = MCL.Entities, CH = MCL.CH;
Ent.init(); Ent.attrs = MCL.DATA.entities.attrs;
W.init(1); MCL.Behave.init(W); EL.init(); Ai.init(); MCL.Spawn.init(); MCL.Breed.init();
for (let cx = -1; cx <= 1; cx++) for (let cz = -1; cz <= 1; cz++) {
  const c = W.makeChunk(cx, cz); c.state = CH.GENERATED; W.chunks.set(W.key(cx, cz), c);
}
const fails = []; let checks = 0;
const ok = (c, m) => { checks++; if (!c && fails.length < 25) fails.push(m); };
MCL.Raid = { Status: { ONGOING: 'ongoing' } };
const raids = { 7: { status: 'ongoing' }, 8: { status: 'stopped' } };
MCL.RaidManager = { world: { raids } };
function stream(seed) { let s = seed >>> 0 || 1; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; }
const sees = Ai.canSee, EYE0 = Ai.eyeOf;
function run() {
  fails.length = 0; checks = 0;
  for (let salt = 1; salt <= 20; salt++) for (const raidId of [7, 8]) for (const cd of [0, 40]) for (const roll of [0.2, 0.8]) {
    for (const e of EL.list.slice()) EL.remove ? EL.remove(e) : (e.removed = true);
    EL.list.length = 0;
    const r = stream(salt * 104729);
    const w = EL.spawn('witch', 0, 64, 0, {}); w.raidId = raidId; w.witchRaidCooldown = cd;
    const kinds = ['pillager', 'vindicator', 'ravager', 'witch'];
    const al = [];
    for (let i = 0; i < 4; i++) {
      const ang = r() * 6.283, dist = [4, 10, 15, 18][Math.floor(r() * 4)] * (0.8 + r() * 0.2), dy = Math.round((r() * 14 - 7) * 2) / 2;
      const a = EL.spawn(kinds[i], Math.cos(ang) * dist, 64 + dy, Math.sin(ang) * dist, {}); a.raidId = 7; a.health = a.maxHealth ? a.maxHealth * 0.6 : 7; a.seen = r() < 0.8; al.push(a);
    }
    { const up = 2 + (salt % 4), R = 2 + (salt % 2);   // tie on feet distance, split by eye-Y
      const B = EL.spawn('vindicator', 0, 64 - up, R, {}), A = EL.spawn('pillager', R, 64 + up, 0, {});
      A.raidId = B.raidId = 7; A.seen = B.seen = true; al.unshift(B, A); }
    Ai.canSee = (_, t) => !!t.seen;
    const eye = 64 + EYE0(w);
    let want = null, bd = Infinity;
    if (cd <= 0 && roll >= 0.5 && raidId === 7) for (const a of al) {
      if (a.type === 'witch' || !Ai.RAIDER_TYPES[a.type]) continue;
      const hh = w.height || 1.95, ah = a.height || 0;
      if (a.y > 64 + hh + 4 || a.y + ah < 64 - 4) continue;
      if (Math.hypot(a.x, a.y - 64, a.z) > 16) continue;
      if (!a.seen) continue;
      const d = Math.hypot(a.x, a.y - eye, a.z);
      if (d < bd) { bd = d; want = a; }
    }
    const g = new Ai.RaidGoal(w, { random: () => roll });
    const can = g.canUse();
    const tag = `salt ${salt} raid=${raidId} cd=${cd} roll=${roll}`;
    ok(can === !!want, tag + ` canUse ${can} want ${!!want}`);
    if (can && want) { ok(w.target === want, tag + ' wrong ally'); g.start(); ok(w.witchRaidCooldown === 200, tag + ' cooldown ' + w.witchRaidCooldown); }
  }
  return fails.length;
}
const base = run();
console.log(`lockstep-witchraid: ${checks} assertions, ${base} divergences`);
fails.forEach((f) => console.log('  FAIL ' + f));
let nfail = base, nbreaks = 0;
function mut(name, apply, undo) {
  apply(); const q = console.log; console.log = () => {}; const r = run(); console.log = q; undo();
  if (r > 0) { nbreaks++; console.log('   ✓ break caught: ' + name); } else { nfail++; console.log('  NOT CAUGHT: ' + name); }
}
const eyeO = Ai.eyeOf;
mut('feet-Y instead of eye-Y for nearest ally', () => { Ai.eyeOf = () => 0; }, () => { Ai.eyeOf = eyeO; });
mut('raid status ignored', () => { raids[8].status = 'ongoing'; }, () => { raids[8].status = 'stopped'; });
Ai.canSee = sees;
console.log(`lockstep-witchraid: ${checks} assertions, ${nfail} failures, ${nbreaks} breaks caught`);
process.exit(nfail ? 1 : 0);
