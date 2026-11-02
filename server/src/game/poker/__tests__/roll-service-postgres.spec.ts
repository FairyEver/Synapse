import { joinForStartedHand, prepareAndStartInitialHand } from "./advance-next-hand"
import { afterAll, describe, expect, it } from "vitest"
import { PrismaClient } from "@prisma/client"
import { randomUUID } from "node:crypto"
import type { PrismaService } from "../../../prisma/prisma.service"
import { HallService } from "../../hall/hall.service"
import { PokerService } from "../poker.service"
import { PokerRollService } from "../poker-roll.service"
import { PokerActionService } from "../poker-action.service"
import { PokerWaitService } from "../poker-wait.service"
import { PokerBotService } from "../poker-bot.service"
import { advanceNextHand } from "./advance-next-hand"
import { gameTestDatabaseUrl, legacyGameTestClient } from "./test-database"
const url=gameTestDatabaseUrl()
;(url?describe:describe.skip)("真实PostgreSQL Roll同房事务（仅显式专用_e2e库）",()=>{
  const db=legacyGameTestClient(url ?? "postgresql://localhost/unused_e2e")
  const hall=new HallService(db),poker=new PokerService(db,hall),rolls=new PokerRollService(poker),actions=new PokerActionService(poker),wait=new PokerWaitService(actions)
  afterAll(async()=>{wait.onModuleDestroy();await db.$disconnect()})
  async function setup(){
    const user=randomUUID(),other=randomUUID(),code=(await poker.createRoom(user,{maxSeats:2,buyIn:1000,ruleOptions:{roll:true}})).roomCode
    await joinForStartedHand(poker, user,code,{});await joinForStartedHand(poker, other,code,{})
    const state=await actions.state(user,code),room=await db.gamePokerRoom.findUniqueOrThrow({where:{code}})
    const input={roomCode:code,handId:state.handId!,street:"preflop" as const,expectedActionSeq:0,controlVersion:0,actionId:randomUUID(),kind:"super" as const,cardIndex:0,expectedFee:state.roll.super!.fee}
    return {user,other,code,input,room}
  }
  it("并发同UUID提交仅扣一次、生成一个冻结记录并保留原截止",async()=>{
    const f=await setup(),[a,b]=await Promise.all([rolls.start(f.user,f.input),rolls.start(f.user,f.input)])
    expect(a).toEqual(b)
    expect(await db.gamePokerRoll.count({where:{handId:f.input.handId}})).toBe(1)
    expect(await db.gamePendingTransfer.findMany({where:{settlementId:f.input.handId},take:10})).toMatchObject([{amount:f.input.expectedFee,status:"pending"}])
    expect((await db.gamePokerRoom.findUniqueOrThrow({where:{code:f.code}})).actionDeadlineAt).toEqual(f.room.actionDeadlineAt)
    const seat=await db.gamePokerSeat.findFirstOrThrow({where:{roomId:f.room.id,userId:f.user}})
    expect(await db.gameSession.findFirstOrThrow({where:{gameRoomId:f.room.id,userId:f.user}})).toMatchObject({admissionId:seat.id})
    await expect(rolls.start(f.user,{...f.input,cardIndex:1})).rejects.toThrow()
    expect((await hall.overview(f.other)).points.pending).toBe(f.input.expectedFee)
  })
  it("超时自动选择与普通撤出同事务，永久审计及离桌通知各一次",async()=>{
    const f=await setup();await rolls.start(f.user,f.input)
    const pending=(await actions.state(f.user,f.code)).roll.pending!
    await actions.expire(f.code,f.room.actionDeadlineAt!)
    const rows=await db.gamePokerAction.findMany({where:{handId:f.input.handId},orderBy:{seq:"asc"},take:10})
    expect(rows.map(r=>[r.seq,r.action])).toEqual([[1,"roll_start"],[2,"roll_choose"],[3,"fold"]])
    expect(await db.gamePokerHandSeat.findFirstOrThrow({where:{handId:f.input.handId,userId:f.user}})).toMatchObject({holeCards:expect.arrayContaining([pending.candidates[0]])})
    expect(await wait.wait(f.user,f.code,"",0,undefined,f.room.actionDeadlineAt!)).toMatchObject({status:"table_closed",lastAutoAction:{action:"fold"}})
    expect(await wait.wait(f.user,f.code,"",0,undefined,f.room.actionDeadlineAt!)).not.toHaveProperty("lastAutoAction")
    expect(await db.gamePendingTransfer.count({where:{settlementId:f.input.handId,status:"pending"}})).toBe(0)
  })
  it("奇数费用按庄家左侧分配，超时弃牌离座后仍归原入座，新入座不接收迟到补偿",async()=>{
    const users=[randomUUID(),randomUUID(),randomUUID()]
    const code=randomUUID()
    await db.gamePokerRoom.create({data:{code,ownerUserId:users[0],maxSeats:3,buyIn:2000,ruleOptions:{roll:true},rollPricingVersion:"roll-v1"}})
    await joinForStartedHand(poker, users[0],code,{})
    await joinForStartedHand(poker, users[1],code,{})
    await joinForStartedHand(poker, users[2],code,{})
    async function move(user:string,action:"fold"|"call",now=new Date()){
      const s=await actions.state(user,code)
      await actions.act(user,code,{handId:s.handId!,street:s.street!,expectedActionSeq:s.actionSeq,controlVersion:s.controlVersion,actionId:randomUUID(),action},now)
    }
    await move(users[0],"fold")
    await advanceNextHand(actions,code)
    const state=await actions.state(users[1],code)
    expect(state).toMatchObject({handNo:2,dealerSeat:1,actionOnSeat:1,mySeatNo:1})
    expect(state.roll.normal!.fee).toBe(3)
    const handId=state.handId!,rollId=randomUUID()
    await rolls.start(users[1],{roomCode:code,handId,street:"preflop",expectedActionSeq:state.actionSeq!,controlVersion:state.controlVersion!,actionId:rollId,kind:"normal",cardIndex:0,expectedFee:3})
    const oldSeat=await db.gamePokerSeat.findFirstOrThrow({where:{userId:users[2],roomId:(await db.gamePokerRoom.findUniqueOrThrow({where:{code}})).id}})
    expect(await db.gamePendingTransfer.findMany({where:{sourceId:rollId},orderBy:{amount:"desc"},take:10})).toMatchObject([
      {userId:users[2],admissionId:oldSeat.id,amount:2,status:"pending"},
      {userId:users[0],amount:1,status:"pending"},
    ])
    await move(users[1],"call")
    const deadline=(await db.gamePokerRoom.findUniqueOrThrow({where:{code}})).actionDeadlineAt!
    await actions.expire(code,deadline)
    const afterTimeout=new Date(deadline.getTime()+1)
    expect((await hall.overview(users[2])).points.pending).toBe(2)
    await joinForStartedHand(poker, users[2],code,{},afterTimeout)
    const fresh=await db.gamePokerSeat.findFirstOrThrow({where:{userId:users[2],roomId:oldSeat.roomId}})
    expect(fresh.id).not.toBe(oldSeat.id)
    const before=await db.gameAccount.findUniqueOrThrow({where:{userId:users[2]}})
    await move(users[0],"fold",afterTimeout)
    expect(await db.gamePokerSeat.findUniqueOrThrow({where:{id:fresh.id}})).toMatchObject({stack:2000})
    expect(await db.gameSession.findFirstOrThrow({where:{userId:users[2],gameRoomId:oldSeat.roomId}})).toMatchObject({admissionId:fresh.id,inPlay:2000})
    expect(await db.gamePendingTransfer.findFirstOrThrow({where:{sourceId:rollId,userId:users[2]}})).toMatchObject({admissionId:oldSeat.id,status:"released",releasedTo:"account"})
    const after=await db.gameAccount.findUniqueOrThrow({where:{userId:users[2]}})
    expect(after.points).toBe(before.points+2)
    expect((await hall.overview(users[2])).points.pending).toBe(0)
    await db.$transaction(tx=>hall.releaseTransfers(tx,handId,[],new Date()))
    expect((await db.gameAccount.findUniqueOrThrow({where:{userId:users[2]}})).points).toBe(after.points)
  })
  it("超级待选陪练立即解散只作废练习资产，保留候选审计和原请求回执",async()=>{
    const user=randomUUID(),bots=new PokerBotService(poker)
    const code=(await poker.createRoom(user,{maxSeats:2,buyIn:1000,mode:"practice",ruleOptions:{roll:true}})).roomCode
    await joinForStartedHand(poker, user,code,{})
    const bot=await bots.add(user,code,randomUUID())
    await prepareAndStartInitialHand(poker, code)
    const s=await actions.state(user,code)
    const input={roomCode:code,handId:s.handId!,street:"preflop" as const,expectedActionSeq:s.actionSeq!,controlVersion:s.controlVersion!,actionId:randomUUID(),kind:"super" as const,cardIndex:0,expectedFee:s.roll.super!.fee}
    const result=await rolls.start(user,input)
    expect(await db.gamePendingTransfer.findFirstOrThrow({where:{sourceId:input.actionId}})).toMatchObject({funding:"practice",status:"pending",amount:input.expectedFee})
    await poker.close(user,code)
    expect(await db.gamePokerHand.findUniqueOrThrow({where:{id:input.handId}})).toMatchObject({status:"cancelled"})
    expect(await db.gamePokerRoll.findUniqueOrThrow({where:{id:input.actionId}})).toMatchObject({completedAt:null,data:expect.objectContaining({selectedIndex:null,candidates:expect.any(Array)})})
    expect(await db.gamePendingTransfer.findFirstOrThrow({where:{sourceId:input.actionId}})).toMatchObject({status:"voided",releasedTo:"discard"})
    const botSeat=await db.gamePokerBot.findUniqueOrThrow({where:{id:bot.botId}})
    expect(await db.gameAccount.count({where:{userId:{in:[user,botSeat.id]}}})).toBe(0)
    expect(await db.gameSession.count({where:{userId:botSeat.id}})).toBe(0)
    expect(await rolls.start(user,input)).toEqual(result)
    expect(await db.gamePokerRoll.count({where:{id:input.actionId}})).toBe(1)
    expect(await db.gamePendingTransfer.count({where:{settlementId:input.handId,status:"pending"}})).toBe(0)
  })
})
