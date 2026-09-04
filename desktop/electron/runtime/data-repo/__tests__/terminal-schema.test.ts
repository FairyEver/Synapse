import { describe, expect, it } from "vitest"

import { allSchemas } from "../schemas"
import { sqliteIndexesFor } from "../factory"

describe("Terminal DataRepository schemas", () => {
  it("registers the approved metadata, sensitive body, and manifest namespaces", () => {
    const byName = new Map(allSchemas.map((schema) => [schema.name, schema]))
    expect(byName.get("app.terminal.global-launch")?.backend).toBe("sqlite")
    expect(byName.get("app.terminal.global-launch-bodies")?.backend).toBe("encrypted-json")
    expect(byName.get("app.terminal.global-launch-bodies")?.encrypted).toBe(true)
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
