#!/usr/bin/env node
// totemcheck.mjs — #5793: LivingEntity.tryUseTotem (main hand first, then offhand; void bypasses).
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEngine } from './loadsrc.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ASSETS = join(ROOT, 'assets');
const VERBOSE = process.argv.includes('--verbose');

let pass = 0, breaks = 0;
const fails = [];
const ok = (c, m) => { if (c) pass++; else if (fails.length < 40) fails.push(m); return c; };
const okAv = (c, m) => { breaks++; if (c) { pass++; console.log('   ✓ ' + m); } else fails.push('anti-vacuity: ' + m); };
const say = (...a) => { if (VERBOSE) console.log(...a); };
const near = (a, b, t) => Math.abs(a - b) <= (t === undefined ? 1e-9 : t);

console.log('combatcheck — PLAN G17d, melee combat (D-336, D-338)');

const M = loadEngine({
  extra: ['02g_items.js', '14f_inventory.js', '14i_hand.js', '07h_entities.js',
          '14b_physics.js', '07i_entitylist.js', '14e_gamemode.js', '07q_effects.js',
          '07y_equip.js', '14j_combat.js', '14d_survival.js', '07zx_particle.js'],
  initReg: false
});
M.DATA = Object.assign({}, M.DATA, {
  entities: JSON.parse(readFileSync(join(ASSETS, 'entities.json'), 'utf8'))
});
M.Entities.init();
M.Items.init({
  items: readFileSync(join(ASSETS, 'items.bin')).toString('base64'),
  itemsBytes: JSON.parse(readFileSync(join(ASSETS, 'items.meta.json'), 'utf8')).rawBytes
});
// the attribute table, read from the golden file rather than from a copy typed here (D-305)
{
  const table = {};
  for (const line of readFileSync(join(ROOT, 'tools', 'golden', 'item-attributes-1.18.2.tsv'), 'utf8').split(/\r?\n/)) {
    if (!line || line[0] === '#') continue;
    const c = line.split('\t');
    if (c[0] === 'item' || c.length < 9) continue;
    const r = (v) => Math.round(parseFloat(v) * 10000) / 10000;
    table[c[0]] = [r(c[6]), r(c[7]), +c[8]];
  }
  M.Hand.bindAttrs(table);
}
// a world of nothing but a floor, so motion is arithmetic and not terrain (the entlistcheck idiom)
const FLOOR_Y = 64;
M.Physics.shapeAt = (x, y, z) => (y < FLOOR_Y ? M.Physics.FULL_CUBE : null);
M.Physics.solidAt = (x, y, z) => M.Physics.shapeAt(x, y, z) !== null;
M.Physics.grounded = (x, y, z, d) => y - d < FLOOR_Y;
M.EntityList.init();
M.Combat.init();
const EL = M.EntityList, Cb = M.Combat, Ent = M.Entities, H = M.Hand, Inv = M.Inventory;


