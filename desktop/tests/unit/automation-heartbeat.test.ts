import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import {
  AutomationHeartbeatService,
  DEFAULT_HEARTBEAT_PROMPT,
  readHeartbeatPrompt,
} from "../../electron/services/automation-heartbeat-service"

const tempRoots: string[] = []

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "synapse-heartbeat-"))
  tempRoots.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of tempRoots.splice(0)) {
    fs.rmSync(dir, { force: true, recursive: true })
  }
})

describe("automation heartbeat service", () => {
  it("reads HEARTBEAT.md and lowercase heartbeat.md like CC Connect", () => {
    const empty = tempDir()
    expect(readHeartbeatPrompt(empty)).toBe("")

    const upper = tempDir()
    fs.writeFileSync(path.join(upper, "HEARTBEAT.md"), "- check inbox\n- check tasks")
    expect(readHeartbeatPrompt(upper)).toBe("- check inbox\n- check tasks")

    const lower = tempDir()
    fs.writeFileSync(path.join(lower, "heartbeat.md"), "- check status")
    expect(readHeartbeatPrompt(lower)).toBe("- check status")
  })

  it("skips disabled and missing target, then applies defaults", () => {
    const service = new AutomationHeartbeatService()

    expect(service.register("disabled", { enabled: false, sessionKey: "tg:1:1" })).toBe(false)
    expect(service.register("missing", { enabled: true, sessionKey: "" })).toBe(false)
    expect(service.register("proj", { enabled: true, sessionKey: "tg:1:1" })).toBe(true)

    expect(service.status("proj")).toMatchObject({
      enabled: true,
      paused: false,
      intervalMins: 30,
      onlyWhenIdle: true,
      sessionKey: "tg:1:1",
      silent: true,
      runCount: 0,
    })
    expect(service.status("missing")).toBeNull()
  })

  it("pauses, resumes, and changes interval", () => {
    const service = new AutomationHeartbeatService()
    service.register("proj", { enabled: true, sessionKey: "tg:1:1", intervalMins: 15 })

    expect(service.pause("proj")).toBe(true)
    expect(service.status("proj")?.paused).toBe(true)
    expect(service.resume("proj")).toBe(true)
    expect(service.status("proj")?.paused).toBe(false)
    expect(service.setInterval("proj", 10)).toBe(true)
    expect(service.status("proj")?.intervalMins).toBe(10)
    expect(service.setInterval("proj", 0)).toBe(false)
    expect(service.pause("missing")).toBe(false)
  })

  it("skips busy sessions before executing", async () => {
    let calls = 0
    const service = new AutomationHeartbeatService({
      sessionBusy: () => true,
      executor: async () => {
        calls += 1
      },
    })
    service.register("proj", { enabled: true, sessionKey: "tg:busy" })

    await expect(service.triggerNow("proj")).resolves.toEqual({
      status: "skipped_busy",
      sessionKey: "tg:busy",
    })
    expect(calls).toBe(0)
    expect(service.status("proj")).toMatchObject({ skippedBusy: 1, runCount: 0 })
  })

  it("uses explicit, file, then default prompt and records run state", async () => {
    const dir = tempDir()
    fs.writeFileSync(path.join(dir, "HEARTBEAT.md"), "from file")
    const prompts: string[] = []
    const service = new AutomationHeartbeatService({
      now: () => new Date("2026-04-26T00:00:00.000Z"),
      executor: async ({ prompt }) => {
        prompts.push(prompt)
      },
    })

    service.register("explicit", { enabled: true, sessionKey: "tg:1", prompt: "explicit", silent: false }, dir)
    service.register("file", { enabled: true, sessionKey: "tg:2" }, dir)
    service.register("fallback", { enabled: true, sessionKey: "tg:3" })

    await expect(service.triggerNow("explicit")).resolves.toMatchObject({ status: "completed", prompt: "explicit", silent: false })
    await expect(service.triggerNow("file")).resolves.toMatchObject({ status: "completed", prompt: "from file" })
    await expect(service.triggerNow("fallback")).resolves.toMatchObject({ status: "completed", prompt: DEFAULT_HEARTBEAT_PROMPT })
    expect(prompts).toEqual(["explicit", "from file", DEFAULT_HEARTBEAT_PROMPT])
    expect(service.status("explicit")).toMatchObject({
      runCount: 1,
      errorCount: 0,
      lastRun: new Date("2026-04-26T00:00:00.000Z"),
      lastError: "",
    })
  })

  it("records executor failures and timeouts", async () => {
    const failed = new AutomationHeartbeatService({
      executor: async () => {
        throw new Error("target missing")
      },
    })
    failed.register("proj", { enabled: true, sessionKey: "tg:1" })
    await expect(failed.triggerNow("proj")).resolves.toMatchObject({
      status: "failed",
      error: "target missing",
    })
    expect(failed.status("proj")).toMatchObject({ runCount: 1, errorCount: 1, lastError: "target missing" })

    const timedOut = new AutomationHeartbeatService({
      executor: () => new Promise(() => undefined),
    })
    timedOut.register("slow", { enabled: true, sessionKey: "tg:2", timeoutMins: 0.00001 })
    await expect(timedOut.triggerNow("slow")).resolves.toMatchObject({ status: "timed_out" })
    expect(timedOut.status("slow")).toMatchObject({ runCount: 1, errorCount: 1 })
  })
})
