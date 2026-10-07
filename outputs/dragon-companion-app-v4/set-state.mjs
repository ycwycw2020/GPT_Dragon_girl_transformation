import { writeState, DEFAULT_STATE_FILE } from './state-bridge.mjs';
const args=process.argv.slice(2);
const option=name=>{const index=args.indexOf(name);return index<0?undefined:args[index+1];};
const working=option('--working');
if(!['true','false'].includes(working))throw new Error('Use --working true or --working false');
const quota=option('--quota');
const state=await writeState({isWorking:working==='true',remainingPercent:quota===undefined||quota==='unknown'?null:Number(quota),
  ttlMs:Number(option('--ttl-ms')||300000),source:'manual-cli'},option('--file')||DEFAULT_STATE_FILE);
console.log(JSON.stringify(state,null,2));
