import path from "node:path"
import { describe, expect, it } from "vitest"
import { previewLegacyCcConfigImport } from "../../electron/services/legacy-cc-config-import"

describe("legacy CC Connect config import", () => {
  it("maps defaults, env placeholders, projects, providers, and platforms", async () => {
    const homeDir = "/Users/tester"
    const rootDir = "/workspace"
    const preview = await previewLegacyCcConfigImport(`
language = "zh"
custom_top = "keep"

[log]
level = "debug"

[[providers]]
name = "shared"
api_key = "\${OPENAI_API_KEY}"
base_url = "https://api.example.com/v1"
model = "gpt-test"
agent_types = ["codex"]

[[projects]]
name = "demo"

[projects.agent]
type = "codex"
provider_refs = ["shared"]

[projects.agent.options]
work_dir = "\${ROOT_DIR}/demo"
provider = "shared"

[[projects.platforms]]
type = "telegram"

[projects.platforms.options]
token = "\${TG_TOKEN}"
`, {
      homeDir,
      env: {
        OPENAI_API_KEY: "sk-test",
        ROOT_DIR: rootDir,
        TG_TOKEN: "tg-test",
      },
      platform: "darwin",
    })

    expect(preview.valid).toBe(true)
    expect(preview.global).toEqual({
      dataDir: path.join(homeDir, ".cc-connect"),
      language: "zh",
      attachmentSend: "on",
      logLevel: "debug",
    })
    expect(preview.ignoredTopLevelKeys).toEqual(["custom_top"])
    expect(preview.projects[0]).toMatchObject({
      name: "demo",
      workDir: `${rootDir}/demo`,
      agentType: "codex",
      providerRefs: ["shared"],
      activeProvider: "shared",
      platformTypes: ["telegram"],
    })
    expect(preview.providers[0]).toMatchObject({
      name: "shared",
      source: "global",
      baseUrl: "https://api.example.com/v1",
      model: "gpt-test",
      agentTypes: ["codex"],
      hasApiKey: true,
    })
  })

  it("keeps CC Connect missing env placeholders as empty strings with warnings", async () => {
    const preview = await previewLegacyCcConfigImport(`
[[projects]]
name = "demo"

[projects.agent]
type = "codex"

[projects.agent.options]
work_dir = "/tmp/demo"
note = "prefix-\${MISSING_TOKEN}-suffix"

[[projects.platforms]]
type = "telegram"
`, {
      homeDir: "/Users/tester",
      env: {},
      platform: "darwin",
    })

    expect(preview.valid).toBe(true)
    expect(preview.warnings).toContain("环境变量 MISSING_TOKEN 未设置，已按空字符串处理。")
  })

  it("rejects missing required project fields and invalid attachment_send", async () => {
    const preview = await previewLegacyCcConfigImport(`
attachment_send = "maybe"

[[projects]]
name = ""

[projects.agent]
type = ""
`, {
      homeDir: "/Users/tester",
      env: {},
      platform: "darwin",
    })

    expect(preview.valid).toBe(false)
    expect(preview.errors).toContain('config: attachment_send must be "on" or "off"')
    expect(preview.errors).toContain("config: projects[0].name is required")
    expect(preview.errors).toContain("config: projects[0].agent.type is required")
    expect(preview.errors).toContain("config: projects[0] needs at least one [[projects.platforms]]")
  })

  it("rejects dangerous run_as_user and run_as_env values", async () => {
    const preview = await previewLegacyCcConfigImport(`
[[projects]]
name = "sandbox"
run_as_user = "root"
run_as_env = ["PATH", "SAFE_TOKEN"]

[projects.agent]
type = "codex"

[projects.agent.options]
work_dir = "/tmp/demo"

[[projects.platforms]]
type = "telegram"
`, {
      homeDir: "/Users/tester",
      env: {},
      platform: "darwin",
    })

    expect(preview.valid).toBe(false)
    expect(preview.projects[0]?.issues).toContain("config: projects[0].run_as_user must not be root")
    expect(preview.projects[0]?.issues).toContain('config: projects[0].run_as_env must not include dangerous variable "PATH"')
  })

  it("rejects multi-workspace configs that also set work_dir", async () => {
    const preview = await previewLegacyCcConfigImport(`
[[projects]]
name = "multi"
mode = "multi-workspace"
base_dir = "/tmp/projects"

[projects.agent]
type = "codex"

[projects.agent.options]
work_dir = "/tmp/projects/demo"

[[projects.platforms]]
type = "telegram"
`, {
      homeDir: "/Users/tester",
      env: {},
      platform: "darwin",
    })

    expect(preview.valid).toBe(false)
    expect(preview.errors).toContain('project "multi": multi-workspace mode conflicts with agent work_dir')
  })
})
