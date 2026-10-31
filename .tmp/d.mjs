import {runLane,buildAgent} from '../tools/referee/lockstep/run.mjs';
import {mkdtempSync} from 'node:fs';import {join} from 'node:path';
const dir=mkdtempSync(join(process.cwd(),'.tmp/ag-'));const agent=buildAgent(dir);
for(const i of [1,2]){const r=runLane({mob:'squid',salt:2,agent,tag:'d'+i,logFile:join(process.cwd(),'.tmp/log'+i+'.txt'),full:true});console.log(i,JSON.stringify(r).length)}
