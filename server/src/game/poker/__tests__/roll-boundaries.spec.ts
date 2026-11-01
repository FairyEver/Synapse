import { randomUUID } from "node:crypto"
import { describe, it, expect, vi } from "vitest"
import { PokerRollService } from "../poker-roll.service"
import { PokerActionService } from "../poker-action.service"
import { PokerReadService } from "../poker-read.service"
import { PokerEventsService } from "../poker-events.service"
import { PokerWaitService } from "../poker-wait.service"
import { GameApiService } from "../../game-api.service"
import { GameController } from "../../game.controller"
import { quoteRoll, startHand } from "../engine/hand-runner"
import { orderedDeck } from "../engine/deck"
import { archiveData } from "../poker-archive.service"
import { rollStore } from "./roll-service-store"
async function setup(mode="points",count=3) {
  const f=await rollStore(mode,count), svc=new PokerRollService(f.poker), actions=new PokerActionService(f.poker)
  const hand=f.hands[0], seat=f.seats.find(s=>s.seatNo===hand.engineState.actionOnSeat)!
  const input={roomCode:f.room.code,handId:hand.id,street:"preflop" as const,expectedActionSeq:0,controlVersion:0,actionId:randomUUID(),kind:"super" as const,cardIndex:0,expectedFee:quoteRoll(hand.engineState,seat.seatNo).super.fee}
  return {...f,svc,actionService:actions,seat,input}
}
describe("Roll请求校验与原始身份",()=>{
  it.each([{expectedFee:9999},{expectedActionSeq:2},{controlVersion:8},{handId:"old"},{street:"flop"},{cardIndex:2},{actionId:"not-uuid"}])("拒绝过期或非法请求且无资产/牌面变化 %j",async patch=>{
    const f=await setup(),before=structuredClone(f.hands[0].engineState)
    await expect(f.svc.start(f.seat.userId,{...f.input,...patch} as typeof f.input,f.now)).rejects.toThrow()
    expect(f.hands[0].engineState).toEqual(before);expect(f.rolls).toEqual([]);expect(f.db.transfers).toEqual([]);expect(f.actions).toEqual([])
  })
  it("新入座复用同账号同seatNo仍不能获得候选或继续原选择",async()=>{
    const f=await setup();await f.svc.start(f.seat.userId,f.input,f.now)
    f.seats.find(s=>s.userId===f.seat.userId)!.id="replacement"
    const view=await f.actionService.state(f.seat.userId,f.room.code,"owner",false,f.now)
    expect(view.roll).not.toHaveProperty("pending");expect(view.hole).toEqual([]);expect(view.legalActions).toEqual([])
    await expect(f.svc.choose(f.seat.userId,{roomCode:f.room.code,handId:f.input.handId,rollId:f.input.actionId,candidateIndex:0,expectedActionSeq:1,controlVersion:0,actionId:randomUUID()},f.now)).rejects.toThrow()
  })
  it("完成选择的永久确认可在归档/退座/旧epoch后恢复；跨操作重用拒绝",async()=>{
    const f=await setup();await f.svc.start(f.seat.userId,f.input,f.now)
    const input={roomCode:f.room.code,handId:f.input.handId,rollId:f.input.actionId,candidateIndex:0,expectedActionSeq:1,controlVersion:0,actionId:randomUUID()}
    const result=await f.svc.choose(f.seat.userId,input,f.now)
    f.hands.splice(0);f.seats.splice(0)
    expect(await f.svc.choose(f.seat.userId,input,f.now)).toEqual(result)
    await expect(f.svc.start(f.seat.userId,{...f.input,actionId:input.actionId},f.now)).rejects.toThrow()
    await expect(f.svc.choose("intruder",input,f.now)).rejects.toThrow()
    await expect(f.svc.choose(f.seat.userId,{...input,candidateIndex:1},f.now)).rejects.toThrow()
    expect(f.actions).toHaveLength(2)
  })
})
describe("真实服务组合：读模型、调度与接口",()=>{
  it("热/冷明细只给本人私有记录；公共事件独立于下注并且旧归档rolls为空",async()=>{
    const f=await setup();await f.svc.start(f.seat.userId,f.input,f.now)
    const read=new PokerReadService(f.poker)
    const owner=await read.detail(f.seat.userId,f.room.code,1), other=f.seats.find(s=>s.userId!==f.seat.userId)!
    expect(owner.privateRolls).toHaveLength(1)
    const detail=await read.detail(other.userId,f.room.code,1)
    expect(detail.privateRolls).toEqual([]);expect(detail.actions).toEqual([])
    expect(Object.keys(detail.rollHistory[0]).sort()).toEqual(["compensations","count","displayName","fee","kind","phase","seatNo","source"].sort())
    const at=new Date();f.hands[0].startedAt=at;f.actions[0].createdAt=at
    const feed=await new PokerEventsService(f.poker).events(other.userId,f.room.code,"1:0")
    expect(feed.events).toMatchObject([{kind:"roll",seq:1,roll:{phase:"start",fee:f.input.expectedFee}}])
    expect(JSON.stringify(feed)).not.toContain("candidates")
    const hand={...f.hands[0]};delete hand.engineState
    const data={hand,seats:structuredClone(f.participants),actions:structuredClone(f.actions),summaries:[],rolls:structuredClone(f.rolls)}
    f.archives.push({id:hand.id,roomId:f.room.id,handNo:1,participantIds:f.participants.map(p=>p.userId),data});f.hands.splice(0)
    expect((await read.detail(f.seat.userId,f.room.code,1)).privateRolls).toEqual(owner.privateRolls)
    expect((await read.detail(other.userId,f.room.code,1)).privateRolls).toEqual([])
    expect(archiveData({...data,rolls:undefined} as never).rolls).toEqual([])
  })
  it("正常全下形成边池，补偿释放后守恒，普通派彩与pokerDelta独立",async()=>{
    const f=await setup();await f.svc.start(f.seat.userId,{...f.input,kind:"normal",expectedFee:quoteRoll(f.hands[0].engineState,f.seat.seatNo).normal.fee},f.now)
    f.db.locks.length=0
    while(f.hands[0].status!=="settled") {
      const hand=f.hands[0],seat=f.seats.find(s=>s.seatNo===hand.engineState.actionOnSeat)!
      await f.actionService.act(seat.userId,f.room.code,{handId:hand.id,street:hand.street,expectedActionSeq:hand.actionSeq,controlVersion:0,actionId:randomUUID(),action:"allin"},f.now)
    }
    expect(f.db.locks.slice(0,3)).toEqual(["u","u1","u2"])
    const h=f.hands[0].engineState
    expect(h.pots.length).toBeGreaterThan(1)
    expect(h.seats.reduce((n:number,s:any)=>n+s.stack,0)).toBe(1500)
    expect(f.db.sessions.reduce((n,s)=>n+s.inPlay,0)+[...f.db.accounts.values()].reduce((n,a)=>n+a.points,0)).toBe(30000)
    expect(f.db.transfers.every(t=>t.status==="released")).toBe(true)
    const view=await f.actionService.state(f.seat.userId,f.room.code,"owner",false,f.now)
    expect(view.settlement!.seats.reduce((n,s)=>n+s.pokerDelta!,0)).toBe(0)
    for(const s of view.settlement!.seats) expect(s.pokerDelta).toBe(s.delta+s.rollPaid!-s.rollReceived!)
    expect(Object.values(h.payouts).reduce((n:any,v:any)=>n+v,0)).toBe(h.seats.reduce((n:number,s:any)=>n+s.total,0))
  })
  it("重启调度一次仅提交一个Roll动作，旧计划不重放且不刷新真人lastSeen",async()=>{
    const f=await setup("practice",2), bot=f.seats[0]
    bot.participantKind="bot";f.participants[0].participantKind="bot";f.db.sessions.splice(0,1)
    const h=startHand([{seatNo:0,stack:500},{seatNo:1,stack:500}],0,["As","2s","Kh","3h",...orderedDeck().filter(c=>!["As","2s","Kh","3h"].includes(c))],{ruleOptions:{roll:true},rollPricingVersion:"roll-v1"})
    // Ordered low cards create a visible positive improvement opportunity.
    f.hands[0].engineState=h
    f.participants.forEach(p=>{p.holeCards=h.seats.find(s=>s.seatNo===p.seatNo)!.hole;p.originalHoleCards=p.holeCards})
    f.room.botActionAt=new Date(f.now.getTime()+1000)
    const old=f.room.botActionAt,seen=f.seats[1].lastSeenAt,deadline=f.room.actionDeadlineAt
    await new PokerActionService(f.poker).actBot(f.room.code,{handId:f.hands[0].id,scheduledAt:old},old)
    expect(f.actions).toHaveLength(1);expect(f.actions[0].action).toBe("roll_start")
    expect(f.room.actionDeadlineAt).toEqual(deadline);expect(f.seats[1].lastSeenAt).toEqual(seen)
    await new PokerActionService(f.poker).actBot(f.room.code,{handId:f.hands[0].id,scheduledAt:old},old)
    expect(f.actions).toHaveLength(1)
    if(f.hands[0].engineState.roll.pending) {
      await new PokerActionService(f.poker).actBot(f.room.code,{handId:f.hands[0].id,scheduledAt:f.room.botActionAt},f.room.botActionAt)
      expect(f.actions).toHaveLength(2);expect(f.actions[1].action).toBe("roll_choose");expect(f.db.transfers.length).toBe(1)
    }
  })
  it("机器人待选重启后只完成候选，不二次扣费或创建Hall会话",async()=>{
    const f=await setup("practice",2),bot=f.seats[0]
    bot.participantKind="bot";f.participants[0].participantKind="bot";f.db.sessions.splice(0,1)
    await f.transact(c=>f.svc.submit(c,bot.userId,"start",f.input,"rules_bot"))
    const transfers=structuredClone(f.db.transfers),deadline=f.room.actionDeadlineAt,stack=f.seats[0].stack
    await new PokerActionService(f.poker).actBot(f.room.code,{handId:f.input.handId,scheduledAt:f.room.botActionAt},f.room.botActionAt)
    expect(f.actions.map(a=>a.action)).toEqual(["roll_start","roll_choose"])
    expect(f.rolls[0].data.selectedIndex).not.toBeNull();expect(f.hands[0].engineState.roll.pending).toBeNull()
    expect(f.db.transfers).toEqual(transfers);expect(f.seats[0].stack).toBe(stack);expect(f.room.actionDeadlineAt).toEqual(deadline)
    expect(f.db.sessions.some(s=>s.userId===bot.userId)).toBe(false)
  })
  it("REST固定真人来源，AI能力使用同一服务和报价校验",async()=>{
    const f=await setup(),wait=new PokerWaitService(f.actionService),read=new PokerReadService(f.poker)
    const api=new GameApiService(f.hall,f.poker,f.actionService,wait,read,{} as never)
    const controller=new GameController(api,f.actionService,f.poker)
    f.room.actionDeadlineAt=new Date(Date.now()+600000);f.seats.find(s=>s.id===f.seat.id)!.controller="human"
    try {
      await expect(api.run(f.seat.userId,"app.game.poker.roll.start",f.input)).rejects.toThrow()
      await controller.rollStart({user:{id:f.seat.userId}} as never,f.room.code,f.input)
      expect(f.actions[0].actionSource).toBe("human")
      const choice={roomCode:f.room.code,handId:f.input.handId,rollId:f.input.actionId,candidateIndex:0,expectedActionSeq:1,controlVersion:0,actionId:randomUUID()}
      await controller.rollChoose({user:{id:f.seat.userId}} as never,f.room.code,choice)
      expect(f.actions[1].actionSource).toBe("human")
      await expect(api.run(f.seat.userId,"app.game.poker.roll.start",{...f.input,source:"rules_bot"})).rejects.toThrow()
    } finally {wait.onModuleDestroy()}
  })
})

