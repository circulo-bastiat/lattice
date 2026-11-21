// rolefail.mjs - #9739 part 2 (#9677: "a role run that records nothing should alarm"). The reviewer ended error_max_turns in 6 of 19 runs on 22 Oct and
// the only trace was a `launch FAILED` bus line nobody acts on. The health pass now reads the run logs (~/.brain/logs/<iso>-<role>.json, written by
// launch.mjs) and raises a finding `role-failing:<role>` when a role's recent runs mostly end in an error. Measured 22 Oct: worker 7/339 errors,
// commander/fixer/enlarger 0, reviewer 6/19.
import { readdirSync, openSync, readSync, closeSync, fstatSync } from 'node:fs';
import { join } from 'node:path';

/** runs = [{role, at, ok}]. A role is failing when it ran >= minRuns times in the window, at least share of them ended in an error, AND its newest run
 *  failed too (22 Oct 22:55Z: the reviewer was fixed at 22:34 and ran ok, yet its 6 old failures kept the alert up for 12 h and woke a commander). Pure. */
export function roleFailures(runs, { minRuns = 3, share = 0.3 } = {}) {
  const by = {};
  for (const r of runs) (by[r.role] = by[r.role] || []).push(r);
  return Object.entries(by).map(([role, rs]) => ({ role, runs: rs.length, failed: rs.filter((r) => !r.ok).length, lastOk: [...rs].sort((a, b) => (a.at || 0) - (b.at || 0)).pop().ok }))
    .filter((x) => x.runs >= minRuns && x.failed / x.runs >= share && !x.lastOk).sort((a, b) => a.role.localeCompare(b.role));
}

/** A log's verdict from its last 3 KB: ok = a result with subtype success; a log with no result line (killed) counts as a failure. */
export const logOk = (tail) => { const s = [...String(tail).matchAll(/"subtype":"([a-z_]+)"/g)].pop(); return !!s && s[1] === 'success'; };

/** Read the run logs of the last `hours` from dir. Never throws. */
export function readRoleRuns(dir, now = Date.now(), hours = 12) {
  const out = [];
  let names = []; try { names = readdirSync(dir); } catch { return out; }
  for (const n of names) {
    const m = /^(\d{4}-\d\d-\d\dT\d\d)-(\d\d)-(\d\d)-(\d{3})Z-([a-z]+)\.json$/.exec(n); if (!m) continue;
    const at = Date.parse(`${m[1]}:${m[2]}:${m[3]}.${m[4]}Z`); if (!(now - at < hours * 3600e3) || now - at < 5 * 60e3) continue;   // a run younger than 5 min may still be writing
    try { const fd = openSync(join(dir, n), 'r'); const size = fstatSync(fd).size, len = Math.min(3072, size), b = Buffer.alloc(len); readSync(fd, b, 0, len, size - len); closeSync(fd);
      out.push({ role: m[5], at, ok: logOk(b.toString('utf8')) }); } catch { /* unreadable: skip */ }
  }
  return out;
}
