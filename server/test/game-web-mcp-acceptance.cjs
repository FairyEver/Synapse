/* Manual Web/local-MCP acceptance; synthetic accounts and loopback only. No tokens on disk. */
const { spawn } = require('node:child_process')
const { createInterface } = require('node:readline')
const { randomUUID } = require('node:crypto')
const [base, fixture, roomCode, mode = 'inspect'] = process.argv.slice(2)
if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(base ?? '') || !/^\d{4,6}$/.test(roomCode ?? '')) throw Error('Loopback fixture and room required')
if (!process.env.GAME_WEB_QA_EMAIL?.endsWith('@example.test') || !process.env.GAME_WEB_QA_PASSWORD) throw Error('Synthetic test account required')
async function run() {
  const login = await fetch(`${base}/api/auth/login`, {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:process.env.GAME_WEB_QA_EMAIL,password:process.env.GAME_WEB_QA_PASSWORD})})
  if(!login.ok) throw Error(`Test login: ${login.status}`)
  const token = (await login.json()).accessToken
  const meResponse = await fetch(`${base}/api/auth/me`, {headers:{Authorization:`Bearer ${token}`}})
  if(!meResponse.ok) throw Error(`Test identity: ${meResponse.status}`)
  const me = await meResponse.json(), userId = me.user.id
  const child=spawn(process.execPath,[fixture,base,userId],{stdio:['pipe','pipe','inherit'],env:{...process.env,GAME_EVAL_ACCESS_TOKEN:token}})
  const pending=new Map();let id=0
  createInterface({input:child.stdout}).on('line',line=>{const message=JSON.parse(line),entry=pending.get(message.id);if(entry){pending.delete(message.id);clearTimeout(entry.timer);message.error?entry.reject(Error(message.error.message)):entry.resolve(message.result)}})
  const rpc=(method,params={})=>new Promise((resolve,reject)=>{const requestId=++id;const timer=setTimeout(()=>{pending.delete(requestId);reject(Error('MCP timeout'))},30000);pending.set(requestId,{resolve,reject,timer});child.stdin.write(JSON.stringify({jsonrpc:'2.0',id:requestId,method,params})+'\n')})
  const invoke=async(toolName,args={})=>{
    const result=await rpc('tools/call',{name:'invoke',arguments:{toolName,arguments:args}})
    const text=result.content?.find(item=>item.type==='text')?.text
    if(result.isError) throw Error(text || 'MCP failed')
    const value=JSON.parse(text)
    if(value.ok===false) throw Error(`${value.code}: ${value.error}`)
    return value.data ?? value
  }
  try {
    await rpc('initialize',{protocolVersion:'2024-11-05',capabilities:{},clientInfo:{name:'game-web-qa',version:'1'}})
    const list=await rpc('tools/list')
    if(list.tools.map(tool=>tool.name).sort().join(',')!=='invoke,search')throw Error('Unexpected public MCP surface')
    const overview=await invoke('app_game_hall_overview')
    let state=await invoke('app_game_poker_table_state',{roomCode})
    const report={publicTools:list.tools.map(tool=>tool.name),sameAccountSession:overview.sessions.some(session=>session.roomCode===roomCode),roomCode,controller:state.controller,controlVersion:state.controlVersion,handoffPending:state.handoffPending}
    if(mode==='accept') {
      if(state.mySeatNo==null || !state.handoffPending) throw Error('Browser must request AI handoff first')
      await invoke('app_game_poker_control_claim',{roomCode,controlVersion:state.controlVersion})
      state=await invoke('app_game_poker_table_state',{roomCode})
      report.claimed=state.controller==='ai';report.controlVersion=state.controlVersion
    }
    if(mode==='act') {
      const turn=await invoke('app_game_poker_table_wait',{roomCode,cursor:'',timeoutMs:1000})
      report.waitStatus=turn.status
      if(turn.status==='your_turn') {
        state=await invoke('app_game_poker_table_state',{roomCode})
        const action=state.legalActions?.includes('check')?'check':'fold'
        const result=await invoke('app_game_poker_action_act',{roomCode,handId:state.handId,street:state.street,actionId:randomUUID(),action,controlVersion:state.controlVersion,expectedActionSeq:state.actionSeq,note:'隔离验收'})
        report.action={action,actionSeq:result.actionSeq}
      }
    }
    if(mode==='released') {
      const turn=await invoke('app_game_poker_table_wait',{roomCode,cursor:'',timeoutMs:1000})
      report.waitStatus=turn.status
      if(turn.status!=='control_released') throw Error('Human takeover did not release MCP control')
    }
    console.log(JSON.stringify(report))
  } finally {child.stdin.end();child.kill('SIGTERM')}
}
run().catch(error=>{console.error(error.message);process.exitCode=1})
