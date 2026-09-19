import { EventEmitter } from "node:events"
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { spawnSync } from "node:child_process"
import { afterEach, describe, expect, it, vi } from "vitest"

import type { DataNamespace } from "../../../../electron/runtime/data-repo"
import { createNetworkServiceRegistry } from "../../../../electron/runtime/network"
import type { AuditSink, PermissionGuard } from "../../../../electron/runtime/security"
import type { TerminalAgentAttentionUpdate } from "../../shared/contract-schema"
import type { TerminalAgentNotificationSettings } from "../../shared/schema"
import type { TerminalAgentSession } from "../agent-session"
import {
  TerminalAgentNotificationService,
  type TerminalAgentNotificationHandle,
} from "../agent-notification-service"

const temporaryDirectories: string[] = []

// wrapper 拿这两个变量当递归护栏：环境里只要有它们，wrapper 就认定自己已经在包装层内，
// 于是原样透传、不注入钩子。开发机在 Synapse 自己的终端里跑测试时，环境里正带着它们，
// 一旦漏进子进程，下面两条就会假红。起子进程前必须剔除。
function childEnvironment(extra: Record<string, string>): NodeJS.ProcessEnv {
  const environment = { ...process.env, ...extra }
  delete environment.SYNAPSE_TERMINAL_AGENT_WRAPPER_ACTIVE
  delete environment.SYNAPSE_AGENT_NOTIFICATIONS_DISABLED
  return environment
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true })))
})

