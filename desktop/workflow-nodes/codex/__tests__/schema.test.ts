import { describe, expect, it } from "vitest"
import { codexNodeConfigSchema, defaultCodexNodeConfig } from "../schema"

describe("codexNodeConfigSchema", () => {
  it("accepts unattended-friendly defaults", () => {
    const parsed = codexNodeConfigSchema.parse(defaultCodexNodeConfig)

    expect(parsed).toEqual({
      variables: [],
      prompt: "",
      approvalPolicy: "never",
      sandbox: "workspace-write",
      enableSearch: false,
      features: { goals: "enabled" },
      skipGitRepoCheck: true,
      strictConfig: false,
      bypassApprovalsAndSandbox: false,
      bypassHookTrust: false,
      additionalWritableDirs: [],
      images: [],
      configOverrides: [],
      captureDebugArtifacts: true,
    })
  })

  it("rejects duplicate config override keys", () => {
    const result = codexNodeConfigSchema.safeParse({
      ...defaultCodexNodeConfig,
      prompt: "run",
      configOverrides: [
        { key: "model_reasoning_effort", value: "high" },
        { key: "model_reasoning_effort", value: "low" },
      ],
    })

    expect(result.success).toBe(false)
  })

  it("rejects empty additionalWritableDirs/images entries", () => {
    const result = codexNodeConfigSchema.safeParse({
      ...defaultCodexNodeConfig,
      prompt: "run",
      additionalWritableDirs: ["  "],
      images: [""],
    })

    expect(result.success).toBe(false)
  })

  it("accepts explicit CLI options including disabled goals", () => {
    const parsed = codexNodeConfigSchema.parse({
      ...defaultCodexNodeConfig,
      variables: [{ name: "input", source: { type: "static", value: "hello" } }],
      prompt: "run {{input}}",
      projectId: "project-1",
      timeoutMins: 15,
      approvalPolicy: "on-request",
      sandbox: "danger-full-access",
      model: "gpt-5-codex",
      profile: "automation",
      enableSearch: true,
      features: { goals: "disabled" },
      strictConfig: true,
      bypassHookTrust: true,
      additionalWritableDirs: ["/Users/liyang/project-extra"],
      images: ["/Users/liyang/image.png"],
      configOverrides: [{ key: "model_reasoning_effort", value: "high" }],
    })

    expect(parsed).toMatchObject({
      model: "gpt-5-codex",
      profile: "automation",
      enableSearch: true,
      features: { goals: "disabled" },
      strictConfig: true,
      bypassHookTrust: true,
    })
  })

  it("trims model and profile and drops blank values", () => {
    const parsed = codexNodeConfigSchema.parse({
      ...defaultCodexNodeConfig,
      model: "  gpt-5-codex  ",
      profile: "  ",
    })

    expect(parsed.model).toBe("gpt-5-codex")
    expect(parsed.profile).toBeUndefined()
  })

  it("rejects unknown goals feature state", () => {
    const result = codexNodeConfigSchema.safeParse({
      ...defaultCodexNodeConfig,
      features: { goals: "maybe" },
    })

    expect(result.success).toBe(false)
  })
})
