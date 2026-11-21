// tools/infra/ghexpr.mjs - #8980: a small evaluator for GitHub Actions `if:` expressions, so a check can RUN a workflow condition on sample events
// instead of grepping its text (19 Oct: brain.yml's route `if:` skipped every `from: brain` mail for 24 h and the grep checks stayed green).
// Supports what the workflows use: string/number/true/false/null literals, ( ), !, ==, !=, &&, ||, contains(), startsWith(), endsWith(), and context
// paths (github.event.comment.body, github.event.issue.labels.*.name, vars.X, needs.route.outputs.role). Semantics follow GitHub: comparison and
// contains/startsWith ignore case, && and || return an operand, missing paths are null, and null / '' / 0 / false are falsy.
const lower = (v) => (typeof v === 'string' ? v.toLowerCase() : v);
export const truthy = (v) => !(v === null || v === undefined || v === false || v === 0 || v === '');
const norm = (v) => (v === undefined ? null : v);
function looseEq(a, b) {
  a = norm(a); b = norm(b);
  if (a === null && b === null) return true;
  if (typeof a === 'string' && typeof b === 'string') return lower(a) === lower(b);
  if (a === null) return b === '' || b === 0 || b === false;
  if (b === null) return a === '' || a === 0 || a === false;
  const n = (x) => (typeof x === 'number' ? x : typeof x === 'boolean' ? Number(x) : x === '' ? 0 : Number(x));
  return n(a) === n(b);
}
export function tokenize(src) {
  const out = []; let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }
    if (c === "'") { let j = i + 1, s = ''; for (;;) { if (j >= src.length) throw new Error('unterminated string'); if (src[j] === "'") { if (src[j + 1] === "'") { s += "'"; j += 2; continue; } break; } s += src[j++]; } out.push({ t: 'str', v: s }); i = j + 1; continue; }
    if (/[0-9]/.test(c)) { const m = /^[0-9]+(\.[0-9]+)?/.exec(src.slice(i)); out.push({ t: 'num', v: Number(m[0]) }); i += m[0].length; continue; }
    if (src.startsWith('&&', i) || src.startsWith('||', i) || src.startsWith('==', i) || src.startsWith('!=', i)) { out.push({ t: 'op', v: src.slice(i, i + 2) }); i += 2; continue; }
    if ('()!,'.includes(c)) { out.push({ t: 'op', v: c }); i++; continue; }
    const m = /^[A-Za-z_][A-Za-z0-9_\-]*(?:\.(?:\*|[A-Za-z_][A-Za-z0-9_\-]*|\[[^\]]*\]))*/.exec(src.slice(i));
    if (!m) throw new Error(`unexpected character ${JSON.stringify(c)} at ${i}`);
    out.push({ t: 'id', v: m[0] }); i += m[0].length;
  }
  return out;
}
function lookup(path, ctx) {
  const parts = path.split('.'); let cur = [ctx], star = false;
  for (const p of parts) {
    const next = [];
    for (const o of cur) {
      if (p === '*') { if (Array.isArray(o)) next.push(...o); else if (o && typeof o === 'object') next.push(...Object.values(o)); }
      else if (o !== null && typeof o === 'object' && Object.prototype.hasOwnProperty.call(o, p)) next.push(o[p]);
      else if (o !== null && typeof o === 'object') { const k = Object.keys(o).find((x) => x.toLowerCase() === p.toLowerCase()); if (k !== undefined) next.push(o[k]); }
    }
    if (p === '*') star = true;
    cur = next; if (!cur.length) return star ? [] : null;
  }
  return star ? cur : (cur.length ? cur[0] : null);
}
const FUNCS = {
  contains: (a, b) => { if (Array.isArray(a)) return a.some((x) => looseEq(x, b)); return typeof a === 'string' && typeof b === 'string' ? lower(a).includes(lower(b)) : typeof a === 'string' && b !== null ? lower(a).includes(lower(String(b))) : false; },
  startsWith: (a, b) => typeof a === 'string' && typeof b === 'string' && lower(a).startsWith(lower(b)),
  endsWith: (a, b) => typeof a === 'string' && typeof b === 'string' && lower(a).endsWith(lower(b)),
};
/** evaluate an `if:` expression (with or without ${{ }}) against a context { github: {event_name, event: {...}}, vars: {}, needs: {} } */
export function evaluate(expr, ctx) {
  const src = String(expr).trim().replace(/^\$\{\{\s*/, '').replace(/\s*\}\}$/, '');
  const toks = tokenize(src); let k = 0;
  const peek = () => toks[k], isOp = (v) => peek() && peek().t === 'op' && peek().v === v;
  function primary() {
    const t = toks[k++]; if (!t) throw new Error('unexpected end of expression');
    if (t.t === 'str' || t.t === 'num') return t.v;
    if (t.t === 'op' && t.v === '(') { const v = or(); if (!isOp(')')) throw new Error('missing )'); k++; return v; }
    if (t.t === 'op' && t.v === '!') return !truthy(primary());
    if (t.t === 'id') {
      if (t.v === 'true') return true; if (t.v === 'false') return false; if (t.v === 'null') return null;
      if (isOp('(')) { k++; const args = []; if (!isOp(')')) for (;;) { args.push(or()); if (isOp(',')) { k++; continue; } break; } if (!isOp(')')) throw new Error('missing ) after arguments'); k++;
        const f = FUNCS[t.v]; if (!f) throw new Error(`unknown function ${t.v}`); return f(...args.map(norm)); }
      return lookup(t.v, ctx);
    }
    throw new Error(`unexpected token ${t.v}`);
  }
  function unary() { if (isOp('!')) { k++; return !truthy(unary()); } return primary(); }
  function eq() { let a = unary(); while (isOp('==') || isOp('!=')) { const o = toks[k++].v; const b = unary(); a = o === '==' ? looseEq(a, b) : !looseEq(a, b); } return a; }
  function and() { let a = eq(); while (isOp('&&')) { k++; const b = eq(); a = truthy(a) ? b : a; } return a; }
  function or() { let a = and(); while (isOp('||')) { k++; const b = and(); a = truthy(a) ? a : b; } return a; }
  const v = or(); if (k < toks.length) throw new Error(`unexpected ${toks[k].v}`);
  return v;
}
