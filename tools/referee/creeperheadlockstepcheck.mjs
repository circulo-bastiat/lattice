// creeperheadlockstepcheck.mjs -- #6940 (G17-L200): lockstep scenario 'creeperhead', 20 salts: a CHARGED creeper blows up inside a ring of zombie, skeleton, wither skeleton, creeper (health 1) and a cow, with a far mob outside the blast and a mid mob inside it. Per tick: drops list (item names), entity list, health values; explosion radius (charged power 3*2 -> reach 12: mid mob at 8 hurt, far mob at 15 untouched); only the FIRST killed head mob of the blast yields its head (CreeperEntity.shouldDropHead: charged && headsDropped < 1, onHeadDropped). Reference = .decomp CreeperEntity.explode / dropEquipment of Zombie/AbstractSkeleton/WitherSkeleton/Creeper (head item per type) written independently below.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from '../loadsrc.mjs';
const A = join(MCLITE_ROOT, 'assets');
const rdj = (f) => JSON.parse(readFileSync(join(A, f), 'utf8'));
const b64 = (f) => readFileSync(join(A, f)).toString('base64');
const EXTRA = ['02f_tags.js', '02g_items.js', '07_world.js', '07b_behaviour.js', '07d_mining.js', '07e_loot.js', '07h_entities.js', '14b_physics.js', '14c_raycast.js', '07i_entitylist.js', '07k_goals.js', '07l_spawn.js', '14d_survival.js', '14j_combat.js', '07za_explosion.js', '07zb_creeper.js'];
const M = loadEngine({ extra: EXTRA, dom: false });
M.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
M.DATA = Object.assign({}, M.DATA, { entities: rdj('entities.json') });
const W = M.World, EL = M.EntityList, Cb = M.Combat, Ex = M.Explosion, CH = M.CH;
M.Behave.init(W); M.Entities.init(); EL.init(); M.Ai.init(); M.Spawn.init(); Cb.init(); Ex.init(); M.Creeper.init();
if (M.Loot && M.Loot.init) { try { M.Loot.init({ loot: b64('loot.bin'), lootBytes: rdj('loot.meta.json').jsonBytes }); } catch (e) {} }
let fails = 0, breaks = 0;
const ok = (c, m) => { if (!c) { fails++; console.log('  FAIL ' + m); } };
const brk = (c, m) => { if (c) { breaks++; console.log('   ✓ break caught: ' + m); } else { fails++; console.log('  ✗ break NOT caught: ' + m); } };
const stream = (salt) => { let s = (salt * 2654435761 + 12345) >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; };
const HEAD = { zombie: 'zombie_head', skeleton: 'skeleton_skull', wither_skeleton: 'wither_skeleton_skull', creeper: 'creeper_head' };
const TYPES = Object.keys(HEAD);
const cfg = { radius: 3, noLimit: false };
function lane(salt) {
  const r = stream(salt);
  W.init(1);
  for (let cx = -2; cx <= 2; cx++) for (let cz = -2; cz <= 2; cz++) { const c = W.makeChunk(cx, cz); c.state = CH.GENERATED; W.chunks.set(W.key(cx, cz), c); }
  EL.init();
  const cr = EL.spawn('creeper', 5, 5, 5); cr.charged = true; cr.explosionRadius = cfg.radius;
  const order = TYPES.slice().sort(() => r() - 0.5);
  const ring = [];
  [...order, 'cow'].forEach((t, i) => {
    const a = (i / 5) * Math.PI * 2 + r() * 0.3, d = 1 + r() * 1.2;
    const e = EL.spawn(t, 5 + Math.cos(a) * d, 5, 5 + Math.sin(a) * d); e.health = 1; ring.push(e);
  });
  const mid = EL.spawn('zombie', 13, 5, 5), far = EL.spawn('zombie', 20, 5, 5);   // 8 and 15 blocks out
  const midHp = mid.health, farHp = far.health;
  // reference: ring all die (health 1, inside reach); head goes to the first killed head mob (list order), once
  const headMobs = ring.filter((e) => HEAD[e.type]);
  const refHead = HEAD[headMobs[0].type];
  M.Creeper.explode(cr);
  for (let t = 0; t < 5; t++) {
    EL.tick && EL.tick(1 / 20);
    for (const e of ring) if (!e.lootDropped) Cb.tickEntity(e);
    const drops = EL.list.filter((x) => x.type === 'item' && !x.removed).map((x) => M.Items.nameOf(x.item));
    const heads = drops.filter((n) => /_head$|_skull$/.test(n));
    if (cfg.noLimit === false && heads.length > 1) return 'salt ' + salt + ' tick ' + t + ' heads ' + heads.join();
    if (heads.length !== 1 || heads[0] !== refHead) { if (t >= 1) return 'salt ' + salt + ' tick ' + t + ' heads ' + heads.join() + ' ref ' + refHead; }
    if (EL.list.filter((x) => x === cr && !x.removed).length) return 'salt ' + salt + ' creeper not removed';
  }
  for (const e of ring) if (!(e.dead || e.removed || e.health <= 0)) return 'salt ' + salt + ' ' + e.type + ' survived hp ' + e.health;
  if (!(mid.health < midHp)) return 'salt ' + salt + ' mid mob at 8 unharmed (radius)';
  if (far.health !== farHp) return 'salt ' + salt + ' far mob at 15 hurt ' + far.health + ' (radius)';
  return null;
}
const pass = () => Array.from({ length: 20 }, (_, i) => lane(i)).filter(Boolean);
const base = pass();
ok(base.length === 0, 'lane: ' + base.slice(0, 2).join(' | '));
cfg.radius = 6;
brk(pass().length > 0, 'charged radius 3 -> 6 caught'); cfg.radius = 3;
const tick0 = Cb.tickEntity;
Cb.tickEntity = function (e) { for (const x of EL.list) if (x.type === 'creeper' && x.charged) x.headsDropped = 0; return tick0.apply(this, arguments); };
cfg.noLimit = true;
brk(pass().length > 0, 'head-per-blast limit removed caught'); cfg.noLimit = false;
Cb.tickEntity = tick0;
ok(pass().length === 0, 'unfaulted lane passes after restore');
console.log(`creeperheadlockstepcheck: ${3 + breaks} assertions, ${fails} failures, ${breaks} breaks caught`);
process.exit(fails ? 1 : 0);
