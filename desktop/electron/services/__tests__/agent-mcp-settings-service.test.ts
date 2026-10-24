import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import { createDefaultConfig } from "../../../src/lib/config"
import { AgentMcpSettingsService } from "../agent-mcp-settings-service"

const roots: string[] = []
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }) })

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "synapse-mcp-settings-")); roots.push(root)
  const configDir = path.join(root, ".claude"), cwd = path.join(root, "workspace")
  await mkdir(configDir); await mkdir(cwd)
  let config = createDefaultConfig()
  config.global.projects = [{ id: "project", name: "Project", path: cwd }]
  const update = vi.fn(async (patch) => { config = { ...config, agent: { ...config.agent, ...patch.agent } }; return config })
  const service = new AgentMcpSettingsService({
    config: { load: async () => structuredClone(config), update }, defaultCwd: cwd, configDir,
    resolveSettings: async () => ({ effective: {}, sources: [] }),
    connectorServers: async () => [{ name: "figma", config: { type: "http", url: "http://127.0.0.1:3845/mcp" } }],
  })
  const source = path.join(configDir, ".claude.json")
  return { root, cwd, configDir, service, source, update }
}

describe("Agent MCP settings", () => {
  it("refreshes user, project and local sources without exposing config or changing source files", async () => {
    const f = await fixture()
    const raw = JSON.stringify({ mcpServers: { rea: { command: "secret-command", env: { TOKEN: "secret-token" } }, shared: {} }, projects: { [f.cwd]: { mcpServers: { shared: { url: "https://secret.invalid?token=private" } } } } })
    await writeFile(f.source, raw)
    await writeFile(path.join(f.root, ".mcp.json"), JSON.stringify({ mcpServers: { inherited: {}, shared: {} } }))
    await writeFile(path.join(f.cwd, ".mcp.json"), JSON.stringify({ mcpServers: { projectOnly: {}, shared: {} } }))
    let result = await f.service.list({ projectId: "project" })
    expect(result.items.find(x => x.name === "shared")?.source).toBe("local")
    expect(result.items.map(x => x.name)).toEqual(expect.arrayContaining(["rea", "figma", "projectOnly", "inherited", "synapse-mcp"]))
    expect(JSON.stringify(result)).not.toMatch(/secret|TOKEN|private/)
    await f.service.setEnabled({ name: "rea", enabled: false })
    result = await f.service.list({ projectId: "project" })
    expect(result.items.find(x => x.name === "rea")?.enabled).toBe(false)
    expect(await readFile(f.source, "utf8")).toBe(raw)
    await writeFile(f.source, JSON.stringify({ mcpServers: { addedLater: {} } }))
    result = await f.service.list({})
    expect(result.items.find(x => x.name === "addedLater")).toBeDefined()
    expect(result.items.find(x => x.name === "rea")).toMatchObject({ enabled: false, source: "saved" })
  })

  it("serializes concurrent toggles, preserves other preferences and protects the internal router", async () => {
    const f = await fixture()
    await Promise.all([f.service.setEnabled({ name: "rea", enabled: false }), f.service.setEnabled({ name: "antd", enabled: false })])
    expect((await f.service.list({})).disabledServerNames).toEqual(["antd", "rea"])
    await f.service.setEnabled({ name: "rea", enabled: true })
    expect((await f.service.list({})).disabledServerNames).toEqual(["antd"])
    await expect(f.service.setEnabled({ name: "synapse-mcp", enabled: false })).rejects.toThrow()
    await expect(f.service.list({ projectId: "unknown" })).rejects.toThrow()
  })

  it("reports malformed sources without leaking their contents", async () => {
    const f = await fixture()
    await writeFile(f.source, '{"secret-token": broken')
    const result = await f.service.list({})
    expect(result.warnings.length).toBeGreaterThan(0)
    expect(JSON.stringify(result)).not.toContain("secret-token")
  })

  it("honors project rejection and evaluates connector URL policies without returning URLs", async () => {
    const f = await fixture()
    await writeFile(path.join(f.cwd, ".mcp.json"), JSON.stringify({ mcpServers: { rejected: {} } }))
    const config = createDefaultConfig()
    const service = new AgentMcpSettingsService({ config: { load: async () => config, update: vi.fn() }, defaultCwd: f.cwd, configDir: f.configDir,
      connectorServers: async () => [{ name: "figma", config: { type: "http", url: "http://127.0.0.1:3845/mcp" } }],
      resolveSettings: async () => ({ effective: { disabledMcpjsonServers: ["rejected"], allowedMcpServers: [{ serverName: "rejected" }, { serverUrl: "http://127.0.0.1:*/mcp" }] }, sources: [] }),
    })
    const result = await service.list({})
    expect(result.items.find(x => x.name === "rejected")).toMatchObject({ enabled: false, configurable: false })
    expect(result.items.find(x => x.name === "figma")).toMatchObject({ enabled: true, configurable: true })
    expect(JSON.stringify(result)).not.toContain("3845")
  })

  it("lists enabled plugin MCPs and honors upstream name-based denial", async () => {
    const f = await fixture(), plugin = path.join(f.root, "plugin")
    await mkdir(plugin)
    await mkdir(path.join(plugin, ".claude-plugin"))
    await writeFile(path.join(plugin, ".claude-plugin", "plugin.json"), JSON.stringify({ name: "analysis", mcpServers: [{ inline: {} }, "https://example.invalid/secret-package.mcpb"] }))
    await writeFile(path.join(plugin, ".mcp.json"), JSON.stringify({ mcpServers: { analyzer: {} } }))
    await writeFile(path.join(f.configDir, "plugins.json"), "{}")
    await mkdir(path.join(f.configDir, "plugins"))
    await writeFile(path.join(f.configDir, "plugins", "installed_plugins.json"), JSON.stringify({ version: 2, plugins: { "analysis@market": [{ scope: "project", projectPath: f.root, installPath: plugin }], "unresolved@market": [{ scope: "system", installPath: "invalid" }] } }))
    const config = createDefaultConfig()
    const service = new AgentMcpSettingsService({ config: { load: async () => config, update: vi.fn() }, defaultCwd: f.cwd, configDir: f.configDir,
      resolveSettings: async () => ({ effective: { enabledPlugins: { "analysis@market": true, "unresolved@market": true }, deniedMcpServers: [{ serverName: "plugin:analysis:analyzer" }] }, sources: [] }),
    })
    const inventory = await service.list({})
    const item = inventory.items.find(x => x.name === "plugin:analysis:analyzer")
    expect(item).toMatchObject({ source: "plugin", enabled: false, configurable: false })
    expect(inventory.items.find(x => x.name === "plugin:analysis:inline")).toBeDefined()
    expect(inventory.warnings.join()).toContain("清单可能不完整")
    expect(inventory.warnings.join()).toContain("本机安装范围无法解析")
    expect(JSON.stringify(inventory)).not.toContain("secret-package")
  })
})
