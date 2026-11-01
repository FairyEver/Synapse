import {expect,it} from "vitest"
import {spawnSync} from "node:child_process"
import {mkdirSync,writeFileSync,readFileSync,existsSync} from "node:fs"
import {gzipSync} from "node:zlib"
import path from "node:path"
it("仅校准门槛失败也要保留失败并另存未验证修订，负样本不能删除",()=>{
 const dir=path.resolve(`../.superpowers/sdd/2026-11-01-poker-roll-research/revision-test-${process.pid}`);mkdirSync(dir,{recursive:true})
 const save=(name:string,v:unknown)=>writeFileSync(path.join(dir,name),JSON.stringify(v))
 save("completion.json",{netGatePassed:true,calibrationGatePassed:false,precisionGroups:1,totalGroups:1})
 save("recommended-model.json",{scale:.1,curve:"linear",growth:1,coefficients:{normal:[1,0,0],super:[2,0,0]},history:{normal:0,super:0}})
 save("fitted.json",{});save("valuation-manifest.json",{})
 const rows=[{available:true,group:"standard52:6:flop",x:[1,0,0],normal:[-2],super:[3]},{available:true,group:"standard52:6:flop",x:[1,0,0],normal:[1],super:[-5]}]
 writeFileSync(path.join(dir,"values.jsonl.gz"),gzipSync(rows.map(r=>JSON.stringify(r)).join("\n")+"\n"));save("break-even-index.json",{test:{file:"values.jsonl.gz"}})
 const result=spawnSync(process.execPath,[path.resolve("test/poker-roll-research/revision.cjs"),dir],{encoding:"utf8",timeout:10000});expect(result.status,result.stderr).toBe(0)
 expect(existsSync(path.join(dir,"revision-candidate.json"))).toBe(true)
 const revised=JSON.parse(readFileSync(path.join(dir,"revision-candidate.json"),"utf8"));expect(revised.status).toBe("UNVALIDATED_NEXT_ITERATION_ONLY");expect(revised.model.cells["standard52:6:flop"]).toEqual({normal:[0,0,0],super:[0,0,0]})
})
