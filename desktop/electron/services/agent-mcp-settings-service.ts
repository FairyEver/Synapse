import { existsSync } from "node:fs"
import { readFile, stat } from "node:fs/promises"
import { homedir } from "node:os"
import path from "node:path"
import type { AgentMcpInventory, AgentMcpListInput, AgentMcpToggleInput } from "../../src/types/agent-mcp"
import type { SynapseConfig, SynapseConfigPatch } from "../../src/types/config"
import { isInternalMcp, isValidMcpName as validName, normalizeDisabledMcpServers } from "../../src/lib/agent-mcp-policy"

type Json = Record<string, unknown>
type SettingsSnapshot = { effective: Json; sources: { source: string; path?: string }[] }
type ConfigAccess = { load(): Promise<SynapseConfig>; update(patch: SynapseConfigPatch): Promise<unknown> }

/** Inventory only: never starts a CLI, connects a server or returns configuration values. */
export class AgentMcpSettingsService {
  private writes: Promise<unknown> = Promise.resolve()
  constructor(private readonly deps: {
    config: ConfigAccess
    defaultCwd: string
    configDir?: string
    connectorServers?: () => Promise<{ name: string; config: Json }[]>
    resolveSettings?: (cwd: string) => Promise<SettingsSnapshot>
  }) {}

