import { EventEmitter } from "node:events"
import { describe, expect, it, vi } from "vitest"
import { isMobileSummaryPayload, MOBILE_FRAME_LIMITS } from "@synapse/shared"
import type { MobileIntent, MobileTerminalFrame } from "@synapse/shared"

import type { TerminalService } from "../../../app-capabilities/terminal/main/service"
import type { TerminalStyledLine } from "../../../app-capabilities/terminal/main/emulator"
import type { TerminalLayoutNode } from "../../../app-capabilities/terminal/shared/workspace"
import type { PermissionGuard } from "../../runtime/security/permission-guard"
import { clampSummaryText, MobileGatewayService } from "../mobile-gateway-service"
import type { MobileGatewayTransport, MobileSummaryDraft } from "../mobile-gateway/transport"

/* ------------------------------------------------------------------ *
 * Test doubles
 * ------------------------------------------------------------------ */

/**
 * A deterministic scheduler. The gateway's flush windows are the behaviour under
 * test, so wall-clock timers would make the suite both slow and flaky.
 */
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

  async advance(ms: number): Promise<void> {
    this.nowMs += ms
    for (const [id, handler] of [...this.handlers]) {
      if (handler.dueMs > this.nowMs) continue
      this.handlers.delete(id)
      handler.callback()
    }
    // Let the async flush chain settle.
    for (let index = 0; index < 6; index += 1) {
      await new Promise((resolve) => setImmediate(resolve))
    }
  }
}

type FakeSession = {
  id: string
  groupId: string
  title: string
  status: "running" | "ended"
  cwd: string
  cols: number
  rows: number
  startedAt: string
  lastOutputSeq: number
  attention: { state: string; kind: string }
}

type FakeWorkspace = {
  id: string
  groupId: string
  title: string
  layout: TerminalLayoutNode
}

class FakeTerminal {
  readonly events = new EventEmitter()
  readonly sessions = new Map<string, FakeSession>()
  readonly workspaces = new Map<string, FakeWorkspace>()
  readonly lines = new Map<string, TerminalStyledLine[]>()
  readonly calls: string[] = []
  leaseOwner: string | null = null
  deny = false

  listGroups() {
    return [{ id: "g1", name: "前端开发" }]
  }

  listSessions(): FakeSession[] {
    return [...this.sessions.values()]
  }

  listWorkspaces(): FakeWorkspace[] {
    return [...this.workspaces.values()]
  }

  getSession(input: { sessionId: string }): FakeSession {
    const session = this.sessions.get(input.sessionId)
    if (!session) throw Object.assign(new Error("missing"), { code: "not_found" })
    return session
  }

  async readLineWindow(input: { sessionId: string; maxLines: number }) {
    const all = this.lines.get(input.sessionId) ?? []
    const lines = all.slice(Math.max(0, all.length - input.maxLines))
    return {
      lines,
      startIndex: all.length - lines.length,
      totalLines: all.length,
      cols: 80,
      rows: 24,
      cursor: { row: lines.length, col: 0, visible: true },
      alt: false,
      throughOutputSeq: this.sessions.get(input.sessionId)?.lastOutputSeq ?? 0,
      sizeRevision: 1,
    }
  }

  async readLineRange(input: { sessionId: string; from: number; maxLines: number }) {
    const all = this.lines.get(input.sessionId) ?? []
    const start = Math.max(0, Math.min(input.from, all.length))
    const end = Math.min(all.length, start + input.maxLines)
    return { lines: all.slice(start, end), startIndex: start }
  }

  getSessionState(_sessionId: string, controller?: { clientId: string }) {
    const mine = this.leaseOwner !== null && this.leaseOwner === controller?.clientId
    return {
      lease: this.leaseOwner === null
        ? { occupied: false, leaseRevision: 1 }
        : { occupied: true, own: mine, leaseRevision: 1 },
    }
  }

  async acquireControl(_input: unknown, controller: { clientId: string }) {
    this.calls.push("acquireControl")
    if (this.leaseOwner !== null && this.leaseOwner !== controller.clientId) {
      throw Object.assign(new Error("busy"), { code: "control_busy" })
    }
    this.leaseOwner = controller.clientId
    return {
      leaseId: "lease-1",
      acquiredAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      leaseRevision: 1,
      stateRevision: 1,
      inputRevision: 7,
    }
  }

  async renewControl() {
    return {
      leaseId: "lease-1",
      acquiredAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      leaseRevision: 2,
      stateRevision: 1,
      inputRevision: 7,
    }
  }

