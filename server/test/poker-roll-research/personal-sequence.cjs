const fs=require("node:fs"),path=require("node:path"),zlib=require("node:zlib"),crypto=require("node:crypto"),os=require("node:os")
const {Worker,isMainThread,parentPort}=require("node:worker_threads"),{load}=require("./fast-loader.cjs")
require("./engine.cjs").enableRankCache()
const personal=load("personal-sequence.ts")
if(!isMainThread){
 parentPort.on("message",job=>{try{parentPort.postMessage({id:job.id,rows:personal.personalRows(job)})}catch(error){parentPort.postMessage({id:job.id,error:error.stack})}})
}else{
 const args=process.argv.slice(2),get=(name,fallback)=>{const i=args.indexOf("--"+name);return i<0?fallback:args[i+1]},out=get("out"),samples=Number(get("samples",256)),workers=Math.min(Number(get("workers",2)),os.availableParallelism())
 if(!out||!Number.isSafeInteger(samples)||samples<16||samples>32768||!Number.isSafeInteger(workers)||workers<1)throw new Error("Required --out, samples16..32768, positive workers")
 const read=name=>JSON.parse(fs.readFileSync(path.join(out,name),"utf8")),save=(name,v)=>fs.writeFileSync(path.join(out,name),JSON.stringify(v,null,2)+"\n"),hash=b=>crypto.createHash("sha256").update(b).digest("hex"),model=read("recommended-model.json"),fit=read("fitted.json").policy
 const sources=[...Object.keys(read("manifest.json").source),"fast-loader.cjs","personal-sequence.ts","personal-sequence.cjs"]
 save("personal-sequence-manifest.json",{createdAt:new Date().toISOString(),samples,workers,seed:"20261101/personal-sequence-final",modes:personal.PERSONAL_MODES,opponents:"adaptive in every branch",reference:"hero never Rolls again this hand",usedForModelSelection:false,source:Object.fromEntries(sources.map(f=>[f,hash(fs.readFileSync(path.join(__dirname,f)))])),modelSha256:hash(fs.readFileSync(path.join(out,"recommended-model.json"))),fitSha256:hash(fs.readFileSync(path.join(out,"fitted.json")))})
 const pool=Array.from({length:workers},()=>new Worker(__filename)),idle=[...pool],queue=[],pending=new Map();let serial=0
 function dispatch(){while(idle.length&&queue.length)idle.pop().postMessage(queue.shift())}
 for(const w of pool){w.on("message",m=>{const item=pending.get(m.id);pending.delete(m.id);idle.push(w);m.error?item.reject(new Error(m.error)):item.resolve(m.rows);dispatch()});w.on("error",error=>{for(const item of pending.values())item.reject(error);pending.clear()})}
 const submit=job=>new Promise((resolve,reject)=>{const id=++serial;pending.set(id,{resolve,reject});queue.push({...job,id});dispatch()})
 async function main(){
  const rows=[];let done=0
  for(const variant of ["standard52","short32"])for(let players=2;players<=10;players++)for(const street of ["preflop","flop","turn"]){
   const jobs=[];for(let start=0;start<samples;start+=32)jobs.push(submit({variant,players,street,start,size:Math.min(32,samples-start),model,fit}))
   for(const batch of await Promise.all(jobs))for(const row of batch)rows.push(row)
   process.stdout.write(JSON.stringify({phase:"personal-sequence-final",group:++done,total:54})+"\n")
  }
  const bytes=zlib.gzipSync(rows.map(r=>JSON.stringify(r)).join("\n")+"\n");fs.writeFileSync(path.join(out,"personal-sequence.jsonl.gz"),bytes)
  save("personal-sequence-index.json",{__single__:{file:"personal-sequence.jsonl.gz",rows:rows.length,sha256:hash(bytes)}});save("personal-sequence-summary.json",personal.summarizePersonal(rows))
 }
 main().catch(error=>{save("personal-sequence-failure.json",{error:error.stack});process.stderr.write(error.stack+"\n");process.exitCode=1}).finally(()=>Promise.all(pool.map(w=>w.terminate())))
}
