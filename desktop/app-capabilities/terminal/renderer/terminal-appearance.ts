import type { ITerminalOptions } from "@xterm/xterm"

import { createRendererLogger } from "../../../src/app-shell/logging"

const TERMINAL_APPEARANCE_SIZE_STORAGE_KEY = "synapse:app:terminal:appearance_size:v1"

export const TERMINAL_APPEARANCE_SIZES = ["small", "medium", "large"] as const

export type TerminalAppearanceSize = (typeof TERMINAL_APPEARANCE_SIZES)[number]

export const DEFAULT_TERMINAL_APPEARANCE_SIZE: TerminalAppearanceSize = "medium"

const TERMINAL_APPEARANCE_OPTIONS = {
  small: { fontSize: 12 },
  medium: { fontSize: 14 },
  large: { fontSize: 16 },
} as const satisfies Record<TerminalAppearanceSize, Pick<ITerminalOptions, "fontSize">>

const logger = createRendererLogger("terminal.appearance")

export function getTerminalAppearanceOptions(
  size: TerminalAppearanceSize,
): Pick<ITerminalOptions, "fontSize"> {
  return TERMINAL_APPEARANCE_OPTIONS[size]
}

export function readTerminalAppearanceSize(): TerminalAppearanceSize {
  if (typeof window === "undefined") return DEFAULT_TERMINAL_APPEARANCE_SIZE

  try {
    const stored = window.localStorage.getItem(TERMINAL_APPEARANCE_SIZE_STORAGE_KEY)
    return isTerminalAppearanceSize(stored) ? stored : DEFAULT_TERMINAL_APPEARANCE_SIZE
  } catch (error) {
    logger.warn("Failed to read terminal appearance settings.", { error })
    return DEFAULT_TERMINAL_APPEARANCE_SIZE
  }
}

export function writeTerminalAppearanceSize(size: TerminalAppearanceSize): void {
  if (typeof window === "undefined") return

  try {
    window.localStorage.setItem(TERMINAL_APPEARANCE_SIZE_STORAGE_KEY, size)
  } catch (error) {
    logger.warn("Failed to persist terminal appearance settings.", { error })
  }
}

function isTerminalAppearanceSize(value: string | null): value is TerminalAppearanceSize {
  return value !== null && (TERMINAL_APPEARANCE_SIZES as readonly string[]).includes(value)
}
