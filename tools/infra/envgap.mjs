// tools/infra/envgap.mjs - 21 Oct (Dan: "there should never be an infrastructure/environment gap again in this project's history").
// FINDING (all 26 partial hand-offs of 48 h read): 8 issues caused 18 of them. A worker hits a gap in ITS workspace - no real-server harness (#8760),
// 8 chicken .ogg objects absent from .mcsnd/objects (#832), a cited decision note not in the workspace (#6964), an issue that presupposes files that never
// landed (#1053) - writes it in the hand-off, and the next free slot hands the SAME issue to a fresh worker who finds it again. A gap is not a worker problem
// and not a reason to skip: it becomes ONE top-priority `env-gap` infra issue to provision it, the dependent issue is held until it closes, and the
// commander is told once. Pure helpers; envgapcheck drives them, launch.mjs / go.mjs call them.
export const KINDS = {
  data: { label: 'needs-data', re: /(absent from|missing from|not present in|not in) [^.]{0,60}(\.mcsnd|\.mcdata|\.decomp|objects|golden|jars|assets)|\.ogg objects? (are |is )?(still )?absent|golden[^.]{0,40}(lacks|missing|not generated)|0 tables|stage [^.]{0,40}over the file bridge/i },
  server: { label: 'needs-java', re: /(needs|needs a|no|without a) real[- ]server (harness|classes|scene)|no server classes|server harness|cannot build[^.]{0,40}(server|harness)|player-hunger scene|SeedAgent[^.]{0,40}(first|owed)/i },
  doc: { label: 'needs-commander', re: /(decision|note|doc)[^.]{0,80}(is )?not in this workspace|cited[^.]{0,60}(missing|absent|not in)/i },
  premise: { label: 'needs-commander', re: /(claim|claimed|hand-offs? claim)[^.]{0,80}(never|not) landed|none of it landed|neither [^.]{0,60}exists? on master|not a vanilla (entity )?id|(stage|check) [^.]{0,30}(does not|doesn't) exist on master/i },
};
/** hand-off / run-result text -> {kind, label, what} | null. First match wins; `what` is the matching sentence (<= 240 chars). */
export function classifyBlocker(text) {
  const t = String(text || '').replace(/\s+/g, ' ');
  for (const [kind, k] of Object.entries(KINDS)) { const m = k.re.exec(t); if (m) {
    const s = t.slice(0, m.index).lastIndexOf('. ') + 1; const e = t.indexOf('. ', m.index); return { kind, label: k.label, what: t.slice(s, e < 0 ? undefined : e + 1).trim().slice(0, 240) }; } }
  return null;
}
export const gapTitle = (kind, issue) => `ENV GAP (${kind}): workers cannot do #${issue} until this is provisioned`;
/** One gap issue per (kind, issue): open one with the same title is reused. issues = [{number,title,state}] -> {op:'create'}|{op:'reuse', number} */
export function planGap({ kind, issue, issues }) {
  const t = gapTitle(kind, issue); const o = (issues || []).find((i) => i.title === t && i.state === 'open');
  return o ? { op: 'reuse', number: o.number } : { op: 'create', title: t };
}
/** #10681: the hold outlives its gap (needs-java hid #9446 from every brain worker 22-30 Oct). all = issues of state all labelled env-gap: [{number,title,state,labels:[{name}]}].
 *  A held issue (open, labelled env-gap, not itself a gap) whose gap issues are all closed (at least one) loses env-gap and the gap-added needs-data/needs-java. -> [{issue, gaps, remove}] */
export function planClear({ all }) {
  const re = /^ENV GAP \((\w+)\): workers cannot do #(\d+) /; const out = [];
  for (const h of (all || [])) {
    if (h.state !== 'open' || re.test(h.title)) continue;
    const names = (h.labels || []).map((l) => l.name); if (!names.includes('env-gap')) continue;
    const gaps = all.filter((g) => { const m = re.exec(g.title); return m && Number(m[2]) === h.number; });
    if (!gaps.length || gaps.some((g) => g.state === 'open')) continue;
    const gone = new Set(['env-gap']); for (const g of gaps) { const k = KINDS[re.exec(g.title)[1]]; if (k && /^needs-(data|java)$/.test(k.label)) gone.add(k.label); }
    out.push({ issue: h.number, gaps: gaps.map((g) => g.number), remove: [...gone].filter((n) => names.includes(n)) });
  }
  return out;
}
export const gapBody = ({ kind, issue, what, handoffRun }) => `A worker run on #${issue} ended because its WORKSPACE lacks something (kind: ${kind}). Dan, 21 Oct: no environment gap is allowed to exist in this project. This is the issue that PROVISIONS it; #${issue} is held (labels env-gap + blocked) until this closes.\n\nWhat the worker wrote: ${what}\n${handoffRun ? `(run ${handoffRun})\n` : ''}\nProvision it for EVERY worker workspace (the data/harness/doc must arrive through go.mjs prep / bootstrap / the store, never by hand over the file bridge), add it to MANIFEST in tools/infra/envgap.mjs so envgapcheck fails if it ever disappears, then remove \`env-gap\`+\`blocked\` from #${issue}.`;
/** Files this text says exist / landed: tools/**, src/**, docs/** paths with an extension. */
export function claimedPaths(text) {
  return [...new Set([...String(text || '').matchAll(/\b((?:tools|src|docs|golden)\/[\w./-]+\.(?:mjs|js|json|md|tsv|java))\b/g)].map((m) => m[1]))];
}
/** Claimed paths that do not exist: exists(path) -> bool. */
export const unverifiedClaims = (text, exists) => claimedPaths(text).filter((p) => !exists(p));
/** What every worker workspace must hold. Grow it whenever a gap issue closes. */
export const MANIFEST = [
  { path: '.decomp', why: 'vanilla source: every port and parity fact comes from it (RUN.md)' },
  { path: 'tools/stages.d', why: 'stage files: the check registry' },
  { path: 'docs/decisions', why: 'decision notes that issues cite' },
  // #9518: referee goldens (store branch golden/, copied into the referee dir by go.mjs prep): without them these checks SKIP and exit 0
  { path: 'golden/furnace-timing.json', golden: true, why: 'furnacerefcheck golden' },
  { path: 'golden/growth-timing.json', golden: true, why: 'growthrefcheck golden' },
  { path: 'golden/hopper-timing.json', golden: true, why: 'hopperrefcheck golden' },
  // #9541: the seven goldens whose refchecks now hard-fail (MCLITE_REQUIRE_REFEREE) when missing (#7704); floor/enderman are withheld until regenerated clean
  { path: 'golden/block-drops.json', golden: true, why: 'blockrefdropcheck golden' },
  { path: 'golden/button-timing.json', golden: true, why: 'buttonrefcheck golden' },
  { path: 'golden/comparator-readout.json', golden: true, why: 'cmprefcheck golden' },
  { path: 'golden/column-growth.json', golden: true, why: 'columnrefcheck golden' },
  { path: 'golden/dispense-timing.json', golden: true, why: 'dispenserefcheck golden' },
  { path: 'golden/enchanting.json', golden: true, why: 'enchrefcheck golden' },
  { path: 'golden/fluid-timing.json', golden: true, why: 'fluidrefcheck golden' },
  // #9758: entity-motion golden must hold every motionscen scenario (46 were missing; regenerate with tools/referee/runmotion.mjs)
  { path: 'golden/entity-motion.json', golden: true, why: 'motionrefcheck golden' },
  // #10850: spawn-time equipment-drop golden (runequipdrop.mjs --add, chunked); without it mobdropsproofcheck SKIPs (exit 1 on CI)
  { path: 'golden/equip-drop.json', golden: true, why: 'mobdropsproofcheck equipment-drop golden' },
  // #9508: real-server harness for #9446 (tracked in git, so every clone has it)
  { path: 'tools/referee/lockstep/soakcapture.mjs', why: 'real-server 12-mob soak capture harness (#9446)' },
];
export function preflight(has) { return MANIFEST.filter((m) => !has(m.path)); }
