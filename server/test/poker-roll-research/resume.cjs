/* Continue completed whole-batch checkpoints, with exact numeric feature memoization only. */
const fs=require("node:fs"),path=require("node:path"),zlib=require("node:zlib"),crypto=require("node:crypto"),os=require("node:os")
const {Worker,isMainThread,parentPort}=require("node:worker_threads"),fast=require("./fast-loader.cjs")
require("./engine.cjs").enableRankCache()
if(!isMainThread){
 const study=fast.load("study.ts")
 parentPort.on("message",job=>{try{parentPort.postMessage({id:job.id,rows:study.runJob(job)})}catch(e){parentPort.postMessage({id:job.id,error:e.stack})}})
}else{
 const args=process.argv.slice(2),get=(name,fallback)=>{const i=args.indexOf("--"+name);return i<0?fallback:args[i+1]},out=get("out")
 if(!out)throw new Error("Required --out checkpoint directory")
 const read=name=>JSON.parse(fs.readFileSync(path.join(out,name),"utf8")),save=(name,value)=>fs.writeFileSync(path.join(out,name),JSON.stringify(value,null,2)+"\n"),hash=bytes=>crypto.createHash("sha256").update(bytes).digest("hex")
 if(fs.existsSync(path.join(out,"completion.json")))throw new Error("Study is already complete")
 const manifest=read("manifest.json"),inference=read("inference-design.json"),selected=read("recommended-model.json"),fit=read("fitted.json").policy,selection=read("selection.json")
 for(const [file,expected] of Object.entries(manifest.source))if(hash(fs.readFileSync(path.join(__dirname,file)))!==expected)throw new Error("Frozen source fingerprint mismatch: "+file)
 const maxIndex=manifest.args.indexOf("--max-samples"),maximum=maxIndex<0?32768:Number(manifest.args[maxIndex+1]),workers=Math.min(Number(get("workers",manifest.workers)),os.availableParallelism())
 if(!Number.isSafeInteger(workers)||workers<1||workers>128||!Number.isSafeInteger(maximum)||maximum<inference.fixedPerGroup||maximum>32768)throw new Error("Invalid resume worker or original budget")
 const math=fast.load("math.ts"),study=fast.load("study.ts"),cal=fast.load("calibration.ts")
 const originalIndex=read("final-index.json"),initial=[]
 for(const record of Object.values(originalIndex)){
  const bytes=fs.readFileSync(path.join(out,record.file));if(hash(bytes)!==record.sha256)throw new Error("Checkpoint raw fingerprint mismatch")
  const rows=zlib.gunzipSync(bytes).toString().trim().split("\n").map(line=>JSON.parse(line))
  if(rows.length!==record.rows)throw new Error("Checkpoint row count mismatch")
  for(const row of rows)initial.push(row)
 }
 initial.sort((a,b)=>a.ordinal-b.ordinal)
 const groups=[];for(const variant of ["standard52","short32"])for(let players=2;players<=10;players++)for(const street of ["preflop","flop","turn"])groups.push({variant,players,street})
 let final=initial,summary=read("final-summary.json"),counts={}
 const prefix={}
 for(const g of groups){const key=`${g.variant}:${g.players}:${g.street}`,rows=initial.filter(r=>r.group===key).sort((a,b)=>a.ordinal-b.ordinal);counts[key]=rows.length
  if(rows.length!==summary.groups[key].n||rows.some((r,i)=>r.id!==`final-holdout:${key}:${i}`))throw new Error("Checkpoint contains missing, duplicate, or non-final rows: "+key)
  prefix[key]={rows:rows.length,plainSha256:hash(rows.map(r=>JSON.stringify(r)).join("\n")+"\n")}
 }
 if(fs.existsSync(path.join(out,"acceleration-manifest.json")))throw new Error("Acceleration already started; preserve the prior attempt before another resume")
 save("acceleration-manifest.json",{createdAt:new Date().toISOString(),command:process.argv.slice(2),scope:"Exact memoization only; unchanged policy, quotes, random seeds, budgets and confidence gates",source:Object.fromEntries(["fast-loader.cjs","resume.cjs"].map(f=>[f,hash(fs.readFileSync(path.join(__dirname,f)))])),frozenSource:manifest.source,modelSha256:hash(fs.readFileSync(path.join(out,"recommended-model.json"))),fitSha256:hash(fs.readFileSync(path.join(out,"fitted.json"))),checkpointCounts:counts,checkpointPrefix:prefix,checkpointIndexSha256:hash(fs.readFileSync(path.join(out,"final-index.json"))),checkpointSummarySha256:hash(fs.readFileSync(path.join(out,"final-summary.json"))),workers})
 const pool=Array.from({length:workers},()=>new Worker(__filename)),idle=[...pool],queue=[],pending=new Map();let serial=0
 function dispatch(){while(idle.length&&queue.length)idle.pop().postMessage(queue.shift())}
 for(const w of pool){w.on("message",m=>{const item=pending.get(m.id);pending.delete(m.id);idle.push(w);m.error?item.reject(new Error(m.error)):item.resolve(m.rows);dispatch()});w.on("error",error=>{for(const item of pending.values())item.reject(error);pending.clear()})}
 const submit=job=>new Promise((resolve,reject)=>{const id=++serial;pending.set(id,{resolve,reject});queue.push({...job,id});dispatch()})
 async function sample(phase,size,continuation="adaptive",selection=groups,start=0){
  const jobs=[];for(const group of selection)for(let offset=0;offset<size;offset+=128)jobs.push(submit({...group,phase,start:start+offset,size:Math.min(128,size-offset),model:selected,fit,continuation}))
  return (await Promise.all(jobs)).flat()
 }
 function raw(name,rows){
  const directory=path.join(out,name);fs.mkdirSync(directory,{recursive:true});const index={}
  rows.forEach((r,i)=>{if(r.ordinal===undefined)r.ordinal=i})
  const grouped=new Map();for(const r of rows){if(!grouped.has(r.group))grouped.set(r.group,[]);grouped.get(r.group).push(r)}
  for(const [group,records] of grouped){const file=path.join(name,group.replaceAll(":","_")+".jsonl.gz"),bytes=zlib.gzipSync(records.map(r=>JSON.stringify(r,(_k,v)=>Number.isFinite(v)||typeof v!=="number"?v:null)).join("\n")+"\n");fs.writeFileSync(path.join(out,file),bytes);index[group]={file,rows:records.length,sha256:hash(bytes)}}
  save(name+"-index.json",index)
 }
 async function main(){
  const fixed=cal.fixedSample(final,inference.fixedPerGroup),formal=study.summarizeRows(fixed,selected,inference.diagnosticZ)
  while(true){
   const remaining=groups.filter(g=>{const key=`${g.variant}:${g.players}:${g.street}`;return !summary.groups[key].precisionMet&&counts[key]<maximum})
   if(!remaining.length)break
   const batches=await Promise.all(remaining.map(async g=>{const key=`${g.variant}:${g.players}:${g.street}`,start=counts[key],amount=Math.min(start,maximum-start);return sample("final-holdout",amount,"adaptive",[g],start)}))
   final=math.appendBatches(final,batches);summary=study.summarizeRows(final,selected,inference.diagnosticZ)
   for(const [key,g] of Object.entries(summary.groups))counts[key]=g.n
   raw("final",final);save("final-summary.json",summary)
   process.stdout.write(JSON.stringify({phase:"adaptive-checkpoint",rows:final.length,precisionGroups:Object.values(summary.groups).filter(g=>g.precisionMet).length,counts})+"\n")
  }
  const bootstrap=math.stratifiedBootstrap(fixed,77121);save("bootstrap.json",bootstrap)
  for(const mode of ["normal","super","normal-super","super-normal"]){const rows=await sample("sequence-comparison",Math.min(256,inference.fixedPerGroup),mode);raw("sequence-"+mode,rows);save("sequence-"+mode+"-summary.json",study.summarizeRows(rows,selected));process.stdout.write(JSON.stringify({phase:"sequence",mode,rows:rows.length})+"\n")}
  save("completion.json",{completedAt:new Date().toISOString(),counts,price:selected,precisionGroups:Object.values(summary.groups).filter(g=>g.precisionMet).length,totalGroups:groups.length,fixedHoldoutRows:fixed.length,netGatePassed:formal.chosenNet.lower>0&&formal.allOpportunitiesNet.lower>0&&bootstrap.chosen.lower>0&&bootstrap.all.lower>0&&Object.values(formal.byKind).every(s=>s.lower>0)&&Object.values(bootstrap.byKind).every(s=>s.lower>0),calibrationGatePassed:selection.calibrationGatePassed,productEnabled:false,accelerated:true})
 }
 main().then(()=>require("./seal.cjs").seal(out)).catch(error=>{save("resume-failure.json",{at:new Date().toISOString(),error:error.stack});process.stderr.write(error.stack+"\n");process.exitCode=1}).finally(()=>Promise.all(pool.map(w=>w.terminate())))
}
