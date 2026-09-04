import type { ITerminalOptions, ITheme } from "@xterm/xterm"

const TERMINAL_FONT_FAMILY = [
  "\"MesloLGS NF\"",
  "\"MesloLGS Nerd Font\"",
  "\"Meslo LG S NF\"",
  "\"Meslo LG S for Powerline\"",
  "\"DejaVu Sans Mono for Powerline\"",
  "\"Anonymous Pro for Powerline\"",
  "\"Inconsolata-g for Powerline\"",
  "\"Liberation Mono for Powerline\"",
  "\"Ubuntu Mono derivative Powerline\"",
  "\"Roboto Mono for Powerline\"",
  "\"SauceCodePro Nerd Font\"",
  "\"Hack Nerd Font\"",
  "\"JetBrainsMono Nerd Font\"",
  "\"SFMono-Regular\"",
  "Menlo",
  "Monaco",
  "Consolas",
  "\"Liberation Mono\"",
  "monospace",
].join(", ")

const TERMINAL_VISUAL_OPTIONS = {
  customGlyphs: true,
  cursorBlink: true,
  cursorStyle: "block",
  fontFamily: TERMINAL_FONT_FAMILY,
  fontSize: 14,
  letterSpacing: 0,
  lineHeight: 1.1,
  scrollback: 5000,
  smoothScrollDuration: 80,
} satisfies Partial<ITerminalOptions>

type TerminalRenderingInput = {
  readonly container: HTMLElement
  readonly disableStdin: boolean
}

let terminalColorContext: CanvasRenderingContext2D | null | undefined

export function createTerminalRenderingOptions(input: TerminalRenderingInput): ITerminalOptions {
  return {
    ...TERMINAL_VISUAL_OPTIONS,
    convertEol: true,
    disableStdin: input.disableStdin,
    theme: createTerminalTheme(input.container),
  }
}

function createTerminalTheme(container: HTMLElement): ITheme {
  const scopedStyle = window.getComputedStyle(container)
  const rootStyle = window.getComputedStyle(document.documentElement)
  const token = (fallback: string, ...names: string[]) => normalizeTerminalColor(
    resolveCssToken(scopedStyle, rootStyle, names, fallback),
  )

  return {
    background: token("Canvas", "--background", "--surface"),
    foreground: token("CanvasText", "--foreground"),
    cursor: token("CanvasText", "--foreground"),
    cursorAccent: token("Canvas", "--background"),
    selectionBackground: token("Highlight", "--muted"),
    black: token("Canvas", "--background"),
    red: token("CanvasText", "--destructive"),
    green: token("CanvasText", "--chart-3"),
    yellow: token("CanvasText", "--chart-4"),
    blue: token("LinkText", "--chart-1"),
    magenta: token("CanvasText", "--chart-5"),
    cyan: token("LinkText", "--chart-2"),
    white: token("CanvasText", "--foreground"),
    brightBlack: token("GrayText", "--muted-foreground"),
    brightRed: token("CanvasText", "--destructive"),
    brightGreen: token("CanvasText", "--chart-3"),
    brightYellow: token("CanvasText", "--chart-4"),
    brightBlue: token("LinkText", "--chart-1"),
    brightMagenta: token("CanvasText", "--chart-5"),
    brightCyan: token("LinkText", "--chart-2"),
    brightWhite: token("CanvasText", "--foreground"),
  }
}

function resolveCssToken(
  scopedStyle: CSSStyleDeclaration,
  rootStyle: CSSStyleDeclaration,
  names: readonly string[],
  fallback: string,
): string {
  for (const name of names) {
    const scopedValue = scopedStyle.getPropertyValue(name).trim()
    if (scopedValue) return scopedValue

    const rootValue = rootStyle.getPropertyValue(name).trim()
    if (rootValue) return rootValue
  }

  return fallback
}

function normalizeTerminalColor(value: string): string {
  if (!/^(?:oklch|oklab|lch|lab|color)\(/i.test(value)) {
    return value
  }

  const context = getTerminalColorContext()
  if (!context) {
    return value
  }

  context.clearRect(0, 0, 1, 1)
  context.fillStyle = value
  context.fillRect(0, 0, 1, 1)
  const [red, green, blue, alpha] = context.getImageData(0, 0, 1, 1).data

  return `rgba(${red}, ${green}, ${blue}, ${alpha / 255})`
}

function getTerminalColorContext(): CanvasRenderingContext2D | null {
  if (terminalColorContext !== undefined) {
    return terminalColorContext
  }

  const canvas = document.createElement("canvas")
  canvas.width = 1
  canvas.height = 1
  terminalColorContext = canvas.getContext("2d", { willReadFrequently: true })
  return terminalColorContext
}
