#!/usr/bin/env node
// lockstep-beehive -- #8715 (G18b-L42): lockstep scenario 'beehive': bee_nest / beehive with 1 and 3 occupants (one carrying nectar), clear / rain / night variants, 20 salts.
// Reference = .decomp BeehiveBlockEntity.tickBees (:~226-246: release when TicksInHive > MinOccupationTicks, read BEFORE TicksInHive++; releaseBee refuses isNight()||isRaining()
// for non-EMERGENCY states :~183), MinOccupationTicks 2400 with nectar / 600 without (addBee :~176), and releaseBee's honey_level +1 for a nectar bee (nextInt(100)==0 -> +2, minus 1 past 5;
// onHoneyDelivered clears HasNectar), written out independently over java.util.Random (M.JRandom). The engine side is Bee.enterHive + Bee.tickHive.
// Per tick: occupants, each occupant's TicksInHive, honey_level; per bee: exit tick and hasNectar after exit. The 12-block flight in is beepollen's lane, not here.
import { loadEngine } from './loadsrc.mjs';
const M = loadEngine({ extra: ['02f_tags.js', '07_world.js', '07h_entities.js', '07i_entitylist.js', '07zo_bee.js'], dom: false, initReg: true });
const Bee = M.Bee;
let fails = 0, breaks = 0, n = 0;
const ok = (c, m) => { n++; if (!c) { fails++; console.log('  FAIL ' + m); } };
const salts = Array.from({ length: 20 }, (_, i) => i), TICKS = 3600;
const VARIANTS = [
  { id: 'bee_nest-1-day', block: 'bee_nest', bees: 1, wx: null },
  { id: 'beehive-3-day', block: 'beehive', bees: 3, wx: null },
  { id: 'bee_nest-3-rain', block: 'bee_nest', bees: 3, wx: 'rain' },
  { id: 'beehive-1-night', block: 'beehive', bees: 1, wx: 'night' },
];
// weather window [a, b) per salt: no release while it holds (isRaining / isNight)
const win = (v, s) => v.wx ? [500 + s * 20, 2700 + s * 25] : [0, 0];
const blocked = (v, s, t) => { const w = win(v, s); return t >= w[0] && t < w[1]; };
const setup = (v, s) => Array.from({ length: v.bees }, (_, i) => ({ nectar: i === 0, enter: i * (7 + s % 5) + (s % 3), min: i === 0 ? 2400 : 600 }));

function reference(v, s) {
  const r = new M.JRandom(9100 + s), tr = [], bees = setup(v, s).map((b) => ({ ...b, in: -1, gone: -1 }));
  let honey = s % 5, exits = bees.map(() => -1), nectarAfter = bees.map(() => null);
  for (let t = 0; t < TICKS; t++) {
    for (let i = 0; i < bees.length; i++) { const b = bees[i]; if (b.in < 0 && b.gone < 0 && t === b.enter) b.in = 0; }
    for (let i = 0; i < bees.length; i++) {
      const b = bees[i]; if (b.in < 0) continue;
      if (b.in > b.min && !blocked(v, s, t)) {
        if (b.nectar) { if (honey < 5) { let d = r.nextInt(100) === 0 ? 2 : 1; if (honey + d > 5) d--; honey += d; } }
        exits[i] = t; nectarAfter[i] = false; b.gone = t; b.in = -1; continue;
      }
      b.in++;
    }
    tr.push(bees.filter((b) => b.in >= 0).length + ':' + bees.map((b) => b.in).join('/') + ':' + honey);
  }
  return { tr, exits, nectarAfter };
}

function engine(v, s) {
  const r = new M.JRandom(9100 + s), tr = [], plan = setup(v, s), hive = { x: 12, y: 64, z: 0, type: v.block, bees: [] };
  let honey = s % 5, exits = plan.map(() => -1), nectarAfter = plan.map(() => null);
  for (let t = 0; t < TICKS; t++) {
    plan.forEach((b, i) => { if (t === b.enter) { const e = { x: 12, y: 64, z: 0, hasNectar: b.nectar, id: i }; e.tag = i; Bee.enterHive(e, hive); hive.bees[hive.bees.length - 1].tag = i; } });
    const bl = blocked(v, s, t);
    Bee.tickHive(hive, {
      isNight: () => bl && v.wx === 'night', isRaining: () => bl && v.wx === 'rain',
      deliverHoney: () => { if (honey < 5) { let d = r.nextInt(100) === 0 ? 2 : 1; if (honey + d > 5) d--; honey += d; } },
      spawnBee: (x, y, z, occ) => { exits[occ.tag] = t; nectarAfter[occ.tag] = !!occ.EntityData.HasNectar; },
    });
    const byTag = plan.map((_, i) => hive.bees.find((o) => o.tag === i));
    tr.push(hive.bees.length + ':' + byTag.map((o) => (o ? o.TicksInHive : -1)).join('/') + ':' + honey);
  }
  return { tr, exits, nectarAfter };
}
const same = (a, b) => a.tr.every((x, i) => x === b.tr[i]) && JSON.stringify(a.exits) === JSON.stringify(b.exits) && JSON.stringify(a.nectarAfter) === JSON.stringify(b.nectarAfter);
const dirty = () => VARIANTS.some((v) => salts.some((s) => !same(reference(v, s), engine(v, s))));
for (const v of VARIANTS) {
  const bad = salts.filter((s) => !same(reference(v, s), engine(v, s)));
  ok(!bad.length, `${v.id}: divergence on salts ${bad.slice(0, 5)}`);
  const ref = salts.map((s) => reference(v, s));
  ok(ref.every((x) => x.exits.every((e) => e > 0)), `${v.id}: every bee leaves (not vacuous)`);
  ok(ref.every((x) => x.nectarAfter.every((q) => q === false)), `${v.id}: hasNectar false after exit`);
  if (v.wx) ok(ref.every((x, s) => x.exits.every((e) => e < win(v, s)[0] || e >= win(v, s)[1])), `${v.id}: nobody leaves inside the ${v.wx} window`);
  if (!v.wx && v.bees === 3) ok(ref.every((x) => x.exits[1] < x.exits[0] && x.exits[0] > 2400), `${v.id}: plain bees leave ~600, nectar bee ~2400`);
  ok(ref.every((x) => x.tr[TICKS - 1].split(':')[2] >= 1), `${v.id}: honey_level rose`);
}
const brk = (c, m) => { if (c) { breaks++; console.log('   ✓ break caught: ' + m); } else { fails++; console.log('  ✗ break NOT caught: ' + m); } };
{ const o = Bee.MIN_OCCUPATION_TICKS_NECTAR; Bee.MIN_OCCUPATION_TICKS_NECTAR = 600; brk(dirty(), 'nectar stay 2400 -> 600 caught'); Bee.MIN_OCCUPATION_TICKS_NECTAR = o; }
{ const o = Bee.MIN_OCCUPATION_TICKS_PLAIN; Bee.MIN_OCCUPATION_TICKS_PLAIN = 2400; brk(dirty(), 'plain stay 600 -> 2400 caught'); Bee.MIN_OCCUPATION_TICKS_PLAIN = o; }
{ const o = Bee.tickHive; Bee.tickHive = (h, c) => o(h, { ...c, isRaining: () => false, isNight: () => false }); brk(dirty(), 'rain/night gate removed caught'); Bee.tickHive = o; }
console.log(`lockstep-beehive: ${n + breaks} assertions, ${fails} failures, ${breaks} breaks caught (${VARIANTS.length} variants x ${salts.length} salts x ${TICKS} ticks)`);
process.exit(fails ? 1 : 0);
