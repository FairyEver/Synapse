import {expect,it} from "vitest"
import {spawnSync} from "node:child_process"
import {readFileSync,writeFileSync} from "node:fs"
import {gzipSync,gunzipSync} from "node:zlib"
import {createHash} from "node:crypto"
import path from "node:path"
import loader from "./loader.cjs"
import engine from "./engine.cjs"
import integrity from "./seal.cjs"
it("完整批次恢复保留固定样本，新增整手与原冻结内核相同且不改变预算",()=>{
 engine.enableRankCache()
 const dir=path.resolve(`../.superpowers/sdd/2026-11-01-poker-roll-research/resume-test-${process.pid}`)
 const cli=(name:string,args:string[])=>spawnSync(process.execPath,[path.resolve("test/poker-roll-research/"+name),...args],{encoding:"utf8",timeout:60000})
 const pilot=cli("run.cjs",["pilot","--samples","1","--max-samples","2","--workers","1","--out",dir]);expect(pilot.status,pilot.stderr).toBe(0)
 const read=(name:string)=>JSON.parse(readFileSync(path.join(dir,name),"utf8")),save=(name:string,v:unknown)=>writeFileSync(path.join(dir,name),JSON.stringify(v,null,2)+"\n")
 const fitted=read("fitted.json"),model={...fitted.price,scale:.5},study=loader.load("study.ts"),math=loader.load("math.ts"),rows:any[]=[]
 for(const variant of ["standard52","short32"])for(let players=2;players<=10;players++)for(const street of ["preflop","flop","turn"]){const row=study.runRow({phase:"final-holdout",variant,players,street,model,fit:fitted.policy,start:0,size:1},0);row.ordinal=rows.length;rows.push(row)}
 const z=math.normalQuantile(1-.05/8),summary=study.summarizeRows(rows,model,z)
 const bytes=gzipSync(rows.map(r=>JSON.stringify(r)).join("\n")+"\n")
 writeFileSync(path.join(dir,"final.jsonl.gz"),bytes)
 save("final-index.json",{__single__:{file:"final.jsonl.gz",rows:rows.length,sha256:createHash("sha256").update(bytes).digest("hex")}})
 save("recommended-model.json",model);save("selection.json",{calibrationGatePassed:false});save("final-summary.json",summary);save("fixed-holdout-summary.json",summary);save("inference-design.json",{fixedPerGroup:1,plannedLooks:2,diagnosticZ:z})
 const fixedBefore=readFileSync(path.join(dir,"fixed-holdout-summary.json"),"utf8")
 const resumed=cli("resume.cjs",["--out",dir,"--workers","1"]);expect(resumed.status,resumed.stderr).toBe(0)
 expect(readFileSync(path.join(dir,"fixed-holdout-summary.json"),"utf8")).toBe(fixedBefore)
 const completion=read("completion.json");expect(completion.fixedHoldoutRows).toBe(54);expect(Object.values(completion.counts).every(n=>n===2)).toBe(true)
 const record=read("final-index.json")["standard52:6:flop"],actual=gunzipSync(readFileSync(path.join(dir,record.file))).toString().trim().split("\n").map(line=>JSON.parse(line))[1]
 delete actual.ordinal
 const expected=study.runRow({phase:"final-holdout",variant:"standard52",players:6,street:"flop",model,fit:fitted.policy,start:0,size:1},1)
 expect(actual).toEqual(JSON.parse(JSON.stringify(expected)))
 const verified=cli("verify.cjs",[dir]);expect(verified.status,verified.stderr).toBe(0)
 const acceleration=read("acceleration-manifest.json");acceleration.source["fast-loader.cjs"]="wrong";save("acceleration-manifest.json",acceleration);integrity.seal(dir)
 const rejected=cli("verify.cjs",[dir]);expect(rejected.status).toBe(1);expect(rejected.stderr).toContain("Acceleration source fingerprint mismatch")
},90000)
