// tools/brain/plugins.mjs - #1852: plugins every brain session loads (Dan, 3 Oct: ponytail, github.com/DietrichGebert/ponytail).
// ensurePlugins(run): best-effort and idempotent, called by launch.mjs before `claude -p`; it NEVER fails the launch.
// The same plugin is also declared in .claude/settings.json (extraKnownMarketplaces + enabledPlugins) for every other
// session in a clone of this repo; this step is for the brain's headless user, whose workspace may not be trusted.
import { spawnSync } from 'node:child_process';
export const PLUGINS = [{ id: 'ponytail@ponytail', name: 'ponytail', marketplace: 'DietrichGebert/ponytail' }];
const real = (args) => spawnSync('claude', args, { encoding: 'utf8', timeout: 60000 });
/** run(args) -> {status, stdout}; returns the plugin ids it had to install (log only). */
export function ensurePlugins(run = real, plugins = PLUGINS) {
  const did = [];
  try {
    const have = String((run(['plugin', 'list']) || {}).stdout || '');
    for (const p of plugins) {
      if (have.includes(p.id) || new RegExp(`\\b${p.name}\\b`).test(have)) continue;
      run(['plugin', 'marketplace', 'add', p.marketplace]);
      const r = run(['plugin', 'install', p.id]);
      if (r && r.status === 0) did.push(p.id);
    }
  } catch { /* never fail a launch for a plugin */ }
  return did;
}
/** the mode env for a session: roles.json plugins.ponytail.mode, default 'lite' (lite | full | ultra | off). */
export const ponytailMode = (cfg) => (((cfg || {}).plugins || {}).ponytail || {}).mode || 'lite';
/** #1930: what a run ACTUALLY had, for its bus line (the ponytail trial is judged run by run). `listing` is the output of
 *  `claude plugin list` after ensurePlugins: `ponytail=<mode>` when present (`ponytail=off` when the mode turns it off),
 *  `ponytail=DISABLED` when listed but disabled, `ponytail=MISSING` when absent. Pure. */
export function pluginState(listing, mode, plugins = PLUGINS) {
  const L = String(listing || '').split(/\r?\n/);
  return plugins.map((p) => {
    const row = L.find((l) => l.includes(p.id) || new RegExp(`\\b${p.name}\\b`).test(l));
    if (!row) return `${p.name}=MISSING`;
    if (/\bdisabled\b/i.test(row)) return `${p.name}=DISABLED`;
    return `${p.name}=${mode || 'lite'}`;
  }).join(' ');
}
/** the same, reading the CLI; never throws (an unreadable CLI is reported, not hidden). */
export function readPluginState(mode, run = real, plugins = PLUGINS) {
  try { return pluginState(String((run(['plugin', 'list']) || {}).stdout || ''), mode, plugins); } catch { return plugins.map((p) => `${p.name}=UNKNOWN`).join(' '); }
}
