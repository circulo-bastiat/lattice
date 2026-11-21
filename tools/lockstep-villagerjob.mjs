// lockstep-villagerjob.mjs -- #7916 (G18f-L9): lockstep scenario 'villagerjob', 20 salts x 6 villagers (unemployed, nitwit, xp>0 mason, level-2 mason, xp>0 and level-2 job holders) x lectern / composter / blast furnace placed at 2, 20 or 48 blocks and broken again, 6000 ticks. Per tick: the POI ticket count of the job site, JOB_SITE (e.workstation), Prof.claimed owner, profession and level against an independent reference of FindPointOfInterestTask + GoToWorkTask (an unemployed adult takes the profession of a job site within 48 blocks, never from beyond), the nitwit exclusion (NITWIT never matches a job site), the xp/level lock (a villager with trade xp > 0 or level > 1 keeps its profession and never trades it for the site) and LoseJobOnSiteLossTask (a broken site frees the ticket and the claim; profession back to none only for none/nitwit-excluded, level <= 1, xp 0).
// Reference = .decomp FindPointOfInterestTask / TakeJobSiteTask / LoseJobOnSiteLossTask / VillagerTaskListProvider / VillagerProfession (written independently below). OWED: the acquisition TIME (path + retry markers) is not compared, only that it happens (site within 20 blocks, 6000 ticks) and never otherwise.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';
const A = join(MCLITE_ROOT, 'assets');
const rdj = (f) => JSON.parse(readFileSync(join(A, f), 'utf8'));
const EXTRA = ['02f_tags.js', '02g_items.js', '07_world.js', '07b_behaviour.js', '07c_blockentity.js', '07d_mining.js', '07e_loot.js', '07h_entities.js', '07y_equip.js', '14b_physics.js', '14c_raycast.js', '07i_entitylist.js', '07l_spawn.js', '14d_survival.js', '14f_inventory.js', '14j_combat.js', '14l_use.js', '07za_explosion.js', '07m_breed.js', '07q_effects.js', '07zu_poi.js', '07o_profession.js', '07k_goals.js', '07zv_villagerbrain.js', '07zv3_vbpanic.js'];
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
const Y = 63, TICKS = 6000, CLAIM = 48;
for (let x = -60; x <= 60; x++) for (let z = -20; z <= 20; z++) W.setBlock(x, Y, z, SR.stateOf('stone'));
// independent reference tables: PoiType -> VillagerProfession (VillagerProfession.java constants)
const REF = { lectern: 'librarian', composter: 'farmer', blast_furnace: 'armorer' };
const BLOCKS = Object.keys(REF), DISTS = [2, 20, 48];
const KINDS = ['unemployed', 'nitwit', 'xp', 'level2', 'xpholder', 'level2holder'];
function lane(salt, kind) {
  const r = stream(salt * 7 + KINDS.indexOf(kind));
  Math.random = stream(salt + 1000); VB.rand = stream(salt + 3000); W.seed64 = BigInt(salt + 1) * 7919n; EL.random = stream(salt + 2000);
  EL.clear(); EL.nextId = 1; EL.spawnCounter = 0; EL.ticks = 0; Prof.claimed = {};
  const blk = BLOCKS[salt % 3], dist = DISTS[Math.floor(salt / 3) % 3];
  for (let x = -60; x <= 60; x++) for (let z = -20; z <= 20; z++) for (let y = 1; y <= 3; y++) W.setBlock(x, Y + y, z, 0);
  const sx = dist, sy = Y + 1, sz = 0, key = sx + ',' + sy + ',' + sz, st = SR.stateOf(blk);
  const holder = kind.endsWith('holder');
  const placeAt = holder ? 0 : Math.floor(r() * 1500), breakAt = 3000 + Math.floor(r() * 2000);
  Poi.init(); Poi.rescanNow();
  const v = EL.spawn('villager', 0.5, Y + 1, 0.5); v.ai = new Ai.GoalSelector();
  const prof0 = kind === 'nitwit' ? 'nitwit' : kind === 'unemployed' ? 'none' : holder ? REF[blk] : 'mason';
  v.profession = prof0; v.villagerLevel = kind.startsWith('level2') ? 2 : 1; v.tradeXp = kind.startsWith('xp') ? 5 : 0; v.isBaby = false;
  const locked = v.tradeXp > 0 || v.villagerLevel > 1;
  const ticket = () => { const e = Poi.get({ x: sx, y: sy, z: sz }); return e ? e.ticket : 0; };
  let placed = false, broken = false, acquired = false;
  for (let t = 0; t < TICKS; t++) {
    M.Sky = { dayTime: 10 + t };
    if (!placed && t === placeAt) {
      W.setBlock(sx, sy, sz, st); placed = true;
      if (holder) { Poi.reserveTicket({ x: sx, y: sy, z: sz }); Prof.claimed[key] = v.id; v.workstation = { x: sx, y: sy, z: sz }; acquired = true; }
    }
    if (placed && !broken && t === breakAt) { W.setBlock(sx, sy, sz, 0); Prof.releaseAt(sx, sy, sz); broken = true; }
    EL.tickOne(v);
    const siteStands = placed && !broken, tag = 'salt ' + salt + ' ' + kind + ' ' + blk + '@' + dist + ' tick ' + t + ' ';
    const w = v.workstation, owner = Prof.claimed[key], tk = ticket();
    if (!acquired && v.profession !== prof0 && kind === 'unemployed') { // the one legal change: none -> the site's profession
      if (!siteStands) return tag + 'took a job with no site standing: ' + v.profession;
      if (dist > CLAIM) return tag + 'took a job from beyond 48';
      if (v.profession !== REF[blk]) return tag + 'wrong profession ' + v.profession;
      acquired = true;
    }
    if (acquired && !broken && kind === 'unemployed' && v.profession !== REF[blk]) return tag + 'lost profession with site standing';
    if (kind !== 'unemployed' && !broken && v.profession !== prof0) return tag + 'profession changed ' + prof0 + ' -> ' + v.profession + (locked ? ' (locked)' : '');
    if (kind === 'nitwit' && (w || owner !== undefined || tk > 1)) return tag + 'nitwit holds the site';
    if (kind === 'nitwit' && (v.profession !== 'nitwit' || tk !== 0 && !v.vbPotentialJob)) return tag + 'nitwit ticket';
    // JOB_SITE memory / claim owner / ticket
    if (acquired && !broken) {
      if (!w || w.x !== sx || w.y !== sy || w.z !== sz) return tag + 'JOB_SITE memory missing';
      if (owner !== v.id) return tag + 'claim owner ' + owner;
      if (tk !== 1) return tag + 'ticket ' + tk + ' want 1';
    } else if (!acquired) {
      if (w) return tag + 'JOB_SITE before acquisition';
      if (tk > 1) return tag + 'ticket ' + tk;
    }
    if (broken) {
      if (w || owner !== undefined) return tag + 'JOB_SITE/claim survived the break';
      if (tk !== 0) return tag + 'ticket after break ' + tk;
      // LoseJobOnSiteLossTask: only none-excluded, level <= 1, xp 0 villagers fall back to none
      if (acquired && kind !== 'nitwit') {
        const want = locked ? prof0 : 'none';
        if (v.profession !== want) return tag + 'after break profession ' + v.profession + ' want ' + want;
      }
    }
  }
  if (kind === 'unemployed' && dist <= 20 && !acquired) return 'salt ' + salt + ' unemployed never took the ' + blk + ' at ' + dist;
  if (kind === 'unemployed' && dist > CLAIM && acquired) return 'taken beyond range';
  return null;
}
const pass = () => salts.flatMap((s) => KINDS.map((k) => lane(s, k))).filter(Boolean);
const base = pass();
ok(base.length === 0, 'lane: ' + base.slice(0, 3).join(' | '));
// the lanes must actually acquire jobs, and both ends of the lock must be exercised
{
  let got = 0; for (const s of [0, 1, 2, 3, 4, 5]) { if (lane(s, 'unemployed') === null) got++; }
  ok(got === 6, 'unemployed lanes run');
}
const ja = VB.jobAcquireTick;
VB.jobAcquireTick = function (e, a, n) { const locked = (e.tradeXp | 0) > 0 || (e.villagerLevel | 0) > 1; const p = e.profession; if (locked && p !== 'none' && p !== 'nitwit') e.profession = 'none'; ja.call(VB, e, a, n); }; // an xp>0 / level>1 villager may switch job
brk(pass().length > 0, 'xp>0 villager allowed to switch job caught'); VB.jobAcquireTick = ja;
Prof.skip.guard = true; brk(pass().length > 0, 'LoseJobOnSiteLoss ignoring xp/level caught'); Prof.skip.guard = false;
Prof.skip.reset = true; brk(pass().length > 0, 'broken site keeping the profession caught'); Prof.skip.reset = false;
Prof.skip.holder = true; brk(pass().length > 0, 'broken site not freeing its holder caught'); Prof.skip.holder = false;
const pr = Poi.reserveTicket; Poi.reserveTicket = () => true;
brk(pass().length > 0, 'ticket reserved without a count caught'); Poi.reserveTicket = pr;
const pf = Prof.professionForBlockName; Prof.professionForBlockName = (nm) => (nm === 'lectern' ? 'cleric' : pf(nm));
brk(pass().length > 0, 'lectern giving cleric caught'); Prof.professionForBlockName = pf;
VB.CLAIM_RADIUS = 10; brk(pass().length > 0, 'claim radius 48 -> 10 caught'); VB.CLAIM_RADIUS = 48;
brk(pass().length === 0, 'unfaulted lane passes after restore');
console.log(`lockstep-villagerjob: ${2 + breaks} assertions, ${fails} failures, ${breaks} breaks caught`);
process.exit(fails ? 1 : 0);
