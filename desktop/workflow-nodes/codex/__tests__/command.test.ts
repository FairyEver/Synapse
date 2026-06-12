import { describe, expect, it } from "vitest"

import { buildCodexExecRequest } from "../command"
import { defaultCodexNodeConfig, type CodexNodeConfig } from "../schema"

function request(config: Partial<CodexNodeConfig> = {}) {
  const abortSignal = new AbortController().signal
  return buildCodexExecRequest({
    config: { ...defaultCodexNodeConfig, ...config },
    prompt: "Write a summary",
    cwd: "/Users/liyang/project",
    lastMessagePath: "/tmp/synapse/last-message.txt",
    abortSignal,
    timeoutMs: 60_000,
    actor: { kind: "system", id: "workflow-engine" },
    metadata: { source: "workflow", actionType: "workflow.codex" },
  })
}

describe("buildCodexExecRequest", () => {
  it("builds unattended default codex exec args and sends prompt through stdin", () => {
    const built = request()

    expect(built).toMatchObject({
      actor: { kind: "system", id: "workflow-engine" },
      action: "shell.exec",
      command: "codex",
      cwd: "/Users/liyang/project",
      stdin: "Write a summary",
      timeoutMs: 60_000,
      pathStrategy: "login-shell",
      output: { stdout: "buffer", stderr: "buffer" },
      metadata: { source: "workflow", actionType: "workflow.codex" },
    })
    expect(built.args).toEqual([
      "exec",
      "--ask-for-approval",
      "never",
      "--sandbox",
      "workspace-write",
      "--json",
      "--output-last-message",
      "/tmp/synapse/last-message.txt",
      "--skip-git-repo-check",
      "--enable",
      "goals",
      "--cd",
      "/Users/liyang/project",
      "-",
    ])
    expect(JSON.stringify(built.args)).not.toContain("Write a summary")
  })

  it("suppresses sandbox and approval flags when bypass is enabled", () => {
    const built = request({ bypassApprovalsAndSandbox: true })

    expect(built.args).toContain("--dangerously-bypass-approvals-and-sandbox")
    expect(built.args).not.toContain("--ask-for-approval")
    expect(built.args).not.toContain("--sandbox")
  })

  it("maps optional CLI flags", () => {
    const built = request({
      model: "gpt-5-codex",
      profile: "automation",
      enableSearch: true,
      strictConfig: true,
      bypassHookTrust: true,
      additionalWritableDirs: ["/Users/liyang/extra", "/Users/liyang/another"],
      images: ["/Users/liyang/image.png"],
      configOverrides: [
        { key: "model_reasoning_effort", value: "high" },
        { key: "sandbox_workspace_write.network_access", value: "true" },
      ],
    })

    expect(built.args).toEqual(expect.arrayContaining([
      "--model",
      "gpt-5-codex",
      "--profile",
      "automation",
      "--search",
      "--strict-config",
      "--dangerously-bypass-hook-trust",
      "--add-dir",
      "/Users/liyang/extra",
      "--add-dir",
      "/Users/liyang/another",
      "--image",
      "/Users/liyang/image.png",
      "--config",
      "model_reasoning_effort=high",
      "--config",
      "sandbox_workspace_write.network_access=true",
    ]))
  })

  it("maps disabled goals to the disable feature flag", () => {
    const built = request({ features: { goals: "disabled" } })

    expect(built.args).toContain("--disable")
    expect(built.args).toContain("goals")
    expect(built.args).not.toContain("--enable")
  })

  it("omits goals feature flags when goals use the default state", () => {
    const built = request({ features: { goals: "default" } })

    expect(built.args).not.toContain("--enable")
    expect(built.args).not.toContain("--disable")
  })
})
