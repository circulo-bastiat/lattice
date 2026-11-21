// lockstep-villagerplay.mjs -- #8723 (G18f-L17): 20 salts x 2400 ticks (day 2000..4400, crossing the Schedule.VILLAGER_BABY PLAY window start at 3000): three baby villagers and one adult in a village. Per tick: baby activity ('play' only in 3000..6000 / 10000..12000), the CHASE walk target written the tick a play target is picked (WalkTarget(EntityLookTarget, 0.6, 1): range 1, on the partner), and the PlayWithVillagerBabiesTask pick (mutual baby, else least-popular target with 0 < count <= 5, else any visible baby within 16) vs an independent reference written from .decomp PlayWithVillagerBabiesTask. Targets are cleared in rotation so picks recur. Faults: popularity sort dropped (first baby always chosen), sense range, max interaction count.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';
const A = join(MCLITE_ROOT, 'assets');
const rdj = (f) => JSON.parse(readFileSync(join(A, f), 'utf8'));
const EXTRA = ['02f_tags.js', '02g_items.js', '07_world.js', '07b_behaviour.js', '07c_blockentity.js', '07d_mining.js', '07e_loot.js', '07h_entities.js', '07y_equip.js', '14b_physics.js', '14c_raycast.js', '07i_entitylist.js', '07l_spawn.js', '14d_survival.js', '14f_inventory.js', '14j_combat.js', '14l_use.js', '07za_explosion.js', '07m_breed.js', '07q_effects.js', '07zu_poi.js', '07o_profession.js', '07k_goals.js', '07zv_villagerbrain.js', '07zv2_vbplay.js', '07zv3_vbpanic.js', '07zv4_vbidle.js'];
const M = loadEngine({ extra: EXTRA, dom: false });
M.Items.init({ items: readFileSync(join(A, 'items.bin')).toString('base64'), itemsBytes: rdj('items.meta.json').rawBytes });
M.DATA = Object.assign({}, M.DATA, { entities: rdj('entities.json') });
M.Entities.init(); M.Entities.attrs = M.DATA.entities.attrs; M.Effects.ready = true;
const { World: W, CH, States: SR, Poi, Ai, VB, EntityList: EL, Profession: Prof } = M;
let fails = 0, breaks = 0;
const ok = (c, m) => { if (!c) { fails++; console.log('  FAIL ' + m); } };
const brk = (c, m) => { if (c) { breaks++; console.log('   ✓ break caught: ' + m); } else { fails++; console.log('  ✗ break NOT caught: ' + m); } };
const stream = (salt) => { let s = (salt * 2654435761 + 12345) >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; };
const salts = Array.from({ length: 20 }, (_, i) => i);
W.init(1); M.Behave.init(W);
if (M.BlockEntities && M.BlockEntities.init) M.BlockEntities.init();
EL.init(); Ai.init(); Prof.init(); if (M.Combat && M.Combat.init) M.Combat.init();
for (let cx = -5; cx <= 5; cx++) for (let cz = -5; cz <= 5; cz++) { const c = W.makeChunk(cx, cz); c.state = CH.GENERATED; W.chunks.set(W.key(cx, cz), c); }
const Y = 63, TICKS = 2400, START = 2000, CLEAR = 120;
for (let x = -40; x <= 40; x++) for (let z = -40; z <= 40; z++) W.setBlock(x, Y, z, SR.stateOf('stone'));
// independent reference (.decomp Schedule.VILLAGER_BABY, PlayWithVillagerBabiesTask, VillagerBabiesSensor)
const refPlay = (t) => { const d = t % 24000; return (d >= 3000 && d < 6000) || (d >= 10000 && d < 12000); };
const alive = (o) => o && !o.dead && !o.removed;
function refPick(self, babies) {
  const vis = babies.filter((b) => b !== self && alive(b) && Math.hypot(b.x - self.x, b.y - self.y, b.z - self.z) <= 16);
  if (!vis.length) return undefined;
  const mutual = vis.find((b) => b.vbPlayTarget === self);
  if (mutual) return mutual;
  const order = [], cnt = new Map();
  for (const b of vis) { const t = b.vbPlayTarget; if (!alive(t) || t === self) continue; if (!cnt.has(t)) order.push(t); cnt.set(t, (cnt.get(t) || 0) + 1); }
  let best = null;
  for (const t of order) { const c = cnt.get(t); if (c > 0 && c <= 5 && (best === null || c < cnt.get(best))) best = t; }
  return best || vis[0];
}
let picks = 0, popular = 0;
function lane(salt) {
  Math.random = stream(salt + 1000); VB.rand = stream(salt + 3000); W.seed64 = BigInt(salt + 1) * 7919n; EL.random = stream(salt + 2000);
  EL.clear(); EL.nextId = 1; EL.spawnCounter = 0; EL.ticks = 0; Prof.claimed = {};
  for (let x = -40; x <= 40; x++) for (let z = -40; z <= 40; z++) for (let y = 1; y <= 3; y++) W.setBlock(x, Y + y, z, 0);
  const mk = (bx, bz, baby) => { const v = EL.spawn('villager', 0.5 + bx, Y + 1, 0.5 + bz); v.ai = new Ai.GoalSelector(); v.isBaby = baby; v.profession = 'none'; return v; };
  const adult = mk(0, 0, false);
  const kids = [mk(3 + salt % 4, 1, true), mk(-4, 2 + salt % 3, true), mk(1, -5, true)];
  const all = [adult, ...kids];
  for (let t = 0; t < TICKS; t++) {
    M.Sky = { dayTime: START + t };
    if (t % CLEAR === CLEAR - 1) kids[Math.floor(t / CLEAR) % 3].vbPlayTarget = null;
    for (const v of all) {
      const pre = alive(v.vbPlayTarget) ? v.vbPlayTarget : null;
      const exp = v.isBaby && !pre ? refPick(v, kids) : null;
      const kidsPre = kids.map((k) => k.vbPlayTarget);
      EL.tickOne(v);
      if (!v.isBaby) continue;
      const tag = 'salt ' + salt + ' tick ' + t + ' ';
      const play = v.vbActivity === 'play';
      if (play !== refPlay(START + t)) return tag + 'activity ' + v.vbActivity + ' want ' + (refPlay(START + t) ? 'play' : 'not play');
      if (!pre && alive(v.vbPlayTarget)) {
        picks++;
        if (exp === undefined || exp === null) return tag + 'picked with no visible baby';
        if (v.vbPlayTarget !== exp) return tag + 'pick ' + kids.indexOf(v.vbPlayTarget) + ' want ' + kids.indexOf(exp) + ' targets ' + kidsPre.map((k) => kids.indexOf(k)).join(',');
        if (kidsPre.some((k) => k && k !== v)) popular++;
        const w = v.vbWalkTarget, p = exp;
        if (!w && Math.hypot(p.x - v.x, p.z - v.z) <= 2) { /* WalkTarget completed on arrival */ } else if (!w || w.range !== 1 || w.x !== Math.floor(p.x) || w.z !== Math.floor(p.z)) return tag + 'chase walk target ' + JSON.stringify(w);
      }
      if (!play && v.vbPlayTarget && !pre) return tag + 'play target outside PLAY';
    }
  }
  return null;
}
const pass = () => { picks = 0; popular = 0; return salts.map(lane).filter(Boolean); };
const base = pass();
ok(base.length === 0, 'lane: ' + base.slice(0, 3).join(' | '));
ok(picks >= 40, 'picks seen ' + picks);
ok(popular >= 5, 'popularity picks seen ' + popular);
console.log('  picks', picks, 'with live targets', popular);
VB.PLAY_MAX_INTERACTION = 0; brk(pass().length > 0, 'popularity sort dropped (first baby always chosen) caught'); VB.PLAY_MAX_INTERACTION = 5;
VB.PLAY_SENSE_RANGE = 3; brk(pass().length > 0, 'sense range 16 -> 3 caught'); VB.PLAY_SENSE_RANGE = 16;
VB.PLAY_COMPLETION_RANGE = 3; brk(pass().length > 0, 'completion range 1 -> 3 caught'); VB.PLAY_COMPLETION_RANGE = 1;
brk(pass().length === 0, 'unfaulted lane passes after restore');
console.log(`lockstep-villagerplay: ${3 + breaks} assertions, ${fails} failures, ${breaks} breaks caught`);
process.exit(fails ? 1 : 0);
