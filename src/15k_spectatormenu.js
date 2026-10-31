// 15k_spectatormenu.js - the spectator hotbar menu (G17-S2), ported from SpectatorMenu / TeleportSpectatorMenu.
// Pure logic: slot i of page p is command p*6+i; slot 0 is "previous page" when p>0, 7 is next page, 8 is close.
(function (NS) {
  const T = { close: 'spectatorMenu.close', prev: 'spectatorMenu.previous_page', next: 'spectatorMenu.next_page',
    teleport: 'spectatorMenu.teleport', prompt: 'spectatorMenu.teleport.prompt' };
  const BLANK = { id: 'blank', name: '', enabled: false };
  const PAGE = 6;
  /** players: [{id, name, mode, x, y, z}] - spectators (mode 3) are left out, the rest sorted by id as vanilla's ORDERING. */
  function make(players, onClose, onTeleport) {
    const list = players.filter(p => p.mode !== 3).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
      .map(p => ({ id: 'player:' + p.id, name: p.name, enabled: true, player: p }));
    const m = { page: 0, selected: -1, group: 'root', list, root: [{ id: 'teleport', name: T.teleport, enabled: list.length > 0 }] };
    const cmds = () => (m.group === 'root' ? m.root : m.list);
    m.command = (i) => {
      const k = i + m.page * PAGE;
      if (m.page > 0 && i === 0) return { id: 'prev', name: T.prev, enabled: true };
      if (i === 7) return { id: 'next', name: T.next, enabled: k < cmds().length };
      if (i === 8) return { id: 'close', name: T.close, enabled: true };
      return k >= 0 && k < cmds().length ? cmds()[k] : BLANK;
    };
    m.commands = () => [0, 1, 2, 3, 4, 5, 6, 7, 8].map(m.command);
    m.use = (i) => {
      const c = m.command(i);
      if (c === BLANK) return;
      if (m.selected !== i || !c.enabled) { m.selected = i; return; }
      if (c.id === 'prev') m.page--; else if (c.id === 'next') m.page++;
      else if (c.id === 'close') { if (onClose) onClose(m); }
      else if (c.id === 'teleport') { m.group = 'teleport'; m.selected = -1; m.page = 0; }
      else if (c.player && onTeleport) onTeleport(c.player);
    };
    return m;
  }
  NS.SpectatorMenu = { make, T, PAGE, BLANK };
})(MCL);
