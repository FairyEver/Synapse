import { Buffer } from "node:buffer"
import { describe, expect, it, vi } from "vitest"

import {
  TERMINAL_STYLE_DEFAULT_COLOR,
  TERMINAL_STYLE_TRUECOLOR_BASE,
  createTerminalCoreEmulator,
} from "../emulator"

describe("TerminalCoreEmulator renderer snapshots", () => {
  it("reports standard terminal notification OSC sequences without exposing their content", async () => {
    const onNotification = vi.fn()
    const emulator = createTerminalCoreEmulator({
      cols: 80,
      rows: 24,
      sizeRevision: 1,
      onNotification,
    })
    try {
      await emulator.accept("\u001b]9;finished\u0007\u001b]777;notify;Agent;done\u0007", 1)
      expect(onNotification).toHaveBeenCalledWith({ protocol: 9, value: "finished" })
      expect(onNotification).toHaveBeenCalledWith({ protocol: 777, value: "notify;Agent;done" })
    } finally {
      emulator.dispose()
    }
  })

  it("tracks an OSC 7 working directory for subsequent pane creation", async () => {
    const onWorkingDirectoryChanged = vi.fn()
    const emulator = createTerminalCoreEmulator({
      cols: 80,
      rows: 24,
      sizeRevision: 1,
      onWorkingDirectoryChanged,
    })
    try {
      await emulator.accept("\u001b]7;file:///tmp/project%20one\u0007", 1)
      await emulator.accept("\u001b]7;file:///tmp/project%20one\u0007", 2)
      expect(emulator.currentCwd).toBe("/tmp/project one")
      expect(onWorkingDirectoryChanged).toHaveBeenCalledTimes(1)
      expect(onWorkingDirectoryChanged).toHaveBeenCalledWith()
    } finally {
      emulator.dispose()
    }
  })

  it("orders resize behind prior output and restores the serialized state", async () => {
    const emulator = createTerminalCoreEmulator({
      cols: 80,
      rows: 24,
      sizeRevision: 1,
    })
    const restored = createTerminalCoreEmulator({
      cols: 100,
      rows: 30,
      sizeRevision: 2,
    })
    try {
      await emulator.accept("\u001b[2J\u001b[Hbefore\u001b[?2004h", 1)
      const resize = emulator.resize(100, 30, 2)
      const laterOutput = emulator.accept("\u001b[30;1Hafter", 2)

      await expect(resize).resolves.toEqual({
        throughOutputSeq: 1,
        sizeRevision: 2,
      })
      await laterOutput

      const snapshot = await emulator.captureSnapshot(1024 * 1024)
      expect(snapshot).toMatchObject({
        throughOutputSeq: 2,
        sizeRevision: 2,
        scrollbackTruncated: false,
      })
      expect(snapshot.serialized).not.toBeNull()

      await restored.accept(snapshot.serialized!, snapshot.throughOutputSeq)
      expect(restored.getView({ kind: "screen", maxBytes: 64 * 1024 }))
        .toMatchObject({
          lines: emulator.getView({ kind: "screen", maxBytes: 64 * 1024 }).lines,
          cursor: emulator.getView({ kind: "screen", maxBytes: 64 * 1024 }).cursor,
          cols: 100,
          rows: 30,
          throughOutputSeq: 2,
          sizeRevision: 2,
        })
      expect(restored.bracketedPasteEvidence().enabled).toBe(true)
    } finally {
      emulator.dispose()
      restored.dispose()
    }
  })

  it("preserves SGR mouse reporting in renderer snapshots", async () => {
    const emulator = createTerminalCoreEmulator({
      cols: 80,
      rows: 24,
      sizeRevision: 1,
    })
    try {
      await emulator.accept("\u001b[?1000h\u001b[?1006h", 1)

      const snapshot = await emulator.captureSnapshot(1024 * 1024)

      expect(snapshot.serialized).toContain("\u001b[?1000h")
      expect(snapshot.serialized).toContain("\u001b[?1006h")
    } finally {
      emulator.dispose()
    }
  })

  it("trims the oldest scrollback to keep renderer snapshots bounded", async () => {
    const emulator = createTerminalCoreEmulator({
      cols: 80,
      rows: 24,
      scrollback: 2_000,
      sizeRevision: 1,
    })
    try {
      const output = Array.from({ length: 1_000 }, (_, index) =>
        `${String(index).padStart(4, "0")} ${"终端历史".repeat(20)}\r\n`).join("")
      await emulator.accept(output, 1)

      const snapshot = await emulator.captureSnapshot(64 * 1024)

      expect(snapshot.serialized).not.toBeNull()
      expect(snapshot.scrollbackTruncated).toBe(true)
      expect(Buffer.byteLength(snapshot.serialized!, "utf8")).toBeLessThanOrEqual(64 * 1024)
      expect(snapshot.serialized).toContain("0999")
    } finally {
      emulator.dispose()
    }
  })

  it("counts agent CLI status glyphs as two cells", async () => {
    const emulator = createTerminalCoreEmulator({
      cols: 40,
      rows: 4,
      sizeRevision: 1,
    })
    try {
      await emulator.accept("⏺ Bash(cd /tmp)\r\n◼ Java 候选逐条复核", 1)

      const view = emulator.getView({ kind: "screen", maxBytes: 4096 })

      expect(view.lines[0]).toBe("⏺ Bash(cd /tmp)")
      expect(view.lines[1]).toBe("◼ Java 候选逐条复核")
      expect(view.cursor.x).toBe(20)
    } finally {
      emulator.dispose()
    }
  })

  it("wraps emoji lines at the width the agent CLIs assume", async () => {
    const emulator = createTerminalCoreEmulator({
      cols: 10,
      rows: 4,
      sizeRevision: 1,
    })
    try {
      await emulator.accept(`${"⏺".repeat(5)}a`, 1)

      const view = emulator.getView({ kind: "screen", maxBytes: 4096 })

      expect(view.lines.slice(0, 2)).toEqual(["⏺⏺⏺⏺⏺", "a"])
    } finally {
      emulator.dispose()
    }
  })
})

