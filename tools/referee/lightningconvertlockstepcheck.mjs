// lightningconvertlockstepcheck.mjs -- #8193 (G17-L229): lockstep scenario 'lightningconvert': 20 salts x difficulty x pig|creeper|mooshroom|armoured zombie struck by lightning. Reference = .decomp PigEntity (non-Peaceful: fresh zombified_piglin, angles/NoAI/name/persistent carried, golden sword, pig discarded, no damage/fire), CreeperEntity (charged + Entity default: 5 damage, fire 160), MooshroomEntity (type flips, no damage/fire), Entity.onStruckByLightning (zombie: 5 damage, 160 fire ticks, equipment kept).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, initRegistry, MCLITE_ROOT } from '../loadsrc.mjs';
const ASSETS = join(MCLITE_ROOT, 'assets');
const M = loadEngine({
  extra: ['02f_tags.js', '02g_items.js', '07d_mining.js', '07e_loot.js', '07b_behaviour.js', '07h_entities.js', '14b_physics.js', '07i_entitylist.js', '07k_goals.js', '07y_equip.js', '07m_breed.js', '07zn_mooshroom.js', '07l_spawn.js', '09b_sky.js', '14j_combat.js', '07s_raid.js', '07zzc_lightning.js'],
  dom: false
});
initRegistry(M);
M.Items.init({ items: readFileSync(join(ASSETS, 'items.bin')).toString('base64'), itemsBytes: JSON.parse(readFileSync(join(ASSETS, 'items.meta.json'), 'utf8')).rawBytes });
M.DATA = Object.assign({}, M.DATA, { entities: JSON.parse(readFileSync(join(ASSETS, 'entities.json'), 'utf8')) });
M.Entities.init(); M.EntityList.init(); M.Ai.init(); M.Equip.init();
const EL = M.EntityList, Lgt = M.Lightning;
const CELLS = new Map();
M.World = { getBlock: (x, y, z) => CELLS.get(x + ',' + y + ',' + z) || 0, setBlock: (x, y, z, s) => { CELLS.set(x + ',' + y + ',' + z, s); return true; }, get: () => null, heightAt: () => 63, biomeAt: () => 1, chunks: new Map(), tickingAt: () => true };
M.CH = { GENERATED: 2 };
M.Behave.init(M.World);
M.Commands = { rules: {}, ruleGet(n) { return (n in this.rules) ? this.rules[n] : 'true'; } };
M.Diff = { value: 'normal', get() { return this.value; } };
M.Sky = { weather: { raining: true, thundering: true, rainLevel: 1, thunderLevel: 1 }, newWeather() { return this.weather; }, isThundering() { return true; }, isRainingAt() { return true; } };
let fails = 0, breaks = 0, cells = 0, conv = 0;
const ok = (c, m) => { if (!c) { fails++; console.log('  FAIL ' + m); } };
const brk = (c, m) => { if (c) { breaks++; console.log('   ✓ break caught: ' + m); } else { fails++; console.log('  ✗ break NOT caught: ' + m); } };
const stream = (salt) => { let s = (salt * 2654435761 + 12345) >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; };
const bolt = EL.spawn('lightning_bolt', 0, 64, 0, {});
const DIFFS = ['peaceful', 'easy', 'normal', 'hard'];
function lane(salt) {
  const r = stream(salt), out = [];
  for (const diff of DIFFS) for (const kind of ['pig', 'creeper', 'mooshroom', 'zombie']) {
    M.Diff.value = diff;
    const x = 100 + salt * 8 + ['pig', 'creeper', 'mooshroom', 'zombie'].indexOf(kind) * 2, z = 100 + DIFFS.indexOf(diff) * 8;
    const e = EL.spawn(kind, x, 64, z, {});
    e.yaw = r() * 360; e.pitch = r() * 30;
    const named = r() < 0.5, noai = r() < 0.5, name = 'p' + salt;
    if (named) { e.customName = name; e.customNameVisible = r() < 0.5; }
    if (noai) e.aiDisabled = true;
    const hp = e.health, vis = e.customNameVisible, yaw = e.yaw, pitch = e.pitch, mt = e.mooshroomType;
    const eq = e.equipment ? JSON.stringify(e.equipment) : '';
    Lgt.onStruckByLightning(e, bolt);
    cells++;
    const tag = 'salt ' + salt + ' ' + diff + ' ' + kind + ': ';
    if (kind === 'pig' && diff !== 'peaceful') {
      conv++;
      const ps = EL.list.filter((q) => q.type === 'zombified_piglin' && !q.removed && q.x === x && q.z === z);
      if (!e.removed) out.push(tag + 'pig not discarded');
      if (ps.length !== 1) { out.push(tag + ps.length + ' piglins'); continue; }
      const w = ps[0];
      if (w.yaw !== yaw || w.pitch !== pitch) out.push(tag + 'angles not carried');
      if (!w.persistent) out.push(tag + 'not persistent');
      if (!!w.aiDisabled !== noai) out.push(tag + 'NoAI not carried');
      if (named && (w.customName !== name || w.customNameVisible !== vis)) out.push(tag + 'name not carried');
      if (!named && w.customName !== undefined) out.push(tag + 'phantom name');
      if (w.remainingFireTicks > 0) out.push(tag + 'fire on conversion');
      ps[0].removed = true;
      continue;
    }
    if (kind === 'mooshroom') {
      if (e.mooshroomType === mt) out.push(tag + 'type not flipped');
      if (e.health !== hp || e.remainingFireTicks > 0) out.push(tag + 'mooshroom damaged/burning');
    } else {
      if (e.removed) out.push(tag + 'discarded');
      if (e.health !== hp - 5) out.push(tag + 'health ' + e.health + ' want ' + (hp - 5));
      if (e.remainingFireTicks !== 160) out.push(tag + 'fire ' + e.remainingFireTicks + ' want 160');
      if (kind === 'creeper' && e.charged !== true) out.push(tag + 'not charged');
      if (kind === 'zombie' && eq && JSON.stringify(e.equipment) !== eq) out.push(tag + 'equipment changed');
    }
    e.removed = true;
  }
  return out;
}
const pass = () => Array.from({ length: 20 }, (_, i) => i).flatMap(lane);
const base = pass();
ok(base.length === 0, 'lane: ' + base.slice(0, 3).join(' | '));
ok(cells === 320 && conv === 60, 'lane covers ' + cells + ' cells, ' + conv + ' conversions');
const oS = Lgt.onStruckByLightning;
Lgt.onStruckByLightning = (e, b) => { if (e.type === 'pig' && M.Diff.value === 'peaceful') { Lgt.convertPig(e); return; } oS(e, b); };
brk(pass().length > 0, 'conversion on Peaceful-gated roll caught');
Lgt.onStruckByLightning = (e, b) => { oS(e, b); if (e.type === 'creeper') e.charged = false; };
brk(pass().length > 0, 'charged flag not set caught');
Lgt.onStruckByLightning = (e, b) => { if (e.type === 'pig' && M.Diff.value !== 'peaceful') return; oS(e, b); };
brk(pass().length > 0, 'conversion skipped caught');
Lgt.onStruckByLightning = oS;
brk(pass().length === 0, 'unfaulted lane passes after restore');
console.log(`lightningconvertlockstepcheck: ${4 + breaks} assertions, ${fails} failures, ${breaks} breaks caught`);
process.exit(fails ? 1 : 0);
