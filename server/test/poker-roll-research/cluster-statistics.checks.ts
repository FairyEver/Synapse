import {expect,it} from "vitest"
import {clusterMoments} from "./cluster-statistics"
it("共享整手种子的多条结果按簇求标准误，不当作更多独立手",()=>{
 const rows=[{key:"a",value:-1},{key:"a",value:1},{key:"b",value:2},{key:"c",value:2}]
 const result=clusterMoments(rows,1.96)
 expect(result.n).toBe(4);expect(result.clusters).toBe(3);expect(result.mean).toBe(1);expect(result.se).toBe(.75)
 const independent=clusterMoments(rows.map((r,i)=>({...r,key:String(i)})),1.96)
 expect(independent.se).toBeCloseTo(Math.SQRT2/2,12)
})
