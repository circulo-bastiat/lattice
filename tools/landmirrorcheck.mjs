// landmirrorcheck (#8916): mode/rollback, dispatch body, verdict lines, workflow shape; then proves itself with breaks.
import fs from 'node:fs';
import { landMode, dispatchBody, verdictLine } from './infra/landmirror.mjs';
const land = fs.readFileSync('.github/workflows/land.yml', 'utf8'), mwf = fs.readFileSync('tools/infra/mirror/land.yml', 'utf8'), pub = fs.readFileSync('tools/infra/mirror.mjs', 'utf8');
const checks = (o) => {
  const bad = [];
  if (o.landMode('mirror') !== 'mirror' || o.landMode('pc') !== 'pc' || o.landMode(undefined) !== 'hosted') bad.push('landMode');
  if (o.dispatchBody({ pr: 12 }).inputs.pr !== '12') bad.push('dispatchBody');
  let t = false; try { o.dispatchBody({ pr: 'x; rm' }); } catch { t = true; } if (!t) bad.push('bad pr accepted');
  if (o.verdictLine(5, 'success') !== 'LANDED #5' || !/^BOUNCED/.test(o.verdictLine(5, 'failure')) || /^LANDED/.test(o.verdictLine(5, null))) bad.push('verdictLine');
  return bad;
};
const bad = checks({ landMode, dispatchBody, verdictLine });
if (!/land-mirror:\s*\n\s*#.*\n\s*if: vars\.TEST_RUNNER == 'mirror'/.test(land)) bad.push('land-mirror job');
if (!/land-hosted:\s*\n\s*if: .*!= 'mirror'/.test(land) || /land-pc:/.test(land)) bad.push('rollback conditions (land-pc retired, #10414)');
if (!/workflow_dispatch/.test(mwf) || !/MCLITE_PAT/.test(mwf) || !/silent land/.test(mwf) || /\bland\.mjs[^\n]*>/.test(mwf)) bad.push('mirror land.yml shape');
if (!/'mirror', 'land\.yml'/.test(pub)) bad.push('land.yml not published');
const broken = [{ landMode: () => 'mirror' }, { dispatchBody: () => ({ inputs: { pr: '' } }) }, { dispatchBody: (x) => ({ inputs: { pr: String(x.pr) } }) }, { verdictLine: (p) => `LANDED #${p}` }, { landMode: () => 'hosted' }];
let caught = 0; for (const b of broken) if (checks({ landMode, dispatchBody, verdictLine, ...b }).length) caught++;
if (caught < broken.length) bad.push(`only ${caught}/${broken.length} breaks caught`);
console.log(bad.length ? 'FAIL ' + bad.join('; ') : `landmirrorcheck ok; ${caught} breaks caught`); process.exit(bad.length ? 1 : 0);
