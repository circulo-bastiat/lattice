// tabs.js - #7807 the tab registry. Adding a section = a module that sets its render() + one line here (C, D, E do not touch app.js).
// render() returns the screen HTML, or null when app.js still draws that route itself (legacy screens). Max 5 bottom-bar slots.
const Tabs = (() => {
  const soon = (what) => () => UI.EmptyState(`${what} is arriving soon.`);
  const REG = [
    { id: 'home', label: 'Home', icon: '⌂', hash: '#/', badge: () => 0, render: () => null },
    { id: 'bugs', label: 'Bugs', icon: '⚑', hash: '#/bugs', badge: () => Tabs.counts.bugs || 0, render: () => null },
    { id: 'mobs', label: 'Mobs', icon: '✦', hash: '#/mobs', badge: () => 0, render: soon('The mob audit') },
    { id: 'stats', label: 'Runs', icon: '▶', hash: '#/stats', badge: () => 0, render: () => null },
    { id: 'requests', label: 'Requests', icon: '✉', hash: '#/requests', badge: () => Tabs.counts.requests || 0, render: () => null },
  ];
  const counts = { bugs: 0, requests: 0 };
  const byId = (id) => REG.find((t) => t.id === id);
  const KEY = 'last-tab';
  const remember = (id) => { try { localStorage.setItem(KEY, id); } catch { /* private mode */ } };
  const last = () => { try { return localStorage.getItem(KEY) || ''; } catch { return ''; } };
  /** the bottom bar; `on` is the active tab id */
  function barHtml(on) {
    return REG.slice(0, 5).map((t) => { const n = t.badge(); return `<a href="${t.hash}" data-t="${t.id}" data-i="${t.icon}"${t.id === on ? ' class="on" aria-current="page"' : ''}>${UI.E(t.label)}<span id="${t.id === 'requests' ? 'rn' : 't-' + t.id}">${n ? ` (${n})` : ''}</span></a>`; }).join('');
  }
  return { REG, counts, byId, remember, last, barHtml };
})();
if (typeof module !== 'undefined') module.exports = Tabs;
