#!/usr/bin/env node
// advtoastcheck.mjs — #8313. Grant -> one toast (title/frame) + one chat line chat.type.advancement.task; gamerule gates chat only.
import { loadEngine } from './loadsrc.mjs';
const M = loadEngine({ extra: ['02l_advancements.js'], dom: false });
const fails = []; let breaks = 0;
let pass = 0;
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const chat = []; let rule = 'true';
M.Chat = { add: (x) => chat.push(x) };
M.Commands = { ruleGet: () => rule };
M.Text = { translatable: (key, args) => ({ translate: key, with: args }) };
const adv = { id: 'minecraft:story/x', display: { title: 'Stone Age', frame: { id: 'task', toast: 'advancements.toast.task' }, showToast: true, announceToChat: true, icon: {} } };
function run(r, gate) {
  chat.length = 0; M.Adv.toasts.length = 0; rule = r;
  if (!gate) { const C = M.Commands; M.Commands = { ruleGet: () => 'true' }; M.Adv.announce(adv, { name: 'Dan' }); M.Commands = C; }
  else M.Adv.announce(adv, { name: 'Dan' });
  return [M.Adv.toasts.length, chat.length];
}
let [t, c] = run('true', true);
ok(t === 1 && c === 1, 'on: 1 toast 1 chat, got ' + t + ',' + c);
ok(M.Adv.toasts[0] && M.Adv.toasts[0].title === 'Stone Age' && M.Adv.toasts[0].frame === 'task', 'toast fields');
ok(chat[0] && chat[0].translate === 'chat.type.advancement.task', 'chat key');
[t, c] = run('false', true);
ok(t === 1 && c === 0, 'rule false: toast stays, chat gone, got ' + t + ',' + c);
// anti-vacuity: with the gate bypassed the chat line appears under rule=false
[t, c] = run('false', false);
if (c === 1) { breaks++; console.log('   ✓ gate removed -> chat line appears under rule=false'); } else fails.push('gate-removed variant not caught');
console.log(' assertions passed .. ' + pass);
console.log(' failures ........... ' + fails.length);
console.log(' ' + breaks + ' breaks caught');
if (fails.length) { fails.forEach((f) => console.log('   ✗ ' + f)); process.exitCode = 1; }
