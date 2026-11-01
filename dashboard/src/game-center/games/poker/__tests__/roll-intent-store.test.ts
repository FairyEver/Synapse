/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest"
const scope={identityKey:"account-a",roomCode:"1234"}
const start={operation:"start" as const,input:{roomCode:"1234",handId:"old-hand",street:"flop" as const,expectedActionSeq:7,controlVersion:3,actionId:"8529bfca-a8e8-4de4-89da-162f516d2f01",kind:"super" as const,cardIndex:1,expectedFee:8}}
afterEach(()=>{sessionStorage.clear();vi.restoreAllMocks();vi.resetModules()})
describe("Roll会话恢复记录",()=>{
 it.each(["start","choose"])("%s在模块重新加载后保持完整旧UUID/控制/序号，且不混账号或房间",async(operation)=>{
  const first=await import("../lib/roll-intent-store")
  const intent=operation==="start"?start:{operation:"choose" as const,input:{roomCode:"1234",handId:"old-hand",rollId:start.input.actionId,candidateIndex:2,expectedActionSeq:8,controlVersion:3,actionId:"8529bfca-a8e8-4de4-89da-162f516d2f02"}}
  first.rollIntentStore.save(scope,intent)
  vi.resetModules()
  const fresh=await import("../lib/roll-intent-store")
  expect(fresh.rollIntentStore.getSnapshot(scope).intent).toEqual(intent)
  expect(fresh.rollIntentStore.getSnapshot({...scope,identityKey:"account-b"}).intent).toBeNull()
  expect(fresh.rollIntentStore.getSnapshot({...scope,roomCode:"5678"}).intent).toBeNull()
 })
 it.each(["scope","room","extra","index","uuid","json"])("%s损坏记录不得恢复为可支付意图，保留并显式报错",async(kind)=>{
  const first=await import("../lib/roll-intent-store");first.rollIntentStore.save(scope,start)
  const key=sessionStorage.key(0)!,raw=JSON.parse(sessionStorage.getItem(key)!)
  if(kind==="scope")raw.identityKey="other"
  if(kind==="room")raw.intent.input.roomCode="5678"
  if(kind==="extra")raw.intent.input.source="human"
  if(kind==="index")raw.intent.input.cardIndex=2
  if(kind==="uuid")raw.intent.input.actionId="invalid"
  const corrupt=kind==="json"?"{broken":JSON.stringify(raw)
  sessionStorage.setItem(key,corrupt);vi.resetModules()
  const fresh=await import("../lib/roll-intent-store"),snapshot=fresh.rollIntentStore.getSnapshot(scope)
  expect(snapshot.intent).toBeNull();expect(snapshot.error).toContain("恢复记录")
  expect(sessionStorage.getItem(key)).toBe(corrupt)
 })
 it("已有未确认意图不能被另一个UUID覆盖，清理失败继续原UUID恢复",async()=>{
  const {rollIntentStore:store}=await import("../lib/roll-intent-store")
  store.save(scope,start)
  expect(()=>store.save(scope,{...start,input:{...start.input,actionId:"8529bfca-a8e8-4de4-89da-162f516d2f03"}})).toThrow(/恢复记录/)
  const failure=vi.spyOn(Storage.prototype,"removeItem").mockImplementation(()=>{throw new Error("denied")})
  store.clear(scope,start)
  expect(store.getSnapshot(scope).intent).toEqual(start);expect(store.getSnapshot(scope).error).toContain("清理失败")
  failure.mockRestore();store.clear(scope,start);expect(store.getSnapshot(scope).intent).toBeNull()
 })
 it("清理只匹配原意图并通知同scope订阅者",async()=>{
  const {rollIntentStore:store}=await import("../lib/roll-intent-store")
  store.save(scope,start);const changed=vi.fn(),stop=store.subscribe(scope,changed)
  const next={...start,input:{...start.input,actionId:"8529bfca-a8e8-4de4-89da-162f516d2f03"}}
  store.clear(scope,next);expect(store.getSnapshot(scope).intent).toEqual(start)
  store.clear(scope,start);expect(store.getSnapshot(scope).intent).toBeNull();expect(changed).toHaveBeenCalledOnce()
  expect(sessionStorage.length).toBe(0);stop()
 })
 it("无法读取或写入时显式失败，不假装已经安全持久保存",async()=>{
  const {rollIntentStore:store}=await import("../lib/roll-intent-store")
  const deny=vi.spyOn(Storage.prototype,"setItem").mockImplementation(()=>{throw new Error("disabled")})
  expect(()=>store.save(scope,start)).toThrow(/恢复记录/);deny.mockRestore()
  const read=vi.spyOn(Storage.prototype,"getItem").mockImplementation(()=>{throw new Error("disabled")})
  expect(store.reload(scope).error).toContain("恢复记录");read.mockRestore()
 })
})
