import { expect,it } from "vitest"
import original from "./loader.cjs"
import fast from "./fast-loader.cjs"
it("只缓存可见牌纯函数，完整配对续局与冻结内核逐字段一致",()=>{
  const slow=original.load("study.ts"),quick=fast.load("study.ts"),price=slow.EXPLORATION_MODEL
  for(const variant of ["standard52","short32"])for(const street of ["preflop","flop","turn"])for(let i=0;i<12;i++){
    const job={variant,players:2+i%9,street,phase:"memoization-parity",model:price,start:0,size:1}
    expect(quick.runRow(job,i)).toEqual(slow.runRow(job,i))
  }
  expect(fast.statistics().hits).toBeGreaterThan(0)
},30000)
