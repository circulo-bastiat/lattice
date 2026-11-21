#!/usr/bin/env node
// lockstep-pandabehaviour -- #6887 (G17-L170): lockstep scenario pandabehaviour, 20 salts x 2400 ticks.
// Reference = PandaEntity.Gene.createRandom (nextInt(16) chain), Gene.getProductGene (recessive main needs matching hidden),
// initGenes (parent coin flips + two 1/32 mutations), SneezeGoal.canStart (baby+idle, weak 1/500 else 1/6000), 20-tick sneeze,
// sneeze() slime_ball 1/700 -- replayed draw-for-draw on one java.util.Random stream against Pd.* (gene pair, flags, timers, drops).
import { loadEngine } from './loadsrc.mjs';
const M = loadEngine({ extra: ['02f_tags.js', '02g_items.js', '07_world.js', '07b_behaviour.js', '07d_mining.js', '07e_loot.js', '07h_entities.js',
  '07y_equip.js', '14b_physics.js', '14c_raycast.js', '07i_entitylist.js', '07k_goals.js', '07l_spawn.js', '14d_survival.js', '14f_inventory.js',
  '14j_combat.js', '14l_use.js', '07za_explosion.js', '07m_breed.js', '07zh_rabbit.js', '07zj_fox.js', '07zj_goat.js', '07zl_panda.js'], dom: false });
const Pd = M.Panda || M.Pd || Object.values(M).find((v) => v && v.SneezeGoal);
const TICKS = 2400;
const stream = (salt) => { const j = new M.JRandom(salt * 6151 + 29), r = () => j.nextDouble(); r.nextDouble = r; return r; };
const GENES = ['lazy', 'worried', 'playful', 'aggressive', 'weak', 'brown', 'normal'];
const rgene = (r) => { const n = Math.floor(r() * 16); return n === 0 ? 'lazy' : n === 1 ? 'worried' : n === 2 ? 'playful' : n === 4 ? 'aggressive' : n < 9 ? 'weak' : n < 11 ? 'brown' : 'normal'; };
const prod = (m, h) => (m === 'brown' || m === 'weak') ? (m === h ? m : 'normal') : m;
const nameOf = (id) => Pd.geneName(id);

function engine(salt) {
  const r = stream(salt), log = [];
  const a = { mainGene: Pd.randomGene(r), hiddenGene: Pd.randomGene(r) }, b = { mainGene: Pd.randomGene(r), hiddenGene: Pd.randomGene(r) };
  const baby = { isBaby: true }; Pd.initGenes(baby, a, b, r);
  log.push([a, b, baby].map((e) => [nameOf(e.mainGene), nameOf(e.hiddenGene), nameOf(Pd.productGene(e.mainGene, e.hiddenGene))]));
  const g = new Pd.SneezeGoal(baby, { random: r }); let drops = 0;
  const ctx = { random: r, dropItem: () => { drops++; } };
  for (let t = 0; t < TICKS; t++) {
    if (!baby.sneezing && g.canUse()) { g.start(); log.push(['s', t]); }
    if (baby.sneezing && Pd.tickSneeze(baby, ctx)) log.push(['done', t, drops]);
  }
  for (let i = 0; i < 3000; i++) { baby.sneezing = true; baby.sneezeProgress = 0; while (!Pd.tickSneeze(baby, ctx)); }   // forced sneezes: the 1/700 slime roll
  log.push(['forced', drops]);
  return JSON.stringify(log);
}
function reference(salt) {
  const r = stream(salt), log = [];
  const mk = () => ({ m: rgene(r), h: rgene(r) });
  const a = mk(), b = mk(), co = (p) => r() < 0.5 ? p.m : p.h, c = {};
  if (r() < 0.5) { c.m = co(a); c.h = co(b); } else { c.m = co(b); c.h = co(a); }
  if (r() < 1 / 32) c.m = rgene(r);
  if (r() < 1 / 32) c.h = rgene(r);
  log.push([a, b, c].map((e) => [e.m, e.h, prod(e.m, e.h)]));
  const weak = prod(c.m, c.h) === 'weak'; let prog = 0, sn = false, drops = 0;
  for (let t = 0; t < TICKS; t++) {
    if (!sn) { const go = (weak && r() < 1 / 500) ? true : r() < 1 / 6000; if (go) { sn = true; prog = 0; log.push(['s', t]); } }
    if (sn) {
      if (++prog > 20) { sn = false; prog = 0; if (r() < 1 / 700) drops++; log.push(['done', t, drops]); }
    }
  }
  for (let i = 0; i < 3000; i++) if (r() < 1 / 700) drops++;
  log.push(['forced', drops]);
  return JSON.stringify(log);
}
function run() {
  let bad = null, sneezes = 0;
  for (let s = 0; s < 20 && !bad; s++) {
    const x = engine(s), y = reference(s);
    if (x !== y) bad = `salt ${s}: engine ${x.slice(0, 300)} != ref ${y.slice(0, 300)}`;
    sneezes += (y.match(/"done"/g) || []).length;
  }
  return { bad, sneezes };
}
let fails = 0, breaks = 0;
const base = run();
if (base.bad) { fails++; console.log('  FAIL ' + base.bad); }
if (!base.sneezes) { fails++; console.log('  FAIL vacuous: no sneeze over 20 salts'); }
const mut = (name, o, k, v) => {
  const old = o[k]; o[k] = v; const r = run(); o[k] = old;
  if (r.bad) { breaks++; console.log('   ✓ break caught: ' + name); } else { fails++; console.log('  ✗ break NOT caught: ' + name); }
};
mut('sneeze weak chance 1/500 -> 1/100', Pd, 'SNEEZE_CHANCE_WEAK', 1 / 100);
mut('sneeze normal chance 1/6000 -> 1/300', Pd, 'SNEEZE_CHANCE_NORMAL', 1 / 300);
mut('slime drop 1/700 -> 1/70', Pd, 'SLIME_BALL_DROP_CHANCE', 1 / 70);
mut('sneeze duration 20 -> 15', Pd, 'SNEEZE_DURATION', 15);
{ const old = Pd.GENE_RECESSIVE.slice(); Pd.GENE_RECESSIVE.splice(0, 7, true, true, true, true, false, false, true);
  const r = run(); Pd.GENE_RECESSIVE.splice(0, 7, ...old);
  if (r.bad) { breaks++; console.log('   ✓ break caught: swapped dominant/recessive rule'); } else { fails++; console.log('  ✗ break NOT caught: swapped dominant/recessive'); } }
console.log(`lockstep-pandabehaviour: ${21 + breaks} assertions, ${fails} failures, ${breaks} breaks caught (${base.sneezes} sneezes over 20 salts)`);
process.exit(fails ? 1 : 0);
