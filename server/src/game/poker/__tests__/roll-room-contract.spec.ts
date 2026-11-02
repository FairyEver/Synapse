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
  it("创建注入服务端roll-v1，缺省/空选项关闭且未知选项拒绝",async()=>{
    const f=setup()
    for(const ruleOptions of [undefined,{}, {roll:false},{roll:true}]) await f.poker.createRoom("u",{name:"test",maxSeats:3,buyIn:500,ruleOptions})
    expect(f.rooms[0].ruleOptions).toBeUndefined();expect(f.rooms[1].ruleOptions).toEqual({});expect(f.rooms[2].ruleOptions).toEqual({roll:false})
    expect(f.rooms[3]).toMatchObject({ruleOptions:{roll:true},rollPricingVersion:"roll-v1"})
    await expect(f.poker.createRoom("u",{name:"test",maxSeats:3,buyIn:500,ruleOptions:{extra:true} as never})).rejects.toThrow()
  })
  it("accepts a custom coin allowance but rejects invalid budgets and configurable costs",async()=>{
    const f=setup()
    await f.poker.createRoom("u",{name:"custom",maxSeats:3,buyIn:500,ruleOptions:{roll:true,rollCoins:21}})
    expect(f.rooms[0].ruleOptions).toEqual({roll:true,rollCoins:21})
    await f.poker.createRoom("u",{name:"default",maxSeats:3,buyIn:500,ruleOptions:{roll:true}})
    expect(f.rooms[1].ruleOptions).toEqual({roll:true,rollCoins:12})
    for(const options of [{roll:true,rollCoins:0},{roll:true,rollCoins:-1},{roll:true,rollCoins:1.5},{roll:true,rollCoins:2147483648},{roll:true,normalCost:2},{roll:true,superCost:4}])
      await expect(f.poker.createRoom("u",{name:"bad",maxSeats:3,buyIn:500,ruleOptions:options as never})).rejects.toThrow()
    expect(f.rooms).toHaveLength(2)
  })
  it("大厅列表与个人历史读取完整不可变规则",async()=>{
    const f=setup();await f.poker.createRoom("u",{name:"test",maxSeats:3,buyIn:500,ruleOptions:{roll:true}})
    expect((await f.read.lobby()).items[0].rules).toMatchObject({ruleOptions:{roll:true},rollPricingVersion:"roll-v1"})
    expect((await f.read.history("u")).items[0].rules).toMatchObject({ruleOptions:{roll:true},rollPricingVersion:"roll-v1"})
  })
})
