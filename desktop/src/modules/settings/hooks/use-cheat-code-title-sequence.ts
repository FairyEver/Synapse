import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import { createCheatCodeManager, type CheatCodeStateStore } from "@/lib/cheat-codes/manager"
import {
  CHEAT_CODE_INTERACTION_RESET_DELAY,
  CHEAT_CODE_LOGO_CLICK_THRESHOLD,
  type CheatCodeContext,
  type CheatCodeRegistration,
} from "@/modules/settings/cheat-codes"
import type { CheatCodeTriggerResult } from "@/types/cheat-code"

type UseCheatCodeTitleSequenceOptions = {
  readonly cheatCodes: readonly CheatCodeRegistration[]
  readonly context: CheatCodeContext
  readonly stateStore?: CheatCodeStateStore
  readonly onTriggered?: (result: CheatCodeTriggerResult) => void
  readonly onTriggerError?: (name: string, error: unknown) => void
}

type UseCheatCodeTitleSequenceResult = {
  readonly isArmed: boolean
  readonly handleLogoClick: () => void
  readonly handleTitleIndexClick: (index: number) => void
}

function useCheatCodeTitleSequence({
  cheatCodes,
  context,
  stateStore,
  onTriggered,
  onTriggerError,
}: UseCheatCodeTitleSequenceOptions): UseCheatCodeTitleSequenceResult {
  const [isArmed, setIsArmed] = useState(false)
  const bufferRef = useRef<readonly number[]>([])
  const logoClickCountRef = useRef(0)
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const maxSequenceLength = useMemo(
    () => getMaxTitleSequenceLength(cheatCodes),
    [cheatCodes],
  )
  const manager = useMemo(
    () => createCheatCodeManager({ registrations: cheatCodes, stateStore }),
    [cheatCodes, stateStore],
  )

  const clearResetTimer = useCallback(() => {
    if (resetTimerRef.current) {
      clearTimeout(resetTimerRef.current)
      resetTimerRef.current = null
    }
  }, [])

  const resetInteraction = useCallback(() => {
    clearResetTimer()
    bufferRef.current = []
    logoClickCountRef.current = 0
    setIsArmed(false)
  }, [clearResetTimer])

  const scheduleReset = useCallback(() => {
    clearResetTimer()
    resetTimerRef.current = setTimeout(() => {
      resetInteraction()
    }, CHEAT_CODE_INTERACTION_RESET_DELAY)
  }, [clearResetTimer, resetInteraction])

  useEffect(() => {
    return () => {
      clearResetTimer()
    }
  }, [clearResetTimer])

  const handleLogoClick = useCallback(() => {
    logoClickCountRef.current += 1

    if (logoClickCountRef.current >= CHEAT_CODE_LOGO_CLICK_THRESHOLD) {
      logoClickCountRef.current = 0
      bufferRef.current = []
      setIsArmed(true)
      scheduleReset()
      return
    }

    scheduleReset()
  }, [scheduleReset])

  const handleTitleIndexClick = useCallback((index: number) => {
    if (!isArmed) {
      return
    }

    const nextBuffer = trimTitleSequenceBuffer(
      [...bufferRef.current, index],
      maxSequenceLength,
    )
    const matchedCheatCode = findMatchingCheatCode(cheatCodes, nextBuffer)

    if (matchedCheatCode) {
      resetInteraction()
      void manager.trigger(matchedCheatCode.definition.name, context)
        .then((result) => {
          onTriggered?.(result)
        })
        .catch((error: unknown) => {
          onTriggerError?.(matchedCheatCode.definition.name, error)
        })
      return
    }

    bufferRef.current = nextBuffer
    scheduleReset()
  }, [cheatCodes, context, isArmed, manager, maxSequenceLength, onTriggerError, onTriggered, resetInteraction, scheduleReset])

  return {
    isArmed,
    handleLogoClick,
    handleTitleIndexClick,
  }
}

function findMatchingCheatCode(
  cheatCodes: readonly CheatCodeRegistration[],
  buffer: readonly number[],
): CheatCodeRegistration | null {
  return cheatCodes.find((cheatCode) => endsWithSequence(buffer, cheatCode.binding.settingsTitleSequence)) ?? null
}

function trimTitleSequenceBuffer(buffer: readonly number[], maxLength: number): readonly number[] {
  if (maxLength <= 0) {
    return []
  }

  if (buffer.length <= maxLength) {
    return buffer
  }

  return buffer.slice(buffer.length - maxLength)
}

function getMaxTitleSequenceLength(cheatCodes: readonly CheatCodeRegistration[]): number {
  return cheatCodes.reduce(
    (maxLength, cheatCode) => Math.max(maxLength, cheatCode.binding.settingsTitleSequence.length),
    0,
  )
}

function endsWithSequence(buffer: readonly number[], sequence: readonly number[]): boolean {
  if (sequence.length === 0 || sequence.length > buffer.length) {
    return false
  }

  const offset = buffer.length - sequence.length

  return sequence.every((value, index) => buffer[offset + index] === value)
}

export {
  findMatchingCheatCode,
  trimTitleSequenceBuffer,
  useCheatCodeTitleSequence,
}