describe("超时离桌通知",()=>{
  it("自动选牌与撤出同时间只通知实际check/fold一次，Roll不成为lastAutoAction",async()=>{
    const f=await setup();await f.svc.start(f.seat.userId,f.input,f.now)
    await f.actionService.expire(f.room.code,f.room.actionDeadlineAt)
    const selection=f.actions.find(a=>a.action==="roll_choose")!
    expect(selection).toMatchObject({actionSource:"timeout",isAuto:true})
    selection.id="zzzz"
    const terminal=f.actions.find(a=>["check","fold"].includes(a.action))!;terminal.id="aaaa"
    const wait=new PokerWaitService(f.actionService)
    try {
      expect(await wait.wait(f.seat.userId,f.room.code,"",0,undefined,f.now)).toMatchObject({status:"table_closed",lastAutoAction:{action:terminal.action,reason:"timeout"}})
      expect(await wait.wait(f.seat.userId,f.room.code,"",0,undefined,f.now)).not.toHaveProperty("lastAutoAction")
      expect(f.db.sessions.find(s=>s.userId===f.seat.userId)!.lastEventId).toBe(terminal.id)
    } finally {wait.onModuleDestroy()}
  })
})

describe("事务落库与控制恢复",()=>{
  it("真实join预生成座位身份并交给Hall，后续开局冻结规则与原始牌",async()=>{
    const f=await setup()
    f.db.accounts.set("new-user",{userId:"new-user",points:10000,netProfit:0,lastGrantAt:null})
    await f.poker.join("new-user",f.room.code,{},f.now,"human")
    const seat=f.seats.find(s=>s.userId==="new-user")!,session=f.db.sessions.find(s=>s.userId==="new-user")!
    expect(seat.id).toMatch(/^[a-f0-9-]{36}$/);expect(session.admissionId).toBe(seat.id)
    expect(f.hands[0].rules).toMatchObject({ruleOptions:{roll:true},rollPricingVersion:"roll-v1"})
    for(const p of f.participants) {expect(p.admissionId).toBe(f.seats.find(s=>s.userId===p.userId)!.id);expect(p.originalHoleCards).toEqual(p.holeCards)}
    expect(f.participants.some(p=>p.userId==="new-user")).toBe(false)
  })
  it("接管与交回AI均保持待选与截止，旧epoch仅可确认既有开始",async()=>{
    const f=await setup(),result=await f.svc.start(f.seat.userId,f.input,f.now),pending=structuredClone(f.hands[0].engineState.roll.pending),deadline=f.room.actionDeadlineAt
    const takeover=await f.poker.control(f.seat.userId,f.room.code,"takeover",0,f.now)
    expect(f.hands[0].engineState.roll.pending).toEqual(pending)
    expect(await f.svc.start(f.seat.userId,f.input,f.now)).toEqual(result)
    const choose={roomCode:f.room.code,handId:f.input.handId,rollId:f.input.actionId,candidateIndex:0,expectedActionSeq:1,controlVersion:0,actionId:randomUUID()}
    await expect(f.svc.choose(f.seat.userId,choose,f.now)).rejects.toThrow()
    const handoff=await f.poker.control(f.seat.userId,f.room.code,"request_ai",takeover.controlVersion,f.now)
    const claimed=await f.poker.claim(f.seat.userId,f.room.code,handoff.controlVersion,f.now)
    expect(f.hands[0].engineState.roll.pending).toEqual(pending);expect(f.room.actionDeadlineAt).toEqual(deadline)
    await f.svc.choose(f.seat.userId,{...choose,controlVersion:claimed.controlVersion},f.now)
    expect(f.hands[0].engineState.roll.pending).toBeNull();expect(f.room.actionDeadlineAt).toEqual(deadline)
  })
  it("写入确认失败时同事务撤销Roll、事件、冻结与牌面",async()=>{
    const f=await setup(),before=structuredClone(f.hands[0].engineState),sessions=structuredClone(f.db.sessions)
    await expect(f.transact(async c=>{
      vi.spyOn(c.tx.gamePokerActionReceipt,"create").mockRejectedValue(new Error("persistence failed"))
      return f.svc.submit(c,f.seat.userId,"start",f.input,"mcp")
    })).rejects.toThrow("persistence failed")
    expect(f.hands[0].engineState).toEqual(before);expect(f.db.sessions).toEqual(sessions)
    expect(f.rolls).toEqual([]);expect(f.actions).toEqual([]);expect(f.db.transfers).toEqual([]);expect(f.receipts).toEqual([])
  })
})

describe("普通行动历史窗口",()=>{
  it("大量Roll事件不能挤走决策所需的最近普通下注",async()=>{
    const f=await setup();await f.svc.start(f.seat.userId,f.input,f.now)
    const template=f.actions[0]
    f.actions.unshift({...template,id:"ordinary",action:"call",rollId:null,seq:0,amount:2})
    for(let seq=2;seq<=32;seq++) f.actions.push({...template,id:`roll-event-${seq}`,seq})
    const view=await f.actionService.state(f.seat.userId,f.room.code,"owner",false,f.now)
    expect(view.recentActions.map(a=>a.action)).toEqual(["call"])
  })
})
