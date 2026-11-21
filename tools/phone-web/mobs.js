// mobs.js - #7809 the Mobs tab: every roster mob and how far it has been audited. Pure functions (browser global `Mobs`, node via require); the fetch lives in app.js.
// Input is tools/mobproof/matrix.json ({ roster, proven, rows: { mob: { <7 dimensions>, proven } } }) and the optional sign-off ledger { <mob>: true }.
const Mobs = (() => {
  const DIMS = ['model', 'texture', 'animation', 'drops', 'spawn', 'lockstep', 'goals'];
  const SIGN = 'signoff';   // the 8th column: the visual sign-off ledger of #7540
  /** state names as tools/mobproof.mjs writes them (green / red / missing); anything else is 'unknown' and is never counted as done */
  const KNOWN = { green: 'done', red: 'red', missing: 'missing' };
  const norm = (s) => (KNOWN[s] ? KNOWN[s] : 'unknown');
  const INFO = {
    model: ['Model', 'model boxes and parts match the vanilla EntityModelLayer', 'mobl3check', 7521],
    texture: ['Texture', 'rendered pixels match the vanilla texture', 'mobtexproofcheck', 7522],
    animation: ['Animation', 'head, leg and riding poses equal the decompiled model animation', 'mobanimproof', 7523],
    drops: ['Drops', 'the loot roll matches the real server (rate and count per item)', 'mobdropsproofcheck', 7524],
    spawn: ['Spawn', 'biome and structure spawn rows, weight and group match vanilla', 'spawnproofcheck', 7525],
    lockstep: ['Lockstep', 'the mob moves tick for tick like the real 1.18.2 server (referee lane)', 'vanillacheck lanes (tools/referee/lanes.d)', 7526],
    goals: ['Goals', 'the AI goal list (selector, priority, class) equals registerGoals()', 'goalaudit', 1535],
    [SIGN]: ['Visual sign-off', 'Dan has looked at it next to vanilla and signed it off', 'sign-off ledger (#7540)', 7540],
  };
  const CAPTION = 'Proven = all 7 dimensions green: model, texture, animation, drops, spawn, lockstep and goals.';
  /** MobCategory of 1.18.2 by roster entry (hand-kept: the repo has no roster category table); behaviour-neutral mobs sit under neutral, the rest of the entity types under other */
  const CAT = {};
  const put = (c, s) => s.split(' ').forEach((m) => { CAT[m] = c; });
  put('hostile', 'blaze cave_spider creeper drowned endermite evoker ghast giant guardian hoglin husk illusioner magma_cube phantom piglin piglin_brute pillager ravager shulker silverfish skeleton slime spider stray vex vindicator witch wither_skeleton zoglin zombie zombie_villager');
  put('neutral', 'bee dolphin enderman goat iron_golem llama trader_llama panda polar_bear wolf zombified_piglin');
  put('boss', 'ender_dragon wither elder_guardian');
  put('vehicle', 'boat minecart chest_minecart command_block_minecart furnace_minecart hopper_minecart spawner_minecart tnt_minecart');
  put('projectile', 'evoker_fangs llama_spit shulker_bullet trident wither_skull');
  put('other', 'armor_stand end_crystal leash_knot llama_decor player player_slim');
  const CATS = ['hostile', 'passive', 'neutral', 'boss', 'vehicle', 'projectile', 'other'];
  const category = (m) => CAT[m] || 'passive';
  const humanize = (m) => { const s = String(m).replace(/_/g, ' '); return s.charAt(0).toUpperCase() + s.slice(1); };
  /** per-mob view: 8 cells (7 dimensions + sign-off), done count and flags */
  function model(matrix, ledger) {
    const L = ledger || {}, rows = (matrix && matrix.rows) || {};
    return Object.keys(rows).map((name) => {
      const r = rows[name], cells = DIMS.map((d) => ({ dim: d, st: norm(r[d]) }));
      cells.push({ dim: SIGN, st: L[name] === true ? 'done' : 'missing' });
      const done = cells.filter((c) => c.st === 'done').length;
      return { name, title: humanize(name), cat: category(name), cells, done, red: cells.some((c) => c.st === 'red'), proven: DIMS.every((d) => r[d] === 'green'), signed: L[name] === true };
    });
  }
  /** counts shown in the bars and the summary strip; proven is recomputed from the rows, so a stale file total cannot show */
  function summary(list) {
    const per = {}; for (const d of DIMS.concat(SIGN)) per[d] = list.filter((m) => m.cells.find((c) => c.dim === d).st === 'done').length;
    return { total: list.length, proven: list.filter((m) => m.proven).length, signed: list.filter((m) => m.signed).length, per };
  }
  /** filters: cat, needs (not proven), red (any red), dim (this dimension not done), q (search); default order least-audited first */
  function filter(list, f = {}) {
    const q = String(f.q || '').trim().toLowerCase().replace(/ /g, '_');
    return list.filter((m) => (!f.cat || m.cat === f.cat) && (!f.needs || !m.proven) && (!f.red || m.red) && (!f.dim || m.cells.find((c) => c.dim === f.dim).st !== 'done') && (!q || m.name.includes(q)))
      .sort((a, b) => a.done - b.done || a.name.localeCompare(b.name));
  }
  const E = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const seg = (c) => `<i class="mb-seg ${c.st}" data-dim="${c.dim}" title="${E(INFO[c.dim][0])}: ${c.st}"></i>`;
  const rowHtml = (m) => `<a class="ui-row mb-row" href="#/mobs" data-mob="${E(m.name)}"><b>${E(m.title)}</b><span class="mb-segs">${m.cells.map(seg).join('')}</span><small>${m.done} of 8</small></a>`;
  const bar = (label, n, total) => `<div class="mb-prog"><b>${E(label)} ${n} / ${total}</b>${UI.ProgressBar(total ? (n / total) * 100 : 0)}</div>`;
  function view(list, f = {}) {
    const s = summary(list), shown = filter(list, f);
    const chips = (items, key) => items.map((x) => `<button class="mb-f${f[key] === x[0] ? ' on' : ''}" data-f="${key}" data-v="${E(x[0])}">${E(x[1])}</button>`).join('');
    return `<h2>Mobs</h2>${bar('Proven', s.proven, s.total)}${bar('Visually signed off', s.signed, s.total)}<p class="sub">${E(CAPTION)}</p>` +
      `<div class="mb-strip">${chips(DIMS.concat(SIGN).map((d) => [d, `${INFO[d][0].split(' ')[0].toLowerCase()} ${s.per[d]}/${s.total} done`]), 'dim')}</div>` +
      `<div class="mb-strip">${chips(CATS.map((c) => [c, c]), 'cat')}<button class="mb-f${f.needs ? ' on' : ''}" data-f="needs" data-v="1">needs work</button><button class="mb-f${f.red ? ' on' : ''}" data-f="red" data-v="1">red only</button></div>` +
      `<input class="mb-q" type="search" placeholder="Search mobs" value="${E(f.q || '')}" aria-label="Search mobs"><p class="sub" id="mb-n">${shown.length} of ${s.total} mobs</p>` +
      (shown.length ? shown.map(rowHtml).join('') : UI.EmptyState('No mob matches these filters.', { id: 'mb-clear', label: 'Clear filters' }));
  }
  /** the sheet for one mob: each dimension, its state, the plain meaning, the deciding check and the owning issue */
  function sheet(m) {
    const rows = m.cells.map((c) => { const i = INFO[c.dim]; return `<div class="mb-d"><i class="mb-seg ${c.st}"></i><div><b>${E(i[0])}</b> <span class="mb-st">${E(c.st === 'done' ? 'done' : c.st === 'unknown' ? 'unknown state' : c.st === 'missing' && c.dim === SIGN ? 'not started' : c.st)}</span><small>${E(i[1])}. Decided by: ${E(i[2])}. Issue #${i[3]}.</small></div></div>`; }).join('');
    return `<h3>${E(m.title)}</h3><p class="sub">${E(m.cat)} · ${m.done} of 8${m.proven ? ' · proven' : ''}</p>${rows}<a class="alt" href="https://github.com/owner/mclite/issues?q=${encodeURIComponent(m.name)}" target="_blank" rel="noopener"><button class="alt">Open issue</button></a>`;
  }
  const issueFor = (cell) => (INFO[cell] || [])[3];
  return { DIMS, SIGN, INFO, CAPTION, CATS, KNOWN, norm, category, humanize, model, summary, filter, view, sheet, rowHtml, issueFor };
})();
if (typeof module !== 'undefined') module.exports = Mobs;
