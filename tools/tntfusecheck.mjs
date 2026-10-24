#!/usr/bin/env node
// tntfusecheck.mjs -- #3926: TNTFuse (and furnace/hopper cart NBT) read/write round trip. Anti-vacuity: edited source must fail.
import { loadEngine } from './loadsrc.mjs';
console.log('tntfusecheck -- #3926, minecart NBT');
function scenarios(patch) {
  const fails = []; let n = 0;
  const ok = (c, m) => { n++; if (!c) fails.push(m); };
  const M = loadEngine({ extra: ['02f_tags.js', '07b_behaviour.js', '07f_redstone.js', '07zzq_rail.js', '07zzr_minecart.js'], dom: false, patch });
  M.Behave.init({ getBlock: () => 0, setBlock() { return true; }, blockLightAt: () => 15 }); const Mc = M.Minecart;
  const t = { type: 'tnt_minecart' }; Mc.init(t, {});
  ok(t.cartFuse === -1 && Mc.writeNbt(t).TNTFuse === -1, 'unprimed -1');
  Mc.readNbt(t, { TNTFuse: 37 });
  ok(t.cartFuse === 37 && Mc.writeNbt(t).TNTFuse === 37, 'summon/data merge sets the fuse');
  const t2 = { type: 'tnt_minecart' }; Mc.init(t2, Mc.writeNbt(t));
  ok(t2.cartFuse === 37, 'init from written NBT keeps the fuse');
  const f = { type: 'furnace_minecart' }; Mc.init(f, { Fuel: 100, PushX: 0.5, PushZ: -0.25 });
  const w = Mc.writeNbt(f);
  ok(w.Fuel === 100 && w.PushX === 0.5 && w.PushZ === -0.25 && f.cartLit, 'furnace round trip');
  const h = { type: 'hopper_minecart' }; Mc.init(h, { TransferCooldown: 4, Enabled: false });
  ok(Mc.writeNbt(h).TransferCooldown === 4 && Mc.writeNbt(h).Enabled === false, 'hopper round trip');
  return { fails, n };
}
const real = scenarios();
const fails = real.fails.slice(); let breaks = 0;
for (const [label, a, b] of [
  ['TNTFuse not read', "typeof n.TNTFuse === 'number'", 'false'],
  ['TNTFuse not written', 'o.TNTFuse = e.cartFuse', 'o.TNTFuse = -1'],
  ['Fuel not read', 'e.fuel = sh(n.Fuel)', 'e.fuel = 0'],
  ['Enabled not read', 'e.hopperEnabled = !!n.Enabled', 'e.hopperEnabled = true'],
]) {
  let matched = false;
  const patch = (f, src) => { if (f !== '07zzr_minecart.js') return src; if (src.includes(a)) matched = true; return src.split(a).join(b); };
  let r; try { r = scenarios(patch); } catch (err) { r = { fails: ['threw'] }; }
  if (!matched) fails.push('edit matched nothing: ' + label);
  else if (r.fails.length) { breaks++; console.log('   ✓ break caught: ' + label); } else fails.push('unnoticed break: ' + label);
}
if (fails.length) { console.log('FAIL'); fails.forEach((f) => console.log('  ' + f)); process.exit(1); }
console.log(`tntfusecheck: ${real.n} assertions, 0 failures, ${breaks} breaks caught`);
