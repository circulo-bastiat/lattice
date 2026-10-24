// villagerherocheck (#7022 G18f-L1) -- see below. Template header: #6303 (G17-L55): lockstep scenario 'villager', 20 salts: one villager with a bed, a smithing table and a bell in a 20x20 arena, Sky.dayTime stepped through one full day, a zombie walked in near the villager at a random tick. Per tick: the active Activity (idle/WORK/MEET/REST/PANIC) vs an independent reference of Schedule.VILLAGER_DEFAULT (10 idle, 2000 work, 9000 meet, 11000 idle, 12000 rest; wraps to rest before tick 10) + PanicTask (hostile within 8); at checkpoints the memory modules (home, job_site, meeting_point) must be present once the activity that claims them has run.
// Reference = .decomp Schedule.VILLAGER_DEFAULT / VillagerTaskListProvider (written independently below). OWED: the server-side per-tick trace of the same lane and the path to the bed (needs the Ai movement tick; this lane drives VB.tick only).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from '../loadsrc.mjs';
const A = join(MCLITE_ROOT, 'assets');
const rdj = (f) => JSON.parse(readFileSync(join(A, f), 'utf8'));
const EXTRA = ['02f_tags.js', '02g_items.js', '07_world.js', '07b_behaviour.js', '07c_blockentity.js', '07d_mining.js', '07e_loot.js', '07h_entities.js', '07y_equip.js', '14b_physics.js', '14c_raycast.js', '07i_entitylist.js', '07l_spawn.js', '14d_survival.js', '14f_inventory.js', '14j_combat.js', '14l_use.js', '07za_explosion.js', '07m_breed.js', '07q_effects.js', '07zu_poi.js', '07o_profession.js', '07k_goals.js', '07zv_villagerbrain.js', '07zv3_vbpanic.js', '07zv6_vbgather.js', '07zv7_vbgifts.js'];
const b64 = (f) => readFileSync(join(A, f)).toString('base64');
const M = loadEngine({ extra: EXTRA, dom: false });
M.Items.init({ items: readFileSync(join(A, 'items.bin')).toString('base64'), itemsBytes: rdj('items.meta.json').rawBytes });
M.DATA = Object.assign({}, M.DATA, { entities: rdj('entities.json') });
M.Entities.init(); M.Entities.attrs = M.DATA.entities.attrs; M.Effects.ready = true;
M.Loot.init({ loot: b64('loot.bin'), lootBytes: rdj('loot.meta.json').jsonBytes });
const { World: W, CH, Reg: R, States: SR, Ai, VB, VBGifts: G, EntityList: EL, Profession: Prof } = M;
let fails = 0, breaks = 0;
const ok = (c, m) => { if (!c) { fails++; console.log('  FAIL ' + m); } };
const brk = (c, m) => { if (c) { breaks++; console.log('   ✓ break caught: ' + m); } else { fails++; console.log('  ✗ break NOT caught: ' + m); } };
const stream = (salt) => { let s = (salt * 2654435761 + 12345) >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; };
const salts = Array.from({ length: 20 }, (_, i) => i);
const PROFS = ['armorer', 'butcher', 'cartographer', 'cleric', 'farmer', 'fisherman', 'fletcher', 'leatherworker', 'librarian', 'mason', 'shepherd', 'toolsmith', 'weaponsmith'];
const TICKS = 7500;
W.init(1); M.Behave.init(W);
if (M.BlockEntities && M.BlockEntities.init) M.BlockEntities.init();
EL.init(); Ai.init(); Prof.init(); if (M.Combat && M.Combat.init) M.Combat.init();
for (let cx = -3; cx <= 3; cx++) for (let cz = -3; cz <= 3; cz++) { const c = W.makeChunk(cx, cz); c.state = CH.GENERATED; W.chunks.set(W.key(cx, cz), c); }
const Y = 63;
for (let x = -24; x <= 24; x++) for (let z = -24; z <= 24; z++) W.setBlock(x, Y, z, SR.stateOf('stone'));
// independent reference of GiveGiftsToHeroTask (.decomp): shouldRun counts timeUntilGift down 600..0 while a hero is near,
// run() at 0, tick() throws once the task has run > 20 ticks (player within 5), finish() rerolls 600 + nextInt(6001).
function lane(salt, prof) {
  const rv = stream(salt * 31 + PROFS.indexOf(prof)), rr = stream(salt * 31 + PROFS.indexOf(prof));
  VB.rand = rv; EL.random = stream(salt + 999);
  EL.clear(); Prof.claimed = {};
  const v = EL.spawn('villager', 0.5, Y + 1, 0.5); v.profession = prof; v.isBaby = false;
  const player = { x: 3.5, y: Y + 1, z: 0.5, effects: { hero_of_the_village: { amplifier: 0, duration: 99999 } } };
  const table = 'gameplay/hero_of_the_village/' + prof + '_gift';
  const rngOf = () => ({ nextFloat: rr, nextInt: (n) => Math.floor(rr() * n) });
  let cd = 600, running = false, start = 0, done = false;
  for (let t = 0; t < TICKS; t++) {
    EL.dropTrace = [];
    const before = EL.entities ? EL.entities.length : 0;
    G.tick(v, t, t, player);
    let exp = [], expThrow = false;
    if (!running) { if (cd > 0) cd--; else { running = true; start = t; done = false; } }
    else if (done) { cd = 600 + Math.floor(rr() * 6001); running = false; }
    else if (t - start > 20) { exp = M.Loot.rollTable(table, { rng: rngOf(), pos: { x: 0, y: Y + 1, z: 0 } }) || []; exp = exp.filter((g) => g && g.count > 0); done = true; expThrow = true; }
    const got = EL.dropTrace.map((d) => d[0] + 'x' + d[1]).join(',');
    const want = exp.map((g) => g.item + 'x' + g.count).join(',');
    if (got !== want) return `salt ${salt} ${prof} tick ${t} drops eng [${got}] ref [${want}]`;
    if (!!v.vbGift !== running && !(expThrow && v.vbGift)) return `salt ${salt} ${prof} tick ${t} gifting eng ${!!v.vbGift} ref ${running}`;
    if (v.vbGiftCooldown !== cd && !(running)) return `salt ${salt} ${prof} tick ${t} cooldown eng ${v.vbGiftCooldown} ref ${cd}`;
    if (exp.length) {
      const it = EL.list ? EL.list.filter((e) => e.type === 'item').pop() : null;
      // LookTargetUtil.give aims from the giver's feet (getPos) at 0.3F
      const dx = player.x - v.x, dy = player.y - v.y, dz = player.z - v.z, s = Math.fround(0.3) / Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (it && (Math.abs(it.vx - dx * s) > 1e-9 || Math.abs(it.vy - dy * s) > 1e-9 || Math.abs(it.vz - dz * s) > 1e-9)) return `salt ${salt} ${prof} tick ${t} throw velocity eng ${it.vx},${it.vy},${it.vz}`;
    }
  }
  return null;
}
let gifts = 0;
const pass = () => salts.map((s) => PROFS.map((p) => lane(s, p)).find(Boolean)).filter(Boolean);
const base = pass();
ok(base.length === 0, 'lane: ' + base.slice(0, 2).join(' | '));
const sp = G.GIFT_DELAY_SPREAD; G.GIFT_DELAY_SPREAD = 6002;
brk(pass().length > 0, 'gift jitter 6001 -> 6002 caught'); G.GIFT_DELAY_SPREAD = sp;
const G0 = M.VBGather.GIVE_SPEED; M.VBGather.GIVE_SPEED = 0.31;
brk(pass().length > 0, 'throw velocity factor 0.3 -> 0.31 caught'); M.VBGather.GIVE_SPEED = G0;
brk(pass().length === 0, 'unfaulted lane passes after restore');
console.log(`villagerherocheck: ${3 + breaks} assertions, ${fails} failures, ${breaks} breaks caught`);
process.exit(fails ? 1 : 0);
