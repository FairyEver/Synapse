import { describe, expect, it } from "vitest"

import { allSchemas } from "../schemas"
import { sqliteIndexesFor } from "../factory"

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
