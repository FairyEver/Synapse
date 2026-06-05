import { describe, expect, it } from "vitest"
import { toCsv } from "./csv-export"

describe("toCsv", () => {
  it("prefixes formula-like fields with an apostrophe", () => {
    const csv = toCsv([
      { value: "=1+1" },
      { value: "+1" },
      { value: "-1" },
      { value: "@SUM(1,1)" },
    ], ["value"])

    expect(csv).toBe(`\uFEFF${[
      "value",
      "'=1+1",
      "'+1",
      "'-1",
      `"\'@SUM(1,1)"`,
    ].join("\n")}`)
  })

  it("prefixes formula-like fields before CSV escaping", () => {
    const csv = toCsv([
      { value: `=HYPERLINK("https://evil.com","Click")` },
    ], ["value"])

    expect(csv).toBe(`\uFEFF${[
      "value",
      `"\'=HYPERLINK(""https://evil.com"",""Click"")"`,
    ].join("\n")}`)
  })

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
