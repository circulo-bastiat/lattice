// #8897 R2: the thin-queue decision, and every rule when broken is caught.
import { decide } from './infra/thinfill.mjs';
const now = 1e12, b = { free: 5, thin: 40, markerAt: now - 1, lastRoundAt: 0, lastDecisionAt: 0, now };
let bad = 0, breaks = 0;
const ok = (c, m) => { if (!c) { bad++; console.log('FAIL ' + m); } };
const caught = (c, m) => { if (c) breaks++; else { bad++; console.log('NOT CAUGHT ' + m); } };
ok(decide(b).act === 'prooffeed', 'prooffeed first');
ok(decide({ ...b, filed: 0 }).act === 'enlargers', 'enlargers when prooffeed filed nothing');
caught(decide({ ...b, markerAt: 0 }).act === 'none', 'no marker, no action');
caught(decide({ ...b, free: 40 }).act === 'none', 'deep queue, no action');
caught(decide({ ...b, filed: 3 }).act === 'none', 'prooffeed filed, no enlargers');
caught(decide({ ...b, filed: 0, lastRoundAt: now - 3600e3 }).act === 'none', 'one round per 6 h');
caught(decide({ ...b, filed: 0, lastRoundAt: now - 7 * 3600e3 }).act === 'enlargers', 'round allowed after 6 h');
caught(decide({ ...b, lastDecisionAt: now }).act === 'none', 'marker already handled');
console.log(`thinfillcheck: ${bad ? bad + ' FAILED' : 'ok'}, ${breaks} breaks caught`);
