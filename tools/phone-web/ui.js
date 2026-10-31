// ui.js - #7807 components. Every data component takes a state ('loading' | 'empty' | 'error' | ready) so none can only show the happy path.
const UI = (() => {
  const E = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  /** the one meaning of each state colour; a chip class that is not here does not exist */
  const STATES = { working: 'blue', waiting: 'grey', review: 'purple', blocked: 'amber', landed: 'green', red: 'red' };
  const reduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const Card = (inner, attrs = '') => `<div class="ui-card" ${attrs}>${inner}</div>`;
  const Chip = (state, text) => `<span class="ui-chip ${STATES[state] ? state : ''}">${E(text)}</span>`;
  const StatBadge = (n, label) => `<span class="ui-stat"><b data-count="${E(n)}">${E(n)}</b><span>${E(label)}</span></span>`;
  const ProgressBar = (pct, target) => { const p = Math.max(0, Math.min(100, +pct || 0)); return `<div class="ui-bar" role="img" aria-label="${Math.round(p)} percent"><i style="width:${p}%"></i>${target != null ? `<u style="left:${Math.max(0, Math.min(100, +target))}%"></u>` : ''}</div>`; };
  const Ring = (pct) => { const p = Math.max(0, Math.min(100, +pct || 0)), c = 2 * Math.PI * 22; return `<svg class="ui-ring" viewBox="0 0 56 56" role="img" aria-label="${Math.round(p)} percent used"><circle cx="28" cy="28" r="22" fill="none" stroke="var(--surface2)" stroke-width="6"/><circle cx="28" cy="28" r="22" fill="none" stroke="var(--accent)" stroke-width="6" stroke-dasharray="${(c * p / 100).toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 28 28)"/><text x="28" y="33" text-anchor="middle">${Math.round(p)}</text></svg>`; };
  const Row = (title, sub, href) => `<a class="ui-row" href="${E(href || '#')}"><b>${E(title)}</b>${sub ? `<small>${E(sub)}</small>` : ''}</a>`;
  const Skeleton = (n = 3) => Array.from({ length: n }, () => '<div class="ui-skel"></div>').join('');
  const EmptyState = (reason, action) => `<div class="ui-empty"><p>${E(reason)}</p>${action ? `<button class="alt" data-act="${E(action.id)}">${E(action.label)}</button>` : ''}</div>`;
  /** plain English, never the raw "GitHub 403 on GET ..." */
  const plain = (e) => { const m = /GitHub (\d+)/.exec(String(e && e.message || e)); const c = m ? +m[1] : 0; return c === 401 || c === 403 ? 'GitHub did not accept the token, or its limit is used up. Check the token in Alerts & token.' : c === 404 ? 'That item was not found on GitHub.' : c >= 500 ? 'GitHub is having trouble right now.' : 'Could not reach GitHub. Check the connection.'; };
  /** #7810 plain words. Every jargon term the app shows has one sentence here and a "?" (Help) next to it. */
  const GLOSSARY = {
    lander: 'The robot that tests finished work and merges it into the game. Work waits in its queue until it has passed.',
    bus: 'The message board the workers and you use to talk to each other.',
    fill: 'How many workers the system keeps running at once. Pause it and no new ones start.',
    salts: 'Different random seeds used to compare the game against real Minecraft. More seeds means a stronger proof.',
    worker: 'One Claude session working on one issue.',
    pace: 'Where the weekly usage should be right now to end near 96 percent when it resets.',
  };
  const Help = (term) => `<button class="ui-help" data-help="${E(term)}" aria-label="What is ${E(term)}?">?</button>`;
  const explain = (term) => GLOSSARY[String(term).toLowerCase()] || '';
  /** the run outcome in words, from a parsed run (Runs.ended): landed / partial / already fixed / found nothing / gave up */
  function outcomeWord(r) {
    const t = String((r && r.text) || '').toLowerCase();
    if (!r || r.ok === false || /gave up|stuck|failed|error/.test(t)) return 'gave up';
    if (/already (fixed|done)/.test(t)) return 'already fixed';
    if (/partial|--part/.test(t)) return 'partial';
    if (/found nothing|no issue|nothing to do|no work/.test(t)) return 'found nothing';
    return 'landed';
  }
  /** what a destructive or costly button does, said before the second tap */
  const CONSEQUENCE = {
    pause: (n) => `Stops new workers from starting. ${n ? `The ${n} running keep going until their current step ends.` : 'Running ones finish their current step.'}`,
    commander: () => 'Starts one commander run. It uses usage from your weekly limit.',
    fixer: () => 'Starts one fixer run. It uses usage from your weekly limit.',
  };
  /** two-tap confirm for a button: first tap shows the consequence, second tap within 5 s runs fn */
  function twoTap(btn, text, fn) {
    let armed = null; const label = btn.textContent;
    btn.addEventListener('click', () => {
      if (armed) { clearTimeout(armed); armed = null; btn.textContent = label; btn.classList.remove('warn'); return fn(); }
      btn.textContent = text + ' Tap again to confirm.'; btn.classList.add('warn');
      armed = setTimeout(() => { armed = null; btn.textContent = label; btn.classList.remove('warn'); }, 5000);
    });
  }
  const ErrorState = (e, retryId = 'retry') => `<div class="ui-error"><p>${E(plain(e))}</p><button class="alt" data-act="${E(retryId)}">Retry</button></div>`;
  /** pick the right body for a data component */
  const Async = (st, ready, opts = {}) => st.loading ? Skeleton(opts.rows) : st.err ? ErrorState(st.err, opts.retry) : st.empty ? EmptyState(opts.emptyText || 'Nothing here yet.', opts.action) : ready();
  function BottomSheet(html) {
    const bg = document.createElement('div'), sh = document.createElement('div'); bg.className = 'ui-sheet-bg'; sh.className = 'ui-sheet'; sh.setAttribute('role', 'dialog');
    sh.innerHTML = `<div class="grab"></div>${html}`; document.body.append(bg, sh);
    let y0 = null, done = false;
    const close = (fromPop) => { if (done) return; done = true; bg.remove(); sh.remove(); removeEventListener('keydown', key); removeEventListener('popstate', pop); if (fromPop !== true && history.state && history.state.sheet) history.back(); };
    const key = (e) => { if (e.key === 'Escape') close(); }, pop = () => close(true);
    bg.onclick = () => close(); addEventListener('keydown', key); addEventListener('popstate', pop);
    history.pushState({ sheet: 1 }, '');
    sh.addEventListener('touchstart', (e) => { y0 = e.touches[0].clientY; }, { passive: true });
    sh.addEventListener('touchend', (e) => { if (y0 != null && e.changedTouches[0].clientY - y0 > 70) close(); y0 = null; });
    return { el: sh, close };
  }
  function toast(text) { const t = document.createElement('div'); t.className = 'ui-toast'; t.setAttribute('role', 'status'); t.textContent = text; document.body.append(t); setTimeout(() => t.remove(), 2500); }
  /** numbers count up once on first paint (not with reduced motion) */
  const counted = new Set();
  function countUp(root = document) {
    root.querySelectorAll('[data-count]').forEach((el, i) => {
      const to = +el.dataset.count, key = el.closest('[id]') ? el.closest('[id]').id + i : '' + i; if (!isFinite(to) || reduced() || counted.has(key)) return; counted.add(key);
      const t0 = performance.now(); (function step(t) { const k = Math.min(1, (t - t0) / 600); el.textContent = Math.round(to * k); if (k < 1) requestAnimationFrame(step); })(t0);
    });
  }
  /** pull-to-refresh: a progress bar follows the finger, release past 90 px runs fn */
  function pullToRefresh(fn) {
    const bar = document.createElement('div'); bar.className = 'ui-ptr'; document.body.append(bar); let from = null;
    addEventListener('touchstart', (e) => { from = scrollY <= 0 ? e.touches[0].clientY : null; }, { passive: true });
    addEventListener('touchmove', (e) => { if (from != null) bar.style.width = Math.max(0, Math.min(100, (e.touches[0].clientY - from) / 0.9)) + '%'; }, { passive: true });
    addEventListener('touchend', (e) => { const go = from != null && e.changedTouches[0].clientY - from > 90; from = null; bar.style.width = go ? '100%' : '0'; if (go) Promise.resolve(fn()).finally(() => { bar.style.width = '0'; }); });
  }
  /** "6 workers running, 4 landed this hour. Nothing needs you." from real numbers */
  function status({ live, landed, needs }) {
    const a = `${live} worker${live === 1 ? '' : 's'} running`, b = landed ? `, ${landed} landed this hour` : '';
    return `${a}${b}. ${needs ? `${needs} thing${needs === 1 ? '' : 's'} need${needs === 1 ? 's' : ''} you.` : 'Nothing needs you.'}`;
  }
  return { GLOSSARY, Help, explain, outcomeWord, CONSEQUENCE, twoTap, E, STATES, reduced, Card, Chip, StatBadge, ProgressBar, Ring, Row, Skeleton, EmptyState, ErrorState, Async, plain, BottomSheet, toast, countUp, pullToRefresh, status };
})();
if (typeof module !== 'undefined') module.exports = UI;
