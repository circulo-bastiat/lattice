import {runLane,buildAgent} from '../tools/referee/lockstep/run.mjs';
import {mkdtempSync,writeFileSync} from 'node:fs';import {join} from 'node:path';
const dir=mkdtempSync(join(process.cwd(),'.tmp/ag-'));const agent=buildAgent(dir);
const R=[1,2].map(i=>runLane({mob:'squid',salt:2,agent,tag:'e'+i,full:true}));
const [a,b]=R;console.log(Object.keys(a));
for(const k of Object.keys(a)){const x=a[k],y=b[k];if(!Array.isArray(x))continue;for(let t=0;t<x.length;t++)if(JSON.stringify(x[t])!==JSON.stringify(y[t])){console.log(k,'tick',t,JSON.stringify(x[t]),JSON.stringify(y[t]));break}}
