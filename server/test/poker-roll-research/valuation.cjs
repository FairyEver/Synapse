const fs=require("node:fs"),path=require("node:path"),zlib=require("node:zlib"),crypto=require("node:crypto"),os=require("node:os")
const {Worker,isMainThread,parentPort}=require("node:worker_threads")
const {load}=require("./loader.cjs")
require("./engine.cjs").enableRankCache()
const valuation=load("valuation.ts")
if(!isMainThread){
 parentPort.on("message",job=>{try{parentPort.postMessage({id:job.id,rows:Array.from({length:job.size},(_,i)=>valuation.valueRow({...job,index:job.start+i}))})}catch(e){parentPort.postMessage({id:job.id,error:e.stack})}})
}else{
 const args=process.argv.slice(2),get=(name,fallback)=>{const i=args.indexOf("--"+name);return i<0?fallback:args[i+1]}
 const out=get("out"),samples=Number(get("samples",512)),workers=Math.min(Number(get("workers",2)),os.availableParallelism())
 if(!out||!Number.isSafeInteger(samples)||samples<1||samples>32768||!Number.isSafeInteger(workers)||workers<1)throw new Error("Required --out, positive --samples <=32768, and positive --workers")
 const model=JSON.parse(fs.readFileSync(path.join(out,"recommended-model.json"),"utf8")),fit=JSON.parse(fs.readFileSync(path.join(out,"fitted.json"),"utf8")).policy
 const directory=path.join(out,"break-even");fs.mkdirSync(directory,{recursive:true})
 const hash=b=>crypto.createHash("sha256").update(b).digest("hex")
 const sourceFiles=["valuation.ts","valuation.cjs","loader.cjs","engine.cjs","math.ts","simulator.ts","policies.ts","study.ts"]
 fs.writeFileSync(path.join(out,"valuation-manifest.json"),JSON.stringify({createdAt:new Date().toISOString(),samples,workers,seed:"20261101/current-fee-audit",modelSha256:hash(fs.readFileSync(path.join(out,"recommended-model.json"))),fitSha256:hash(fs.readFileSync(path.join(out,"fitted.json"))),source:Object.fromEntries(sourceFiles.map(f=>[f,hash(fs.readFileSync(path.join(__dirname,f)))])),fractions:valuation.FRACTIONS,futurePriceParameters:"unchanged",usedForModelSelection:false},null,2)+"\n")
 const pool=Array.from({length:workers},()=>new Worker(__filename)),idle=[...pool],pending=new Map(),queue=[];let id=0
 function dispatch(){while(idle.length&&queue.length)idle.pop().postMessage(queue.shift())}
 for(const worker of pool)worker.on("message",message=>{const item=pending.get(message.id);pending.delete(message.id);idle.push(worker);message.error?item.reject(new Error(message.error)):item.resolve(message.rows);dispatch()})
 const submit=job=>new Promise((resolve,reject)=>{const key=++id;pending.set(key,{resolve,reject});queue.push({...job,id:key});dispatch()})
 async function main(){
  const groups=[];for(const variant of ["standard52","short32"])for(let players=2;players<=10;players++)for(const street of ["preflop","flop","turn"])groups.push({variant,players,street})
  const rows=[],index={}
  for(let k=0;k<groups.length;k++){
   const group=groups[k],parts=[]
   for(let start=0;start<samples;start+=64)parts.push(submit({...group,start,size:Math.min(64,samples-start),model,fit}))
   const records=(await Promise.all(parts)).flat();rows.push(...records)
   const file=`${group.variant}_${group.players}_${group.street}.jsonl.gz`,bytes=zlib.gzipSync(records.map(r=>JSON.stringify(r)).join("\n")+"\n")
   fs.writeFileSync(path.join(directory,file),bytes);index[`${group.variant}:${group.players}:${group.street}`]={rows:records.length,file:path.join("break-even",file),sha256:hash(bytes)}
   fs.writeFileSync(path.join(out,"break-even-index.json"),JSON.stringify(index,null,2)+"\n")
   process.stdout.write(JSON.stringify({phase:"current-fee-audit",group:k+1,total:groups.length})+"\n")
  }
  fs.writeFileSync(path.join(out,"break-even-summary.json"),JSON.stringify(valuation.summarizeValues(rows),null,2)+"\n")
 }
 main().catch(e=>{process.stderr.write(e.stack+"\n");process.exitCode=1}).finally(()=>Promise.all(pool.map(w=>w.terminate())))
}
