const fs=require("node:fs"),path=require("node:path")
const {load}=require("./loader.cjs")
require("./engine.cjs").enableRankCache()
const args=process.argv.slice(2),get=(key,fallback)=>{const i=args.indexOf("--"+key);return i<0?fallback:args[i+1]}
const out=get("out"),id=get("id")
if(!out||!id)throw new Error("Required: --out RESULT_DIRECTORY --id PHASE:VARIANT:PLAYERS:STREET:INDEX")
const [phase,variant,players,street,index]=id.split(":"),study=load("study.ts")
const trace=get("trace"),flushTrace=trace?require("./trace.cjs").install(load("simulator.ts"),trace):null
const fitted=JSON.parse(fs.readFileSync(path.join(out,"fitted.json"),"utf8"))
const model=phase==="train"?study.EXPLORATION_MODEL:JSON.parse(fs.readFileSync(get("model",path.join(out,"recommended-model.json")),"utf8"))
const row=study.runRow({phase,variant,players:Number(players),street,start:Number(index),size:1,model,fit:phase==="train"?undefined:fitted.policy,continuation:phase==="train"?"none":get("mode","adaptive")},Number(index))
if(flushTrace)flushTrace()
process.stdout.write(JSON.stringify(row,null,2)+"\n")
