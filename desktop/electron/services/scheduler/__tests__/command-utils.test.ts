import { describe, expect, it } from "vitest"

import { parseScheduleArgs, parseSlashCommand } from "../command-utils"

describe("scheduler command utils", () => {
  it("parses quoted and unquoted cron expressions", () => {
    expect(parseScheduleArgs(parseSlashCommand(
      "/cron add \"*/30 * * * *\" check status",
      "cron",
    )?.slice(1) ?? [])).toEqual({
      cronExpr: "*/30 * * * *",
      body: "check status",
    })

    expect(parseScheduleArgs(parseSlashCommand(
      "/cron add */30 * * * * check status",
      "cron",
    )?.slice(1) ?? [])).toEqual({
      cronExpr: "*/30 * * * *",
      body: "check status",
    })
  })
})
