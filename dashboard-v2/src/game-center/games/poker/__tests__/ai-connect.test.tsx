/** @vitest-environment jsdom */
import { act } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, expect, it, vi } from "vitest"
import type { PokerTableView } from "@synapse/shared/game-contracts"
import { usePokerAIConnect } from "../hooks/usePokerAIConnect"
import { tableResponse } from "../../../../../../shared/test/game-response-fixtures"
const api=vi.hoisted(()=>({state:vi.fn(),control:vi.fn(),identity:"ai-connect-user",toast:vi.fn(),danger:vi.fn()}))
vi.mock("@/game-center/runtime/account",()=>({useAccount:()=>({state:{status:"authenticated",connectivity:"online",profile:{user:{id:api.identity}}}})}))
vi.mock("../../../lib/api",()=>({gameApi:()=>({poker:{table:{state:api.state},control:{set:api.control}}})}))
vi.mock("@heroui/react",async original=>({...await original<typeof import("@heroui/react")>(),toast:Object.assign(api.toast,{success:api.toast,danger:api.danger})}))
Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true})
const snapshot:PokerTableView={...tableResponse,roomCode:"3030",mySeatNo:null,seats:[],status:"waiting",controller:null,controlVersion:0,handoffPending:false}
let controls:ReturnType<typeof usePokerAIConnect>
function Harness({table,refresh}:{table:PokerTableView;refresh:()=>void}) {controls=usePokerAIConnect(table,refresh);return null}
afterEach(()=>{api.identity="ai-connect-user";vi.resetAllMocks();document.body.replaceChildren()})
async function mount(){const root=createRoot(document.createElement("div")),refresh=vi.fn();await act(async()=>root.render(<Harness table={snapshot} refresh={refresh}/>));return{root,refresh}}
it("首次授权先权威读取再写入，重复复制不增加版本，取消使用当前版本",async()=>{
 let current={...snapshot};api.state.mockImplementation(async()=>current)
 api.control.mockImplementation(async({action,controlVersion})=>{current={...current,controlVersion:controlVersion+1,handoffPending:action==="request_ai"};return current})
 const copy=vi.fn().mockResolvedValue(undefined);Object.defineProperty(navigator,"clipboard",{configurable:true,value:{writeText:copy}})
 const {root}=await mount()
 try{expect(api.control).not.toHaveBeenCalled();await act(async()=>controls.change("request_ai"));expect(controls.control?.handoffPending).toBe(true)
 expect(api.control).toHaveBeenCalledExactlyOnceWith({roomCode:"3030",action:"request_ai",controlVersion:0})
 expect(api.control.mock.invocationCallOrder[0]).toBeLessThan(copy.mock.invocationCallOrder[0])
 await act(async()=>controls.copy());expect(api.control).toHaveBeenCalledTimes(1)
 await act(async()=>controls.change("cancel_ai"));expect(api.control).toHaveBeenLastCalledWith({roomCode:"3030",action:"cancel_ai",controlVersion:1});expect(controls.control?.handoffPending).toBe(false)
 }finally{await act(async()=>root.unmount())}
})
it("剪贴板失败保留已授权状态，重试只复制",async()=>{
 api.state.mockResolvedValue(snapshot);api.control.mockResolvedValue({controller:null,controlVersion:1,handoffPending:true})
 const copy=vi.fn().mockRejectedValueOnce(new Error("denied")).mockResolvedValue(undefined);Object.defineProperty(navigator,"clipboard",{configurable:true,value:{writeText:copy}})
 const {root}=await mount();try{await act(async()=>controls.change("request_ai"));expect(controls.control?.handoffPending).toBe(true);expect(controls.error).toContain("授权保持不变")
 await act(async()=>controls.copy());expect(controls.error).toBeNull();expect(api.control).toHaveBeenCalledTimes(1)
 }finally{await act(async()=>root.unmount())}
})
it.each(["unmount","identity","room-roundtrip"])("读取期间 %s 后不继续写入或复制",async kind=>{
 let resolve!:(t:PokerTableView)=>void;api.state.mockImplementation(()=>new Promise(done=>{resolve=done}))
 const copy=vi.fn();Object.defineProperty(navigator,"clipboard",{configurable:true,value:{writeText:copy}})
 const {root,refresh}=await mount();let pending!:Promise<void>
 await act(async()=>{pending=controls.change("request_ai")})
 if(kind==="unmount")await act(async()=>root.unmount());else if(kind==="identity"){api.identity="different-user";await act(async()=>root.render(<Harness table={snapshot} refresh={refresh}/>))}else{await act(async()=>root.render(<Harness table={{...snapshot,roomCode:"4040"}} refresh={refresh}/>));await act(async()=>root.render(<Harness table={snapshot} refresh={refresh}/>))}
 await act(async()=>{resolve(snapshot);await pending});expect(api.control).not.toHaveBeenCalled();expect(copy).not.toHaveBeenCalled();expect(refresh).not.toHaveBeenCalled()
 if(kind!=="unmount")await act(async()=>root.unmount())
})
it("未知写入结果重试先读取已生效授权，不重复 request_ai",async()=>{
 let current={...snapshot};api.state.mockImplementation(async()=>current)
 api.control.mockImplementation(async()=>{current={...current,controlVersion:1,handoffPending:true};throw new Error("响应丢失")})
 const copy=vi.fn().mockResolvedValue(undefined);Object.defineProperty(navigator,"clipboard",{configurable:true,value:{writeText:copy}})
 const {root}=await mount();try{await act(async()=>controls.change("request_ai"));await act(async()=>controls.change("request_ai"));expect(api.control).toHaveBeenCalledTimes(1);expect(copy).toHaveBeenCalledOnce();expect(controls.control?.handoffPending).toBe(true)}finally{await act(async()=>root.unmount())}
})
