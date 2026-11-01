/* Fixed-budget game-design check. Does not alter or certify the original study. */
const fs=require("node:fs"),path=require("node:path"),zlib=require("node:zlib"),crypto=require("node:crypto")
const {Worker,isMainThread,parentPort}=require("node:worker_threads")
const {load}=require("./fast-loader.cjs")
require("./engine.cjs").enableRankCache()
const {runJob}=load("study.ts"),{summarize,mean}=load("math.ts")
const hash=bytes=>crypto.createHash("sha256").update(bytes).digest("hex")

if(!isMainThread){
 parentPort.on("message",job=>{try{parentPort.postMessage({rows:runJob(job)})}catch(e){parentPort.postMessage({error:e.stack})}})
}else{
 const args=process.argv.slice(2),get=(name,fallback)=>{const i=args.indexOf("--"+name);return i<0?fallback:args[i+1]}
 const source=get("source","docs/superpowers/research/2026-11-01-poker-roll"),out=get("out"),samples=Number(get("samples",256)),workers=Number(get("workers",4)),priceScale=Number(get("price-scale",.1)),phase=get("phase","playtest-v2-fixed")
 if(!out||!Number.isSafeInteger(samples)||samples<1||samples>512||!Number.isSafeInteger(workers)||workers<1||workers>8||!Number.isFinite(priceScale)||priceScale<=0||priceScale>1||!/^playtest-[a-z0-9-]+$/.test(phase))throw new Error("Required new --out; samples 1..512; workers 1..8; price-scale (0,1]; phase playtest-[a-z0-9-]+")
 // Exclusive output directory: failed or successful runs are never silently overwritten.
 fs.mkdirSync(out)
 const write=(name,value)=>fs.writeFileSync(path.join(out,name),JSON.stringify(value,null,2)+"\n",{flag:"wx"})
 const coefficients={preflop:{normal:[0,10,1],super:[0,30,3]},flop:{normal:[0,20,2],super:[0,50,5]},turn:{normal:[0,40,4],super:[0,80,8]}}
 const cells={};for(const variant of ["standard52","short32"])for(let n=2;n<=10;n++)for(const street of ["preflop","flop","turn"])cells[`${variant}:${n}:${street}`]=coefficients[street]
 // scale 1/200 and integer coefficients implement W=P+E/10 with six rounded design rates.
 const model={scale:priceScale/200,curve:"linear",growth:1,coefficients:coefficients.preflop,cells,history:{normal:0,super:0}}
 const fitted=fs.readFileSync(path.join(source,"fitted.json")),fit=JSON.parse(fitted).policy
 const files=["playtest.cjs","fast-loader.cjs","engine.cjs","math.ts","simulator.ts","policies.ts","study.ts","calibration.ts"]
 write("manifest.json",{createdAt:new Date().toISOString(),purpose:"Fixed-budget first-playtest recommendation; not strict precision certification or GTO",phase,priceScale,samplesPerCell:samples,workers,engine:require("./engine.cjs").manifest,modelChosenBeforeThisRun:true,parametersAreRoundedDesignChoices:true,frozenOriginalStudyUnchanged:true,oldPrecisionGateApplied:false,productEnabled:false,source:path.resolve(source),policyFitSha256:hash(fitted),oldModelSha256:hash(fs.readFileSync(path.join(source,"recommended-model.json"))),modelSha256:hash(Buffer.from(JSON.stringify(model,null,2)+"\n")),sourceSha256:Object.fromEntries(files.map(f=>[f,hash(fs.readFileSync(path.join(__dirname,f)))]))})
 write("model.json",model)
 write("pricing.json",{version:phase,status:"FIRST_PLAYTEST_DESIGN",basis:"W = contestablePot + 0.1 * effectiveFuture",rates:Object.fromEntries(Object.entries(coefficients).map(([street,c])=>[street,{normal:c.normal[1]*model.scale,super:c.super[1]*model.scale}])),countMultiplier:"1+k; normal and super share the hand count",historyMultiplier:1,sameRatesBothDecks:true,minimumNormal:1,superBase:"max(normalUnroundedBase+1, superRate*W)",rounding:"ceil AFTER count multiplier",affordability:"fee < available stack; never cap to balance",compensation:"100% to other nonfolded participants, frozen until after normal payout",interpretation:"Rounded initial game-design parameters informed by prior study, not fitted exact fair-value coefficients"})
 fs.writeFileSync(path.join(out,"runner-source.cjs.txt"),fs.readFileSync(__filename),{flag:"wx"})
 const pool=Array.from({length:workers},()=>new Worker(__filename)),idle=[...pool],pending=new Map(),queue=[]
 function dispatch(){while(idle.length&&queue.length){const w=idle.pop(),item=queue.shift();pending.set(w,item);w.postMessage(item.job)}}
 function fail(error){for(const item of pending.values())item.reject(error);for(const item of queue)item.reject(error);pending.clear();queue.length=0}
 for(const w of pool){w.on("message",message=>{const item=pending.get(w);pending.delete(w);idle.push(w);message.error?item.reject(new Error(message.error)):item.resolve(message.rows);dispatch()});w.on("error",fail);w.on("exit",code=>{if(pending.has(w))fail(new Error(`Research worker exited ${code}`))})}
 const submit=job=>new Promise((resolve,reject)=>{queue.push({job,resolve,reject});dispatch()})
 const metric=rows=>{
  const chosen=rows.filter(r=>r.chosen),stats=a=>summarize(a,1.959963984540054)
  return {rows:rows.length,chosen:chosen.length,chosenNet:stats(chosen.map(r=>r.voluntary)),allOpportunitiesNet:stats(rows.map(r=>r.voluntary)),byKind:Object.fromEntries(["normal","super"].map(kind=>{const a=chosen.filter(r=>r.chosenKind===kind);return [kind,{n:a.length,net:stats(a.map(r=>r.voluntary)),negativeOutcomes:a.filter(r=>r.voluntary<0).length}]})),forced:Object.fromEntries(["normal","super"].map(kind=>[kind,stats(rows.filter(r=>Number.isFinite(r[kind])).map(r=>r[kind]))])),meanCurrentPointCompensation:mean(rows.map(r=>r.paid)),meanRemainingHandFees:mean(rows.map(r=>r.totalPaid)),meanCurrentPointRolls:mean(rows.map(r=>r.rolls)),negativeChosenFraction:chosen.length?chosen.filter(r=>r.voluntary<0).length/chosen.length:null}
 }
 async function main(){
  const groups=[];for(const variant of ["standard52","short32"])for(let players=2;players<=10;players++)for(const street of ["preflop","flop","turn"])groups.push({variant,players,street})
  const rows=[],index={},jobs=groups.map(group=>submit({...group,phase,start:0,size:samples,model,fit}))
  for(let i=0;i<jobs.length;i++){
   const a=await jobs[i],group=groups[i],key=`${group.variant}:${group.players}:${group.street}`,file=`${group.variant}_${group.players}_${group.street}.jsonl.gz`,bytes=zlib.gzipSync(a.map(r=>JSON.stringify(r)).join("\n")+"\n")
   fs.writeFileSync(path.join(out,file),bytes,{flag:"wx"});index[key]={file,rows:a.length,sha256:hash(bytes)};rows.push(...a)
   process.stdout.write(JSON.stringify({phase,completed:i+1,total:groups.length})+"\n")
  }
  const split=key=>Object.fromEntries([...new Set(rows.map(key))].map(k=>[k,metric(rows.filter(r=>key(r)===k))]))
  const handKeys=rows.map(r=>`${r.variant}:${r.players+r.folded}:${r.seed}`)
  if(new Set(handKeys).size!==handKeys.length)throw new Error("Repeated underlying hand in new check; preserve raw results, do not certify independence")
  write("index.json",index)
  write("summary.json",{...metric(rows),groups:split(r=>r.group),byStage:split(r=>r.street),byDeckStage:split(r=>`${r.variant}:${r.street}`),byDepth:split(r=>String(r.depth)),byProfile:split(r=>r.profile),byIncomingCount:split(r=>String(r.count)),duplicateUnderlyingHands:handKeys.length-new Set(handKeys).size,intervals:"Descriptive 95% normal intervals for independent paired hands; subgroups not simultaneous; no adaptive sampling or strict precision gate",policyLimit:"Reuse prior finite heuristic private opportunity fit; NOT retrained to equilibrium or assumed optimal",noRollBaseline:"Act normally now; preserve future paid Roll opportunities",note:"Forced random Roll may have negative EV. Voluntary finite-policy results and loss risk are reported separately. Positive point estimates do not prove every state profitable."})
 }
 main().catch(e=>{process.stderr.write(e.stack+"\n");process.exitCode=1}).finally(()=>Promise.all(pool.map(w=>w.terminate())))
}
