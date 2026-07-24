import { describe, expect, it } from "vitest"

import { rendererActionRegistry } from "../builtin-actions"

describe("renderer action registry", () => {
  it("registers built-in actions", () => {
    expect(rendererActionRegistry.list().map((action) => action.manifest.id)).toEqual([
      "builtin.command",
      "builtin.script",
      "builtin.http-request",
      "builtin.agent",
      "builtin.workflow",
      "builtin.javascript-run",
      "builtin.nodejs-run",
    ])
  })

  it("summarizes built-in configs", () => {
    expect(rendererActionRegistry.summarize("builtin.command", {
      command: "echo ok",
      shell: "posix",
    })).toBe("命令 · echo ok")

    expect(rendererActionRegistry.summarize("builtin.http-request", {
      method: "POST",
      url: "https://example.com/api",
      bodyType: "none",
    })).toBe("POST · https://example.com/api")

    expect(rendererActionRegistry.summarize("builtin.workflow", {
      workflowId: "",
      paramTemplates: {},
    })).toBe("工作流 · 未选择")
  })
})
