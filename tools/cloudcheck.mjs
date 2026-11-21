#!/usr/bin/env node
// #301: AreaEffectCloudEntity radius/durationOnUse + GlassBottleItem dragon-breath branch.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEngine } from './loadsrc.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const ASSETS = join(ROOT, 'assets');
const VERBOSE = process.argv.includes('--verbose');
const rdj = (f) => JSON.parse(readFileSync(join(ASSETS, f), 'utf8'));
const b64 = (f) => readFileSync(join(ASSETS, f)).toString('base64');

let pass = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); return c; };
let breaks = 0;
const okAv = (c, m) => { breaks++; ok(c, 'anti-vacuity: ' + m); if (c) console.log('   ✓ anti-vacuity: ' + m); };
const say = (...a) => { if (VERBOSE) console.log(...a); };

console.log('cloudcheck — loop/throwables-s116: snowball/egg/ender pearl/splash+lingering potion');

const EXTRA = ['02f_tags.js', '02g_items.js', '02h_recipes.js', '14f_inventory.js',
               '07b_behaviour.js', '07c_blockentity.js', '07d_mining.js', '07e_loot.js',
               '07f_redstone.js', '07h_entities.js', '07i_entitylist.js',
               '14b_physics.js', '14e_gamemode.js', '14i_hand.js', '14d_survival.js',
               '07q_effects.js', '07m_breed.js', '07z_potion.js', '14j_combat.js', '14l_use.js',
               '07zzd_throw.js', '10_gfx.js', '15h_bemodel.js', '07j_entityrender.js',
               // struck s117 -- sound (S.entitySound) and the egg/pearl particle bursts
               // (Px.spawnEggBurst/Px.spawnPearlBurst) both need their own module loaded to
               // exercise anything beyond the `if (NS.Sound && ...)`/`if (NS.Particle && ...)`
               // no-op guards `Th.use`/`Th.tickEgg`/`Th.tickPearl` already fall back to.
               '02j_sounds.js', '07zx_particle.js'];

const MCL = loadEngine({ extra: EXTRA, dom: false });
MCL.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
MCL.DATA = Object.assign({}, MCL.DATA, { entities: rdj('entities.json') });

const N = 32, MID = 16;
const cells = new Uint16Array(N * N * N);
const idx = (x, y, z) => (((y + MID) * N + (z + MID)) * N + (x + MID));
const inside = (x, y, z) => [x, y, z].every((v) => v + MID >= 0 && v + MID < N);
const W = { getBlock: (x, y, z) => (inside(x, y, z) ? cells[idx(x, y, z)] : 0),
            setBlock(x, y, z, id) { if (inside(x, y, z)) cells[idx(x, y, z)] = id; return true; },
            blockLightAt: () => 15 };
MCL.World = W;
MCL.Behave.init(W);
MCL.BlockEntities.init();
MCL.Behave.clearSchedule();
if (MCL.Redstone && MCL.Redstone.init) MCL.Redstone.init();
MCL.Entities.init();
MCL.EntityList.init();
MCL.Combat.init();
MCL.Breed.init();
MCL.Use.init(W);
MCL.Commands = { rules: {}, ruleGet(name) { return (name in this.rules) ? this.rules[name] : 'true'; } };

const Iv = MCL.Inventory, IT = MCL.Items, Use = MCL.Use, EL = MCL.EntityList, Cb = MCL.Combat,
      Th = MCL.Throw, Po = MCL.Potion, ES = MCL.Effects, Br = MCL.Breed, ER = MCL.EntityRender;

ok(Th && Th.ready, 'Throw module reports ready');
ok(!!EL.canSpawn('snowball') && !!EL.canSpawn('egg') && !!EL.canSpawn('ender_pearl') &&
   !!EL.canSpawn('potion') && !!EL.canSpawn('area_effect_cloud'),
   'all five projectile/cloud types are simulatable (EL.motionFor)');


function player(opts) {
  return Object.assign({ inventory: Iv.create(), slot: 0, instabuild: false, ex: 0, ey: 64, ez: 0, EYE: 1.62, yaw: 0, pitch: 0,
    lookVec() { return [0, 0, -1]; }, syncHotbar() {} }, opts || {});
}

