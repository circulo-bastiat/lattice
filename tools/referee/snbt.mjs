// snbt.mjs — a small SNBT (stringified NBT) reader for the referee (infra I6, 24 Sept 2026).
//
// `/data get ...` answers "<prefix>: <snbt>". Splitting that text on "}, {" (runloot's shortcut) breaks
// as soon as a value holds a nested compound — villager trade offers carry enchantment lists, potion
// and colour tags. This parses the value properly: compounds -> objects, lists -> arrays, typed
// arrays [B;..]/[I;..]/[L;..] -> arrays, numbers with or without a b/s/l/f/d suffix -> JS numbers,
// quoted strings (both quote styles, backslash escapes) and bare words -> strings.
//
//   import { parseSnbt, snbtOfReply } from './snbt.mjs';
//   snbtOfReply('Storage mcliteref:t has the following contents: [{R: 1b}, ...]')  -> [...]

const NUM = /^[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?[bslfdBSLFD]?$/;

export function parseSnbt(text) {
  let i = 0;
  const s = text;
  const ws = () => { while (i < s.length && /\s/.test(s[i])) i++; };
  const fail = (m) => { throw new Error(`snbt: ${m} at ${i}: …${s.slice(Math.max(0, i - 30), i + 30)}…`); };
  function str() {
    const q = s[i++]; let out = '';
    while (i < s.length && s[i] !== q) {
      if (s[i] === '\\') { out += s[i + 1]; i += 2; } else out += s[i++];
    }
    if (s[i] !== q) fail('unterminated string');
    i++;
    return out;
  }
  function word() {
    const st = i;
    while (i < s.length && /[A-Za-z0-9_+\-.]/.test(s[i])) i++;
    if (st === i) fail('expected a value');
    return s.slice(st, i);
  }
  function scalar(w) {
    if (NUM.test(w)) return +w.replace(/[bslfdBSLFD]$/, '');
    if (w === 'true') return 1;
    if (w === 'false') return 0;
    return w;
  }
  function value() {
    ws();
    const c = s[i];
    if (c === '{') {
      i++; const o = {}; ws();
      if (s[i] === '}') { i++; return o; }
      for (;;) {
        ws();
        const k = (s[i] === '"' || s[i] === "'") ? str() : word();
        ws(); if (s[i] !== ':') fail('expected :'); i++;
        o[k] = value(); ws();
        if (s[i] === ',') { i++; continue; }
        if (s[i] === '}') { i++; return o; }
        fail('expected , or }');
      }
    }
    if (c === '[') {
      i++; ws();
      if (/[BIL]/.test(s[i]) && s[i + 1] === ';') i += 2;       // typed array header
      const a = []; ws();
      if (s[i] === ']') { i++; return a; }
      for (;;) {
        a.push(value()); ws();
        if (s[i] === ',') { i++; continue; }
        if (s[i] === ']') { i++; return a; }
        fail('expected , or ]');
      }
    }
    if (c === '"' || c === "'") return str();
    return scalar(word());
  }
  const v = value(); ws();
  if (i !== s.length) fail('trailing text');
  return v;
}

/** The value part of a `/data get` reply ("... has the following (entity|block|storage) data|contents: <snbt>"). */
export function snbtOfReply(reply) {
  const m = /(?:has the following (?:entity data|block data|contents)|data):\s*/.exec(reply);
  if (!m) throw new Error('snbt: not a data reply: ' + reply.slice(0, 120));
  return parseSnbt(reply.slice(m.index + m[0].length).trim());
}
