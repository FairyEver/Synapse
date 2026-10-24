import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import { createDefaultConfig } from "../../../src/lib/config"
import { AgentMcpSettingsService } from "../agent-mcp-settings-service"

const roots: string[] = []
afterEach(async () => {
  vi.unstubAllEnvs()
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

async function fixture() {
  vi.stubEnv("CLAUDE_CODE_CUSTOM_OAUTH_URL", "")
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
  it("discovers the SDK global config and project-local overrides without changing either source", async () => {
    const f = await fixture()
    const source = path.join(f.configDir, ".config.json")
    const raw = JSON.stringify({ mcpServers: { global: {}, shared: {} }, projects: { [f.cwd]: { mcpServers: { shared: {}, local: {} }, disabledMcpServers: ["local"] } } })
    await writeFile(source, raw)
    const result = await f.service.list({ projectId: "project" })
    expect(result.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "global", source: "user" }),
      expect.objectContaining({ name: "shared", source: "local" }),
      expect.objectContaining({ name: "local", source: "local", enabled: false, configurable: false }),
    ]))
    expect(result.warnings).toEqual([])
    await f.service.setEnabled({ name: "global", enabled: false })
    expect(await readFile(source, "utf8")).toBe(raw)
  })

  it("prefers .config.json over .claude.json and reselects the source on refresh", async () => {
    const f = await fixture()
    const source = path.join(f.configDir, ".config.json")
    const fallback = JSON.stringify({ mcpServers: { fallback: {} } })
    const preferred = JSON.stringify({ mcpServers: { preferred: {} } })
    await writeFile(f.source, fallback)
    expect((await f.service.list({})).items.some(x => x.name === "fallback")).toBe(true)
    await writeFile(source, preferred)
    const result = await f.service.list({})
    expect(result.items.some(x => x.name === "preferred")).toBe(true)
    expect(result.items.some(x => x.name === "fallback")).toBe(false)
    expect(await readFile(f.source, "utf8")).toBe(fallback)
    expect(await readFile(source, "utf8")).toBe(preferred)
    await rm(source)
    expect((await f.service.list({})).items.some(x => x.name === "fallback")).toBe(true)
  })

  it("reports an unreadable selected source instead of silently using the fallback", async () => {
    const f = await fixture()
    await writeFile(path.join(f.configDir, ".config.json"), '{"secret-token": broken')
    await writeFile(f.source, JSON.stringify({ mcpServers: { fallback: {} } }))
    const result = await f.service.list({})
    expect(result.warnings).toContain("用户 MCP 配置读取失败，请检查配置后刷新。")
    expect(result.items.some(x => x.name === "fallback")).toBe(false)
    expect(JSON.stringify(result)).not.toContain("secret-token")
  })

  it("uses the SDK custom OAuth filename when the preferred source is absent", async () => {
    const f = await fixture()
    vi.stubEnv("CLAUDE_CODE_CUSTOM_OAUTH_URL", "https://auth.invalid")
    await writeFile(f.source, JSON.stringify({ mcpServers: { production: {} } }))
    const source = path.join(f.configDir, ".claude-custom-oauth.json")
    const raw = JSON.stringify({ mcpServers: { custom: {} } })
    await writeFile(source, raw)
    const result = await f.service.list({})
    expect(result.items.some(x => x.name === "custom")).toBe(true)
    expect(result.items.some(x => x.name === "production")).toBe(false)
    expect(await readFile(source, "utf8")).toBe(raw)
  })

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