const stk = (name, n, tag) => Iv.stack(name, n === undefined ? 1 : n, 0, tag);
const mob = (x, z) => { const e = EL.spawn('turtle', x, 64, z); e.maxHealth = e.health = 20; return e; };
const mk = (o) => { const c = EL.spawn('area_effect_cloud', 0, 64, 0, Object.assign({ potionId: 'poison', waitTime: 0, duration: 600, radius: 3, radiusGrowth: 0, radiusOnUse: 0, reapplicationDelay: 20 }, o || {})); c.age = 0; return c; };
const clear = () => { for (const e of EL.list.slice()) e.removed = true; };

// 1. radius test at every sampled distance, inside and just outside (turtle half-width 0.6 is irrelevant: centre dist decides)
console.log('1. radius boundary');
function hit(dist, tick) {
  clear(); const c = mk(); const t = mob(dist, 0); c.age = 5; tick(c); return !!ES.hasStatusEffect(t, 'poison');
}
const real = (c) => Po.tickCloud(c);
for (const d of [0, 0.5, 1, 2, 2.5, 2.9, 2.99]) ok(hit(d, real), `inside at ${d}`);
for (const d of [3.01, 3.1, 3.5, 4, 6]) ok(!hit(d, real), `outside at ${d}`);
// anti-vacuity: radius mutated to 2 / 4 flips the verdicts
okAv(!hit(2.5, (c) => { c.radius = 2; Po.tickCloud(c); }), 'a smaller radius misses 2.5');
okAv(hit(3.5, (c) => { c.radius = 4; Po.tickCloud(c); }), 'a larger radius hits 3.5');

// 2. durationOnUse + radiusOnUse
console.log('2. durationOnUse / radiusOnUse');
{ clear(); const c = mk({ durationOnUse: -100, radiusOnUse: -0.5 }); mob(0, 0); c.age = 5; Po.tickCloud(c);
  ok(c.duration === 500, 'duration 600 + durationOnUse -100'); ok(c.radius === 2.5, 'radius 3 - 0.5'); }
{ clear(); const c = mk({ durationOnUse: -600 }); mob(0, 0); c.age = 5; Po.tickCloud(c); ok(c.removed === true, 'duration <= 0 discards'); }
{ clear(); const c = mk({ durationOnUse: -100 }); mob(0, 0); c.age = 5; c.durationOnUse = 0; Po.tickCloud(c);
  okAv(c.duration === 600, 'without durationOnUse the duration is untouched'); }

// 3. bottle branch
console.log('3. GlassBottleItem dragon branch');
function bottle(owner, px) {
  clear(); const dr = owner ? { type: owner, x: 0, y: 64, z: 0 } : null;
  const c = mk({ shooter: dr, potionId: null }); c.y = 64;
  const P = player({ x: px, y: 64, z: 0, width: 0.6, height: 1.8 });
  Iv.setItem(P.inventory, 0, stk('glass_bottle', 2));
  const r = Use.glassBottleUse(P, Iv.getItem(P.inventory, 0));
  return { r, c, P };
}
{ const b = bottle('ender_dragon', 0);
  ok(b.r === true, 'dragon cloud in reach: bottle used'); ok(b.c.radius === 2.5, 'cloud radius -= 0.5');
  ok(Iv.getItem(b.P.inventory, 0).n === 1, 'one bottle spent');
  ok(Iv.countOf(b.P.inventory, IT.of('dragon_breath')) === 1, 'a dragon_breath bottle was given'); }
{ const b = bottle('ender_dragon', 3.2); ok(b.r === true, 'box expand(2): cloud r=3 + 0.3 + 2 reach edge 5.3 covers 3.2'); }
okAv(bottle('ender_dragon', 5.4).c.radius === 3, 'beyond the expanded box: cloud untouched');
okAv(bottle('zombie', 0).c.radius === 3, 'a cloud not owned by a dragon is untouched');
okAv(bottle(null, 0).c.radius === 3, 'an ownerless cloud is untouched');

console.log(`cloudcheck: ${pass} checks passed, ${fails.length} failures, ${breaks} breaks caught`);
for (const f of fails) console.log('  x ' + f);
process.exit(fails.length ? 1 : 0);
