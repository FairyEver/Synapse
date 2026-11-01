import { afterAll, describe, expect, it } from "vitest"
import { PrismaClient } from "@prisma/client"
import { randomUUID } from "node:crypto"
import type { PrismaService } from "../../../prisma/prisma.service"
import { HallService } from "../../hall/hall.service"
import { PokerService } from "../poker.service"
import { PokerRollService } from "../poker-roll.service"
import { PokerActionService } from "../poker-action.service"
import { PokerWaitService } from "../poker-wait.service"
import { gameTestDatabaseUrl } from "./test-database"
const url=gameTestDatabaseUrl()
;(url?describe:describe.skip)("真实PostgreSQL Roll同房事务（仅显式专用_e2e库）",()=>{
  const db=new PrismaClient({datasources:{db:{url:url??"postgresql://localhost/unused_e2e"}}}) as PrismaService
  const hall=new HallService(db),poker=new PokerService(db,hall),rolls=new PokerRollService(poker),actions=new PokerActionService(poker),wait=new PokerWaitService(actions)
  afterAll(async()=>{wait.onModuleDestroy();await db.$disconnect()})
  async function setup(){
    const user=randomUUID(),other=randomUUID(),code=(await poker.createRoom(user,{maxSeats:2,buyIn:500,ruleOptions:{roll:true}})).roomCode
    await poker.join(user,code,{});await poker.join(other,code,{})
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
})