describe("TerminalCoreEmulator styled line windows", () => {
  it("returns trimmed plain lines with no styling payload for unstyled output", async () => {
    const emulator = createTerminalCoreEmulator({ cols: 40, rows: 6, sizeRevision: 1 })
    try {
      await emulator.accept("hello\r\nworld", 1)

      const window = emulator.readLineWindow({ maxLines: 10 })

      expect(window.lines[0]).toEqual({ text: "hello" })
      expect(window.lines[1]).toEqual({ text: "world" })
      expect(window.alt).toBe(false)
      expect(window.throughOutputSeq).toBe(1)
    } finally {
      emulator.dispose()
    }
  })

  it("keeps foreground runs and omits run entries for default-styled spans", async () => {
    const emulator = createTerminalCoreEmulator({ cols: 40, rows: 6, sizeRevision: 1 })
    try {
      // "red" in palette colour 1, then " plain" with default styling.
      await emulator.accept("\u001b[31mred\u001b[0m plain", 1)

      const line = emulator.readLineWindow({ maxLines: 10 }).lines[0]

      expect(line.text).toBe("red plain")
      expect(line.runs).toEqual([
        {
          start: 0,
          length: 3,
          foreground: 1,
          background: TERMINAL_STYLE_DEFAULT_COLOR,
          bold: false,
          italic: false,
          underline: false,
          dim: false,
          inverse: false,
        },
      ])
    } finally {
      emulator.dispose()
    }
  })

  it("separates adjacent runs that differ only by attribute", async () => {
    const emulator = createTerminalCoreEmulator({ cols: 40, rows: 6, sizeRevision: 1 })
    try {
      await emulator.accept("\u001b[1mbold\u001b[22m plain", 1)

      const line = emulator.readLineWindow({ maxLines: 10 }).lines[0]

      expect(line.text).toBe("bold plain")
      expect(line.runs).toHaveLength(1)
      expect(line.runs?.[0]).toMatchObject({ start: 0, length: 4, bold: true })
    } finally {
      emulator.dispose()
    }
  })

  it("encodes truecolor distinctly from palette indices", async () => {
    const emulator = createTerminalCoreEmulator({ cols: 40, rows: 6, sizeRevision: 1 })
    try {
      await emulator.accept("\u001b[38;2;18;52;86mdeep\u001b[0m", 1)

      const line = emulator.readLineWindow({ maxLines: 10 }).lines[0]

      expect(line.runs?.[0]?.foreground).toBe(
        TERMINAL_STYLE_TRUECOLOR_BASE | (18 << 16) | (52 << 8) | 86,
      )
    } finally {
      emulator.dispose()
    }
  })

  it("bounds the window to the tail and reports the buffer offset", async () => {
    const emulator = createTerminalCoreEmulator({ cols: 40, rows: 4, sizeRevision: 1 })
    try {
      await emulator.accept(Array.from({ length: 30 }, (_, index) => `line${index}`).join("\r\n"), 1)

      const window = emulator.readLineWindow({ maxLines: 5 })

      expect(window.lines).toHaveLength(5)
      expect(window.lines.at(-1)?.text).toBe("line29")
      expect(window.startIndex).toBe(window.totalLines - 5)
    } finally {
      emulator.dispose()
    }
  })

  it("places the cursor relative to the returned window", async () => {
    const emulator = createTerminalCoreEmulator({ cols: 40, rows: 6, sizeRevision: 1 })
    try {
      await emulator.accept("one\r\ntwo\r\nthree", 1)

      const window = emulator.readLineWindow({ maxLines: 10 })
      const cursorLine = window.lines[window.cursor.row]

      expect(cursorLine?.text).toBe("three")
      expect(window.cursor.col).toBe(5)
    } finally {
      emulator.dispose()
    }
  })

  it("keeps the blank cells a cursor jump stepped over", async () => {
    const emulator = createTerminalCoreEmulator({ cols: 40, rows: 6, sizeRevision: 1 })
    try {
      // A footer drawn with absolute positioning, the way a status line pads
      // between segments. The gap is real space on screen.
      await emulator.accept("left\u001b[9Gright", 1)

      expect(emulator.readLineWindow({ maxLines: 10 }).lines[0].text).toBe("left    right")
    } finally {
      emulator.dispose()
    }
  })

  it("reports the alternate screen while a TUI owns the terminal", async () => {
    const emulator = createTerminalCoreEmulator({ cols: 40, rows: 6, sizeRevision: 1 })
    try {
      await emulator.accept("\u001b[?1049halt screen", 1)
      expect(emulator.readLineWindow({ maxLines: 10 }).alt).toBe(true)
    } finally {
      emulator.dispose()
    }
  })
})
