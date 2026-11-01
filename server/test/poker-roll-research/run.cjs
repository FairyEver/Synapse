/* Research CLI. No app, network, DB, credentials, or production writes. */
const fs=require("node:fs"),path=require("node:path"),os=require("node:os"),zlib=require("node:zlib"),crypto=require("node:crypto")
const {Worker,isMainThread,parentPort,workerData}=require("node:worker_threads")
const {load}=require("./loader.cjs")
if(!isMainThread){
  require("./engine.cjs").enableRankCache()
  const study=load("study.ts"),history=load("history.ts")
  parentPort.on("message",job=>{try{parentPort.postMessage({id:job.id,rows:job.phase==="history"?history.historyJob(job):study.runJob(job)})}catch(e){parentPort.postMessage({id:job.id,error:e.stack})}})
}else{
  const args=process.argv.slice(2),get=(name,fallback)=>{const i=args.indexOf("--"+name);return i<0?fallback:args[i+1]}
  const command=args[0]||"pilot"
  if(!["pilot","all"].includes(command))throw new Error("Expected pilot or all command")
  function integer(name,fallback,min=1,max=32768){const n=Number(get(name,fallback));if(!Number.isSafeInteger(n)||n<min||n>max)throw new Error(`Invalid ${name}: expected integer ${min}..${max}`);return n}
  const sampleCount=integer("samples",command==="pilot"?128:2048),maximum=integer("max-samples",32768)
  if(maximum<sampleCount)throw new Error("max-samples must not be below samples")
  const calibrationCount=integer("calibration-samples",32),historyCount=integer("history-samples",256)
  const out=path.resolve(get("out",path.join(__dirname,"results"))),workers=Math.min(integer("workers",8,1,128),os.availableParallelism())
  const hash=b=>crypto.createHash("sha256").update(b).digest("hex")
  require("./engine.cjs").enableRankCache()
  const history=load("history.ts"),study=load("study.ts"),cal=load("calibration.ts"),math=load("math.ts"),sim=load("simulator.ts"),policy=load("policies.ts")
  fs.mkdirSync(out,{recursive:true})
  const pool=Array.from({length:workers},()=>new Worker(__filename)),idle=[...pool],queue=[],pending=new Map();let serial=0
  function dispatch(){while(idle.length&&queue.length){const w=idle.pop(),job=queue.shift();w.postMessage(job)}}
  for(const w of pool){w.on("message",m=>{const p=pending.get(m.id);pending.delete(m.id);idle.push(w);m.error?p.reject(new Error(m.error)):p.resolve(m.rows);dispatch()});w.on("error",e=>{process.stderr.write(e.stack+"\n");process.exitCode=1;for(const p of pending.values())p.reject(e)})}
  const submit=job=>new Promise((resolve,reject)=>{const id=++serial;pending.set(id,{resolve,reject});queue.push({...job,id});dispatch()})
  const groups=[];for(const variant of ["standard52","short32"])for(let players=2;players<=10;players++)for(const street of ["preflop","flop","turn"])groups.push({variant,players,street})
  function save(name,value){const text=JSON.stringify(value,null,2)+"\n";fs.writeFileSync(path.join(out,name),text)}
  function rawOne(name,rows){const bytes=zlib.gzipSync(rows.map(r=>JSON.stringify(r,(_k,v)=>Number.isFinite(v)||typeof v!=="number"?v:null)).join("\n")+"\n");fs.writeFileSync(path.join(out,name+".jsonl.gz"),bytes);return {rows:rows.length,sha256:hash(bytes),file:name+".jsonl.gz"}}
  const indexes=new Map()
  function raw(name,rows){
    rows.forEach((r,i)=>{if(r.ordinal===undefined)r.ordinal=i})
    if(rows.length<=20000){const record=rawOne(name,rows);save(name+"-index.json",{__single__:record});return record}
    const directory=path.join(out,name);fs.mkdirSync(directory,{recursive:true})
    const previous=indexes.get(name)||{},files={}
    const grouped=new Map();for(const r of rows){if(!grouped.has(r.group))grouped.set(r.group,[]);grouped.get(r.group).push(r)}
    for(const [group,records] of grouped){
      if(previous[group]?.rows===records.length){files[group]=previous[group];continue}
      const file=group.replaceAll(":","_")
      files[group]=rawOne(path.join(name,file),records)
    }
    indexes.set(name,files);save(name+"-index.json",files);return {rows:rows.length,files}
  }
  async function sample(phase,size,model,fit,continuation="adaptive",selection=groups,start=0){
    let done=0;const jobs=[]
    for(const group of selection)for(let offset=0;offset<size;offset+=128)jobs.push(submit({...group,phase,start:start+offset,size:Math.min(128,size-offset),model,fit,continuation}).then(rows=>{done++;if(done%Math.max(1,Math.round(jobs.length/5))===0)process.stdout.write(JSON.stringify({phase,batches:done,total:jobs.length})+"\n");return rows}))
    return (await Promise.all(jobs)).flat()
  }
  async function main(){
    save("manifest.json",{createdAt:new Date().toISOString(),command,args,node:process.version,workers,engine:sim.pinned.manifest,rankCache:"memoized original evaluate, comparison parity tested",coupling:"independent full-deck priorities restricted to each branch remaining pool",source:Object.fromEntries(["engine.cjs","loader.cjs","run.cjs","math.ts","simulator.ts","policies.ts","calibration.ts","study.ts","history.ts"].map(f=>[f,hash(fs.readFileSync(path.join(__dirname,f)))])),depths:study.DEPTHS,profiles:policy.POLICY_PARAMETERS,confidence:"paired outcome per independently seeded whole-hand scenario; 1.96 standard error",scope:"finite heuristic opponents, no GTO claim; public-only assigned warmup histories; negative forced outcomes retained"})
    const size=sampleCount
    const train=await sample("train",size,study.EXPLORATION_MODEL,undefined,"none")
    const models=cal.fitModels(train);save("fitted.json",models);save("train-data.json",raw("train",train));save("train-summary.json",study.summarizeRows(train,models.price))
    if(command==="pilot"){const rows=await sample("pilot-validation",Math.min(size,128),{...models.price,scale:.5},models.policy);save("pilot-summary.json",study.summarizeRows(rows,models.price));save("pilot-data.json",raw("pilot",rows));return}
    const candidates=[]
    for(const curve of ["linear","quadratic","geometric"])for(const growth of [.25,.5,1])for(const scale of [.1,.25,.5,.75,1]){
      const model={...models.price,curve,growth,scale}
      const rows=await sample("calibration",calibrationCount,model,models.policy)
      const summary=study.summarizeRows(rows,model);candidates.push(summary)
      raw(`candidate-${candidates.length}`,rows)
      save("candidates.json",candidates)
      process.stdout.write(JSON.stringify({candidate:candidates.length,curve,growth,scale,chosen:summary.chosen,net:summary.chosenNet.mean,lower:summary.chosenNet.lower,compensation:summary.meanCompensation})+"\n")
    }
    function rank(values,confidence){
      const positive=values.filter(c=>confidence?(c.chosenNet.lower>0&&c.allOpportunitiesNet.lower>0):(c.chosenNet.mean>0&&c.allOpportunitiesNet.mean>0))
      const eligible=positive.length?positive:values
      const maxNet=Math.max(...eligible.map(c=>Math.max(0,c.allOpportunitiesNet.mean)),1e-9),maxComp=Math.max(...eligible.map(c=>c.meanCompensation),1e-9)
      eligible.forEach(c=>{c.balanceScore=Math.min(Math.max(0,c.allOpportunitiesNet.mean)/maxNet,c.meanCompensation/maxComp)})
      eligible.sort((a,b)=>b.balanceScore-a.balanceScore||a.model.scale-b.model.scale)
      return {ranked:eligible,passed:positive.length,maxNet,maxComp}
    }
    const screening=rank(candidates,false),shortlist=[]
    for(const curve of ["linear","quadratic","geometric"]){const best=screening.ranked.find(c=>c.model.curve===curve);if(best)shortlist.push(best)}
    for(const c of screening.ranked)if(shortlist.length<5&&!shortlist.includes(c))shortlist.push(c)
    const refined=[]
    for(let i=0;i<shortlist.length;i++){
      const model=shortlist[i].model,rows=await sample("calibration-refinement",Math.max(128,calibrationCount),model,models.policy)
      const summary=study.summarizeRows(rows,model);refined.push(summary);raw("refinement-"+(i+1),rows)
      save("refined-candidates.json",refined)
    }
    const ranked=rank(refined,true),selected=ranked.ranked[0]
    save("selection.json",{objective:"max-min of normalized retained incremental EV and current-action compensation; no usage-rate target",calibrationGatePassed:ranked.passed>0,maxNet:ranked.maxNet,maxComp:ranked.maxComp,selected,refined,candidates})
    async function histories(split,model){
      const results=await Promise.all(groups.map(g=>submit({...g,phase:"history",split,start:0,size:historyCount,model,fit:models.policy})))
      const rows=results.flat();raw(split,rows);save(split+"-summary.json",history.summarizeHistory(rows));return rows
    }
    const historyCalibration=await histories("history-calibration",selected.model)
    const historyFit=history.estimateHistory(historyCalibration);save("history-fit.json",historyFit)
    selected.model={...selected.model,historyByKind:historyFit.coefficients};save("recommended-model.json",selected.model)
    await histories("history-final",selected.model)
    const plannedLooks=1+Math.ceil(Math.log2(maximum/size)),diagnosticZ=math.normalQuantile(1-.05/(2*2*plannedLooks))
    let final=await sample("final-holdout",size,selected.model,models.policy),summary=study.summarizeRows(final,selected.model,diagnosticZ)
    const fixedRows=cal.fixedSample(final,size),formal=study.summarizeRows(fixedRows,selected.model,diagnosticZ)
    save("fixed-holdout-summary.json",formal)
    save("inference-design.json",{fixedPerGroup:size,fixedRows:fixedRows.length,groups:groups.length,plannedLooks,diagnosticZ,formal:"Fixed equal-group holdout only; adaptive additions excluded",adaptive:"Approximate normal Bonferroni intervals over two tiers and planned looks per cell; not joint over all cells"})
    raw("final",final);save("final-summary.json",summary)
    const maxSamples=maximum
    let counts=Object.fromEntries(groups.map(g=>[`${g.variant}:${g.players}:${g.street}`,size]))
    while(true){
      const remaining=groups.filter(g=>{const key=`${g.variant}:${g.players}:${g.street}`;return !summary.groups[key].precisionMet&&counts[key]<maxSamples})
      if(!remaining.length)break
      const batches=await Promise.all(remaining.map(async g=>{const key=`${g.variant}:${g.players}:${g.street}`,start=counts[key],amount=Math.min(start,maxSamples-start);counts[key]+=amount;return sample("final-holdout",amount,selected.model,models.policy,"adaptive",[g],start)}))
      final=math.appendBatches(final,batches);summary=study.summarizeRows(final,selected.model,diagnosticZ);raw("final",final);save("final-summary.json",summary)
    }
    const bootstrap=math.stratifiedBootstrap(fixedRows,77121)
    save("bootstrap.json",bootstrap)
    for(const mode of ["normal","super","normal-super","super-normal"]){
      const rows=await sample("sequence-comparison",Math.min(256,size),selected.model,models.policy,mode)
      raw("sequence-"+mode,rows);save("sequence-"+mode+"-summary.json",study.summarizeRows(rows,selected.model))
    }
    save("completion.json",{completedAt:new Date().toISOString(),counts,price:selected.model,precisionGroups:Object.values(summary.groups).filter(g=>g.precisionMet).length,totalGroups:groups.length,fixedHoldoutRows:fixedRows.length,netGatePassed:formal.chosenNet.lower>0&&formal.allOpportunitiesNet.lower>0&&bootstrap.chosen.lower>0&&bootstrap.all.lower>0&&Object.values(formal.byKind).every(s=>s.lower>0)&&Object.values(bootstrap.byKind).every(s=>s.lower>0),calibrationGatePassed:ranked.passed>0,productEnabled:false})
  }
  main().then(()=>require("./seal.cjs").seal(out)).catch(e=>{save("failure.json",{at:new Date().toISOString(),error:e.stack});process.stderr.write(e.stack+"\n");process.exitCode=1}).finally(()=>Promise.all(pool.map(w=>w.terminate())))
}
