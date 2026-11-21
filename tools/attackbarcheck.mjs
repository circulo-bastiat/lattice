#!/usr/bin/env node
// attackbarcheck.mjs — #11404: the attack-cooldown indicator, for every weapon/tool tier and bare hand, with and
// without Haste / Mining Fatigue: per-tick progress vs PlayerEntity.getAttackCooldownProgress, ticks to full, bar px
// vs progress (crosshair width (int)(p*17), hotbar height (int)(p*19)), reset on item switch, and the damage ramp
// using the same progress. Breaks its own source and prints the count.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const ROOT = fileURLToPath(new URL('../', import.meta.url));
const rows = readFileSync(ROOT + 'tools/golden/item-attributes-1.18.2.tsv', 'utf8').split('\n')
  .filter(l => l && l[0] !== '#' && !l.startsWith('item\t')).map(l => l.split('\t'));
const table = {};
for (const r of rows) table[r[0]] = [+r[6], +r[7], +r[8]];
const names = ['(hand)', ...Object.keys(table), 'trident'];
const load = (edits) => {
  const NS = {};
  const ids = {}; names.forEach((n, i) => ids[n] = i);
  NS.Inventory = { isEmpty: s => !s };
  NS.Items = { nameOf: i => names[i] };
  NS.Effects = {
    attrValue: (e, a, b) => { let m = 1; for (const k in e.effects) m *= 1 + (k === 'haste' ? 0.1 : -0.1) * (e.effects[k].amplifier + 1); return b * m; }
  };
  NS.Player = {};
  const run = (f, extra) => { let s = readFileSync(ROOT + 'src/' + f, 'utf8'); for (const [a, b] of (extra || [])) s = s.split(a).join(b); new Function('MCL', s)(NS); };
  run('14i_hand.js', edits && edits.hand);
  const hud = readFileSync(ROOT + 'src/15_hud.js', 'utf8');
  new Function('MCL', 'document', 'window', edits && edits.hud ? edits.hud.reduce((s, [a, b]) => s.split(a).join(b), hud) : hud)(NS, {}, {});
  NS.Hand.bindAttrs(table);
  return { NS, ids };
};
const fails = []; let pass = 0;
const ok = (c, m) => { if (c) pass++; else if (fails.length < 8) fails.push(m); };
const stackOf = (ids, n) => n === '(hand)' ? null : { i: ids[n] };
const measure = (edits) => {
  const { NS, ids } = load(edits), H = NS.Hand, Hud = NS.Hud, fr = Math.fround;
  const effs = [null, { haste: { duration: 99, amplifier: 0 } }, { haste: { duration: 99, amplifier: 1 } }, { mining_fatigue: { duration: 99, amplifier: 0 } }, { mining_fatigue: { duration: 99, amplifier: 2 } }];
  const before = []; const bad = (m) => before.push(m);
  for (const n of names) for (const ef of effs) {
    const st = stackOf(ids, n);
    const base = n === '(hand)' ? 4 : n === 'trident' ? 1.1 : table[n][1];
    let sp = base; if (ef) for (const k in ef) sp *= 1 + (k === 'haste' ? 0.1 : -0.1) * (ef[k].amplifier + 1);
    const delay = Math.fround(1 / sp * 20);
    NS.Player.effects = ef || {};
    H.resetAttackStrength();
    let first = -1;
    for (let t = 0; t < 80; t++) {
      const want = Math.min(1, Math.max(0, fr(t / delay)));
      const got = H.attackStrengthScale(st, 0);
      if (Math.abs(got - want) > 1e-9) { bad(`${n} ef=${ef ? Object.keys(ef) : '-'} t=${t}: ${got} vs ${want}`); break; }
      if (got >= 1 && first < 0) first = t;
      // bar pixels
      const s = { w: 320, h: 240, mode: 1, p: got, perTick: delay, living: false, mainHand: 'right' };
      const cb = Hud.crosshairBlits(s).find(b => b.r[0] === 52);
      if (got < 1 && (!cb || cb.w !== ((got * 17) | 0))) { bad(`${n} t=${t}: crosshair fill ${cb && cb.w} vs ${(got * 17) | 0}`); break; }
      const hb = Hud.hotbarIndicatorBlits({ ...s, mode: 2 });
      const fill = hb.find(b => b.r[0] === 18);
      const hn = (got * 19) | 0;
      if (got < 1 && ((hn > 0 && (!fill || fill.r[3] !== hn)) || (hn === 0 && fill))) { bad(`${n} t=${t}: hotbar fill ${fill && fill.r[3]} vs ${hn}`); break; }
      if (got >= 1 && (hb.length || Hud.crosshairBlits(s).length !== 1)) { bad(`${n} t=${t}: indicator shown at full`); break; }
      H.tickAttackStrength();
    }
    if (first !== Math.ceil(delay)) bad(`${n} ef=${ef ? Object.keys(ef) : '-'}: ticks to full ${first} vs ${Math.ceil(delay)}`);
  }
  // reset on slot switch (noteSelected) and damage ramp consistency
  const P = NS.Player; P.effects = {};
  let cur = { i: ids.diamond_sword }; P.heldItem = () => cur;
  H.noteSelected(P); H.attackStrengthTicker = 20; H.noteSelected(P);
  if (H.attackStrengthTicker !== 20) bad('reset without a switch');
  cur = { i: ids.diamond_axe }; H.noteSelected(P);
  if (H.attackStrengthTicker !== 0) bad('no reset on switching item');
  return before;
};
const clean = measure(null);
ok(clean.length === 0, 'clean: ' + clean.slice(0, 4).join(' | '));
ok(Object.keys(table).length === 30, 'table has 30 rows');
const dmg = readFileSync(ROOT + 'src/14j_combat.js', 'utf8');
ok(/attackStrengthScale\(attrHeld, 0\.5\)/.test(dmg) && /RAMP_BASE \+ h \* h \* Cb\.RAMP_SCALE/.test(dmg), 'damage ramp uses the same attackStrengthScale');
ok(/0\.2/.test(dmg.match(/RAMP_BASE\s*=\s*([\d.]+)/)?.[1] || '') && /0\.8/.test(dmg.match(/RAMP_SCALE\s*=\s*([\d.]+)/)?.[1] || ''), 'ramp constants 0.2 / 0.8');
let breaks = 0;
const brk = (name, e) => { try { if (measure(e).length) breaks++; else fails.push('break not caught: ' + name); } catch (x) { breaks++; } };
brk('speed 4.5', { hand: [['BASE_ATTACK_SPEED: 4.0', 'BASE_ATTACK_SPEED: 4.5']] });
brk('no haste', { hand: [['sp = ES.attrValue(e, \'generic.attack_speed\', sp);', '']] });
brk('no reset on switch', { hand: [['H.resetAttackStrength(); p.selectedItemIdx = now;', 'p.selectedItemIdx = now;']] });
brk('bar width 16', { hud: [['(st.p * 17) | 0', '(st.p * 16) | 0']] });
brk('hotbar height 18', { hud: [['n = (st.p * 19) | 0', 'n = (st.p * 18) | 0']] });
brk('delay off by one', { hand: [['return Math.fround((1 / sp) * 20);', 'return Math.fround((1 / sp) * 20) + 1;'], ['(1 / sp) * 20)', '(1 / sp) * 20)']] });
console.log(fails.length ? 'FAIL ' + fails.join('; ') : `attackbarcheck: ${pass} passed, ${breaks} breaks caught`);
process.exit(fails.length ? 1 : 0);
