// villagerlookcustomerlockstepcheck.mjs -- #7098 (G18f-L7): lockstep scenario 'lookcustomer', 20 salts: a villager and a scripted player that opens the trade screen at tick 40 standing 3 blocks off, walks 8 blocks away at tick 120 (screen stays open), returns to 3 blocks at tick 200 and closes the screen at tick 260. Per tick vs an independent reference of .decomp FollowCustomerTask.shouldRun/keepRunning (alive, customer != null, !touchingWater, squaredDistanceTo <= 16, currentScreenHandler != null) + run() (WALK_TARGET closeEnough 2 and LOOK_TARGET = customer) + finishRunning (both forgotten): customer set/cleared, walk/look targets present and on the customer, cleared when out of range or screen closed. Mutations: no clear on distance, radius 16 -> 25 and a dropped look target are caught.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from '../loadsrc.mjs';
const A = join(MCLITE_ROOT, 'assets');
const rdj = (f) => JSON.parse(readFileSync(join(A, f), 'utf8'));
const EXTRA = ['02f_tags.js', '02g_items.js', '07_world.js', '07b_behaviour.js', '07c_blockentity.js', '07d_mining.js', '07e_loot.js', '07h_entities.js', '07y_equip.js', '14b_physics.js', '14c_raycast.js', '07i_entitylist.js', '07l_spawn.js', '14d_survival.js', '14f_inventory.js', '14j_combat.js', '14l_use.js', '07za_explosion.js', '07m_breed.js', '07q_effects.js', '07zu_poi.js', '07o_profession.js', '07k_goals.js', '07zv_villagerbrain.js'];
const M = loadEngine({ extra: EXTRA, dom: false });
M.Items.init({ items: readFileSync(join(A, 'items.bin')).toString('base64'), itemsBytes: rdj('items.meta.json').rawBytes });
M.DATA = Object.assign({}, M.DATA, { entities: rdj('entities.json') });
M.Entities.init(); M.Entities.attrs = M.DATA.entities.attrs; M.Effects.ready = true;
const { World: W, CH, Reg: R, States: SR, Poi, Ai, VB, EntityList: EL, Profession: Prof } = M;
let fails = 0, breaks = 0;
const ok = (c, m) => { if (!c) { fails++; console.log('  FAIL ' + m); } };
const brk = (c, m) => { if (c) { breaks++; console.log('   ✓ break caught: ' + m); } else { fails++; console.log('  ✗ break NOT caught: ' + m); } };
const stream = (salt) => { let s = (salt * 2654435761 + 12345) >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; };
const salts = Array.from({ length: 20 }, (_, i) => i);
W.init(1); M.Behave.init(W);
if (M.BlockEntities && M.BlockEntities.init) M.BlockEntities.init();
EL.init(); Ai.init(); Prof.init(); if (M.Combat && M.Combat.init) M.Combat.init();
for (let cx = -3; cx <= 3; cx++) for (let cz = -3; cz <= 3; cz++) { const c = W.makeChunk(cx, cz); c.state = CH.GENERATED; W.chunks.set(W.key(cx, cz), c); }
const Y = 63;
for (let x = -24; x <= 24; x++) for (let z = -24; z <= 24; z++) { W.setBlock(x, Y, z, SR.stateOf('stone')); for (let y = 1; y < 4; y++) W.setBlock(x, Y + y, z, 0); }
function lane(salt) {
  const r = stream(salt);
  const v = EL.spawn('villager', 0.5, Y + 1, 0.5); v.ai = new Ai.GoalSelector();
  const ang = r() * Math.PI * 2, near = 3, far = 8 + Math.floor(r() * 3);
  const P = { x: 0, y: Y + 1, z: 0, screen: false };
  const bad = [];
  for (let t = 0; t < 320; t++) {
    M.Sky = { dayTime: 1000 + t };
    const d = t >= 120 && t < 200 ? far : near;
    P.x = v.x + Math.cos(ang) * d; P.z = v.z + Math.sin(ang) * d; P.y = v.y;
    if (t === 40) { v.customer = P; P.screen = true; }       // MerchantEntity.setCustomer + screen open
    if (t === 260) { v.customer = null; P.screen = false; }   // screen handler close -> setCustomer(null)
    VB.tick(v);
    const refRun = !!v.customer && P.screen && !v.inWater && (P.x - v.x) ** 2 + (P.y - v.y) ** 2 + (P.z - v.z) ** 2 <= 16;
    const w = v.vbWalkTarget, l = v.vbLookTarget;
    if (refRun) {
      if (w ? (w.range !== 2 || w.x !== Math.floor(P.x) || w.z !== Math.floor(P.z)) : false) bad.push('t' + t + ' walk ' + JSON.stringify(w));
      if (!l || l.x !== P.x || l.z !== P.z) bad.push('t' + t + ' look ' + JSON.stringify(l));
    } else if (v.vbFollowingCustomer || (t >= 120 && t < 200 && l && l.x === P.x && l.z === P.z)) bad.push('t' + t + ' still following');
    if (!!v.customer !== (t >= 40 && t < 260)) bad.push('t' + t + ' customer');
    if (bad.length) return 'salt ' + salt + ' ' + bad[0];
  }
  v.removed = true; v.dead = true;
  return null;
}
const pass = () => salts.map(lane).filter(Boolean);
const base = pass();
ok(base.length === 0, 'lane: ' + base.slice(0, 2).join(' | '));
const T0 = VB.tick;
VB.tick = (e) => { const c = e.customer; T0(e); if (c && e.vbFollowingCustomer === false) return; if (c) { e.vbFollowingCustomer = true; e.vbWalkTarget = e.vbWalkTarget || { x: 0, z: 0, range: 2 }; } };
brk(pass().length > 0, 'no clear when customer out of range caught'); VB.tick = T0;
VB.tick = (e) => { T0(e); if (e.customer && e.vbLookTarget) e.vbLookTarget = null; };
brk(pass().length > 0, 'dropped look target caught'); VB.tick = T0;
VB.tick = (e) => { const c = e.customer, ox = c && c.x, oz = c && c.z; if (c) { c.x = e.x + (c.x - e.x) * 0.5; c.z = e.z + (c.z - e.z) * 0.5; } T0(e); if (c) { c.x = ox; c.z = oz; } };
brk(pass().length > 0, 'customer pulled in (radius 4 -> 8) caught'); VB.tick = T0;
brk(pass().length === 0, 'unfaulted lane passes after restore');
console.log(`villagerlookcustomerlockstepcheck: ${2 + breaks} assertions, ${fails} failures, ${breaks} breaks caught`);
process.exit(fails ? 1 : 0);