  async list(input: AgentMcpListInput): Promise<AgentMcpInventory> {
    const config = await this.deps.config.load()
    const projects = config.global.projects.filter(p => path.isAbsolute(p.path))
    const project = input.projectId ? projects.find(p => p.id === input.projectId) : undefined
    if (input.projectId && !project) throw new Error("项目不存在或路径不可用，请刷新。")
    const cwd = path.resolve(project?.path ?? this.deps.defaultCwd)
    const customConfigDir = this.deps.configDir ?? process.env.CLAUDE_CONFIG_DIR
    const configDir = customConfigDir ?? path.join(homedir(), ".claude")
    // Match the bundled SDK's global-file selection, including legacy config roots.
    const preferredUserFile = path.join(configDir, ".config.json")
    const oauthSuffix = process.env.CLAUDE_CODE_CUSTOM_OAUTH_URL ? "-custom-oauth" : ""
    const userFile = existsSync(preferredUserFile) ? preferredUserFile
      : path.join(customConfigDir || homedir(), `.claude${oauthSuffix}.json`)
    const warnings: string[] = []
    const read = async (file: string, label: string): Promise<Json> => {
      try {
        if ((await stat(file)).size > 5 * 1024 * 1024) throw new Error("size")
        const raw: unknown = JSON.parse(await readFile(file, "utf8"))
        if (!record(raw)) throw new Error("shape")
        return raw
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") warnings.push(`${label}读取失败，请检查配置后刷新。`)
        return {}
      }
    }
    let settings: SettingsSnapshot = { effective: {}, sources: [] }
    try {
      settings = this.deps.resolveSettings ? await this.deps.resolveSettings(cwd)
        : await (await import("@anthropic-ai/claude-agent-sdk")).resolveSettings({ cwd, settingSources: ["user", "project", "local"] })
    } catch {
      warnings.push("Claude Code 策略读取失败，暂时无法修改开关。")
    }
    const entries = new Map<string, { source: string; config: Json }>()
    const add = (servers: unknown, source: string, prefix = "") => {
      if (!record(servers)) return
      for (const [key, value] of Object.entries(servers)) {
        const name = `${prefix}${key}`
        if (validName(name) && record(value) && !isInternalMcp(name)) entries.set(name, { source, config: value })
      }
    }
    const user = await read(userFile, "用户 MCP 配置")
    add(user.mcpServers, "user")
    // Claude Code discovers ancestor project MCP files; nearest definitions win.
    const ancestors: string[] = []
    for (let directory = cwd; ; directory = path.dirname(directory)) {
      ancestors.unshift(directory)
      if (path.dirname(directory) === directory) break
    }
    for (const directory of ancestors) add((await read(path.join(directory, ".mcp.json"), "项目 MCP 配置")).mcpServers, "project")
    const local = record(user.projects) && record(user.projects[cwd]) ? user.projects[cwd] : {}
    add(local.mcpServers, "local")

    const plugins = record(settings.effective.enabledPlugins) ? settings.effective.enabledPlugins : {}
    if (Object.values(plugins).some(v => v === true)) {
      const installed = await read(path.join(configDir, "plugins", "installed_plugins.json"), "插件索引")
      const registry = record(installed.plugins) ? installed.plugins : {}
      for (const [id, enabled] of Object.entries(plugins)) {
        if (enabled !== true) continue
        const installs = registry[id]
        if (!Array.isArray(installs)) { warnings.push(`插件 ${id.split("@")[0]} 未找到本机安装记录。`); continue }
        const scoped = installs.filter(record).filter(p => {
          if (typeof p.projectPath !== "string" || !path.isAbsolute(p.projectPath)) return false
          const relative = path.relative(p.projectPath, cwd)
          return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative))
        }).sort((a, b) => String(b.projectPath).length - String(a.projectPath).length)
        const install = scoped[0] ?? installs.filter(record).find(p => p.scope === "user")
        if (!install || typeof install.installPath !== "string" || !path.isAbsolute(install.installPath)) {
          warnings.push(`插件 ${id.split("@")[0]} 的本机安装范围无法解析，清单可能不完整。`)
          continue
        }
        const prefix = `plugin:${id.split("@")[0]}:`
        const plugin = await read(path.join(install.installPath, ".claude-plugin", "plugin.json"), "插件声明")
        const pluginServers = await read(path.join(install.installPath, ".mcp.json"), "插件 MCP 配置")
        add(pluginServers.mcpServers ?? pluginServers, "plugin", prefix)
        if (record(plugin.mcpServers)) add(plugin.mcpServers, "plugin", prefix)
        else if (typeof plugin.mcpServers === "string" || Array.isArray(plugin.mcpServers)) {
          for (const file of [plugin.mcpServers].flat()) {
            if (record(file)) { add(file, "plugin", prefix); continue }
            if (typeof file !== "string") { warnings.push("部分插件 MCP 无法静态解析，清单可能不完整。"); continue }
            if (/^[a-z]+:\/\//iu.test(file) || /\.mcpb$/iu.test(file)) { warnings.push("部分插件 MCP 需运行时解析，清单可能不完整。"); continue }
            const target = path.resolve(install.installPath, file)
            const relative = path.relative(install.installPath, target)
            if (relative.startsWith("..") || path.isAbsolute(relative)) { warnings.push("插件 MCP 路径不可用。"); continue }
            const servers = await read(target, "插件 MCP 配置")
            add(servers.mcpServers ?? servers, "plugin", prefix)
          }
        }
      }
    }
    if (record(settings.effective.managedMcpServers)) add(settings.effective.managedMcpServers, "managed")
    if (settings.sources.some(s => s.source === "managed")) warnings.push("受管及远程 MCP 的实际可用范围以 Agent 会话为准。")
    try { for (const server of await this.deps.connectorServers?.() ?? []) add({ [server.name]: server.config }, "synapse") }
    catch { warnings.push("SY 连接器读取失败，请刷新。") }
    const disabled = normalizeDisabledMcpServers(config.agent.disabledMcpServers)
    for (const name of disabled) if (!entries.has(name)) entries.set(name, { source: "saved", config: {} })
    const deny = Array.isArray(settings.effective.deniedMcpServers) ? settings.effective.deniedMcpServers.filter(record) : []
    const allow = Array.isArray(settings.effective.allowedMcpServers) ? settings.effective.allowedMcpServers.filter(record) : undefined
    const policyUnavailable = warnings.includes("Claude Code 策略读取失败，暂时无法修改开关。")
    const rejectedProjectServers = new Set(Array.isArray(settings.effective.disabledMcpjsonServers) ? settings.effective.disabledMcpjsonServers : [])
    const disabledLocalServers = new Set(Array.isArray(local.disabledMcpServers) ? local.disabledMcpServers : [])
    return {
      projects: projects.map(({ id, name }) => ({ id, name })), disabledServerNames: disabled,
      warnings: [...new Set(warnings)],
      items: [
        { name: "synapse-mcp", source: "builtin", enabled: true, configurable: false },
        ...[...entries].sort(([a], [b]) => a.localeCompare(b)).map(([name, entry]) => {
          const blocked = policyUnavailable || deny.some(rule => matchesRule(rule, name, entry.config))
            || disabledLocalServers.has(name)
            || ((entry.source === "project" || entry.source === "plugin") && rejectedProjectServers.has(name))
            || (allow !== undefined && entry.source !== "managed" && !allow.some(rule => matchesRule(rule, name, entry.config)))
          return { name, source: entry.source, enabled: !blocked && !disabled.includes(name), configurable: !blocked }
        }),
      ],
    }
  }

  async setEnabled(input: AgentMcpToggleInput): Promise<void> {
    if (!validName(input.name) || isInternalMcp(input.name)) throw new Error("无法修改此 MCP。")
    const write = this.writes.then(async () => {
      const config = await this.deps.config.load()
      const names = new Set(normalizeDisabledMcpServers(config.agent.disabledMcpServers))
      if (input.enabled) names.delete(input.name)
      else names.add(input.name)
      await this.deps.config.update({ agent: { disabledMcpServers: [...names].sort() } })
    })
    this.writes = write.catch(() => undefined)
    await write
  }
}

function record(value: unknown): value is Json { return typeof value === "object" && value !== null && !Array.isArray(value) }
function matchesRule(rule: Json, name: string, config: Json): boolean {
  if (rule.serverName === name) return true
  if (Array.isArray(rule.serverCommand) && typeof config.command === "string"
    && JSON.stringify(rule.serverCommand) === JSON.stringify([config.command, ...(Array.isArray(config.args) ? config.args : [])])) return true
  if (typeof rule.serverUrl === "string" && typeof config.url === "string") {
    const pattern = rule.serverUrl.split("*").map(s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*")
    return new RegExp(`^${pattern}$`, "u").test(config.url)
  }
  return false
}
