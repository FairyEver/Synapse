import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import {
  CommandAssetRegistry,
  expandCommandTemplate,
  parseCommandInvocation,
} from "../../electron/services/command-asset-service"

const tempRoots: string[] = []

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "synapse-command-"))
  tempRoots.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of tempRoots.splice(0)) {
    fs.rmSync(dir, { force: true, recursive: true })
  }
})

describe("command asset registry", () => {
  it("resolves config commands case-insensitively and lets config override agent files", () => {
    const dir = tempDir()
    fs.writeFileSync(path.join(dir, "deploy.md"), "agent deploy")

    const registry = new CommandAssetRegistry()
    registry.setAgentCommandDirs([dir])
    registry.addCommand({
      name: "Deploy",
      description: "Deploy app",
      prompt: "config deploy",
      exec: "",
      workDir: "",
      source: "config",
    })

    expect(registry.resolve("deploy")).toMatchObject({
      name: "Deploy",
      prompt: "config deploy",
      source: "config",
    })
    expect(registry.resolve("DEPLOY")).toMatchObject({ name: "Deploy" })
  })

  it("loads agent markdown commands and blocks path traversal", () => {
    const dir = tempDir()
    fs.writeFileSync(path.join(dir, "daily-report.md"), "Summarize today's work\nwith details")

    const registry = new CommandAssetRegistry()
    registry.setAgentCommandDirs([dir])

    expect(registry.resolve("daily_report")).toMatchObject({
      name: "daily-report",
      description: "Summarize today's work",
      prompt: "Summarize today's work\nwith details",
      source: "agent",
    })
    expect(registry.resolve("../daily-report")).toBeNull()
  })

  it("lists config and agent commands without normalized duplicates", () => {
    const dir = tempDir()
    fs.writeFileSync(path.join(dir, "review-code.md"), "Review code")
    fs.writeFileSync(path.join(dir, "ship.md"), "Ship release")

    const registry = new CommandAssetRegistry()
    registry.setAgentCommandDirs([dir])
    registry.addCommand({
      name: "review_code",
      description: "Configured review",
      prompt: "Configured review prompt",
      exec: "",
      workDir: "",
      source: "config",
    })

    expect(registry.listAll().map((command) => command.name)).toEqual(["review_code", "ship"])
  })

  it("expands CC Connect placeholders and appends args when no placeholders exist", () => {
    expect(expandCommandTemplate("Deploy {{1}} to {{2:prod}}", ["api"])).toBe("Deploy api to prod")
    expect(expandCommandTemplate("Review {{2*:all files}}", ["--fast", "src/app.ts", "src/ui.ts"])).toBe("Review src/app.ts src/ui.ts")
    expect(expandCommandTemplate("Args: {{args:default}}", [])).toBe("Args: default")
    expect(expandCommandTemplate("Just a template", ["one", "two"])).toBe("Just a template\n\none two")
  })

  it("parses quoted slash invocations and marks exec plans as permission-gated", () => {
    const registry = new CommandAssetRegistry()
    registry.addCommand({
      name: "audit",
      description: "Audit repo",
      prompt: "",
      exec: "npm run audit -- {{args}}",
      workDir: "/repo",
      source: "config",
    })

    const invocation = parseCommandInvocation('/audit "src app" --fix')
    expect(invocation).toEqual({ name: "audit", args: ["src app", "--fix"] })
    expect(registry.createExecutionPlan(invocation!)).toEqual({
      commandName: "audit",
      source: "config",
      action: "exec",
      content: "npm run audit -- src app --fix",
      workDir: "/repo",
      requiresPermission: true,
    })
  })
})
