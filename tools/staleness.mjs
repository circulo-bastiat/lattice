// tools/staleness.mjs - #8887: every derived figure carries its age; past its producer's period it says STALE.
// Producers: name -> expected period (min) and a reader returning the last-good time (ms) or null.
import { statSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
export const PERIODS = { metrics: 30, matrix: 120, usage: 15, 'tia map': 120 };   // matrix + tia map = one full-run period (2 h)
const mt = (f) => { try { return statSync(f).mtimeMs; } catch { return null; } };
export function lastGood(name, root, findUnder = () => null) {
  if (name === 'metrics') return mt(join(root, '_status', 'metrics.json'));
  if (name === 'matrix') return mt(join(root, 'tools', 'mobproof', 'matrix.json'));
  if (name === 'tia map') return mt(join(process.env.MCLITE_DATA || root, 'tia-map.json'));
  if (name === 'usage') { const f = findUnder(join('_status', 'usage.json')); try { return Date.parse(JSON.parse(readFileSync(f, 'utf8')).at) || mt(f); } catch { return null; } }
  return null;
}
const fmt = (m) => m < 120 ? `${m} min` : m < 2880 ? `${Math.round(m / 60)} h` : `${Math.round(m / 1440)} d`;
/** {name, ageMin|null, stale, period, line} - stale = past 1 period (status); dead = past 3 periods (the check). */
export function judge(name, last, now = Date.now()) {
  const period = PERIODS[name], age = last == null ? null : Math.max(0, Math.round((now - last) / 60e3));
  const stale = age == null || age > period, dead = age == null || age > 3 * period;
  const line = age == null ? `STALE ${name}: no output ever seen (producer expected every ${fmt(period)})`
    : stale ? `STALE ${name}: last good ${new Date(last).toISOString()} (${fmt(age)} ago, expected every ${fmt(period)})` : `${name}: ${fmt(age)} old`;
  return { name, age, stale, dead, period, line };
}
/** #9670: `over` = {name: ms} last-good times read from the producer's real output (the metrics branch, the MCLITE_USAGE variable), which beat this host's files */
export const all = (root, now = Date.now(), fu, over = {}) => Object.keys(PERIODS).map((n) => judge(n, over[n] != null ? over[n] : lastGood(n, root, fu), now));
