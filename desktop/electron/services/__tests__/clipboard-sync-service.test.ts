import { describe, expect, it } from "vitest"
import {
  ClipboardSyncService,
  CLIPBOARD_SYNC_MAX_ENTRIES,
  CLIPBOARD_SYNC_MAX_TEXT_BYTES,
  type ClipboardSyncEntry,
  type ClipboardSyncReader,
} from "../clipboard-sync-service"

const CONCEALED_ORG = "org.nspasteboard.ConcealedType"

class ManualTimers {
  nowMs = 1_000_000
  private readonly handlers = new Map<number, { callback: () => void; dueMs: number }>()
  private nextId = 1

  readonly set = (callback: () => void, delayMs: number): NodeJS.Timeout => {
    const id = this.nextId++
    this.handlers.set(id, { callback, dueMs: this.nowMs + delayMs })
    return id as unknown as NodeJS.Timeout
  }

  readonly clear = (handle: NodeJS.Timeout): void => {
    this.handlers.delete(handle as unknown as number)
  }

  /** 推进时间并触发到期的回调。服务是同步的，不需要等待微任务。 */
  advance(ms: number): void {
    this.nowMs += ms
    for (const [id, handler] of [...this.handlers]) {
      if (handler.dueMs > this.nowMs) continue
      this.handlers.delete(id)
      handler.callback()
    }
  }
}

class FakeClipboard implements ClipboardSyncReader {
  text = ""
  concealedTypes: string[] = []
  readTextCalls = 0

  readText(): string {
    this.readTextCalls += 1
    return this.text
  }

  readBuffer(format: string): Buffer {
    return this.concealedTypes.includes(format) ? Buffer.from([1]) : Buffer.alloc(0)
  }
}

function createHarness() {
  const clipboard = new FakeClipboard()
  const timers = new ManualTimers()
  const service = new ClipboardSyncService({
    clipboard,
    now: () => new Date(timers.nowMs),
    setTimeout: timers.set,
    clearTimeout: timers.clear,
  })
  const changes: ClipboardSyncEntry[][] = []
  service.events.on("changed", ({ entries }) => changes.push(entries))

  return { clipboard, timers, service, changes }
}

