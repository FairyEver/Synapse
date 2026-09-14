import { Terminal } from "@xterm/headless"
import { describe, expect, it } from "vitest"

import {
  installTerminalUnicodeWidth,
  isTerminalEmojiCodePoint,
  TERMINAL_UNICODE_VERSION,
  type TerminalUnicodeWidthTarget,
} from "../terminal-unicode-width"

function createTerminal(cols = 200): Terminal {
  return new Terminal({ cols, rows: 4, allowProposedApi: true })
}

async function write(terminal: Terminal, data: string): Promise<void> {
  await new Promise<void>((resolve) => terminal.write(data, resolve))
}

function screenLines(terminal: Terminal): string[] {
  const buffer = terminal.buffer.active
  const lines: string[] = []
  for (let index = 0; index < terminal.rows; index += 1) {
    lines.push(buffer.getLine(index)?.translateToString(true) ?? "")
  }
  return lines
}

async function measureWidth(text: string): Promise<number> {
  const terminal = createTerminal()
  try {
    expect(installTerminalUnicodeWidth(terminal)).toBe("patched")
    await write(terminal, text)
    return terminal.buffer.active.cursorX
  } finally {
    terminal.dispose()
  }
}

const EMOJI_SAMPLES: readonly (readonly [string, number])[] = [
  ["⏺", 2],
  ["◼", 2],
  ["◻", 2],
  ["◼️", 2],
  ["◻️", 2],
  ["⚡", 2],
  ["⏳", 2],
  ["🚀", 2],
  ["✅", 2],
  ["⚠", 2],
  ["⚠️", 2],
  ["✔", 2],
  ["✔️", 2],
  ["✳", 2],
  ["🫠", 2],
]

const WIDE_SAMPLES: readonly (readonly [string, number])[] = [
  ["中文", 4],
  ["한글", 4],
]

const SINGLE_WIDTH_SAMPLES: readonly (readonly [string, number])[] = [
  ["a", 1],
  ["⎿", 1],
  ["↓", 1],
  ["▰", 1],
  ["▱", 1],
  ["✻", 1],
  ["·", 1],
  ["→", 1],
  ["●", 1],
  ["○", 1],
  ["a\u0301", 1],
]

describe("terminal unicode width provider", () => {
  it.each([...EMOJI_SAMPLES, ...WIDE_SAMPLES])("counts %s as two cells", async (text, expected) => {
    expect(await measureWidth(text)).toBe(expected)
  })

  it.each(SINGLE_WIDTH_SAMPLES)("keeps %s at its base width", async (text, expected) => {
    expect(await measureWidth(text)).toBe(expected)
  })

  it("covers the agent CLI status glyph set", async () => {
    const terminal = createTerminal()
    try {
      expect(installTerminalUnicodeWidth(terminal)).toBe("patched")
      expect(terminal.unicode.activeVersion).toBe(TERMINAL_UNICODE_VERSION)
      expect(terminal.unicode.versions).toContain(TERMINAL_UNICODE_VERSION)
    } finally {
      terminal.dispose()
    }
    for (const [glyph] of EMOJI_SAMPLES) {
      expect(isTerminalEmojiCodePoint(glyph.codePointAt(0) ?? 0)).toBe(true)
    }
    for (const [glyph] of WIDE_SAMPLES) {
      expect(isTerminalEmojiCodePoint(glyph.codePointAt(0) ?? 0)).toBe(false)
    }
  })

  it("keeps ASCII keycap bases out of the emoji table", () => {
    for (const codepoint of [0x23, 0x2a, 0x30, 0x39, 0x41, 0x20e3, 0x301]) {
      expect(isTerminalEmojiCodePoint(codepoint)).toBe(false)
    }
  })

  it("wraps a line only once the emoji cells exceed the terminal width", async () => {
    const terminal = createTerminal(10)
    try {
      expect(installTerminalUnicodeWidth(terminal)).toBe("patched")
      await write(terminal, `${"⏺".repeat(5)}a`)
      expect(screenLines(terminal).slice(0, 2)).toEqual(["⏺⏺⏺⏺⏺", "a"])
    } finally {
      terminal.dispose()
    }
  })

  it("builds the patched provider on top of the captured base provider", async () => {
    const terminal = createTerminal(20)
    try {
      const status = installTerminalUnicodeWidth(
        terminal,
        { createAddon: createRegisteringAddon() },
      )
      expect(status).toBe("patched")
      expect(terminal.unicode.activeVersion).toBe(TERMINAL_UNICODE_VERSION)
      await write(terminal, "⏺a")
      expect(terminal.buffer.active.cursorX).toBe(3)
    } finally {
      terminal.dispose()
    }
  })

  it("falls back to the official table when the base provider cannot be captured", () => {
    let activation = 0
    const terminal = createTerminal(20)
    try {
      const status = installTerminalUnicodeWidth(terminal, {
        createAddon: () => ({
          activate: (target: unknown) => {
            activation += 1
            if (activation === 1) return
            ;(target as TerminalUnicodeWidthTarget).unicode.register({
              version: "11",
              wcwidth: () => 1,
              charProperties: () => 2,
            })
          },
        }),
      })
      expect(status).toBe("unicode11")
      expect(terminal.unicode.activeVersion).toBe("11")
    } finally {
      terminal.dispose()
    }
  })

  it("keeps the default table when no provider can be registered", () => {
    const terminal = createTerminal(20)
    try {
      const status = installTerminalUnicodeWidth(terminal, {
        createAddon: () => ({
          activate: () => {
            throw new Error("addon unavailable")
          },
        }),
      })
      expect(status).toBe("default")
      expect(terminal.unicode.activeVersion).toBe("6")
    } finally {
      terminal.dispose()
    }
  })
})

function createRegisteringAddon(): () => {
  activate(terminal: unknown): void
} {
  const provider = {
    version: "11",
    wcwidth: (codepoint: number): 0 | 1 | 2 => (codepoint === 0x4e2d ? 2 : codepoint === 0x301 ? 0 : 1),
    charProperties: (codepoint: number, preceding: number): number => {
      const width = codepoint === 0x4e2d ? 2 : codepoint === 0x301 ? 0 : 1
      const join = width === 0 && preceding !== 0
      return ((width << 1) | (join ? 1 : 0)) as number
    },
  }
  return () => ({
    activate: (target: unknown) => {
      ;(target as TerminalUnicodeWidthTarget).unicode.register(provider)
    },
  })
}
