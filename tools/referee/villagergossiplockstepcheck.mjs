// villagergossiplockstepcheck.mjs -- #7906 (G18f-L5): lockstep scenario 'villagergossip': 20 salts x 4 villagers x 3 days (72000 ticks) of a scripted player who trades, hurts and kills a villager, heals a golem and cures a zombie villager; villagers talk (1200-tick window, shareGossipFrom 10 picks, share decrement, max-merge) and decay once per 24000 ticks. Per sampled tick every villager's gossip store (type -> value) is compared with an independent VillagerGossips reference (.decomp VillagerGossips.startGossip/mergeReputation/clamp/shareGossipFrom/pickGossips/decay, VillageGossipType). The golem summon that talkWithVillager chains is villagegolemcheck's and is stubbed.
import { loadEngine } from '../loadsrc.mjs';
const M = loadEngine({ extra: ['02f_tags.js', '02g_items.js', '14f_inventory.js', '07b_behaviour.js', '07q_effects.js', '07o_profession.js', '07ox_enchhelper.js', '07l_spawn.js'], dom: false, initReg: true });
const V = M.Village;
V.summonGolem = () => {};
let fails = 0, breaks = 0;
const ok = (c, m) => { if (!c) { fails++; console.log('  FAIL ' + m); } };
const brk = (c, m) => { if (c) { breaks++; console.log('   ✓ break caught: ' + m); } else { fails++; console.log('  ✗ break NOT caught: ' + m); } };
const stream = (salt) => { let s = (salt * 2654435761 + 12345) >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; };
// VillageGossipType: key -> [maxValue, decay, shareDecrement]
const TY = { major_negative: [100, 10, 10], minor_negative: [200, 20, 20], minor_positive: [200, 1, 5], major_positive: [100, 0, 100], trading: [25, 2, 20] };
const ORDER = Object.keys(TY);
const refAdd = (g, k, n) => { // startGossip: mergeInt(type, n, mergeReputation), clamp, drop below 2
  const cur = g[k] || 0, sum = cur + n; let v = sum > TY[k][0] ? Math.max(TY[k][0], cur) : sum;
  if (v > TY[k][0]) v = TY[k][0];
  if (v < 2) delete g[k]; else g[k] = v;
};
const refDecay = (g) => { for (const k of Object.keys(g)) { const v = g[k] - TY[k][1]; if (v < 2) delete g[k]; else g[k] = v; } };
const refShare = (dst, src, rand, count) => {
  const ents = Object.keys(src); /* vanilla order is the open-hash map's; insertion order here */ if (!ents.length) return;
  const cum = []; let tot = 0; for (const k of ents) { tot += Math.abs(src[k]); cum.push(tot - 1); }
  const picked = new Set();
  for (let n = 0; n < count; n++) { const r = Math.floor(rand() * tot); let i = cum.findIndex((c) => c >= r); if (i < 0) i = cum.length; picked.add(ents[i]); }
  for (const k of picked) { const v = src[k] - TY[k][2]; if (v >= 2) dst[k] = Math.max(dst[k] || 0, v); }
};
let samples = 0, capHit = 0, shared = 0, decayed = 0;
function lane(salt) {
  const r = stream(salt), rE = stream(salt + 1000), rR = stream(salt + 1000), out = [];
  const vs = [0, 1, 2, 3].map((i) => ({ type: 'villager', x: i, y: 64, z: 0, gossip: {} }));
  const ref = vs.map(() => ({})), win = vs.map(() => -1e9);
  const evs = [];
  for (let t = 0; t < 72000; t += 1 + Math.floor(r() * 400)) evs.push(t);
  let ei = 0;
  const kinds = [['trading', 2], ['minor_negative', 25], ['major_negative', 25], ['minor_positive', 25], ['major_positive', 20]];
  for (let t = 0; t <= 72000; t += 20) {
    while (ei < evs.length && evs[ei] <= t) {
      ei++;
      const op = r(), i = Math.floor(r() * 4);
      if (op < 0.6) { const [k, n] = kinds[Math.floor(r() * 5)]; V.startGossip(vs[i], k, n); refAdd(ref[i], k, n); }
      else if (op < 0.85) { // talk: both outside the 1200 window
        const j = (i + 1 + Math.floor(r() * 3)) % 4;
        if (t >= win[i] + 1200 && t >= win[j] + 1200) { V.talkWithVillager(vs[i], vs[j], t, rE); refShare(ref[i], ref[j], rR, 10); win[i] = win[j] = t; } 
        else if (V.talkWithVillager(vs[i], vs[j], t, rE)) out.push('salt ' + salt + ' t' + t + ' talked inside window');
      } else { V.startGossip(vs[i], 'major_negative', 25); refAdd(ref[i], 'major_negative', 25); } // villager killed: observers
    }
    for (let i = 0; i < 4; i++) {
      const before = JSON.stringify(vs[i].gossip);
      V.decayGossip(vs[i], t);
      if (t > 0 && t % 24000 === 0) { refDecay(ref[i]); if (before !== JSON.stringify(vs[i].gossip)) decayed++; }
      samples++;
      const a = ORDER.map((k) => k + '=' + (vs[i].gossip[k] ?? '-')).join(), b = ORDER.map((k) => k + '=' + (ref[i][k] ?? '-')).join();
      if (a !== b) { out.push('salt ' + salt + ' t' + t + ' v' + i + ' eng ' + a + ' ref ' + b); return out; }
      for (const k of ORDER) if (ref[i][k] === TY[k][0]) capHit++;
    }
  }
  for (const v of vs) if (v.gossipStartTime !== undefined) shared++;
  return out;
}
// engine decay clock starts on its first call: prime at t=0 like Village.tick does
const pass = () => Array.from({ length: 20 }, (_, i) => i).flatMap(lane);
const base = pass();
ok(base.length === 0, 'lane: ' + base.slice(0, 2).join(' | '));
ok(samples > 20000 && capHit > 0 && shared > 0 && decayed > 0, `lane covers ${samples} samples, cap ${capHit}, talked ${shared}, decays ${decayed}`);
const gos = JSON.stringify(V.GOSSIP);
V.GOSSIP.trading.decay = 4; V.GOSSIP.minor_positive.decay = 3;
brk(pass().length > 0, 'decay changed by 2 per day caught'); V.GOSSIP = JSON.parse(gos);
const sg = V.startGossip; V.startGossip = (e, k, n) => sg(e, k, n + 1);
brk(pass().length > 0, 'added value off by one caught'); V.startGossip = sg;
V.GOSSIP.major_negative.max = 90;
brk(pass().length > 0, 'max value cap changed caught'); V.GOSSIP = JSON.parse(gos);
V.GOSSIP.minor_negative.share = 10;
brk(pass().length > 0, 'share decrement changed caught'); V.GOSSIP = JSON.parse(gos);
const tw = V.TALK_WINDOW; V.TALK_WINDOW = 600;
brk(pass().length > 0, 'talk window halved caught'); V.TALK_WINDOW = tw;
brk(pass().length === 0, 'unfaulted lane passes after restore');
console.log(`villagergossiplockstepcheck: ${2 + breaks} assertions, ${fails} failures, ${breaks} breaks caught`);
process.exit(fails ? 1 : 0);
