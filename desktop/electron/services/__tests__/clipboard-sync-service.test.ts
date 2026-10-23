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
  private readonly handlers = new Map<number, { callback: () => void | Promise<void>; dueMs: number }>()
  private nextId = 1

  readonly set = (callback: () => void | Promise<void>, delayMs: number): NodeJS.Timeout => {
    const id = this.nextId++
    this.handlers.set(id, { callback, dueMs: this.nowMs + delayMs })
    return id as unknown as NodeJS.Timeout
  }

  readonly clear = (handle: NodeJS.Timeout): void => {
    this.handlers.delete(handle as unknown as number)
  }

  /** 推进时间并触发到期的回调。等待异步读取完成后再推进下一轮。 */
  async advance(ms: number): Promise<void> {
    this.nowMs += ms
    for (const [id, handler] of [...this.handlers]) {
      if (handler.dueMs > this.nowMs) continue
      this.handlers.delete(id)
      await handler.callback()
    }
  }
}

class FakeClipboard implements ClipboardSyncReader {
  text = ""
  concealedTypes: string[] = []
  readTextCalls = 0

  async readText(): Promise<string> {
    this.readTextCalls += 1
    return this.text
  }

  async readBuffer(format: string): Promise<Buffer> {
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
  it("keeps polling serial when an old read finishes during a new generation read", async () => {
    const { clipboard, timers, service } = createHarness()
    const finishes: ((text: string) => void)[] = []
    clipboard.readText = () => {
      clipboard.readTextCalls += 1
      return new Promise<string>((resolve) => finishes.push(resolve))
    }
    service.start()
    const old = timers.advance(1000)
    service.stop()
    service.start()
    const current = timers.advance(1000)
    finishes[0]("old")
    await old
    const extra = timers.advance(1000)
    expect(clipboard.readTextCalls).toBe(2)
    service.stop()
    finishes[1]("current")
    finishes[2]?.("extra")
    await Promise.all([current, extra])
  })
  it("discards a pending read from a previous start generation", async () => {
    const { clipboard, timers, service, changes } = createHarness()
    let finish!: (text: string) => void
    let first = true
    clipboard.readText = async () => {
      if (!first) return "stale content"
      first = false
      return new Promise<string>((resolve) => { finish = resolve })
    }
    service.start()
    const pending = timers.advance(1000)
    service.stop()
    service.start()
    finish("stale content")
    await pending
    expect(changes).toEqual([])
  })
  it("does not publish a clipboard read that finishes after stop", async () => {
    const { clipboard, timers, service, changes } = createHarness()
    let finish!: (text: string) => void
    clipboard.readText = () => new Promise<string>((resolve) => { finish = resolve })
    service.start()
    const pending = timers.advance(1000)
    service.stop()
    finish("late content")
    await pending
    expect(changes).toEqual([])
  })

  it("drops text when native concealed-format detection fails", async () => {
    const { clipboard, timers, service, changes } = createHarness()
    clipboard.text = "private"
    clipboard.readBuffer = async () => { throw new Error("unavailable") }
    service.start()
    await timers.advance(1000)
    expect(changes).toEqual([])
  })
  it("records what was copied, newest first", async () => {
    const { clipboard, timers, service, changes } = createHarness()
    service.start()

    clipboard.text = "first"
    await timers.advance(1_000)
    clipboard.text = "second"
    await timers.advance(1_000)

    expect(changes.length).toBe(2)
    expect(service.snapshot().map((entry) => entry.text)).toEqual(["second", "first"])
  })

  it("moves a repeated copy back to the top instead of adding a second row", async () => {
    const { clipboard, timers, service, changes } = createHarness()
    service.start()

    clipboard.text = "alpha"
    await timers.advance(1_000)
    const firstSeenAt = service.snapshot()[0]?.copiedAt
    clipboard.text = "beta"
    await timers.advance(1_000)
    clipboard.text = "alpha"
    await timers.advance(1_000)

    const snapshot = service.snapshot()
    expect(snapshot.map((entry) => entry.text)).toEqual(["alpha", "beta"])
    expect(changes.length).toBe(3)
    // 时间要刷新，否则列表里它会一直显示成第一次复制的时间。
    expect(snapshot[0]?.copiedAt).not.toBe(firstSeenAt)
  })

  it("keeps only the newest twenty entries", async () => {
    const { clipboard, timers, service } = createHarness()
    service.start()

    for (let index = 0; index < CLIPBOARD_SYNC_MAX_ENTRIES + 5; index += 1) {
      clipboard.text = `entry-${index}`
      await timers.advance(1_000)
    }

    const texts = service.snapshot().map((entry) => entry.text)
    expect(texts.length).toBe(CLIPBOARD_SYNC_MAX_ENTRIES)
    expect(texts[0]).toBe(`entry-${CLIPBOARD_SYNC_MAX_ENTRIES + 4}`)
    expect(texts).not.toContain("entry-4")
  })

  it("stays completely silent while the clipboard does not change", async () => {
    const { clipboard, timers, service, changes } = createHarness()
    service.start()

    clipboard.text = "unchanged"
    await timers.advance(1_000)
    await timers.advance(1_000)
    await timers.advance(1_000)

    expect(changes.length).toBe(1)
    expect(clipboard.readTextCalls).toBe(6)
  })

  it("drops concealed content without recording it, and keeps working afterwards", async () => {
    const { clipboard, timers, service, changes } = await serviceWithSecret()

    expect(changes.length).toBe(0)
    expect(service.snapshot()).toEqual([])

    // 拒绝一次不能变成"从此不再工作"。
    clipboard.concealedTypes = []
    clipboard.text = "an ordinary sentence"
    await timers.advance(1_000)

    expect(changes.length).toBe(1)
    expect(service.snapshot().map((entry) => entry.text)).toEqual(["an ordinary sentence"])
  })

  it("does not leak concealed content into the entry list when the marker later clears", async () => {
    const { clipboard, timers, service, changes } = await serviceWithSecret()

    // 先把「标记还在时什么都没记」钉住。少了这半句，这个用例在探测整个失效时也是绿的
    // —— 它只断言了标记消失之后的行为，而那种情况下前半段本来就悄悄记了一条。
    expect(service.snapshot()).toEqual([])

    // 标记被第三方抹掉（装了剪切板管理器的机器上实测会发生），但内容没变。
    // 此时这条会被当成一条普通的新复制 —— 记下来是有意的：我们不能凭内容猜它是不是密码，
    // 只能凭标记。测试固定这个行为，免得以后有人以为它是 bug 而"修"成更聪明的样子。
    clipboard.concealedTypes = []
    await timers.advance(1_000)

    expect(changes.length).toBe(1)
    expect(service.snapshot().map((entry) => entry.text)).toEqual(["hunter2"])
  })

  it("drops text over the byte budget", async () => {
    const { clipboard, timers, service, changes } = createHarness()
    service.start()

    clipboard.text = "x".repeat(CLIPBOARD_SYNC_MAX_TEXT_BYTES + 1)
    await timers.advance(1_000)

    expect(changes.length).toBe(0)
    expect(service.snapshot()).toEqual([])

    clipboard.text = "small enough"
    await timers.advance(1_000)
    expect(changes.length).toBe(1)
  })

  it("records nothing for an empty clipboard, or one holding only whitespace", async () => {
    const { clipboard, timers, service, changes } = createHarness()
    service.start()

    clipboard.text = ""
    await timers.advance(1_000)
    // 纯空白同样丢掉，且判据只放在这一处：协议那边的校验器会先 trim 再判空，
    // 如果这里放行，手机上会因为一行空格把整包 20 条都拒掉。
    clipboard.text = "   \n  "
    await timers.advance(1_000)

    expect(changes.length).toBe(0)
    expect(service.snapshot()).toEqual([])
  })

  it("treats a re-copy after the clipboard was cleared as new", async () => {
    const { clipboard, timers, service, changes } = createHarness()
    service.start()

    clipboard.text = "same text"
    await timers.advance(1_000)
    clipboard.text = ""
    await timers.advance(1_000)
    clipboard.text = "same text"
    await timers.advance(1_000)

    expect(changes.length).toBe(2)
    expect(service.snapshot().length).toBe(1)
  })

  it("stops polling once stopped", async () => {
    const { clipboard, timers, service, changes } = createHarness()
    service.start()
    service.stop()

    clipboard.text = "after stop"
    await timers.advance(5_000)

    expect(changes.length).toBe(0)
    expect(clipboard.readTextCalls).toBe(0)
  })

  it("does not stack timers when started twice", async () => {
    const { clipboard, timers, service } = createHarness()
    service.start()
    service.start()

    clipboard.text = "once"
    await timers.advance(1_000)

    expect(clipboard.readTextCalls).toBe(2)
  })
})

async function serviceWithSecret() {
  const harness = createHarness()
  harness.service.start()
  harness.clipboard.text = "hunter2"
  harness.clipboard.concealedTypes = [CONCEALED_ORG]
  await harness.timers.advance(1_000)
  return harness
}