  releaseControl() {
    this.calls.push("releaseControl")
    this.leaseOwner = null
    return { released: true, noOp: false, stateRevision: 1 }
  }

  async sendCommand() {
    this.calls.push("sendCommand")
    return { outcome: "accepted" }
  }

  async sendSemanticInput() {
    this.calls.push("sendSemanticInput")
    return { outcome: "accepted" }
  }

  async stopControlledSession() {
    this.calls.push("stopControlledSession")
    return { outcome: "accepted" }
  }

  async deleteSession() {
    this.calls.push("deleteSession")
  }

  async createSession() {
    this.calls.push("createSession")
    return { id: "sess-new" }
  }

  async launchGroupCommand() {
    this.calls.push("launchGroupCommand")
    return { id: "sess-command" }
  }

  async renameSession() {
    this.calls.push("renameSession")
    return { id: "sess-1" }
  }
}

function createHarness(options: { sessionLines?: number } = {}) {
  const terminal = new FakeTerminal()
  terminal.sessions.set("sess-1", {
    id: "sess-1",
    groupId: "g1",
    title: "dev-server",
    status: "running",
    cwd: "/Users/liy/code",
    cols: 80,
    rows: 24,
    startedAt: new Date().toISOString(),
    lastOutputSeq: 1,
    attention: { state: "not_waiting", kind: "unknown" },
  })
  terminal.lines.set(
    "sess-1",
    Array.from({ length: options.sessionLines ?? 3 }, (_, index) => ({ text: `line-${index}` })),
  )

  const timers = new ManualTimers()
  const frames: { mobileClientInstanceId: string; frame: MobileTerminalFrame }[] = []
  const summaries: unknown[] = []
  const results: unknown[] = []
  const transport: MobileGatewayTransport = {
    sendSummary: (draft) => summaries.push(draft),
    sendFrame: (mobileClientInstanceId, frame) => frames.push({ mobileClientInstanceId, frame }),
    sendIntentResult: (mobileClientInstanceId, result) => {
      results.push({ mobileClientInstanceId, result })
    },
  }
  const audits: unknown[] = []
  const permissionGuard = {
    check: vi.fn(async () => (terminal.deny
      ? { allowed: false, reason: "denied" }
      : { allowed: true })),
  } as unknown as PermissionGuard

  const gateway = new MobileGatewayService({
    terminal: terminal as unknown as TerminalService,
    permissionGuard,
    auditSink: { record: (event: unknown) => audits.push(event), list: () => [], clearForTests: () => {} },
    logger: { info: () => {}, warn: () => {} },
    now: () => new Date(timers.nowMs),
    setTimeout: timers.set,
    clearTimeout: timers.clear,
    lineWindowLines: 100,
  })
  gateway.start()
  gateway.setTransport(transport)

  return { gateway, terminal, timers, transport, frames, summaries, results, audits, permissionGuard }
}

/** Seeds one tab under a fixed id. The gateway walks this layout, never the tree's storage. */
function seedWorkspace(harness: ReturnType<typeof createHarness>, layout: TerminalLayoutNode): void {
  harness.terminal.workspaces.set("ws-1", {
    id: "ws-1",
    groupId: "g1",
    title: "前端开发",
    layout,
  })
}

/** Adds a conversation, as splitting a pane does when a tab gains one. */
function addSession(harness: ReturnType<typeof createHarness>, id: string, title: string): void {
  const existing = harness.terminal.sessions.get("sess-1")!
  harness.terminal.sessions.set(id, { ...existing, id, title })
}

function intent<T extends MobileIntent>(value: T): T {
  return value
}

async function attach(
  harness: ReturnType<typeof createHarness>,
  overrides: Partial<MobileIntent> = {},
): Promise<void> {
  await harness.gateway.handleIntent("phone-1", {
    v: 1,
    intentId: "i-attach",
    kind: "attach",
    sessionId: "sess-1",
    ...overrides,
  } as MobileIntent)
}

/* ------------------------------------------------------------------ *
 * Tests
 * ------------------------------------------------------------------ */

