/* Independent diagnostic supplement, never used to select or refit prices. */
const fs=require("node:fs"),path=require("node:path"),zlib=require("node:zlib"),crypto=require("node:crypto"),os=require("node:os")
const {Worker,isMainThread,parentPort}=require("node:worker_threads")
const {load}=require("./loader.cjs")
require("./engine.cjs").enableRankCache()
const multi=load("multi-history.ts"),history=load("history.ts")
if(!isMainThread){
 parentPort.on("message",job=>{try{parentPort.postMessage({id:job.id,rows:multi.multiHistoryRows(job)})}catch(e){parentPort.postMessage({id:job.id,error:e.stack})}})
}else{
 const args=process.argv.slice(2),get=(name,fallback)=>{const i=args.indexOf("--"+name);return i<0?fallback:args[i+1]}
 const out=get("out"),samples=Number(get("samples",128)),workers=Math.min(Number(get("workers",2)),os.availableParallelism())
 if(!out||!Number.isSafeInteger(samples)||samples<16||samples>32768||!Number.isSafeInteger(workers)||workers<1)throw new Error("Required --out, integer samples 16..32768, positive workers")
 const read=name=>JSON.parse(fs.readFileSync(path.join(out,name),"utf8")),model=read("recommended-model.json"),fit=read("fitted.json").policy
 const hash=b=>crypto.createHash("sha256").update(b).digest("hex"),save=(name,value)=>fs.writeFileSync(path.join(out,name),JSON.stringify(value,null,2)+"\n")
 save("multi-history-manifest.json",{createdAt:new Date().toISOString(),samples,workers,seed:"20261101/multi-history-final",usedForModelSelection:false,scope:"Two or three prior actors; singles, repeated mixed tiers, last prior actor later folds; exact current funding matching from admission; no heads-up multi-prior opportunity exists",modelSha256:hash(fs.readFileSync(path.join(out,"recommended-model.json"))),fitSha256:hash(fs.readFileSync(path.join(out,"fitted.json"))),source:Object.fromEntries(["multi-history.ts","multi-history.cjs","history.ts","policies.ts","simulator.ts","math.ts","loader.cjs","engine.cjs"].map(f=>[f,hash(fs.readFileSync(path.join(__dirname,f)))]))})
 const pool=Array.from({length:workers},()=>new Worker(__filename)),idle=[...pool],queue=[],pending=new Map();let serial=0
 function dispatch(){while(idle.length&&queue.length)idle.pop().postMessage(queue.shift())}
 for(const w of pool){w.on("message",m=>{const item=pending.get(m.id);pending.delete(m.id);idle.push(w);m.error?item.reject(new Error(m.error)):item.resolve(m.rows);dispatch()});w.on("error",error=>{for(const item of pending.values())item.reject(error);pending.clear()})}
 const submit=job=>new Promise((resolve,reject)=>{const id=++serial;pending.set(id,{resolve,reject});queue.push({...job,id});dispatch()})
 async function main(){
  const rows=[];let done=0
  for(const variant of ["standard52","short32"])for(let players=3;players<=10;players++)for(const street of ["preflop","flop","turn"]){
   const parts=[];for(let start=0;start<samples;start+=32)parts.push(submit({variant,players,street,start,size:Math.min(32,samples-start),model,fit}))
   for(const part of await Promise.all(parts))for(const row of part)rows.push(row)
   process.stdout.write(JSON.stringify({phase:"multi-history-final",group:++done,total:48})+"\n")
  }
  const bytes=zlib.gzipSync(rows.map(r=>JSON.stringify(r)).join("\n")+"\n")
  fs.writeFileSync(path.join(out,"multi-history-final.jsonl.gz"),bytes)
  save("multi-history-final-index.json",{__single__:{file:"multi-history-final.jsonl.gz",rows:rows.length,sha256:hash(bytes)}})
  save("multi-history-final-summary.json",history.summarizeHistory(rows))
 }
 main().catch(error=>{save("multi-history-failure.json",{error:error.stack});process.stderr.write(error.stack+"\n");process.exitCode=1}).finally(()=>Promise.all(pool.map(w=>w.terminate())))
}
