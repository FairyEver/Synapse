import { describe, expect, it, vi } from "vitest"

import { handleSchedulerCommand } from "../../data-store/cli/scheduler"

describe("handleSchedulerCommand", () => {
  it("lists scheduler tasks", async () => {
    const apiCall = vi.fn(async () => ({ data: [{ id: "task:1", name: "Daily", enabled: true }] }))
    const lines: string[] = []
    await handleSchedulerCommand(["list"], apiCall, (line) => lines.push(line))
    expect(apiCall).toHaveBeenCalledWith("schedulerTaskList", {})
    expect(lines.join("\n")).toContain("task:1")
  })

  it("gets a task by taskId", async () => {
    const apiCall = vi.fn(async () => ({ data: { id: "task:1", name: "Daily" } }))
    const lines: string[] = []
    await handleSchedulerCommand(["get", "task:1"], apiCall, (line) => lines.push(line))
    expect(apiCall).toHaveBeenCalledWith("schedulerTaskGet", { taskId: "task:1" })
    expect(lines.join("\n")).toContain("Daily")
  })

  it("creates a task from canonical JSON data", async () => {
    const apiCall = vi.fn(async () => ({ data: { id: "task:new", name: "Daily" } }))
    const lines: string[] = []
    await handleSchedulerCommand([
      "create",
      "--data",
      JSON.stringify({
        name: "Daily",
        scope: { type: "global" },
        schedule: { type: "interval", everyMinutes: 30 },
        action: { type: "builtin.command", config: { command: "date" } },
      }),
    ], apiCall, (line) => lines.push(line))
    expect(apiCall).toHaveBeenCalledWith("schedulerTaskCreate", {
      name: "Daily",
      scope: { type: "global" },
      schedule: { type: "interval", everyMinutes: 30 },
      action: { type: "builtin.command", config: { command: "date" } },
    })
    expect(lines.join("\n")).toContain("task:new")
  })

  it("enables and disables tasks", async () => {
    const apiCall = vi.fn(async () => ({ data: { id: "task:1", enabled: true } }))
    const lines: string[] = []
    await handleSchedulerCommand(["enable", "task:1"], apiCall, (line) => lines.push(line))
    await handleSchedulerCommand(["disable", "task:1"], apiCall, (line) => lines.push(line))
    expect(apiCall).toHaveBeenNthCalledWith(1, "schedulerTaskEnable", { taskId: "task:1" })
    expect(apiCall).toHaveBeenNthCalledWith(2, "schedulerTaskDisable", { taskId: "task:1" })
  })

  it("rejects unknown scheduler commands", async () => {
    await expect(handleSchedulerCommand(["delete", "task:1"], vi.fn(), () => {})).rejects.toThrow(/Unknown scheduler command/)
  })
})
