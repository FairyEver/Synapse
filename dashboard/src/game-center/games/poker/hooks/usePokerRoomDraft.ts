import { useEffect, useRef, useState } from "react"
import { toast } from "@heroui/react"
import { roomPreferencesStore, type PokerRoomPreferences } from "../../../runtime/preferences"
import type { PokerRoomDraft } from "../components/CreateRoomDialog"
import { POKER_DEFAULT_ROLL_COINS, POKER_MAX_ROLL_COINS } from "@synapse/shared/game-contracts"

const defaults: PokerRoomPreferences = {
  mode: "points", variant: "standard52", blindPreset: "1/2", maxSeats: 6, buyIn: 1000, roll: false, cards: false, rollCoins: POKER_DEFAULT_ROLL_COINS,
}
// Serialize config read/merge/write, including choices made immediately before unmount.
let pendingSave: Promise<void> = Promise.resolve()

function roomPreferences({ mode, variant, blindPreset, maxSeats, buyIn, roll = false, cards = false, rollCoins = POKER_DEFAULT_ROLL_COINS }: PokerRoomPreferences): PokerRoomPreferences {
  return { mode, variant, blindPreset, maxSeats, buyIn, roll, cards, rollCoins }
}

export function usePokerRoomDraft(userId: string | null, nickname: string) {
  const defaultName = `${nickname || "用户"}的房间`.slice(0, 48)
  const [draft, setDraft] = useState<PokerRoomDraft>({ ...defaults, name: defaultName })
  const identity = useRef(userId)
  identity.current = userId
  const initialName = useRef(defaultName)
  const loadVersion = useRef(0)
  useEffect(() => () => { loadVersion.current++ }, [userId])

  const loadDraft = async () => {
    if (!userId) return false
    const version = ++loadVersion.current
    try {
      await pendingSave
      const preferences = await roomPreferencesStore.get(userId)
      if (identity.current !== userId || loadVersion.current !== version) return false
      initialName.current = defaultName
      setDraft({ ...(preferences ?? defaults), name: defaultName })
      return true
    } catch {
      if (identity.current === userId && loadVersion.current === version) toast.danger("读取房间配置失败，请重试")
      return false
    }
  }
  const changeDraft = (next: PokerRoomDraft) => {
    setDraft(next)
    if (next.rollCoins !== undefined && (!Number.isInteger(next.rollCoins) || next.rollCoins < 1 || next.rollCoins > POKER_MAX_ROLL_COINS)) return
    const preferences = roomPreferences(next)
    const previous = roomPreferences(draft)
    if (!userId || JSON.stringify(preferences) === JSON.stringify(previous)) return
    pendingSave = pendingSave.then(async () => {
      await roomPreferencesStore.update(userId, preferences)
    }).catch(() => {
      if (identity.current === userId) toast.danger("保存房间配置失败，请重新选择")
    })
  }
  const createParams = () => ({
    mode:draft.mode, variant:draft.variant, blindPreset:draft.blindPreset, maxSeats:draft.maxSeats, buyIn:draft.buyIn,
    ruleOptions: {cards:draft.cards ?? false, roll:draft.roll ?? false, ...(draft.roll ? {rollCoins:draft.rollCoins ?? POKER_DEFAULT_ROLL_COINS} : {})},
    // The server adds the authoritative room code only for automatic names.
    name: !draft.name.trim() || draft.name === initialName.current ? undefined : draft.name,
  })
  return { draft, changeDraft, loadDraft, createParams }
}
