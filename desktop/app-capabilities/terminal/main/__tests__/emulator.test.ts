import { Buffer } from "node:buffer"
import { describe, expect, it, vi } from "vitest"

import { createTerminalCoreEmulator } from "../emulator"

describe("TerminalCoreEmulator renderer snapshots", () => {
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
})
