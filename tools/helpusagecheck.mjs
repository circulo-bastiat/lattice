#!/usr/bin/env node
// helpusagecheck.mjs — KW-47. `/help`'s argument syntax and vanilla's compact smart-usage form.
//
//   node tools/helpusagecheck.mjs [--verbose]
//
// vanilla's `HelpCommand.register` (.decomp net/minecraft/server/command/HelpCommand.java) never
// enumerates every runnable path: it calls Brigadier's `CommandDispatcher.getSmartUsage`, ONE
// compact line per branch, with `[...]` (optional) / `(a|b)` (alternatives) folded into that one
// string — jar-verified against brigadier-1.3.10.jar's `CommandDispatcher.class` constant pool,
// whose only literal strings are `[` `]` `(` `)` `|` ` ` `...` `-> `, in that order (no
// javap/decompiler available on this box; the class file's own constant pool is the source of
// truth here, read with a small pure-Python classfile parser since `javap` isn't installed).
// This check asserts the THREE gaps named in KW-47:
//   1. no-arg `/help` shows each top-level command's argument SHAPE, not a bare name;
//   2. `/help <command>` re-parses the WHOLE typed string (narrows into a sub-path) instead of
//      truncating to the first word;
//   3. `/help <command>` prints one smart-usage line per branch, not `usage()`'s
//      every-runnable-path enumeration.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateRawSync } from 'node:zlib';

const MCLITE_ROOT = fileURLToPath(new URL('..', import.meta.url));
const SRC = MCLITE_ROOT + 'src', ASSETS = MCLITE_ROOT + 'assets';
const VERBOSE = process.argv.includes('--verbose');

const NS = {};
globalThis.MCL = NS;
const FILES = ['00_ns.js', '01_util.js', '01b_inflate.js', '02_blocks.js', '02b_registry.js',
  '02c_states.js', '02g_items.js', '02i_text.js', '02j_sounds.js', '09b_sky.js', '14e_gamemode.js',
  '14f_inventory.js', '14d_survival.js', '14h_brigadier.js', '15g_commands.js'];
for (const f of FILES) new Function('MCL', readFileSync(join(SRC, f), 'utf8'))(NS);
{
  const raw = readFileSync(join(ASSETS, 'lang.bin'));
  NS.Text.init({ lang: raw.toString('base64'), langBytes: inflateRawSync(raw).length });
  const meta = JSON.parse(readFileSync(join(ASSETS, 'items.meta.json'), 'utf8'));
  NS.Items.init({ items: readFileSync(join(ASSETS, 'items.bin')).toString('base64'), itemsBytes: meta.rawBytes });
}
{
  const { initRegistry } = await import('./loadsrc.mjs');
  initRegistry(NS);
}
NS.Main = { seed: 1337 };
NS.DATA = NS.DATA || {};
NS.DATA.gameRules = {};
NS.World = { getBlock: () => 0, setBlock: () => true, getBlockEntity: () => null };
const mkPlayer = () => {
  const P = { x: 0, y: 70, z: 0, yaw: 0, pitch: 0, mode: 0, health: 20, dead: false,
    inventory: NS.Inventory.create(), syncHotbar() {}, mayFly: false, instabuild: false,
    flying: false, invulnerable: false, mayBuild: true };
  NS.Player = P;
  if (NS.Survival && NS.Survival.init) NS.Survival.init(P);
  return P;
};
const C = NS.Commands;
const P = mkPlayer();
const run = (line) => C.run(line, P, { level: 4 });

let pass = 0; const fails = [];
const ok = (c, m) => { if (c) { pass++; if (VERBOSE) console.log('   ✓ ' + m); } else fails.push(m); };
const okAv = (c, m) => { if (c) { pass++; if (VERBOSE) console.log('   ✓ ' + m); } else fails.push('anti-vacuity: ' + m); };

console.log('helpusagecheck — KW-47, /help argument syntax + vanilla smart-usage compaction');

// ── 1. no-arg /help: one line per top-level command, carrying its argument shape ───────────
const h = run('/help');
ok(h.ok, '/help succeeds');
const gm = h.lines.find((l) => l.indexOf('/gamemode') === 0);
ok(gm === '/gamemode <mode> [<targets>]',
  `no-arg /help shows /gamemode's argument shape on one line, not a bare name: ${JSON.stringify(gm)}`);
// ⚠ THE OLD BUG: D.names() printed one bare command word with NO argument syntax at all.
ok(!h.lines.includes('/gamemode'), '...and NOT the old bare "/gamemode" with no arguments shown');
// a redirect (`/tp` -> `/teleport`) compacts to vanilla's `-> ` form, not its own full subtree.
ok(h.lines.includes('/tp -> teleport'), `/tp's redirect line reads "-> teleport": ${JSON.stringify(h.lines.find((l) => l.indexOf('/tp') === 0))}`);
// alternlivet literal children with genuinely different continuations collapse to `(a|b|c)`.
ok(h.lines.includes('/time (set|add|query)'),
  `/time's three literal branches collapse to one (a|b|c) line: ${JSON.stringify(h.lines.find((l) => l.indexOf('/time') === 0))}`);

