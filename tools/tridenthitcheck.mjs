#!/usr/bin/env node
// tridenthitcheck.mjs (#2908) -- TridentEntity.onEntityHit: a hit sets dealtDamage, ricochets the velocity
// by (-0.01,-0.1,-0.01), plays item.trident.hit and does NOT discard; a dealtDamage trident no longer collides.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, initRegistry, MCLITE_ROOT } from './loadsrc.mjs';

const ASSETS = join(MCLITE_ROOT, 'assets');
const VERBOSE = process.argv.includes('--verbose');
const rdj = (f) => JSON.parse(readFileSync(join(ASSETS, f), 'utf8'));
const b64 = (f) => readFileSync(join(ASSETS, f)).toString('base64');

let pass = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); return c; };
let breaks = 0;
const okAv = (c, m) => { breaks++; ok(c, "anti-vacuity: " + m); if (c) console.log("   ✓ " + m); };
const say = (s) => { if (VERBOSE) console.log(s); };


const EXTRA = ['02f_tags.js', '02g_items.js', '07_world.js', '07b_behaviour.js', '07d_mining.js',
               '07e_loot.js', '07h_entities.js', '07y_equip.js', '14b_physics.js', '14c_raycast.js',
               '07i_entitylist.js', '07k_goals.js', '07l_spawn.js', '14d_survival.js',
               '14f_inventory.js', '14j_combat.js', '14l_use.js', '07za_explosion.js',
               '09b_sky.js', '07q_effects.js', '07zk_undead.js'];
const MCL = loadEngine({ extra: EXTRA, dom: false });
initRegistry(MCL);
MCL.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
MCL.DATA = Object.assign({}, MCL.DATA, { entities: rdj('entities.json') });

const EL = MCL.EntityList, Ai = MCL.Ai, Spawn = MCL.Spawn, Ent = MCL.Entities;
const Un = MCL.Undead, W = MCL.World, S = MCL.States, R = MCL.Reg, Bh = MCL.Behave;
const Eq = MCL.Equip, Cb = MCL.Combat, IT = MCL.Items, Sky = MCL.Sky, ES = MCL.Effects;
const CH = MCL.CH, B = MCL.Biomes;

MCL.Entities.init();
Ent.attrs = MCL.DATA.entities.attrs;
W.init(1);
Bh.init(W);
EL.init();
Ai.init();
Spawn.init();
if (Cb && Cb.init) Cb.init();
if (Eq && Eq.init) Eq.init();
Sky.init();

for (let cx = -1; cx <= 1; cx++) for (let cz = -1; cz <= 1; cz++) {
  const c = W.makeChunk(cx, cz); c.state = CH.GENERATED; W.chunks.set(W.key(cx, cz), c);
}

ok(Un && Un.ready, 'NS.Undead did not load/ready');
ok(B && B.ready, 'the biome registry loaded (initRegistry)');



const sounds = [];
MCL.Sound = { entitySound: (ev) => { sounds.push(ev); } };
const stone = S.stateOf('stone') | 0;
for (let dx = -6; dx <= 6; dx++) for (let dz = -6; dz <= 6; dz++) { W.setBlock(dx, 62, dz, stone); for (let dy = 63; dy <= 68; dy++) W.setBlock(dx, dy, dz, 0); }

const shooter = { type: 'drowned', x: -4, y: 63, z: 0, removed: false };
const mk = () => EL.spawn('trident', 0.4, 63.5, 0, { vx: 0.5, vy: -0.3, vz: 0.2, shooter });
const victim = EL.spawn('zombie', 0, 63, 0, {});
const hp0 = victim.health;
const t = mk();
Cb.tickTrident(t);
okAv(victim.health < hp0, 'the hit hurt the victim');
okAv(t.removed !== true && t.dealtDamage === true, 'the trident survives the hit with dealtDamage');
okAv(Math.abs(t.vx + 0.005 * 0.99) < 1e-9 && Math.abs(t.vy - (0.03 * 0.99 - 0.05)) < 1e-9 && Math.abs(t.vz + 0.002 * 0.99) < 1e-9, 'velocity ricochets by (-0.01,-0.1,-0.01), then this tick\'s drag and gravity');
okAv(sounds.includes('item.trident.hit'), 'item.trident.hit played');
const hp1 = victim.health; victim.hurtResist = 0; for (const k of Object.keys(victim)) if (/invul|hurtT|iframe|grace/i.test(k)) victim[k] = 0;
t.x = victim.x; t.y = victim.y + 0.5; t.z = victim.z;
Cb.tickTrident(t);
okAv(victim.health === hp1, 'a dealtDamage trident no longer collides');
t.x = 0.5; t.y = 63.2; t.z = 0; t.vx = 0; t.vy = -0.5; t.vz = 0; Cb.tickTrident(t);   // the raycast finds the stone floor at y 63
okAv(sounds.includes('item.trident.hit_ground') && t.stuck === true, 'landing plays item.trident.hit_ground');

console.log('================ tridenthitcheck ================');
console.log(` assertions passed .. ${pass}`);
console.log(` failures ........... ${fails.length}`);
for (const f of fails) console.log('   ✗ ' + f);
console.log(` breaks caught ...... ${breaks}`);
process.exit(fails.length ? 1 : 0);
