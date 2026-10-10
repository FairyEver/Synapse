import { useEffect, useRef } from "react"
import { Terminal } from "@xterm/xterm"
import { FitAddon } from "@xterm/addon-fit"

import type { TerminalThemeId } from "../shared/terminal-themes"
import type { TerminalAppearanceSize } from "./terminal-appearance"
import { getTerminalAppearanceOptions } from "./terminal-appearance"
import { applyTerminalTheme, createTerminalRenderingOptions } from "./terminal-rendering"

const PREVIEW_OUTPUT = [
  "$ git status",
  "\x1b[32mReady to commit\x1b[0m",
  "\x1b[31mred \x1b[32mgreen \x1b[33myellow\x1b[0m",
  "\x1b[34mblue \x1b[35mmagenta \x1b[36mcyan\x1b[0m",
  "\x1b[91mred \x1b[92mgreen \x1b[93myellow\x1b[0m",
  "\x1b[94mblue \x1b[95mmagenta \x1b[96mcyan\x1b[0m",
  "Selected text",
].join("\r\n")

/** A local xterm sample; never creates a PTY or sends input to a session. */
export function TerminalThemePreview({ theme, size }: {
  readonly theme: TerminalThemeId
  readonly size: TerminalAppearanceSize
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const terminalRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const initialOptions = useRef({ theme, size })

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const terminal = new Terminal({
      ...createTerminalRenderingOptions({
        appearanceSize: initialOptions.current.size,
        appearanceTheme: initialOptions.current.theme,
        container,
        disableStdin: true,
      }),
      cols: 44,
      rows: 7,
      cursorBlink: false,
      scrollback: 0,
    })
    const fit = new FitAddon()
    terminal.loadAddon(fit)
    terminal.open(container)
    terminalRef.current = terminal
    fitRef.current = fit
    applyTerminalTheme(terminal, container, initialOptions.current.theme)
    fit.fit()
    let disposed = false
    terminal.write(PREVIEW_OUTPUT, () => {
      if (!disposed) terminal.select(0, 6, 13)
    })

    let frame: number | undefined
    let width = container.clientWidth
    let height = container.clientHeight
    const observer = new ResizeObserver(() => {
      const nextWidth = container.clientWidth
      const nextHeight = container.clientHeight
      if (width === nextWidth && height === nextHeight) return
      width = nextWidth
      height = nextHeight
      if (frame !== undefined) return
      frame = requestAnimationFrame(() => {
        frame = undefined
        fit.fit()
      })
    })
    observer.observe(container)
    return () => {
      disposed = true
      observer.disconnect()
      if (frame !== undefined) cancelAnimationFrame(frame)
      terminalRef.current = null
      fitRef.current = null
      terminal.dispose()
    }
  }, [])

  useEffect(() => {
    const terminal = terminalRef.current
    const container = containerRef.current
    if (terminal && container) applyTerminalTheme(terminal, container, theme)
  }, [theme])

  useEffect(() => {
    const terminal = terminalRef.current
    if (!terminal) return
    const options = getTerminalAppearanceOptions(size)
    terminal.options.fontSize = options.fontSize
    terminal.options.lineHeight = options.lineHeight
    fitRef.current?.fit()
  }, [size])

  return (
    <div
      data-terminal-theme-preview
      data-terminal-xterm-frame
      role="img"
      aria-label="终端主题预览"
      className="dark h-44 overflow-hidden rounded-md bg-(--terminal-background) p-2"
    >
      <div ref={containerRef} inert className="h-full w-full overflow-hidden" />
    </div>
  )
}
