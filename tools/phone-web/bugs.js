// bugs.js - #7808 the Bugs tab: every open issue as a priority feed with a derived state chip. ONE GraphQL request per refresh, cached 60 s.
// model() is pure (the check drives it); load()/render() touch the network and the DOM.
const Bugs = (() => {
  const Q = 'query($o:String!,$n:String!){repository(owner:$o,name:$n){'
    + 'open:issues(states:OPEN,first:100,orderBy:{field:CREATED_AT,direction:ASC}){nodes{number title body createdAt updatedAt state labels(first:20){nodes{name}} milestone{title number} assignees(first:1){nodes{login}} comments(last:1){totalCount nodes{body}}}}'
    + ' closed:issues(states:CLOSED,first:30,orderBy:{field:UPDATED_AT,direction:DESC}){nodes{number title body createdAt updatedAt closedAt state labels(first:20){nodes{name}} milestone{title number} comments(last:1){totalCount nodes{body}}}}'
    + ' pullRequests(states:OPEN,first:50){nodes{number title headRefName labels(first:10){nodes{name}} commits(last:1){nodes{commit{statusCheckRollup{state}}}}}}'
    + ' refs(refPrefix:"refs/heads/work/",first:100){nodes{name target{... on Commit{committedDate}}}}}'
    + ' rateLimit{remaining}}';
  const names = (x) => ((x && x.nodes) || []).map((l) => l.name);
  /** "Depends on: #7807, #12" in the body -> [7807, 12] */
  const deps = (body) => { const m = /Depends on:?\s*([^\n]*)/i.exec(body || ''); return m ? [...m[1].matchAll(/#(\d+)/g)].map((x) => +x[1]) : []; };
  /** raw GraphQL repository -> rows. now = ms. Landed = closed in the last 24 h. */
  function model(repo, now) {
    const open = repo.open.nodes, openN = new Set(open.map((i) => i.number));
    const prBy = new Map(); for (const p of repo.pullRequests.nodes) if (names(p.labels).includes('land')) { const m = /^work\/(\d+)-/.exec(p.headRefName); if (m) prBy.set(+m[1], p); }
    const held = new Map(); for (const r of repo.refs.nodes) { const m = /^(\d+)-/.exec(r.name); if (m) held.set(+m[1], r); }
    const row = (i, state, extra) => ({ n: i.number, title: i.title, state, labels: names(i.labels), milestone: i.milestone ? i.milestone.title : '', msNum: i.milestone ? i.milestone.number : 9e9, created: Date.parse(i.createdAt), updated: Date.parse(i.updatedAt), comments: i.comments.totalCount, body: i.body || '', last: (i.comments.nodes[0] || {}).body || '', worker: '', mins: null, pr: null, ...extra });
    const rows = open.map((i) => {
      const lb = names(i.labels), pr = prBy.get(i.number), h = held.get(i.number), d = deps(i.body).filter((x) => openN.has(x));
      let state = 'waiting', extra = {};
      if (pr) { state = 'review'; extra.pr = { n: pr.number, check: ((((pr.commits.nodes[0] || {}).commit || {}).statusCheckRollup) || {}).state || 'NONE' }; }
      else if (lb.includes('blocked') || d.length) state = 'blocked';
      else if (h) state = 'working';
      if (h) { extra.worker = h.name.replace(/^\d+-/, '').slice(0, 24); extra.mins = Math.max(0, Math.round((now - Date.parse(h.target.committedDate)) / 60000)); }
      if (d.length) extra.blockedBy = d;
      return row(i, state, extra);
    });
    for (const i of repo.closed.nodes) if (i.closedAt && now - Date.parse(i.closedAt) < 864e5) { const t = /(?:^|\n)\s*try:?\s*(.+)/i.exec((i.comments.nodes[0] || {}).body || ''); rows.push(row(i, 'landed', { tryLine: t ? t[1].slice(0, 200) : '' })); }
    const ord = { landed: 1, open: 0 };
    rows.sort((a, b) => (ord[a.state] || 0) - (ord[b.state] || 0) || (b.labels.includes('dan') - a.labels.includes('dan')) || (b.labels.includes('severe') - a.labels.includes('severe')) || a.msNum - b.msNum || a.created - b.created);
    return rows;
  }
  const plainText = (md) => String(md || '').replace(/```[\s\S]*?```/g, ' ').replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/[#*_`>~|]/g, '').replace(/\s+/g, ' ').trim();
  const age = (ms, now) => { const m = Math.max(0, Math.round((now - ms) / 60000)); return m < 60 ? m + ' min' : m < 2880 ? Math.round(m / 60) + ' h' : Math.round(m / 1440) + ' d'; };
  /** filter by state chip / dan / severe / search text or number */
  function filter(rows, f) {
    const q = (f.q || '').trim().toLowerCase().replace(/^#/, '');
    return rows.filter((r) => (!f.state || r.state === f.state) && (!f.dan || r.labels.includes('dan')) && (!f.severe || r.labels.includes('severe')) && (!q || String(r.n) === q || (r.title + ' ' + r.body).toLowerCase().includes(q)));
  }
  const counts = (rows) => { const c = { working: 0, review: 0, blocked: 0, waiting: 0, landed: 0, dan: 0, severe: 0 }; for (const r of rows) { c[r.state]++; if (r.labels.includes('dan') && r.state !== 'landed') c.dan++; if (r.labels.includes('severe') && r.state !== 'landed') c.severe++; } return c; };
  const CHUNK = 40, TTL = 60000;
  const S = { rows: null, at: 0, err: null, f: {}, shown: CHUNK, reqs: 0, low: false };
  /** at most ONE request; skipped inside the 60 s cache; backs off when the token has < 300 left */
  async function load(post, now = Date.now(), force) {
    if (!force && S.rows && now - S.at < TTL) return S.rows;
    if (S.low && now - S.at < 600000) return S.rows;
    const [o, n] = REPO.split('/'); S.reqs++;
    const r = await post('/graphql', { query: Q, variables: { o, n } });
    if (r.errors && !r.data) throw new Error('GitHub 500 on graphql');
    S.low = !!(r.data.rateLimit && r.data.rateLimit.remaining < 300);
    S.rows = model(r.data.repository, now); S.at = now; Tabs.counts.bugs = S.rows.filter((x) => x.state !== 'landed' && x.labels.includes('dan')).length; return S.rows;
  }
  const CH = [['working', 'Working'], ['review', 'In review'], ['blocked', 'Blocked'], ['waiting', 'Waiting'], ['landed', 'Landed']];
  const rowHtml = (r, now) => `<a class="bug-row" href="#/bugs" data-n="${r.n}"><span class="bug-n">#${r.n}</span><b>${UI.E(r.title)}</b><span class="bug-meta">${UI.Chip(r.state, r.state === 'working' && r.mins != null ? `Working · ${r.mins} min` : (CH.find((c) => c[0] === r.state) || [0, r.state])[1])}${r.labels.includes('dan') ? UI.Chip('red', 'dan') : ''}${r.labels.includes('severe') ? UI.Chip('red', 'severe') : ''}<small>${UI.E(r.milestone.replace(/^(\S+).*/, '$1'))} · ${age(r.created, now)}${r.worker ? ' · ' + UI.E(r.worker) : ''}</small></span></a>`;
  /** header (fixed height, so counts changing never moves the list) + the first `shown` rows */
  function html(rows, now) {
    const c = counts(rows), f = S.f, list = filter(rows, f);
    const chip = (k, t, n, on) => `<button class="bug-f${on ? ' on' : ''}" data-f="${k}">${UI.E(t)} <b>${n}</b></button>`;
    return `<div class="bug-head">${CH.map(([k, t]) => chip(k, t, c[k], f.state === k)).join('')}${chip('dan', 'Mine', c.dan, f.dan)}${chip('severe', 'Severe', c.severe, f.severe)}</div><input id="bq" class="bug-q" type="search" placeholder="Number or words" value="${UI.E(f.q || '')}"><div id="bl">${list.slice(0, S.shown).map((r) => rowHtml(r, now)).join('') || UI.EmptyState('No issue matches.')}</div>${list.length > S.shown ? `<button class="alt" data-f="more">Show ${Math.min(CHUNK, list.length - S.shown)} more (${list.length - S.shown} left)</button>` : ''}${S.low ? '<p class="sub">GitHub limit nearly used up, refreshing slowly.</p>' : ''}`;
  }
  function sheet(r, now) {
    const pr = r.pr ? `<p>PR #${r.pr.n}: checks ${UI.E(r.pr.check.toLowerCase())}</p>` : '';
    const url = `https://github.com/${REPO}/issues/${r.n}`;
    return `<h2>#${r.n} ${UI.E(r.title)}</h2><p>${UI.Chip(r.state, r.state)} ${UI.E(r.milestone)} · ${age(r.created, now)} · ${r.comments} comments</p>${r.blockedBy ? `<p>Waiting for ${r.blockedBy.map((x) => '#' + x).join(', ')}</p>` : ''}${pr}<p>${UI.E(plainText(r.body).slice(0, 500))}</p>${r.last ? `<p><b>Latest comment</b><br>${UI.E(plainText(r.last).slice(0, 400))}</p>` : ''}${r.tryLine ? `<p><b>Try</b> ${UI.E(r.tryLine)}</p>` : ''}<a class="alt" href="${url}" target="_blank" rel="noopener">Open on GitHub</a>`;
  }
  /** the screen: paints cached rows at once, keeps the scroll position across a refresh */
  async function show(root, post) {
    const draw = () => { const y = scrollY; root(`<div id="bugs">${S.err ? UI.ErrorState(S.err) : S.rows ? html(S.rows, Date.now()) : UI.Skeleton(6)}</div>`); scrollTo(0, y); wire(); };
    const wire = () => {
      const b = document.getElementById('bugs'); if (!b) return;
      b.onclick = (e) => { const el = e.target.closest('[data-f],[data-n],[data-act]'); if (!el) return; e.preventDefault();
        if (el.dataset.act) { S.err = null; return go(true); }
        if (el.dataset.n) return UI.BottomSheet(sheet(S.rows.find((r) => r.n === +el.dataset.n), Date.now()));
        const k = el.dataset.f; if (k === 'more') S.shown += CHUNK; else { S.shown = CHUNK; if (k === 'dan' || k === 'severe') S.f[k] = !S.f[k]; else S.f.state = S.f.state === k ? '' : k; } draw(); };
      const q = document.getElementById('bq'); if (q) q.oninput = () => { S.f.q = q.value; S.shown = CHUNK; const y = scrollY; const pos = q.selectionStart; draw(); const n = document.getElementById('bq'); n.focus(); n.setSelectionRange(pos, pos); scrollTo(0, y); };
    };
    const go = async (force) => { try { await load(post, Date.now(), force); S.err = null; } catch (e) { S.err = e; } draw(); };
    draw(); await go(false);
  }
  return { Q, model, deps, filter, counts, plainText, age, load, show, html, S };
})();
if (typeof module !== 'undefined') module.exports = Bugs;
