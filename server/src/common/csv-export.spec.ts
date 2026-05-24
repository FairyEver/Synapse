import { describe, expect, it } from "vitest"
import { toCsv } from "./csv-export"

describe("toCsv", () => {
  it("serializes object fields as JSON", () => {
    const csv = toCsv([
      {
        id: "audit-1",
        detail: { filters: { action: "admin.audit_logs.export" }, count: 1 },
      },
    ], ["id", "detail"])

    expect(csv).toBe(`\uFEFF${[
      "id,detail",
      `audit-1,"{""filters"":{""action"":""admin.audit_logs.export""},""count"":1}"`,
    ].join("\n")}`)
  })
})