describe("TerminalAgentNotificationService", () => {
  it("authenticates a hook event, notifies only when another pane is active, and opens the exact session", async () => {
    const fixture = await createFixture()
    await fixture.service.start()
    await fixture.service.updateSettings({ enabled: true, expectedRevision: 1 })
    const launch = fixture.service.prepareSession({
      sessionId: "7a5f83f3-9782-4cb0-a268-1ee7ad0b740f",
      title: "brick-lab",
      shell: "/bin/zsh",
      env: { PATH: "/usr/bin" },
      defaultShellArgs: ["-l"],
    })
    expect(launch?.env.PATH.split(":")[0]).toBe(launch?.env.SYNAPSE_TERMINAL_AGENT_SHIM_DIR)

    fixture.focusedWebContentsId.mockReturnValue(42)
    fixture.service.reportActiveSession(42, "7a5f83f3-9782-4cb0-a268-1ee7ad0b740f")
    await postEvent(launch!.env, { source: "codex", event: "PermissionRequest" })
    expect(fixture.notifications).toHaveLength(0)

    fixture.service.reportActiveSession(42, "92654f7a-2e77-4cb4-96cb-fb82583f167a")
    await postEvent(launch!.env, { source: "codex", event: "PermissionRequest" })
    expect(fixture.notifications).toHaveLength(1)
    expect(fixture.notifications[0]?.input).toEqual({
      title: "Codex",
      body: "“brick-lab”需要你的操作",
    })

    fixture.notifications[0]?.emit("click")
    expect(fixture.focusApp).toHaveBeenCalledOnce()
    expect(fixture.openTerminalSession).toHaveBeenCalledWith("7a5f83f3-9782-4cb0-a268-1ee7ad0b740f")
    await fixture.service.stop()
  })

  it("maps Claude questions and top-level completion but ignores subagent completion", async () => {
    const fixture = await createFixture()
    await fixture.service.start()
    await fixture.service.updateSettings({ enabled: true, expectedRevision: 1 })
    const launch = fixture.service.prepareSession({
      sessionId: "7a5f83f3-9782-4cb0-a268-1ee7ad0b740f",
      title: "会话\n名称",
      shell: "/bin/bash",
      env: { PATH: "/usr/bin" },
      defaultShellArgs: [],
    })!

    await postEvent(launch.env, { source: "claude", event: "PreToolUse", toolName: "AskUserQuestion" })
    await postEvent(launch.env, { source: "claude", event: "SubagentStop", agentId: "child" })
    await postEvent(launch.env, { source: "claude", event: "Stop" })
    await postEvent(launch.env, { source: "claude", event: "UserPromptSubmit" })
    await postEvent(launch.env, { source: "claude", event: "Stop" })

    expect(fixture.notifications.map((notification) => notification.input)).toEqual([
      { title: "Claude Code", body: "“会话 名称”需要你的操作" },
      { title: "Claude Code", body: "“会话 名称”任务已完成" },
    ])
    await fixture.service.stop()
  })

  it("records hook-driven waiting attention and clears it when the agent resumes or the user types", async () => {
    const fixture = await createFixture()
    await fixture.service.start()
    await fixture.service.updateSettings({ enabled: true, expectedRevision: 1 })
    const sessionId = "7a5f83f3-9782-4cb0-a268-1ee7ad0b740f"
    const launch = fixture.service.prepareSession({
      sessionId,
      title: "brick-lab",
      shell: "/bin/zsh",
      env: { PATH: "/usr/bin" },
      defaultShellArgs: ["-l"],
    })!

    await postEvent(launch.env, { source: "claude", event: "PreToolUse", toolName: "AskUserQuestion" })
    await postEvent(launch.env, { source: "codex", event: "PermissionRequest" })
    await postEvent(launch.env, { source: "claude", event: "Notification", notificationType: "permission_prompt" })
    await postEvent(launch.env, { source: "codex", event: "Interrupt" })

    expect(fixture.attention).toEqual([
      { sessionId, state: "waiting", kind: "agent_question", reason: "agent_question_tool" },
      { sessionId, state: "waiting", kind: "approval", reason: "agent_permission_request" },
      { sessionId, state: "waiting", kind: "approval", reason: "agent_notification_permission_prompt" },
      { sessionId, state: "not_waiting", kind: "unknown", reason: "agent_interrupted" },
    ])

    fixture.service.handleUserInput(sessionId)
    expect(fixture.attention.at(-1)).toEqual({
      sessionId,
      state: "not_waiting",
      kind: "unknown",
      reason: "user_input",
    })
    await fixture.service.stop()
  })

  it.runIf(process.platform !== "win32")("keeps shims first after zsh profiles so aliases resolve through them", async () => {
    const fixture = await createFixture()
    await fixture.service.start()
    await fixture.service.updateSettings({ enabled: true, expectedRevision: 1 })
    const home = await mkdtemp(path.join(os.tmpdir(), "synapse-agent-home-"))
    const realBin = path.join(home, "real-bin")
    temporaryDirectories.push(home)
    await mkdir(realBin)
    await writeFile(
      path.join(home, ".zshrc"),
      `export PATH=${JSON.stringify(realBin)}\nalias CX=codex\nalias CC=claude\n`,
      "utf8",
    )
    await writeFile(
      path.join(realBin, "codex"),
      '#!/bin/sh\ncase " $* " in *" --enable hooks "*) printf real-codex-hooked;; *) printf real-codex;; esac',
      { encoding: "utf8", mode: 0o700 },
    )
    await writeFile(
      path.join(realBin, "claude"),
      '#!/bin/sh\nif [ "$1" = "--settings" ]; then printf real-claude-hooked; else printf real-claude; fi',
      { encoding: "utf8", mode: 0o700 },
    )
    const launch = fixture.service.prepareSession({
      sessionId: "7a5f83f3-9782-4cb0-a268-1ee7ad0b740f",
      title: "alias-test",
      shell: "/bin/zsh",
      env: { PATH: realBin, HOME: home },
      defaultShellArgs: ["-l"],
    })!

    const result = spawnSync("/bin/zsh", ["-i", "-c", "CX; printf :; CC"], {
      env: childEnvironment({ ...launch.env, HOME: home }),
      encoding: "utf8",
    })
    expect(result.status).toBe(0)
    expect(result.stdout).toBe("real-codex-hooked:real-claude-hooked")
    await fixture.service.stop()
  })

  it.runIf(process.platform !== "win32")("preserves Claude settings while appending managed hooks", async () => {
    const fixture = await createFixture()
    await fixture.service.start()
    await fixture.service.updateSettings({ enabled: true, expectedRevision: 1 })
    const home = await mkdtemp(path.join(os.tmpdir(), "synapse-agent-settings-"))
    const realBin = path.join(home, "real-bin")
    const userSettingsPath = path.join(home, "settings.json")
    temporaryDirectories.push(home)
    await mkdir(realBin)
    await writeFile(userSettingsPath, JSON.stringify({
      permissions: { allow: ["Bash(*)"] },
      hooks: { Stop: [{ hooks: [{ type: "command", command: "user-hook" }] }] },
    }), "utf8")
    await writeFile(
      path.join(realBin, "claude"),
      '#!/bin/sh\nif [ "$1" = "--settings" ]; then /bin/cat "$2"; fi',
      { encoding: "utf8", mode: 0o700 },
    )
    const launch = fixture.service.prepareSession({
      sessionId: "7a5f83f3-9782-4cb0-a268-1ee7ad0b740f",
      title: "settings-test",
      shell: "/bin/sh",
      env: { PATH: realBin, HOME: home },
      defaultShellArgs: [],
    })!

    const result = spawnSync(path.join(launch.env.SYNAPSE_TERMINAL_AGENT_SHIM_DIR, "claude"), [
      "--settings",
      userSettingsPath,
    ], {
      env: childEnvironment({ ...launch.env, HOME: home }),
      encoding: "utf8",
    })
    expect(result.status).toBe(0)
    const merged = JSON.parse(result.stdout) as {
      permissions: { allow: string[] }
      hooks: { Stop: unknown[]; PermissionRequest: unknown[] }
    }
    expect(merged.permissions.allow).toEqual(["Bash(*)"])
    expect(merged.hooks.Stop).toHaveLength(2)
    expect(merged.hooks.PermissionRequest).toHaveLength(1)
    await fixture.service.stop()
  })

  it("keeps an authoritative agent archive in step with the hook events", async () => {
    const fixture = await createFixture()
    await fixture.service.start()
    await fixture.service.updateSettings({ enabled: true, expectedRevision: 1 })
    const sessionId = "7a5f83f3-9782-4cb0-a268-1ee7ad0b740f"
    const launch = fixture.service.prepareSession({
      sessionId,
      title: "brick-lab",
      shell: "/bin/zsh",
      env: { PATH: "/usr/bin" },
      defaultShellArgs: ["-l"],
    })!
    // 终端刚开出来、还没有 agent 进来时，档案存在但还停在 launching。
    expect(fixture.service.getAgentSession(sessionId)?.state).toBe("launching")
    expect(fixture.service.listAgentSessions()).toEqual([])

    const observed: string[] = []
    for (const event of [
      { event: "AgentProcessStart", agentPid: 4242, agentSessionId: "agent-1" },
      { event: "UserPromptSubmit" },
      { event: "PermissionRequest" },
      { event: "PostToolUse", toolName: "Edit" },
      { event: "Stop" },
      { event: "SessionEnd" },
    ] as const) {
      await postEvent(launch.env, { source: "claude", ...event })
      observed.push(fixture.service.getAgentSession(sessionId)!.state)
    }

    expect(observed).toEqual(["idle", "working", "needs_input", "working", "idle", "ended"])
    expect(fixture.service.getAgentSession(sessionId)).toMatchObject({
      agentKind: "claude",
      agentSessionId: "agent-1",
      pid: 4242,
    })
    expect(fixture.service.listAgentSessions()).toHaveLength(1)
    await fixture.service.stop()
  })

  it("ends the archive on process death even when no hook event ever arrives", async () => {
    // 集成故障的样子：wrapper 报过一声「进程起来了」，之后 hook 通道整条哑掉。
    // 状态仍然要能收尾，否则侧栏会永远显示一个早就不在的 agent 在干活。
    const fixture = await createFixture()
    await fixture.service.start()
    await fixture.service.updateSettings({ enabled: true, expectedRevision: 1 })
    const sessionId = "7a5f83f3-9782-4cb0-a268-1ee7ad0b740f"
    const launch = fixture.service.prepareSession({
      sessionId,
      title: "brick-lab",
      shell: "/bin/zsh",
      env: { PATH: "/usr/bin" },
      defaultShellArgs: ["-l"],
    })!

    await postEvent(launch.env, { source: "claude", event: "AgentProcessStart", agentPid: 4242 })
    expect(fixture.service.getAgentSession(sessionId)?.state).toBe("idle")

    fixture.isProcessAlive.mockReturnValue(false)
    await fixture.service.sweepAgentSessions()
    expect(fixture.service.getAgentSession(sessionId)).toMatchObject({ state: "ended", pid: 4242 })
    await fixture.service.stop()
  })

  /*
   * `claude --resume` 在同一颗终端里换了一任进程：agent 自己的会话 id 没变，变的是 pid。
   * 档案要跟着换到新的一任，而不是被前任的结局带走。
   *
   * 「前任迟到的死讯不算数」这条规则本身由 agent-session.ts 的 pid 校验执行，专门用例在
   * agent-session.test.ts；这里钉的是接上之后从头到尾能观察到的东西。
   */
  it("follows a resumed agent onto its new process instead of ending it", async () => {
    const fixture = await createFixture()
    await fixture.service.start()
    await fixture.service.updateSettings({ enabled: true, expectedRevision: 1 })
    const sessionId = "7a5f83f3-9782-4cb0-a268-1ee7ad0b740f"
    const launch = fixture.service.prepareSession({
      sessionId,
      title: "brick-lab",
      shell: "/bin/zsh",
      env: { PATH: "/usr/bin" },
      defaultShellArgs: ["-l"],
    })!

    await postEvent(launch.env, { source: "claude", event: "AgentProcessStart", agentPid: 100, agentSessionId: "agent-1" })
    await postEvent(launch.env, { source: "claude", event: "UserPromptSubmit" })
    expect(fixture.service.getAgentSession(sessionId)).toMatchObject({ state: "working", pid: 100 })

    await postEvent(launch.env, { source: "claude", event: "AgentProcessStart", agentPid: 200, agentSessionId: "agent-1" })
    await postEvent(launch.env, { source: "claude", event: "UserPromptSubmit" })

    // 前任这时才被探测到不在了——它说的是 100，而当前这一任是 200。
    fixture.isProcessAlive.mockImplementation((pid) => pid !== 100)
    await fixture.service.sweepAgentSessions()
    expect(fixture.service.getAgentSession(sessionId)).toMatchObject({
      state: "working",
      pid: 200,
      agentSessionId: "agent-1",
    })

    // 当前这一任真的没了的时候，照样要收尾——迁移到新进程不等于免死。
    fixture.isProcessAlive.mockReturnValue(false)
    await fixture.service.sweepAgentSessions()
    expect(fixture.service.getAgentSession(sessionId)).toMatchObject({ state: "ended", pid: 200 })
    await fixture.service.stop()
  })

  it("drops a stalled correction that a later process takeover has already outdated", async () => {
    let clock = Date.parse("2026-09-19T10:00:00.000Z")
    const fixture = await createFixture({ now: () => clock })
    await fixture.service.start()
    await fixture.service.updateSettings({ enabled: true, expectedRevision: 1 })
    const sessionId = "7a5f83f3-9782-4cb0-a268-1ee7ad0b740f"
    const launch = fixture.service.prepareSession({
      sessionId,
      title: "brick-lab",
      shell: "/bin/zsh",
      env: { PATH: "/usr/bin" },
      defaultShellArgs: ["-l"],
    })!

    await postEvent(launch.env, { source: "claude", event: "AgentProcessStart", agentPid: 100 })
    await postEvent(launch.env, { source: "claude", event: "UserPromptSubmit" })
    await postEvent(launch.env, {
      source: "claude",
      event: "PreToolUse",
      toolName: "Bash",
      transcriptPath: "/tmp/agent-1.jsonl",
    })

    // transcript 停在很久以前。就在这一轮扫描读到它的同时，`--resume` 换了进程。
    clock += 20 * 60_000
    fixture.readTranscriptMtimeMs.mockImplementation(async () => {
      await postEvent(launch.env, { source: "claude", event: "AgentProcessStart", agentPid: 200 })
      return Date.parse("2026-09-19T09:00:00.000Z")
    })
    await fixture.service.sweepAgentSessions()

    // 迟到的「它没在写了」不该盖掉刚刚接管的那一任。
    expect(fixture.service.getAgentSession(sessionId)).toMatchObject({ state: "idle", pid: 200 })
    await fixture.service.stop()
  })

  it("corrects a stuck working when the transcript has stopped growing", async () => {
    let clock = Date.parse("2026-09-19T10:00:00.000Z")
    const fixture = await createFixture({ now: () => clock })
    await fixture.service.start()
    await fixture.service.updateSettings({ enabled: true, expectedRevision: 1 })
    const sessionId = "7a5f83f3-9782-4cb0-a268-1ee7ad0b740f"
    const launch = fixture.service.prepareSession({
      sessionId,
      title: "brick-lab",
      shell: "/bin/zsh",
      env: { PATH: "/usr/bin" },
      defaultShellArgs: ["-l"],
    })!

    await postEvent(launch.env, { source: "claude", event: "AgentProcessStart", agentPid: 100 })
    await postEvent(launch.env, {
      source: "claude",
      event: "PreToolUse",
      toolName: "Bash",
      transcriptPath: "/tmp/agent-1.jsonl",
    })
    expect(fixture.service.getAgentSession(sessionId)?.state).toBe("working")

    // 刚变成 working 时不动它。
    await fixture.service.sweepAgentSessions()
    expect(fixture.service.getAgentSession(sessionId)?.state).toBe("working")

    // 过了阈值、transcript 也没有新内容：降回 idle，而不是推断它结束了。
    clock += 20 * 60_000
    fixture.readTranscriptMtimeMs.mockResolvedValue(Date.parse("2026-09-19T09:30:00.000Z"))
    await fixture.service.sweepAgentSessions()
    expect(fixture.service.getAgentSession(sessionId)?.state).toBe("idle")

    // 读不到 transcript 就什么都不做——这条纠正宁可不动，也不能靠猜。
    clock += 20 * 60_000
    fixture.readTranscriptMtimeMs.mockResolvedValue(null)
    await fixture.service.sweepAgentSessions()
    expect(fixture.service.getAgentSession(sessionId)?.state).toBe("idle")
    await fixture.service.stop()
  })

  it("prepares Windows PATH and PowerShell startup arguments", async () => {
    const fixture = await createFixture({ platform: "win32" })
    await fixture.service.start()
    await fixture.service.updateSettings({ enabled: true, expectedRevision: 1 })
    const launch = fixture.service.prepareSession({
      sessionId: "7a5f83f3-9782-4cb0-a268-1ee7ad0b740f",
      title: "windows-test",
      shell: "C:\\Program Files\\PowerShell\\7\\pwsh.exe",
      env: { PATH: "C:\\Tools;C:\\Windows" },
      defaultShellArgs: [],
    })!

    const [shimPath, ...originalPath] = launch.env.PATH.split(";")
    expect(path.basename(shimPath!)).toBe("bin")
    expect(originalPath.join(";")).toBe("C:\\Tools;C:\\Windows")
    expect(launch.shellArgs).toEqual([
      "-NoExit",
      "-Command",
      "$env:Path = $env:SYNAPSE_TERMINAL_AGENT_SHIM_DIR + ';' + $env:Path",
    ])
    await fixture.service.stop()
  })
})

