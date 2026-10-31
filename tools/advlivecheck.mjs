#!/usr/bin/env node
// advlivecheck.mjs -- G17-ADV1: the player owns a live advancement Tracker, created in Main.finishBoot, saved in the
// MC-Lite save's `advancements` key and loaded back without re-granting (PlayerAdvancementTracker.load/save).
import { open, sleep } from './cdp.mjs';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const FILE = ROOT + 'dist/mclite.html';
let pass = 0, breaks = 0;
const fails = [];
const ok = (c, m, d) => { if (c) { pass++; console.log('ok    ' + m); } else { fails.push(m); console.log('FAIL  ' + m + (d !== undefined ? '   ' + d : '')); } return c; };
const okAv = (c, m, d) => { breaks++; if (c) { pass++; console.log('   ok ' + m); } else { fails.push('anti-vacuity: ' + m); console.log('   x  ' + m + (d !== undefined ? '   ' + d : '')); } };

const page = await open(FILE, { width: 900, height: 600 });
if (!page) { console.log('SKIP  advlivecheck: no Chromium found'); process.exit(0); }
try {
  await sleep(1200);
  await page.evaluate(function () { if (window.MCL && MCL.Main && !MCL.Main.ready) MCL.Main.play({}); });
  const up = await page.waitFor(function () { return !!(window.MCL && MCL.Main.ready && MCL.Hud.mode === 'game' && MCL.World.chunks.size > 20); }, 60000);
  if (!ok(up, 'the world came up', page.lastThrow)) throw new Error('never reached the game');
  const r = await page.evaluate(function () {
    var P = MCL.Player, A = MCL.Adv, out = {};
    out.has = !!P.advancements;
    if (!P.advancements) return out;
    var st = { i: MCL.Items.names.indexOf('crafting_table'), n: 1, d: 0 };
    var ctx = { slots: [st], stack: st };
    var root = A.manager.advancements.get('minecraft:story/root');
    out.before = P.advancements.getProgress(root).isDone();
    var n = 0;
    try { n = A.trigger(P, 'minecraft:inventory_changed', ctx); } catch (e) { out.err = String(e); }
    out.granted = n;
    out.mine = P.advancements.getProgress(A.manager.advancements.get('minecraft:story/root')).isAnyObtained();
    out.crit = Array.from(A.manager.advancements.values()).filter(function (a) { return P.advancements.getProgress(a).isAnyObtained(); }).map(function (a) { return a.id; });
    out.saved = MCL.Save.save(false);
    var j = JSON.parse(localStorage.getItem(MCL.Save.KEY)).advancements;
    out.keys = j ? Object.keys(j) : null;
    var grants = 0, host = P;
    var old = P.onGrant; P.onGrant = function () { grants++; };
    A.attachPlayer(P, j);                   // a fresh world's load path
    out.after = out.crit.every(function (id) { return P.advancements.getProgress(A.manager.advancements.get(id)).isAnyObtained(); });
    out.again = A.trigger(P, 'minecraft:inventory_changed', ctx);
    out.grants = grants;
    P.onGrant = old;
    P.advancements = null;                  // anti-vacuity: no Tracker -> nothing can be earned
    out.noTracker = A.trigger(P, 'minecraft:inventory_changed', ctx);
    A.attachPlayer(P, null);
    out.fresh = A.trigger(P, 'minecraft:inventory_changed', ctx);   // an empty record earns again
    return out;
  });
  console.log(JSON.stringify(r));
  ok(r.has, 'the player owns an advancement Tracker after world start');
  ok(r.before === false, 'story/root not done before the trigger');
  ok(r.granted > 0 && r.mine, 'inventory_changed with a crafting table completes a story/ criterion', JSON.stringify(r.crit));
  ok(r.keys && r.keys.length > 0, 'the save carries the advancements key', JSON.stringify(r.keys));
  ok(r.after, 'a fresh load still has every obtained criterion');
  ok(r.again === 0 && r.grants === 0, 'not re-granted after load', r.again + '/' + r.grants);
  okAv(r.noTracker === 0, 'without a Tracker nothing is earned');
  okAv(r.fresh > 0, 'a Tracker loaded from an empty record earns again');
  ok(page.problems.length === 0, 'the page logged no errors', page.problems.slice(0, 3).join(' | '));
} catch (e) {
  fails.push('harness: ' + (e && e.message));
  console.log('FAIL  harness: ' + (e && (e.stack || e.message)));
} finally { await page.close(); }
console.log('\n advlivecheck: ' + pass + ' assertions, ' + fails.length + ' failed, ' + breaks + ' breaks caught');
process.exit(fails.length ? 1 : 0);
