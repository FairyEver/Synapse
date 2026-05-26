import { readFile } from "node:fs/promises"
import path from "node:path"
import { describe, expect, it } from "vitest"

describe("workflow editor notifications", () => {
  it("mounts the app notifications provider in the workflow editor window", async () => {
    const source = await readFile(path.resolve(__dirname, "../../../../main.tsx"), "utf8")
    const editorBranch = source.slice(
      source.indexOf('if (windowType === "workflow-editor")'),
      source.indexOf('} else if (windowType === "workflow-runner")'),
    )

    expect(editorBranch).toContain("<AppNotificationsProvider>")
    expect(editorBranch).toContain("</AppNotificationsProvider>")
    expect(editorBranch.indexOf("<AppNotificationsProvider>")).toBeLessThan(editorBranch.indexOf("<WorkflowEditorApp />"))
  })

  it("mounts the app notifications provider in the workflow runner window", async () => {
    const source = await readFile(path.resolve(__dirname, "../../../../main.tsx"), "utf8")
    const runnerBranch = source.slice(
      source.indexOf('} else if (windowType === "workflow-runner")'),
      source.indexOf('} else if (windowType === "knowledge-source-manager")'),
    )

    expect(runnerBranch).toContain("<AppNotificationsProvider>")
    expect(runnerBranch).toContain("</AppNotificationsProvider>")
    expect(runnerBranch.indexOf("<AppNotificationsProvider>")).toBeLessThan(runnerBranch.indexOf("<WorkflowRunnerApp />"))
  })
})
