import os from "node:os"
import { describe, expect, it, vi } from "vitest"

import {
  createPermissionGuard,
  userInitiatedAllowPolicy,
  type AuditSink,
} from "../../../../electron/runtime/security"
import { createTerminalCapabilityDispatcher } from "../dispatcher"
import { createTerminalService, type PtyLike } from "../service"
import type { TerminalStore, TerminalStoreState } from "../store"

/**
 * 端到端：从 MCP 能力入口一路走到真服务与真 workspace 布局树。
 *
 * 这一组回答的是「两个使用场景在服务这一层到底成不成立」，而不是某个函数的单元行为：
 * 建会话即建标签、标签与会话两个视角互相印证、在标签内再开一格分屏、整个关掉标签。
 * 只有 PTY 是假的（测试里跑不了真 shell），其余——分组、布局树、租约、修订、幂等、
 * 权限与审计——都是生产路径上的那套。
 *
 * 它证明不了的事：真实 Claude Code 会不会按预期应答，以及终端里的 agent 拿到这些工具会不会
 * 用对。那是真机验收的事，不在这一层。
 */
const mcpContext = {
  source: "mcp-http" as const,
  actor: { kind: "user" as const, id: "mcp-client:synapse-mcp/http" },
  clientId: "mcp-install:tab-workflow",
  controllerInstanceId: "controller:tab-workflow",
}

type GroupSummary = { readonly groupId: string; readonly launchRevision: number }
type CreatedSession = { readonly sessionId: string }
type TabSummary = {
  readonly workspaceId: string
  readonly groupId: string
  readonly sessionIds: readonly string[]
  readonly layoutRevision: number
  readonly closing: boolean
}
type SessionSummary = { readonly sessionId: string; readonly workspaceId: string | null }
type Lease = { readonly leaseId: string; readonly inputRevision: number }
type InputResult = { readonly inputRevisionAfter: number }
type SplitResult = { readonly workspace: TabSummary; readonly sessionId: string }
type CloseResult = { readonly state: string; readonly remainingSessionIds: readonly string[] }
type TabPage = { readonly items: readonly TabSummary[] }
type SessionPage = { readonly items: readonly SessionSummary[] }

function memoryStore(): TerminalStore & { state: TerminalStoreState } {
  const holder = {
    persistenceProtection: "available" as const,
    state: {
      groups: [], sessions: [], output: [], terminalDomainRevision: 0, operations: [], idempotency: [], checkpoints: [],
    } as TerminalStoreState,
    async loadState() { return structuredClone(holder.state) },
    async saveState(state: TerminalStoreState) { holder.state = structuredClone(state) },
  }
  return holder
}

function fakePty() {
  let dataListener: ((data: string) => void) | undefined
  let exitListener: ((event: { exitCode: number; signal?: number }) => void) | undefined
  const instance = {
    onData: vi.fn((listener: (data: string) => void) => { dataListener = listener; return { dispose: vi.fn() } }),
    onExit: vi.fn((listener: (event: { exitCode: number; signal?: number }) => void) => {
      exitListener = listener
      return { dispose: vi.fn() }
    }),
    write: vi.fn((_data: string | Buffer) => undefined),
    resize: vi.fn(),
    kill: vi.fn((_signal?: string) => undefined),
    emitData: (data: string) => dataListener?.(data),
    emitExit: (event: { exitCode: number; signal?: number }) => exitListener?.(event),
  }
  return instance as typeof instance & PtyLike
}

async function harness() {
  const ptys: Array<ReturnType<typeof fakePty>> = []
  const service = createTerminalService({
    store: memoryStore(),
    spawnPty: () => {
      const pty = fakePty()
      ptys.push(pty)
      return pty
    },
    resolveDefaultShell: () => "/bin/zsh",
    resolveDefaultCwd: () => os.tmpdir(),
  })
  await service.start()

  const permissionGuard = createPermissionGuard()
  permissionGuard.registerPolicy(userInitiatedAllowPolicy)
  const auditSink = { record: vi.fn(), list: vi.fn(() => []), clearForTests: vi.fn() } satisfies AuditSink
  const dispatcher = createTerminalCapabilityDispatcher({ service, permissionGuard, auditSink })

  let keySeed = 0
  const nextKey = () => `019f8a39-0000-7000-8000-${String(++keySeed).padStart(12, "0")}`
  async function call<T>(action: string, params: Record<string, unknown> = {}): Promise<T> {
    const result = await dispatcher.dispatch(action, params, mcpContext)
    if (!result.ok) throw new Error(`${action} failed: ${JSON.stringify(result.error)}`)
    return result.data as T
  }
  /** 建一个带分组的两步开场：分组类返回 mutationResult 包装，真正的摘要在 value 里。 */
  async function openTabWithSession(title?: string) {
    const group = await call<{ value: GroupSummary }>("app.terminal.group.create", {
      name: "验收", idempotencyKey: nextKey(),
    })
    const session = await call<CreatedSession>("app.terminal.session.create", {
      groupId: group.value.groupId,
      expectedLaunchRevision: group.value.launchRevision,
      ...(title === undefined ? {} : { title }),
      idempotencyKey: nextKey(),
    })
    const tab = (await call<TabPage>("app.terminal.workspace.list", {})).items[0]!
    return { groupId: group.value.groupId, session, tab }
  }

  return { service, call, openTabWithSession, nextKey, ptys }
}