describe("MobileGatewayService", () => {
  it("sends a full snapshot when a phone attaches", async () => {
    const harness = createHarness()
    await attach(harness)

    expect(harness.frames).toHaveLength(1)
    expect(harness.frames[0].frame.kind).toBe("reset")
    expect(harness.frames[0].frame.lines.map((line) => line[0]))
      .toEqual(["line-0", "line-1", "line-2"])
    expect(harness.terminal.calls).toContain("acquireControl")
  })

  it("sends only the appended tail as output arrives", async () => {
    const harness = createHarness()
    await attach(harness)
    harness.frames.length = 0

    harness.terminal.lines.set("sess-1", [
      { text: "line-0" },
      { text: "line-1" },
      { text: "line-2" },
      { text: "line-3" },
    ])
    harness.terminal.events.emit("data", { sessionId: "sess-1", chunk: { seq: 2 } })
    await harness.timers.advance(60)

    expect(harness.frames).toHaveLength(1)
    expect(harness.frames[0].frame.kind).toBe("suffix")
    expect(harness.frames[0].frame.lines.map((line) => line[0])).toEqual(["line-3"])
  })

  it("stays completely silent while the terminal is idle", async () => {
    const harness = createHarness()
    await attach(harness)
    // Let the first session list go out, then confirm an idle desktop adds nothing.
    await harness.timers.advance(2_000)
    harness.frames.length = 0
    const summariesBefore = harness.summaries.length

    await harness.timers.advance(5_000)

    expect(harness.frames).toHaveLength(0)
    expect(harness.summaries.length).toBe(summariesBefore)
  })

  it("writes to an existing terminal without any unlock step, and audits the write", async () => {
    const harness = createHarness()
    await attach(harness)
    harness.terminal.calls.length = 0

    await harness.gateway.handleIntent("phone-1", intent({
      v: 1,
      intentId: "i-cmd",
      kind: "command",
      sessionId: "sess-1",
      text: "pnpm dev",
    }))

    // Attaching is the whole gate: a phone that opened a terminal can type into it.
    expect(harness.terminal.calls).toContain("sendCommand")
    expect(harness.results.at(-1)).toMatchObject({ result: { outcome: "accepted" } })
    expect(harness.audits).toContainEqual(expect.objectContaining({
      action: "terminal.session.control",
      outcome: "allowed",
    }))
  })

  it("replays the stored result for a resent intent instead of acting twice", async () => {
    const harness = createHarness()
    await attach(harness)
    harness.terminal.calls.length = 0
    const command = intent({
      v: 1,
      intentId: "i-cmd",
      kind: "command",
      sessionId: "sess-1",
      text: "ls",
    })

    await harness.gateway.handleIntent("phone-1", command)
    await harness.gateway.handleIntent("phone-1", command)

    // A phone on a flaky link may resend blindly; the second one must be a replay.
    expect(harness.terminal.calls.filter((call) => call === "sendCommand")).toHaveLength(1)
    expect(harness.results.filter((entry) => {
      const result = (entry as { result: { intentId: string } }).result
      return result.intentId === "i-cmd"
    })).toHaveLength(2)
  })

  it("rejects a write when another client takes the lease", async () => {
    const harness = createHarness()
    await attach(harness)
    // The desktop typing preempts the phone's lease.
    harness.terminal.leaseOwner = "synapse-ui"
    harness.terminal.events.emit("stateChanged", {
      sessionId: "sess-1",
      stateRevision: 2,
      changeTypes: ["lease.user_takeover"],
    })
    await harness.timers.advance(0)
    harness.terminal.calls.length = 0

    await harness.gateway.handleIntent("phone-1", intent({
      v: 1,
      intentId: "i-cmd",
      kind: "command",
      sessionId: "sess-1",
      text: "ls",
    }))

    expect(harness.terminal.calls).not.toContain("sendCommand")
    expect(harness.results.at(-1)).toMatchObject({
      result: { outcome: "rejected", code: "lease_preempted" },
    })
  })

  it("lets the phone reclaim control after a preemption by unlocking again", async () => {
    const harness = createHarness()
    await attach(harness)
    harness.terminal.leaseOwner = "synapse-ui"
    harness.terminal.events.emit("stateChanged", {
      sessionId: "sess-1",
      stateRevision: 2,
      changeTypes: ["lease.user_takeover"],
    })
    await harness.timers.advance(0)

    // The other writer lets go; the unlock intent is how the phone takes the lease
    // back. It grants nothing beyond that — the gate it also used to open is gone.
    harness.terminal.leaseOwner = null
    await harness.gateway.handleIntent("phone-1", intent({
      v: 1,
      intentId: "i-unlock",
      kind: "unlock",
      sessionId: "sess-1",
    }))
    harness.terminal.calls.length = 0
    await harness.gateway.handleIntent("phone-1", intent({
      v: 1,
      intentId: "i-cmd",
      kind: "command",
      sessionId: "sess-1",
      text: "ls",
    }))

    expect(harness.terminal.calls).toContain("sendCommand")
  })

  it("stops a running terminal instead of deleting it, and audits the delete", async () => {
    const harness = createHarness()
    await attach(harness)
    harness.terminal.calls.length = 0

    await harness.gateway.handleIntent("phone-1", intent({
      v: 1,
      intentId: "i-delete",
      kind: "delete",
      sessionId: "sess-1",
    }))

    // The service answers a delete of a live session with `lifecycle_conflict`,
    // and the stop is what removes it — the PTY exiting destroys the session. So
    // deleteSession must not be reached at all here.
    expect(harness.terminal.calls).toContain("stopControlledSession")
    expect(harness.terminal.calls).not.toContain("deleteSession")
    expect(harness.results.at(-1)).toMatchObject({ result: { outcome: "accepted" } })
    expect(harness.audits).toContainEqual(expect.objectContaining({
      action: "terminal.session.delete",
      outcome: "allowed",
    }))
  })

  it("deletes a terminal that has already ended", async () => {
    const harness = createHarness()
    await attach(harness)
    // Ended sessions linger so they can be cleaned up on request; there is nothing
    // left to stop.
    const session = harness.terminal.sessions.get("sess-1")
    if (session) session.status = "ended"
    harness.terminal.calls.length = 0

    await harness.gateway.handleIntent("phone-1", intent({
      v: 1,
      intentId: "i-delete",
      kind: "delete",
      sessionId: "sess-1",
    }))

    expect(harness.terminal.calls).toContain("deleteSession")
    expect(harness.terminal.calls).not.toContain("stopControlledSession")
    expect(harness.results.at(-1)).toMatchObject({ result: { outcome: "accepted" } })
  })

  it("renames a terminal and audits it", async () => {
    const harness = createHarness()
    await attach(harness)
    harness.terminal.calls.length = 0

    await harness.gateway.handleIntent("phone-1", intent({
      v: 1,
      intentId: "i-rename",
      kind: "rename",
      sessionId: "sess-1",
      title: "api",
    }))

    expect(harness.terminal.calls).toContain("renameSession")
    expect(harness.results.at(-1)).toMatchObject({ result: { outcome: "accepted" } })
    expect(harness.audits).toContainEqual(expect.objectContaining({
      action: "terminal.metadata.manage",
      outcome: "allowed",
    }))
  })

  it("attaches anyway when another writer already holds the lease", async () => {
    const harness = createHarness()
    harness.terminal.leaseOwner = "someone-else"

    await attach(harness)

    // Watching works without the lease; only writing waits for it. The message
    // tells the phone who is holding it, not that the terminal is unusable.
    expect(harness.frames).toHaveLength(1)
    expect(harness.results.at(-1)).toMatchObject({
      result: { outcome: "accepted", message: expect.stringContaining("另一个客户端") },
    })
  })

  it("rejects an intent the local policy denies without touching the terminal", async () => {
    const harness = createHarness()
    await attach(harness)
    harness.terminal.deny = true
    harness.terminal.calls.length = 0

    await harness.gateway.handleIntent("phone-1", intent({
      v: 1,
      intentId: "i-stop",
      kind: "stop",
      sessionId: "sess-1",
    }))

    expect(harness.terminal.calls).not.toContain("stopControlledSession")
    expect(harness.results.at(-1)).toMatchObject({
      result: { outcome: "rejected", code: "permission_denied" },
    })
    expect(harness.audits).toContainEqual(expect.objectContaining({
      action: "terminal.session.stop",
      outcome: "denied",
      actor: { kind: "agent", id: "mobile-gateway" },
    }))
  })

  it("audits allowed operations as the mobile gateway agent, never as the user", async () => {
    const harness = createHarness()
    await attach(harness)

    expect(harness.audits.length).toBeGreaterThan(0)
    for (const entry of harness.audits as { actor: { kind: string; id: string } }[]) {
      expect(entry.actor).toEqual({ kind: "agent", id: "mobile-gateway" })
    }
  })

  it("drops a session and releases its lease when the terminal ends", async () => {
    const harness = createHarness()
    await attach(harness)
    expect(harness.gateway.getState().attachments).toBe(1)

    harness.terminal.events.emit("sessionDeleted", { sessionId: "sess-1" })
    await harness.timers.advance(0)

    expect(harness.gateway.getState().attachments).toBe(0)
  })

  it("frees a session's lease when the phone goes away", async () => {
    const harness = createHarness()
    await attach(harness)
    harness.terminal.calls.length = 0

    await harness.gateway.releaseClient("phone-1")

    expect(harness.gateway.getState().attachments).toBe(0)
    expect(harness.terminal.calls).toContain("releaseControl")
  })

  it("takes over a created session so the phone lands on a live terminal", async () => {
    const harness = createHarness()
    harness.terminal.sessions.set("sess-new", {
      id: "sess-new",
      groupId: "g1",
      title: "shell",
      status: "running",
      cwd: "/tmp",
      cols: 80,
      rows: 24,
      startedAt: new Date().toISOString(),
      lastOutputSeq: 0,
      attention: { state: "unknown", kind: "unknown" },
    })
    harness.terminal.lines.set("sess-new", [])

    await harness.gateway.handleIntent("phone-1", intent({
      v: 1,
      intentId: "i-create",
      kind: "create",
      groupId: "g1",
    }))

    expect(harness.results.at(-1)).toMatchObject({
      result: { outcome: "accepted", createdSessionId: "sess-new" },
    })
    expect(harness.gateway.getState().attachments).toBe(1)
  })

  it("reports no_op for a keepalive and keeps the attachment alive", async () => {
    const harness = createHarness()
    await attach(harness)

    await harness.timers.advance(4 * 60_000)
    await harness.gateway.handleIntent("phone-1", intent({ v: 1, intentId: "i-ping", kind: "ping" }))
    await harness.timers.advance(4 * 60_000)

    expect(harness.gateway.getState().attachments).toBe(1)
    expect(harness.results.at(-1)).toMatchObject({ result: { outcome: "no_op" } })
  })

  it("releases attachments from a phone that stopped responding", async () => {
    const harness = createHarness()
    await attach(harness)
    harness.terminal.calls.length = 0

    await harness.timers.advance(6 * 60_000)

    expect(harness.gateway.getState().attachments).toBe(0)
    expect(harness.terminal.calls).toContain("releaseControl")
  })

  it("sends the session list once and then deduplicates it", async () => {
    const harness = createHarness()
    await harness.timers.advance(1_000)
    const afterFirst = harness.summaries.length

    await harness.timers.advance(3_000)

    expect(afterFirst).toBeGreaterThan(0)
    expect(harness.summaries.length).toBe(afterFirst)
  })

  it("checks policy under the narrow agent identity, never the user", async () => {
    const harness = createHarness()
    await attach(harness)

    expect(harness.permissionGuard.check).toHaveBeenCalledWith(expect.objectContaining({
      actor: { kind: "agent", id: "mobile-gateway" },
      resource: "terminal.session:sess-1",
      action: "terminal.state.read",
    }))
  })
  it("anchors gateway indices to the emulator's own so history can be named", async () => {
    // 300 lines behind a 100-line window: the window starts at emulator index 200,
    // and the client's oldest line must be index 200 rather than 0, or nothing
    // older than the window could ever be requested.
    const harness = createHarness({ sessionLines: 300 })
    await attach(harness)

    const snapshot = harness.frames[0].frame
    expect(snapshot.from).toBe(200)
    expect(snapshot.total).toBe(300)
  })

  it("serves the page just below what the phone already has", async () => {
    const harness = createHarness({ sessionLines: 300 })
    await attach(harness)
    harness.frames.length = 0

    await harness.gateway.handleIntent("phone-1", intent({
      v: 1,
      intentId: "i-history",
      kind: "history",
      sessionId: "sess-1",
      before: 200,
      limit: 50,
    }))

    expect(harness.frames).toHaveLength(1)
    const frame = harness.frames[0].frame
    expect(frame.kind).toBe("history")
    expect(frame.from).toBe(150)
    expect(frame.lines).toHaveLength(50)
    expect(frame.lines[0][0]).toBe("line-150")
    expect(frame.lines.at(-1)?.[0]).toBe("line-199")
  })

  it("walks backwards across pages until the buffer runs out", async () => {
    const harness = createHarness({ sessionLines: 300 })
    await attach(harness)
    harness.frames.length = 0

    let before = 200
    for (let page = 0; page < 5; page += 1) {
      await harness.gateway.handleIntent("phone-1", intent({
        v: 1,
        intentId: `i-history-${page}`,
        kind: "history",
        sessionId: "sess-1",
        before,
        limit: 50,
      }))
      const frame = harness.frames.at(-1)!.frame
      if (frame.lines.length === 0) break
      before = frame.from
    }

    // 200 lines below the window, 50 at a time: four pages, then an empty one
    // that tells the phone to stop asking.
    expect(before).toBe(0)
    const last = harness.frames.at(-1)!.frame
    expect(last.lines).toHaveLength(0)
    expect(last.from).toBe(0)
  })

  it("answers an empty page, not an error, once the emulator has evicted the rest", async () => {
    const harness = createHarness({ sessionLines: 30 })
    await attach(harness)
    harness.frames.length = 0

    await harness.gateway.handleIntent("phone-1", intent({
      v: 1,
      intentId: "i-history",
      kind: "history",
      sessionId: "sess-1",
      before: 0,
      limit: 50,
    }))

    const frame = harness.frames[0].frame
    expect(frame.kind).toBe("history")
    expect(frame.lines).toHaveLength(0)
  })

  it("pages through a terminal's history without touching the write lease", async () => {
    // Looking further back is reading, so it must not need the lease a write does.
    const harness = createHarness({ sessionLines: 300 })
    await attach(harness)
    harness.frames.length = 0

    await harness.gateway.handleIntent("phone-1", intent({
      v: 1,
      intentId: "i-history",
      kind: "history",
      sessionId: "sess-1",
      before: 200,
      limit: 10,
    }))

    expect(harness.results.at(-1)).toMatchObject({ result: { outcome: "accepted" } })
    expect(harness.frames[0].frame.lines).toHaveLength(10)
  })
  it("keeps the cursor on the same line when only the tail of the window changes", async () => {
    // The window's head is unchanged, so the update's `from` is the first *changed*
    // line — later than the window's start. Deriving the cursor's gateway row from
    // that instead of from the window's start pushed it down by however much of the
    // window had not changed, which is what put the cursor on the wrong row on a
    // phone. The window did not move here, so the cursor must not either.
    const harness = createHarness({ sessionLines: 40 })
    await attach(harness)

    const lines = Array.from({ length: 40 }, (_, index) => ({ text: `line-${index}` }))
    harness.terminal.lines.set("sess-1", lines)
    harness.terminal.events.emit("data", { sessionId: "sess-1", chunk: { seq: 2 } })
    await harness.timers.advance(60)
    const settled = harness.frames.at(-1)!.frame.cursor.row

    harness.frames.length = 0
    const changed = lines.map((line, index) => index === 39 ? { text: "line-39 rewritten" } : line)
    harness.terminal.lines.set("sess-1", changed)
    harness.terminal.events.emit("data", { sessionId: "sess-1", chunk: { seq: 3 } })
    await harness.timers.advance(60)

    expect(harness.frames.at(-1)?.frame.cursor.row).toBe(settled)
  })

  it("never emits a negative line index while the buffer is still filling", async () => {
    // The window slides over a growing buffer without anything being evicted, so
    // the emulator's window start and the tracker's do not move together. Mapping
    // through the window position instead of the eviction count produced a
    // negative index here — and a negative index is a malformed frame, which the
    // server answers by closing the desktop's whole connection.
    const harness = createHarness({ sessionLines: 40 })
    await attach(harness)
    harness.frames.length = 0

    harness.terminal.lines.set(
      "sess-1",
      Array.from({ length: 260 }, (_, index) => ({ text: `grown-${index}` })),
    )
    harness.terminal.events.emit("data", { sessionId: "sess-1", chunk: { seq: 2 } })
    await harness.timers.advance(60)

    await harness.gateway.handleIntent("phone-1", intent({
      v: 1,
      intentId: "i-history",
      kind: "history",
      sessionId: "sess-1",
      before: 0,
      limit: 50,
    }))

    for (const entry of harness.frames) {
      expect(entry.frame.from).toBeGreaterThanOrEqual(0)
    }
    // Nothing older than the anchor exists in gateway space, so this is the end.
    expect(harness.frames.at(-1)?.frame.lines).toHaveLength(0)
  })

  it("never serves a page that reaches below index zero", async () => {
    const harness = createHarness({ sessionLines: 300 })
    await attach(harness)
    harness.frames.length = 0

    // A greedier request than the history holds must be clamped, not allowed to
    // run off the bottom of the index space.
    await harness.gateway.handleIntent("phone-1", intent({
      v: 1,
      intentId: "i-history",
      kind: "history",
      sessionId: "sess-1",
      before: 200,
      limit: 500,
    }))

    const frame = harness.frames[0].frame
    expect(frame.from).toBe(0)
    expect(frame.lines).toHaveLength(200)
  })

  it("clamps a session field that outgrows the wire bound rather than failing validation", async () => {
    const harness = createHarness()
    const existing = harness.terminal.sessions.get("sess-1")!
    harness.terminal.sessions.set("sess-1", {
      ...existing,
      title: "t".repeat(MOBILE_FRAME_LIMITS.maxTitleLength + 500),
      cwd: "/".concat("d".repeat(MOBILE_FRAME_LIMITS.maxSummaryCwdLength + 500)),
    })
    harness.terminal.lines.set("sess-1", [
      { text: "l".repeat(MOBILE_FRAME_LIMITS.maxSummaryLastLineLength + 500) },
    ])

    await harness.timers.advance(1_000)

    const draft = harness.summaries.at(-1) as MobileSummaryDraft
    const session = draft.sessions[0]
    expect(session.title).toHaveLength(MOBILE_FRAME_LIMITS.maxTitleLength)
    expect(session.cwd).toHaveLength(MOBILE_FRAME_LIMITS.maxSummaryCwdLength)
    expect(session.lastLine).toHaveLength(MOBILE_FRAME_LIMITS.maxSummaryLastLineLength)
    // The point of clamping is not the truncation itself but that what the desktop
    // emits is accepted by the relay; a rejection here closes the socket.
    expect(isMobileSummaryPayload({
      desktopClientInstanceId: "desktop-1",
      desktopName: "MacBook Pro",
      ...draft,
    })).toBe(true)
  })

  it("keeps the largest admissible session list inside the summary's byte budget", async () => {
    const harness = createHarness()
    const limits = MOBILE_FRAME_LIMITS
    harness.terminal.sessions.clear()
    harness.terminal.lines.clear()
    for (let index = 0; index < limits.maxSummarySessions; index += 1) {
      // Long enough to hit every field bound, and unique so the per-session caches
      // and line lookups cannot collapse the rows into one.
      const suffix = String(index).padStart(4, "0")
      const id = `${"i".repeat(limits.maxSummaryIdLength - 4)}${suffix}`
      harness.terminal.sessions.set(id, {
        id,
        groupId: "g".repeat(limits.maxSummaryIdLength),
        title: "t".repeat(limits.maxTitleLength),
        status: "running",
        cwd: "/".concat("d".repeat(limits.maxSummaryCwdLength - 1)),
        cols: 500,
        rows: 200,
        startedAt: new Date().toISOString(),
        lastOutputSeq: index,
        attention: { state: "not_waiting", kind: "unknown" },
      })
      harness.terminal.lines.set(id, [
        { text: "l".repeat(limits.maxSummaryLastLineLength) },
      ])
    }

    await harness.timers.advance(1_000)

    const draft = harness.summaries.at(-1) as MobileSummaryDraft
    expect(draft.sessions).toHaveLength(limits.maxSummarySessions)
    expect(Buffer.byteLength(JSON.stringify(draft), "utf8")).toBeLessThanOrEqual(limits.maxSummaryBytes)
    expect(isMobileSummaryPayload({
      desktopClientInstanceId: "desktop-1",
      desktopName: "MacBook Pro",
      ...draft,
    })).toBe(true)
  })

  it("never splits a surrogate pair when clamping", () => {
    expect(clampSummaryText("👍".repeat(10), 5)).toBe("👍".repeat(2))
    expect(clampSummaryText("ab👍", 3)).toBe("ab")
    expect(clampSummaryText("abc", 10)).toBe("abc")
  })

  it("omits the tab layer while no tab is split", async () => {
    const harness = createHarness()
    // A conversation's own tab, which is what every session gets by default.
    seedWorkspace(harness, { type: "leaf", paneId: "pane-1", sessionId: "sess-1" })

    await harness.timers.advance(1_000)

    const draft = harness.summaries.at(-1) as MobileSummaryDraft
    expect(draft.sessions).toHaveLength(1)
    // One pane per tab is what the flat list already says, so restating it would be
    // overhead on every summary and would change the payload for phones that do not
    // need it.
    expect(draft.workspaces).toBeUndefined()
    // The serialized form is the one that matters: the fingerprint is taken over it,
    // so an unsplit desktop hashes — and therefore costs — exactly what it did before
    // the tab layer existed.
    expect(JSON.stringify(draft)).not.toContain("workspaces")
  })

  it("reports which conversations share a tab once one is split", async () => {
    const harness = createHarness()
    addSession(harness, "sess-2", "前端开发 #2")
    seedWorkspace(harness, {
      type: "split",
      splitId: "split-1",
      direction: "horizontal",
      ratio: 0.5,
      first: { type: "leaf", paneId: "pane-1", sessionId: "sess-1" },
      second: { type: "leaf", paneId: "pane-2", sessionId: "sess-2" },
    })

    await harness.timers.advance(1_000)

    const draft = harness.summaries.at(-1) as MobileSummaryDraft
    expect(draft.workspaces).toEqual([{
      id: "ws-1",
      groupId: "g1",
      title: "前端开发",
      panes: [
        { paneId: "pane-1", sessionId: "sess-1" },
        { paneId: "pane-2", sessionId: "sess-2" },
      ],
    }])
  })

  it("treats a split as a change worth pushing", async () => {
    const harness = createHarness()
    seedWorkspace(harness, { type: "leaf", paneId: "pane-1", sessionId: "sess-1" })
    await harness.timers.advance(1_000)
    const beforeSplit = harness.summaries.length
    expect((harness.summaries.at(-1) as MobileSummaryDraft).workspaces).toBeUndefined()

    // Splitting creates a session, which is what the terminal service announces; the
    // summary is only ever produced in response to an event, so without this the new
    // tab layer would sit unsent.
    addSession(harness, "sess-2", "前端开发 #2")
    seedWorkspace(harness, {
      type: "split",
      splitId: "split-1",
      direction: "horizontal",
      ratio: 0.5,
      first: { type: "leaf", paneId: "pane-1", sessionId: "sess-1" },
      second: { type: "leaf", paneId: "pane-2", sessionId: "sess-2" },
    })
    harness.terminal.events.emit("sessionChanged", { sessionId: "sess-2" })

    await harness.timers.advance(1_000)

    expect(harness.summaries.length).toBeGreaterThan(beforeSplit)
    const draft = harness.summaries.at(-1) as MobileSummaryDraft
    expect(draft.workspaces).toHaveLength(1)
    expect(draft.workspaces?.[0].panes.map((pane) => pane.sessionId)).toEqual(["sess-1", "sess-2"])
  })

  it("treats closing a pane as a change worth pushing too", async () => {
    const harness = createHarness()
    addSession(harness, "sess-2", "前端开发 #2")
    seedWorkspace(harness, {
      type: "split",
      splitId: "split-1",
      direction: "horizontal",
      ratio: 0.5,
      first: { type: "leaf", paneId: "pane-1", sessionId: "sess-1" },
      second: { type: "leaf", paneId: "pane-2", sessionId: "sess-2" },
    })
    await harness.timers.advance(1_000)
    const withSplit = harness.summaries.length
    expect((harness.summaries.at(-1) as MobileSummaryDraft).workspaces).toHaveLength(1)

    // Closing the pane takes its session with it and collapses the tab back to one
    // leaf, which is the point where the layer stops carrying information.
    harness.terminal.sessions.delete("sess-2")
    seedWorkspace(harness, { type: "leaf", paneId: "pane-1", sessionId: "sess-1" })
    harness.terminal.events.emit("sessionDeleted", { sessionId: "sess-2" })

    await harness.timers.advance(1_000)

    expect(harness.summaries.length).toBeGreaterThan(withSplit)
    expect((harness.summaries.at(-1) as MobileSummaryDraft).workspaces).toBeUndefined()
  })

  it("never names a conversation the summary does not carry", async () => {
    const harness = createHarness()
    // A persisted layout whose second session did not survive the reload: the tab is
    // real, the conversation behind one of its panes is not.
    seedWorkspace(harness, {
      type: "split",
      splitId: "split-1",
      direction: "horizontal",
      ratio: 0.5,
      first: { type: "leaf", paneId: "pane-1", sessionId: "sess-1" },
      second: { type: "leaf", paneId: "pane-2", sessionId: "sess-gone" },
    })

    await harness.timers.advance(1_000)

    // Filtering leaves one pane, which is the unsplit case again — a tab the phone
    // could not draw any useful distinction from the flat list.
    const draft = harness.summaries.at(-1) as MobileSummaryDraft
    expect(draft.sessions).toHaveLength(1)
    expect(draft.workspaces).toBeUndefined()
  })

  it("keeps the surviving panes of a tab when another one's session is gone", async () => {
    const harness = createHarness()
    addSession(harness, "sess-2", "前端开发 #2")
    seedWorkspace(harness, {
      type: "split",
      splitId: "split-1",
      direction: "horizontal",
      ratio: 0.5,
      first: { type: "leaf", paneId: "pane-1", sessionId: "sess-1" },
      second: {
        type: "split",
        splitId: "split-2",
        direction: "vertical",
        ratio: 0.5,
        first: { type: "leaf", paneId: "pane-2", sessionId: "sess-2" },
        second: { type: "leaf", paneId: "pane-3", sessionId: "sess-gone" },
      },
    })

    await harness.timers.advance(1_000)

    const draft = harness.summaries.at(-1) as MobileSummaryDraft
    expect(draft.workspaces?.[0].panes).toEqual([
      { paneId: "pane-1", sessionId: "sess-1" },
      { paneId: "pane-2", sessionId: "sess-2" },
    ])
  })
})
