#!/usr/bin/env node
// ponytailcheck.mjs - #1852: the ponytail plugin (github.com/DietrichGebert/ponytail) is loaded by every session:
// declared in .claude/settings.json, installed by launch.mjs before each brain run (best-effort), mode from roles.json.
//   node tools/ponytailcheck.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ensurePlugins, ponytailMode, PLUGINS, pluginState, readPluginState } from './brain/plugins.mjs';
const rd = (f) => readFileSync(fileURLToPath(new URL('../' + f, import.meta.url)), 'utf8');
let asserts = 0, fails = 0, breaks = 0;
const ok = (c, m) => { asserts++; if (!c) { fails++; console.log('  FAIL ' + m); } };
const SRC = { settings: rd('.claude/settings.json'), launch: rd('tools/brain/launch.mjs'), roles: rd('tools/brain/roles.json') };
function verdicts(S) {
  const bad = [];
  try { const s = JSON.parse(S.settings);
    if (!(s.extraKnownMarketplaces && s.extraKnownMarketplaces.ponytail && s.extraKnownMarketplaces.ponytail.source.repo === 'DietrichGebert/ponytail')) bad.push('settings.json does not declare the ponytail marketplace');
    if (!(s.enabledPlugins && s.enabledPlugins['ponytail@ponytail'] === true)) bad.push('settings.json does not enable ponytail@ponytail');
  } catch { bad.push('settings.json is not valid JSON'); }
  if (!/ensurePlugins\(\)/.test(S.launch) || S.launch.indexOf('ensurePlugins()') > S.launch.indexOf("spawn('claude', args")) bad.push('launch.mjs does not ensure the plugin BEFORE it starts claude');
  if (!/env\.PONYTAIL_DEFAULT_MODE = ponytailMode\(CFG\)/.test(S.launch)) bad.push('launch.mjs does not pass PONYTAIL_DEFAULT_MODE');
  if (!/const plugs = readPluginState\(/.test(S.launch) || !/plugins \$\{plugs\}\]/.test(S.launch)) bad.push('#1930: the run line does not say which plugins the run had');
  try { if (!['lite', 'full', 'ultra', 'off'].includes(ponytailMode(JSON.parse(S.roles)))) bad.push('roles.json plugins.ponytail.mode is not lite|full|ultra|off'); } catch { bad.push('roles.json is not valid JSON'); }
  return bad;
}
const real = verdicts(SRC); for (const b of real) ok(false, b); ok(true, 'verdicts ran');
// ensurePlugins: installs once, is idempotent, never throws
const calls = []; let listing = '';
const run = (a) => { calls.push(a.join(' ')); return a[1] === 'list' ? { status: 0, stdout: listing } : { status: 0, stdout: '' }; };
let did = ensurePlugins(run, PLUGINS);
ok(did.join() === 'ponytail@ponytail' && calls.includes('plugin marketplace add DietrichGebert/ponytail') && calls.includes('plugin install ponytail@ponytail'), 'a missing plugin is marketplace-added then installed: ' + calls.join(' | '));
calls.length = 0; listing = 'ponytail@ponytail  enabled'; did = ensurePlugins(run, PLUGINS);
ok(did.length === 0 && calls.length === 1, 'an installed plugin is left alone (one list call): ' + calls.join(' | '));
ok((() => { try { return ensurePlugins(() => { throw new Error('claude missing'); }, PLUGINS).length === 0; } catch { return false; } })(), 'a failing claude CLI never throws out of ensurePlugins');
ok(ponytailMode({}) === 'lite' && ponytailMode({ plugins: { ponytail: { mode: 'ultra' } } }) === 'ultra', 'mode defaults to lite and follows roles.json');
// #1930: pluginState - what the run really had, for its bus line (parser cases run on the real one and on broken ones)
function stateCases(fn) {
  const bad = [], t = (n, c) => { let r = false; try { r = !!c(); } catch { r = false; } if (!r) bad.push(n); };
  t('installed + enabled -> the mode', () => fn('Installed plugins:\n  ponytail@ponytail  Version 1.0  Status: enabled', 'lite') === 'ponytail=lite');
  t('the mode is the configured one', () => fn('ponytail@ponytail enabled', 'ultra') === 'ponytail=ultra');
  t('absent -> MISSING', () => fn('Installed plugins:\n  other@x enabled', 'lite') === 'ponytail=MISSING');
  t('empty listing -> MISSING', () => fn('', 'lite') === 'ponytail=MISSING');
  t('listed but disabled -> DISABLED', () => fn('ponytail@ponytail  Status: disabled', 'lite') === 'ponytail=DISABLED');
  return bad;
}
{ const b = stateCases(pluginState); ok(!b.length, 'pluginState failed: ' + b.join('; ')); }
ok(readPluginState('lite', () => { throw new Error('no cli'); }) === 'ponytail=UNKNOWN', 'an unreadable CLI is reported UNKNOWN, never hidden');
for (const [n, fn] of [['always present', (l, m) => 'ponytail=' + (m || 'lite')], ['mode dropped', (l, m) => pluginState(l, 'lite')], ['ignores disabled', (l, m) => pluginState(String(l).replace(/disabled/gi, 'enabled'), m)]]) {
  const c = stateCases(fn).length > 0; ok(c, `pluginState break NOT caught: ${n}`); if (c) { breaks++; console.log(`  ✓ break caught: pluginState ${n}`); }
}
// anti-vacuity
const BREAKS = [
  ['marketplace not declared', (S) => ({ ...S, settings: S.settings.replace('"DietrichGebert/ponytail"', '"x/y"') })],
  ['plugin not enabled', (S) => ({ ...S, settings: S.settings.replace('"ponytail@ponytail": true', '"ponytail@ponytail": false') })],
  ['no ensure before spawn', (S) => ({ ...S, launch: S.launch.replace('ensurePlugins()', 'void 0') })],
  ['mode env dropped', (S) => ({ ...S, launch: S.launch.replace('env.PONYTAIL_DEFAULT_MODE = ponytailMode(CFG)', 'void 0') })],
  ['run line drops the plugin state', (S) => ({ ...S, launch: S.launch.replace('plugins ${plugs}]', ']') })],
  ['bad mode', (S) => ({ ...S, roles: S.roles.replace('"mode": "off"', '"mode": "loud"') })],
];
for (const [n, br] of BREAKS) { const m = br(SRC); const c = JSON.stringify(m) !== JSON.stringify(SRC) && verdicts(m).length > 0; ok(c, `break NOT caught: ${n}`); if (c) { breaks++; console.log(`  ✓ break caught: ${n}`); } }
console.log(`ponytailcheck: ${asserts} assertions, ${fails} failures, ${breaks} breaks caught`);
process.exit(fails ? 1 : 0);
