// #7769: every log / bus writer passes its text through redact() so a token never reaches disk or the bus.
// The patterns live here once; tools/secretscan.mjs reuses them to find what redact would have hidden.
export const PATTERNS = [
  ['github-token', /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})/g],
  ['api-key', /\bsk-[A-Za-z0-9_-]{20,}/g],
  ['private-key', /-----BEGIN [A-Z ]*PRIVATE KEY-----(?:[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----)?/g],
  ['token-url', /x-access-token:(?![$<{%(])[A-Za-z0-9_-]{20,}@/g],
];
export const redact = (s) => PATTERNS.reduce((t, [k, re]) => t.replace(re, `[REDACTED:${k}]`), String(s ?? ''));
