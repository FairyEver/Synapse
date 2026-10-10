import type { CSSProperties } from "react"

import { TERMINAL_THEMES, type TerminalThemeId } from "../shared/terminal-themes"

export const TERMINAL_CHROME_BUTTON_CLASS_NAME =
  "text-foreground hover:bg-accent hover:text-accent-foreground dark:hover:bg-accent aria-expanded:bg-accent aria-expanded:text-accent-foreground"

/** Runtime palette tokens scoped to the terminal's header and command bars. */
export function getTerminalChromeStyle(theme: TerminalThemeId): CSSProperties & Record<`--${string}`, string> {
  const palette = TERMINAL_THEMES[theme].palette
  if (!palette) return { "--muted-foreground": "var(--foreground)" }

  return {
    "--background": palette.background,
    "--foreground": palette.foreground,
    "--muted-foreground": palette.foreground,
    "--accent": palette.selectionBackground,
    "--accent-foreground": palette.selectionForeground,
    "--ring": palette.foreground,
  }
}
