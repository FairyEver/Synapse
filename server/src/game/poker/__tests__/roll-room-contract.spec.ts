import { describe,expect,it } from "vitest"
import { PokerService } from "../poker.service"
import { PokerReadService } from "../poker-read.service"
import type { PrismaService } from "../../../prisma/prisma.service"
import type { HallService } from "../../hall/hall.service"
describe("房间规则价格版本快照",()=>{
  function setup(){
    const rooms:Record<string,any>[]=[]
    const prisma={gamePokerRoom:{create:async({data}:any)=>{const r={id:"room",status:"waiting",...data};rooms.push(r);return r},findMany:async({select}:any)=>rooms.map(r=>Object.fromEntries(Object.keys(select).filter(k=>select[k]).map(k=>[k,r[k]])))},gamePokerSeat:{groupBy:async()=>[]},$queryRaw:async()=>[{id:"summary",roomId:"room",handId:"hand",handNo:1,seatNo:0,delta:0,result:"split",holeCards:["As","Kh"],board:[],createdAt:new Date()}]}
    const poker=new PokerService(prisma as unknown as PrismaService,{} as HallService)
    return {poker,read:new PokerReadService(poker),rooms}
  }
  it("新房不启用 Roll，拒绝旧版开关及钻石额度",async()=>{
    const f=setup()
    for(const ruleOptions of [undefined, {}, {roll:false}]) await f.poker.createRoom("u",{name:"test",maxSeats:3,buyIn:1000,ruleOptions})
    expect(f.rooms.map(room => room.ruleOptions)).toEqual([undefined, {}, {roll:false}])
    for(const ruleOptions of [{roll:true}, {roll:true,rollCoins:21}, {rollCoins:21}, {extra:true}])
      await expect(f.poker.createRoom("u",{name:"test",maxSeats:3,buyIn:1000,ruleOptions:ruleOptions as never})).rejects.toThrow()
    expect(f.rooms.every(room => !room.rollPricingVersion)).toBe(true)
  })
  it("大厅列表与个人历史仍读取旧房的不可变规则",async()=>{
    const f=setup()
    f.rooms.push({id:"room",code:"1234",name:"旧房",variant:"standard52",smallBlind:1,bigBlind:2,ruleOptions:{roll:true},rollPricingVersion:"roll-v1"})
    expect((await f.read.lobby()).items[0].rules).toMatchObject({ruleOptions:{roll:true},rollPricingVersion:"roll-v1"})
    expect((await f.read.history("u")).items[0].rules).toMatchObject({ruleOptions:{roll:true},rollPricingVersion:"roll-v1"})
  })
})
