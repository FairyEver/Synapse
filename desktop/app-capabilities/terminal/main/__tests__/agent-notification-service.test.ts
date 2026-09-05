import { EventEmitter } from "node:events"
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { spawnSync } from "node:child_process"
import { afterEach, describe, expect, it, vi } from "vitest"

import type { DataNamespace } from "../../../../electron/runtime/data-repo"
import { createNetworkServiceRegistry } from "../../../../electron/runtime/network"
import type { AuditSink, PermissionGuard } from "../../../../electron/runtime/security"
import type { TerminalAgentNotificationSettings } from "../../shared/schema"
import {
  TerminalAgentNotificationService,
  type TerminalAgentNotificationHandle,
} from "../agent-notification-service"

const temporaryDirectories: string[] = []

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
      env: { ...process.env, ...launch.env, HOME: home },
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
      env: { ...process.env, ...launch.env, HOME: home },
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

async function createFixture(options: { platform?: NodeJS.Platform } = {}) {
  const runtimeDir = await mkdtemp(path.join(os.tmpdir(), "synapse-agent-runtime-"))
  temporaryDirectories.push(runtimeDir)
  const notifications: TestNotification[] = []
  const focusedWebContentsId = vi.fn<() => number | null>(() => null)
  const focusApp = vi.fn()
  const openTerminalSession = vi.fn(async () => undefined)
  const service = new TerminalAgentNotificationService({
    settings: memorySettingsNamespace(),
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
    createNotification: (input) => {
      const notification = new TestNotification(input)
      notifications.push(notification)
      return notification
    },
  })
  return { service, notifications, focusedWebContentsId, focusApp, openTerminalSession }
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
