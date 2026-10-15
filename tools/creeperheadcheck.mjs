#!/usr/bin/env node
// creeperheadcheck.mjs -- #749: a CHARGED creeper's blast makes a killed zombie/skeleton/wither skeleton/
// creeper drop its head (Zombie/Skeleton/WitherSkeleton/CreeperEntity.dropEquipment + shouldDropHead),
// once per creeper (headsDropped < 1). Prints "<n> breaks caught".
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';
const ASSETS = join(MCLITE_ROOT, 'assets');
const rdj = (f) => JSON.parse(readFileSync(join(ASSETS, f), 'utf8'));
const b64 = (f) => readFileSync(join(ASSETS, f)).toString('base64');
let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const okAv = (c, m) => { breaks++; if (c) console.log('   ✓ ' + m); ok(c, 'anti-vacuity: ' + m); };

const EXTRA = ['02f_tags.js', '02g_items.js', '07_world.js', '07b_behaviour.js', '07d_mining.js',
  '07e_loot.js', '07h_entities.js', '14b_physics.js', '14c_raycast.js', '07i_entitylist.js', '07k_goals.js',
  '07l_spawn.js', '14d_survival.js', '14j_combat.js', '07za_explosion.js', '07zb_creeper.js'];
const M = loadEngine({ extra: EXTRA, dom: false });
M.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
M.DATA = Object.assign({}, M.DATA, { entities: rdj('entities.json') });
const W = M.World, EL = M.EntityList, Cb = M.Combat, Ex = M.Explosion, CH = M.CH;
M.Behave.init(W); M.Entities.init(); EL.init(); M.Ai.init(); M.Spawn.init(); Cb.init(); Ex.init(); M.Creeper.init();
if (M.Loot && M.Loot.init) { try { M.Loot.init({ loot: b64('loot.bin'), lootBytes: rdj('loot.meta.json').jsonBytes }); } catch (e) {} }

function fresh() {
  W.init(1);
  for (let cx = -1; cx <= 1; cx++) for (let cz = -1; cz <= 1; cz++) {
    const c = W.makeChunk(cx, cz); c.state = CH.GENERATED; W.chunks.set(W.key(cx, cz), c);
  }
  EL.init();
}
const heads = (name) => EL.list.filter((x) => x.type === 'item' && !x.removed && x.item === M.Items.of(name)).length;
function scenario(victimType, charged, headName, tweak) {
  fresh();
  const cr = EL.spawn('creeper', 5, 5, 5); cr.charged = charged;
  const v1 = EL.spawn(victimType, 6.5, 5, 5), v2 = EL.spawn(victimType, 4.5, 5, 5);
  if (tweak) tweak(v1, v2);
  v1.health = v2.health = 1;
  M.Creeper.explode(cr);
  for (let i = 0; i < 3; i++) EL.tick && EL.tick(1 / 20);
  for (const v of [v1, v2]) if (!v.lootDropped) Cb.tickEntity(v);
  return { v1, v2, n: heads(headName) };
}
ok(M.Items.of('zombie_head') >= 0, 'zombie_head item exists');
for (const [type, head] of [['zombie', 'zombie_head'], ['skeleton', 'skeleton_skull'], ['wither_skeleton', 'wither_skeleton_skull'],
  ['creeper', 'creeper_head']]) {
  const r = scenario(type, true, head);
  ok(r.v1.dead && r.v2.dead, `${type}: both victims die in the blast`);
  ok(r.n === 1, `${type}: charged creeper blast, two victims -> exactly one ${head} (got ${r.n})`);
  const u = scenario(type, false, head);
  ok(u.n === 0, `${type}: an uncharged creeper drops no head (got ${u.n})`);
}
for (const [type, head] of [['stray', 'skeleton_skull'], ['giant', 'zombie_head'], ['husk', 'zombie_head'], ['zombie_villager', 'zombie_head'], ['zombified_piglin', 'zombie_head']]) {
  fresh();
  const cr = EL.spawn('creeper', 5, 5, 5); cr.charged = true;
  const d = EL.spawn(type, 6.5, 5, 5); d.health = 1;
  M.Creeper.explode(cr); Cb.tickEntity(d);
  okAv(heads(head) === 0 && !(cr.headsDropped >= 1), `${type}: no dropEquipment head branch -> nothing dropped, headsDropped stays 0`);
}
{
  const r = scenario('giant', true, 'zombie_head');
  ok(r.n === 0, `giant: GiantEntity extends HostileEntity, no head branch (got ${r.n})`);
}
{
  const r = scenario('drowned', true, 'zombie_head');
  ok(r.v1.dead && r.v2.dead, 'drowned: both victims die in the blast');
  ok(r.n === 0, `drowned: DrownedEntity.getSkull is EMPTY -> no head (got ${r.n})`);
  fresh();
  const cr = EL.spawn('creeper', 5, 5, 5); cr.charged = true;
  const d = EL.spawn('drowned', 6.5, 5, 5); d.health = 1;
  M.Creeper.explode(cr); Cb.tickEntity(d);
  ok(!(cr.headsDropped >= 1), 'drowned kill does not consume the creeper head quota');
  okAv(heads('zombie_head') === 0 && !(cr.headsDropped >= 1), 'drowned: nothing dropped, headsDropped stays 0');
}
{
  const r = scenario('zombie', true, 'zombie_head');
  okAv(r.n === 1, 'sanity for the break below');
  // break 1: creeper that already dropped a head (headsDropped=1) must not drop another
  fresh();
  const cr = EL.spawn('creeper', 5, 5, 5); cr.charged = true; cr.headsDropped = 1;
  const z = EL.spawn('zombie', 6.5, 5, 5); z.health = 1;
  M.Creeper.explode(cr); Cb.tickEntity(z);
  okAv(heads('zombie_head') === 0, 'a creeper with headsDropped=1 makes no head (shouldDropHead false)');
  // break 2: a zombie killed by something else (no attacker) drops no head
  fresh();
  const z2 = EL.spawn('zombie', 6.5, 5, 5); z2.health = 1; Cb.hurt(z2, 50, undefined, false); Cb.tickEntity(z2);
  okAv(heads('zombie_head') === 0, 'a zombie killed with no creeper attacker drops no head');
}
console.log(`\n${pass} checks passed, ${breaks} breaks caught, ${fails.length} failed`);
if (fails.length) { fails.forEach((f) => console.log('  FAIL: ' + f)); process.exit(1); }
