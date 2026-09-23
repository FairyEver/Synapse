import { describe, expect, it } from "vitest"

import { allSchemas, reviveTerminalAgentNotificationSettingsEnvelope } from "../schemas"
import { jsonReviveEnvelopeFor, sqliteIndexesFor } from "../factory"

describe("Terminal DataRepository schemas", () => {
  it("registers the approved metadata, sensitive body, and manifest namespaces", () => {
    const byName = new Map(allSchemas.map((schema) => [schema.name, schema]))
    expect(byName.get("app.terminal.global-launch")?.backend).toBe("sqlite")
    expect(byName.get("app.terminal.global-launch-bodies")?.backend).toBe("encrypted-json")
    expect(byName.get("app.terminal.global-launch-bodies")?.encrypted).toBe(true)
    expect(byName.get("app.terminal.toolbar-actions")?.backend).toBe("encrypted-json")
    expect(byName.get("app.terminal.toolbar-actions")?.encrypted).toBe(true)
    expect(byName.get("app.terminal.groups")?.backend).toBe("sqlite")
    expect(byName.get("app.terminal.commands")?.backend).toBe("sqlite")
    expect(byName.get("app.terminal.command-bodies")?.backend).toBe("encrypted-json")
    expect(byName.get("app.terminal.command-bodies")?.encrypted).toBe(true)
    expect(byName.get("app.terminal.sessions")?.backend).toBe("sqlite")
    expect(byName.get("app.terminal.workspaces")?.backend).toBe("sqlite")
    expect(byName.get("app.terminal.operations")?.backend).toBe("sqlite")
    expect(byName.get("app.terminal.idempotency")?.backend).toBe("sqlite")
    expect(byName.get("app.terminal.blocks")?.backend).toBe("sqlite")
    expect(byName.get("app.terminal.delete-intents")?.backend).toBe("sqlite")
    expect(byName.get("app.terminal.domain-state")?.backend).toBe("json")
    // Agent 会话档案是元数据：会话 id、状态、版本、时间戳，加一条 transcript 的路径。
    // 终端输出的正文与检查点从来不走这里，只进有界加密块存储。
    expect(byName.get("app.terminal.agent-sessions")?.backend).toBe("sqlite")
    expect(byName.get("app.terminal.agent-sessions")?.encrypted).toBe(false)
  })

  it("upgrades a stored v1 agent-notification setting instead of failing to load it", () => {
    const definition = new Map(allSchemas.map((schema) => [schema.name, schema]))
      .get("app.terminal.agent-notification-settings")!
    expect(definition.currentVersion).toBe(2)
    const storedV1 = {
      schemaVersion: 1,
      id: "default",
      enabled: true,
      revision: 7,
      updatedAt: "2026-01-02T03:04:05.000Z",
    }
    // 负控：没有这层升级，落盘的 v1 会直接进 validate（`literal(2)` + `.strict()`）被拒。
    // 服务读设置没有兜底，那等于把服务启动打挂，所以 revive 是必需的而不是锦上添花。
    expect(definition.validate(storedV1)).toBe(false)

    const revived = reviveTerminalAgentNotificationSettingsEnvelope({
      schemaVersion: 1,
      singleton: storedV1,
      items: {},
    })
    expect(revived?.schemaVersion).toBe(2)
    // `notify: true` 是升级时必须补的：老记录里「打开开关就会弹通知」就是它的既有行为。
    expect(revived?.singleton).toEqual({ ...storedV1, schemaVersion: 2, notify: true })
    expect(definition.validate(revived!.singleton)).toBe(true)

    // 升级函数存在还不够：它得挂在这个命名空间的名字上，否则老文件在真正读取时照样炸。
    expect(jsonReviveEnvelopeFor("app.terminal.agent-notification-settings"))
      .toBe(reviveTerminalAgentNotificationSettingsEnvelope)
  })

  it("indexes stable Terminal list and resource lookups", () => {
    expect(sqliteIndexesFor("app.terminal.sessions")).toContain(
      "json_extract(value, '$.createdAt'), id",
    )
    expect(sqliteIndexesFor("app.terminal.workspaces")).toContain(
      "json_extract(value, '$.groupId'), json_extract(value, '$.createdAt'), id",
    )
    expect(sqliteIndexesFor("app.terminal.blocks")).toContain(
      "json_extract(value, '$.sessionId'), json_extract(value, '$.firstOutputSeq'), id",
    )
  })
})
