#!/usr/bin/env node
// advcommandcheck.mjs -- #8123: /advancement grant|revoke only/from/until/through/everything walks the advancement
// tree exactly as AdvancementCommand.select does. Anti-vacuity: edited sources must fail ('<n> breaks caught').
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { inflateRawSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const FILES = ['00_ns.js', '01_util.js', '01b_inflate.js', '02_blocks.js', '02b_registry.js', '02c_states.js', '02f_tags.js',
  '02k_survive.js', '02g_items.js', '02i_text.js', '02j_sounds.js', '02l_advancements.js', '09b_sky.js', '14e_gamemode.js',
  '14f_inventory.js', '14d_survival.js', '14h_brigadier.js', '15g_commands.js'];
console.log('advcommandcheck -- #8123, /advancement grant and revoke');

function scenario(edit) {
  const NS = {}; globalThis.MCL = NS;
  for (const f of FILES) {
    let s = readFileSync(join(ROOT, 'src', f), 'utf8');
    if (edit && f === edit[0]) { if (!s.includes(edit[1])) throw new Error('edit target missing: ' + edit[1]); s = s.replace(edit[1], edit[2]); }
    new Function('MCL', s)(NS);
  }
  const raw = readFileSync(join(ROOT, 'assets/lang.bin'));
  NS.Text.init({ lang: raw.toString('base64'), langBytes: inflateRawSync(raw).length });
  const Adv = NS.Adv, rw = { experience: 0, loot: [], recipes: [], fn: null };
  Adv.manager = new Adv.Manager();
  const mk = (id, parent) => { const a = new Adv.Advancement(id, parent, null, rw, { c: {} }, [['c']]); Adv.manager.advancements.set(id, a); return a; };
  const root = mk('t:root', null), mid = mk('t:mid', root), leaf = mk('t:leaf', mid), side = mk('t:side', mid);
  const all = [root, mid, leaf, side];
  (globalThis.__x = null);
  NS.Player = { mode: 0 };
  NS.Commands.build();
  const fails = []; const ok = (c, m) => { if (!c) fails.push(m); };
  const done = () => all.filter((a) => NS.Player.advancements && NS.Player.advancements.getProgress(a).isDone()).map((a) => a.id.slice(2)).join(',');
  const run = (l) => NS.Commands.run(l, NS.Player);
  const keyOf = (r) => (r.error && r.error.key) || (r.lines.length && r.lines[r.lines.length - 2 < 0 ? 0 : 0]);

  ok(run('advancement grant @s only t:mid').ok && done() === 'mid', 'grant only completes exactly one (got ' + done() + ')');
  run('advancement revoke @s everything'); ok(done() === '', 'revoke everything clears (got ' + done() + ')');
  run('advancement grant @s from t:mid'); ok(done() === 'mid,leaf,side', 'from = node + descendants (got ' + done() + ')');
  run('advancement revoke @s from t:mid'); ok(done() === '', 'revoke from undoes it (got ' + done() + ')');
  run('advancement grant @s until t:leaf'); ok(done() === 'root,mid,leaf', 'until = node + ancestors (got ' + done() + ')');
  run('advancement revoke @s until t:leaf'); ok(done() === '', 'revoke until undoes it (got ' + done() + ')');
  run('advancement grant @s through t:mid'); ok(done() === 'root,mid,leaf,side', 'through = both (got ' + done() + ')');
  run('advancement revoke @s through t:mid'); ok(done() === '', 'revoke through undoes it (got ' + done() + ')');
  run('advancement grant @s everything'); ok(done() === 'root,mid,leaf,side', 'everything (got ' + done() + ')');
  run('advancement revoke @s only t:leaf'); ok(done() === 'root,mid,side', 'revoke only (got ' + done() + ')');
  run('advancement revoke @s everything');
  run('advancement grant @s only t:leaf');
  let r = run('advancement grant @s only t:leaf');
  ok(!r.ok && /one\.to\.one\.failure|advancement/.test(JSON.stringify(r.error && r.error.key)), 'already granted: one.to.one.failure (got ' + JSON.stringify(r.error && r.error.key) + ')');
  r = run('advancement grant @s from t:leaf'); ok(!r.ok, 'from on a done leaf fails');
  r = run('advancement grant @s until t:mid');
  ok(r.ok && r.result === 2 && done() === 'root,mid,leaf', 'until t:mid counts 2 new (result ' + r.result + ')');
  r = run('advancement grant @s through t:mid');
  ok(r.ok && r.result === 1 && done() === 'root,mid,leaf,side', 'through counts only the new one (result ' + r.result + ')');
  r = run('advancement grant @s through t:mid'); ok(!r.ok && r.error.key === 'commands.advancement.grant.many.to.one.failure', 'many.to.one.failure key (got ' + (r.error && r.error.key) + ')');
  r = run('advancement grant @s only t:leaf c'); ok(!r.ok && r.error.key === 'commands.advancement.grant.criterion.to.one.failure', 'criterion failure key (got ' + (r.error && r.error.key) + ')');
  r = run('advancement revoke @s only t:leaf c'); ok(r.ok && done() === 'root,mid,side', 'revoke criterion ok');
  r = run('advancement revoke @s only t:leaf c'); ok(!r.ok && r.error.key === 'commands.advancement.revoke.criterion.to.one.failure', 'revoke criterion failure');
  r = run('advancement grant @s only t:leaf nope'); ok(!r.ok && r.error.key === 'commands.advancement.criterionNotFound', 'criterionNotFound');
  r = run('advancement revoke @s only t:root'); ok(r.ok, 'revoke only root ok');
  return { fails };
}

const real = scenario(null);
if (real.fails.length) { for (const f of real.fails) console.log('FAIL  ' + f); process.exit(1); }
const breaks = [
  ['15g_commands.js', 'if (after) walk(a);', ''],
  ['15g_commands.js', 'if (before) for (x = a.parent; x; x = x.parent) out.push(x);', ''],
  ['15g_commands.js', 'return advRun(c, op, advAll());', 'return advRun(c, op, [advAll()[0]]);'],
  ['15g_commands.js', 'if (p.isDone()) return false;', ''],
  ['15g_commands.js', "pre + '.' + shape + '.failure'", "pre + '.' + shape + '.success'"],
];
let caught = 0;
for (const b of breaks) { const r = scenario(b); if (r.fails.length) { caught++; console.log('   ✓ caught: ' + b[2].trim().slice(0, 40)); } else console.log('NOT CAUGHT  ' + b[1]); }
if (caught !== breaks.length) process.exit(1);
console.log(`advcommandcheck: 27 assertions, 0 failures, ${caught} breaks caught`);
