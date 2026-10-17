// verifierguard.mjs - #7766: the lander holds a PR that weakens the files deciding whether work passes (tools/protected.json).
// guard() is pure: files = [{path, before, after}] (null = absent). Returns {verifier, holds[]}; a hold names the rule.
// Additive edits (new stage file, new waiver/quarantine entry WITH an issue number, new core check) pass.
import { analyze } from '../vacuitycheck.mjs';
export const APPROVAL = /^\*\*Commander/;
const rx = (g) => new RegExp('^' + g.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*') + '$');
export const isProtected = (p, set) => set.files.includes(p) || set.globs.some((g) => rx(g).test(p));
const J = (t) => { try { return JSON.parse(t); } catch { return undefined; } };
const hasIssue = (v) => /#?\b\d{3,}\b/.test(typeof v === 'string' ? v : JSON.stringify(v));
const SKIPEXIT = (t) => /\bSKIP/.test(t) && /process\.exit\(\s*0\s*\)/.test(t);
const WEAK = [[/\|\|\s*true\b/, 'gains `|| true`'], [/\b(ok|assert)\s*\(\s*(true|1|!0)\s*[,)]/, 'gains a constant-true condition'], [/^\s*process\.exit\(\s*0\s*\)/m, 'gains an early process.exit(0)']];

function mapRule(path, b, a, holds, label) {   // object keyed by name: quarantine, hosted-unfit, waivers
  for (const k of Object.keys(b)) {
    if (!(k in a)) holds.push(`${path}: removes ${label} "${k}"`);
    else if (JSON.stringify(a[k]).length < JSON.stringify(b[k]).length) holds.push(`${path}: shortens the justification of "${k}"`);
    else if (b[k] && b[k].classes && a[k].classes && a[k].classes.some((c) => !b[k].classes.includes(c))) holds.push(`${path}: widens the waiver classes of "${k}"`);
  }
  for (const k of Object.keys(a)) if (!(k in b) && !hasIssue(a[k])) holds.push(`${path}: new ${label} "${k}" has no issue number`);
}

export function guard({ files, set, breakCounts = {} }) {
  const holds = [], verifier = [];
  for (const { path, before, after } of files) {
    if (path.startsWith('tools/') && /\.mjs$/.test(path) && after != null && before != null && !isProtected(path, set)) {
      const nb = analyze(before), na = analyze(after);
      for (const c of na) if (!nb.includes(c)) holds.push(`${path}: gains vacuity class ${c} (vacuitycheck)`);
      for (const [r, w] of WEAK) if (r.test(after) && !r.test(before)) holds.push(`${path}: ${w}`);
      if (SKIPEXIT(after) && !SKIPEXIT(before)) holds.push(`${path}: gains a SKIP-exit-0`);
      const bc = breakCounts[path]; if (bc && bc.after < bc.before) holds.push(`${path}: "breaks caught" falls ${bc.before} -> ${bc.after}`);
    }
    if (!isProtected(path, set)) continue;
    verifier.push(path);
    if (path === 'tools/protected.json') { holds.push('tools/protected.json: edits the protected set itself'); continue; }
    if (before == null) continue;                                                       // a new protected file (new stage) is additive
    if (after == null) { holds.push(`${path}: deleted${/stages\.d/.test(path) ? ' (a stage removed)' : ''}`); continue; }
    const jb = J(before), ja = J(after);
    if (/stages\.d\//.test(path) && jb && ja) {
      for (const e of jb) { const n = ja.find((x) => x.id === e.id); if (!n) holds.push(`${path}: removes stage "${e.id}"`); else if (JSON.stringify(n) !== JSON.stringify(e)) holds.push(`${path}: changes stage "${e.id}" (file/args/kind)`); }
    } else if (/core\.json$/.test(path) && jb && ja) {
      for (const c of jb.checks || []) if (!(ja.checks || []).includes(c)) holds.push(`${path}: removes core check "${c}"`);
    } else if (/vacuity-waivers\.json$/.test(path) && jb && ja) mapRule(path, jb.waivers || {}, ja.waivers || {}, holds, 'waiver');
    else if (/(quarantine|hosted-unfit)\.json$/.test(path) && jb && ja) mapRule(path, jb, ja, holds, 'entry');
    else if (/roles\.json$/.test(path)) {
      const pick = (t) => t.split('\n').filter((l) => new RegExp(set.roleKeys, 'i').test(l));
      if (pick(before).join('\n') !== pick(after).join('\n')) holds.push(`${path}: changes a quarantine/cap key`);
    } else if (before !== after) holds.push(`${path}: edits gate code/workflow (cannot be judged as additive)`);
  }
  return { verifier, holds };
}
