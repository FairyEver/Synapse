import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react"
import type { PokerTableView } from "@synapse/shared/game-contracts"
import { activeChipTransfers, finishChipTransfer, seedChipPresentation, startChipTransfer, updateChipPresentation, type ChipFund } from "../lib/chip-presentation"

export function usePokerChips(table: PokerTableView, context: string) {
  const key=`${context}:${table.roomCode}:${table.handId}`
  const [generation,setGeneration]=useState(0)
  const scope=`${key}:${generation}`
  const [state,setState]=useState(()=>seedChipPresentation(table,context))
  const [numbers,setNumbers]=useState<{key:string;active:Partial<Record<ChipFund | `seat:${number}`,boolean>>}>({key:scope,active:{}})
  const latest=useRef({table,context}), previousAt=useRef(Date.now())
  latest.current={table,context}
  useLayoutEffect(()=>{
    const now=Date.now(),stale=now-previousAt.current>3000
    previousAt.current=now
    setState(old=>stale?seedChipPresentation(table,context):updateChipPresentation(old,table,context))
    if(stale)setGeneration(old=>old+1)
  },[table,context])
  useEffect(()=>{
    const reset=()=>{const current=latest.current;setState(seedChipPresentation(current.table,current.context));setGeneration(old=>old+1);previousAt.current=0}
    document.addEventListener("visibilitychange",reset)
    return ()=>document.removeEventListener("visibilitychange",reset)
  },[])
  const start=useCallback((id:string)=>setState(old=>old.key===key?startChipTransfer(old,id):old),[key])
  const complete=useCallback((id:string)=>setState(old=>old.key===key?finishChipTransfer(old,id):old),[key])
  const numberMotion=useCallback((fund:ChipFund | `seat:${number}`,active:boolean)=>setNumbers(old=>{
    const current=old.key===scope?old:{key:scope,active:{}}
    return !!current.active[fund]===active?current:{...current,active:{...current.active,[fund]:active}}
  }),[scope])
  const view=state.key===key?state:seedChipPresentation(table,context)
  const isSettlement=table.settlement?.handId===table.handId&&!!table.handId
  const blocked=isSettlement&&(view.settlementHand!==table.handId||view.transfers.length>0||(numbers.key===scope&&Object.values(numbers.active).some(Boolean)))
  return {...view,scope,active:activeChipTransfers(view),blocked,start,complete,numberMotion}
}