// ── 2. /help <command>: ONE smart-usage line, not usage()'s one-line-per-runnable-path ──────
const hg = run('/help gamemode');
ok(hg.ok && hg.lines.length === 1 && hg.lines[0] === '/gamemode <mode> [<targets>]',
  `/help gamemode is a single compact line: ${JSON.stringify(hg.ok ? hg.lines : hg.error)}`);

// ── 3. /help <command> <sub>: re-parses the WHOLE string, narrowing into the sub-path ───────
// ⚠ THE OLD BUG: `get(c,'command').split(' ')[0]` threw away everything past the first word, so
// `/help gamemode survival` looked up the SAME node as `/help gamemode` and printed the SAME
// lines. A correct re-parse narrows into the `survival` value already consumed and shows only
// what's left: `[<targets>]`, with "survival" folded into the echoed command text, not "<mode>".
const hgs = run('/help gamemode survival');
ok(hgs.ok, '/help gamemode survival succeeds');
ok(JSON.stringify(hgs.lines) !== JSON.stringify(hg.lines),
  `/help gamemode survival must NOT repeat plain /help gamemode's output: ${JSON.stringify(hgs.lines)}`);
ok(hgs.ok && hgs.lines.length === 1 && hgs.lines[0] === '/gamemode survival [<targets>]',
  `/help gamemode survival narrows into the parsed sub-path: ${JSON.stringify(hgs.ok ? hgs.lines : hgs.error)}`);
ok(!hgs.lines.some((l) => l.indexOf('<mode>') >= 0),
  '...and no longer shows the already-consumed <mode> placeholder');

// unknown command still fails the same way
const hu = run('/help notacommand');
ok(!hu.ok && hu.error.key === 'commands.help.failed', `help for an unknown command still fails: ${hu.ok}`);

// ── anti-vacuity: prove the smart-usage generator isn't just decorating every command with
// invented brackets, and that a sub-path re-parse genuinely produces DIFFERENT text rather than
// a hardcoded string that would pass this check regardless of what was typed.
// (vanilla's OWN HelpCommand.register, .decomp, calls getSmartUsage on the deepest PARSED node
// and iterates only ITS children -- so a true leaf like /seed legitimately yields zero entries
// in real vanilla too; that is not a gap to test here.)
const timeLine = h.lines.find((l) => l.indexOf('/time') === 0) || '';
okAv(/\[<targets>\]/.test(gm) && /\(set\|add\|query\)/.test(timeLine),
  `two structurally different nodes each produce their OWN distinct notation -- gamemode's single-child optional bracket (${JSON.stringify(gm)}) vs time's multi-child pipe-alternation (${JSON.stringify(timeLine)}) -- not one hardcoded template for every command`);
okAv(hgs.lines[0] !== hg.lines[0],
  `/help gamemode survival's smart-usage line really differs from plain /help gamemode's -- not a fixed string that would pass however the sub-path parses: ${JSON.stringify([hg.lines[0], hgs.lines[0]])}`);

// ── deliberate breaks: the core assertions must FAIL when getSmartUsage is sabotaged ─────────
const core = () => {
  const a = run('/help').lines, b = run('/help gamemode'), c2 = run('/help gamemode survival');
  return a.find((l) => l.indexOf('/gamemode') === 0) === '/gamemode <mode> [<targets>]'
    && a.includes('/tp -> teleport') && a.includes('/time (set|add|query)')
    && b.lines.length === 1 && b.lines[0] === '/gamemode <mode> [<targets>]'
    && c2.lines.length === 1 && c2.lines[0] === '/gamemode survival [<targets>]';
};
okAv(core(), 'unbroken core predicate holds');
const D = C.dispatcher, realGSU = D.getSmartUsage;
const breaks = {
  'bare names, no argument shape': (n, s) => realGSU.call(D, n, s).map((e) => ({ ...e, text: e.text.split(' ')[0] })),
  'every branch enumerated (extra lines)': (n, s) => { const r = realGSU.call(D, n, s); return r.concat(r); },
  'brackets/pipes stripped': (n, s) => realGSU.call(D, n, s).map((e) => ({ ...e, text: e.text.replace(/[\[\]()|]/g, ' ') })),
  'ignores the parsed node (always root)': (n, s) => realGSU.call(D, D.root, s),
};
let caught = 0;
for (const [name, fn] of Object.entries(breaks)) {
  D.getSmartUsage = fn;
  let held; try { held = core(); } catch (e) { held = false; }
  D.getSmartUsage = realGSU;
  if (!held) caught++; else fails.push('deliberate break NOT caught: ' + name);
}
console.log(`helpusagecheck: ${caught} of ${Object.keys(breaks).length} breaks caught`);
console.log(`\n${pass} ok, ${caught} anti-vacuity breaks caught, ${fails.length} failed`);
if (fails.length) { for (const f of fails) console.log('  ✗ ' + f); process.exit(1); }