async function createFixture(options: { platform?: NodeJS.Platform; now?: () => number } = {}) {
  const runtimeDir = await mkdtemp(path.join(os.tmpdir(), "synapse-agent-runtime-"))
  temporaryDirectories.push(runtimeDir)
  const notifications: TestNotification[] = []
  const focusedWebContentsId = vi.fn<() => number | null>(() => null)
  const focusApp = vi.fn()
  const openTerminalSession = vi.fn(async () => undefined)
  const attention: TerminalAgentAttentionUpdate[] = []
  const isProcessAlive = vi.fn<(pid: number) => boolean>(() => true)
  const readTranscriptMtimeMs = vi.fn<(path: string) => Promise<number | null>>(async () => null)
  const service = new TerminalAgentNotificationService({
    settings: memorySettingsNamespace(),
    agentSessions: memoryAgentSessionsNamespace(),
    networkRegistry: createNetworkServiceRegistry(),
    permissionGuard: { check: vi.fn(async () => ({ allowed: true })), registerPolicy: vi.fn(() => () => {}) } as unknown as PermissionGuard,
    auditSink: { record: vi.fn() } as unknown as AuditSink,
    logger: { info: vi.fn(), warn: vi.fn() },
    runtimeDir,
    nodePath: process.execPath,
    ...(options.platform ? { platform: options.platform } : {}),
    focusedWebContentsId,
    focusApp,
    openTerminalSession,
    isProcessAlive,
    readTranscriptMtimeMs,
    ...(options.now ? { now: options.now } : {}),
    setSessionAttention: (update) => { attention.push(update) },
    createNotification: (input) => {
      const notification = new TestNotification(input)
      notifications.push(notification)
      return notification
    },
  })
  return {
    service,
    notifications,
    attention,
    focusedWebContentsId,
    focusApp,
    openTerminalSession,
    isProcessAlive,
    readTranscriptMtimeMs,
  }
}

