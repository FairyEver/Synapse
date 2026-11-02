import { randomUUID } from "node:crypto"
import { describe, it, expect } from "vitest"
import { PokerRollService } from "../poker-roll.service"
import { PokerActionService } from "../poker-action.service"
import { PokerWaitService } from "../poker-wait.service"
import { saveHand } from "../poker-lifecycle"
import { quoteRoll, act } from "../engine/hand-runner"
import { rollStore } from "./roll-service-store"
const startInput = (f: Awaited<ReturnType<typeof rollStore>>, kind: "normal" | "super" = "super") => {
  const hand = f.hands[0], state = hand.engineState
  return { roomCode: f.room.code, handId: hand.id, street: state.street, expectedActionSeq: hand.actionSeq, controlVersion: 0, actionId: randomUUID(), kind, cardIndex: 0, expectedFee: quoteRoll(state, state.actionOnSeat)[kind].fee }
}
describe("Roll事务：控制、资金、原入座与恢复", () => {
  it.each(["normal", "super"] as const)("待选直接付费重抽%s，关闭旧待选审计且重试不重复扣费", async kind => {
    const f = await rollStore(), svc = new PokerRollService(f.poker), first = startInput(f), deadline = f.room.actionDeadlineAt
    const user = f.seats.find(s => s.seatNo === f.hands[0].engineState.actionOnSeat)!.userId
    await svc.start(user, first, f.now)
    const second = startInput(f, kind), before = structuredClone(f.hands[0].engineState)
    await expect(svc.start(user, { ...second, expectedFee: second.expectedFee + 1 }, f.now)).rejects.toThrow()
    expect(f.hands[0].engineState).toEqual(before)
    const result = await svc.start(user, second, f.now)
    expect(f.rolls).toHaveLength(2)
    expect(f.rolls[0]).toMatchObject({ completedAt: f.now, data: { selectedIndex: null } })
    expect(f.actions.map(a => [a.seq, a.action])).toEqual([[1, "roll_start"], [2, "roll_start"]])
    expect(f.db.transfers.reduce((n,t) => n + t.amount, 0)).toBe(first.expectedFee + second.expectedFee)
    expect(f.room.actionDeadlineAt).toEqual(deadline)
    const persisted = structuredClone(f.hands[0].engineState)
    expect(await svc.start(user, second, f.now)).toEqual(result)
    expect(f.hands[0].engineState).toEqual(persisted)
    await expect(svc.choose(user, { roomCode: f.room.code, handId: first.handId, rollId: first.actionId, candidateIndex: 0, expectedActionSeq: 2, controlVersion: 0, actionId: randomUUID() }, f.now)).rejects.toThrow()
    expect(f.hands[0].engineState).toEqual(persisted)
  })
  it("持久扣费和原入座冻结，同UUID重试不重抽且不续截止", async () => {
    const f = await rollStore(), svc = new PokerRollService(f.poker), input = startInput(f), deadline = f.room.actionDeadlineAt
    const user = f.seats.find(s => s.seatNo === f.hands[0].engineState.actionOnSeat)!.userId
    const result = await svc.start(user, input, new Date(f.now.getTime() + 2000))
    const persisted = structuredClone(f.hands[0].engineState)
    expect(f.room.actionDeadlineAt).toEqual(deadline)
    expect(f.rolls).toHaveLength(1)
    expect(f.actions[0]).toMatchObject({ action: "roll_start", amount: 0, rollId: input.actionId, seq: 1 })
    expect(f.receipts[0].requestHash).toMatch(/^[a-f0-9]{64}$/)
    expect(f.db.transfers.reduce((n,t) => n+t.amount,0)).toBe(input.expectedFee)
    expect(f.db.locks.slice(0,3)).toEqual(["u", "u1", "u2"])
    expect(await new PokerRollService(f.poker).start(user, input, new Date(deadline.getTime()+1))).toEqual(result)
    expect(f.hands[0].engineState).toEqual(persisted)
    await expect(svc.start(user, { ...input, cardIndex: 1 })).rejects.toThrow()
    expect(f.db.transfers).toHaveLength(2)
  })
  it("待选拒绝普通下注、过期选择与旧控制；新控制可恢复且原始牌不变", async () => {
    const f = await rollStore(), svc = new PokerRollService(f.poker), input = startInput(f)
    const seat = f.seats.find(s => s.seatNo === f.hands[0].engineState.actionOnSeat)!, original = [...f.hands[0].engineState.seats.find((s:any)=>s.seatNo===seat.seatNo).hole]
    await svc.start(seat.userId,input,f.now)
    await expect(new PokerActionService(f.poker).act(seat.userId,f.room.code,{ handId: input.handId, street: input.street, actionId: randomUUID(), action: "call", expectedActionSeq:1,controlVersion:0 },f.now)).rejects.toThrow()
    const choose = { roomCode:f.room.code, handId:input.handId,rollId:input.actionId,candidateIndex:1,expectedActionSeq:1,controlVersion:0,actionId:randomUUID() }
    await expect(svc.choose(seat.userId,choose,f.room.actionDeadlineAt)).rejects.toThrow()
    const current = f.seats.find(s => s.userId === seat.userId)!
    current.controller="human"; current.controlVersion=1
    await expect(svc.choose(seat.userId,choose,f.now)).rejects.toThrow()
    const candidate = f.hands[0].engineState.roll.pending.candidates[1]
    await svc.choose(seat.userId,{ ...choose,controlVersion:1 },f.now,"human")
    expect(f.hands[0].engineState.roll.pending).toBeNull()
    expect(f.participants.find(p=>p.userId===seat.userId)).toMatchObject({originalHoleCards:original,holeCards:[candidate,original[1]]})
  })
  it("超时先选第一张再撤出，事件序号不冲突且不重复退款", async () => {
    const f = await rollStore(), svc = new PokerRollService(f.poker), input=startInput(f), user=f.seats.find(s=>s.seatNo===f.hands[0].engineState.actionOnSeat)!.userId
    await svc.start(user,input,f.now)
    const candidate=f.hands[0].engineState.roll.pending.candidates[0]
    await new PokerActionService(f.poker).expire(f.room.code,f.room.actionDeadlineAt)
    expect(f.actions.map(a=>[a.seq,a.action])).toEqual([[1,"roll_start"],[2,"roll_choose"],[3,"fold"]])
    expect(f.participants.find(p=>p.userId===user).holeCards[0]).toBe(candidate)
    expect(f.seats.some(s=>s.userId===user)).toBe(false)
    expect(f.db.sessions.find(s=>s.userId===user)?.status).toBe("closed")
  })
  it("取消单人陪练作废冻结但保留手牌和Roll审计，机器人没有Hall会话", async () => {
    const f=await rollStore("practice",2); f.seats[1].participantKind="bot"; f.participants[1].participantKind="bot"; f.db.sessions.splice(1,1)
    const svc=new PokerRollService(f.poker),input=startInput(f)
    await svc.start("u",input,f.now)
    await f.poker.close("u",f.room.code,f.now)
    expect(f.hands[0].status).toBe("cancelled");expect(f.rolls).toHaveLength(1)
    expect(f.db.transfers.every(t=>t.status==="voided")).toBe(true)
    expect(f.db.sessions).toHaveLength(1)
  })
})

