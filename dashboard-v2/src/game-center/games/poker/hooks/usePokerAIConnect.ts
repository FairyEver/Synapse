import { useEffect, useRef, useState } from "react"
import { toast } from "@heroui/react"
import type { PokerControlView, PokerTableView } from "@synapse/shared/game-contracts"
import { useAccount } from "@/game-center/runtime/account"
import { useGameMutation } from "../../../hooks/useGameQuery"
import { gameApi } from "../../../lib/api"
import { pokerConnectInstruction } from "../lib/connect-instruction"

export function usePokerAIConnect(table: PokerTableView | null, onRefresh: () => void | Promise<void>) {
  const {state}=useAccount(), mutation=useGameMutation()
  const identity=state.status === "authenticated" ? state.profile.user.id : null
  const key=`${identity}:${table?.roomCode}`
  const context=useRef({key}), mounted=useRef(true)
  if(context.current.key!==key) context.current={key}
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false}},[])
  const [confirmed,setConfirmed]=useState<{key:string;control:PokerControlView}|null>(null)
  const [failure,setFailure]=useState<{key:string;message:string}|null>(null)
  const control=confirmed?.key===key && confirmed.control.controlVersion>(table?.controlVersion ?? -1) ? confirmed.control : table
  const copy=async()=>{
    if (!table || !identity) return
    const submitted=context.current
    const current=()=>mounted.current && context.current===submitted
    setFailure(null)
    try { await navigator.clipboard.writeText(pokerConnectInstruction(table.roomCode));if(current()) toast.success("接入指令已复制，请发送到你的 AI 会话") }
    catch { if(current()) setFailure({key,message:"复制失败，接入授权保持不变，请重试复制"}) }
  }
  const change=async(action:"request_ai"|"cancel_ai"|"takeover")=>{
    if(!table || !identity) return
    const submitted=context.current
    const current=()=>mounted.current && context.current===submitted
    setFailure(null)
    const result=await mutation.run(async()=>{
      const fresh=await gameApi().poker.table.state({roomCode:table.roomCode,perspective:"public"})
      if(!current()) return null
      if(fresh.status==="closed") throw new Error("房间已解散")
      if(fresh.controlVersion==null) throw new Error("请更新客户端后接入 AI")
      if(action==="request_ai" && (fresh.handoffPending || fresh.controller==="ai") || action==="cancel_ai" && !fresh.handoffPending || action==="takeover" && fresh.controller!=="ai") return fresh
      return gameApi().poker.control.set({roomCode:table.roomCode,controlVersion:fresh.controlVersion,action})
    })
    if(!current()) return
    if(result) {
      setConfirmed({key,control:{controller:result.controller ?? null,controlVersion:result.controlVersion!,handoffPending:!!result.handoffPending}})
      if(action==="request_ai" && result.controller!=="ai") await copy()
    }
    if(!current()) return
    try { await onRefresh() } catch { if(current()) setFailure({key,message:"状态刷新失败，请重新读取接入状态"}) }
  }
  return {busy:mutation.busy,error:failure?.key===key ? failure.message : null,control,copy,change}
}
