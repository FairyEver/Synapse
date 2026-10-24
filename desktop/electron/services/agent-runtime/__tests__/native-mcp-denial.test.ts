import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { describe, expect, it } from "vitest"

// Explicit opt-in: native CLI subprocesses and a disposable local stdio fixture only.
describe.skipIf(process.env.SYNAPSE_RUN_NATIVE_MCP_TEST !== "1")("native SDK MCP denial", () => {
  it("blocks a configured server before startup without changing MCP definitions", async () => {
    const { query } = await import("@anthropic-ai/claude-agent-sdk")
    for (const disabled of [false, true]) {
      const root = await mkdtemp(path.join(tmpdir(), "synapse-native-mcp-"))
      const marker = path.join(root, "started"), helper = path.join(root, "fixture.cjs")
      const configPath = path.join(root, ".claude.json")
      const projectConfigPath = path.join(root, ".mcp.json")
      const source = JSON.stringify({ mcpServers: { fixture: { command: process.execPath, args: [helper] } } })
      await writeFile(configPath, source)
      await writeFile(projectConfigPath, source)
      await writeFile(helper, `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'started');process.stdin.resume();`)
      let release: (() => void) | undefined
      async function* pendingInput(): AsyncGenerator<never> { await new Promise<void>(resolve => { release = resolve }) }
      const client = query({ prompt: pendingInput(), options: {
        cwd: root, settingSources: [], strictMcpConfig: true,
        mcpServers: { fixture: { command: process.execPath, args: [helper] } },
        settings: disabled ? { deniedMcpServers: [{ serverName: "fixture" }] } : {},
        env: { ...process.env, HOME: root, USERPROFILE: root, CLAUDE_CONFIG_DIR: root, ANTHROPIC_API_KEY: "fixture", ANTHROPIC_AUTH_TOKEN: "", ANTHROPIC_BASE_URL: "http://127.0.0.1:1", CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1" },
      } })
      const deadline = setTimeout(() => client.close(), 10_000)
      try {
        await client.initializationResult()
        let started = false
        for (let attempt = 0; attempt < (disabled ? 1 : 40); attempt++) {
          await client.mcpServerStatus()
          try { await access(marker); started = true; break }
          catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error }
          await new Promise(resolve => setTimeout(resolve, 50))
        }
        expect(started).toBe(!disabled)
        // Native CLI initializes its own first-start metadata in .claude.json.
        // Compare MCP configuration separately; the project file must be byte-identical.
        expect(JSON.parse(await readFile(configPath, "utf8")).mcpServers).toEqual(JSON.parse(source).mcpServers)
        expect(await readFile(projectConfigPath, "utf8")).toBe(source)
      } finally {
        clearTimeout(deadline); release?.(); client.close()
        await new Promise(resolve => setTimeout(resolve, 150))
        await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
      }
    }
  }, 30_000)
})