describe("terminal tab workflow over MCP", () => {
  it("opens a tab with a session, talks to it, splits it, and closes the whole tab", async () => {
    const { service, call, openTabWithSession, nextKey, ptys } = await harness()

    // 场景一的第一步：在指定分组下新建会话——会话自带一个标签。
    const { groupId, session: created, tab } = await openTabWithSession("一号")
    expect(tab).toMatchObject({ sessionIds: [created.sessionId], closing: false, groupId })

    // 标签视角与会话视角必须互相印证，否则「那个标签里有几个会话」就答不准。
    const sessions = await call<SessionPage>("app.terminal.session.list", {})
    expect(sessions.items).toHaveLength(1)
    expect(sessions.items[0]!.workspaceId).toBe(tab.workspaceId)

    // 场景一的后两步：在那个会话里起 agent，再跟它说话。
    const lease = await call<Lease>("app.terminal.session_control.acquire", {
      sessionId: created.sessionId, requestedLeaseMs: 30_000, idempotencyKey: nextKey(),
    })
    const started = await call<InputResult>("app.terminal.session_input.command", {
      sessionId: created.sessionId, leaseId: lease.leaseId,
      expectedInputRevision: lease.inputRevision, text: "CC", idempotencyKey: nextKey(),
    })
    await call<InputResult>("app.terminal.session_input.command", {
      sessionId: created.sessionId, leaseId: lease.leaseId,
      expectedInputRevision: started.inputRevisionAfter, text: "你好", idempotencyKey: nextKey(),
    })
    expect(ptys[0]!.write.mock.calls).toEqual([["CC"], ["\r"], ["你好"], ["\r"]])

    // 场景二的延伸：在同一个标签里再开一格分屏。
    const split = await call<SplitResult>("app.terminal.workspace_pane.create", {
      workspaceId: tab.workspaceId,
      sessionId: created.sessionId,
      direction: "right",
      expectedLayoutRevision: tab.layoutRevision,
      idempotencyKey: nextKey(),
    })
    expect(split.workspace.sessionIds).toHaveLength(2)
    expect(split.workspace.sessionIds).toContain(created.sessionId)
    expect(split.sessionId).not.toBe(created.sessionId)

    // 分屏出来的两个会话此刻报同一个标签。
    const beforeClose = await call<SessionPage>("app.terminal.session.list", {})
    expect(beforeClose.items.map((item) => item.workspaceId)).toEqual([tab.workspaceId, tab.workspaceId])

    // 延伸：整个关掉这个标签。它不是强杀——会话走正常终止，标签先进入 closing。
    const closing = await call<CloseResult>("app.terminal.workspace.delete", {
      workspaceId: tab.workspaceId,
      expectedLayoutRevision: split.workspace.layoutRevision,
      idempotencyKey: nextKey(),
    })
    expect(closing.state).toBe("closing")
    expect(closing.remainingSessionIds).toHaveLength(2)

    const stillThere = await call<TabPage>("app.terminal.workspace.list", {})
    expect(stillThere.items).toHaveLength(1)
    expect(stillThere.items[0]!.closing).toBe(true)

    // 两个 PTY 都退出后，标签连同其中的会话一起消失，不留半截记录。
    for (const pty of ptys) pty.emitExit({ exitCode: 0 })
    await service.flushPersistQueue()
    expect(service.listWorkspaces()).toEqual([])
    expect(service.listSessions()).toEqual([])
  })

  it("keeps a split pane's session addressable by the session it runs", async () => {
    const { call, openTabWithSession, nextKey } = await harness()

    const { session: first, tab } = await openTabWithSession()

    const split = await call<SplitResult>("app.terminal.workspace_pane.create", {
      workspaceId: tab.workspaceId,
      sessionId: first.sessionId,
      direction: "down",
      expectedLayoutRevision: tab.layoutRevision,
      idempotencyKey: nextKey(),
    })

    // 再加一格时，落在「刚才分屏出来的那个会话」上——说明派生的 pane 也能按会话被找到。
    const second = await call<SplitResult>("app.terminal.workspace_pane.create", {
      workspaceId: tab.workspaceId,
      sessionId: split.sessionId,
      direction: "right",
      expectedLayoutRevision: split.workspace.layoutRevision,
      idempotencyKey: nextKey(),
    })
    expect(second.workspace.sessionIds).toHaveLength(3)

    // 布局树与 pane id 是对外契约之外的东西：这两个词只出现在布局树里。
    const serialized = JSON.stringify(second)
    expect(serialized).not.toContain("paneId")
    expect(serialized).not.toContain("splitId")
  })

  it("refuses a stale layout revision instead of splitting anyway", async () => {
    const { call, openTabWithSession, nextKey } = await harness()

    const { session: first, tab } = await openTabWithSession()

    // 先做一次改动，让调用方手上的修订过期。
    await call<SplitResult>("app.terminal.workspace_pane.create", {
      workspaceId: tab.workspaceId,
      sessionId: first.sessionId,
      direction: "right",
      expectedLayoutRevision: tab.layoutRevision,
      idempotencyKey: nextKey(),
    })

    const stale = await call<SplitResult>("app.terminal.workspace_pane.create", {
      workspaceId: tab.workspaceId,
      sessionId: first.sessionId,
      direction: "right",
      expectedLayoutRevision: tab.layoutRevision,
      idempotencyKey: nextKey(),
    }).catch((error: Error) => error)
    expect(String(stale)).toContain("revision")
  })
})