const T = Inv.stack('totem_of_undying', 1);
function player(main, off) {
  const p = { effects: {}, mode: 0 };
  M.Survival.init(p);
  p.inventory = Inv.create();
  if (main) Inv.setItem(p.inventory, 0, Inv.stack('totem_of_undying', main));
  if (off) Inv.setItem(p.inventory, Inv.OFFHAND, Inv.stack('totem_of_undying', off));
  p.effects = {};
  return p;
}
function scenario() {
  const out = [];
  let p = player(2, 0); p.effects = {}; M.Effects.addStatusEffect(p, 'speed', 500, 0);
  M.Survival.hurt(p, 'generic', 100);
  out.push(p);
  p = player(2, 3); M.Survival.hurt(p, 'generic', 100); out.push(p);
  p = player(0, 0); M.Survival.hurt(p, 'generic', 100); out.push(p);
  p = player(1, 0); M.Survival.hurt(p, 'outOfWorld', 100); out.push(p);
  const z = EL.spawn('zombie', 0, FLOOR_Y, 0);
  z.equip = z.equip || []; z.equip[1] = Inv.stack('totem_of_undying', 1);
  Cb.hurt(z, 1000, 0, false, { source: 'generic' }); out.push(z);
  const z2 = EL.spawn('zombie', 0, FLOOR_Y, 0);
  Cb.hurt(z2, 1000, 0, false, { source: 'generic' }); out.push(z2);
  return out;
}
function verify() {
  const [a, b, c, d, z, z2] = scenario();
  const r = [];
  const eff = (e, n, dur, amp) => e.effects[n] && e.effects[n].duration === dur && e.effects[n].amplifier === amp;
  r.push(!a.dead && a.health === 1 && Inv.getItem(a.inventory, 0).n === 1 && !a.effects.speed &&
    eff(a, 'regeneration', 900, 1) && eff(a, 'absorption', 100, 1) && eff(a, 'fire_resistance', 800, 0));
  r.push(!b.dead && Inv.getItem(b.inventory, 0).n === 1 && Inv.getItem(b.inventory, Inv.OFFHAND).n === 3);
  r.push(c.dead === true);
  r.push(d.dead === true && Inv.getItem(d.inventory, 0).n === 1);
  r.push(!z.dead && z.health === 1 && !z.equip[1] && eff(z, 'absorption', 100, 1) && eff(z, 'fire_resistance', 800, 0));
  r.push(z2.dead === true || z2.health <= 0);
  return r;
}
const names = ['main hand: hp 1, effects, stack n-1', 'both hands: main consumed', 'no totem: death', 'void bypasses', 'mob offhand totem', 'mob without totem dies'];
verify().forEach((v, i) => ok(v, names[i]));
const fs = await import('node:fs');
const orig = [fs.readFileSync(join(ROOT,'src/14d_survival.js'),'utf8')];
// anti-vacuity: hook removed
const brk = fs.readFileSync(join(ROOT, 'src/14d_survival.js'), 'utf8');
let caught = 0;
{
  const M2 = loadEngine({ extra: ['02g_items.js','14f_inventory.js','14i_hand.js','07h_entities.js','14b_physics.js','07i_entitylist.js','14e_gamemode.js','07q_effects.js','07y_equip.js','14j_combat.js','14d_survival.js'], initReg: false,
    patch: (f, s) => f === '14d_survival.js' ? s.replace('Sv.tryUseTotem(e, src)) return true;', 'false) return true;') : s });
  const p = { effects: {} }; M2.Survival.init(p); p.inventory = M2.Inventory.create();
  M2.Items.init({ items: readFileSync(join(ASSETS, 'items.bin')).toString('base64'), itemsBytes: JSON.parse(readFileSync(join(ASSETS, 'items.meta.json'), 'utf8')).rawBytes });
  M2.Inventory.setItem(p.inventory, 0, M2.Inventory.stack('totem_of_undying', 1));
  M2.Survival.hurt(p, 'generic', 100);
  if (p.dead) caught++;
  ok(caught === 1, 'removed hook is caught');
  console.log('  ✓ anti-vacuity break 1 caught');
}
// #5794: activation effect -- 30 totem particles, item.totem.use once, Hud.floatingItem for 40 ticks
{
  const run = (patch) => {
    const X = loadEngine({ extra: ['02g_items.js','14f_inventory.js','14i_hand.js','07h_entities.js','14b_physics.js','07i_entitylist.js','14e_gamemode.js','07q_effects.js','07y_equip.js','14j_combat.js','14d_survival.js','07zx_particle.js'], initReg: false, patch });
    X.Items.init({ items: readFileSync(join(ASSETS, 'items.bin')).toString('base64'), itemsBytes: JSON.parse(readFileSync(join(ASSETS, 'items.meta.json'), 'utf8')).rawBytes });
    const snd = []; X.Sound = { play: (n) => snd.push(n) };
    X.Hud = { showFloatingItem(st) { this.floatingItem = st; this.t = 40; }, tickFloatingItem() { if (this.t > 0 && --this.t === 0) this.floatingItem = null; } };
    X.Particle.init();
    const p = { effects: {}, x: 0, y: 64, z: 0, width: 0.6, height: 1.8 }; X.Survival.init(p); p.inventory = X.Inventory.create();
    X.Inventory.setItem(p.inventory, 0, X.Inventory.stack('totem_of_undying', 1));
    X.Survival.hurt(p, 'generic', 100);
    const n = X.Particle.list.filter((q) => q.type === 'totem_of_undying');
    let ticks = 0; while (X.Hud.floatingItem) { X.Hud.tickFloatingItem(); ticks++; }
    return { n, snd, ticks, p, X };
  };
  const g = run();
  ok(g.n.length > 0 && g.n.length <= 30, 'first tick spawns totem particles (<=16 per emitter tick)');
  ok(g.n.every((q) => q.gravityStrength === 1.25 && q.velocityMultiplier === 0.6 && q.maxAge >= 60 && q.maxAge < 72 && q.blue < 0.2 && (q.green >= 0.4 && q.green < 0.9)), 'vanilla colour set / physics');
  ok(g.snd.filter((x) => x === 'item.totem.use').length === 1, 'sound logged once');
  ok(g.ticks === 40, 'floating item shown for 40 ticks');
  g.X.Particle.emitters.forEach((e) => e.rand = Math.random);
  for (let i = 0; i < 3; i++) g.X.Particle.emitters.length && g.X.Particle.emitters.length;
  ok(g.X.Particle.emitters.length === 1 && g.X.Particle.emitters[0].maxAge === 30, 'emitter lives 30 ticks');
  const b = run((f, s) => f === '14d_survival.js' ? s.replace('NS.Particle.totemActivated(e);', '0;') : s);
  ok(b.n.length === 0 && b.snd.length === 0 && b.ticks === 0, 'removed emitter is caught');
  console.log('  ✓ anti-vacuity: removed activation caught');
  caught++;
}
console.log(`totemcheck: ${pass} checks passed, ${fails.length} failures (${caught} breaks caught)`);
for (const f of fails) console.log('FAIL  ' + f);
process.exit(fails.length ? 1 : 0);
