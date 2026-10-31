// tools/infra/localcopy-run.mjs - localcopy.yml (a PC runner): fast-forward Dan's Projects copy and rebuild dist after a hosted landing.
import { updateLocalCopy } from './localcopy.mjs';
updateLocalCopy(process.env.MCLITE_DATA, { force: true });
