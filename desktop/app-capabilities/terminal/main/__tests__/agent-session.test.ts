import { describe, expect, it } from "vitest"

import { terminalAgentSessionRecordSchema, type TerminalAgentSessionRecord } from "../../shared/schema"
import {
  applyTerminalAgentUpdate,
  createTerminalAgentSession,
  reduceTerminalAgentEvent,
  terminalAgentProcessExitUpdate,
  nextTerminalAgentVersion,
  type TerminalAgentEvent,
  type TerminalAgentSession,
} from "../agent-session"

const SESSION = "7a5f83f3-9782-4cb0-a268-1ee7ad0b740f"
const AT = "2026-09-19T10:00:00.000Z"

function base(): TerminalAgentSession {
  return createTerminalAgentSession({ sessionId: SESSION, at: AT })
}

/** 把一串事件喂进去，返回每一步之后的档案。 */
function walk(events: readonly Partial<TerminalAgentEvent>[]): TerminalAgentSession[] {
  const states: TerminalAgentSession[] = []
  let current: TerminalAgentSession | undefined = base()
  for (const [index, partial] of events.entries()) {
    const event = { source: "claude", event: "Stop", at: `2026-09-19T10:00:0${String(index)}.000Z`, ...partial } as TerminalAgentEvent
    const update = reduceTerminalAgentEvent({ current, sessionId: SESSION, event })
    current = update ? applyTerminalAgentUpdate(current, update).session : current
    states.push(current)
  }
  return states
}

/** 只在类型层面成立：两个方向都赋得进去，说明内存类型与落盘 schema 没有分叉。 */
function assertSameShape(record: TerminalAgentSession): void {
  const asRecord: TerminalAgentSessionRecord = record
  const back: TerminalAgentSession = asRecord
  void back
}

