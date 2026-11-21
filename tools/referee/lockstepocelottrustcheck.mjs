// lockstep-ocelottrust -- #6795 (G17-L144): OcelotEntity.interactMob feed roll, 20 salts.
// Reference = .decomp OcelotEntity.interactMob: (temptGoal==null || active) && !trusting && isBreedingItem (raw cod/salmon) && squaredDistance < 9
// -> eat; random.nextInt(3)==0 -> setTrusting + hearts (status 41) else smoke (status 40). FleeGoal(Player, 16, 0.8, 1.33) only while not trusting;
// OcelotTemptGoal speed 0.6 at priority 3, canBeScared = !trusting.
import { loadEngine } from '../loadsrc.mjs';
const M = loadEngine({ extra: ['02f_tags.js', '07b_behaviour.js', '07_world.js', '07l_spawn.js', '07k_goals.js', '07n_tame.js'], dom: false, initReg: true });
let fails = 0, breaks = 0;
const ok = (c, m) => { if (!c) { fails++; if (fails < 25) console.log('  FAIL ' + m); } };
const stream = (salt) => { let s = (salt * 2654435761 + 12345) >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; };
const bursts = [];
M.Particle = Object.assign(M.Particle || {}, { spawnBurst: (k) => bursts.push(k) });
M.Breed = Object.assign(M.Breed || {}, { particlePoint: () => [0, 0, 0] });
function run() {
  let n = 0, bad = null, trusted = 0;
  for (let s = 0; s < 20 && !bad; s++) {
    // one lane per feed index so every stream position is covered
    for (let k = 0; k < 24 && !bad; k++) {
      const rE = stream(s * 31 + k), rR = stream(s * 31 + k), Tm = M.Tame; Tm.ready = true;
      for (let i = 0; i < k; i++) { rE(); rR(); }
      const e = { type: 'ocelot', trusting: false, temptActive: true };
      bursts.length = 0;
      const r = Tm.feedOcelot(e, k % 2 ? 'cod' : 'salmon', { distSq: 4, random: rE });
      const trust = Math.floor(rR() * 3) === 0; n++; if (trust) trusted++;
      if (!r || !r.consumed) bad = `salt ${s} k ${k}: not consumed`;
      else if (e.trusting !== trust) bad = `salt ${s} k ${k}: trust ${e.trusting} vs ${trust}`;
      else if (bursts[0] !== (trust ? 'heart' : 'smoke')) bad = `salt ${s} k ${k}: particle ${bursts[0]}`;
      else if (M.Tame.feedOcelot(e, 'cod', { distSq: 4, random: rE }) !== null && trust) bad = `salt ${s} k ${k}: fed while trusting`;
      const gate = [[{ type: 'ocelot', trusting: false, temptActive: false }, 'cod', 4], [{ type: 'ocelot', trusting: false, temptActive: true }, 'cod', 9],
        [{ type: 'ocelot', trusting: false, temptActive: true }, 'beef', 4], [{ type: 'ocelot', trusting: true, temptActive: true }, 'cod', 4]];
      for (const [g, it, d] of gate) if (!bad && Tm.feedOcelot(g, it, { distSq: d, random: stream(1) }) !== null) bad = `salt ${s}: gate ${it} d${d} fed`;
    }
  }
  return { bad, n, trusted };
}
const base = run(); ok(!base.bad, base.bad); ok(base.n === 480, 'lanes ' + base.n); ok(base.trusted > 100 && base.trusted < 220, 'trust rate ' + base.trusted + '/480');
const brk = (c, m) => { if (c) { breaks++; console.log('   ✓ break caught: ' + m); } else { fails++; console.log('  ✗ break NOT caught: ' + m); } };
{ const o = M.Tame.CHANCE_DENOM; M.Tame.CHANCE_DENOM = 2; brk(!!run().bad, 'trust roll 1/3 -> 1/2'); M.Tame.CHANCE_DENOM = 4; brk(!!run().bad, 'trust roll 1/3 -> 1/4'); M.Tame.CHANCE_DENOM = o; }
{ const o = M.Tame.feedOcelot; M.Tame.feedOcelot = (e, it, c) => o(e, it, Object.assign({}, c, { distSq: 4 })); brk(!!run().bad, 'range gate ignored'); M.Tame.feedOcelot = o; }
{ const o = M.Tame.feedOcelot; M.Tame.feedOcelot = (e, it, c) => { const t = e.trusting; e.trusting = false; const r = o(e, it, c); if (t) e.trusting = true; return r; }; brk(!!run().bad, 'trusting ocelot refed'); M.Tame.feedOcelot = o; }
{ const o = M.Tame.feedOcelot; M.Tame.feedOcelot = (e, it, c) => o(e, it === 'beef' ? 'cod' : it, c); brk(!!run().bad, 'beef accepted'); M.Tame.feedOcelot = o; }
console.log(`lockstep-ocelottrust: ${base.n} assertions, ${fails} failures, ${breaks} breaks caught`);
process.exit(fails ? 1 : 0);
