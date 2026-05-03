import { describe, expect, it, vi } from "vitest"

import { handleSchedulerCommand } from "../../data-store/cli/scheduler"

describe("handleSchedulerCommand", () => {
  it("lists scheduler tasks", async () => {
    const apiCall = vi.fn(async () => ({ data: [{ id: "task:1", name: "Daily", enabled: true }] }))
    const lines: string[] = []
    await handleSchedulerCommand(["list"], apiCall, (line) => lines.push(line))
    expect(apiCall).toHaveBeenCalledWith("scheduler.task.list", {})
    expect(lines.join("\n")).toContain("task:1")
  })

  it("gets a task by taskId", async () => {
    const apiCall = vi.fn(async () => ({ data: { id: "task:1", name: "Daily" } }))
    const lines: string[] = []
    await handleSchedulerCommand(["get", "task:1"], apiCall, (line) => lines.push(line))
    expect(apiCall).toHaveBeenCalledWith("scheduler.task.get", { taskId: "task:1" })
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
    expect(apiCall).toHaveBeenCalledWith("scheduler.task.create", {
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
    expect(apiCall).toHaveBeenNthCalledWith(1, "scheduler.task.enable", { taskId: "task:1" })
    expect(apiCall).toHaveBeenNthCalledWith(2, "scheduler.task.disable", { taskId: "task:1" })
  })

  it("lists task runs", async () => {
    const apiCall = vi.fn(async () => ({ data: [{ id: "run:1", status: "success" }] }))
    const lines: string[] = []
    await handleSchedulerCommand(["runs", "task:1", "--limit", "5"], apiCall, (line) => lines.push(line))
    expect(apiCall).toHaveBeenCalledWith("scheduler.run.list", { taskId: "task:1", limit: 5 })
    expect(lines.join("\n")).toContain("run:1")
  })

  it("gets runtime status", async () => {
    const apiCall = vi.fn(async () => ({ data: { runningTaskIds: [], scheduledTaskIds: ["task:1"], tasks: [] } }))
    const lines: string[] = []
    await handleSchedulerCommand(["status", "task:1"], apiCall, (line) => lines.push(line))
    expect(apiCall).toHaveBeenCalledWith("scheduler.runtime.inspect", { taskId: "task:1" })
    expect(lines.join("\n")).toContain("scheduledTaskIds")
  })

  it("lists action types", async () => {
    const apiCall = vi.fn(async () => ({ data: [{ type: "builtin.command" }] }))
    const lines: string[] = []
    await handleSchedulerCommand(["actions"], apiCall, (line) => lines.push(line))
    expect(apiCall).toHaveBeenCalledWith("scheduler.action_type.list", {})
    expect(lines.join("\n")).toContain("builtin.command")
  })

  it("updates a task from canonical JSON data", async () => {
    const apiCall = vi.fn(async () => ({ data: { id: "task:1", name: "Updated" } }))
    const lines: string[] = []
    await handleSchedulerCommand([
      "update",
      "task:1",
      "--data",
      JSON.stringify({ name: "Updated", missedRunPolicy: "run_once" }),
    ], apiCall, (line) => lines.push(line))
    expect(apiCall).toHaveBeenCalledWith("scheduler.task.update", {
      taskId: "task:1",
      name: "Updated",
      missedRunPolicy: "run_once",
    })
    expect(lines.join("\n")).toContain("Task updated: task:1")
  })

  it("rejects hidden scheduler commands", async () => {
    await expect(handleSchedulerCommand(["delete", "task:1"], vi.fn(), () => {})).rejects.toThrow(/Unknown scheduler command/)
    await expect(handleSchedulerCommand(["run", "task:1"], vi.fn(), () => {})).rejects.toThrow(/Unknown scheduler command/)
    await expect(handleSchedulerCommand(["stop", "run:1"], vi.fn(), () => {})).rejects.toThrow(/Unknown scheduler command/)
  })
})
