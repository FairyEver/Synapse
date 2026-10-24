import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { describe, expect, it } from "vitest"
import { discoverStagingSkillOverrides } from "../staging-skill-overrides"

describe.skipIf(process.env.SYNAPSE_RUN_NATIVE_MCP_TEST !== "1")("native SDK staging Skill visibility", () => {
  it("excludes staging aliases while retaining canonical and ordinary skills without edits", async () => {
    const sdk = await import("@anthropic-ai/claude-agent-sdk")
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "sy-native-skills-"))
    const names = [".synapse-install-dir-Ab1234", ".synapse-install-dir-Zz9876", "synapse-skill", "ordinary"]
    const body = (name: string) => `---\nname: ${name.startsWith(".synapse") ? "synapse-skill" : name}\ndescription: Read only fixture skill.\n---\nFixture instructions.\n`
    try {
      for (const name of names) {
        const dir = path.join(root, "skills", name)
        await fs.mkdir(dir, { recursive: true }); await fs.writeFile(path.join(dir, "SKILL.md"), body(name))
      }
      const overrides = await discoverStagingSkillOverrides(root, root)
      for (const filtered of [false, true]) {
        let release: (() => void) | undefined
        async function* pending(): AsyncGenerator<never> { await new Promise<void>(resolve => { release = resolve }) }
        const query = sdk.query({ prompt: pending(), options: { cwd: root, settingSources: ["user"], tools: ["Read", "Skill"], skills: "all", strictMcpConfig: true, mcpServers: {},
          settings: { disableAllHooks: true, ...(filtered ? { skillOverrides: overrides } : {}) },
          env: { ...process.env, HOME: root, USERPROFILE: root, CLAUDE_CONFIG_DIR: root, ANTHROPIC_API_KEY: "fixture", ANTHROPIC_AUTH_TOKEN: "", ANTHROPIC_BASE_URL: "http://127.0.0.1:1", CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1" } } })
        const timer = setTimeout(() => query.close(), 12_000)
        try {
          await query.initializationResult()
          const commands = (await query.supportedCommands()).map(command => command.name)
          expect(commands).toContain("synapse-skill")
          expect(commands).toContain("ordinary")
          expect(commands.filter(name => name === "synapse-skill")).toHaveLength(filtered ? 1 : 3)
        } finally { clearTimeout(timer); release?.(); query.close() }
      }
      for (const name of names) expect(await fs.readFile(path.join(root, "skills", name, "SKILL.md"), "utf8")).toBe(body(name))
    } finally { await fs.rm(root, { recursive: true, force: true }) }
  }, 30_000)
})