describe("Roll服务端投影与结算", () => {
  it("公共/教学不泄漏候选；本人等待可恢复，跨操作UUID不能确认未执行下注", async () => {
    const f=await rollStore(), svc=new PokerRollService(f.poker), actions=new PokerActionService(f.poker), input=startInput(f), user=f.seats.find(s=>s.seatNo===f.hands[0].engineState.actionOnSeat)!.userId
    await svc.start(user,input,f.now)
    for (const audience of ["decision","desktop"] as const) {
      const view=await actions.state(user,f.room.code,"public",false,f.now,audience)
      expect(JSON.stringify(view)).not.toContain('candidates')
      expect(view.recentActions).toEqual([])
    }
    const own=await actions.state(user,f.room.code,"owner",false,f.now)
    expect(own.roll.pending?.candidates).toHaveLength(3)
    expect(own.legalActions).toEqual([])
    const wait=new PokerWaitService(actions)
    try { expect(await wait.wait(user,f.room.code,"",0,undefined,f.now)).toMatchObject({status:"roll_choice_required",rollId:input.actionId,actionSeq:1}) } finally {wait.onModuleDestroy()}
    await expect(actions.act(user,f.room.code,{handId:input.handId,street:input.street,action:"call",actionId:input.actionId,controlVersion:0,expectedActionSeq:1},f.now)).rejects.toThrow()
    expect(f.actions).toHaveLength(1)
  })
  it("已退原入座只到账补偿，新入座不接旧stack；桌内释放不重复增加", async () => {
    const f=await rollStore(), svc=new PokerRollService(f.poker), input=startInput(f,"normal")
    const actor=f.seats.find(s=>s.seatNo===f.hands[0].engineState.actionOnSeat)!, recipient=f.seats.find(s=>s.userId!==actor.userId)!
    await svc.start(actor.userId,input,f.now)
    const credit=f.db.transfers.find(t=>t.userId===recipient.userId)!.amount
    await f.transact(async c=>{const original=c.seats.find(s=>s.id===recipient.id)!; await f.poker.refund(c,original)})
    const afterRefund=f.db.accounts.get(recipient.userId)!.points
    const fresh={...recipient,id:"new-admission",joinedHandNo:2,stack:500,status:"waiting"};f.seats.push(fresh)
    await f.db.transaction(tx=>f.hall.join(tx,recipient.userId,{admissionId:fresh.id,gameKind:"poker",gameRoomId:f.room.id,roomCode:f.room.code,seatNo:fresh.seatNo,buyIn:500},f.now))
    let h=f.hands[0].engineState
    while(h.street!=="settled") h=act(h,h.actionOnSeat,{action:"fold"})
    await f.transact(c=>saveHand(f.poker,c,f.hands[0],h))
    expect(f.db.accounts.get(recipient.userId)!.points).toBe(afterRefund-500+credit)
    expect(f.seats.find(s=>s.id===fresh.id)?.stack).toBe(500)
    expect(f.db.sessions.find(s=>s.userId===recipient.userId)).toMatchObject({admissionId:fresh.id,inPlay:500})
    expect(f.db.transfers.find(t=>t.userId===recipient.userId)).toMatchObject({releasedTo:"account"})
    const active=f.seats.find(s=>s.userId!==recipient.userId)!
    expect(f.db.sessions.find(s=>s.userId===active.userId)?.inPlay).toBe(h.seats.find((s:any)=>s.seatNo===active.seatNo).stack)
    expect(f.db.transfers.every(t=>t.status==="released")).toBe(true)
  })
})
