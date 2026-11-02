import { describe, expect, it } from "vitest"
import { GAME_RESPONSE_SCHEMAS } from "./game-response-schemas.js"
const pending={status:"roll_choice_required",handId:"h",handNo:1,rollId:"r",cardIndex:1,candidates:["As","Kh","Qd"],controlVersion:1,actionSeq:2,deadlineMs:10,cursor:"1:2"}
const roll={enabled:true,coins:{balance:0,limit:12},normal:{fee:4,coinCost:1,available:false,reason:"POKER_ROLL_INSUFFICIENT_COINS"},super:{fee:8,coinCost:3,available:false,reason:"POKER_ROLL_INSUFFICIENT_COINS"}}
describe("Roll coin response validation",()=>{
 it("validates coin offers inside pending wait, while legacy responses remain valid",()=>{
  const schema=GAME_RESPONSE_SCHEMAS["app.game.poker.table.wait"]
  expect(schema.safeParse({...pending,roll}).success).toBe(true)
  expect(schema.safeParse(pending).success).toBe(true)
  for(const coins of [{balance:-1,limit:12},{balance:13,limit:12},{balance:1.5,limit:12},{balance:1,limit:0}])expect(schema.safeParse({...pending,roll:{...roll,coins}}).success).toBe(false)
  expect(schema.safeParse({...pending,roll:{...roll,normal:{...roll.normal,coinCost:0}}}).success).toBe(false)
 })
})