describe("TerminalAgentSession state machine", () => {
  it("walks launching → idle → working → needs_input → working → idle → ended", () => {
    const states = walk([
      { event: "AgentProcessStart", pid: 4242, agentSessionId: "agent-1" },
      { event: "UserPromptSubmit" },
      { event: "PermissionRequest" },
      { event: "PostToolUse", toolName: "Edit" },
      { event: "Stop" },
      { event: "SessionEnd" },
    ])

    expect(states.map((session) => session.state)).toEqual([
      "idle",
      "working",
      "needs_input",
      "working",
      "idle",
      "ended",
    ])
    // 每一步都要看得见版本在走，否则「只应用更新的一条」就没有依据。
    expect(states.map((session) => session.version)).toEqual([2, 3, 4, 5, 6, 7])
    expect(states[0]).toMatchObject({ agentKind: "claude", agentSessionId: "agent-1", pid: 4242 })
  })

  it("leaves the parent alone when a subagent stops", () => {
    const [afterStart, working] = walk([
      { event: "AgentProcessStart", pid: 4242 },
      { event: "UserPromptSubmit" },
    ])
    let current = working

    for (const event of [
      { event: "SubagentStop", agentId: "child-1" },
      { event: "Stop", agentId: "child-1" },
      { event: "PreToolUse", parentSessionId: "child-2" },
    ] as const) {
      const update = reduceTerminalAgentEvent({
        current,
        sessionId: SESSION,
        event: { source: "claude", at: AT, ...event },
      })
      expect(update).toBeNull()
      expect(current).toBe(working)
    }
    expect(afterStart?.state).toBe("idle")
    expect(working?.state).toBe("working")
  })

  it("rejects a verdict about a process that is no longer the current one", () => {
    // `--resume` 换了一任进程，前任随后才被探测到「不在了」。它说的不是这一任的事。
    const resumed = walk([
      { event: "AgentProcessStart", pid: 100 },
      { event: "UserPromptSubmit" },
      { event: "AgentProcessStart", pid: 200 },
      { event: "UserPromptSubmit" },
    ]).at(-1)!
    expect(resumed).toMatchObject({ pid: 200, state: "working" })

    const { applied, session } = applyTerminalAgentUpdate(
      resumed,
      terminalAgentProcessExitUpdate(resumed, { pid: 100, at: "2026-09-19T10:01:00.000Z" }),
    )
    expect(applied).toBe(false)
    expect(session).toBe(resumed)
    expect(session.state).toBe("working")

    // 讲的仍然是自己这一任时才作数。
    const own = applyTerminalAgentUpdate(
      resumed,
      terminalAgentProcessExitUpdate(resumed, { pid: 200, at: "2026-09-19T10:01:00.000Z" }),
    )
    expect(own.applied).toBe(true)
    expect(own.session.state).toBe("ended")
  })

  it("is idempotent: a repeated or older update changes nothing", () => {
    const current = walk([
      { event: "AgentProcessStart", pid: 100 },
      { event: "UserPromptSubmit" },
    ]).at(-1)!
    const update = {
      id: current.id,
      schemaVersion: 1 as const,
      sessionId: SESSION,
      state: "needs_input" as const,
      version: nextTerminalAgentVersion(current),
      at: "2026-09-19T10:01:00.000Z",
      reason: "test",
    }
    const first = applyTerminalAgentUpdate(current, update)
    expect(first.applied).toBe(true)
    expect(first.session.state).toBe("needs_input")

    // 同一条再来一次（重复送达），以及一条版本更小的旧事件：都必须原样退回。
    for (const duplicate of [update, { ...update, state: "idle" as const, version: update.version - 1 }]) {
      const second = applyTerminalAgentUpdate(first.session, duplicate)
      expect(second.applied).toBe(false)
      expect(second.session).toBe(first.session)
    }
  })

  it("treats ended as terminal, except when another process takes the session over", () => {
    const ended = (() => {
      const current = walk([
        { event: "AgentProcessStart", pid: 100 },
        { event: "UserPromptSubmit" },
      ]).at(-1)!
      return applyTerminalAgentUpdate(
        current,
        terminalAgentProcessExitUpdate(current, { pid: 100, at: "2026-09-19T10:01:00.000Z" }),
      ).session
    })()
    expect(ended.state).toBe("ended")

    // 迟到的一轮旧事件不该让它复活。
    const stale = reduceTerminalAgentEvent({
      current: ended,
      sessionId: SESSION,
      event: { source: "claude", event: "Stop", at: "2026-09-19T10:02:00.000Z" },
    })!
    expect(applyTerminalAgentUpdate(ended, stale).applied).toBe(false)

    // 另一个进程接管（`--resume`）是正向证据，不是旧闻。
    const takeover = reduceTerminalAgentEvent({
      current: ended,
      sessionId: SESSION,
      event: { source: "claude", event: "AgentProcessStart", at: "2026-09-19T10:03:00.000Z", pid: 200 },
    })!
    const revived = applyTerminalAgentUpdate(ended, takeover)
    expect(revived.applied).toBe(true)
    expect(revived.session).toMatchObject({ state: "idle", pid: 200 })
  })

  it("keeps the archive free of prompt, output, and tool-argument content", () => {
    // 事件里带着工具名和通知类型——都是元数据；档案走完一整轮之后，里面不能出现任何
    // 正文类字段。schema 是 strict 的，所以「顺手加一个 content」会在落盘那一刻被拒。
    const record = walk([
      { event: "AgentProcessStart", pid: 100, agentSessionId: "agent-1", transcriptPath: "/tmp/transcript.jsonl" },
      { event: "UserPromptSubmit" },
      { event: "PreToolUse", toolName: "Bash" },
      { event: "PermissionRequest" },
      { event: "Stop" },
    ]).at(-1)!

    expect(terminalAgentSessionRecordSchema.safeParse(record).success).toBe(true)
    // 落盘形状与内存里的类型必须是一份东西：schema 漂了，这两行就编译不过。
    assertSameShape(record)
    expect(Object.keys(record).sort()).toEqual([
      "agentKind", "agentSessionId", "id", "lastActivityAt", "pid",
      "schemaVersion", "sessionId", "state", "stateChangedAt", "transcriptPath", "version",
    ])
    for (const forbidden of ["prompt", "content", "output", "answer", "toolInput", "toolInputArgs"]) {
      expect(terminalAgentSessionRecordSchema.safeParse({ ...record, [forbidden]: "secret" }).success).toBe(false)
    }
  })
})
