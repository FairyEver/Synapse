import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import {
  CHEAT_CODE_INTERACTION_RESET_DELAY,
  CHEAT_CODE_LOGO_CLICK_THRESHOLD,
  type CheatCodeContext,
  type CheatCodeRegistration,
} from "@/modules/settings/cheat-codes"

type UseCheatCodeTitleSequenceOptions = {
  readonly cheatCodes: readonly CheatCodeRegistration[]
  readonly context: CheatCodeContext
  readonly onTriggered?: (name: string) => void
}

type UseCheatCodeTitleSequenceResult = {
  readonly isArmed: boolean
  readonly handleLogoClick: () => void
  readonly handleTitleIndexClick: (index: number) => void
}

function useCheatCodeTitleSequence({
  cheatCodes,
  context,
  onTriggered,
}: UseCheatCodeTitleSequenceOptions): UseCheatCodeTitleSequenceResult {
  const [isArmed, setIsArmed] = useState(false)
  const bufferRef = useRef<readonly number[]>([])
  const logoClickCountRef = useRef(0)
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const maxSequenceLength = useMemo(
    () => getMaxTitleSequenceLength(cheatCodes),
    [cheatCodes],
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
      onTriggered?.(matchedCheatCode.name)
      matchedCheatCode.run(context)
      return
    }

    bufferRef.current = nextBuffer
    scheduleReset()
  }, [cheatCodes, context, isArmed, maxSequenceLength, onTriggered, resetInteraction, scheduleReset])

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
  return cheatCodes.find((cheatCode) => endsWithSequence(buffer, cheatCode.settingsTitleSequence)) ?? null
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
    (maxLength, cheatCode) => Math.max(maxLength, cheatCode.settingsTitleSequence.length),
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