function memoryAgentSessionsNamespace(): DataNamespace<TerminalAgentSession> {
  const values = new Map<string, TerminalAgentSession>()
  return {
    name: "app.terminal.agent-sessions",
    schemaVersion: 1,
    backend: "sqlite",
    getSingleton: async () => null,
    setSingleton: async () => undefined,
    list: async () => [...values.values()],
    get: async (id) => values.get(id) ?? null,
    upsert: async (item) => { values.set(item.id, item) },
    remove: async (id) => { values.delete(id) },
    onChange: () => () => {},
  }
}

async function postEvent(env: Record<string, string>, event: Record<string, unknown>): Promise<void> {
  const response = await fetch(env.SYNAPSE_TERMINAL_AGENT_EVENT_URL!, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.SYNAPSE_TERMINAL_AGENT_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ ...event, sessionId: env.SYNAPSE_TERMINAL_SESSION_ID }),
  })
  expect(response.status).toBe(204)
}

function memorySettingsNamespace(): DataNamespace<TerminalAgentNotificationSettings> {
  let value: TerminalAgentNotificationSettings | null = null
  return {
    name: "app.terminal.agent-notification-settings",
    schemaVersion: 1,
    backend: "json",
    getSingleton: async () => value,
    setSingleton: async (next) => { value = next },
    list: async () => value ? [value] : [],
    get: async () => value,
    upsert: async (next) => { value = next },
    remove: async () => { value = null },
    onChange: () => () => {},
  }
}

class TestNotification extends EventEmitter implements TerminalAgentNotificationHandle {
  readonly show = vi.fn()

  constructor(readonly input: { readonly title: string; readonly body: string }) {
    super()
  }

  override on(event: "click" | "close", listener: () => void): this {
    return super.on(event, listener)
  }
}