describe("ClipboardSyncService", () => {
  it("records what was copied, newest first", () => {
    const { clipboard, timers, service, changes } = createHarness()
    service.start()

    clipboard.text = "first"
    timers.advance(1_000)
    clipboard.text = "second"
    timers.advance(1_000)

    expect(changes.length).toBe(2)
    expect(service.snapshot().map((entry) => entry.text)).toEqual(["second", "first"])
  })

  it("moves a repeated copy back to the top instead of adding a second row", () => {
    const { clipboard, timers, service, changes } = createHarness()
    service.start()

    clipboard.text = "alpha"
    timers.advance(1_000)
    const firstSeenAt = service.snapshot()[0]?.copiedAt
    clipboard.text = "beta"
    timers.advance(1_000)
    clipboard.text = "alpha"
    timers.advance(1_000)

    const snapshot = service.snapshot()
    expect(snapshot.map((entry) => entry.text)).toEqual(["alpha", "beta"])
    expect(changes.length).toBe(3)
    // 时间要刷新，否则列表里它会一直显示成第一次复制的时间。
    expect(snapshot[0]?.copiedAt).not.toBe(firstSeenAt)
  })

  it("keeps only the newest twenty entries", () => {
    const { clipboard, timers, service } = createHarness()
    service.start()

    for (let index = 0; index < CLIPBOARD_SYNC_MAX_ENTRIES + 5; index += 1) {
      clipboard.text = `entry-${index}`
      timers.advance(1_000)
    }

    const texts = service.snapshot().map((entry) => entry.text)
    expect(texts.length).toBe(CLIPBOARD_SYNC_MAX_ENTRIES)
    expect(texts[0]).toBe(`entry-${CLIPBOARD_SYNC_MAX_ENTRIES + 4}`)
    expect(texts).not.toContain("entry-4")
  })

  it("stays completely silent while the clipboard does not change", () => {
    const { clipboard, timers, service, changes } = createHarness()
    service.start()

    clipboard.text = "unchanged"
    timers.advance(1_000)
    timers.advance(1_000)
    timers.advance(1_000)

    expect(changes.length).toBe(1)
    expect(clipboard.readTextCalls).toBe(3)
  })

  it("drops concealed content without recording it, and keeps working afterwards", () => {
    const { clipboard, timers, service, changes } = serviceWithSecret()

    expect(changes.length).toBe(0)
    expect(service.snapshot()).toEqual([])

    // 拒绝一次不能变成"从此不再工作"。
    clipboard.concealedTypes = []
    clipboard.text = "an ordinary sentence"
    timers.advance(1_000)

    expect(changes.length).toBe(1)
    expect(service.snapshot().map((entry) => entry.text)).toEqual(["an ordinary sentence"])
  })

  it("does not leak concealed content into the entry list when the marker later clears", () => {
    const { clipboard, timers, service, changes } = serviceWithSecret()

    // 先把「标记还在时什么都没记」钉住。少了这半句，这个用例在探测整个失效时也是绿的
    // —— 它只断言了标记消失之后的行为，而那种情况下前半段本来就悄悄记了一条。
    expect(service.snapshot()).toEqual([])

    // 标记被第三方抹掉（装了剪切板管理器的机器上实测会发生），但内容没变。
    // 此时这条会被当成一条普通的新复制 —— 记下来是有意的：我们不能凭内容猜它是不是密码，
    // 只能凭标记。测试固定这个行为，免得以后有人以为它是 bug 而"修"成更聪明的样子。
    clipboard.concealedTypes = []
    timers.advance(1_000)

    expect(changes.length).toBe(1)
    expect(service.snapshot().map((entry) => entry.text)).toEqual(["hunter2"])
  })

  it("drops text over the byte budget", () => {
    const { clipboard, timers, service, changes } = createHarness()
    service.start()

    clipboard.text = "x".repeat(CLIPBOARD_SYNC_MAX_TEXT_BYTES + 1)
    timers.advance(1_000)

    expect(changes.length).toBe(0)
    expect(service.snapshot()).toEqual([])

    clipboard.text = "small enough"
    timers.advance(1_000)
    expect(changes.length).toBe(1)
  })

  it("records nothing for an empty clipboard", () => {
    const { clipboard, timers, service, changes } = createHarness()
    service.start()

    clipboard.text = ""
    timers.advance(1_000)

    expect(changes.length).toBe(0)
    expect(service.snapshot()).toEqual([])
  })

  it("treats a re-copy after the clipboard was cleared as new", () => {
    const { clipboard, timers, service, changes } = createHarness()
    service.start()

    clipboard.text = "same text"
    timers.advance(1_000)
    clipboard.text = ""
    timers.advance(1_000)
    clipboard.text = "same text"
    timers.advance(1_000)

    expect(changes.length).toBe(2)
    expect(service.snapshot().length).toBe(1)
  })

  it("stops polling once stopped", () => {
    const { clipboard, timers, service, changes } = createHarness()
    service.start()
    service.stop()

    clipboard.text = "after stop"
    timers.advance(5_000)

    expect(changes.length).toBe(0)
    expect(clipboard.readTextCalls).toBe(0)
  })

  it("does not stack timers when started twice", () => {
    const { clipboard, timers, service } = createHarness()
    service.start()
    service.start()

    clipboard.text = "once"
    timers.advance(1_000)

    expect(clipboard.readTextCalls).toBe(1)
  })
})

function serviceWithSecret() {
  const harness = createHarness()
  harness.service.start()
  harness.clipboard.text = "hunter2"
  harness.clipboard.concealedTypes = [CONCEALED_ORG]
  harness.timers.advance(1_000)
  return harness
}
